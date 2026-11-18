// Bouton IA : commenter un endroit précis de l'appli, pour que Claude le corrige ou le fasse évoluer.
//
//   1. On touche le bouton « IA » (un onglet sur le bord droit, qu'on peut faire glisser) ;
//   2. on entoure du doigt la partie de l'écran concernée (ou on la touche simplement) ;
//   3. on écrit un petit commentaire, et on l'envoie à Claude.
//
// Le commentaire part avec : une capture de l'écran où l'entourage est dessiné (montants masqués
// par défaut), et la description de l'élément visé (écran, feuille ouverte, chemin dans le code,
// libellé) — de quoi retrouver l'endroit exact sans ambiguïté. Il rejoint ensuite le circuit
// habituel des commentaires (Plus › Commentaires pour Claude) : file d'attente hors connexion,
// réponses affichées dans l'appli.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { openSheet, toast } from './overlays.js';
import { segmented, textArea, toggle } from './fields.js';
import { captureFrame, maskAmountsText, SKIP_ATTR } from './capture.js';
import { diagnosticsText } from './screens/settings-screens.js';
import { Draft } from '../core/changeset.js';
import { makeBugReport } from '../core/schema.js';
import { COMMENT_KINDS, targetText } from '../core/comments.js';
import { deviceSummary } from '../platform/platform.js';

export const AI_SETTING = 'aiButton';
const POSITION_KEY = 'mon-budget-ia-position';
const SIDE_KEY = 'mon-budget-ia-cote';
const INK = '#ff3b30';
const MEANINGFUL = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '.op-row',
  '.menu-item',
  '.tile',
  '.chart-card',
  '.env-card',
  '.quota-row',
  '.notice',
  '.field',
  '.card',
  '.topbar',
  '.tabbar',
  '.sheet-head',
  '.sheet-foot',
  '.dialog',
  'h1',
  'h2',
  'h3',
  'section',
].join(', ');
const IDENT = ['screen', 'action', 'open', 'tab', 'field', 'value', 'card', 'notice', 'block', 'period', 'tile', 'quotaRow', 'quota', 'envelope', 'op', 'tag', 'report', 'rule', 'statement', 'reconciliation'];

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// L'élément visé
// ---------------------------------------------------------------------------------------------

function meaningful(el, frame) {
  const found = el && el.closest ? el.closest(MEANINGFUL) : null;
  return found && frame.contains(found) ? found : null;
}

/** Morceau de chemin : « button.fab[data-action="add"] ». */
function pathPart(node) {
  let part = node.tagName.toLowerCase();
  const classes = [...node.classList].filter((c) => !/^k-/.test(c)).slice(0, 2);
  if (classes.length) part += `.${classes.join('.')}`;
  const key = IDENT.find((k) => node.dataset && node.dataset[k] !== undefined);
  if (key) part += `[data-${kebab(key)}="${node.dataset[key]}"]`;
  return part;
}

/** Chemin de l'élément depuis son écran (ou la feuille ouverte), assez précis pour le retrouver dans le code. */
export function selectorPath(el, frame) {
  const parts = [];
  for (let node = el; node && node !== frame && parts.length < 6; node = node.parentElement) {
    parts.unshift(pathPart(node));
    if (node.dataset && (node.dataset.screen || node.classList.contains('sheet') || node.classList.contains('dialog'))) break;
  }
  return parts.join(' > ');
}

function labelOf(el) {
  let text = el.getAttribute('aria-label') || '';
  if (!text && el.matches('input, textarea, select')) {
    const field = el.closest('.field');
    text = field?.querySelector('label, .label')?.textContent || el.getAttribute('placeholder') || el.name || '';
  }
  if (!text) text = el.innerText || el.textContent || '';
  text = maskAmountsText(clean(text));
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function roleOf(el) {
  if (el.matches('.tabbar button')) return 'tab';
  if (el.matches('.op-row')) return 'row';
  if (el.matches('.menu-item')) return 'menu';
  if (el.matches('button, a, [role="button"]')) return 'button';
  if (el.matches('input, textarea, select, .field')) return 'field';
  if (el.matches('h1, h2, h3, .topbar, .sheet-head')) return 'title';
  if (el.matches('.card, .tile, .chart-card, .env-card, .notice, .quota-row, section')) return 'card';
  return 'zone';
}

/**
 * L'élément visé par une zone (coordonnées dans la frame) : on sonde des points de la zone, on
 * garde l'élément « parlant » le plus touché (bouton, ligne, carte…), ou à défaut leur ancêtre commun.
 */
export function pickElement(frame, area) {
  const box = frame.getBoundingClientRect();
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const points = [[cx, cy], [cx, cy], [cx, cy]];
  for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) points.push([area.x + (area.w * i) / 4, area.y + (area.h * j) / 4]);
  const counts = new Map();
  for (const [x, y] of points) {
    const hit = document.elementFromPoint(box.left + x, box.top + y);
    if (!hit || !frame.contains(hit) || hit.closest(`[${SKIP_ATTR}="skip"]`)) continue;
    const el = meaningful(hit, frame) || hit;
    counts.set(el, (counts.get(el) || 0) + 1);
  }
  if (!counts.size) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 1 || ranked[0][1] >= points.length / 2) return ranked[0][0];
  let common = ranked[0][0];
  for (const [el] of ranked.slice(1)) while (common && !common.contains(el)) common = common.parentElement;
  if (!common || common === frame || !frame.contains(common)) return ranked[0][0];
  return meaningful(common, frame) || common;
}

/** Description de l'élément visé, jointe au commentaire (voir targetOrNull dans core/schema.js). */
export function describeTarget(app, frame, el, area) {
  const box = frame.getBoundingClientRect();
  const round = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
  const target = { screen: app.currentScreenName(), context: '', path: '', label: '', role: 'zone', rect: null, area: round(area), frame: { w: Math.round(box.width), h: Math.round(box.height) } };
  if (!el) return target;
  const dialog = el.closest('.dialog');
  const sheet = el.closest('.sheet');
  if (dialog) target.context = `boîte de dialogue « ${clean(dialog.querySelector('h2')?.textContent)} »`;
  else if (sheet) target.context = `feuille « ${clean(sheet.querySelector('.sheet-head h2')?.textContent)} »`;
  else {
    const screen = el.closest('[data-screen]');
    if (screen) target.screen = screen.dataset.screen;
  }
  target.path = selectorPath(el, frame);
  target.label = labelOf(el);
  target.role = roleOf(el);
  const r = el.getBoundingClientRect();
  target.rect = round({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
  return target;
}

// ---------------------------------------------------------------------------------------------
// Le mode « entourer »
// ---------------------------------------------------------------------------------------------

function drawMarks(ctx, strokes, tap) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 3;
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  if (tap && tap.rect) {
    const { x, y, w, h: height } = tap.rect;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 4, y - 4, w + 8, height + 8, 10);
    else ctx.rect(x - 4, y - 4, w + 8, height + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function regionOf(strokes, tap) {
  if (tap && tap.rect && !strokes.length) return tap.rect;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x);
      y2 = Math.max(y2, p.y);
    }
  }
  if (tap && tap.rect) {
    x1 = Math.min(x1, tap.rect.x);
    y1 = Math.min(y1, tap.rect.y);
    x2 = Math.max(x2, tap.rect.x + tap.rect.w);
    y2 = Math.max(y2, tap.rect.y + tap.rect.h);
  }
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

let active = false;

/** Ouvre le mode « entourer » par-dessus l'écran. */
export function startAnnotation(app, frame, { button = null } = {}) {
  if (active) return;
  active = true;
  const strokes = [];
  let tap = null;
  let current = null;
  const canvas = h('canvas.annotate-canvas', { 'aria-hidden': 'true' });
  const cancel = h('button.btn.small.quiet', { type: 'button', dataset: { action: 'annotate-cancel' } }, 'Annuler');
  const erase = h('button.btn.small', { type: 'button', dataset: { action: 'annotate-clear' }, disabled: true }, 'Effacer');
  const next = h('button.btn.small.primary', { type: 'button', dataset: { action: 'annotate-next' }, disabled: true }, 'Continuer');
  const bar = h('div.annotate-bar', h('span.grow', 'Entoure ce que tu veux commenter, ou touche-le.'), cancel, erase, next);
  const layer = h('div.annotate-layer', { [SKIP_ATTR]: 'skip', role: 'dialog', 'aria-label': 'Entoure la zone à commenter' }, canvas, bar);
  frame.appendChild(layer);
  const box = () => frame.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(frame.clientWidth * dpr);
  canvas.height = Math.round(frame.clientHeight * dpr);
  const ctx = canvas.getContext('2d');

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMarks(ctx, current ? [...strokes, current] : strokes, tap);
    const empty = !strokes.length && !tap;
    erase.disabled = empty;
    next.disabled = empty;
  }

  const point = (event) => ({ x: event.clientX - box().left, y: event.clientY - box().top });
  canvas.addEventListener('pointerdown', (event) => {
    current = [point(event)];
    canvas.setPointerCapture(event.pointerId);
    // la barre se met de l'autre côté si on dessine dessous
    const y = current[0].y;
    if (y < 110) bar.classList.add('at-bottom');
    else if (y > frame.clientHeight - 110) bar.classList.remove('at-bottom');
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!current) return;
    current.push(point(event));
    redraw();
  });
  const end = () => {
    if (!current) return;
    const stroke = current;
    current = null;
    const xs = stroke.map((p) => p.x);
    const ys = stroke.map((p) => p.y);
    const span = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
    if (span < 10) {
      // simple toucher : on choisit l'élément sous le doigt et on l'encadre
      layer.style.pointerEvents = 'none';
      const el = pickElement(frame, { x: stroke[0].x - 1, y: stroke[0].y - 1, w: 2, h: 2 });
      layer.style.pointerEvents = '';
      if (el) {
        const r = el.getBoundingClientRect();
        tap = { x: stroke[0].x, y: stroke[0].y, rect: { x: r.left - box().left, y: r.top - box().top, w: r.width, h: r.height } };
      }
    } else strokes.push(stroke);
    redraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const close = () => {
    layer.remove();
    document.removeEventListener('keydown', onKey);
    if (app.viewerClose === close) app.viewerClose = null;
    active = false;
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  app.viewerClose = close; // le bouton « retour » du téléphone ferme ce mode
  cancel.addEventListener('click', close);
  erase.addEventListener('click', () => {
    strokes.length = 0;
    tap = null;
    redraw();
  });
  next.addEventListener('click', async () => {
    next.disabled = true;
    clear(next).appendChild(document.createTextNode('Capture…'));
    const area = regionOf(strokes, tap);
    // l'écran sous le calque : on le sonde, puis on le photographie (le calque n'y figure pas)
    layer.style.pointerEvents = 'none';
    layer.style.visibility = 'hidden';
    const element = pickElement(frame, area);
    const target = describeTarget(app, frame, element, area);
    const marks = (c) => drawMarks(c, strokes, tap);
    let masked = null;
    let plain = null;
    let failure = '';
    try {
      masked = await captureFrame({ frame, maskAmounts: true, draw: marks });
      plain = await captureFrame({ frame, maskAmounts: false, draw: marks });
    } catch (error) {
      failure = String(error?.message || error);
    }
    close();
    openAnnotationSheet(app, { target, masked, plain, failure, button });
  });
  redraw();
}

// ---------------------------------------------------------------------------------------------
// La feuille du commentaire
// ---------------------------------------------------------------------------------------------

function openAnnotationSheet(app, { target, masked, plain, failure, button }) {
  let kind = 'idee';
  let withCapture = !!masked;
  let showAmounts = false;
  let busy = false;
  const urls = [];
  const urlOf = (shot) => {
    const url = URL.createObjectURL(new Blob([shot.bytes], { type: 'image/png' }));
    urls.push(url);
    return url;
  };
  const maskedUrl = masked ? urlOf(masked) : null;
  const plainUrl = plain ? urlOf(plain) : null;
  const img = h('img', { alt: "Capture de l'écran, avec la zone entourée", src: maskedUrl || '' });
  const preview = h('figure.annotate-preview', { hidden: !masked, dataset: { block: 'capture' } }, img);
  const amounts = plain
    ? toggle({
        label: 'Montrer mes montants à Claude',
        hint: 'Sinon ils sont remplacés par ••• sur la capture.',
        checked: false,
        name: 'showAmounts',
        onChange: (value) => {
          showAmounts = value;
          img.src = value ? plainUrl : maskedUrl;
        },
      })
    : null;
  const remove = h('button.link-btn', { type: 'button', dataset: { action: 'remove-capture' }, hidden: !masked }, 'Ne pas joindre la capture');
  remove.addEventListener('click', () => {
    withCapture = false;
    preview.hidden = true;
    remove.hidden = true;
    if (amounts) amounts.el.hidden = true;
  });
  const kinds = segmented({ label: 'Type de commentaire', value: kind, options: COMMENT_KINDS.map((k) => ({ value: k.id, label: k.label })), onChange: (value) => (kind = value) });
  const text = textArea({ label: 'Ton commentaire', name: 'text', rows: 3, placeholder: 'Ex. : agrandir ce bouton, changer ce texte, ce total est faux…' });
  const connected = app.claude.connected;
  const send = h('button.btn.primary', { type: 'button', dataset: { action: 'send-annotation' } }, icon('send'), connected ? 'Envoyer à Claude' : 'Enregistrer');
  const sheet = openSheet({
    title: 'Commentaire pour Claude',
    full: true,
    body: h(
      'div.stack.loose',
      h('div.notice', { dataset: { value: 'target' } }, icon('target'), h('div.grow', h('b', 'Élément visé'), h('div', targetText(target)))),
      preview,
      failure ? h('p.hint', { dataset: { value: 'capture-failure' } }, `La capture de l'écran n'a pas pu être faite (${failure}). Le commentaire part quand même, avec la description de l'élément.`) : null,
      amounts ? amounts.el : null,
      remove,
      kinds.el,
      text.el,
      connected ? null : h('p.hint', "La connexion à Claude n'est pas réglée : le commentaire est gardé dans Plus › Commentaires pour Claude, d'où tu peux le partager."),
    ),
    foot: [send],
  });
  if (button) button.hidden = true;
  sheet.closed.then(() => {
    for (const url of urls) URL.revokeObjectURL(url);
    if (button) button.hidden = app.setting(AI_SETTING, true) === false;
  });
  requestAnimationFrame(() => text.focus());

  send.addEventListener('click', async () => {
    if (busy) return;
    if (!text.value) {
      text.setError('Écris ton commentaire en une phrase.');
      text.focus();
      return;
    }
    busy = true;
    send.disabled = true;
    try {
      const files = [];
      const shot = withCapture ? (showAmounts && plain ? plain : masked) : null;
      if (shot) files.push(await app.store.saveBlob(shot.bytes, { kind: 'bug', name: 'annotation.png', mime: 'image/png' }));
      const report = makeBugReport({
        kind,
        text: text.value,
        screen: target.screen,
        appVersion: app.version,
        device: deviceSummary(),
        diagnostics: await diagnosticsText(app),
        photoIds: files.map((f) => f.id),
        origin: 'annotation',
        target,
      });
      const draft = new Draft(app.state);
      for (const file of files) draft.put('files', file);
      draft.put('bugReports', report);
      if (!(await app.commit(draft.cs, { undoable: false }))) return;
      sheet.close();
      if (!connected) {
        toast('Commentaire enregistré dans Plus › Commentaires pour Claude');
        return;
      }
      const result = await app.claude.send(report.id);
      if (result.ok) toast('Envoyé à Claude : il s’en occupe.');
      else if (result.queued) toast('Pas de connexion pour le moment : ton commentaire partira tout seul.', { duration: 5000 });
      else toast(result.error, { bad: true, duration: 5000 });
    } finally {
      busy = false;
      send.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Le bouton
// ---------------------------------------------------------------------------------------------

/** Pose le bouton IA sur la frame. Renvoie { el, refresh() } ; refresh() l'affiche ou le cache selon le réglage. */
export function installAiButton(app, frame) {
  const button = h('button.ai-fab', { type: 'button', 'aria-label': "Bouton IA : entourer et commenter un endroit de l'appli", title: 'Entourer et commenter pour Claude', [SKIP_ATTR]: 'skip', dataset: { action: 'ai' } }, icon('sparkle'), h('span', 'IA'));
  try {
    const saved = Number(localStorage.getItem(POSITION_KEY));
    if (saved > 0.05 && saved < 0.9) button.style.top = `${saved * 100}%`;
    button.classList.toggle('left', localStorage.getItem(SIDE_KEY) === 'left');
  } catch {
    /* position par défaut */
  }
  frame.appendChild(button);

  // Glisser le long du bord pour le déplacer (ou vers l'autre bord) ; toucher pour commenter.
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startTop = 0;
  let dragging = false;
  button.addEventListener('pointerdown', (event) => {
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startTop = button.offsetTop;
    dragging = false;
    try {
      button.setPointerCapture(pointerId);
    } catch {
      /* sans importance */
    }
  });
  button.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    const dy = event.clientY - startY;
    if (!dragging && Math.max(Math.abs(dy), Math.abs(event.clientX - startX)) > 8) {
      dragging = true;
      button.classList.add('dragging');
    }
    if (!dragging) return;
    const height = frame.clientHeight;
    const top = Math.min(height * 0.86, Math.max(height * 0.08, startTop + dy));
    button.style.top = `${(top / height) * 100}%`;
    // passé le milieu de l'écran, l'onglet change de bord
    button.classList.toggle('left', event.clientX - frame.getBoundingClientRect().left < frame.clientWidth / 2);
  });
  button.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    if (dragging) {
      dragging = false;
      button.classList.remove('dragging');
      try {
        localStorage.setItem(POSITION_KEY, String(button.offsetTop / frame.clientHeight));
        localStorage.setItem(SIDE_KEY, button.classList.contains('left') ? 'left' : 'right');
      } catch {
        /* position oubliée au prochain lancement */
      }
      return;
    }
    startAnnotation(app, frame, { button });
  });
  button.addEventListener('pointercancel', () => {
    pointerId = null;
    dragging = false;
    button.classList.remove('dragging');
  });
  // au clavier (Entrée, Espace) : pas d'événement de pointeur
  button.addEventListener('click', (event) => {
    if (event.detail === 0) startAnnotation(app, frame, { button });
  });

  const refresh = () => {
    button.hidden = app.setting(AI_SETTING, true) === false;
  };
  refresh();
  return { el: button, refresh };
}
