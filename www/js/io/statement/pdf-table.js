// Lecture d'un relevé de compte PDF « en tableau » (colonnes Date / Valeur / Nature / Débit / Crédit).
//
// Le PDF est d'abord réduit à une liste de petits textes positionnés (voir pdf.js : { str, x, y, w,
// rot } avec x,y = coin bas-gauche du texte, en points, origine en bas à gauche de la page).
// Le sens d'un montant ne se lit PAS dans le texte (il n'y a pas de signe) mais dans sa position :
// aligné sous « Débit » ou sous « Crédit ». C'est pourquoi on travaille sur les coordonnées.
//
// Mis au point sur les relevés Société Générale ; fonctionne pour toute banque qui présente ses
// relevés avec ces mêmes colonnes. Les soldes imprimés servent de preuve : si « solde précédent +
// crédits − débits » retombe sur le « nouveau solde », la lecture est exacte.

import { parseFrenchDate } from '../../core/dates.js';
import { parseStatementAmount } from '../../core/money.js';
import { normalize } from '../../core/text.js';
import { interpretLine } from './labels.js';

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const AMOUNT_RE = /^[+-]?\s?\d{1,3}(?:[. ]\d{3})*,\d{2}$/;
const ROW_TOLERANCE = 3; // points : deux textes à moins de 3 pt de hauteur d'écart sont sur la même ligne

export class StatementError extends Error {
  constructor(message, code = 'unreadable') {
    super(message);
    this.name = 'StatementError';
    this.code = code;
  }
}

/** Regroupe les textes d'une page en lignes (de haut en bas), chaque ligne triée de gauche à droite. */
export function groupRows(items) {
  const sorted = items
    .filter((it) => it.str && it.str.trim() && Math.abs(it.rot || 0) < 5)
    .map((it) => ({ ...it, str: it.str.trim() }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - it.y) <= ROW_TOLERANCE) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.text = row.items.map((it) => it.str).join(' ');
    row.norm = normalize(row.text);
  }
  return rows;
}

function findHeader(rows) {
  for (const row of rows) {
    const find = (re) => row.items.find((it) => re.test(normalize(it.str)));
    const date = find(/^date$/);
    const debit = find(/^debit$/);
    const credit = find(/^credit$/);
    if (date && debit && credit && debit.x < credit.x) {
      const valeur = find(/^valeur$/);
      const label = row.items.find((it) => it !== date && it !== valeur && it.x > date.x && it.x < debit.x);
      return { row, date, valeur, label, debit, credit };
    }
  }
  return null;
}

function amountCents(text) {
  return parseStatementAmount(text.replace(/(\d) (\d{3})/g, '$1.$2'));
}

/**
 * pages : [{ items: [{ str, x, y, w, rot }] }]
 * Renvoie le relevé normalisé (voir io/statement/index.js) ou lève StatementError.
 */
export function parseStatementPages(pages) {
  const raw = [];
  const warnings = [];
  const checkpoints = [];
  let opening = null;
  let closing = null;
  let totals = null;
  let period = null;
  let account = '';
  let bank = '';
  let finished = false;
  let headerSeen = false;
  let current = null;
  let labelX = null;

  pages.forEach((page, pageIndex) => {
    const rows = groupRows(page.items || []);
    for (const row of rows) {
      if (!period) {
        const m = /du\s+(\d{2}\/\d{2}\/\d{4})\s+au\s+(\d{2}\/\d{2}\/\d{4})/i.exec(row.text);
        if (m) period = { start: parseFrenchDate(m[1]), end: parseFrenchDate(m[2]) };
      }
      if (!account) {
        const m = /n°\s*((?:\d[\d ]{8,}\d))/.exec(row.text);
        if (m) account = m[1].replace(/\s+/g, '');
      }
      if (!bank && /societe generale|particuliers\.sg\.fr/.test(row.norm)) bank = 'Société Générale';
    }
    if (finished) return;
    const header = findHeader(rows);
    if (!header) return;
    headerSeen = true;
    const boundary = (header.debit.x + header.debit.w + header.credit.x) / 2;
    const dateZoneEnd = header.date.x + header.date.w + 12;
    const labelZoneStart = header.valeur ? header.valeur.x + header.valeur.w : dateZoneEnd;
    const amountZoneStart = header.debit.x - 50;
    let previousY = header.row.y;
    let firstOfPage = true;

    for (const row of rows) {
      if (row.y >= header.row.y - 1 || finished) continue;
      const first = row.items[0];
      const amounts = row.items.filter((it) => AMOUNT_RE.test(it.str) && it.x >= amountZoneStart && it.x + it.w > header.debit.x);
      const signed = (it) => {
        const value = amountCents(it.str);
        if (value === null) return null;
        if (/^[+-]/.test(it.str)) return value;
        return it.x + it.w <= boundary ? -value : value;
      };

      if (/solde precedent au/.test(row.norm) || /ancien solde/.test(row.norm)) {
        const m = /(\d{2}\/\d{2}\/\d{4})/.exec(row.text);
        if (amounts.length) opening = { date: m ? parseFrenchDate(m[1]) : null, amount: signed(amounts[amounts.length - 1]) };
        current = null;
        previousY = row.y;
        firstOfPage = false;
        continue;
      }
      if (/totaux? des mouvements/.test(row.norm)) {
        const values = amounts.map((it) => ({ it, cents: amountCents(it.str) })).filter((v) => v.cents !== null);
        totals = { debit: 0, credit: 0 };
        for (const v of values) {
          if (v.it.x + v.it.w <= boundary) totals.debit = v.cents;
          else totals.credit = v.cents;
        }
        current = null;
        firstOfPage = false;
        continue;
      }
      if (/nouveau solde au/.test(row.norm) || /^solde (crediteur|debiteur) au/.test(row.norm)) {
        const m = /(\d{2}\/\d{2}\/\d{4})/.exec(row.text);
        if (amounts.length) {
          let amount = signed(amounts[amounts.length - 1]);
          if (/solde debiteur/.test(row.norm) && amount > 0) amount = -amount;
          closing = { date: m ? parseFrenchDate(m[1]) : null, amount };
          finished = true;
        }
        current = null;
        continue;
      }
      const checkpoint = /solde au\s+(\d{2}\/\d{2}\/\d{4})\s*([+-])?\s*((?:\d{1,3}(?:[. ]\d{3})*),\d{2})/i.exec(row.text);
      if (checkpoint && /\*/.test(row.text)) {
        const value = amountCents(checkpoint[3]);
        if (value !== null) checkpoints.push({ date: parseFrenchDate(checkpoint[1]), amount: checkpoint[2] === '-' ? -value : value, after: raw.length });
        previousY = row.y;
        firstOfPage = false;
        continue;
      }

      const isStart = DATE_RE.test(first.str) && first.x < dateZoneEnd && amounts.length >= 1;
      if (isStart) {
        const dates = row.items.filter((it) => DATE_RE.test(it.str) && it.x < labelZoneStart + 2);
        const texts = row.items.filter((it) => !dates.includes(it) && !amounts.includes(it) && it.x < amountZoneStart + 20);
        const amount = signed(amounts[amounts.length - 1]);
        const date = parseFrenchDate(dates[0].str);
        if (amount === null || !date || !texts.length) {
          warnings.push(`Ligne illisible ignorée (page ${pageIndex + 1}) : « ${row.text} ».`);
          current = null;
          continue;
        }
        if (labelX === null || texts[0].x < labelX) labelX = Math.min(labelX ?? texts[0].x, texts[0].x);
        current = {
          date,
          valueDate: dates[1] ? parseFrenchDate(dates[1].str) : null,
          amount,
          label: texts.map((it) => it.str).join(' '),
          details: [],
          page: pageIndex + 1,
        };
        raw.push(current);
        previousY = row.y;
        firstOfPage = false;
        continue;
      }

      // Ligne de détail : dans la colonne du libellé, sans montant, juste sous la ligne précédente
      // (ou tout en haut de la page suivante, quand une opération est à cheval sur deux pages).
      // Tout le reste (pied de page, mention « suite », texte libre) est ignoré.
      const inLabelColumn = first.x >= labelZoneStart - 2 && first.x < amountZoneStart && (labelX === null || first.x >= labelX - 3);
      const near = firstOfPage || previousY - row.y <= 26;
      if (current && inLabelColumn && near && !amounts.length) {
        current.details.push(row.items.filter((it) => it.x < amountZoneStart + 20).map((it) => it.str).join(' '));
        previousY = row.y;
        firstOfPage = false;
      }
    }
  });

  if (!headerSeen) {
    throw new StatementError("Ce PDF ne ressemble pas à un relevé de compte : le tableau « Date / Débit / Crédit » est introuvable.", 'not-a-statement');
  }
  if (!raw.length) throw new StatementError("Aucune opération n'a été trouvée dans ce relevé.", 'empty');

  const lines = raw.map((line, i) => interpretLine({ ...line, id: `L${String(i + 1).padStart(3, '0')}`, bank }));
  let computedDebit = 0;
  let computedCredit = 0;
  for (const line of lines) {
    if (line.amount < 0) computedDebit += -line.amount;
    else computedCredit += line.amount;
  }
  const checks = { totals: 'absent', balance: 'absent', computedDebit, computedCredit, computedClosing: null };
  if (totals) checks.totals = totals.debit === computedDebit && totals.credit === computedCredit ? 'ok' : 'ko';
  if (opening?.amount != null && closing?.amount != null) {
    checks.computedClosing = opening.amount + computedCredit - computedDebit;
    checks.balance = checks.computedClosing === closing.amount ? 'ok' : 'ko';
  }
  if (opening?.amount != null) {
    for (const cp of checkpoints) {
      let running = opening.amount;
      for (let i = 0; i < cp.after; i++) running += lines[i].amount;
      if (running !== cp.amount) warnings.push(`Le solde intermédiaire imprimé au ${cp.date ? cp.date.split('-').reverse().join('-') : '?'} ne correspond pas aux lignes lues.`);
    }
  }
  if (checks.totals === 'ko') warnings.push('Les totaux imprimés sur le relevé ne correspondent pas à la somme des lignes lues.');
  if (checks.balance === 'ko') warnings.push('Le nouveau solde imprimé ne correspond pas au solde précédent corrigé des lignes lues.');

  const first = lines[0].date;
  const last = lines[lines.length - 1].date;
  return {
    format: 'pdf',
    bank,
    accountLabel: account ? `Compte se terminant par ${account.slice(-4)}` : '',
    accountKey: account,
    periodStart: period?.start || first,
    periodEnd: period?.end || closing?.date || last,
    openingDate: opening?.date || null,
    openingBalance: opening?.amount ?? null,
    closingDate: closing?.date || null,
    closingBalance: closing?.amount ?? null,
    totalDebit: totals ? totals.debit : computedDebit,
    totalCredit: totals ? totals.credit : computedCredit,
    lines,
    checks,
    warnings,
  };
}
