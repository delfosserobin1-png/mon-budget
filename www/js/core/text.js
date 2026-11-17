// Outils de texte : comparaison insensible aux accents / à la casse, pour la recherche et les
// règles de catégorisation.

/** "Café  de l'Été" → "cafe de l'ete" */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '') // retire les accents (marques combinantes)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clé stable d'un commerçant / tiers : lettres et chiffres seulement, sans numéros isolés. */
export function partyKey(text) {
  return normalize(text)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((w) => w && !/^\d+$/.test(w))
    .join(' ');
}

/** Vrai si tous les mots de la recherche se trouvent dans le texte (ordre libre). */
export function matchesQuery(haystack, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = normalize(haystack);
  return words.every((w) => hay.includes(w));
}

/** Proportion de mots de `a` présents dans `b` (0 à 1) — sert à départager des candidats. */
export function wordOverlap(a, b) {
  // Les mots de 1 ou 2 lettres (le, la, de, au…) ne disent rien : on les ignore.
  const wa = partyKey(a).split(' ').filter((w) => w.length > 2);
  const wb = new Set(partyKey(b).split(' ').filter((w) => w.length > 2));
  if (!wa.length || !wb.size) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / wa.length;
}

/** Coupe proprement un texte trop long. */
export function truncate(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

/** "AUBERGE DU PONT" → "Auberge du Pont" (les sigles courts restent en capitales). */
export function titleCase(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/(^|[\s\-'*/.])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
}
