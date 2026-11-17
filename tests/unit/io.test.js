// Tests des formats de fichiers : ZIP, classeur Excel, CSV, empreinte SHA-256.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipStore, unzip, utf8, decodeText } from '../../www/js/io/zip.js';
import { buildXlsx, buildCsv, excelSerial } from '../../www/js/io/xlsx.js';
import { sha256 } from '../../www/js/core/sha256.js';

test('crc32 : valeurs de référence', () => {
  assert.equal(crc32(utf8('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip : ce qui est écrit se relit à l\'identique (noms accentués, binaire, fichier vide)', async () => {
  const binary = new Uint8Array(300).map((_, i) => (i * 7) % 256);
  const archive = zipStore([
    { name: 'données/relevé été.txt', data: 'Bonjour — ça marche €' },
    { name: 'pieces/photo.bin', data: binary },
    { name: 'vide.txt', data: '' },
  ]);
  const files = await unzip(archive);
  assert.deepEqual(files.map((f) => f.name), ['données/relevé été.txt', 'pieces/photo.bin', 'vide.txt']);
  assert.equal(decodeText(files[0].data), 'Bonjour — ça marche €');
  assert.deepEqual([...files[1].data], [...binary]);
  assert.equal(files[2].data.length, 0);
});

test('zip : un fichier abîmé ou étranger est refusé avec un message clair', async () => {
  await assert.rejects(() => unzip(utf8('pas un zip du tout')), /archive ZIP valide/);
  const archive = zipStore([{ name: 'a.txt', data: 'contenu' }]);
  archive[35] ^= 0xff; // on abîme un octet du contenu
  await assert.rejects(() => unzip(archive), /endommagé/);
});

test('zip : lit aussi une archive compressée (deflate) produite par un autre outil', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const content = utf8('texte répété '.repeat(50));
  const compressed = deflateRawSync(content);
  // Archive minimale écrite à la main : un fichier, méthode 8 (deflate)
  const name = utf8('doc.txt');
  const local = new Uint8Array(30 + name.length + compressed.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc32(content), true);
  lv.setUint32(18, compressed.length, true);
  lv.setUint32(22, content.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(compressed, 30 + name.length);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc32(content), true);
  cv.setUint32(20, compressed.length, true);
  cv.setUint32(24, content.length, true);
  cv.setUint16(28, name.length, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const archive = new Uint8Array([...local, ...central, ...end]);
  const files = await unzip(archive);
  assert.equal(decodeText(files[0].data), 'texte répété '.repeat(50));
});

test('xlsx : structure du classeur, vraies dates, vrais nombres, texte protégé', async () => {
  const bytes = buildXlsx([
    {
      name: 'Opérations',
      columns: [{ header: 'Date', type: 'date' }, { header: 'Libellé' }, { header: 'Montant', type: 'money' }, { header: 'Nb', type: 'int' }],
      rows: [
        ['2026-11-15', 'Café & <croissant> "bio"', -4.5, 2],
        ['pas une date', '', null, null],
      ],
    },
    { name: 'Opérations', columns: [{ header: 'A' }], rows: [] }, // nom en double → renommé
    { name: 'Nom/interdit:*?[]', columns: [{ header: 'A' }], rows: [['x']] },
  ]);
  const files = await unzip(bytes);
  const get = (name) => decodeText(files.find((f) => f.name === name).data);
  assert.ok(files.some((f) => f.name === '[Content_Types].xml'));
  const workbook = get('xl/workbook.xml');
  assert.match(workbook, /<sheet name="Opérations" sheetId="1"/);
  assert.match(workbook, /<sheet name="Opérations 2" sheetId="2"/);
  assert.match(workbook, /<sheet name="Nom interdit" sheetId="3"/);
  const sheet = get('xl/worksheets/sheet1.xml');
  assert.match(sheet, new RegExp(`<c r="A2" s="2"><v>${excelSerial('2026-11-15')}</v></c>`));
  assert.match(sheet, /<c r="C2" s="3"><v>-4.5<\/v><\/c>/);
  assert.match(sheet, /<c r="D2" s="4"><v>2<\/v><\/c>/);
  assert.match(sheet, /Café &amp; &lt;croissant&gt; &quot;bio&quot;/);
  assert.match(sheet, /<c r="A3" t="inlineStr"><is><t xml:space="preserve">pas une date<\/t>/);
  assert.match(sheet, /<autoFilter ref="A1:D3"\/>/);
});

test('excelSerial : 1er janvier 2000 = 36526, 15 novembre 2026 = 46341', () => {
  assert.equal(excelSerial('2000-01-01'), 36526);
  assert.equal(excelSerial('2026-11-15'), 46341);
  assert.equal(excelSerial('n\'importe quoi'), null);
});

test('csv : point-virgule, virgule décimale, dates françaises, guillemets, formules neutralisées', () => {
  const csv = buildCsv(
    [{ header: 'Date', type: 'date' }, { header: 'Libellé' }, { header: 'Montant', type: 'money' }],
    [
      ['2026-11-15', 'Pain; "complet"', -1.2],
      ['2026-11-16', '=SOMME(A1:A9)', 1234.5],
      ['2026-11-17', 'ligne\ncoupée', null],
    ],
  );
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'Date;Libellé;Montant');
  assert.equal(lines[1], '15/11/2026;"Pain; ""complet""";-1,20');
  assert.equal(lines[2], "16/11/2026;'=SOMME(A1:A9);1234,50");
  assert.equal(lines[3], '17/11/2026;"ligne\ncoupée";');
});

test('sha256 : vecteurs de référence', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256('é'.repeat(100)).length, 64);
});
