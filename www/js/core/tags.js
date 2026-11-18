// Règles métier des tags (catégories libres).

import { Draft } from './changeset.js';
import { COLORS, QUOTA_PERIODS, makeTag } from './schema.js';
import { isValidISO } from './dates.js';
import { normalize } from './text.js';

const err = (field, message, code = 'invalid') => ({ field, message, code });

/**
 * Vérifie un quota saisi : { amount (centimes), period, from?, to? } ou null (pas de quota).
 * Renvoie { quota, errors } ; les champs d'erreur sont quotaAmount, quotaFrom, quotaTo.
 */
export function validateQuota(input) {
  if (input === null || input === undefined || input === false) return { quota: null, errors: [] };
  const errors = [];
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0) errors.push(err('quotaAmount', 'Indique le montant à ne pas dépasser.'));
  const period = QUOTA_PERIODS.some((p) => p.id === input.period) ? input.period : null;
  if (!period) errors.push(err('quotaPeriod', 'Choisis une période.'));
  if (period === 'custom') {
    if (!isValidISO(input.from)) errors.push(err('quotaFrom', 'Choisis la date de début.'));
    if (!isValidISO(input.to)) errors.push(err('quotaTo', 'Choisis la date de fin.'));
    else if (isValidISO(input.from) && input.to < input.from) errors.push(err('quotaTo', 'La fin doit venir après le début.'));
  }
  if (errors.length) return { quota: null, errors };
  return { quota: period === 'custom' ? { amount, period, from: input.from, to: input.to } : { amount, period, from: null, to: null }, errors };
}

/** Couleur la moins utilisée, pour varier automatiquement. */
export function nextColor(items) {
  const counts = new Map(COLORS.map((c) => [c, 0]));
  for (const it of items) if (counts.has(it.color)) counts.set(it.color, counts.get(it.color) + 1);
  return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/**
 * Crée ou modifie un tag. input : { id?, name, color?, quota? } — quota absent : inchangé ;
 * quota null : retiré ; sinon vérifié par validateQuota.
 */
export function planSaveTag(state, input) {
  const existing = input.id ? state.tags.find((t) => t.id === input.id) : null;
  if (input.id && !existing) return { ok: false, errors: [err('id', "Ce tag n'existe plus.", 'missing')] };
  let fields = input;
  if ('quota' in input) {
    const checked = validateQuota(input.quota);
    if (checked.errors.length) return { ok: false, errors: checked.errors };
    fields = { ...input, quota: checked.quota };
  }
  const tag = makeTag({ color: nextColor(state.tags), ...(existing || {}), ...fields });
  if (!tag.name) return { ok: false, errors: [err('name', 'Donne un nom à ce tag.')] };
  const twin = state.tags.find((t) => t.id !== tag.id && normalize(t.name) === normalize(tag.name));
  if (twin) return { ok: false, errors: [err('name', 'Ce tag existe déjà.', 'duplicate')], twin };
  const draft = new Draft(state);
  draft.put('tags', tag);
  return { ok: true, cs: draft.cs, tag };
}

/** Nombre d'opérations (réelles et simulées) qui portent ce tag. */
export function tagUsage(state, tagId) {
  let n = 0;
  for (const op of state.operations) if (op.tags.includes(tagId)) n++;
  return n;
}

/** Supprime un tag et le retire de partout où il était utilisé (opérations, récurrences, règles). */
export function planDeleteTag(state, tagId) {
  if (!state.tags.some((t) => t.id === tagId)) return { ok: false, errors: [err('id', "Ce tag n'existe plus.", 'missing')] };
  const draft = new Draft(state);
  const without = (list) => list.filter((id) => id !== tagId);
  for (const op of state.operations) if (op.tags.includes(tagId)) draft.put('operations', { ...op, tags: without(op.tags) });
  for (const rule of state.recurring) if (rule.tags.includes(tagId)) draft.put('recurring', { ...rule, tags: without(rule.tags) });
  for (const rule of state.rules) if (rule.tags.includes(tagId)) draft.put('rules', { ...rule, tags: without(rule.tags) });
  draft.del('tags', tagId);
  return { ok: true, cs: draft.cs };
}
