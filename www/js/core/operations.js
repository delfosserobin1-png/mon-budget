// Règles métier des opérations et des virements internes.
//
// Chaque fonction « plan… » reçoit l'état actuel et une demande, vérifie les règles, et renvoie :
//   { ok: true, cs, … }            → le lot de modifications à valider (rien n'est encore enregistré)
//   { ok: false, errors: [...] }   → la demande est refusée, avec un message clair par problème
// L'interface se contente d'afficher les erreurs ou de valider le lot.

import { Draft } from './changeset.js';
import { KIND, makeOperation } from './schema.js';
import { isValidISO } from './dates.js';
import { findEnvelopeShortfalls, envelopeLowPoint } from './balances.js';
import { formatAmount } from './money.js';

const err = (field, message, code = 'invalid', data = null) => ({ field, message, code, data });

function envelopeName(state, id) {
  return state.envelopes.find((e) => e.id === id)?.name || 'Enveloppe supprimée';
}

/** Nom d'un « côté » de virement : null = compte courant. */
export function accountName(state, id) {
  return id === null ? 'Compte courant' : envelopeName(state, id);
}

/** Titre affiché d'un virement : « Compte courant → Vacances ». */
export function transferTitle(state, op) {
  return `${accountName(state, op.from)} → ${accountName(state, op.to)}`;
}

/** Titre affiché d'une opération quelconque. */
export function operationTitle(state, op) {
  if (op.kind === KIND.TRANSFER) return transferTitle(state, op);
  return op.label || op.counterparty || (op.kind === KIND.ADJUSTMENT ? 'Ajustement' : 'Sans libellé');
}

function shortfallErrors(state, shortfalls) {
  return shortfalls.map((s) =>
    err(
      'amount',
      `« ${envelopeName(state, s.envelopeId)} » passerait en négatif (il manquerait ${formatAmount(s.shortfall)}). Une enveloppe ne peut pas être à découvert.`,
      'insufficient',
      s,
    ),
  );
}

/**
 * Crée ou modifie une opération (dépense / revenu).
 * Si la dépense met une enveloppe à découvert, le plan réussit mais renvoie `topups` : les virements
 * de complément depuis le compte courant qu'il faut proposer à l'utilisateur (voir topupChangeset).
 */
export function planSaveOperation(state, input, { today }) {
  const errors = [];
  const existing = input.id ? state.operations.find((o) => o.id === input.id) : null;
  if (input.id && !existing) errors.push(err('id', "Cette opération n'existe plus.", 'missing'));
  if (existing && existing.kind !== KIND.OPERATION) errors.push(err('id', "Cette fiche n'est pas une opération classique.", 'wrong-kind'));
  if (!Number.isInteger(input.amount) || input.amount === 0) errors.push(err('amount', 'Indique un montant supérieur à zéro.'));
  if (!isValidISO(input.date)) errors.push(err('date', 'Indique une date valide.'));

  const envelopeId = input.envelopeId || null;
  if (envelopeId) {
    const env = state.envelopes.find((e) => e.id === envelopeId);
    if (!env) errors.push(err('envelopeId', "Cette enveloppe n'existe plus.", 'missing-envelope'));
    else if (env.closed && existing?.envelopeId !== env.id) {
      errors.push(err('envelopeId', `« ${env.name} » est clôturée : rouvre-la pour y ajouter une opération.`, 'closed-envelope'));
    } else if (input.amount > 0) {
      errors.push(
        err(
          'envelopeId',
          `Une enveloppe ne reçoit de l'argent que par virement. Enregistre ce revenu sur le compte courant, puis vire-le vers « ${env.name} ».`,
          'credit-in-envelope',
          { envelopeId },
        ),
      );
    }
  }
  if (errors.length) return { ok: false, errors };

  const knownTags = new Set(state.tags.map((t) => t.id));
  const op = makeOperation({
    ...(existing || {}),
    ...input,
    kind: KIND.OPERATION,
    envelopeId,
    tags: (input.tags ?? existing?.tags ?? []).filter((id) => knownTags.has(id)),
    updatedAt: new Date().toISOString(),
  });
  const draft = new Draft(state);
  draft.put('operations', op);
  const shortfalls = op.simulated ? [] : findEnvelopeShortfalls(state, draft.state, today);
  const topups = shortfalls.map((s) => ({ envelopeId: s.envelopeId, amount: s.shortfall, date: op.date }));
  return { ok: true, cs: draft.cs, op, topups };
}

/** Virements de complément (compte courant → enveloppe) pour combler les découverts annoncés. */
export function topupChangeset(state, topups) {
  const draft = new Draft(state);
  for (const t of topups) {
    draft.put(
      'operations',
      makeOperation({ kind: KIND.TRANSFER, from: null, to: t.envelopeId, amount: t.amount, date: t.date, auto: 'topup', label: 'Complément automatique' }),
    );
  }
  return draft.cs;
}

/**
 * Revenu destiné à une enveloppe : on l'enregistre sur le compte courant (c'est là que la banque
 * le verse) puis on le vire aussitôt vers l'enveloppe. Deux fiches, un seul lot.
 */
export function planCreditThenTransfer(state, input, { today }) {
  const envelopeId = input.envelopeId;
  const first = planSaveOperation(state, { ...input, envelopeId: null }, { today });
  if (!first.ok) return first;
  if (first.op.simulated) return first;
  const draft = new Draft(state);
  draft.put('operations', first.op);
  draft.put('operations', makeOperation({ kind: KIND.TRANSFER, from: null, to: envelopeId, amount: first.op.amount, date: first.op.date }));
  return { ok: true, cs: draft.cs, op: first.op, topups: [] };
}

/** Crée ou modifie un virement interne (compte courant ↔ enveloppe, ou entre deux enveloppes). */
export function planSaveTransfer(state, input, { today }) {
  const errors = [];
  const existing = input.id ? state.operations.find((o) => o.id === input.id) : null;
  if (input.id && !existing) errors.push(err('id', "Ce virement n'existe plus.", 'missing'));
  if (existing && existing.kind !== KIND.TRANSFER) errors.push(err('id', "Cette fiche n'est pas un virement.", 'wrong-kind'));
  // Attention : null est une vraie valeur ici (« compte courant »), à ne pas confondre avec « non précisé ».
  const from = 'from' in input ? input.from || null : existing?.from ?? null;
  const to = 'to' in input ? input.to || null : existing?.to ?? null;
  if (from === to) errors.push(err('to', 'Choisis deux comptes différents.'));
  if (!Number.isInteger(input.amount) || input.amount <= 0) errors.push(err('amount', 'Indique un montant supérieur à zéro.'));
  if (!isValidISO(input.date)) errors.push(err('date', 'Indique une date valide.'));
  for (const [field, id] of [['from', from], ['to', to]]) {
    if (id === null) continue;
    const env = state.envelopes.find((e) => e.id === id);
    if (!env) errors.push(err(field, "Cette enveloppe n'existe plus.", 'missing-envelope'));
    else if (env.closed && existing?.[field] !== id) errors.push(err(field, `« ${env.name} » est clôturée.`, 'closed-envelope'));
  }
  if (errors.length) return { ok: false, errors };

  const op = makeOperation({ ...(existing || {}), ...input, kind: KIND.TRANSFER, from, to, updatedAt: new Date().toISOString() });
  const draft = new Draft(state);
  draft.put('operations', op);
  if (!op.simulated) {
    const shortfalls = findEnvelopeShortfalls(state, draft.state, today);
    if (shortfalls.length) return { ok: false, errors: shortfallErrors(state, shortfalls) };
  }
  return { ok: true, cs: draft.cs, op };
}

/**
 * Supprime des opérations (ou virements, ou ajustements).
 * Refusé si la suppression met une enveloppe à découvert (ex. supprimer le virement qui la finançait).
 */
export function planDeleteOperations(state, ids, { today }) {
  const draft = new Draft(state);
  const removed = [];
  for (const id of ids) {
    const op = draft.get('operations', id);
    if (!op) continue;
    removed.push(op);
    draft.del('operations', id);
  }
  if (!removed.length) return { ok: false, errors: [err('id', "Ces opérations n'existent plus.", 'missing')] };
  const removedIds = new Set(removed.map((o) => o.id));
  for (const rec of state.reconciliations) {
    if (rec.adjustmentOperationId && removedIds.has(rec.adjustmentOperationId)) {
      draft.put('reconciliations', { ...rec, adjustmentOperationId: null });
    }
  }
  const shortfalls = findEnvelopeShortfalls(state, draft.state, today);
  if (shortfalls.length) return { ok: false, errors: shortfallErrors(state, shortfalls) };
  return { ok: true, cs: draft.cs, removed };
}

/** Coche / décoche une opération simulée (compte-t-elle dans le solde estimé ?). */
export function planSetChecked(state, ids, checked) {
  const draft = new Draft(state);
  for (const id of ids) {
    const op = draft.get('operations', id);
    if (op && op.simulated && op.checked !== checked) draft.put('operations', { ...op, checked });
  }
  return { ok: true, cs: draft.cs };
}

/**
 * Transforme une simulation en opération réelle (elle a finalement eu lieu).
 * Si elle était prévue pour plus tard (un salaire arrivé en avance, par exemple), elle prend la
 * date d'aujourd'hui : « elle a eu lieu » ne peut pas vouloir dire « dans le futur ».
 */
export function planConfirmSimulation(state, id, { today }) {
  const op = state.operations.find((o) => o.id === id);
  if (!op || !op.simulated) return { ok: false, errors: [err('id', "Cette simulation n'existe plus.", 'missing')] };
  const early = op.date > today;
  const real = makeOperation({ ...op, date: early ? today : op.date, time: early ? null : op.time, simulated: false, checked: true, updatedAt: new Date().toISOString() });
  const draft = new Draft(state);
  draft.put('operations', real);
  const shortfalls = findEnvelopeShortfalls(state, draft.state, today);
  if (real.kind === KIND.TRANSFER) {
    if (shortfalls.length) return { ok: false, errors: shortfallErrors(state, shortfalls) };
    return { ok: true, cs: draft.cs, op: real, topups: [] };
  }
  const topups = shortfalls.map((s) => ({ envelopeId: s.envelopeId, amount: s.shortfall, date: real.date }));
  return { ok: true, cs: draft.cs, op: real, topups };
}

/** Ajoute un tag à plusieurs opérations d'un coup. */
export function planAddTag(state, ids, tagId) {
  if (!state.tags.some((t) => t.id === tagId)) return { ok: false, errors: [err('tagId', "Ce tag n'existe plus.", 'missing')] };
  const draft = new Draft(state);
  for (const id of ids) {
    const op = draft.get('operations', id);
    if (op && op.kind !== KIND.TRANSFER && !op.tags.includes(tagId)) {
      draft.put('operations', { ...op, tags: [...op.tags, tagId], updatedAt: new Date().toISOString() });
    }
  }
  return { ok: true, cs: draft.cs };
}

/** Ce qu'une enveloppe peut encore sortir à une date donnée (pour les messages de l'interface). */
export function spendable(state, envelopeId, date, today) {
  return Math.max(0, envelopeLowPoint(state, envelopeId, date > today ? date : today));
}
