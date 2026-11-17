// Règles métier des tags (catégories libres).

import { Draft } from './changeset.js';
import { COLORS, makeTag } from './schema.js';
import { normalize } from './text.js';

const err = (field, message, code = 'invalid') => ({ field, message, code });

/** Couleur la moins utilisée, pour varier automatiquement. */
export function nextColor(items) {
  const counts = new Map(COLORS.map((c) => [c, 0]));
  for (const it of items) if (counts.has(it.color)) counts.set(it.color, counts.get(it.color) + 1);
  return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

export function planSaveTag(state, input) {
  const existing = input.id ? state.tags.find((t) => t.id === input.id) : null;
  if (input.id && !existing) return { ok: false, errors: [err('id', "Ce tag n'existe plus.", 'missing')] };
  const tag = makeTag({ color: nextColor(state.tags), ...(existing || {}), ...input });
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
