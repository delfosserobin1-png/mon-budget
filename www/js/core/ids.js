// Identifiants uniques. Chaque enregistrement porte un préfixe de famille (op_, env_, tag_…) suivi
// d'une partie aléatoire : on reconnaît le type d'un coup d'œil et deux identifiants ne se
// confondent jamais.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(prefix) {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return `${prefix}_${out}`;
}

export const PREFIX = {
  operations: 'op',
  envelopes: 'env',
  tags: 'tag',
  recurring: 'rec',
  reconciliations: 'rap',
  statements: 'rel',
  rules: 'reg',
  bugReports: 'bug',
  files: 'fic',
};
