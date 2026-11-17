// Feuille des filtres de la liste des opérations.

import { h, clear } from '../dom.js';
import { openSheet } from '../overlays.js';
import { amountField, dateField, pickList, selectField, toggle, fieldGroup } from '../fields.js';
import { IMPORTANCE } from '../../core/schema.js';
import { PERIODS, TYPES, emptyFilter } from '../../core/filters.js';
import { formatForInput } from '../../core/money.js';

/** Ouvre la feuille ; renvoie le nouveau filtre, ou null si l'utilisateur ferme sans appliquer. */
export function openFilterSheet(app, current) {
  const f = { ...emptyFilter(), ...current, types: [...current.types], tags: [...current.tags], importance: [...current.importance] };
  const body = h('div.stack.loose');
  const apply = h('button.btn.primary', { type: 'button', dataset: { action: 'apply-filters' } }, 'Appliquer');
  const reset = h('button.btn', { type: 'button', dataset: { action: 'reset-filters' } }, 'Tout effacer');
  const sheet = openSheet({ title: 'Filtrer les opérations', body, foot: [reset, apply], full: true });

  let fields = {};
  // les montants en cours de saisie survivent aux reconstructions de la feuille
  let minText = f.minAmount === null ? '' : formatForInput(f.minAmount);
  let maxText = f.maxAmount === null ? '' : formatForInput(f.maxAmount);
  function render() {
    clear(body);
    fields = {};
    const period = pickList({
      label: 'Période',
      options: PERIODS.map((p) => ({ id: p.id, label: p.label })),
      selected: [f.period],
      multiple: false,
      allowNone: false,
      onChange: ([id]) => {
        f.period = id || 'all';
        render();
      },
    });
    body.appendChild(fieldGroup('Période', period.el));
    if (f.period === 'custom') {
      fields.from = dateField({ label: 'Du', value: f.from, optional: true, onChange: (v) => (f.from = v) });
      fields.to = dateField({ label: 'Au', value: f.to, optional: true, onChange: (v) => (f.to = v) });
      body.appendChild(h('div.field-row', fields.from.el, fields.to.el));
    }

    const types = pickList({ label: 'Type', options: TYPES.map((t) => ({ id: t.id, label: t.label })), selected: f.types, onChange: (list) => (f.types = list) });
    body.appendChild(fieldGroup('Type', types.el));

    if (app.state.envelopes.length) {
      fields.account = selectField({
        label: 'Compte',
        value: f.account,
        options: [
          { value: 'all', label: 'Tous' },
          { value: 'available', label: 'Compte courant' },
          ...app.state.envelopes.map((e) => ({ value: e.id, label: e.closed ? `${e.name} (clôturée)` : e.name })),
        ],
        onChange: (v) => (f.account = v),
      });
      body.appendChild(fields.account.el);
    }

    if (app.state.tags.length) {
      const tags = pickList({
        label: 'Tags',
        options: [...app.state.tags.map((t) => ({ id: t.id, label: t.name, color: t.color })), { id: '__none', label: 'Sans tag' }],
        selected: [...f.tags, ...(f.untagged ? ['__none'] : [])],
        onChange: (list) => {
          f.untagged = list.includes('__none');
          f.tags = list.filter((id) => id !== '__none');
        },
      });
      body.appendChild(fieldGroup('Tags', tags.el));
    }

    const importance = pickList({
      label: 'Importance',
      options: [...IMPORTANCE.map((i) => ({ id: i.id, label: i.label })), { id: 'none', label: 'Non précisée' }],
      selected: f.importance,
      onChange: (list) => (f.importance = list),
    });
    body.appendChild(fieldGroup('Importance', importance.el));

    fields.min = amountField({ label: 'Montant minimum', optional: true, big: false, name: 'min', onInput: (text) => (minText = text) });
    fields.max = amountField({ label: 'Montant maximum', optional: true, big: false, name: 'max', onInput: (text) => (maxText = text) });
    fields.min.raw = minText;
    fields.max.raw = maxText;
    body.appendChild(h('div.field-row', fields.min.el, fields.max.el));

    const more = h('div.card.stack.tight');
    more.appendChild(toggle({ label: 'Avec photo', checked: f.withPhoto, onChange: (v) => (f.withPhoto = v) }).el);
    more.appendChild(
      toggle({ label: 'Non pointées', hint: "Opérations pas encore retrouvées sur un relevé de la banque.", checked: f.unpointed, onChange: (v) => (f.unpointed = v) }).el,
    );
    body.appendChild(more);
  }

  apply.addEventListener('click', () => {
    let ok = true;
    for (const key of ['min', 'max']) {
      const field = fields[key];
      if (!field.isEmpty && field.cents === null) {
        field.setError('Montant illisible. Exemple : 12,50');
        ok = false;
      }
    }
    if (!ok) return;
    f.minAmount = fields.min.cents;
    f.maxAmount = fields.max.cents;
    if (f.minAmount !== null && f.maxAmount !== null && f.minAmount > f.maxAmount) [f.minAmount, f.maxAmount] = [f.maxAmount, f.minAmount];
    if (f.period === 'custom' && f.from && f.to && f.from > f.to) [f.from, f.to] = [f.to, f.from];
    if (f.period === 'custom' && !f.from && !f.to) f.period = 'all';
    sheet.close({ ...f });
  });
  reset.addEventListener('click', () => sheet.close(emptyFilter()));

  render();
  return sheet.closed;
}
