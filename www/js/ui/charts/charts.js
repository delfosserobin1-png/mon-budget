// Graphiques de l'appli, dessinés à la main (SVG et HTML) — aucune bibliothèque à télécharger.
//
// Règles suivies partout :
//  - une seule échelle par graphique ; grilles et axes en traits fins et discrets ;
//  - traits de 2 px, barres fines (24 px au plus) arrondies côté valeur, 2 px d'air entre voisines ;
//  - la couleur sert à distinguer, jamais à lire un chiffre : chaque valeur est aussi disponible
//    en toutes lettres (étiquette, info-bulle au toucher, et vue « tableau » de chaque carte) ;
//  - le texte est toujours à la couleur du texte, jamais à celle des séries.

import { h, s, clear } from '../dom.js';
import { icon } from '../icons.js';
import { formatAmount } from '../../core/money.js';

/** Montant arrondi pour les axes : « 0 € », « 500 € », « 1 500 € », « 12 k€ ». */
export function axisEuro(cents) {
  const euros = cents / 100;
  const abs = Math.abs(euros);
  const sign = euros < 0 ? String.fromCharCode(0x2212) : '';
  if (abs >= 10000) return `${sign}${String(Math.round(abs / 100) / 10).replace('.', ',')} k€`;
  return `${sign}${String(Math.round(abs)).replace(/\B(?=(\d{3})+(?!\d))/g, String.fromCharCode(0x202f))} €`;
}

/** Graduation « ronde » couvrant [min, max] : renvoie { min, max, ticks }. */
export function niceScale(min, max, count = 4) {
  if (min === max) {
    if (min === 0) max = 10000;
    else {
      const pad = Math.abs(min) * 0.2;
      min -= pad;
      max += pad;
    }
  }
  const span = max - min;
  const rough = span / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * power).find((u) => u >= rough) || 10 * power;
  const lo = Math.floor(min / unit) * unit;
  const hi = Math.ceil(max / unit) * unit;
  const ticks = [];
  for (let v = lo; v <= hi + unit / 2; v += unit) ticks.push(Math.round(v));
  return { min: lo, max: hi, ticks };
}

/** Carte de graphique : titre, sous-titre, contenu, et bascule vers la vue « tableau ». */
export function chartCard({ title, subtitle = '', body, table = null, name = '' }) {
  let showTable = false;
  const holder = h('div', body);
  const toggle = table
    ? h('button.icon-btn', { type: 'button', 'aria-label': `Voir les chiffres de « ${title} » en tableau`, 'aria-pressed': 'false', dataset: { action: 'toggle-table' } }, icon('table'))
    : null;
  if (toggle) {
    toggle.addEventListener('click', () => {
      showTable = !showTable;
      toggle.setAttribute('aria-pressed', String(showTable));
      clear(holder).appendChild(showTable ? dataTable(table) : body);
    });
  }
  return h('section.chart-card', { dataset: { chart: name || null } }, h('div.chart-head', h('h2', title, subtitle ? h('span.sub', subtitle) : null), toggle), holder);
}

export function dataTable({ columns, rows }) {
  return h(
    'div.table-wrap',
    h(
      'table.data',
      h('thead', h('tr', columns.map((c) => h('th', { class: c.numeric ? 'n' : null, scope: 'col' }, c.label)))),
      h('tbody', rows.map((row) => h('tr', row.map((cell, i) => h('td', { class: columns[i].numeric ? 'n' : null }, cell))))),
    ),
  );
}

export function legend(items) {
  return h(
    'div.legend',
    items.map((item) => h('span', h('i', { class: item.kind || null, style: { '--c': item.color } }), item.label)),
  );
}

// Une seule info-bulle ouverte à la fois dans toute l'appli ; un appui ailleurs la referme.
let openTip = null;
let outsideListener = false;
export function hideChartTooltip() {
  if (openTip) openTip.el.remove();
  openTip = null;
}

/** Info-bulle attachée à une zone de graphique. show(x, y, { title, rows, action }) / hide(). */
function tooltipFor(box) {
  if (!outsideListener) {
    outsideListener = true;
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (openTip && !openTip.box.contains(event.target)) hideChartTooltip();
      },
      { passive: true },
    );
  }
  const hide = () => {
    if (openTip && openTip.box === box) hideChartTooltip();
  };
  const show = (x, y, { title, rows = [], action = null }) => {
    hideChartTooltip();
    const el = h('div.tooltip', { role: 'status' });
    if (title) el.appendChild(h('div.t-title', title));
    for (const row of rows) {
      el.appendChild(h('div.t-row', h('span.key', row.color ? h('i', { style: { '--c': row.color } }) : null, row.label), h('b', row.value)));
    }
    if (action) el.appendChild(h('button.link-btn', { type: 'button', dataset: { action: 'chart-open' }, onclick: action.run }, action.label));
    box.appendChild(el);
    openTip = { el, box };
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.max(0, Math.min(box.clientWidth - width, x - width / 2));
    const top = y - height - 10 < 0 ? y + 14 : y - height - 10;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  return { show, hide };
}

function measureWidth(box, fallback = 340) {
  const width = box.clientWidth || (box.parentElement && box.parentElement.clientWidth) || fallback;
  return Math.max(260, Math.round(width));
}

/**
 * Courbes dans le temps.
 *   points : [{ date, label (texte de la date), values: [v0, v1…], projected }]
 *   series : [{ label, color }]
 *   marks  : dates à étiqueter sur l'axe : [{ index, label }]
 * La partie « projetée » (après aujourd'hui) est tracée en pointillés.
 */
export function lineChart({ points, series, marks = [], height = 190 }) {
  const box = h('div.chart-box');
  const tip = tooltipFor(box);
  const draw = () => {
    clear(box);
    if (points.length < 2) {
      box.appendChild(h('p.hint', 'Pas assez de jours pour tracer une courbe.'));
      return;
    }
    const W = measureWidth(box);
    const H = height;
    const pad = { l: 8, r: 8, t: 14, b: 24 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) for (const v of p.values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo > 0 && lo < hi * 0.35) lo = 0;
    const scale = niceScale(lo, hi, 3);
    const labels = scale.ticks.map(axisEuro);
    const labelWidth = Math.max(...labels.map((t) => t.length)) * 6.2 + 6;
    const x0 = pad.l + labelWidth;
    const x1 = W - pad.r;
    const y0 = H - pad.b;
    const y1 = pad.t;
    const X = (i) => x0 + ((x1 - x0) * i) / (points.length - 1);
    const Y = (v) => y0 - ((y0 - y1) * (v - scale.min)) / (scale.max - scale.min || 1);

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Courbes : ${series.map((x) => x.label).join(', ')}` });
    scale.ticks.forEach((tick, i) => {
      svg.appendChild(s('line', { class: tick === 0 ? 'axis' : 'grid', x1: x0, x2: x1, y1: Y(tick), y2: Y(tick) }));
      svg.appendChild(s('text', { x: x0 - 6, y: Y(tick) + 3.5, 'text-anchor': 'end' }, labels[i]));
    });
    for (const mark of marks) {
      const anchor = mark.index === 0 ? 'start' : mark.index === points.length - 1 ? 'end' : 'middle';
      svg.appendChild(s('text', { x: X(mark.index), y: H - 6, 'text-anchor': anchor }, mark.label));
    }
    const firstProjected = points.findIndex((p) => p.projected);
    const split = firstProjected < 0 ? points.length - 1 : Math.max(0, firstProjected - 1);
    series.forEach((serie, k) => {
      const path = (from, to) => {
        let d = '';
        for (let i = from; i <= to; i++) d += `${i === from ? 'M' : 'L'}${X(i).toFixed(1)} ${Y(points[i].values[k]).toFixed(1)}`;
        return d;
      };
      if (split > 0) svg.appendChild(s('path', { d: path(0, split), fill: 'none', stroke: serie.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (split < points.length - 1) {
        svg.appendChild(s('path', { d: path(split, points.length - 1), fill: 'none', stroke: serie.color, 'stroke-width': 2, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
      // point final, avec son anneau de la couleur du fond
      const last = points.length - 1;
      svg.appendChild(s('circle', { cx: X(last), cy: Y(points[last].values[k]), r: 4, fill: serie.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    });
    if (firstProjected > 0) {
      const xt = X(split);
      svg.appendChild(s('line', { class: 'axis', x1: xt, x2: xt, y1: y1 - 4, y2: y0 }));
      svg.appendChild(s('text', { x: Math.min(xt + 4, x1 - 62), y: y1 - 4 }, "Aujourd'hui"));
    }
    // repère vertical + info-bulle, qui suivent le doigt
    const cross = s('line', { class: 'axis', y1, y2: y0, x1: 0, x2: 0, visibility: 'hidden' });
    const dots = series.map((serie) => s('circle', { r: 4, fill: serie.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
    svg.appendChild(cross);
    for (const dot of dots) svg.appendChild(dot);
    const hit = s('rect', { class: 'hit', x: x0, y: 0, width: x1 - x0, height: H, tabindex: 0, 'aria-label': 'Explorer la courbe (flèches gauche et droite)' });
    let focused = points.length - 1;
    const point = (i) => {
      focused = Math.max(0, Math.min(points.length - 1, i));
      const p = points[focused];
      cross.setAttribute('x1', X(focused));
      cross.setAttribute('x2', X(focused));
      cross.setAttribute('visibility', 'visible');
      dots.forEach((dot, k) => {
        dot.setAttribute('cx', X(focused));
        dot.setAttribute('cy', Y(p.values[k]));
        dot.setAttribute('visibility', 'visible');
      });
      tip.show(X(focused), y1 + 6, {
        title: p.projected ? `${p.label} (estimation)` : p.label,
        rows: series.map((serie, k) => ({ color: serie.color, label: serie.label, value: formatAmount(p.values[k]) })),
      });
    };
    const fromEvent = (event) => {
      const rect = svg.getBoundingClientRect();
      const ratio = (event.clientX - rect.left - x0) / (x1 - x0);
      point(Math.round(ratio * (points.length - 1)));
    };
    hit.addEventListener('pointerdown', fromEvent);
    hit.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' || event.buttons || event.pressure > 0) fromEvent(event);
    });
    hit.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') {
        tip.hide();
        cross.setAttribute('visibility', 'hidden');
        for (const dot of dots) dot.setAttribute('visibility', 'hidden');
      }
    });
    hit.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') point(focused - 1);
      else if (event.key === 'ArrowRight') point(focused + 1);
      else return;
      event.preventDefault();
    });
    svg.appendChild(hit);
    box.appendChild(svg);
  };
  return { el: box, draw };
}

/**
 * Colonnes par période (mois). mode 'grouped' : séries côte à côte ; 'stacked' : empilées.
 *   groups : [{ label, values: [v0, v1…], title, action? }]
 *   series : [{ label, color }]
 */
export function columnChart({ groups, series, mode = 'grouped', height = 180 }) {
  const box = h('div.chart-box');
  const tip = tooltipFor(box);
  const draw = () => {
    clear(box);
    const W = measureWidth(box);
    const H = height;
    const pad = { l: 8, r: 6, t: 10, b: 24 };
    let hi = 0;
    for (const g of groups) hi = Math.max(hi, mode === 'stacked' ? g.values.reduce((a, b) => a + b, 0) : Math.max(...g.values));
    const scale = niceScale(0, hi || 10000, 3);
    const labels = scale.ticks.map(axisEuro);
    const labelWidth = Math.max(...labels.map((t) => t.length)) * 6.2 + 6;
    const x0 = pad.l + labelWidth;
    const x1 = W - pad.r;
    const y0 = H - pad.b;
    const y1 = pad.t;
    const Y = (v) => y0 - ((y0 - y1) * v) / (scale.max || 1);
    const band = (x1 - x0) / groups.length;
    const perGroup = mode === 'stacked' ? 1 : series.length;
    const barWidth = Math.max(3, Math.min(24, (band * 0.72 - (perGroup - 1) * 2) / perGroup));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Colonnes : ${series.map((x) => x.label).join(', ')}` });
    scale.ticks.forEach((tick, i) => {
      svg.appendChild(s('line', { class: tick === 0 ? 'axis' : 'grid', x1: x0, x2: x1, y1: Y(tick), y2: Y(tick) }));
      svg.appendChild(s('text', { x: x0 - 6, y: Y(tick) + 3.5, 'text-anchor': 'end' }, labels[i]));
    });
    // une étiquette de mois sur deux (ou trois) quand il y en a beaucoup
    const every = Math.ceil(groups.length / Math.max(1, Math.floor((x1 - x0) / 34)));
    const layer = s('g', {});
    svg.appendChild(layer);
    groups.forEach((group, gi) => {
      const cx = x0 + band * gi + band / 2;
      if (gi % every === 0 || gi === groups.length - 1) svg.appendChild(s('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }, group.label));
      const g = s('g', { class: 'mark' });
      if (mode === 'stacked') {
        let acc = 0;
        group.values.forEach((value, k) => {
          if (value <= 0) return;
          const top = Y(acc + value);
          const bottom = Y(acc);
          const hBar = Math.max(0, bottom - top - (acc > 0 ? 2 : 0));
          const isTop = group.values.slice(k + 1).every((v) => v <= 0);
          if (hBar > 0.5) g.appendChild(roundedBar(cx - barWidth / 2, top, barWidth, hBar, isTop ? 4 : 0, series[k].color));
          acc += value;
        });
      } else {
        const total = perGroup * barWidth + (perGroup - 1) * 2;
        group.values.forEach((value, k) => {
          if (value <= 0) return;
          const x = cx - total / 2 + k * (barWidth + 2);
          g.appendChild(roundedBar(x, Y(value), barWidth, y0 - Y(value), 4, series[k].color));
        });
      }
      layer.appendChild(g);
      const hit = s('rect', { class: 'hit', x: x0 + band * gi, y: y1, width: band, height: y0 - y1 + pad.b, tabindex: 0, 'aria-label': `${group.title} : ${series.map((x, k) => `${x.label} ${formatAmount(group.values[k])}`).join(', ')}` });
      const open = () => {
        layer.setAttribute('class', 'dim');
        for (const other of layer.children) other.setAttribute('class', other === g ? 'mark on' : 'mark');
        tip.show(cx, Y(mode === 'stacked' ? group.values.reduce((a, b) => a + b, 0) : Math.max(...group.values)), {
          title: group.title,
          rows: [...series.map((x, k) => ({ color: x.color, label: x.label, value: formatAmount(group.values[k]) })), ...(group.extraRows || [])],
          action: group.action || null,
        });
      };
      hit.addEventListener('click', open);
      hit.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') open();
      });
      hit.addEventListener('focus', open);
      hit.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && group.action) {
          event.preventDefault();
          group.action.run();
        }
      });
      svg.appendChild(hit);
    });
    svg.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && !box.querySelector('.tooltip:hover')) {
        layer.setAttribute('class', '');
      }
    });
    box.appendChild(svg);
  };
  return { el: box, draw };
}

/** Barre verticale : coins arrondis côté valeur (haut), base carrée. */
function roundedBar(x, y, width, height, radius, fill) {
  const r = Math.min(radius, width / 2, height);
  const d = `M${x} ${y + height}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${width - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y + height}z`;
  return s('path', { d, fill });
}

/**
 * Barres classées (une ligne par élément, la plus grande en haut), une seule couleur.
 *   rows : [{ label, value, share (0..1), dot (clé de couleur, facultatif), action? }]
 */
export function rankedBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h(
    'div.bars',
    rows.map((row) =>
      h(
        row.action ? 'button.bar-row' : 'div.bar-row',
        { type: row.action ? 'button' : null, class: row.dot ? `k-${row.dot}` : null, onclick: row.action || null, dataset: { bar: row.label } },
        h('span.name', row.dot ? h('span.dot') : null, h('span.text', row.label)),
        h('span.value', formatAmount(row.value), row.share !== undefined ? h('small', `${Math.round(row.share * 100)} %`) : null),
        h('span.track', h('i', { style: { width: `${Math.max(0.5, (row.value / max) * 100)}%` } })),
      ),
    ),
  );
}

/**
 * Barre segmentée : un tout découpé en parts. tall = 28 px avec le pourcentage imprimé quand il
 * tient ; sinon 8 px, sans texte (les chiffres sont à côté).
 *   parts : [{ label, value, color, text (couleur du texte dans la part), action? }]
 */
export function segmentedBar(parts, { tall = true } = {}) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const bar = h('div', { class: tall ? 'segbar' : 'segbar thin', role: 'img', 'aria-label': parts.map((p) => `${p.label} ${total ? Math.round((p.value / total) * 100) : 0} %`).join(', ') });
  for (const part of parts) {
    if (part.value <= 0 || !total) continue;
    const share = part.value / total;
    const percent = Math.round(share * 100);
    const seg = h(part.action ? 'button' : 'i', {
      type: part.action ? 'button' : null,
      style: { flex: `${part.value} 0 0`, '--c': part.color, '--t': part.text || '#fff' },
      title: `${part.label} : ${formatAmount(part.value)} (${percent} %)`,
      'aria-label': part.action ? `${part.label} : ${formatAmount(part.value)}, ${percent} %` : null,
      onclick: part.action || null,
    });
    // le pourcentage n'est imprimé que si la part est assez large pour le contenir
    if (tall && share >= 0.12) seg.appendChild(document.createTextNode(`${percent} %`));
    bar.appendChild(seg);
  }
  return bar;
}

/**
 * Calendrier d'un mois coloré selon la dépense du jour (une seule teinte, du clair au foncé).
 *   days : [{ date, day (numéro), value, action? }], offset : nombre de cases vides avant le 1er (lundi = 0)
 */
export function heatCalendar({ days, offset }) {
  const max = Math.max(0, ...days.map((d) => d.value));
  const level = (value) => {
    if (!value || !max) return 0;
    return Math.min(4, 1 + Math.floor((value / max) * 3.999));
  };
  const grid = h('div.heat', { role: 'grid', 'aria-label': 'Sorties par jour' });
  for (const name of ['L', 'M', 'M', 'J', 'V', 'S', 'D']) grid.appendChild(h('div.hd', { 'aria-hidden': 'true' }, name));
  for (let i = 0; i < offset; i++) grid.appendChild(h('i.pad', { 'aria-hidden': 'true' }));
  for (const day of days) {
    const lvl = level(day.value);
    const cell = h(
      day.action ? 'button' : 'i',
      {
        type: day.action ? 'button' : null,
        style: { '--c': `var(--viz-seq-${lvl})`, '--t': lvl >= 3 ? 'var(--viz-seq-text-strong)' : 'var(--ink-2)' },
        title: `${day.label} : ${formatAmount(day.value)}`,
        'aria-label': `${day.label} : ${formatAmount(day.value)} dépensés`,
        onclick: day.action || null,
        dataset: { day: day.date },
      },
      String(day.day),
    );
    grid.appendChild(cell);
  }
  const scale = h('div.scale', { 'aria-hidden': 'true' }, 'Moins', [0, 1, 2, 3, 4].map((n) => h('i', { style: { '--c': `var(--viz-seq-${n})` } })), 'Plus');
  return h('div', grid, scale);
}
