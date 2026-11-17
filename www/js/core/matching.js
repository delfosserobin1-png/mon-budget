// Rapprochement d'un relevé bancaire avec les opérations saisies dans l'appli.
//
// Entrée : un relevé « normalisé » (voir io/statement) dont chaque ligne porte
//   { id, date (date banque), opDate (date réelle de l'achat ou du virement, si connue), amount
//     (centimes signés), label, details, counterparty, motif, time, suggestedLabel }.
// Trois issues possibles pour chaque ligne :
//   - CORRESPONDANCE : une opération de l'appli a le même montant à une date proche → on fusionne
//     (les champs de l'utilisateur sont gardés, les vides sont complétés par ceux de la banque) ;
//   - MANQUANTE dans l'appli → on propose de la créer, pré-remplie ;
//   - DÉJÀ IMPORTÉE (même ligne pointée par un import précédent) → ignorée.
// Et, côté appli, les opérations de la période absentes du relevé (« EN TROP ») sont listées : le
// plus souvent des paiements pas encore débités, parfois des doublons ou des erreurs.

import { Draft } from './changeset.js';
import { KIND, makeOperation, makeReconciliation, makeStatement } from './schema.js';
import { addDays, daysBetween, isValidISO } from './dates.js';
import { wordOverlap } from './text.js';
import { computeBalances, findEnvelopeShortfalls } from './balances.js';
import { bankBalanceAt, openingOperation } from './reconciliation.js';
import { learnInto, suggestFor } from './rules.js';

/** Tolérance sur la date (en jours) pour reconnaître une même opération. */
export const MATCH_WINDOW_DAYS = 4;

const err = (field, message, code = 'invalid') => ({ field, message, code });

/** Date à comparer avec celle saisie par l'utilisateur : la date réelle si le relevé la donne. */
export function referenceDate(line) {
  return line.opDate || line.date;
}

function isCandidate(op) {
  return !op.simulated && op.kind === KIND.OPERATION && !op.bank;
}

/** Bornes de la période couverte par le relevé (à défaut, dates extrêmes de ses lignes). */
export function statementPeriod(statement) {
  let start = statement.periodStart || null;
  let end = statement.periodEnd || null;
  if (!start || !end) {
    for (const line of statement.lines) {
      if (!start || line.date < start) start = line.date;
      if (!end || line.date > end) end = line.date;
    }
  }
  return { start, end };
}

/**
 * Compare un relevé aux opérations de l'appli.
 * Renvoie {
 *   matches: [{ lineId, opId, gap (jours), overlap (0..1), sure }],
 *   already: [lineId],     // lignes déjà importées auparavant
 *   missing: [lineId],     // lignes sans correspondance
 *   extra:   [opId],       // opérations de l'appli absentes du relevé, sur la période
 * }
 */
export function matchStatement(state, statement, { window = MATCH_WINDOW_DAYS } = {}) {
  // 1. Lignes déjà importées
  const already = new Set();
  const consumed = new Set();
  const pointed = state.operations.filter((op) => op.bank && !op.simulated);
  for (const line of statement.lines) {
    const twin = pointed.find((op) => !consumed.has(op.id) && op.amount === line.amount && op.bank.date === line.date && op.bank.label === line.label);
    if (twin) {
      consumed.add(twin.id);
      already.add(line.id);
    }
  }

  // 2. Paires possibles (même montant, date dans la fenêtre)
  const byAmount = new Map();
  for (const op of state.operations) {
    if (!isCandidate(op)) continue;
    if (!byAmount.has(op.amount)) byAmount.set(op.amount, []);
    byAmount.get(op.amount).push(op);
  }
  const pairs = [];
  for (const line of statement.lines) {
    if (already.has(line.id)) continue;
    const ref = referenceDate(line);
    const lo = addDays(ref, -window);
    const afterBank = addDays(line.date, 1);
    const afterRef = addDays(ref, window);
    const hi = afterBank > afterRef ? afterBank : afterRef;
    for (const op of byAmount.get(line.amount) || []) {
      if (op.date < lo || op.date > hi) continue;
      const mine = `${op.label} ${op.counterparty}`;
      const theirs = `${line.counterparty || ''} ${line.label} ${line.motif || ''}`;
      pairs.push({
        lineId: line.id,
        opId: op.id,
        gap: Math.abs(daysBetween(op.date, ref)),
        overlap: Math.max(wordOverlap(mine, theirs), wordOverlap(line.counterparty || '', mine)),
      });
    }
  }

  // 3. Attribution : d'abord les dates les plus proches, puis les libellés les plus ressemblants
  pairs.sort((a, b) => a.gap - b.gap || b.overlap - a.overlap || (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0));
  const lineTaken = new Map();
  const opTaken = new Set();
  for (const pair of pairs) {
    if (lineTaken.has(pair.lineId) || opTaken.has(pair.opId)) continue;
    lineTaken.set(pair.lineId, pair);
    opTaken.add(pair.opId);
  }

  // 4. Une correspondance est « sûre » si la date tombe juste, ou à un jour près sans concurrente
  const matches = [];
  for (const pair of lineTaken.values()) {
    let sure = pair.gap === 0;
    if (!sure && pair.gap <= 1) {
      const rival = pairs.some(
        (p) => p !== pair && p.gap <= pair.gap && ((p.lineId === pair.lineId && p.opId !== pair.opId) || (p.opId === pair.opId && p.lineId !== pair.lineId)),
      );
      sure = !rival;
    }
    matches.push({ ...pair, sure });
  }
  const order = new Map(statement.lines.map((l, i) => [l.id, i]));
  matches.sort((a, b) => order.get(a.lineId) - order.get(b.lineId));

  const missing = statement.lines.filter((l) => !already.has(l.id) && !lineTaken.has(l.id)).map((l) => l.id);

  // 5. Opérations de l'appli sur la période, absentes du relevé
  const { start, end } = statementPeriod(statement);
  const extra = [];
  if (start && end) {
    for (const op of state.operations) {
      if (!isCandidate(op) || opTaken.has(op.id)) continue;
      if (op.date >= start && op.date <= end) extra.push(op.id);
    }
  }
  return { matches, already: [...already], missing, extra };
}

/** Champs proposés pour créer l'opération d'une ligne manquante. */
export function proposeForLine(state, line) {
  const hint = suggestFor(state, { counterparty: line.counterparty || '', label: line.suggestedLabel || line.label });
  return {
    date: referenceDate(line),
    label: hint?.label || line.suggestedLabel || line.label,
    counterparty: line.counterparty || '',
    tags: hint?.tags || [],
    envelopeId: line.amount < 0 ? hint?.envelopeId || null : null,
    importance: line.amount < 0 ? hint?.importance || null : null,
    comment: '',
    hinted: !!hint,
  };
}

/** Champs que la fusion compléterait sur une opération existante (pour l'afficher avant de valider). */
export function mergePreview(op, line) {
  const added = [];
  if (!op.counterparty && line.counterparty) added.push({ field: 'counterparty', label: 'Tiers', value: line.counterparty });
  if (!op.time && line.time) added.push({ field: 'time', label: 'Heure', value: line.time });
  if (!op.label && line.suggestedLabel) added.push({ field: 'label', label: 'Libellé', value: line.suggestedLabel });
  if (op.amount !== line.amount) added.push({ field: 'amount', label: 'Montant corrigé', value: line.amount });
  return added;
}

function totalToday(state, today) {
  return computeBalances(state, { upTo: today }).total;
}

/**
 * Construit le lot de modifications d'un import de relevé, à partir des décisions prises dans
 * l'assistant :
 *   decisions.lines[lineId] = { action: 'merge', opId } | { action: 'create', fields } | { action: 'skip' }
 *   decisions.extras[opId]  = 'keep' (défaut) | 'delete'
 *   decisions.opening       = 'adjust' (défaut) | 'ignore'   — écart avant le relevé
 *   decisions.closing       = 'adjust' (défaut) | 'ignore'   — écart restant à la fin du relevé
 *   decisions.keepCurrent   = true | false                   — relevé d'historique : ne pas changer le solde d'aujourd'hui
 *   decisions.learn         = true (défaut) | false          — retenir les règles automatiques
 * Rien n'est enregistré : le lot renvoyé se valide (et s'annule) d'un seul bloc.
 */
export function planStatementImport(state, statement, decisions = {}, { today, file = null } = {}) {
  const errors = [];
  if (!statement?.lines?.length) return { ok: false, errors: [err('statement', 'Ce relevé ne contient aucune opération.')] };
  const { start, end } = statementPeriod(statement);
  const draft = new Draft(state);
  const record = makeStatement({
    bank: statement.bank,
    format: statement.format,
    accountLabel: statement.accountLabel,
    periodStart: start,
    periodEnd: end,
    openingBalance: statement.openingBalance,
    closingBalance: statement.closingBalance,
    totalDebit: statement.totalDebit ?? 0,
    totalCredit: statement.totalCredit ?? 0,
    lineCount: statement.lines.length,
    fingerprint: statement.fingerprint || '',
    fileId: file?.id || null,
  });
  if (file) draft.put('files', file);

  const summary = { merged: 0, created: 0, skipped: 0, already: 0, deleted: 0, kept: 0, pendingSum: 0, topups: [], openingGap: 0, openingAdjusted: false, closingGap: 0, residual: 0, closingAdjusted: false, historyShift: 0 };
  const knownTags = new Set(state.tags.map((t) => t.id));
  const usedOps = new Set();
  const touched = []; // opérations créées ou fusionnées par cet import
  const now = new Date().toISOString();
  const learn = decisions.learn !== false;

  for (const line of statement.lines) {
    const decision = decisions.lines?.[line.id] || { action: 'skip' };
    const bank = { date: line.date, label: line.label, details: line.details || [], statementId: record.id, lineId: line.id };
    if (decision.action === 'merge') {
      const op = draft.get('operations', decision.opId);
      if (!op || !isCandidate(op) || usedOps.has(op.id)) {
        errors.push(err(line.id, `L'opération associée à « ${line.label} » n'est plus disponible.`, 'missing'));
        continue;
      }
      usedOps.add(op.id);
      const merged = makeOperation({
        ...op,
        amount: line.amount,
        time: op.time || line.time || null,
        counterparty: op.counterparty || line.counterparty || '',
        label: op.label || line.suggestedLabel || line.label,
        // Un revenu ne peut pas être rangé dans une enveloppe (cas d'un montant corrigé qui change de signe).
        envelopeId: line.amount < 0 ? op.envelopeId : null,
        bank,
        updatedAt: now,
      });
      draft.put('operations', merged);
      touched.push(merged);
      summary.merged++;
      if (learn) learnInto(draft, merged);
    } else if (decision.action === 'create') {
      const f = decision.fields || {};
      const env = f.envelopeId && line.amount < 0 ? draft.get('envelopes', f.envelopeId) : null;
      const created = makeOperation({
        kind: KIND.OPERATION,
        date: isValidISO(f.date) ? f.date : referenceDate(line),
        time: line.time || null,
        amount: line.amount,
        label: (f.label ?? line.suggestedLabel ?? line.label) || line.label,
        counterparty: f.counterparty ?? line.counterparty ?? '',
        comment: f.comment || '',
        importance: f.importance || null,
        tags: (f.tags || []).filter((id) => knownTags.has(id)),
        envelopeId: env && !env.closed ? env.id : null,
        bank,
      });
      draft.put('operations', created);
      touched.push(created);
      summary.created++;
      if (learn) learnInto(draft, created);
    } else if (decision.action === 'already') {
      summary.already++;
    } else {
      summary.skipped++;
    }
  }
  if (errors.length) return { ok: false, errors };

  // Opérations de l'appli absentes du relevé
  for (const [opId, choice] of Object.entries(decisions.extras || {})) {
    const op = draft.get('operations', opId);
    if (!op || !isCandidate(op) || usedOps.has(opId)) continue;
    if (choice === 'delete') {
      draft.del('operations', opId);
      summary.deleted++;
    }
  }
  if (start && end) {
    for (const op of draft.state.operations) {
      if (isCandidate(op) && op.date >= start && op.date <= end) {
        summary.kept++;
        summary.pendingSum += op.amount;
      }
    }
  }

  // Écart AVANT le relevé : le solde précédent imprimé par la banque fait foi.
  const openingDate = statement.openingDate || (start ? addDays(start, -1) : null);
  if (statement.openingBalance != null && openingDate) {
    summary.openingGap = statement.openingBalance - bankBalanceAt(draft.state, openingDate);
    if (summary.openingGap !== 0 && decisions.opening !== 'ignore') {
      const nothingBefore = startsHistory(state, openingDate);
      // Un achat par carte fait deux jours avant le relevé y figure quand même (il est débité
      // après). L'ajustement est donc daté de la veille de la plus ancienne opération touchée :
      // l'historique ne commence pas par un faux passage à découvert.
      let earliest = openingDate;
      for (const op of touched) if (op.date < earliest) earliest = op.date;
      const date = earliest < openingDate ? addDays(earliest, -1) : openingDate;
      draft.put(
        'operations',
        makeOperation({
          kind: KIND.ADJUSTMENT,
          date,
          amount: summary.openingGap,
          label: nothingBefore ? 'Solde de départ' : 'Ajustement avant relevé',
          comment: `D'après le solde indiqué par la banque au ${openingDate.split('-').reverse().join('-')} (début du relevé).`,
          auto: nothingBefore ? 'opening' : null,
        }),
      );
      summary.openingAdjusted = true;
      summary.openingAdjustDate = date;
    }
  }

  // Écart À LA FIN du relevé. Les opérations « en trop » gardées (pas encore débitées) expliquent
  // une partie de l'écart : seul le reste (« résidu ») mérite un ajustement.
  let reconciliation = null;
  if (statement.closingBalance != null && end) {
    const computed = bankBalanceAt(draft.state, end);
    summary.closingGap = statement.closingBalance - computed;
    summary.residual = summary.closingGap + summary.pendingSum;
    let adjustmentId = null;
    if (summary.residual !== 0 && decisions.closing !== 'ignore') {
      const adjustment = makeOperation({ kind: KIND.ADJUSTMENT, date: end, amount: summary.residual, label: 'Ajustement de rapprochement' });
      draft.put('operations', adjustment);
      adjustmentId = adjustment.id;
      summary.closingAdjusted = true;
    }
    reconciliation = makeReconciliation({
      date: end,
      realBalance: statement.closingBalance,
      computedBalance: bankBalanceAt(draft.state, end),
      adjustmentOperationId: adjustmentId,
      statementId: record.id,
    });
    draft.put('reconciliations', reconciliation);
  }

  // Enveloppes : une dépense importée ne doit pas en mettre une à découvert → complément automatique.
  for (let pass = 0; pass < 3; pass++) {
    const shortfalls = findEnvelopeShortfalls(state, draft.state, today);
    if (!shortfalls.length) break;
    for (const s of shortfalls) {
      const dates = touched.filter((op) => op.envelopeId === s.envelopeId).map((op) => op.date).sort();
      const topup = makeOperation({ kind: KIND.TRANSFER, from: null, to: s.envelopeId, amount: s.shortfall, date: dates[0] || today, auto: 'topup', label: 'Complément automatique' });
      draft.put('operations', topup);
      summary.topups.push({ envelopeId: s.envelopeId, amount: s.shortfall, date: topup.date });
    }
  }

  // Relevé d'historique (antérieur au solde de départ) : le solde d'aujourd'hui ne doit pas bouger.
  summary.totalBefore = totalToday(state, today);
  if (decisions.keepCurrent && end) {
    const shift = summary.totalBefore - totalToday(draft.state, today);
    if (shift !== 0) {
      const anchor = openingOperation(state);
      const date = anchor && anchor.date > end ? anchor.date : addDays(end, 1);
      draft.put('operations', makeOperation({ kind: KIND.ADJUSTMENT, date: date > today ? today : date, amount: shift, label: "Opérations non saisies après le relevé" }));
      summary.historyShift = shift;
    }
  }
  summary.totalAfter = totalToday(draft.state, today);

  const finalRecord = { ...record, matchedCount: summary.merged, createdCount: summary.created };
  draft.put('statements', finalRecord);
  return { ok: true, cs: draft.cs, statement: finalRecord, reconciliation, summary };
}

/**
 * Le solde précédent du relevé devient-il le solde de départ de l'appli ? Oui s'il n'y a encore
 * ni solde de départ, ni opération réelle jusqu'à la veille du relevé.
 */
export function startsHistory(state, openingDate) {
  if (openingOperation(state)) return false;
  return !state.operations.some((op) => !op.simulated && op.kind !== KIND.TRANSFER && (op.bank?.date || op.date) <= openingDate);
}

/** Le relevé précède-t-il le solde de départ ? (dans ce cas on propose de ne pas toucher au solde actuel) */
export function isHistoryImport(state, statement) {
  const anchor = openingOperation(state);
  const { end } = statementPeriod(statement);
  return !!(anchor && end && end < anchor.date);
}

/** Un relevé identique a-t-il déjà été importé ? Renvoie sa fiche, ou null. */
export function findSameStatement(state, statement) {
  if (!statement.fingerprint) return null;
  return state.statements.find((s) => s.fingerprint === statement.fingerprint) || null;
}

/**
 * Retire un relevé des archives : les opérations restent, mais ne sont plus « pointées ».
 * Les constats de rapprochement liés sont conservés (détachés du relevé).
 */
export function planDeleteStatement(state, id) {
  const record = state.statements.find((s) => s.id === id);
  if (!record) return { ok: false, errors: [err('id', "Ce relevé n'existe plus.", 'missing')] };
  const draft = new Draft(state);
  for (const op of state.operations) {
    if (op.bank?.statementId === id) draft.put('operations', { ...op, bank: null });
  }
  for (const rec of state.reconciliations) {
    if (rec.statementId === id) draft.put('reconciliations', { ...rec, statementId: null });
  }
  if (record.fileId) draft.del('files', record.fileId);
  draft.del('statements', id);
  return { ok: true, cs: draft.cs };
}
