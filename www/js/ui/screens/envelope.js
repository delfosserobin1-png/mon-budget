// Fiche d'une enveloppe : son solde, son objectif, ses mouvements, ce qui est prévu, son bilan.

import { h, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { subTopbar } from '../shell.js';
import { chooseDialog, confirmDialog } from '../overlays.js';
import { segmented } from '../fields.js';
import { operationList } from '../oprow.js';
import { flap, goalBlock } from './envelopes.js';
import { openOperationForm } from '../forms/operation.js';
import { openEnvelopeForm } from '../forms/envelope.js';
import { openRecurringForm } from '../forms/recurring.js';
import { KIND, frequencyLabel } from '../../core/schema.js';
import { envelopeBalance, touchesEnvelope, envelopeSpendable } from '../../core/balances.js';
import { envelopeReport, envelopeUsage, planCloseEnvelope, planReopenEnvelope, planDeleteEnvelope } from '../../core/envelopes.js';
import { planSetChecked } from '../../core/operations.js';
import { nextOccurrence, ruleTouchesEnvelope } from '../../core/recurring.js';
import { sortNewestFirst } from '../../core/filters.js';
import { formatAmount } from '../../core/money.js';
import { formatDate } from '../../core/dates.js';

const PAGE = 100;

export function createEnvelopeScreen(app, { id }) {
  let tab = 'operations';
  let limit = PAGE;
  const top = subTopbar(app, 'Enveloppe', h('button.icon-btn', { type: 'button', 'aria-label': "Actions sur l'enveloppe", dataset: { action: 'envelope-menu' }, onclick: () => menu() }, icon('dots')));
  const hero = h('div');
  const actions = h('div.quick-actions');
  const tabs = segmented({
    label: 'Contenu',
    value: tab,
    options: [
      { value: 'operations', label: 'Mouvements' },
      { value: 'upcoming', label: 'À venir' },
      { value: 'report', label: 'Bilan' },
    ],
    onChange: (value) => {
      tab = value;
      limit = PAGE;
      update();
    },
  });
  const content = h('div');
  const scroll = h('main.scroll', hero, actions, h('div.pad', tabs.el), content, h('div.bottom-space'));
  const el = h('section.screen', { dataset: { screen: 'envelope' } }, top.el, scroll);

  const env = () => app.state.envelopes.find((e) => e.id === id);

  async function menu() {
    const e = env();
    if (!e) return;
    const options = [{ id: 'edit', label: 'Modifier (nom, couleur, objectif)' }];
    if (!e.closed) {
      options.push({ id: 'recurring', label: 'Programmer une alimentation régulière' });
      options.push({ id: 'close', label: "Clôturer l'enveloppe" });
    } else options.push({ id: 'reopen', label: "Rouvrir l'enveloppe" });
    options.push({ id: 'delete', label: "Supprimer l'enveloppe", danger: true });
    const choice = await chooseDialog({ title: e.name, options, cancelLabel: 'Fermer' });
    if (choice === 'edit') openEnvelopeForm(app, { id });
    else if (choice === 'recurring') openRecurringForm(app, { preset: { mode: 'transfer', from: '', to: id, label: `Épargne ${e.name}` } });
    else if (choice === 'close') close();
    else if (choice === 'reopen') reopen();
    else if (choice === 'delete') remove();
  }

  async function close() {
    const e = env();
    const today = app.today();
    const plan = planCloseEnvelope(app.state, id, { today, sweep: true });
    if (!plan.ok) {
      app.fail(plan.errors[0].message);
      return;
    }
    const rules = app.state.recurring.filter((r) => r.active && ruleTouchesEnvelope(r, id)).length;
    const lines = [];
    if (plan.swept > 0) lines.push(`Les ${formatAmount(plan.swept)} restants retournent sur le compte courant.`);
    if (rules) lines.push(`${plural(rules, 'récurrence liée est mise', 'récurrences liées sont mises')} en pause.`);
    lines.push('Tu pourras la rouvrir à tout moment ; son historique et son bilan sont conservés.');
    const ok = await confirmDialog({ title: `Clôturer « ${e.name} » ?`, message: lines.join('\n'), confirmLabel: 'Clôturer' });
    if (ok) await app.run(plan, { label: 'Enveloppe clôturée' });
  }

  async function reopen() {
    const plan = planReopenEnvelope(app.state, id, { today: app.today() });
    if (await app.run(plan, { label: 'Enveloppe rouverte' })) {
      if (plan.resumed) app.notify(`${plural(plan.resumed, 'récurrence relancée', 'récurrences relancées')}`);
    }
  }

  async function remove() {
    const e = env();
    const usage = envelopeUsage(app.state, id);
    let mode = 'detach';
    if (usage.operations) {
      mode = await chooseDialog({
        title: `Supprimer « ${e.name} » ?`,
        message: `Elle contient ${plural(usage.operations, 'dépense')}. Ses alimentations et ses retraits disparaissent dans tous les cas.`,
        options: [
          { id: 'detach', label: 'Garder ses dépenses (elles passent sur le compte courant)', primary: true },
          { id: 'purge', label: 'Supprimer aussi ses dépenses', danger: true },
        ],
      });
      if (!mode) return;
    } else {
      const ok = await confirmDialog({
        title: `Supprimer « ${e.name} » ?`,
        message: usage.transfers ? "L'argent qu'elle contient revient sur le compte courant." : 'Elle est vide.',
        confirmLabel: 'Supprimer',
        danger: true,
      });
      if (!ok) return;
    }
    const plan = planDeleteEnvelope(app.state, id, mode, { today: app.today() });
    if (!plan.ok) {
      app.fail(plan.errors[0].message);
      return;
    }
    // on quitte la fiche d'abord : elle n'aura plus rien à afficher
    app.close();
    await app.commit(plan.cs, { label: 'Enveloppe supprimée' });
  }

  function quickAction(iconName, label, name, handler, disabled = false) {
    return h('button', { type: 'button', dataset: { action: name }, disabled: disabled ? true : null, onclick: handler }, icon(iconName), label);
  }

  function update() {
    const e = env();
    if (!e) {
      // enveloppe supprimée (ou suppression annulée puis refaite) : rien à montrer ici
      clear(hero);
      clear(actions);
      clear(content).appendChild(h('div.empty', h('h2', "Cette enveloppe n'existe plus"), h('button.btn', { type: 'button', onclick: () => app.close() }, 'Revenir aux enveloppes')));
      return;
    }
    const today = app.today();
    const state = app.state;
    clear(top.titleEl).appendChild(document.createTextNode(e.name));
    const balance = envelopeBalance(state, id, { upTo: today });
    const report = { ...envelopeReport(state, id, { today }), today };

    clear(hero).appendChild(
      h(
        'div',
        { class: `env-hero k-${e.color}` },
        flap(),
        h('span.seal', { 'aria-hidden': 'true' }),
        h('div.label', e.closed ? `Clôturée${e.closedAt ? ` le ${formatDate(e.closedAt)}` : ''}` : "Dans l'enveloppe"),
        h('span', { class: balance < 0 ? 'amt big alert' : 'amt big', dataset: { value: 'envelope-balance' } }, formatAmount(balance)),
        e.description ? h('p.desc', e.description) : null,
        e.closed ? null : goalBlock(report),
      ),
    );
    if (balance < 0) {
      hero.appendChild(h('div.pad', h('div.notice.bad', icon('alert'), h('div.grow', `Cette enveloppe est à découvert. Alimente-la d'au moins ${formatAmount(-balance)} pour la remettre à zéro.`))));
    }

    clear(actions);
    const others = state.envelopes.some((x) => !x.closed && x.id !== id);
    const spendable = envelopeSpendable(state, id, today, today);
    actions.hidden = e.closed;
    if (!e.closed) {
      actions.appendChild(quickAction('arrowDown', 'Alimenter', 'env-fund', () => openOperationForm(app, { preset: { mode: 'transfer', from: '', to: id } })));
      actions.appendChild(quickAction('arrowUp', 'Retirer', 'env-withdraw', () => openOperationForm(app, { preset: { mode: 'transfer', from: id, to: '' } }), spendable <= 0));
      actions.appendChild(quickAction('minus', 'Dépense', 'env-spend', () => openOperationForm(app, { preset: { mode: 'expense', envelopeId: id } })));
      actions.appendChild(
        quickAction('transfer', 'Vers une autre', 'env-move', () => openOperationForm(app, { preset: { mode: 'transfer', from: id, to: state.envelopes.find((x) => !x.closed && x.id !== id).id } }), !others || spendable <= 0),
      );
    } else {
      hero.appendChild(h('div.pad', h('button.btn.block', { type: 'button', dataset: { action: 'reopen' }, onclick: () => reopen() }, "Rouvrir l'enveloppe")));
    }

    clear(content);
    const touching = state.operations.filter((op) => touchesEnvelope(op, id));
    if (tab === 'operations') {
      const real = sortNewestFirst(touching.filter((op) => !op.simulated));
      if (!real.length) {
        content.appendChild(h('div.empty', h('p', "Aucun mouvement pour l'instant. Commence par « Alimenter » pour y verser de l'argent depuis le compte courant.")));
      } else {
        content.appendChild(
          operationList(app, real, {
            today,
            perspective: id,
            limit,
            onMore: () => {
              limit += PAGE;
              update();
            },
            onOpen: (op) => openOperationForm(app, { id: op.id }),
          }),
        );
      }
    } else if (tab === 'upcoming') {
      const planned = sortNewestFirst(touching.filter((op) => op.simulated));
      const rules = state.recurring.filter((r) => ruleTouchesEnvelope(r, id));
      if (!planned.length && !rules.length) {
        content.appendChild(h('div.empty', h('p', "Rien de prévu. Tu peux programmer une alimentation régulière de cette enveloppe depuis le menu en haut à droite.")));
      }
      if (rules.length) {
        const list = h('div.menu', { style: { margin: '0 16px 12px' } });
        for (const rule of rules) {
          const next = rule.active ? nextOccurrence(rule, today) : null;
          const signed = rule.kind === KIND.TRANSFER ? (rule.to === id ? rule.amount : -rule.amount) : rule.amount;
          list.appendChild(
            h(
              'button.menu-item',
              { type: 'button', dataset: { rule: rule.id }, onclick: () => openRecurringForm(app, { id: rule.id }) },
              icon(rule.active ? 'repeat' : 'pause'),
              h('span.texts', h('b', rule.label), h('span', `${frequencyLabel(rule.frequency, rule.interval)}${next ? `, prochaine le ${formatDate(next)}` : rule.active ? ', terminée' : ', en pause'}`)),
              h('span', { class: signed > 0 ? 'amt pos' : 'amt' }, formatAmount(signed, { sign: 'always' })),
            ),
          );
        }
        content.appendChild(list);
      }
      if (planned.length) {
        content.appendChild(
          operationList(app, planned, {
            today,
            perspective: id,
            tick: true,
            onTick: (op, checked) => app.run(planSetChecked(app.state, [op.id], checked), { undoable: false }),
            onOpen: (op) => openOperationForm(app, { id: op.id }),
          }),
        );
      }
    } else {
      const tiles = h('div.tiles');
      const tile = (label, cents, cls = '') => h('div.tile', h('div.label', label), h('span', { class: `value num ${cls}` }, formatAmount(cents)));
      tiles.appendChild(tile('Reçu', report.received));
      tiles.appendChild(tile('Dépensé', report.spent));
      if (report.sentBack) tiles.appendChild(tile('Rendu ou viré ailleurs', report.sentBack));
      if (report.refunded) tiles.appendChild(tile('Remboursé', report.refunded, 'pos'));
      const card = h('div.card', { style: { margin: '12px 0 0' } });
      const kv = (k, v) => h('div.kv', h('span.k', k), h('span.v', v));
      card.appendChild(kv('Mouvements', String(report.count)));
      if (report.firstDate) card.appendChild(kv('Premier mouvement', formatDate(report.firstDate)));
      if (report.lastDate) card.appendChild(kv('Dernier mouvement', formatDate(report.lastDate)));
      card.appendChild(kv('Solde actuel', formatAmount(report.balance)));
      const block = h('div.pad', tiles, card);
      if (report.byTag.size) {
        const total = [...report.byTag.values()].reduce((a, b) => a + b, 0);
        const bars = h('div.bars');
        for (const [tagId, cents] of [...report.byTag.entries()].sort((a, b) => b[1] - a[1])) {
          const tag = state.tags.find((t) => t.id === tagId);
          bars.appendChild(
            h(
              'div.bar-row',
              { class: tag ? `k-${tag.color}` : '' },
              h('span.name', h('span.dot'), h('span.text', tag ? tag.name : 'Sans tag')),
              h('span.value', formatAmount(cents), h('small', `${Math.round((cents / total) * 100)} %`)),
              h('span.track', h('i', { style: { width: `${Math.max(1, (cents / total) * 100)}%` } })),
            ),
          );
        }
        block.appendChild(h('div.chart-card', { style: { marginTop: '12px' } }, h('div.chart-head', h('h2', 'Dépenses par tag')), bars));
      }
      content.appendChild(block);
    }
  }

  return { el, update };
}
