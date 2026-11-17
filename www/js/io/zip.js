// Archives ZIP, sans bibliothèque externe.
// Écriture : méthode « stockée » (sans compression) — simple, rapide, lisible par tous les outils.
// Lecture : fichiers stockés, et fichiers compressés (deflate) quand le navigateur sait les décompresser.
// Sert à fabriquer les classeurs Excel (.xlsx = un ZIP de fichiers XML) et les sauvegardes complètes.

let crcTable = null;

export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text) {
  return encoder.encode(text);
}

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Fabrique une archive ZIP.
 * files : [{ name: 'dossier/fichier.txt', data: Uint8Array | string, date?: Date }]
 */
export function zipStore(files) {
  const entries = files.map((f) => {
    const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
    return { name: utf8(f.name), data, crc: crc32(data), stamp: dosDateTime(f.date) };
  });
  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let pos = 0;
  const offsets = [];
  for (const e of entries) {
    offsets.push(pos);
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true); // version nécessaire
    view.setUint16(pos + 6, 0x0800, true); // noms en UTF-8
    view.setUint16(pos + 8, 0, true); // méthode 0 = stocké
    view.setUint16(pos + 10, e.stamp.time, true);
    view.setUint16(pos + 12, e.stamp.date, true);
    view.setUint32(pos + 14, e.crc, true);
    view.setUint32(pos + 18, e.data.length, true);
    view.setUint32(pos + 22, e.data.length, true);
    view.setUint16(pos + 26, e.name.length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(e.name, pos + 30);
    out.set(e.data, pos + 30 + e.name.length);
    pos += 30 + e.name.length + e.data.length;
  }
  const centralStart = pos;
  entries.forEach((e, i) => {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, e.stamp.time, true);
    view.setUint16(pos + 14, e.stamp.date, true);
    view.setUint32(pos + 16, e.crc, true);
    view.setUint32(pos + 20, e.data.length, true);
    view.setUint32(pos + 24, e.data.length, true);
    view.setUint16(pos + 28, e.name.length, true);
    view.setUint16(pos + 30, 0, true); // champ extra
    view.setUint16(pos + 32, 0, true); // commentaire
    view.setUint16(pos + 34, 0, true); // disque
    view.setUint16(pos + 36, 0, true); // attributs internes
    view.setUint32(pos + 38, 0, true); // attributs externes
    view.setUint32(pos + 42, offsets[i], true);
    out.set(e.name, pos + 46);
    pos += 46 + e.name.length;
  });
  const centralSize = pos - centralStart;
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, centralSize, true);
  view.setUint32(pos + 16, centralStart, true);
  view.setUint16(pos + 20, 0, true);
  return out;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ce fichier ZIP est compressé et cet appareil ne sait pas le décompresser.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lit une archive ZIP et renvoie [{ name, data: Uint8Array }]. */
export async function unzip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Ce fichier n'est pas une archive ZIP valide.");
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('Archive ZIP endommagée.');
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);
    if (name.endsWith('/')) continue;
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error(`Méthode de compression non prise en charge dans « ${name} ».`);
    if (crc32(data) !== crc) throw new Error(`Le fichier « ${name} » de l'archive est endommagé.`);
    files.push({ name, data });
  }
  return files;
}

export function decodeText(bytes) {
  return decoder.decode(bytes);
}
