// Création / modification d'un tag : nom, couleur, et quota (plafond de sorties par période).

import { h } from '../dom.js';
import { openSheet, promptDialog } from '../overlays.js';
import { amountField, dateField, textField, fieldGroup, segmented, toggle } from '../fields.js';
import { COLORS, QUOTA_PERIODS } from '../../core/schema.js';
import { nextColor, planSaveTag } from '../../core/tags.js';
import { quotaStatus, statusText } from '../../core/quotas.js';
import { addDays } from '../../core/dates.js';

/** Demande un nom, crée le tag et le renvoie (ou null si l'utilisateur renonce). */
export async function askNewTag(app) {
  let created = null;
  const name = await promptDialog({
    title: 'Nouveau tag',
    label: 'Nom du tag',
    placeholder: 'Courses, loisirs, santé…',
    confirmLabel: 'Créer',
    maxLength: 30,
    validate: async (text) => {
      const plan = planSaveTag(app.state, { name: text });
      if (!plan.ok) return plan.errors[0].message;
      if (!(await app.commit(plan.cs, { undoable: false }))) return "Le tag n'a pas pu être créé.";
      created = plan.tag;
      return null;
    },
  });
  return name === null ? null : created;
}

/** Palette de couleurs à cocher. */
export function colorPicker(selected, onChange) {
  let current = selected;
  const el = h('div.chips', { role: 'group', 'aria-label': 'Couleur' });
  const buttons = COLORS.map((color) => {
    const b = h('button', { type: 'button', class: `swatch k-${color}`, 'aria-label': color, 'aria-pressed': String(color === current), dataset: { color } });
    b.addEventListener('click', () => {
      current = color;
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
      onChange(color);
    });
    return b;
  });
  for (const b of buttons) el.appendChild(b);
  return el;
}

/** Réglage du quota d'un tag : interrupteur, montant, période (ou dates). Renvoie { el, value(), setErrors(errors) }. */
function quotaEditor(app, existing) {
  const today = app.today();
  const quota = existing?.quota || null;
  let period = quota?.period || 'month';
  const amount = amountField({ label: 'Montant à ne pas dépasser', name: 'quotaAmount', big: false, cents: quota ? quota.amount : null });
  const from = dateField({ label: 'Du', name: 'quotaFrom', value: quota?.from || today });
  const to = dateField({ label: 'Au', name: 'quotaTo', value: quota?.to || addDays(today, 30) });
  const dates = h('div.field-row', from.el, to.el);
  const periods = segmented({
    label: 'Période du quota',
    value: period,
    options: QUOTA_PERIODS.map((p) => ({ value: p.id, label: p.label })),
    onChange: (value) => {
      period = value;
      dates.hidden = period !== 'custom';
    },
  });
  dates.hidden = period !== 'custom';
  const details = h('div.stack', { dataset: { block: 'quota' } }, amount.el, fieldGroup('Par', periods.el), dates, h('p.hint', "Les sorties qui portent ce tag s'additionnent sur la période (une entrée avec ce tag, comme un remboursement, rend de la marge). L'appli te prévient dès 80 %, et au moment de saisir une sortie qui ferait dépasser."));
  const enabled = toggle({
    label: 'Limiter les sorties de ce tag',
    hint: 'Un quota par jour, semaine, mois, année, ou entre deux dates.',
    checked: !!quota,
    name: 'quota',
    onChange: (on) => {
      details.hidden = !on;
      if (on) amount.focus();
    },
  });
  details.hidden = !quota;
  const status = existing && quota ? quotaStatus(app.state, existing, today) : null;
  const el = h('div.stack', enabled.el, status ? h('p.hint', { dataset: { value: 'quota-status' } }, statusText(status)) : null, details);
  const fieldsByName = { quotaAmount: amount, quotaFrom: from, quotaTo: to };
  return {
    el,
    value() {
      if (!enabled.value) return null;
      return { amount: amount.cents === null ? 0 : amount.cents, period, from: period === 'custom' ? from.value : null, to: period === 'custom' ? to.value : null };
    },
    /** Affiche les erreurs qui concernent le quota ; renvoie true s'il y en avait. */
    setErrors(errors) {
      let shown = false;
      for (const error of errors) {
        const field = fieldsByName[error.field];
        if (field) {
          field.setError(error.message);
          shown = true;
        }
      }
      return shown;
    },
  };
}

/** Feuille d'édition d'un tag (nom, couleur, quota). */
export function openTagForm(app, { id = null } = {}) {
  const existing = id ? app.state.tags.find((t) => t.id === id) : null;
  const draft = { name: existing?.name || '', color: existing?.color || nextColor(app.state.tags) };
  const name = textField({ label: 'Nom', value: draft.name, name: 'name', maxLength: 30, onInput: (v) => (draft.name = v) });
  const quota = quotaEditor(app, existing);
  const save = h('button.btn.primary', { type: 'button', dataset: { action: 'save' } }, 'Enregistrer');
  const sheet = openSheet({
    title: existing ? 'Modifier le tag' : 'Nouveau tag',
    body: h('div.stack.loose', name.el, fieldGroup('Couleur', colorPicker(draft.color, (c) => (draft.color = c))), fieldGroup('Quota', quota.el)),
    foot: [save],
  });
  save.addEventListener('click', async () => {
    const plan = planSaveTag(app.state, { id: existing?.id, name: name.value, color: draft.color, quota: quota.value() });
    if (!plan.ok) {
      if (!quota.setErrors(plan.errors)) name.setError(plan.errors[0].message);
      return;
    }
    if (await app.commit(plan.cs, { label: existing ? 'Tag modifié' : 'Tag créé' })) sheet.close(plan.tag);
  });
  return sheet.closed;
}
