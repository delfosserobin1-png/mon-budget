// Création / modification d'une enveloppe, et virements rapides depuis sa fiche.

import { h } from '../dom.js';
import { openSheet } from '../overlays.js';
import { amountField, dateField, textField, textArea, fieldGroup } from '../fields.js';
import { colorPicker } from './tag.js';
import { planSaveEnvelope } from '../../core/envelopes.js';
import { nextColor } from '../../core/tags.js';

/** Ouvre le formulaire d'enveloppe ; la promesse renvoie l'enveloppe enregistrée (ou null). */
export function openEnvelopeForm(app, { id = null } = {}) {
  const existing = id ? app.state.envelopes.find((e) => e.id === id) : null;
  const draft = { color: existing?.color || nextColor(app.state.envelopes) };
  const name = textField({ label: 'Nom', value: existing?.name || '', name: 'name', placeholder: 'Vacances, voiture, cadeaux…', maxLength: 40 });
  const description = textArea({ label: 'À quoi sert-elle ?', value: existing?.description || '', optional: true, name: 'description', rows: 2, maxLength: 300 });
  const goal = amountField({ label: 'Objectif à atteindre', cents: existing?.goalAmount ?? null, optional: true, big: false, name: 'goalAmount' });
  const goalDate = dateField({ label: 'Pour le', value: existing?.goalDate || null, optional: true, name: 'goalDate' });
  const save = h('button.btn.primary', { type: 'button', dataset: { action: 'save' } }, existing ? 'Enregistrer' : "Créer l'enveloppe");
  const sheet = openSheet({
    title: existing ? "Modifier l'enveloppe" : 'Nouvelle enveloppe',
    body: h(
      'div.stack.loose',
      existing ? null : h('p.note', "Une enveloppe met de l'argent de côté pour un projet. Ce que tu y verses sort du compte courant, sans quitter ton compte en banque."),
      name.el,
      description.el,
      fieldGroup('Couleur du sceau', colorPicker(draft.color, (c) => (draft.color = c))),
      h('div.field-row', goal.el, goalDate.el),
      h('p.hint', "L'objectif est facultatif : il affiche une jauge et l'effort mensuel pour y arriver."),
    ),
    foot: [save],
    full: true,
  });
  save.addEventListener('click', async () => {
    if (!goal.isEmpty && goal.cents === null) {
      goal.setError('Montant illisible. Exemple : 1500');
      return;
    }
    const plan = planSaveEnvelope(app.state, {
      id: existing?.id,
      name: name.value,
      description: description.value,
      color: draft.color,
      goalAmount: goal.cents || null,
      goalDate: goal.cents ? goalDate.value : null,
    });
    if (!plan.ok) {
      for (const error of plan.errors) {
        const target = { name, goalAmount: goal, goalDate }[error.field];
        if (target) target.setError(error.message);
        else app.fail(error.message);
      }
      return;
    }
    if (await app.commit(plan.cs, { label: existing ? 'Enveloppe modifiée' : 'Enveloppe créée' })) sheet.close(plan.envelope);
  });
  if (!existing) name.focus();
  return sheet.closed;
}
