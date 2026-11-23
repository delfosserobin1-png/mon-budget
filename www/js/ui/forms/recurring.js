// Formulaire d'une récurrence : sortie, entrée ou mise de côté (mouvement d'enveloppe) qui revient
// à intervalle fixe.

import { h, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { openSheet, chooseDialog } from '../overlays.js';
import { amountField, dateField, textField, textArea, selectField, segmented, pickList, toggle, fieldGroup } from '../fields.js';
import { KIND, IMPORTANCE, FREQUENCIES, frequencyLabel } from '../../core/schema.js';
import { planSaveRecurring, planDeleteRecurring, planSetRecurringActive, countBackfill, nextOccurrence } from '../../core/recurring.js';
import { formatDate } from '../../core/dates.js';
import { formatForInput } from '../../core/money.js';

/**
 * id : règle à modifier ; preset : valeurs de départ pour une création ({ mode, to, from, envelopeId… }).
 */
export function openRecurringForm(app, { id = null, preset = null } = {}) {
  const today = app.today();
  const existing = id ? app.state.recurring.find((r) => r.id === id) : null;
  if (id && !existing) {
    app.fail("Cette récurrence n'existe plus.");
    return Promise.resolve(null);
  }
  const f = existing
    ? {
        mode: existing.kind === KIND.TRANSFER ? 'transfer' : existing.amount < 0 ? 'expense' : 'income',
        amountText: formatForInput(existing.amount),
        label: existing.label,
        frequency: existing.frequency,
        interval: existing.interval,
        startDate: existing.startDate,
        endDate: existing.endDate,
        envelopeId: existing.envelopeId || '',
        from: existing.from || '',
        to: existing.to || '',
        tags: [...existing.tags],
        importance: existing.importance,
        counterparty: existing.counterparty,
        comment: existing.comment,
      }
    : { mode: 'expense', amountText: '', label: '', frequency: 'monthly', interval: 1, startDate: today, endDate: null, envelopeId: '', from: '', to: '', tags: [], importance: null, counterparty: '', comment: '', ...(preset || {}) };

  const body = h('div.stack.loose');
  const save = h('button.btn.primary', { type: 'button', dataset: { action: 'save' } }, 'Enregistrer');
  const foot = [];
  if (existing) foot.push(h('button.btn.danger.fixed', { type: 'button', 'aria-label': 'Supprimer la récurrence', dataset: { action: 'delete' }, onclick: () => remove() }, icon('trash')));
  foot.push(save);
  const sheet = openSheet({ title: existing ? 'Récurrence' : 'Nouvelle récurrence', body, foot, full: true });
  const fields = {};

  const envelopeOptions = (currentId) => app.state.envelopes.filter((e) => !e.closed || e.id === currentId).map((e) => ({ value: e.id, label: e.name }));

  function render() {
    const top = sheet.body.scrollTop;
    clear(body);
    for (const key of Object.keys(fields)) delete fields[key];

    if (existing) {
      const next = existing.active ? nextOccurrence(existing, today) : null;
      const paused = toggle({
        label: 'Active',
        hint: existing.active ? (next ? `Prochaine échéance le ${formatDate(next)}` : 'Terminée : plus aucune échéance à venir') : 'En pause : aucune échéance à venir.',
        checked: existing.active,
        name: 'active',
        onChange: async (value) => {
          const plan = planSetRecurringActive(app.state, existing.id, value, { today });
          if (await app.run(plan, { label: value ? 'Récurrence relancée' : 'Récurrence mise en pause' })) sheet.close();
          else paused.value = !value;
        },
      });
      body.appendChild(h('div.card', paused.el));
    } else {
      const seg = segmented({
        label: 'Type',
        value: f.mode,
        options: [
          { value: 'expense', label: 'Sortie' },
          { value: 'income', label: 'Entrée' },
          { value: 'transfer', label: 'Mise de côté' },
        ],
        onChange: (mode) => {
          f.mode = mode;
          render();
        },
      });
      body.appendChild(seg.el);
    }

    fields.amount = amountField({ label: 'Montant de chaque échéance', onInput: (text) => (f.amountText = text) });
    fields.amount.raw = f.amountText;
    body.appendChild(fields.amount.el);

    fields.label = textField({ label: 'Nom', value: f.label, name: 'label', placeholder: 'Loyer, salaire, abonnement…', onInput: (v) => (f.label = v) });
    body.appendChild(fields.label.el);

    const unit = FREQUENCIES.find((x) => x.id === f.frequency);
    fields.frequency = selectField({
      label: 'Fréquence',
      value: f.frequency,
      options: FREQUENCIES.map((x) => ({ value: x.id, label: x.every })),
      onChange: (v) => {
        f.frequency = v;
        render();
      },
    });
    const steps = [1, 2, 3, 4, 6, 12];
    if (!steps.includes(f.interval)) steps.push(f.interval);
    fields.interval = selectField({
      label: 'Intervalle',
      value: String(f.interval),
      options: steps.sort((a, b) => a - b).map((n) => ({ value: String(n), label: n === 1 ? unit.every : frequencyLabel(f.frequency, n) })),
      onChange: (v) => (f.interval = Number(v)),
    });
    body.appendChild(h('div.field-row', fields.frequency.el, fields.interval.el));

    fields.startDate = dateField({ label: 'Première échéance', value: f.startDate, name: 'startDate', onChange: (v) => (f.startDate = v) });
    fields.endDate = dateField({ label: 'Dernière échéance', value: f.endDate, optional: 'f', name: 'endDate', onChange: (v) => (f.endDate = v) });
    body.appendChild(h('div.field-row', fields.startDate.el, fields.endDate.el));

    if (f.mode === 'transfer') {
      const accounts = (current) => [{ value: '', label: 'Compte courant' }, ...envelopeOptions(current)];
      fields.from = selectField({ label: 'De', value: f.from, name: 'from', options: accounts(existing?.from), onChange: (v) => (f.from = v) });
      fields.to = selectField({ label: 'Vers', value: f.to, name: 'to', options: accounts(existing?.to), onChange: (v) => (f.to = v) });
      body.appendChild(h('div.field-row', fields.from.el, fields.to.el));
    } else {
      fields.counterparty = textField({
        label: f.mode === 'expense' ? 'Destinataire' : 'Émetteur',
        value: f.counterparty,
        optional: true,
        name: 'counterparty',
        autocapitalize: 'words',
        onInput: (v) => (f.counterparty = v),
      });
      body.appendChild(fields.counterparty.el);
      if (f.mode === 'expense') {
        if (app.state.envelopes.length) {
          fields.envelopeId = selectField({
            label: 'Payé avec',
            value: f.envelopeId,
            name: 'envelopeId',
            options: [{ value: '', label: 'Compte courant' }, ...envelopeOptions(existing?.envelopeId)],
            onChange: (v) => (f.envelopeId = v),
          });
          body.appendChild(fields.envelopeId.el);
        }
        const importance = pickList({
          label: 'Importance',
          options: IMPORTANCE.map((i) => ({ id: i.id, label: i.label })),
          selected: f.importance ? [f.importance] : [],
          multiple: false,
          onChange: (list) => (f.importance = list[0] || null),
        });
        body.appendChild(fieldGroup('Importance', importance.el));
      }
      if (app.state.tags.length) {
        const tags = pickList({ label: 'Tags', options: app.state.tags.map((t) => ({ id: t.id, label: t.name, color: t.color })), selected: f.tags, onChange: (list) => (f.tags = list) });
        body.appendChild(fieldGroup('Tags', tags.el));
      }
    }
    fields.comment = textArea({ label: 'Commentaire', value: f.comment, optional: true, rows: 2, onInput: (v) => (f.comment = v) });
    body.appendChild(fields.comment.el);
    body.appendChild(
      h(
        'p.hint',
        existing
          ? "Les modifications s'appliquent aux échéances à venir. Les opérations déjà passées ne changent pas."
          : "Les échéances à venir apparaissent dans Prévisions. Le jour venu, elles deviennent de vraies opérations, sans rien faire.",
      ),
    );
    sheet.body.scrollTop = top;
  }

  save.addEventListener('click', async () => {
    const cents = fields.amount.cents;
    if (cents === null || cents === 0) {
      fields.amount.setError(fields.amount.isEmpty ? 'Indique un montant.' : 'Montant illisible. Exemple : 12,50');
      fields.amount.el.scrollIntoView({ block: 'center' });
      return;
    }
    const isTransfer = f.mode === 'transfer';
    const input = {
      id: existing?.id,
      kind: isTransfer ? KIND.TRANSFER : KIND.OPERATION,
      label: f.label,
      amount: isTransfer ? cents : f.mode === 'expense' ? -cents : cents,
      frequency: f.frequency,
      interval: f.interval,
      startDate: f.startDate,
      endDate: f.endDate,
      envelopeId: f.mode === 'expense' ? f.envelopeId || null : null,
      from: isTransfer ? f.from || null : null,
      to: isTransfer ? f.to || null : null,
      tags: isTransfer ? [] : f.tags,
      importance: f.mode === 'expense' ? f.importance : null,
      counterparty: isTransfer ? '' : f.counterparty,
      comment: f.comment,
    };
    let backfill = true;
    if (!existing) {
      const past = f.startDate ? countBackfill(input, today) : 0;
      if (past > 1) {
        const choice = await chooseDialog({
          title: 'Échéances déjà passées',
          message: `La première échéance est le ${formatDate(f.startDate)} : ${plural(past, 'échéance est déjà passée', 'échéances sont déjà passées')}.`,
          options: [
            { id: 'all', label: `Les enregistrer aussi (${past})`, primary: true },
            { id: 'future', label: "Commencer à partir d'aujourd'hui" },
          ],
        });
        if (!choice) return;
        backfill = choice === 'all';
      }
    }
    const plan = planSaveRecurring(app.state, input, { today, backfill });
    if (!plan.ok) {
      let placed = false;
      for (const error of plan.errors) {
        const target = fields[error.field];
        if (target && target.el.isConnected) {
          target.setError(error.message);
          if (!placed) target.el.scrollIntoView({ block: 'center' });
          placed = true;
        }
      }
      if (!placed) app.fail(plan.errors[0].message);
      return;
    }
    if (await app.commit(plan.cs, { label: existing ? 'Récurrence modifiée' : 'Récurrence créée' })) sheet.close(plan.rule);
  });

  async function remove() {
    const realCount = app.state.operations.filter((o) => o.recurringId === existing.id && !o.simulated).length;
    const options = [{ id: 'future', label: 'Arrêter : garder les opérations passées', primary: true }];
    if (realCount) options.push({ id: 'all', label: `Tout supprimer, y compris ${plural(realCount, 'opération passée', 'opérations passées')}`, danger: true });
    const mode = await chooseDialog({
      title: `Supprimer « ${existing.label} » ?`,
      message: 'Les échéances à venir disparaissent des prévisions.',
      options,
    });
    if (!mode) return;
    const plan = planDeleteRecurring(app.state, existing.id, mode, { today });
    if (await app.run(plan, { label: 'Récurrence supprimée' })) sheet.close(null);
  }

  render();
  return sheet.closed;
}
