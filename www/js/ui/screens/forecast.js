// Écran « Prévisions » : simuler un solde futur (cocher / décocher des opérations prévues) et
// gérer les récurrences. Dans les deux listes, le plus proche dans le temps est en bas.

import { h, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { infoButton } from '../overlays.js';
import { dateField, segmented } from '../fields.js';
import { operationList } from '../oprow.js';
import { openOperationForm } from '../forms/operation.js';
import { openRecurringForm } from '../forms/recurring.js';
import { KIND, frequencyLabel } from '../../core/schema.js';
import { projectAvailable } from '../../core/balances.js';
import { planSetChecked } from '../../core/operations.js';
import { nextOccurrence, tick, HORIZON_DAYS } from '../../core/recurring.js';
import { isEmpty } from '../../core/changeset.js';
import { sortNewestFirst } from '../../core/filters.js';
import { formatAmount } from '../../core/money.js';
import { addDays, addMonths, endOfMonth, formatDate, formatMonthKey, monthKey } from '../../core/dates.js';

/** Montant mensuel moyen d'une règle (pour le résumé « par mois »). */
function monthlyAmount(rule) {
  const perYear = rule.frequency === 'weekly' ? 52 / rule.interval : rule.frequency === 'yearly' ? 1 / rule.interval : 12 / rule.interval;
  return Math.round((rule.amount * perYear) / 12);
}

export function createForecastScreen(app) {
  let view = 'simulation';
  let target = null; // date de la projection (par défaut : fin du mois)
  let targetChosen = false;
  let showBeyond = false;

  const tabs = segmented({
    label: 'Vue',
    value: view,
    options: [
      { value: 'simulation', label: 'Simulation' },
      { value: 'recurring', label: 'Récurrences' },
    ],
    onChange: (value) => {
      view = value;
      scroll.scrollTop = 0;
      update();
    },
  });
  const content = h('div');
  const scroll = h('main.scroll', h('div.pad', { style: { paddingBottom: '8px' } }, tabs.el), content, h('div.bottom-space'));
  const fabLabel = h('span');
  const fab = h('button.fab', { type: 'button', dataset: { action: 'add-forecast' }, onclick: () => add() }, icon('plus'), fabLabel);
  const el = h('section.screen', { dataset: { screen: 'forecast' } }, h('header.topbar', h('h1', 'Prévisions')), scroll, fab);

  function add() {
    if (view === 'recurring') openRecurringForm(app);
    else openOperationForm(app, { preset: { mode: 'expense', simulated: true, date: addDays(app.today(), 1), time: null } });
  }

  async function setTarget(date) {
    const today = app.today();
    if (!date || date < today) date = today;
    const max = addMonths(today, 24);
    if (date > max) date = max;
    target = date;
    targetChosen = true;
    // au-delà de l'horizon habituel, on prolonge les échéances des récurrences jusqu'à la date demandée
    if (date > addDays(today, HORIZON_DAYS)) {
      const cs = tick(app.state, { today, upTo: date });
      if (!isEmpty(cs)) {
        await app.commit(cs, { undoable: false });
        return; // l'enregistrement relance update()
      }
    }
    update();
  }

  function renderSimulation(today) {
    const state = app.state;
    if (!targetChosen || !target || target < today) target = endOfMonth(today) === today ? endOfMonth(addDays(today, 1)) : endOfMonth(today);
    const sims = state.operations.filter((op) => op.simulated);
    const projection = projectAvailable(state, { today, upTo: target });
    const change = projection.end - projection.start;

    const picker = dateField({ value: target, compact: true, min: today, max: addMonths(today, 24), label: 'Date de la projection', onChange: (value) => setTarget(value) });
    const card = h(
      'section.projection',
      { 'aria-label': 'Solde estimé' },
      infoButton('Solde estimé', "C'est ce que contiendrait ton compte courant à cette date si tout se passe comme prévu : les opérations réelles, plus les prévisions cochées ci-dessous (dont les échéances de tes récurrences).\n\nDécoche une ligne pour voir ce que ça changerait. Rien de tout cela ne touche à ton solde réel."),
      h('div.when', 'Compte courant estimé au', h('span.date-pill', picker.el)),
      h('span', { class: projection.end < 0 ? 'big num alert' : 'big num', dataset: { value: 'projected' } }, formatAmount(projection.end)),
      h(
        'div.rows',
        h('div.kv', h('span.k', "Aujourd'hui"), h('span.v.num', formatAmount(projection.start))),
        h('div.kv', h('span.k', "D'ici là"), h('span.v.num', formatAmount(change, { sign: 'always' }))),
        h('div.kv', h('span.k', 'Solde total estimé'), h('span.v.num', formatAmount(projection.totalEnd))),
      ),
    );
    content.appendChild(card);
    const quick = h('div.filter-line');
    const presets = [
      ['Fin du mois', endOfMonth(today)],
      ['Dans 30 jours', addDays(today, 30)],
      ['Dans 3 mois', addMonths(today, 3)],
      ['Dans 6 mois', addMonths(today, 6)],
    ];
    for (const [label, date] of presets) {
      quick.appendChild(h('button', { type: 'button', class: 'pick', 'aria-pressed': String(date === target), onclick: () => setTarget(date) }, label));
    }
    content.appendChild(quick);

    if (projection.low.amount < 0 && projection.low.date > today) {
      content.appendChild(
        h('div.pad', { style: { paddingTop: '0' } }, h('div.notice.bad', icon('alert'), h('div.grow', `Le compte courant passerait en négatif le ${formatDate(projection.low.date)} (${formatAmount(projection.low.amount)}).`))),
      );
    }

    if (!sims.length) {
      content.appendChild(
        h(
          'div.empty',
          h('div.empty-mark', icon('calendar', 'lg')),
          h('h2', 'Rien de prévu'),
          h('p', "Ajoute une sortie ou une entrée que tu envisages avec le bouton +, ou crée une récurrence (loyer, salaire…) : ses échéances à venir s'afficheront ici."),
        ),
      );
      return;
    }

    const allChecked = sims.every((op) => op.checked);
    const noneChecked = sims.every((op) => !op.checked);
    content.appendChild(
      h(
        'div.rowline.between',
        { style: { padding: '4px 16px 8px' } },
        h('span.hint', plural(sims.length, 'prévision')),
        h(
          'div.rowline',
          h('button.btn.small', { type: 'button', dataset: { action: 'check-all' }, disabled: allChecked ? true : null, onclick: () => app.run(planSetChecked(app.state, sims.map((o) => o.id), true), { label: 'Tout coché' }) }, 'Tout cocher'),
          h('button.btn.small', { type: 'button', dataset: { action: 'uncheck-all' }, disabled: noneChecked ? true : null, onclick: () => app.run(planSetChecked(app.state, sims.map((o) => o.id), false), { label: 'Tout décoché' }) }, 'Tout décocher'),
        ),
      ),
    );
    // Le plus lointain en haut, le plus proche en bas. Ce qui tombe après la date choisie est
    // affiché en retrait : ces lignes ne comptent pas dans l'estimation.
    const sorted = sortNewestFirst(sims);
    const beyond = sorted.filter((op) => op.date > target);
    const within = sorted.filter((op) => op.date <= target);
    const listOptions = {
      today,
      tick: true,
      group: (op) => (op.date < today ? 'Date passée : à confirmer ou à supprimer' : formatMonthKey(monthKey(op.date))),
      onTick: (op, checked) => app.run(planSetChecked(app.state, [op.id], checked), { undoable: false }),
      onOpen: (op) => openOperationForm(app, { id: op.id }),
    };
    // Ce qui tombe après la date choisie est replié par défaut : on voit d'abord ce qui compte.
    if (beyond.length) {
      content.appendChild(
        h(
          'button.btn.quiet.block',
          {
            type: 'button',
            dataset: { action: 'toggle-beyond' },
            'aria-expanded': String(showBeyond),
            onclick: () => {
              showBeyond = !showBeyond;
              update();
            },
          },
          showBeyond ? `Masquer les prévisions après le ${formatDate(target)}` : `Voir aussi ${plural(beyond.length, 'prévision')} après le ${formatDate(target)}`,
        ),
      );
      if (showBeyond) {
        content.appendChild(h('div.beyond', operationList(app, beyond, listOptions)));
        content.appendChild(h('div.list-note', `Au-dessus : après le ${formatDate(target)}, pas compté dans l'estimation.`));
      }
    }
    if (within.length) content.appendChild(operationList(app, within, listOptions));
    else content.appendChild(h('div.list-note', `Rien de prévu d'ici le ${formatDate(target)}.`));
  }

  function renderRecurring(today) {
    const state = app.state;
    const rules = state.recurring;
    if (!rules.length) {
      content.appendChild(
        h(
          'div.empty',
          h('div.empty-mark', icon('repeat', 'lg')),
          h('h2', 'Aucune récurrence'),
          h('p', 'Loyer, salaire, abonnements, épargne mensuelle vers une enveloppe… Saisis-les une fois : les opérations se créent ensuite toutes seules, à la bonne date.'),
          h('button.btn.primary', { type: 'button', dataset: { action: 'create-first-recurring' }, onclick: () => openRecurringForm(app) }, icon('plus'), 'Créer une récurrence'),
        ),
      );
      return;
    }
    let income = 0;
    let expense = 0;
    let saving = 0;
    for (const rule of rules) {
      if (!rule.active || !nextOccurrence(rule, today)) continue;
      const monthly = monthlyAmount(rule);
      if (rule.kind === KIND.TRANSFER) {
        if (rule.from === null) saving += monthly;
        else if (rule.to === null) saving -= monthly;
      } else if (monthly > 0) income += monthly;
      else expense += -monthly;
    }
    content.appendChild(
      h(
        'div.pad',
        { style: { paddingTop: '4px' } },
        h(
          'div.tiles',
          h('div.tile', h('div.label', 'Entrées régulières'), h('span.value.num.pos', formatAmount(income)), h('div.delta', 'par mois, en moyenne')),
          h('div.tile', h('div.label', 'Sorties régulières'), h('span.value.num', formatAmount(expense)), h('div.delta', 'par mois, en moyenne')),
          saving ? h('div.tile.wide', h('div.label', 'Mis de côté dans les enveloppes'), h('span.value.num', formatAmount(saving)), h('div.delta', 'par mois, en moyenne')) : null,
        ),
      ),
    );

    // la prochaine échéance la plus proche en bas ; les règles en pause ou terminées tout en haut
    const rows = rules
      .map((rule) => ({ rule, next: rule.active ? nextOccurrence(rule, today) : null }))
      .sort((a, b) => {
        if (!a.next && !b.next) return a.rule.label.localeCompare(b.rule.label, 'fr');
        if (!a.next) return -1;
        if (!b.next) return 1;
        return a.next < b.next ? 1 : a.next > b.next ? -1 : 0;
      });
    const list = h('div.menu', { style: { margin: '0 16px' } });
    for (const { rule, next } of rows) {
      const isTransfer = rule.kind === KIND.TRANSFER;
      let status = frequencyLabel(rule.frequency, rule.interval);
      if (next) status += `, prochaine le ${formatDate(next)}`;
      else status += rule.active ? ', terminée' : ', en pause';
      list.appendChild(
        h(
          'button.menu-item',
          { type: 'button', dataset: { rule: rule.id }, onclick: () => openRecurringForm(app, { id: rule.id }) },
          icon(!rule.active ? 'pause' : isTransfer ? 'transfer' : 'repeat'),
          h('span.texts', h('b', rule.label), h('span', status)),
          h('span', { class: isTransfer ? 'amt quiet' : rule.amount > 0 ? 'amt pos' : 'amt' }, formatAmount(rule.amount, { sign: isTransfer ? 'never' : 'always' })),
        ),
      );
    }
    content.appendChild(list);
  }

  function update() {
    const today = app.today();
    clear(content);
    clear(fabLabel).appendChild(document.createTextNode(view === 'recurring' ? 'Récurrence' : 'Prévision'));
    if (view === 'simulation') renderSimulation(today);
    else renderRecurring(today);
  }

  return {
    el,
    update,
    setParams(params) {
      if (params.view) {
        view = params.view;
        tabs.value = view;
      }
    },
  };
}
