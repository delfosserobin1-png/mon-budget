// Écran « Enveloppes » : une carte kraft par enveloppe (rabat + sceau de sa couleur).

import { h, s, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { infoButton } from '../overlays.js';
import { openEnvelopeForm } from '../forms/envelope.js';
import { computeBalances } from '../../core/balances.js';
import { envelopeReport } from '../../core/envelopes.js';
import { formatAmount } from '../../core/money.js';
import { formatDate } from '../../core/dates.js';

/** Le rabat de l'enveloppe : un « V » qui part des deux coins du haut. */
export function flap() {
  return s(
    'svg',
    { class: 'flap', viewBox: '0 0 100 40', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    s('path', { class: 'fill', d: 'M0 0 L100 0 L50 38 Z' }),
    s('path', { class: 'edge', d: 'M0 0 L50 38 L100 0' }),
  );
}

export function goalBlock(report) {
  if (!report.goal) return null;
  const { goal } = report;
  const percent = Math.round(goal.progress * 100);
  let right = '';
  if (goal.missing <= 0) right = 'Objectif atteint';
  else if (goal.perMonth) right = `${formatAmount(goal.perMonth)} par mois d'ici le ${formatDate(goal.date)}`;
  else if (goal.date) right = goal.date < report.today ? `Échéance dépassée (${formatDate(goal.date)})` : `Pour le ${formatDate(goal.date)}`;
  else right = `Il manque ${formatAmount(goal.missing)}`;
  return h(
    'div.goal',
    h('div.track', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent), 'aria-label': `Objectif atteint à ${percent} %` }, h('div.fill', { style: { width: `${percent}%` } })),
    h('div.legend', h('span', `${percent} % de ${formatAmount(goal.amount)}`), h('span', right)),
  );
}

export function createEnvelopesScreen(app) {
  let showClosed = false;
  const content = h('div');
  const scroll = h('main.scroll', content, h('div.bottom-space'));
  const el = h(
    'section.screen',
    { dataset: { screen: 'envelopes' } },
    h('header.topbar', h('h1', 'Enveloppes'), h('button.icon-btn', { type: 'button', 'aria-label': 'Nouvelle enveloppe', dataset: { action: 'add-envelope' }, onclick: () => create() }, icon('plus'))),
    scroll,
  );

  async function create() {
    const env = await openEnvelopeForm(app);
    if (env) app.open('envelope', { id: env.id });
  }

  function card(env, balance, today) {
    const report = { ...envelopeReport(app.state, env.id, { today }), today };
    const sub = env.closed ? `Clôturée${env.closedAt ? ` le ${formatDate(env.closedAt)}` : ''}` : env.description || (report.count ? plural(report.count, 'mouvement') : 'Vide pour l\'instant');
    const aside = report.spentThisMonth ? h('span.aside', `${formatAmount(report.spentThisMonth)} dépensés ce mois`) : null;
    return h(
      'button',
      { type: 'button', class: `env-card k-${env.color}${env.closed ? ' closed' : ''}`, dataset: { envelope: env.id }, onclick: () => app.open('envelope', { id: env.id }) },
      flap(),
      h('span.seal', { 'aria-hidden': 'true' }),
      h('span.name', env.name),
      h('span.sub', sub),
      h('span.figure', h('span', { class: balance < 0 ? 'amt alert' : 'amt' }, formatAmount(balance)), aside),
      env.closed ? null : goalBlock(report),
    );
  }

  function update() {
    const today = app.today();
    const b = computeBalances(app.state, { upTo: today });
    const open = app.state.envelopes.filter((e) => !e.closed);
    const closed = app.state.envelopes.filter((e) => e.closed);
    clear(content);

    if (!app.state.envelopes.length) {
      content.appendChild(
        h(
          'div.empty',
          h('div.empty-mark', icon('envelope', 'lg')),
          h('h2', 'Aucune enveloppe'),
          h('p', "Une enveloppe met de l'argent de côté pour un projet : vacances, voiture, cadeaux… Ce que tu y verses sort du compte courant, mais reste sur ton compte en banque."),
          h('button.btn.primary', { type: 'button', dataset: { action: 'create-first-envelope' }, onclick: () => create() }, icon('plus'), 'Créer une enveloppe'),
        ),
      );
      return;
    }

    content.appendChild(
      h(
        'div.env-total',
        h(
          'div',
          h('div.rowline', h('span.note', 'Dans les enveloppes'), infoButton('Enveloppes', "Le total de ce que tu as mis de côté. Cet argent est toujours sur ton compte en banque : il est simplement retiré du « compte courant » de l'appli pour ne pas être dépensé par erreur.")),
          h('span', { class: 'amt main', dataset: { value: 'envelopes-total' } }, formatAmount(b.envelopesTotal)),
        ),
        h('div.aside', 'Compte courant', h('span', { class: b.available < 0 ? 'amt alert' : 'amt' }, formatAmount(b.available))),
      ),
    );

    const grid = h('div.env-grid');
    for (const env of open) grid.appendChild(card(env, b.envelopes.get(env.id) || 0, today));
    if (!open.length) grid.appendChild(h('p.hint.center', 'Toutes les enveloppes sont clôturées.'));
    content.appendChild(grid);

    if (closed.length) {
      content.appendChild(
        h(
          'div.pad',
          h(
            'button.btn.quiet.block',
            {
              type: 'button',
              'aria-expanded': String(showClosed),
              dataset: { action: 'toggle-closed' },
              onclick: () => {
                showClosed = !showClosed;
                update();
              },
            },
            showClosed ? 'Masquer les enveloppes clôturées' : `Voir ${plural(closed.length, 'enveloppe clôturée', 'enveloppes clôturées')}`,
          ),
        ),
      );
      if (showClosed) {
        const closedGrid = h('div.env-grid');
        for (const env of closed) closedGrid.appendChild(card(env, b.envelopes.get(env.id) || 0, today));
        content.appendChild(closedGrid);
      }
    }
  }

  return { el, update };
}
