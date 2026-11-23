// Une enveloppe ne peut pas être à découvert : quand une sortie (ou un groupe de sorties) la ferait
// passer en négatif, l'appli propose de compléter depuis le compte courant avant d'enregistrer.

import { confirmDialog } from './overlays.js';
import { accountName } from '../core/operations.js';
import { formatAmount } from '../core/money.js';

/** Demande l'accord pour les compléments ; renvoie true si l'utilisateur accepte. */
export function confirmTopups(app, topups) {
  const lines = topups.map((t) => `« ${accountName(app.state, t.envelopeId)} » : il manque ${formatAmount(t.amount)}`).join('\n');
  const total = topups.reduce((sum, t) => sum + t.amount, 0);
  return confirmDialog({
    title: "L'enveloppe ne contient pas assez",
    message: `${lines}\n\nUne enveloppe ne peut pas être à découvert. Y ajouter ${formatAmount(total)} depuis le compte courant pour compléter ?`,
    confirmLabel: 'Compléter et enregistrer',
  });
}
