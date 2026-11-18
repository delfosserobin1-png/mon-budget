// Quotas par tag : un plafond de dépenses pour un tag, par jour, par semaine, par mois, par an, ou
// entre deux dates choisies.
//
// Ce qui compte dans un quota :
//   - les opérations réelles (pas les prévisions) qui portent le tag, datées dans la période ;
//   - dépenses MOINS remboursements : un remboursement portant le même tag rend de la marge ;
//   - une opération qui porte plusieurs tags compte en entier pour chacun de ses quotas ;
//   - jamais les mouvements d'enveloppes ni les ajustements de rapprochement.
// Les prévisions cochées de la période (et les opérations réelles datées plus tard dans la
// période) sont données à part : c'est le « prévu ».
//
// Logique pure, sans écran ni stockage : tout se teste en quelques millisecondes.

import { KIND, QUOTA_PERIODS } from './schema.js';
import { addDays, daysBetween, endOfMonth, formatDate, startOfMonth, weekday } from './dates.js';
import { formatAmount } from './money.js';

/** Au-delà de cette part du quota, on prévient (« bientôt atteint »). */
export const WARN_RATIO = 0.8;

const LEVEL_ORDER = { over: 0, warn: 1, ok: 2 };

export function periodInfo(id) {
  return QUOTA_PERIODS.find((p) => p.id === id) || QUOTA_PERIODS[2];
}

/** La période du quota qui contient la date `date` : { from, to }, ou null (dates choisies, hors période). */
export function windowAt(quota, date) {
  switch (quota.period) {
    case 'day':
      return { from: date, to: date };
    case 'week': {
      const from = addDays(date, -((weekday(date) + 6) % 7)); // la semaine commence le lundi
      return { from, to: addDays(from, 6) };
    }
    case 'month':
      return { from: startOfMonth(date), to: endOfMonth(date) };
    case 'year':
      return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` };
    default:
      return date >= quota.from && date <= quota.to ? { from: quota.from, to: quota.to } : null;
  }
}

/** La période « en cours » : celle d'aujourd'hui, ou, pour des dates choisies, ces dates mêmes. */
export function currentWindow(quota, today) {
  return windowAt(quota, today) || { from: quota.from, to: quota.to };
}

/**
 * Somme signée des opérations d'un tag entre deux dates (négatif = dépensé).
 * options : simulated (prévisions cochées au lieu des opérations réelles), excludeId.
 */
export function tagNet(state, tagId, from, to, { simulated = false, excludeId = null } = {}) {
  let net = 0;
  for (const op of state.operations) {
    if (op.kind !== KIND.OPERATION || op.id === excludeId) continue;
    if (op.simulated !== simulated || (simulated && !op.checked)) continue;
    if (op.date < from || op.date > to || !op.tags.includes(tagId)) continue;
    net += op.amount;
  }
  return net;
}

const levelOf = (spent, limit) => (spent > limit ? 'over' : spent >= limit * WARN_RATIO ? 'warn' : 'ok');

/**
 * Où en est le quota d'un tag aujourd'hui. Renvoie null si le tag n'a pas de quota, sinon :
 * { tagId, name, color, quota, from, to, phase ('active' | 'upcoming' | 'ended'), limit, spent,
 *   planned, remaining, ratio, level, projected, projectedLevel, daysLeft, perDay }
 */
export function quotaStatus(state, tag, today) {
  const quota = tag.quota;
  if (!quota) return null;
  const { from, to } = currentWindow(quota, today);
  const phase = today < from ? 'upcoming' : today > to ? 'ended' : 'active';
  const pastEnd = phase === 'ended' ? to : phase === 'upcoming' ? addDays(from, -1) : today;
  const spent = Math.max(0, -tagNet(state, tag.id, from, pastEnd));
  // ce qui est encore attendu dans la période : prévisions cochées, opérations réelles datées plus tard
  const plannedFrom = phase === 'upcoming' ? from : addDays(today, 1);
  let planned = 0;
  if (phase !== 'ended') {
    planned = Math.max(0, -(tagNet(state, tag.id, plannedFrom, to) + tagNet(state, tag.id, phase === 'upcoming' ? from : today, to, { simulated: true })));
  }
  const limit = quota.amount;
  const remaining = limit - spent;
  const daysLeft = phase === 'active' ? daysBetween(today, to) + 1 : phase === 'upcoming' ? daysBetween(from, to) + 1 : 0;
  return {
    tagId: tag.id,
    name: tag.name,
    color: tag.color,
    quota,
    from,
    to,
    phase,
    limit,
    spent,
    planned,
    remaining,
    ratio: limit ? spent / limit : 0,
    level: levelOf(spent, limit),
    projected: spent + planned,
    projectedLevel: levelOf(spent + planned, limit),
    daysLeft,
    perDay: remaining > 0 && daysLeft > 0 ? Math.floor(remaining / daysLeft) : 0,
  };
}

/** Les quotas de tous les tags, les plus préoccupants d'abord (dépassés, presque atteints, puis le reste). */
export function quotaStatuses(state, today) {
  const out = [];
  for (const tag of state.tags) {
    const status = quotaStatus(state, tag, today);
    if (status) out.push(status);
  }
  const phaseRank = { active: 0, upcoming: 1, ended: 2 };
  return out.sort((a, b) => phaseRank[a.phase] - phaseRank[b.phase] || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.ratio - a.ratio || a.name.localeCompare(b.name, 'fr'));
}

/** Nombre de quotas dépassés dans leur période en cours. */
export function overQuotaCount(state, today) {
  return quotaStatuses(state, today).filter((s) => s.phase === 'active' && s.level === 'over').length;
}

/**
 * Effet d'une dépense en cours de saisie sur les quotas de ses tags (pour prévenir AVANT d'enregistrer).
 * op : { id?, date, amount (signé, négatif = dépense), tags, simulated }.
 * Renvoie la liste des quotas qui seraient presque atteints ou dépassés :
 * [{ tagId, name, limit, before, after, level ('warn' | 'over'), from, to, period }].
 */
export function quotaImpact(state, op, { tags = state.tags } = {}) {
  if (!op || !Number.isFinite(op.amount) || op.amount >= 0 || !op.date) return [];
  const out = [];
  for (const tagId of op.tags || []) {
    const tag = tags.find((t) => t.id === tagId);
    if (!tag || !tag.quota) continue;
    const window = windowAt(tag.quota, op.date);
    if (!window) continue;
    // toute la période compte (y compris plus tard dans le mois) ; une prévision se compare aux prévisions cochées en plus
    let net = tagNet(state, tagId, window.from, window.to, { excludeId: op.id || null });
    if (op.simulated) net += tagNet(state, tagId, window.from, window.to, { simulated: true, excludeId: op.id || null });
    const before = Math.max(0, -net);
    const after = Math.max(0, -(net + op.amount));
    const level = levelOf(after, tag.quota.amount);
    if (level === 'ok') continue;
    out.push({ tagId, name: tag.name, limit: tag.quota.amount, before, after, level, from: window.from, to: window.to, period: tag.quota.period });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Textes (ici plutôt que dans l'écran : ils se testent)
// ---------------------------------------------------------------------------------------------

/** « 200,00 € par mois », « 500,00 € du 01-08-2026 au 15-08-2026 ». */
export function quotaText(quota) {
  if (!quota) return '';
  if (quota.period === 'custom') return `${formatAmount(quota.amount)} du ${formatDate(quota.from)} au ${formatDate(quota.to)}`;
  return `${formatAmount(quota.amount)} ${periodInfo(quota.period).every}`;
}

/** « ce mois-ci », « cette semaine », « du 01-08-2026 au 15-08-2026 ». */
export function windowText(quota) {
  if (quota.period === 'custom') return `du ${formatDate(quota.from)} au ${formatDate(quota.to)}`;
  return periodInfo(quota.period).current;
}

/** Une phrase sur l'état du quota, pour une ligne de liste. */
export function statusText(status) {
  const where = windowText(status.quota);
  if (status.phase === 'upcoming') return `Commence le ${formatDate(status.from)}`;
  if (status.phase === 'ended') return `Terminé : ${formatAmount(status.spent)} dépensés sur ${formatAmount(status.limit)}`;
  if (status.level === 'over') return `Dépassé de ${formatAmount(status.spent - status.limit)} ${where}`;
  const rest = `Reste ${formatAmount(status.remaining)} ${where}`;
  return status.daysLeft > 1 && status.perDay > 0 && status.quota.period !== 'day' ? `${rest}, soit ${formatAmount(status.perDay)} par jour` : rest;
}

/** Message d'avertissement pour le formulaire d'opération (today : pour dire « ce mois-ci » quand c'est le cas). */
export function impactText(impact, today = null) {
  const current = impact.period !== 'custom' && today && today >= impact.from && today <= impact.to;
  let window;
  if (current) window = periodInfo(impact.period).current;
  else if (impact.from === impact.to) window = `le ${formatDate(impact.from)}`;
  else window = `du ${formatDate(impact.from)} au ${formatDate(impact.to)}`;
  if (impact.level === 'over') return `Avec cette dépense, « ${impact.name} » dépasse son quota : ${formatAmount(impact.after)} sur ${formatAmount(impact.limit)} ${window}.`;
  return `Avec cette dépense, « ${impact.name} » atteint ${Math.round((impact.after / impact.limit) * 100)} % de son quota (${formatAmount(impact.after)} sur ${formatAmount(impact.limit)} ${window}).`;
}
