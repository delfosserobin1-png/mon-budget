// Tests de la lecture des relevés bancaires (PDF, OFX, CSV) et de l'interprétation des libellés.
// Le PDF utilisé est un relevé FICTIF fabriqué par tools/make-sample-statement.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readStatementFile, fingerprintOf, kindOfFile, StatementError } from '../../www/js/io/statement/index.js';
import { extractPages } from '../../www/js/io/statement/pdf.js';
import { parseStatementPages, groupRows } from '../../www/js/io/statement/pdf-table.js';
import { interpretLine, inferYear, readDetails, cleanName } from '../../www/js/io/statement/labels.js';
import { parseCsv, parseCsvStatement, parseOfx, decodeBytes } from '../../www/js/io/statement/text-formats.js';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const samplePath = here('../../www/exemples/releve-exemple.pdf');
const expected = JSON.parse(readFileSync(here('../fixtures/releve-exemple.attendu.json'), 'utf8'));

// pdf.js embarqué dans l'appli, utilisé tel quel sous Node (aucune dépendance supplémentaire).
// Hors navigateur, pdf.js réclame quelques objets de dessin dont la lecture du texte ne se sert
// pas : on lui fournit des coquilles vides.
function browserShims() {
  for (const name of ['DOMMatrix', 'Path2D', 'ImageData']) {
    if (typeof globalThis[name] === 'undefined') globalThis[name] = class {};
  }
}

export const pdfTools = {
  async loadPdfJs() {
    browserShims();
    const pdfjs = await import('../../www/vendor/pdfjs/pdf.min.js');
    globalThis.pdfjsWorker = await import('../../www/vendor/pdfjs/pdf.worker.min.js');
    return pdfjs;
  },
  extractPages,
};

const bytesOf = (text) => new TextEncoder().encode(text);

test('PDF : le relevé d\'exemple est lu en entier et les soldes imprimés sont retrouvés', async () => {
  const statement = await readStatementFile({ name: 'releve-exemple.pdf', bytes: new Uint8Array(readFileSync(samplePath)) }, pdfTools);
  assert.equal(statement.format, 'pdf');
  assert.equal(statement.bank, 'Société Générale');
  assert.equal(statement.accountLabel, 'Compte se terminant par 7890');
  assert.equal(statement.accountKey, undefined, 'le numéro de compte complet ne sort pas du lecteur');
  assert.equal(statement.periodStart, expected.periodStart);
  assert.equal(statement.periodEnd, expected.periodEnd);
  assert.equal(statement.openingDate, '2026-07-07');
  assert.equal(statement.openingBalance, expected.openingBalance);
  assert.equal(statement.closingBalance, expected.closingBalance);
  assert.equal(statement.totalDebit, expected.totalDebit);
  assert.equal(statement.totalCredit, expected.totalCredit);
  assert.equal(statement.lines.length, expected.lineCount);
  assert.deepEqual(statement.lines.map((l) => l.amount), expected.amounts);
  assert.deepEqual(statement.lines.map((l) => l.details.length), expected.detailCounts, 'les lignes de détail suivent leur opération, même à cheval sur deux pages');
  assert.deepEqual(statement.checks.totals, 'ok');
  assert.deepEqual(statement.checks.balance, 'ok');
  assert.deepEqual(statement.warnings, []);
  assert.match(statement.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(statement.lines.map((l) => l.id).slice(0, 3), ['L001', 'L002', 'L003']);
});

test('PDF : interprétation des lignes du relevé d\'exemple', async () => {
  const statement = await readStatementFile({ name: 'x.pdf', bytes: new Uint8Array(readFileSync(samplePath)) }, pdfTools);
  const byLabel = (re) => statement.lines.find((l) => re.test(l.label));
  const card = byLabel(/06\/07 BOULANGERIE/);
  assert.deepEqual([card.kind, card.date, card.opDate, card.counterparty, card.suggestedLabel], ['card', '2026-07-08', '2026-07-06', 'Boulangerie du Parc', 'Boulangerie du Parc']);
  const grocery = byLabel(/07\/07 SUPER MARCHE/);
  assert.equal(grocery.counterparty, 'Super Marche Bio', 'le numéro de magasin est retiré');
  const toll = byLabel(/PEAGE/);
  assert.equal(toll.label, 'CARTE X1234 10/07 PEAGE A10 7700456', 'le numéro isolé à droite fait partie du libellé brut');
  assert.equal(toll.counterparty, 'Peage A10');
  const incoming = byLabel(/^VIR INST RE/);
  assert.deepEqual([incoming.kind, incoming.counterparty, incoming.time, incoming.suggestedLabel, incoming.amount], ['transfer-in', 'Julie Moreau', '09:12', 'Remboursement restaurant', 4500]);
  const outgoing = byLabel(/VIR INSTANTANE EMIS/);
  assert.deepEqual([outgoing.kind, outgoing.counterparty, outgoing.time, outgoing.suggestedLabel], ['transfer-out', 'Paul Durand', '18:40', 'Participation cadeau']);
  const debit = byLabel(/^PRELEVEMENT EUROPEEN 5500012301/);
  assert.deepEqual([debit.kind, debit.counterparty, debit.suggestedLabel], ['debit', 'Energie Exemple SA', 'Energie Exemple SA']);
  const fee = byLabel(/^COTISATION/);
  assert.deepEqual([fee.kind, fee.amount], ['fee', -720]);
  const refund = byLabel(/REMBT/);
  assert.deepEqual([refund.kind, refund.amount, refund.opDate, refund.suggestedLabel], ['card', 2390, '2026-07-26', 'Remboursement Librairie des Arts']);
  const salary = byLabel(/^VIR RECU/);
  assert.deepEqual([salary.kind, salary.counterparty, salary.suggestedLabel], ['transfer-in', 'Entreprise Exemple SAS', 'Salaire Juillet']);
  const rent = byLabel(/VIR PERM/);
  assert.deepEqual([rent.kind, rent.counterparty, rent.suggestedLabel], ['transfer-out', 'SCI des Lilas', 'Loyer mensuel']);
});

test('PDF : deux lectures du même fichier donnent la même empreinte, un autre contenu une autre', async () => {
  const bytes = new Uint8Array(readFileSync(samplePath));
  const a = await readStatementFile({ name: 'a.pdf', bytes }, pdfTools);
  const b = await readStatementFile({ name: 'b.pdf', bytes }, pdfTools);
  assert.equal(a.fingerprint, b.fingerprint);
  const altered = { ...a, lines: a.lines.map((l, i) => (i === 0 ? { ...l, amount: l.amount - 1 } : l)) };
  assert.notEqual(fingerprintOf(altered), a.fingerprint);
});

test('PDF : un tableau sans en-tête Date / Débit / Crédit est refusé proprement', () => {
  assert.throws(() => parseStatementPages([{ items: [{ str: 'Facture', x: 50, y: 700, w: 40, rot: 0 }] }]), (e) => e instanceof StatementError && e.code === 'not-a-statement');
});

test('PDF : montants négatifs, soldes débiteurs et colonnes lus selon leur position', () => {
  const header = [
    { str: 'Date', x: 40, y: 700, w: 20 },
    { str: 'Valeur', x: 80, y: 700, w: 30 },
    { str: 'Nature de l\'opération', x: 210, y: 700, w: 100 },
    { str: 'Débit', x: 430, y: 700, w: 25 },
    { str: 'Crédit', x: 510, y: 700, w: 30 },
  ];
  const row = (y, date, label, amount, credit) => [
    { str: date, x: 31, y, w: 40 },
    { str: date, x: 77, y, w: 40 },
    { str: label, x: 124, y, w: 120 },
    { str: amount, x: (credit ? 560 : 477) - amount.length * 4, y, w: amount.length * 4 },
  ];
  const items = [
    ...header,
    { str: 'SOLDE PRÉCÉDENT AU 31/12/2025', x: 262, y: 688, w: 135 },
    { str: '50,00', x: 457, y: 688, w: 20 }, // colonne Débit → solde précédent négatif
    ...row(676, '02/01/2026', 'CARTE X1111 30/12 MAGASIN', '1.250,00', false),
    ...row(664, '05/01/2026', 'VIR RECU 123', '2.000,00', true),
    { str: 'DE: QUELQU UN', x: 124, y: 655, w: 60 },
    { str: 'texte de marge', x: 583, y: 650, w: 80, rot: 90 },
    { str: 'TOTAUX DES MOUVEMENTS', x: 289, y: 640, w: 110 },
    { str: '1.250,00', x: 445, y: 640, w: 32 },
    { str: '2.000,00', x: 528, y: 640, w: 32 },
    { str: 'NOUVEAU SOLDE AU 31/01/2026', x: 272, y: 620, w: 125 },
    { str: '+ 700,00', x: 525, y: 620, w: 35 },
    { str: 'Texte après la fin du relevé', x: 124, y: 610, w: 100 },
  ].map((it) => ({ rot: 0, ...it }));
  const statement = parseStatementPages([{ items }]);
  assert.equal(statement.openingBalance, -5000);
  assert.equal(statement.closingBalance, 70000);
  assert.deepEqual(statement.lines.map((l) => [l.date, l.amount, l.details.length]), [['2026-01-02', -125000, 0], ['2026-01-05', 200000, 1]]);
  assert.equal(statement.lines[0].opDate, '2025-12-30', 'achat de fin décembre débité en janvier : l\'année précédente est retrouvée');
  assert.equal(statement.checks.balance, 'ok');
  assert.equal(statement.checks.totals, 'ok');
  assert.equal(statement.periodStart, '2026-01-02');
  assert.equal(statement.periodEnd, '2026-01-31');
});

test('PDF : une incohérence entre les lignes et les totaux imprimés est signalée', () => {
  const items = [
    { str: 'Date', x: 40, y: 700, w: 20 }, { str: 'Débit', x: 430, y: 700, w: 25 }, { str: 'Crédit', x: 510, y: 700, w: 30 },
    { str: 'SOLDE PRÉCÉDENT AU 31/12/2025', x: 262, y: 688, w: 135 }, { str: '100,00', x: 536, y: 688, w: 24 },
    { str: '02/01/2026', x: 31, y: 676, w: 40 }, { str: 'ACHAT', x: 124, y: 676, w: 30 }, { str: '10,00', x: 457, y: 676, w: 20 },
    { str: 'NOUVEAU SOLDE AU 31/01/2026', x: 272, y: 620, w: 125 }, { str: '+ 95,00', x: 530, y: 620, w: 30 },
  ].map((it) => ({ rot: 0, ...it }));
  const statement = parseStatementPages([{ items }]);
  assert.equal(statement.checks.balance, 'ko');
  assert.equal(statement.warnings.length, 1);
});

test('groupRows : regroupe par ligne, ignore le texte tourné et les vides', () => {
  const rows = groupRows([
    { str: 'b', x: 50, y: 100.4, w: 5, rot: 0 },
    { str: 'a', x: 10, y: 101, w: 5, rot: 0 },
    { str: 'marge', x: 300, y: 100, w: 5, rot: 90 },
    { str: '   ', x: 20, y: 100, w: 5, rot: 0 },
    { str: 'c', x: 10, y: 80, w: 5, rot: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.text), ['a b', 'c']);
});

test('libellés : année des achats carte, détails, noms nettoyés', () => {
  assert.equal(inferYear(30, 12, '2026-01-02'), '2025-12-30');
  assert.equal(inferYear(6, 7, '2026-07-08'), '2026-07-06');
  assert.equal(inferYear(29, 2, '2026-03-02'), null, 'pas de 29 février en 2026 ni en 2025');
  assert.equal(inferYear(29, 2, '2028-03-02'), '2028-02-29');
  const details = readDetails(['POUR: MME X', 'DATE: 24/07/2026 02:17', 'MOTIF: Courses et', 'pain du 23', 'REF: 123', 'CHEZ: BANQUE']);
  assert.deepEqual([details.pour, details.date, details.time, details.motif], ['MME X', '2026-07-24', '02:17', 'Courses et pain du 23']);
  assert.equal(cleanName('MME LOUISE DE LA FONTAINE'), 'Louise de La Fontaine');
  assert.equal(cleanName('LIDL 1312'), 'Lidl');
  assert.equal(cleanName('SNCF INTERNET PARIS'), 'SNCF Internet Paris');
  const withdrawal = interpretLine({ date: '2026-07-10', amount: -5000, label: 'CARTE X1234 RETRAIT DAB 09/07 PARIS 12', details: [] });
  assert.deepEqual([withdrawal.kind, withdrawal.suggestedLabel, withdrawal.opDate], ['card', "Retrait d'espèces", '2026-07-09']);
  const unknown = interpretLine({ date: '2026-07-10', amount: -100, label: 'OPERATION INCONNUE 42', details: [] });
  assert.deepEqual([unknown.kind, unknown.suggestedLabel, unknown.opDate], ['other', 'Operation Inconnue 42', null]);
  const vowel = interpretLine({ date: '2026-08-06', amount: 2000, label: 'VIR INST RE 1', details: ['DE: OCTAVE B'] });
  assert.equal(vowel.suggestedLabel, "Virement d'Octave B");
});

test('OFX : opérations, signes, solde et période', () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR
<BANKACCTFROM><BANKID>30003<ACCTID>00012345678</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901<DTEND>20260930
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260903<TRNAMT>-12.50<FITID>1<NAME>CARTE X1234 01/09 BOULANGERIE<MEMO>PAIN</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260928120000<TRNAMT>+1500,00<FITID>2<NAME>VIR RECU SALAIRE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>pasunedate<TRNAMT>-1.00<NAME>CASSEE</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>2487.50<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const statement = parseOfx(ofx);
  assert.equal(statement.format, 'ofx');
  assert.deepEqual(statement.lines.map((l) => [l.date, l.amount]), [['2026-09-03', -1250], ['2026-09-28', 150000]]);
  assert.equal(statement.lines[0].opDate, '2026-09-01');
  assert.equal(statement.closingBalance, 248750);
  assert.equal(statement.openingBalance, 248750 - 150000 + 1250);
  assert.deepEqual([statement.periodStart, statement.periodEnd], ['2026-09-01', '2026-09-30']);
  assert.equal(statement.warnings.length, 1);
  assert.equal(statement.accountLabel, 'Compte se terminant par 5678');
});

test('CSV : colonnes reconnues (Montant, ou Débit / Crédit), formats de dates et de nombres', () => {
  const csv = 'Compte courant;;;\nExport du 30/09/2026;;;\n\nDate;Date de valeur;Libellé;Montant\n28/09/2026;28/09/2026;"VIR RECU; SALAIRE";1 500,00\n03/09/2026;03/09/2026;CARTE X1234 01/09 BOULANGERIE;-12,50\n;;ligne sans date;-1,00\n';
  const a = parseCsvStatement(csv);
  assert.deepEqual(a.lines.map((l) => [l.date, l.amount, l.label]), [
    ['2026-09-03', -1250, 'CARTE X1234 01/09 BOULANGERIE'],
    ['2026-09-28', 150000, 'VIR RECU; SALAIRE'],
  ]);
  assert.equal(a.warnings.length, 1);
  assert.equal(a.closingBalance, null);
  const b = parseCsvStatement('date,description,debit,credit\n2026-09-03,Bakery,12.50,\n2026-09-28,Salary,,"1,500.00"\n');
  assert.deepEqual(b.lines.map((l) => [l.date, l.amount]), [['2026-09-03', -1250], ['2026-09-28', 150000]]);
  assert.throws(() => parseCsvStatement('a;b;c\n1;2;3\n'), (e) => e instanceof StatementError && e.code === 'columns');
  assert.throws(() => parseCsvStatement('Date;Libellé;Montant\n'), (e) => e instanceof StatementError && e.code === 'empty');
});

test('CSV : découpage des cellules', () => {
  assert.deepEqual(parseCsv('a;"b;c";"d ""e"""\r\n1;2;3\n\n', ';'), [['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
});

test('fichiers texte : encodage Windows et marque BOM gérés', () => {
  assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), 'A');
  assert.equal(decodeBytes(new Uint8Array([0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9])), 'Libellé');
});

test('type de fichier et erreurs de lecture', async () => {
  assert.equal(kindOfFile('releve.PDF', bytesOf('....')), 'pdf');
  assert.equal(kindOfFile('sans-extension', bytesOf('%PDF-1.7')), 'pdf');
  assert.equal(kindOfFile('a.ofx', bytesOf('x')), 'ofx');
  assert.equal(kindOfFile('a.csv', bytesOf('x')), 'csv');
  await assert.rejects(() => readStatementFile({ name: 'vide.pdf', bytes: new Uint8Array(0) }, pdfTools), (e) => e.code === 'empty');
  await assert.rejects(() => readStatementFile({ name: 'faux.pdf', bytes: bytesOf('%PDF-1.4 ceci n\'est pas un vrai pdf') }, pdfTools), (e) => e instanceof StatementError && e.code === 'unreadable');
  await assert.rejects(() => readStatementFile({ name: 'photo.jpg', bytes: bytesOf('JFIF') }, pdfTools), (e) => e.code === 'format');
  const viaContent = await readStatementFile({ name: 'export.dat', bytes: bytesOf('Date;Libellé;Montant\n01/09/2026;Test;-1,00\n') }, pdfTools);
  assert.equal(viaContent.format, 'csv');
});
