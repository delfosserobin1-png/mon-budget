// Interprétation des libellés bancaires : à partir du texte brut d'une ligne de relevé
// (« CARTE X1234 06/07 AUBERGE DU PONT », « VIR INST RE … » + lignes de détail « DE: », « MOTIF: »…),
// on retrouve la vraie date de l'opération, l'heure, le tiers et un libellé lisible.
// Le vocabulaire est celui de la Société Générale ; les autres banques françaises en sont proches,
// et une ligne non reconnue est simplement gardée telle quelle.

import { addDays, isValidISO, makeISO, parseFrenchDate } from '../../core/dates.js';
import { titleCase } from '../../core/text.js';

const CIVILITY = /^(m|mr|mme|mlle|melle|monsieur|madame|m\.|mr\.|ste|sté|societe|société)\s+/i;

const SMALL_WORDS = new Set(['de', 'du', 'des', 'et', 'au', 'aux', 'en', 'sur', 'sous', 'chez']);
const ACRONYMS = new Set(['sa', 'sas', 'sasu', 'sarl', 'sci', 'snc', 'eurl', 'edf', 'sncf', 'ratp', 'caf', 'cpam', 'urssaf', 'dgfip', 'tgv', 'sg']);

/** « LIBRAIRIE DES ARTS 7700123 » → « Librairie des Arts » ; « M. PAUL DURAND » → « Paul Durand ». */
export function cleanName(raw) {
  let name = String(raw || '').replace(/\s+/g, ' ').trim();
  name = name.replace(CIVILITY, '');
  // numéros de magasin ou de terminal en fin de nom (« EPICERIE 0412 », « LIBRAIRIE DES ARTS 7700123 »)
  name = name.replace(/(\s+\d{3,})+$/, '').trim();
  return titleCase(name)
    .split(' ')
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return word;
    })
    .join(' ');
}

function sentence(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s && s === s.toUpperCase() && /[A-Z]{3}/.test(s)) s = titleCase(s); // tout en capitales → plus lisible
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** « de Paul », « d'Octave » */
function de(name) {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(name) ? `d'${name}` : `de ${name}`;
}

/** Lit les lignes de détail « CLÉ: valeur » ; une ligne sans clé prolonge le motif qui précède. */
export function readDetails(details) {
  const out = { de: '', pour: '', motif: '', date: null, time: null, ref: '', chez: '' };
  let last = null;
  for (const raw of details || []) {
    const line = String(raw).trim();
    const m = /^(DE|POUR|MOTIF|DATE|REF|CHEZ|ID|IBAN|BIC)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      const key = m[1].toUpperCase();
      const value = m[2].trim();
      last = key;
      if (key === 'DE') out.de = value;
      else if (key === 'POUR') out.pour = value;
      else if (key === 'MOTIF') out.motif = value;
      else if (key === 'REF') out.ref = value;
      else if (key === 'CHEZ') out.chez = value;
      else if (key === 'DATE') {
        const dm = /^(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(value);
        if (dm) {
          out.date = parseFrenchDate(dm[1]);
          if (dm[2] && Number(dm[2]) < 24 && Number(dm[3]) < 60) out.time = `${dm[2]}:${dm[3]}`;
        }
      }
    } else if (last === 'MOTIF' && line && !/^(MANDAT|COMMERCE|WERO)\b/i.test(line) && !/^\d{2} \d{2} BQ /.test(line)) {
      out.motif = `${out.motif} ${line}`.trim();
    } else {
      last = null;
    }
  }
  return out;
}

/** Année d'un « JJ/MM » imprimé sans année : la plus récente qui ne dépasse pas la date de la banque. */
export function inferYear(day, month, bankDate) {
  const year = Number(bankDate.slice(0, 4));
  for (const y of [year, year - 1]) {
    const iso = makeISO(y, month, day);
    if (isValidISO(iso) && iso <= addDays(bankDate, 3)) return iso;
  }
  return null;
}

/**
 * Complète une ligne de relevé { date, amount, label, details } avec :
 * kind ('card' | 'transfer-in' | 'transfer-out' | 'debit' | 'fee' | 'other'), opDate, time,
 * counterparty, motif, suggestedLabel.
 */
export function interpretLine(line) {
  const label = String(line.label || '').replace(/\s+/g, ' ').trim();
  const info = readDetails(line.details);
  const out = { ...line, label, kind: 'other', opDate: null, time: null, counterparty: '', motif: sentence(info.motif), suggestedLabel: '' };
  let m;
  if ((m = /^CARTE\s+X?\d{4}\s+(REMBT\s+|RETRAIT\s+(?:DAB\s+)?)?(\d{2})\/(\d{2})\s+(.+)$/i.exec(label))) {
    out.kind = 'card';
    out.opDate = inferYear(Number(m[2]), Number(m[3]), line.date);
    const special = (m[1] || '').trim().toUpperCase();
    out.counterparty = cleanName(m[4]);
    if (special.startsWith('RETRAIT')) out.suggestedLabel = 'Retrait d\'espèces';
    else if (special === 'REMBT') out.suggestedLabel = `Remboursement ${out.counterparty}`.trim();
    else out.suggestedLabel = out.counterparty;
  } else if (/\bVIR(EMENT)?\b.*\b(RECU|REÇU)\b|^VIR INST RE\b|^VIR SEPA RECU\b/i.test(label)) {
    out.kind = 'transfer-in';
    out.counterparty = cleanName(info.de);
    out.suggestedLabel = out.motif || (out.counterparty ? `Virement ${de(out.counterparty)}` : 'Virement reçu');
  } else if (/\bVIR(EMENT)?\b.*\b(EMIS|ÉMIS|PERM|PERMANENT)\b|\bVIR PERM\b/i.test(label)) {
    out.kind = 'transfer-out';
    out.counterparty = cleanName(info.pour);
    out.suggestedLabel = out.motif || (out.counterparty ? `Virement à ${out.counterparty}` : 'Virement émis');
  } else if (/^(PRELEVEMENT|PRÉLÈVEMENT|PRLV)\b/i.test(label)) {
    out.kind = 'debit';
    out.counterparty = cleanName(info.de);
    out.suggestedLabel = out.counterparty || out.motif || 'Prélèvement';
  } else if (/^(COTISATION|FRAIS|COMMISSION|INTERETS|INTÉRÊTS|JAZZ|SOBRIO|ABONNEMENT)\b/i.test(label)) {
    out.kind = 'fee';
    out.counterparty = line.bank || '';
    out.suggestedLabel = `Frais bancaires (${titleCase(label)})`;
  } else {
    out.counterparty = cleanName(info.de || info.pour || '');
    out.suggestedLabel = out.motif || titleCase(label.replace(/^\d{6}\s+/, ''));
  }
  if (!out.opDate && info.date && info.date <= addDays(line.date, 3)) out.opDate = info.date;
  if (info.time) out.time = info.time;
  if (out.opDate === line.date) out.opDate = null; // rien de plus précis que la date de la banque
  if (!out.suggestedLabel) out.suggestedLabel = titleCase(label) || 'Opération';
  return out;
}
