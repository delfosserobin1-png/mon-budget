// Création / modification d'un tag.

import { h } from '../dom.js';
import { openSheet, promptDialog } from '../overlays.js';
import { textField, fieldGroup } from '../fields.js';
import { COLORS } from '../../core/schema.js';
import { nextColor, planSaveTag } from '../../core/tags.js';

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

/** Feuille d'édition d'un tag (nom + couleur). */
export function openTagForm(app, { id = null } = {}) {
  const existing = id ? app.state.tags.find((t) => t.id === id) : null;
  const draft = { name: existing?.name || '', color: existing?.color || nextColor(app.state.tags) };
  const name = textField({ label: 'Nom', value: draft.name, name: 'name', maxLength: 30, onInput: (v) => (draft.name = v) });
  const save = h('button.btn.primary', { type: 'button', dataset: { action: 'save' } }, 'Enregistrer');
  const sheet = openSheet({
    title: existing ? 'Modifier le tag' : 'Nouveau tag',
    body: h('div.stack.loose', name.el, fieldGroup('Couleur', colorPicker(draft.color, (c) => (draft.color = c)))),
    foot: [save],
  });
  save.addEventListener('click', async () => {
    const plan = planSaveTag(app.state, { id: existing?.id, name: name.value, color: draft.color });
    if (!plan.ok) {
      name.setError(plan.errors[0].message);
      return;
    }
    if (await app.commit(plan.cs, { label: existing ? 'Tag modifié' : 'Tag créé' })) sheet.close(plan.tag);
  });
  return sheet.closed;
}
