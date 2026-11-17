// Montants. Règle d'or de toute l'appli : un montant est TOUJOURS un nombre entier de centimes.
// On ne calcule jamais avec des euros à virgule (0,1 + 0,2 ≠ 0,3 en informatique) : les sommes
// restent ainsi exactes, au centime près, quel que soit le nombre d'opérations.

const NBSP = String.fromCharCode(0x00a0); // espace insécable (avant €)
const THIN = String.fromCharCode(0x202f); // espace fine insécable (séparateur de milliers)
const MINUS = String.fromCharCode(0x2212); // vrai signe moins typographique « − »

/**
 * Lit un montant saisi par l'utilisateur ("12", "12,5", "12.50", "1 234,56") et renvoie des centimes.
 * Renvoie null si la saisie n'est pas un montant valide. Le signe n'est pas accepté ici : c'est
 * l'interface (bouton Dépense / Revenu) qui le porte.
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\s€]/g, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return null;
  const [intPart, decPart = ''] = s.split(/[.,]/);
  const cents = Number(intPart) * 100 + Number((decPart + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Lit un montant tel qu'imprimé sur un relevé français ("2.174,88", "+ 1.542,30", "- 12,00", "0,35").
 * Renvoie des centimes signés, ou null.
 */
export function parseStatementAmount(input) {
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\s€]/g, '').replace(MINUS, '-');
  const m = /^([+-])?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(s);
  if (!m) return null;
  const cents = Number(m[2].replace(/\./g, '')) * 100 + Number(m[3]);
  return m[1] === '-' ? -cents : cents;
}

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/**
 * Affiche des centimes à la française : "1 234,56 €".
 * sign : 'auto' (moins seulement si négatif), 'always' (+ ou −), 'never' (valeur absolue).
 */
export function formatAmount(cents, { sign = 'auto', currency = true } = {}) {
  const value = Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(value);
  const text = `${groupThousands(String(Math.floor(abs / 100)))},${String(abs % 100).padStart(2, '0')}`;
  let prefix = '';
  if (sign === 'always') prefix = value < 0 ? MINUS : '+';
  else if (sign === 'auto' && value < 0) prefix = MINUS;
  return `${prefix}${text}${currency ? NBSP + '€' : ''}`;
}

/** Valeur à mettre dans un champ de saisie : "1234,56" (sans signe, sans symbole). */
export function formatForInput(cents) {
  const abs = Math.abs(Math.round(cents || 0));
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Centimes → euros (nombre), uniquement pour les exports tableur. */
export function toEuros(cents) {
  return Math.round(cents) / 100;
}

/** Somme sûre d'une liste de centimes. */
export function sum(list) {
  let total = 0;
  for (const v of list) total += v;
  return total;
}
