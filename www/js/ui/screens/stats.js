// Écran « Stats » : où part l'argent, comment évoluent les soldes.
// Une seule ligne de filtres en haut (période + périmètre) : tous les graphiques en dépendent,
// pour que les chiffres soient toujours comparables entre eux.

import { h, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { selectField } from '../fields.js';
import { chartCard, columnChart, heatCalendar, hideChartTooltip, legend, lineChart, rankedBars, segmentedBar } from '../charts/charts.js';
import * as stats from '../../core/stats.js';
import { emptyFilter } from '../../core/filters.js';
import { formatAmount } from '../../core/money.js';
import { addMonths, daysInMonth, endOfMonth, formatDate, makeISO, monthKey, monthName, monthRange, parts, weekday } from '../../core/dates.js';

const IMPORTANCE_STYLE = {
  necessite: { color: 'var(--viz-ord-1)', text: 'var(--viz-ord-1-t)' },
  confort: { color: 'var(--viz-ord-2)', text: 'var(--viz-ord-2-t)' },
  caprice: { color: 'var(--viz-ord-3)', text: 'var(--viz-ord-3-t)' },
  none: { color: 'var(--viz-none)', text: 'var(--viz-none-t)' },
};

export function createStatsScreen(app) {
  let periodId = 'month';
  let scope = 'all';
  let heatMonth = null; // "AAAA-MM" affiché dans le calendrier

  const periodLine = h('div.filter-line', { role: 'group', 'aria-label': 'Période' });
  const scopeHost = h('div', { style: { padding: '0 16px 10px' } });
  const content = h('div.pad.stack', { style: { paddingTop: '4px' } });
  const scroll = h('main.scroll', periodLine, scopeHost, content, h('div.bottom-space'));
  const el = h('section.screen', { dataset: { screen: 'stats' } }, h('header.topbar', h('h1', 'Stats')), scroll);
  scroll.addEventListener('scroll', hideChartTooltip, { passive: true });
  let pendingDraws = [];
  window.addEventListener('resize', () => {
    if (!el.hidden) for (const draw of pendingDraws) draw();
  });

  function openOperations(filter) {
    hideChartTooltip();
    app.go('operations', { filter: { ...emptyFilter(), ...filter } });
  }

  function delta(current, previous, { upIsGood, partial = false }) {
    const change = stats.variation(current, previous);
    if (change === null) return null;
    const percent = Math.round(Math.abs(change) * 100);
    // période en cours : la comparaison porte sur la même durée de la période d'avant
    const versus = partial ? "qu'à la même date de la période précédente" : 'que la période précédente';
    if (percent === 0) return h('div.delta', partial ? 'Comme à la même date de la période précédente' : 'Comme la période précédente');
    const up = change > 0;
    const good = up === upIsGood;
    return h('div', { class: good ? 'delta good' : 'delta bad' }, icon(up ? 'arrowUp' : 'arrowDown'), `${percent} % ${up ? 'de plus' : 'de moins'} ${versus}`);
  }

  function update() {
    const today = app.today();
    const state = app.state;
    hideChartTooltip();
    pendingDraws = [];

    // --- filtres ---
    const presets = stats.periodPresets(today);
    clear(periodLine);
    for (const preset of presets) {
      periodLine.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: 'pick',
            'aria-pressed': String(preset.id === periodId),
            dataset: { period: preset.id },
            onclick: () => {
              periodId = preset.id;
              heatMonth = null;
              scroll.scrollTop = 0;
              update();
            },
          },
          preset.label,
        ),
      );
    }
    clear(scopeHost);
    if (state.envelopes.length) {
      if (scope !== 'all' && scope !== 'available' && !state.envelopes.some((e) => e.id === scope)) scope = 'all';
      const select = selectField({
        label: 'Dépenses et revenus de',
        value: scope,
        name: 'scope',
        options: [{ value: 'all', label: 'Tout (compte courant et enveloppes)' }, { value: 'available', label: 'Compte courant seulement' }, ...state.envelopes.map((e) => ({ value: e.id, label: `Enveloppe « ${e.name} »` }))],
        onChange: (value) => {
          scope = value;
          update();
        },
      });
      scopeHost.appendChild(select.el);
    } else scope = 'all';

    const preset = presets.find((p) => p.id === periodId) || presets[0];
    const range = { ...stats.resolveRange(state, preset, today), today, scope };
    const custom = { period: 'custom', from: range.from, to: range.to < today ? range.to : today, account: scope };
    clear(content);

    const hasData = state.operations.some((op) => !op.simulated);
    if (!hasData) {
      content.appendChild(
        h('div.empty', h('div.empty-mark', icon('stats', 'lg')), h('h2', 'Pas encore de chiffres'), h('p', 'Les statistiques apparaîtront dès tes premières opérations.')),
      );
      return;
    }

    // --- résumé ---
    const summary = stats.summarize(state, range);
    const tiles = h('div.tiles');
    tiles.appendChild(
      h('div.tile', { dataset: { tile: 'expense' } }, h('div.label', 'Dépenses'), h('span.value', formatAmount(summary.expense)), summary.previous ? delta(summary.expense, summary.previous.expense, { upIsGood: false, partial: summary.partial }) : null),
    );
    tiles.appendChild(
      h('div.tile', { dataset: { tile: 'income' } }, h('div.label', 'Revenus'), h('span.value', formatAmount(summary.income)), summary.previous ? delta(summary.income, summary.previous.income, { upIsGood: true, partial: summary.partial }) : null),
    );
    tiles.appendChild(
      h(
        'div.tile',
        { dataset: { tile: 'net' } },
        h('div.label', 'Revenus moins dépenses'),
        h('span', { class: summary.net < 0 ? 'value alert' : summary.net > 0 ? 'value pos' : 'value' }, formatAmount(summary.net, { sign: 'always' })),
      ),
    );
    tiles.appendChild(h('div.tile', h('div.label', 'Dépense moyenne par jour'), h('span.value', formatAmount(summary.perDay)), h('div.delta', `sur ${plural(summary.days, 'jour')}`)));
    content.appendChild(tiles);
    if (summary.biggest) {
      content.appendChild(
        h(
          'button.menu-item',
          { type: 'button', class: 'card', style: { borderRadius: '14px', border: '1px solid var(--rule)' }, onclick: () => openOperations({ ...custom, query: '', minAmount: -summary.biggest.amount, maxAmount: -summary.biggest.amount, types: ['expense'] }) },
          icon('arrowUp'),
          h('span.texts', h('b', 'Plus grosse dépense'), h('span', `${summary.biggest.label || summary.biggest.counterparty || 'Sans libellé'}, le ${formatDate(summary.biggest.date)}`)),
          h('span.amt', formatAmount(-summary.biggest.amount)),
        ),
      );
    }

    // --- évolution des soldes ---
    const seriesRange = { from: range.from, to: range.to, today };
    let points = stats.balanceSeries(state, seriesRange);
    if (points.length > 400) {
      const step = Math.ceil(points.length / 200);
      points = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    }
    const withEnvelopes = state.envelopes.length > 0;
    const lineSeries = [{ label: 'Compte courant', color: 'var(--viz-1)' }];
    if (withEnvelopes) lineSeries.push({ label: 'Solde total', color: 'var(--viz-2)' });
    const line = lineChart({
      points: points.map((p) => ({ label: formatDate(p.date), projected: p.projected, values: withEnvelopes ? [p.available, p.total] : [p.available] })),
      series: lineSeries,
      marks: [
        { index: 0, label: formatDate(points[0].date).slice(0, 5) },
        { index: points.length - 1, label: formatDate(points[points.length - 1].date).slice(0, 5) },
      ],
    });
    const hasProjection = points.some((p) => p.projected);
    const lineLegend = [...lineSeries.map((x) => ({ label: x.label, color: x.color, kind: 'line' }))];
    if (hasProjection) lineLegend.push({ label: 'Estimation (prévisions cochées)', color: 'var(--ink-3)', kind: 'dash' });
    const sampled = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 12)) === 0 || i === points.length - 1);
    content.appendChild(
      chartCard({
        name: 'balances',
        title: 'Évolution des soldes',
        subtitle: `Du ${formatDate(range.from)} au ${formatDate(range.to)}`,
        body: h('div', line.el, withEnvelopes || hasProjection ? legend(lineLegend) : null),
        table: {
          columns: [{ label: 'Date' }, { label: 'Compte courant', numeric: true }, ...(withEnvelopes ? [{ label: 'Solde total', numeric: true }] : [])],
          rows: sampled.map((p) => [p.projected ? `${formatDate(p.date)} (estimé)` : formatDate(p.date), formatAmount(p.available), ...(withEnvelopes ? [formatAmount(p.total)] : [])]),
        },
      }),
    );
    pendingDraws.push(line.draw);

    // --- dépenses par tag ---
    const byTag = stats.expensesByTag(state, range);
    if (byTag.length) {
      const top = byTag.slice(0, 8);
      const rest = byTag.slice(8);
      const rows = top.map((t) => ({
        label: t.name,
        value: t.amount,
        share: t.share,
        dot: t.color,
        action: () => openOperations({ ...custom, types: ['expense'], ...(t.id ? { tags: [t.id] } : { untagged: true }) }),
      }));
      if (rest.length) rows.push({ label: `Autres (${rest.length} tags)`, value: rest.reduce((a, t) => a + t.amount, 0), share: rest.reduce((a, t) => a + t.share, 0) });
      content.appendChild(
        chartCard({
          name: 'tags',
          title: 'Dépenses par tag',
          subtitle: 'Une dépense qui porte plusieurs tags est partagée entre eux.',
          body: rankedBars(rows),
        }),
      );
    }

    // --- nécessité / confort / caprice ---
    const byImportance = stats.expensesByImportance(state, range);
    const months = stats.monthlySeries(state, range);
    if (summary.expense > 0) {
      const partsList = byImportance.map((row) => ({
        label: row.label,
        value: row.amount,
        color: IMPORTANCE_STYLE[row.id].color,
        text: IMPORTANCE_STYLE[row.id].text,
        action: row.amount ? () => openOperations({ ...custom, types: ['expense'], importance: [row.id] }) : null,
      }));
      const importanceLegend = legend(byImportance.map((row) => ({ label: `${row.label} ${formatAmount(row.amount)}`, color: IMPORTANCE_STYLE[row.id].color })));
      const body = h('div', segmentedBar(partsList), importanceLegend);
      if (months.length > 1) {
        const stacked = columnChart({
          mode: 'stacked',
          series: byImportance.map((row) => ({ label: row.label, color: IMPORTANCE_STYLE[row.id].color })),
          groups: months.map((m) => ({
            label: monthName(m.key, { short: true, year: false }),
            title: monthName(m.key),
            values: [m.importance.necessite, m.importance.confort, m.importance.caprice, m.importance.none],
            action: { label: 'Voir les dépenses du mois', run: () => openOperations({ period: 'custom', from: `${m.key}-01`, to: endOfMonth(`${m.key}-01`), account: scope, types: ['expense'] }) },
          })),
        });
        body.appendChild(h('div', { style: { marginTop: '14px' } }, stacked.el));
        pendingDraws.push(stacked.draw);
      }
      content.appendChild(
        chartCard({
          name: 'importance',
          title: 'Nécessité, confort ou caprice',
          subtitle: 'Ce que tu aurais pu éviter, et ce que tu ne pouvais pas.',
          body,
          table: {
            columns: [{ label: 'Importance' }, { label: 'Montant', numeric: true }, { label: 'Part', numeric: true }],
            rows: byImportance.map((row) => [row.label, formatAmount(row.amount), `${Math.round(row.share * 100)} %`]),
          },
        }),
      );
    }

    // --- revenus et dépenses mois par mois ---
    if (months.length > 1) {
      const columns = columnChart({
        mode: 'grouped',
        series: [
          { label: 'Revenus', color: 'var(--viz-3)' },
          { label: 'Dépenses', color: 'var(--viz-1)' },
        ],
        groups: months.map((m) => ({
          label: monthName(m.key, { short: true, year: false }),
          title: monthName(m.key),
          values: [m.income, m.expense],
          extraRows: [{ label: 'Différence', value: formatAmount(m.net, { sign: 'always' }) }],
          action: { label: 'Voir les opérations du mois', run: () => openOperations({ period: 'custom', from: `${m.key}-01`, to: endOfMonth(`${m.key}-01`), account: scope, types: ['expense', 'income'] }) },
        })),
      });
      content.appendChild(
        chartCard({
          name: 'months',
          title: 'Revenus et dépenses, mois par mois',
          body: h('div', columns.el, legend([{ label: 'Revenus', color: 'var(--viz-3)' }, { label: 'Dépenses', color: 'var(--viz-1)' }])),
          table: {
            columns: [{ label: 'Mois' }, { label: 'Revenus', numeric: true }, { label: 'Dépenses', numeric: true }, { label: 'Différence', numeric: true }],
            rows: months.map((m) => [monthName(m.key), formatAmount(m.income), formatAmount(m.expense), formatAmount(m.net, { sign: 'always' })]),
          },
        }),
      );
      pendingDraws.push(columns.draw);
    }

    // --- par enveloppe ---
    if (state.envelopes.length && scope === 'all') {
      const byEnvelope = stats.expensesByEnvelope(state, range);
      if (byEnvelope.length > 1 || (byEnvelope.length === 1 && byEnvelope[0].id)) {
        content.appendChild(
          chartCard({
            name: 'envelopes',
            title: "D'où sortent les dépenses",
            body: rankedBars(byEnvelope.map((e) => ({ label: e.name, value: e.amount, share: e.share, dot: e.id ? e.color : null, action: () => openOperations({ ...custom, account: e.id || 'available', types: ['expense'] }) }))),
          }),
        );
      }
    }

    // --- principaux tiers ---
    const top = stats.topCounterparties(state, range, 6);
    if (top.length) {
      content.appendChild(
        chartCard({
          name: 'counterparties',
          title: 'Là où tu dépenses le plus',
          body: rankedBars(top.map((t) => ({ label: `${t.name}${t.count > 1 ? ` (${t.count} fois)` : ''}`, value: t.amount, action: () => openOperations({ ...custom, types: ['expense'], counterparty: t.name }) }))),
        }),
      );
    }

    // --- fixes / variables ---
    const fixed = stats.fixedVsVariable(state, range);
    if (fixed.total > 0 && fixed.fixed > 0) {
      const share = Math.round((fixed.fixed / fixed.total) * 100);
      content.appendChild(
        chartCard({
          name: 'fixed',
          title: 'Dépenses fixes et variables',
          subtitle: 'Fixes : celles qui viennent de tes récurrences (loyer, abonnements…).',
          body: h(
            'div',
            segmentedBar(
              [
                { label: 'Fixes', value: fixed.fixed, color: 'var(--viz-1)' },
                { label: 'Variables', value: fixed.variable, color: 'var(--viz-none)' },
              ],
              { tall: false },
            ),
            h('div.kv', { style: { borderTop: '0', paddingBottom: '2px' } }, h('span.k', `Fixes (${share} %)`), h('span.v.num', formatAmount(fixed.fixed))),
            h('div.kv', h('span.k', `Variables (${100 - share} %)`), h('span.v.num', formatAmount(fixed.variable))),
          ),
        }),
      );
    }

    // --- calendrier ---
    const lastDay = range.to < today ? range.to : today;
    const firstKey = monthKey(range.from);
    const lastKey = monthKey(lastDay < range.from ? range.from : lastDay);
    if (!heatMonth || heatMonth < firstKey || heatMonth > lastKey) heatMonth = lastKey;
    const keys = monthRange(firstKey, lastKey);
    const { year, month } = parts(`${heatMonth}-01`);
    const daily = stats.dailyExpenses(state, { ...range, from: `${heatMonth}-01`, to: endOfMonth(`${heatMonth}-01`) });
    const days = [];
    for (let d = 1; d <= daysInMonth(year, month); d++) {
      const date = makeISO(year, month, d);
      const value = daily.get(date) || 0;
      days.push({ date, day: d, value, label: formatDate(date), action: value ? () => openOperations({ period: 'custom', from: date, to: date, account: scope, types: ['expense'] }) : null });
    }
    const monthTotal = days.reduce((a, d) => a + d.value, 0);
    const nav = (step, label, iconName) => {
      const target = monthKey(addMonths(`${heatMonth}-01`, step));
      return h(
        'button.icon-btn',
        {
          type: 'button',
          'aria-label': label,
          disabled: keys.includes(target) ? null : true,
          style: keys.includes(target) ? null : { opacity: '0.3' },
          onclick: () => {
            heatMonth = target;
            update();
          },
        },
        icon(iconName),
      );
    };
    content.appendChild(
      chartCard({
        name: 'calendar',
        title: 'Calendrier des dépenses',
        body: h(
          'div',
          h('div.rowline.between', { style: { marginBottom: '6px' } }, nav(-1, 'Mois précédent', 'back'), h('div.center', h('div.strong', monthName(heatMonth)), h('div.hint', `${formatAmount(monthTotal)} dépensés`)), nav(1, 'Mois suivant', 'right')),
          heatCalendar({ days, offset: (weekday(`${heatMonth}-01`) + 6) % 7 }),
        ),
        table: {
          columns: [{ label: 'Jour' }, { label: 'Dépensé', numeric: true }],
          rows: days.filter((d) => d.value).map((d) => [d.label, formatAmount(d.value)]),
        },
      }),
    );

    // --- écarts avec la banque ---
    const checks = stats.reconciliationSeries(state).slice(-6).reverse();
    if (checks.length) {
      content.appendChild(
        chartCard({
          name: 'reconciliations',
          title: 'Écarts avec la banque',
          subtitle: 'Lors de tes derniers rapprochements.',
          body: h(
            'div',
            checks.map((r) =>
              h(
                'div.kv',
                h('span.k', formatDate(r.date)),
                h('span.v', r.gap === 0 ? h('span.chip.good', icon('check', 'sm'), 'Aucun écart') : h('span.num', formatAmount(r.gap, { sign: 'always' }), r.adjustmentOperationId ? h('span.hint', ' ajusté') : null)),
              ),
            ),
            h('button.btn.quiet.block', { type: 'button', style: { marginTop: '6px' }, onclick: () => app.open('reconcile') }, 'Faire un rapprochement'),
          ),
        }),
      );
    }

    // les graphiques SVG se dessinent une fois en place, pour connaître la largeur disponible
    for (const draw of pendingDraws) draw();
  }

  return { el, update };
}
