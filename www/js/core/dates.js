// Dates. Dans toute l'appli une date est une chaîne "AAAA-MM-JJ" (date de calendrier, sans heure
// ni fuseau). Tous les calculs passent par l'UTC pour ne jamais glisser d'un jour à cause du fuseau
// horaire ou du changement d'heure. L'affichage, lui, est toujours "JJ-MM-AAAA".

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const pad = (n) => String(n).padStart(2, '0');

export function makeISO(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function toUTC(iso) {
  const m = ISO_RE.exec(iso);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUTC(d) {
  return makeISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Vrai si la chaîne est une date de calendrier qui existe réellement (pas de 31 février). */
export function isValidISO(iso) {
  if (typeof iso !== 'string') return false;
  const m = ISO_RE.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo) && y >= 1900 && y <= 2200;
}

/** Date du jour dans le fuseau du téléphone (le jour civil que voit l'utilisateur). */
export function todayISO(now = new Date()) {
  return makeISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Heure locale "HH:MM". */
export function nowTime(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parts(iso) {
  const m = ISO_RE.exec(iso);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function addDays(iso, n) {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

/**
 * Ajoute n mois à une date en visant le jour `targetDay` (par défaut le jour de la date).
 * Si ce jour n'existe pas dans le mois d'arrivée (31 en février), on prend le dernier jour du mois —
 * sans jamais « oublier » le jour visé : 31 janv. → 28 févr. → 31 mars.
 */
export function addMonths(iso, n, targetDay) {
  const { year, month, day } = parts(iso);
  const index = year * 12 + (month - 1) + n;
  const y = Math.floor(index / 12);
  const m = (index % 12 + 12) % 12 + 1;
  const wanted = targetDay || day;
  return makeISO(y, m, Math.min(wanted, daysInMonth(y, m)));
}

/** Nombre de jours de a vers b (positif si b est après a). */
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function weekday(iso) {
  return toUTC(iso).getUTCDay(); // 0 = dimanche
}

export function startOfMonth(iso) {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso) {
  const { year, month } = parts(iso);
  return makeISO(year, month, daysInMonth(year, month));
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

/** "AAAA-MM-JJ" → "JJ-MM-AAAA" (format d'affichage unique de l'appli). */
export function formatDate(iso) {
  if (!isValidISO(iso)) return '';
  const { year, month, day } = parts(iso);
  return `${pad(day)}-${pad(month)}-${year}`;
}

/** "AAAA-MM" → "MM-AAAA" (séparateurs de mois dans les listes). */
export function formatMonthKey(key) {
  return `${key.slice(5, 7)}-${key.slice(0, 4)}`;
}

/** "AAAA-MM" → "novembre 2026". */
export function monthName(key, { short = false, year = true } = {}) {
  const name = (short ? MONTHS_SHORT : MONTHS)[Number(key.slice(5, 7)) - 1];
  return year ? `${name} ${key.slice(0, 4)}` : name;
}

export function weekdayName(iso) {
  return DAYS_SHORT[weekday(iso)];
}

/** "08/07/2026" ou "08-07-2026" → "2026-07-08" ; null si invalide. */
export function parseFrenchDate(text) {
  const m = /^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$/.exec(String(text || '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isValidISO(iso) ? iso : null;
}

/** Liste des mois "AAAA-MM" de `fromKey` à `toKey` inclus. */
export function monthRange(fromKey, toKey) {
  const out = [];
  let cur = fromKey;
  let guard = 0;
  while (cur <= toKey && guard++ < 2400) {
    out.push(cur);
    cur = addMonths(cur + '-01', 1).slice(0, 7);
  }
  return out;
}

export function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
