// Relevés au format texte : OFX (proposé par la plupart des banques françaises sous le nom
// « Money » ou « Quicken ») et CSV (« Excel »). Ces formats donnent directement le signe des
// montants ; ils servent de solution de repli pour les banques dont le PDF n'est pas reconnu.

import { isValidISO, makeISO, parseFrenchDate } from '../../core/dates.js';
import { normalize } from '../../core/text.js';
import { interpretLine } from './labels.js';
import { StatementError } from './pdf-table.js';

/** Décode un fichier texte : UTF-8, sinon l'encodage Windows des vieux exports bancaires. */
export function decodeBytes(bytes) {
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes(String.fromCharCode(0xfffd))) {
    try {
      text = new TextDecoder('windows-1252').decode(bytes);
    } catch {
      /* on garde la lecture UTF-8 */
    }
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function finish(format, bank, rawLines, extra = {}) {
  if (!rawLines.length) throw new StatementError("Aucune opération n'a été trouvée dans ce fichier.", 'empty');
  // ordre chronologique (beaucoup de banques exportent du plus récent au plus ancien)
  const ordered = rawLines.map((l, i) => ({ l, i })).sort((a, b) => (a.l.date === b.l.date ? a.i - b.i : a.l.date < b.l.date ? -1 : 1)).map((x) => x.l);
  const lines = ordered.map((line, i) => interpretLine({ ...line, id: `L${String(i + 1).padStart(3, '0')}`, bank }));
  let computedDebit = 0;
  let computedCredit = 0;
  for (const line of lines) {
    if (line.amount < 0) computedDebit += -line.amount;
    else computedCredit += line.amount;
  }
  return {
    format,
    bank,
    accountLabel: extra.account ? `Compte se terminant par ${String(extra.account).slice(-4)}` : '',
    accountKey: extra.account || '',
    periodStart: extra.periodStart || lines[0].date,
    periodEnd: extra.periodEnd || lines[lines.length - 1].date,
    openingDate: null,
    openingBalance: null,
    closingDate: extra.closingDate || null,
    closingBalance: extra.closingBalance ?? null,
    totalDebit: computedDebit,
    totalCredit: computedCredit,
    lines,
    checks: { totals: 'absent', balance: 'absent', computedDebit, computedCredit, computedClosing: null },
    warnings: extra.warnings || [],
  };
}

function toCents(text) {
  const s = String(text ?? '').replace(/[\s€]/g, '').replace(String.fromCharCode(0x2212), '-');
  if (!s) return null;
  let m;
  // 1.234,56 ou 1234,56 (français)
  if ((m = /^([+-])?(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(s))) {
    const cents = Number(m[2].replace(/\./g, '')) * 100 + Number((m[3] + '0').slice(0, 2));
    return m[1] === '-' ? -cents : cents;
  }
  // 1,234.56 ou 1234.56 ou 1234 (anglais / entier)
  if ((m = /^([+-])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s))) {
    const cents = Number(m[2].replace(/,/g, '')) * 100 + Number(((m[3] || '') + '00').slice(0, 2));
    return m[1] === '-' ? -cents : cents;
  }
  return null;
}

function toDate(text) {
  const s = String(text ?? '').trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return isValidISO(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  if ((m = /^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$/.exec(s))) return parseFrenchDate(s);
  if ((m = /^(\d{2})[/\-.](\d{2})[/\-.](\d{2})$/.exec(s))) {
    const iso = makeISO(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
    return isValidISO(iso) ? iso : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// OFX
// ---------------------------------------------------------------------------------------------

export function looksLikeOfx(text) {
  return /<OFX>|OFXHEADER/i.test(text.slice(0, 2000));
}

function ofxValue(block, tag) {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? m[1].trim() : '';
}

function ofxDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isValidISO(iso) ? iso : null;
}

export function parseOfx(text) {
  const rawLines = [];
  const warnings = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const chunk of blocks) {
    const block = chunk.split(/<\/STMTTRN>/i)[0];
    const date = ofxDate(ofxValue(block, 'DTPOSTED'));
    const amount = toCents(ofxValue(block, 'TRNAMT'));
    const name = ofxValue(block, 'NAME');
    const memo = ofxValue(block, 'MEMO');
    if (!date || amount === null) {
      warnings.push('Une opération illisible a été ignorée.');
      continue;
    }
    rawLines.push({ date, valueDate: null, amount, label: name || memo || 'Opération', details: memo && name ? [memo] : [], page: 1 });
  }
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i.exec(text);
  const extra = { warnings, account: ofxValue(text, 'ACCTID') };
  if (ledger) {
    const balance = toCents(ofxValue(ledger[1], 'BALAMT'));
    const asOf = ofxDate(ofxValue(ledger[1], 'DTASOF'));
    if (balance !== null) {
      extra.closingBalance = balance;
      extra.closingDate = asOf;
    }
  }
  const start = ofxDate(ofxValue(text, 'DTSTART'));
  const end = ofxDate(ofxValue(text, 'DTEND'));
  if (start && end && start <= end) {
    extra.periodStart = start;
    extra.periodEnd = end;
  }
  const statement = finish('ofx', '', rawLines, extra);
  // Le solde d'un fichier OFX est celui du jour de l'export : il ne vaut « solde de fin » que si
  // aucune opération n'est datée après la période.
  if (statement.closingBalance != null && statement.closingDate && statement.closingDate < statement.periodEnd) {
    statement.closingBalance = null;
    statement.closingDate = null;
  }
  if (statement.closingBalance != null) {
    statement.openingBalance = statement.closingBalance - statement.totalCredit + statement.totalDebit;
    statement.openingDate = null;
    statement.checks.balance = 'absent';
  }
  return statement;
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

/** Découpe un texte CSV en lignes de cellules (guillemets et retours à la ligne internes gérés). */
export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 30).join('\n');
  let best = ';';
  let bestCount = -1;
  for (const d of [';', '\t', ',', '|']) {
    const count = sample.split(d).length - 1;
    // la virgule sert aussi de séparateur décimal : on ne la retient que si elle domine largement
    const weighted = d === ',' ? count / 2 : count;
    if (weighted > bestCount) {
      best = d;
      bestCount = weighted;
    }
  }
  return best;
}

const COLUMN_WORDS = {
  date: [/^date$/, /^date (de l')?operation$/, /^date operation$/, /^date comptable$/, /^date de comptabilisation$/, /^date$/, /^date d'operation$/],
  valueDate: [/valeur/],
  label: [/libelle/, /^description$/, /^nature/, /^operation$/, /^detail/, /^intitule/, /^label$/, /^designation/, /^tiers$/],
  amount: [/^montant/, /^amount$/, /^montant\(euros\)$/, /^somme$/],
  debit: [/^debit/],
  credit: [/^credit/],
};

function mapColumns(header) {
  const cols = {};
  const names = header.map((h) => normalize(h).replace(/[€()]/g, '').trim());
  for (const [key, patterns] of Object.entries(COLUMN_WORDS)) {
    for (let i = 0; i < names.length && cols[key] === undefined; i++) {
      if (Object.values(cols).includes(i)) continue;
      if (key === 'date' && /valeur/.test(names[i])) continue;
      if (patterns.some((re) => re.test(names[i]))) cols[key] = i;
    }
  }
  if (cols.date === undefined) {
    const i = names.findIndex((n, idx) => /^date/.test(n) && !/valeur/.test(n) && !Object.values(cols).includes(idx));
    if (i >= 0) cols.date = i;
  }
  return cols;
}

export function parseCsvStatement(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  let headerIndex = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const candidate = mapColumns(rows[i]);
    if (candidate.date !== undefined && candidate.label !== undefined && (candidate.amount !== undefined || candidate.debit !== undefined || candidate.credit !== undefined)) {
      headerIndex = i;
      cols = candidate;
      break;
    }
  }
  if (!cols) {
    throw new StatementError(
      "Les colonnes de ce fichier n'ont pas été reconnues. Il faut une ligne de titres avec au moins « Date », « Libellé » et « Montant » (ou « Débit » / « Crédit »).",
      'columns',
    );
  }
  const rawLines = [];
  const warnings = [];
  let unreadable = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const date = toDate(row[cols.date]);
    let amount = null;
    if (cols.amount !== undefined) amount = toCents(row[cols.amount]);
    if (amount === null && (cols.debit !== undefined || cols.credit !== undefined)) {
      const debit = cols.debit !== undefined ? toCents(row[cols.debit]) : null;
      const credit = cols.credit !== undefined ? toCents(row[cols.credit]) : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    const label = (row[cols.label] || '').replace(/\s+/g, ' ').trim();
    if (!date || amount === null || amount === 0) {
      if (row.filter(Boolean).length >= 2) unreadable++;
      continue;
    }
    rawLines.push({ date, valueDate: cols.valueDate !== undefined ? toDate(row[cols.valueDate]) : null, amount, label: label || 'Opération', details: [], page: 1 });
  }
  if (unreadable) warnings.push(`${unreadable} ligne${unreadable > 1 ? 's' : ''} sans date ou sans montant lisible ${unreadable > 1 ? 'ont été ignorées' : 'a été ignorée'}.`);
  return finish('csv', '', rawLines, { warnings });
}
