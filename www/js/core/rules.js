// Règles automatiques : l'appli retient comment tu ranges les opérations d'un même tiers
// (« Lidl » → tag Courses, importance Nécessité…) pour pré-remplir les suivantes, notamment lors de
// l'import d'un relevé. Une règle par tiers, reconnue par une clé simplifiée (sans accents, sans
// numéros de magasin).

import { Draft } from './changeset.js';
import { KIND, makeRule } from './schema.js';
import { partyKey } from './text.js';

const err = (field, message, code = 'invalid') => ({ field, message, code });

export function ruleKey(text) {
  return partyKey(text);
}

/** Règle applicable à un texte (nom du tiers ou libellé), ou null. */
export function findRule(state, text) {
  const key = partyKey(text);
  if (!key) return null;
  let best = null;
  for (const rule of state.rules) {
    if (rule.key === key) return rule;
    // « carrefour city nation » correspond à la règle « carrefour city »
    if (rule.key.length >= 4 && key.startsWith(rule.key + ' ') && (!best || rule.key.length > best.key.length)) best = rule;
  }
  return best;
}

function cleaned(state, source) {
  const tags = new Set(state.tags.map((t) => t.id));
  const env = source.envelopeId ? state.envelopes.find((e) => e.id === source.envelopeId) : null;
  return {
    label: source.label || '',
    tags: (source.tags || []).filter((id) => tags.has(id)),
    envelopeId: env && !env.closed ? env.id : null,
    importance: source.importance || null,
  };
}

/**
 * Propose libellé / tags / enveloppe / importance pour un tiers.
 * Cherche d'abord une règle, sinon la dernière opération réelle saisie pour ce même tiers.
 * Renvoie { label, tags, envelopeId, importance, source: 'rule' | 'history' } ou null.
 */
export function suggestFor(state, { counterparty = '', label = '' }) {
  const rule = findRule(state, counterparty) || findRule(state, label);
  if (rule) return { ...cleaned(state, rule), source: 'rule', ruleId: rule.id };
  const key = partyKey(counterparty || label);
  if (!key) return null;
  let last = null;
  for (const op of state.operations) {
    if (op.simulated || op.kind !== KIND.OPERATION) continue;
    if (partyKey(op.counterparty || op.label) !== key) continue;
    if (!last || op.date > last.date) last = op;
  }
  if (!last) return null;
  if (!last.tags.length && !last.envelopeId && !last.importance && !last.label) return null;
  return { ...cleaned(state, last), source: 'history' };
}

/** Y a-t-il quelque chose à retenir de cette opération ? */
function worthLearning(op, key) {
  return op.tags.length > 0 || !!op.envelopeId || !!op.importance || (!!op.label && partyKey(op.label) !== key);
}

/** Retient (ou met à jour) la règle du tiers de cette opération, dans un brouillon. */
export function learnInto(draft, op) {
  if (op.kind !== KIND.OPERATION || op.simulated) return null;
  const display = op.counterparty || op.label;
  const key = partyKey(display);
  if (!key || !worthLearning(op, key)) return null;
  const existing = draft.state.rules.find((r) => r.key === key);
  const rule = makeRule({
    ...(existing || {}),
    key,
    display: existing?.display || display,
    label: op.label,
    tags: op.tags,
    // Seules les dépenses renseignent l'enveloppe (un revenu n'arrive jamais dans une enveloppe).
    envelopeId: op.amount < 0 ? op.envelopeId : existing?.envelopeId || null,
    importance: op.importance,
    uses: (existing?.uses || 0) + 1,
    updatedAt: new Date().toISOString(),
  });
  draft.put('rules', rule);
  return rule;
}

export function planSaveRule(state, input) {
  const existing = input.id ? state.rules.find((r) => r.id === input.id) : null;
  if (input.id && !existing) return { ok: false, errors: [err('id', "Cette règle n'existe plus.", 'missing')] };
  const display = (input.display ?? existing?.display ?? '').trim();
  const key = partyKey(display);
  if (!key) return { ok: false, errors: [err('display', 'Indique le nom du tiers (commerçant, personne, organisme).')] };
  if (state.rules.some((r) => r.key === key && r.id !== existing?.id)) {
    return { ok: false, errors: [err('display', 'Une règle existe déjà pour ce tiers.', 'duplicate')] };
  }
  const rule = makeRule({ ...(existing || {}), ...input, display, key, updatedAt: new Date().toISOString() });
  const draft = new Draft(state);
  draft.put('rules', rule);
  return { ok: true, cs: draft.cs, rule };
}

export function planDeleteRule(state, id) {
  if (!state.rules.some((r) => r.id === id)) return { ok: false, errors: [err('id', "Cette règle n'existe plus.", 'missing')] };
  const draft = new Draft(state);
  draft.del('rules', id);
  return { ok: true, cs: draft.cs };
}
