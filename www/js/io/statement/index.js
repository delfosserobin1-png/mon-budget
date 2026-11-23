// Point d'entrée de la lecture des relevés bancaires.
//
// Quel que soit le format du fichier, on obtient le même objet « relevé normalisé » :
// {
//   format: 'pdf' | 'ofx' | 'csv' | 'api' (connexion bancaire), bank, accountLabel,
//   periodStart, periodEnd,
//   openingDate, openingBalance,      // solde précédent imprimé (centimes) — null si absent
//   closingDate, closingBalance,      // nouveau solde imprimé — null si absent
//   totalDebit, totalCredit,          // totaux (positifs)
//   lines: [{ id, date, valueDate, amount, label, details, kind, opDate, time, counterparty, motif, suggestedLabel }],
//   checks: { totals: 'ok'|'ko'|'absent', balance: 'ok'|'ko'|'absent', … },
//   warnings: [texte], fingerprint
// }
// Pour ajouter une banque : écrire un lecteur qui renvoie ce même objet, et l'appeler ici.

import { sha256 } from '../../core/sha256.js';
import { parseStatementPages, StatementError } from './pdf-table.js';
import { decodeBytes, looksLikeBankJson, looksLikeOfx, parseBankJson, parseCsvStatement, parseOfx } from './text-formats.js';

export { StatementError };

/** Empreinte d'un relevé : deux fichiers qui décrivent le même relevé ont la même. */
export function fingerprintOf(statement) {
  const sum = statement.lines.reduce((acc, l) => acc + l.amount, 0);
  const core = [statement.bank, statement.accountKey || '', statement.periodStart, statement.periodEnd, statement.openingBalance, statement.closingBalance, statement.lines.length, sum];
  return sha256(core.join('|') + '|' + statement.lines.map((l) => `${l.date}:${l.amount}:${l.label}`).join('|'));
}

function seal(statement) {
  const { accountKey, ...rest } = statement;
  return { ...rest, fingerprint: fingerprintOf(statement) };
}

export function kindOfFile(name, bytes) {
  const lower = String(name || '').toLowerCase();
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head === '%PDF-' || lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) return 'ofx';
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  return 'unknown';
}

/**
 * Lit un fichier de relevé.
 * `pdfTools` = { loadPdfJs, extractPages } (fournis par l'appli ; dans les tests on passe pdf.js de Node).
 */
export async function readStatementFile({ name, bytes }, pdfTools) {
  if (!bytes || !bytes.length) throw new StatementError('Ce fichier est vide.', 'empty');
  const kind = kindOfFile(name, bytes);
  if (kind === 'pdf') {
    const pdfjs = await pdfTools.loadPdfJs();
    // pdf.js garde le tableau d'octets pour lui : on lui en donne une copie.
    const pages = await pdfTools.extractPages(pdfjs, bytes.slice());
    return seal(parseStatementPages(pages));
  }
  const text = decodeBytes(bytes);
  if (kind === 'json' || looksLikeBankJson(text)) return seal(parseBankJson(text));
  if (kind === 'ofx' || looksLikeOfx(text)) return seal(parseOfx(text));
  if (kind === 'csv' || /[;,\t]/.test(text.slice(0, 2000))) return seal(parseCsvStatement(text));
  throw new StatementError('Ce type de fichier n\'est pas pris en charge. Formats acceptés : PDF, OFX, CSV.', 'format');
}
