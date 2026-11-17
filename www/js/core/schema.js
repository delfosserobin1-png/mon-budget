// Modèle de données (version 2). Ce fichier décrit TOUT ce que l'appli enregistre : la forme de
// chaque fiche, ses valeurs par défaut, et les listes de référence (importance, fréquences, couleurs).
// Les montants sont en centimes (entiers), les dates en "AAAA-MM-JJ".

import { isValidISO } from './dates.js';
import { newId, PREFIX } from './ids.js';

export const SCHEMA_VERSION = 2;

/** Collections enregistrées (une « table » par nom). */
export const STORES = ['operations', 'envelopes', 'tags', 'recurring', 'reconciliations', 'statements', 'rules', 'bugReports', 'files'];

export const KIND = Object.freeze({ OPERATION: 'operation', TRANSFER: 'transfer', ADJUSTMENT: 'adjustment' });

export const IMPORTANCE = Object.freeze([
  { id: 'necessite', label: 'Nécessité' },
  { id: 'confort', label: 'Confort' },
  { id: 'caprice', label: 'Caprice' },
]);

export const FREQUENCIES = Object.freeze([
  { id: 'weekly', one: 'semaine', many: 'semaines', every: 'Chaque semaine' },
  { id: 'monthly', one: 'mois', many: 'mois', every: 'Chaque mois' },
  { id: 'yearly', one: 'an', many: 'ans', every: 'Chaque année' },
]);

/** Couleurs proposées pour les enveloppes et les tags (les teintes exactes sont dans le CSS). */
export const COLORS = Object.freeze(['bleu', 'vert', 'ambre', 'rouge', 'violet', 'sarcelle', 'rose', 'ardoise']);

export function emptyState() {
  const state = { settings: {} };
  for (const name of STORES) state[name] = [];
  return state;
}

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const strOrNull = (v) => (typeof v === 'string' && v ? v : null);
const int = (v, fallback = 0) => (Number.isFinite(v) ? Math.round(v) : fallback);
const bool = (v, fallback = false) => (typeof v === 'boolean' ? v : fallback);
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
const dateOr = (v, fallback = null) => (isValidISO(v) ? v : fallback);
const timeOrNull = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const nowISO = () => new Date().toISOString();

/** Opération, virement interne ou ajustement de rapprochement. */
export function makeOperation(input = {}) {
  const kind = oneOf(input.kind, Object.values(KIND), KIND.OPERATION);
  const isTransfer = kind === KIND.TRANSFER;
  const simulated = bool(input.simulated);
  const bank = input.bank && typeof input.bank === 'object' && isValidISO(input.bank.date)
    ? {
        date: input.bank.date,
        label: str(input.bank.label),
        details: Array.isArray(input.bank.details) ? input.bank.details.map(String) : [],
        statementId: strOrNull(input.bank.statementId),
        lineId: strOrNull(input.bank.lineId),
      }
    : null;
  return {
    id: str(input.id) || newId(PREFIX.operations),
    kind,
    date: dateOr(input.date, '1970-01-01'),
    time: timeOrNull(input.time),
    // Opération / ajustement : montant signé (négatif = dépense). Virement : montant positif.
    amount: isTransfer ? Math.abs(int(input.amount)) : int(input.amount),
    label: str(input.label).trim(),
    counterparty: str(input.counterparty).trim(),
    comment: str(input.comment).trim(),
    importance: isTransfer ? null : oneOf(input.importance, IMPORTANCE.map((i) => i.id), null),
    tags: isTransfer ? [] : list(input.tags),
    // Enveloppe qui porte la dépense (null = compte courant). Toujours null pour un virement.
    envelopeId: kind === KIND.OPERATION ? strOrNull(input.envelopeId) : null,
    // Virement : d'où part l'argent et où il arrive (null = compte courant).
    from: isTransfer ? strOrNull(input.from) : null,
    to: isTransfer ? strOrNull(input.to) : null,
    simulated,
    checked: simulated ? bool(input.checked, true) : true,
    recurringId: strOrNull(input.recurringId),
    // 'topup'   = virement de complément créé automatiquement pour qu'une enveloppe ne soit pas négative.
    // 'opening' = solde de départ (l'état du compte au moment où l'on commence à utiliser l'appli).
    auto: oneOf(input.auto, ['topup', 'opening'], null),
    photoIds: isTransfer ? [] : list(input.photoIds),
    bank: isTransfer || simulated ? null : bank,
    createdAt: str(input.createdAt) || nowISO(),
    updatedAt: str(input.updatedAt) || nowISO(),
  };
}

export function makeEnvelope(input = {}) {
  const goal = int(input.goalAmount, 0);
  return {
    id: str(input.id) || newId(PREFIX.envelopes),
    name: str(input.name).trim(),
    description: str(input.description).trim(),
    color: oneOf(input.color, COLORS, COLORS[0]),
    closed: bool(input.closed),
    closedAt: bool(input.closed) ? dateOr(input.closedAt, null) : null,
    goalAmount: goal > 0 ? goal : null,
    goalDate: goal > 0 ? dateOr(input.goalDate, null) : null,
    createdAt: str(input.createdAt) || nowISO(),
  };
}

export function makeTag(input = {}) {
  return {
    id: str(input.id) || newId(PREFIX.tags),
    name: str(input.name).trim(),
    color: oneOf(input.color, COLORS, COLORS[0]),
  };
}

export function makeRecurring(input = {}) {
  const kind = oneOf(input.kind, [KIND.OPERATION, KIND.TRANSFER], KIND.OPERATION);
  const isTransfer = kind === KIND.TRANSFER;
  return {
    id: str(input.id) || newId(PREFIX.recurring),
    kind,
    label: str(input.label).trim(),
    amount: isTransfer ? Math.abs(int(input.amount)) : int(input.amount),
    frequency: oneOf(input.frequency, FREQUENCIES.map((f) => f.id), 'monthly'),
    interval: Math.min(Math.max(int(input.interval, 1), 1), 99),
    startDate: dateOr(input.startDate, '1970-01-01'),
    endDate: dateOr(input.endDate, null),
    envelopeId: isTransfer ? null : strOrNull(input.envelopeId),
    from: isTransfer ? strOrNull(input.from) : null,
    to: isTransfer ? strOrNull(input.to) : null,
    tags: isTransfer ? [] : list(input.tags),
    importance: isTransfer ? null : oneOf(input.importance, IMPORTANCE.map((i) => i.id), null),
    counterparty: str(input.counterparty).trim(),
    comment: str(input.comment).trim(),
    active: bool(input.active, true),
    // Si la règle a été mise en pause par la clôture d'une enveloppe : id de cette enveloppe
    // (elle sera relancée à la réouverture). null = pause décidée par l'utilisateur, ou règle active.
    pausedBy: bool(input.active, true) ? null : strOrNull(input.pausedBy),
    // Numéro de la prochaine échéance à générer (0 = la toute première, à startDate).
    nextK: Math.max(int(input.nextK, 0), 0),
    createdAt: str(input.createdAt) || nowISO(),
  };
}

export function makeReconciliation(input = {}) {
  const real = int(input.realBalance);
  const computed = int(input.computedBalance);
  return {
    id: str(input.id) || newId(PREFIX.reconciliations),
    date: dateOr(input.date, '1970-01-01'),
    realBalance: real,
    computedBalance: computed,
    gap: real - computed,
    adjustmentOperationId: strOrNull(input.adjustmentOperationId),
    statementId: strOrNull(input.statementId),
    createdAt: str(input.createdAt) || nowISO(),
  };
}

export function makeStatement(input = {}) {
  return {
    id: str(input.id) || newId(PREFIX.statements),
    bank: str(input.bank),
    format: str(input.format),
    accountLabel: str(input.accountLabel),
    periodStart: dateOr(input.periodStart, null),
    periodEnd: dateOr(input.periodEnd, null),
    openingBalance: input.openingBalance == null ? null : int(input.openingBalance),
    closingBalance: input.closingBalance == null ? null : int(input.closingBalance),
    totalDebit: int(input.totalDebit),
    totalCredit: int(input.totalCredit),
    lineCount: int(input.lineCount),
    matchedCount: int(input.matchedCount),
    createdCount: int(input.createdCount),
    fingerprint: str(input.fingerprint),
    fileId: strOrNull(input.fileId),
    importedAt: str(input.importedAt) || nowISO(),
  };
}

/** Règle de catégorisation : « quand le tiers ressemble à ça, propose ces champs ». */
export function makeRule(input = {}) {
  return {
    id: str(input.id) || newId(PREFIX.rules),
    key: str(input.key),
    display: str(input.display).trim(),
    label: str(input.label).trim(),
    tags: list(input.tags),
    envelopeId: strOrNull(input.envelopeId),
    importance: oneOf(input.importance, IMPORTANCE.map((i) => i.id), null),
    uses: Math.max(int(input.uses, 0), 0),
    updatedAt: str(input.updatedAt) || nowISO(),
  };
}

export const COMMENT_KIND_IDS = Object.freeze(['bug', 'idee', 'question']);

/** Suivi d'un commentaire déposé dans la boîte à commentaires (voir core/comments.js), ou null. */
function remoteOrNull(input) {
  if (!input || typeof input !== 'object' || !Number.isInteger(input.number) || input.number <= 0) return null;
  const thread = Array.isArray(input.thread)
    ? input.thread
        .filter((m) => m && typeof m === 'object' && typeof m.text === 'string' && m.text)
        .map((m) => ({ id: str(m.id), at: str(m.at), from: m.from === 'moi' ? 'moi' : 'claude', text: m.text }))
    : [];
  return {
    number: input.number,
    url: str(input.url),
    state: input.state === 'closed' ? 'closed' : 'open',
    thread,
    seen: Math.max(int(input.seen, 0), 0), // nombre de réponses de Claude déjà lues
    syncedAt: strOrNull(input.syncedAt),
  };
}

/**
 * Commentaire pour Claude (problème, idée, question). Le nom « bugReport » date de la première
 * version, où il ne s'agissait que de signalements de bugs : il est gardé pour que les anciennes
 * sauvegardes restent lisibles.
 */
export function makeBugReport(input = {}) {
  const remote = remoteOrNull(input.remote);
  return {
    id: str(input.id) || newId(PREFIX.bugReports),
    kind: oneOf(input.kind, COMMENT_KIND_IDS, 'bug'),
    text: str(input.text).trim(),
    steps: str(input.steps).trim(),
    screen: str(input.screen),
    appVersion: str(input.appVersion),
    device: str(input.device),
    diagnostics: str(input.diagnostics),
    photoIds: list(input.photoIds),
    // Partagé à la main, ou déposé dans la boîte à commentaires (dans ce cas `remote` est rempli).
    sentAt: strOrNull(input.sentAt),
    // Envoi demandé mais pas encore abouti (hors connexion…) : il sera retenté tout seul.
    queued: remote ? false : bool(input.queued),
    remote,
    createdAt: str(input.createdAt) || nowISO(),
  };
}

/** Fiche descriptive d'une pièce jointe (le contenu binaire est rangé à part). */
export function makeFile(input = {}) {
  return {
    id: str(input.id) || newId(PREFIX.files),
    kind: oneOf(input.kind, ['photo', 'statement', 'bug'], 'photo'),
    name: str(input.name),
    mime: str(input.mime) || 'application/octet-stream',
    size: Math.max(int(input.size, 0), 0),
    createdAt: str(input.createdAt) || nowISO(),
  };
}

export const MAKERS = Object.freeze({
  operations: makeOperation,
  envelopes: makeEnvelope,
  tags: makeTag,
  recurring: makeRecurring,
  reconciliations: makeReconciliation,
  statements: makeStatement,
  rules: makeRule,
  bugReports: makeBugReport,
  files: makeFile,
});

export function importanceLabel(id) {
  return IMPORTANCE.find((i) => i.id === id)?.label || '';
}

/** "Chaque mois", "Toutes les 2 semaines", "Tous les 3 mois"… */
export function frequencyLabel(frequency, interval = 1) {
  const f = FREQUENCIES.find((x) => x.id === frequency) || FREQUENCIES[1];
  if (interval <= 1) return f.every;
  return `${f.id === 'weekly' ? 'Toutes les' : 'Tous les'} ${interval} ${f.many}`;
}
