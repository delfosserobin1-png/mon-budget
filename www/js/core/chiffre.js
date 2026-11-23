// Chiffrement d'un texte par une phrase secrète, identique sur l'ordinateur (Node) et sur le
// téléphone (navigateur) : tous deux ont le même module de cryptographie standard (WebCrypto).
//
// Sert aux opérations de la banque, que l'ordinateur dépose dans la boîte privée sur GitHub :
// même GitHub ne peut pas les lire. Rien de maison : AES-GCM 256 bits, clé dérivée de la phrase
// par PBKDF2-SHA-256 (310 000 tours, sel aléatoire), vecteur d'initialisation aléatoire.
//
// Format (JSON) : { format: 'mon-budget-chiffre', version: 1,
//                   kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
//                   cipher: { name: 'AES-GCM', iv }, data }      (salt, iv, data en base64)

export const CIPHER_FORMAT = 'mon-budget-chiffre';
export const DEFAULT_ITERATIONS = 310000;

export class ChiffreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ChiffreError';
    this.code = code;
  }
}

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new ChiffreError("Le chiffrement n'est pas disponible ici (il faut une page sécurisée, en https).", 'unavailable');
  return s;
};

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text) {
  const binary = atob(String(text || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** La phrase telle qu'on la compare : sans espaces ni tirets superflus, en minuscules. */
export function cleanPhrase(phrase) {
  return String(phrase || '')
    .toLowerCase()
    .replace(/[\s\-_.]+/g, '');
}

// Lettres et chiffres faciles à recopier (ni 0/o, ni 1/l/i).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Phrase secrète au hasard : 5 groupes de 4 signes (« k7mp-2xqa-… »), environ 99 bits. */
export function newPhrase() {
  const chars = [];
  // tirage sans biais : on écarte les octets au-delà du plus grand multiple de la taille de l'alphabet
  const limit = 256 - (256 % ALPHABET.length);
  while (chars.length < 20) {
    for (const b of globalThis.crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && chars.length < 20) chars.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return [0, 4, 8, 12, 16].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

async function deriveKey(phrase, salt, iterations, usage) {
  const material = await subtle().importKey('raw', new TextEncoder().encode(cleanPhrase(phrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

/** Chiffre un texte ; renvoie le document JSON (texte) à déposer. */
export async function encryptText(text, phrase, { iterations = DEFAULT_ITERATIONS } = {}) {
  if (cleanPhrase(phrase).length < 12) throw new ChiffreError('La phrase secrète est trop courte.', 'weak');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(phrase, salt, iterations, 'encrypt');
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return JSON.stringify({
    format: CIPHER_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(data),
  });
}

/** Déchiffre un document produit par encryptText. Une mauvaise phrase est signalée clairement. */
export async function decryptText(document, phrase) {
  let doc;
  try {
    doc = typeof document === 'string' ? JSON.parse(document) : document;
  } catch {
    throw new ChiffreError("Ce fichier chiffré est abîmé (il n'a pas pu être lu).", 'format');
  }
  if (!doc || doc.format !== CIPHER_FORMAT || doc.version !== 1 || !doc.kdf || !doc.cipher || !doc.data) {
    throw new ChiffreError("Ce fichier n'est pas un fichier chiffré de Mon Budget.", 'format');
  }
  const iterations = Number(doc.kdf.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 5000000) throw new ChiffreError('Ce fichier chiffré a des réglages inattendus.', 'format');
  const key = await deriveKey(phrase, fromBase64(doc.kdf.salt), iterations, 'decrypt');
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(doc.cipher.iv) }, key, fromBase64(doc.data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new ChiffreError("La phrase secrète ne correspond pas (ou le fichier a été modifié). Vérifie-la, lettre par lettre.", 'phrase');
  }
}
