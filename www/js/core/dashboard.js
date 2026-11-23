// Tableau de bord (haut de l'écran « Bilan ») : ce qui compte aujourd'hui, en un coup d'œil.
// Fonctions pures : l'écran leur passe l'état, plus deux informations propres à l'appareil (rappel de
// sauvegarde, réponses de Claude non lues) ; elles renvoient des chiffres et des alertes.

import { computeBalances, projectAvailable } from './balances.js';
import { addDays, daysBetween, endOfMonth, formatDate } from './dates.js';
import { envelopeReport } from './envelopes.js';
import { formatAmount } from './money.js';
import { KIND } from './schema.js';

/** Au-delà, l'appli propose d'importer le relevé suivant (un relevé par mois, plus une marge). */
export const STATEMENT_LATE_DAYS = 40;
/** Jours couverts par « À venir ». */
export const UPCOMING_DAYS = 7;
/** L'accord donné à la banque (180 jours) est signalé quand il en reste moins que ça. */
export const BANK_CONSENT_WARN_DAYS = 14;

/**
 * Compte courant aujourd'hui (réel, comme l'écran Opérations) et estimé à la fin du mois (réel déjà
 * daté plus tard + prévisions cochées). low : point le plus bas d'ici là, { date, amount }.
 */
export function monthOutlook(state, today) {
  const endDate = endOfMonth(today);
  const now = computeBalances(state, { upTo: today }).available;
  const projection = projectAvailable(state, { today, upTo: endDate });
  return { today: now, endDate, end: projection.end, low: projection.low, daysLeft: daysBetween(today, endDate) };
}

/** Ce qui doit passer dans les jours qui viennent : prévisions cochées et opérations déjà datées. */
export function upcoming(state, today, days = UPCOMING_DAYS) {
  const until = addDays(today, days);
  return state.operations
    .filter((op) => op.date > today && op.date <= until && (!op.simulated || op.checked) && op.kind !== KIND.ADJUSTMENT)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '').localeCompare(b.time || '')));
}

/**
 * Enveloppes dont l'objectif prend du retard :
 *  - 'missed' : la date de l'objectif est passée et il manque encore de l'argent ;
 *  - 'behind' : l'effort du mois (objectif restant ÷ mois restants) n'est pas encore fait, même en
 *    comptant les alimentations déjà prévues d'ici la fin du mois.
 */
export function lateGoals(state, today) {
  const monthEnd = endOfMonth(today);
  const out = [];
  for (const env of state.envelopes) {
    if (env.closed || !env.goalAmount) continue;
    const report = envelopeReport(state, env.id, { today });
    const goal = report.goal;
    if (!goal || goal.missing <= 0) continue;
    if (env.goalDate && env.goalDate < today) {
      out.push({ envelopeId: env.id, name: env.name, kind: 'missed', missing: goal.missing, date: env.goalDate });
      continue;
    }
    if (!goal.perMonth) continue;
    let planned = 0;
    for (const op of state.operations) {
      if (op.kind !== KIND.TRANSFER || op.to !== env.id || op.date <= today || op.date > monthEnd) continue;
      if (op.simulated && !op.checked) continue;
      planned += op.amount;
    }
    const done = report.receivedThisMonth + planned;
    if (done < goal.perMonth) {
      out.push({ envelopeId: env.id, name: env.name, kind: 'behind', missing: goal.missing, perMonth: goal.perMonth, done, todo: goal.perMonth - done, date: env.goalDate });
    }
  }
  return out;
}

/** Date (AAAA-MM-JJ) du dernier relevé importé, ou null. */
export function lastStatementDate(state) {
  let last = '';
  for (const s of state.statements) if (s.importedAt && s.importedAt > last) last = s.importedAt;
  return last ? last.slice(0, 10) : null;
}

/**
 * Les alertes du jour, les plus importantes d'abord :
 * [{ id, level: 'bad' | 'warn' | 'info', icon, text, action: { label, screen, params } | null }].
 * Les quotas n'y figurent pas : leur carte est juste en dessous, dans le même écran.
 *   device.backup : rappel de sauvegarde ({ never, days }) ou null ;
 *   device.unread : nombre de réponses de Claude pas encore lues ;
 *   device.bankValidUntil : fin de l'accord donné à la banque (connexion bancaire), ou null.
 */
export function dashboardAlerts(state, { today, backup = null, unread = 0, bankValidUntil = null } = {}) {
  const alerts = [];
  const outlook = monthOutlook(state, today);
  if (outlook.today < 0) {
    alerts.push({ id: 'overdraft', level: 'bad', icon: 'alert', text: `Ton compte courant est à découvert : ${formatAmount(outlook.today)}.`, action: { label: 'Voir les opérations', screen: 'operations' } });
  } else if (outlook.low.amount < 0) {
    alerts.push({
      id: 'overdraft-soon',
      level: 'bad',
      icon: 'alert',
      text: `D'après tes prévisions, ton compte courant passera à ${formatAmount(outlook.low.amount)} le ${formatDate(outlook.low.date)}.`,
      action: { label: 'Voir les prévisions', screen: 'forecast' },
    });
  }
  for (const goal of lateGoals(state, today)) {
    const text =
      goal.kind === 'missed'
        ? `« ${goal.name} » : l'objectif du ${formatDate(goal.date)} est passé, il manque encore ${formatAmount(goal.missing)}.`
        : `« ${goal.name} » : mets encore ${formatAmount(goal.todo)} de côté ce mois-ci pour tenir ton objectif.`;
    alerts.push({ id: `goal-${goal.envelopeId}`, level: goal.kind === 'missed' ? 'warn' : 'info', icon: 'envelope', text, action: { label: 'Ouvrir', screen: 'envelope', params: { id: goal.envelopeId } } });
  }
  if (bankValidUntil) {
    const left = daysBetween(today, String(bankValidUntil).slice(0, 10));
    if (left <= BANK_CONSENT_WARN_DAYS) {
      alerts.push({
        id: 'bank-consent',
        level: left <= 0 ? 'bad' : 'warn',
        icon: 'bank',
        text: left <= 0 ? "L'accord donné à ta banque a expiré : demande à Claude de le renouveler." : `L'accord donné à ta banque expire dans ${left} jour${left > 1 ? 's' : ''} : demande à Claude de le renouveler.`,
        action: { label: 'Voir', screen: 'bank' },
      });
    }
  }
  if (backup) {
    alerts.push({
      id: 'backup',
      level: 'warn',
      icon: 'download',
      text: backup.never ? "Tu n'as encore jamais sauvegardé tes comptes hors du téléphone." : `Dernière sauvegarde hors du téléphone il y a ${backup.days} jours.`,
      action: { label: 'Sauvegarder', screen: 'backup' },
    });
  }
  const lastImport = lastStatementDate(state);
  if (lastImport) {
    const days = daysBetween(lastImport, today);
    if (days >= STATEMENT_LATE_DAYS) {
      alerts.push({ id: 'statement', level: 'info', icon: 'bank', text: `Dernier relevé importé il y a ${days} jours : importe le suivant pour vérifier tes comptes.`, action: { label: 'Importer', screen: 'statement' } });
    }
  }
  if (unread > 0) {
    alerts.push({ id: 'claude', level: 'info', icon: 'chat', text: unread > 1 ? `Claude t'a répondu (${unread} messages à lire).` : "Claude t'a répondu.", action: { label: 'Lire', screen: 'bugs' } });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.level] - rank[b.level]);
}
