// Écran « Opérations » : les soldes, la recherche, les filtres et la liste (le plus récent en haut,
// le plus ancien en bas), avec sélection multiple.

import { h, clear, amount, bigAmount, plural, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { infoButton, confirmDialog, chooseDialog } from '../overlays.js';
import { operationList } from '../oprow.js';
import { openOperationForm } from '../forms/operation.js';
import { openFilterSheet } from '../forms/filters.js';
import { computeBalances } from '../../core/balances.js';
import { emptyFilter, filterOperations, sortNewestFirst, describeFilter, activeCount, isFilterActive, listTotal } from '../../core/filters.js';
import { planAddTag, planDeleteOperations, planSetEnvelope, topupChangeset } from '../../core/operations.js';
import { merge } from '../../core/changeset.js';
import { confirmTopups } from '../topups.js';
import { formatAmount } from '../../core/money.js';

const PAGE = 150;

export const HELP = {
  available: {
    title: 'Compte courant',
    text: "C'est l'argent réellement disponible : ce qu'il y a sur ton compte, moins ce que tu as mis de côté dans tes enveloppes.\n\nMettre 500 € dans une enveloppe fait baisser le compte courant de 500 €, sans rien changer au solde total.",
  },
  total: {
    title: 'Solde total',
    text: "Compte courant + contenu de toutes les enveloppes. C'est le montant que ta banque affiche : elle ne connaît pas tes enveloppes, qui n'existent que dans l'appli.",
  },
};

export function createOperationsScreen(app) {
  let filter = emptyFilter();
  let searchOpen = false;
  let limit = PAGE;
  let selecting = false;
  const selection = new Set();

  const balancesEl = h('section.balances', { 'aria-label': 'Soldes' });
  const searchInput = h('input', { type: 'search', placeholder: 'Rechercher un libellé, un tiers, un montant…', 'aria-label': 'Rechercher', autocomplete: 'off', enterkeyhint: 'search' });
  const searchBox = h('div.search', { hidden: true }, icon('search'), searchInput, h('button.icon-btn', { type: 'button', 'aria-label': 'Fermer la recherche', onclick: () => closeSearch() }, icon('x')));
  const filterLine = h('div.filter-line', { hidden: true });
  const resultLine = h('div.result-line', { hidden: true });
  const listHost = h('div');
  const demoBanner = h(
    'div.pad',
    { hidden: true, style: { paddingTop: '0' } },
    h(
      'div.notice',
      icon('book'),
      h('div.grow', "Tu regardes des données d'exemple."),
      h(
        'button.link-btn',
        {
          type: 'button',
          dataset: { action: 'leave-demo' },
          onclick: async () => {
            const ok = await confirmDialog({ title: "Effacer les données d'exemple ?", message: "L'appli repart de zéro, prête pour tes vrais comptes.", confirmLabel: 'Effacer et commencer' });
            if (ok) app.startOver();
          },
        },
        'Effacer',
      ),
    ),
  );
  const scroll = h('main.scroll', balancesEl, demoBanner, searchBox, filterLine, resultLine, listHost, h('div.bottom-space'));

  const filterBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Filtrer', dataset: { action: 'filters' }, onclick: () => openFilters() }, icon('filter'));
  const topbar = h(
    'header.topbar',
    h('h1', 'Opérations'),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Rechercher', dataset: { action: 'search' }, onclick: () => openSearch() }, icon('search')),
    filterBtn,
    h('button.icon-btn', { type: 'button', 'aria-label': 'Sélectionner plusieurs opérations', dataset: { action: 'select' }, onclick: () => startSelecting() }, icon('select')),
  );
  const selectCount = h('span.count');
  const selectBar = h(
    'header.select-bar',
    { hidden: true },
    h('button.icon-btn', { type: 'button', 'aria-label': 'Quitter la sélection', onclick: () => stopSelecting() }, icon('x')),
    selectCount,
    h('button.btn.small.quiet', { type: 'button', dataset: { action: 'select-all' }, onclick: () => toggleAll() }, 'Tout'),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Ranger la sélection dans une enveloppe', dataset: { action: 'envelope-selection' }, onclick: () => envelopeSelection() }, icon('envelope')),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Ajouter un tag à la sélection', dataset: { action: 'tag-selection' }, onclick: () => tagSelection() }, icon('tag')),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Supprimer la sélection', dataset: { action: 'delete-selection' }, onclick: () => deleteSelection() }, icon('trash')),
  );
  const fab = h('button.fab', { type: 'button', 'aria-label': 'Ajouter une opération', dataset: { action: 'add' }, onclick: () => openOperationForm(app) }, icon('plus', 'lg'));
  const el = h('section.screen', { dataset: { screen: 'operations' } }, topbar, selectBar, scroll, fab);

  let visibleOps = [];

  searchInput.addEventListener(
    'input',
    debounce(() => {
      filter = { ...filter, query: searchInput.value };
      limit = PAGE;
      update();
    }, 120),
  );

  function openSearch() {
    searchOpen = true;
    searchBox.hidden = false;
    scroll.scrollTop = 0;
    searchInput.focus();
  }
  function closeSearch() {
    searchOpen = false;
    searchBox.hidden = true;
    searchInput.value = '';
    if (filter.query) {
      filter = { ...filter, query: '' };
      update();
    }
  }
  async function openFilters() {
    const next = await openFilterSheet(app, filter);
    if (!next) return;
    filter = { ...next, query: filter.query };
    limit = PAGE;
    scroll.scrollTop = 0;
    update();
  }

  function startSelecting(first = null) {
    selecting = true;
    selection.clear();
    if (first) selection.add(first.id);
    update();
  }
  function stopSelecting() {
    selecting = false;
    selection.clear();
    update();
  }
  function toggleAll() {
    if (selection.size === visibleOps.length) selection.clear();
    else for (const op of visibleOps) selection.add(op.id);
    update();
  }
  async function deleteSelection() {
    if (!selection.size) return;
    const n = selection.size;
    const ok = await confirmDialog({
      title: `Supprimer ${plural(n, 'opération')} ?`,
      message: 'Tu pourras annuler juste après avec le bouton « Annuler ».',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const plan = planDeleteOperations(app.state, [...selection], { today: app.today() });
    if (await app.run(plan, { label: `${plural(n, 'opération supprimée', 'opérations supprimées')}` })) stopSelecting();
  }
  // Ranger d'un coup plusieurs sorties dans une enveloppe (suite au commentaire n° 4), ou les en sortir.
  async function envelopeSelection() {
    if (!selection.size) return;
    const open = app.state.envelopes.filter((e) => !e.closed);
    if (!open.length) {
      app.notify("Crée d'abord une enveloppe (onglet Enveloppes).");
      return;
    }
    const choice = await chooseDialog({
      title: `Ranger ${plural(selection.size, 'opération')}`,
      message: 'Dans quelle enveloppe ? Seules les sorties sont rangées : une entrée reste sur le compte courant.',
      options: [...open.map((e) => ({ id: e.id, label: e.name })), { id: 'available', label: 'Compte courant (les sortir de leur enveloppe)' }],
    });
    if (!choice) return;
    const plan = planSetEnvelope(app.state, [...selection], choice === 'available' ? null : choice, { today: app.today() });
    if (!plan.ok) {
      app.fail(plan.errors[0].message);
      return;
    }
    if (plan.topups.length) {
      if (!(await confirmTopups(app, plan.topups))) return;
      merge(plan.cs, topupChangeset(app.state, plan.topups));
    }
    const where = choice === 'available' ? 'sur le compte courant' : `dans « ${open.find((e) => e.id === choice).name} »`;
    const label = `${plural(plan.moved, 'sortie rangée', 'sorties rangées')} ${where}`;
    if (await app.commit(plan.cs, { label })) {
      if (plan.skipped) app.notify(`${label} ; ${plural(plan.skipped, 'entrée laissée', 'entrées laissées')} sur le compte courant`);
      stopSelecting();
    }
  }

  async function tagSelection() {
    if (!selection.size) return;
    if (!app.state.tags.length) {
      app.notify("Crée d'abord un tag (dans une opération, ou dans Plus › Tags).");
      return;
    }
    const tagId = await chooseDialog({
      title: `Ajouter un tag à ${plural(selection.size, 'opération')}`,
      options: app.state.tags.slice(0, 12).map((t) => ({ id: t.id, label: t.name })),
    });
    if (!tagId) return;
    const plan = planAddTag(app.state, [...selection], tagId);
    if (await app.run(plan, { label: 'Tag ajouté' })) stopSelecting();
  }

  function renderBalances(today) {
    const b = computeBalances(app.state, { upTo: today });
    clear(balancesEl);
    balancesEl.appendChild(h('div.label', 'Compte courant', infoButton(HELP.available.title, HELP.available.text)));
    balancesEl.appendChild(h('div', { class: b.available < 0 ? 'balance-main num alert' : 'balance-main num', dataset: { value: 'available' } }, bigAmount(b.available)));
    const second = h('div.second');
    second.appendChild(h('span', 'Solde total ', h('span.amt', { dataset: { value: 'total' } }, formatAmount(b.total)), infoButton(HELP.total.title, HELP.total.text)));
    if (app.state.envelopes.length) {
      second.appendChild(
        h('button.link-btn', { type: 'button', onclick: () => app.go('envelopes') }, `dont ${formatAmount(b.envelopesTotal)} en enveloppes`),
      );
    }
    balancesEl.appendChild(second);
  }

  function update() {
    const today = app.today();
    const state = app.state;
    // des opérations sélectionnées ont pu disparaître entre-temps
    for (const id of [...selection]) if (!state.operations.some((o) => o.id === id)) selection.delete(id);

    topbar.hidden = selecting;
    selectBar.hidden = !selecting;
    fab.hidden = selecting;
    clear(selectCount).appendChild(document.createTextNode(selection.size ? plural(selection.size, 'sélectionnée') : 'Touche les opérations à sélectionner'));

    renderBalances(today);
    demoBanner.hidden = !app.setting('demo');

    const real = state.operations.filter((op) => !op.simulated);
    const filtered = sortNewestFirst(filterOperations(state, filter, { today, base: real }));
    visibleOps = filtered;
    const active = isFilterActive(filter);

    // bouton Filtres : pastille avec le nombre de critères
    const count = activeCount(filter);
    clear(filterBtn).appendChild(icon('filter'));
    if (count) filterBtn.appendChild(h('span.badge', String(count)));

    clear(filterLine);
    const labels = describeFilter(state, filter);
    filterLine.hidden = !labels.length;
    for (const label of labels) filterLine.appendChild(h('span.chip.plain', label));
    if (labels.length) {
      filterLine.appendChild(
        h(
          'button.link-btn',
          {
            type: 'button',
            dataset: { action: 'clear-filters' },
            onclick: () => {
              filter = { ...emptyFilter(), query: filter.query };
              update();
            },
          },
          'Tout effacer',
        ),
      );
    }

    clear(resultLine);
    resultLine.hidden = !active;
    if (active) {
      const perspective = filter.account === 'all' ? 'total' : filter.account === 'available' ? null : filter.account;
      const counted = filtered.filter((op) => op.date <= today);
      resultLine.appendChild(h('span', plural(filtered.length, 'opération')));
      resultLine.appendChild(h('span', 'Total ', amount(listTotal(counted, perspective), { sign: 'always' })));
    }

    clear(listHost);
    if (!real.length) {
      listHost.appendChild(
        h(
          'div.empty',
          h('div.empty-mark', icon('list', 'lg')),
          h('h2', 'Aucune opération pour l\'instant'),
          h('p', 'Ajoute ta première sortie ou ta première entrée avec le bouton +, ou importe un relevé de ta banque.'),
          h('button.btn', { type: 'button', onclick: () => app.open('statement') }, icon('bank'), 'Importer un relevé'),
        ),
      );
      return;
    }
    if (!filtered.length) {
      listHost.appendChild(
        h('div.empty', h('div.empty-mark', icon('search', 'lg')), h('h2', 'Aucun résultat'), h('p', 'Aucune opération ne correspond à cette recherche ou à ces filtres.')),
      );
      return;
    }
    const perspective = filter.account !== 'all' && filter.account !== 'available' ? filter.account : null;
    listHost.appendChild(
      operationList(app, filtered, {
        today,
        perspective,
        limit,
        selecting,
        selection,
        onMore: () => {
          limit += PAGE;
          update();
        },
        onOpen: (op) => openOperationForm(app, { id: op.id }),
        onToggle: (op) => {
          if (selection.has(op.id)) selection.delete(op.id);
          else selection.add(op.id);
          update();
        },
        onLongPress: (op) => startSelecting(op),
      }),
    );
  }

  return {
    el,
    update,
    /** Ouvre l'écran avec un filtre imposé (utilisé par les graphiques : « voir les opérations »). */
    setParams(params) {
      if (params.filter) {
        filter = { ...emptyFilter(), ...params.filter };
        searchInput.value = filter.query || '';
        searchOpen = !!filter.query;
        searchBox.hidden = !searchOpen;
        limit = PAGE;
        selecting = false;
        selection.clear();
        scroll.scrollTop = 0;
      }
    },
    handleBack() {
      if (selecting) {
        stopSelecting();
        return true;
      }
      if (searchOpen) {
        closeSearch();
        return true;
      }
      if (isFilterActive(filter)) {
        filter = emptyFilter();
        update();
        return true;
      }
      return false;
    },
  };
}
