// Fabrique un relevé de compte PDF FICTIF (personne, compte et opérations inventés), mis en page
// comme un relevé Société Générale. Il sert :
//   - aux tests automatiques de l'import de relevé ;
//   - de fichier d'essai dans l'appli (bouton « Essayer avec un relevé d'exemple »).
// Usage : node tools/make-sample-statement.mjs   → www/exemples/releve-exemple.pdf
//                                                 + tests/fixtures/releve-exemple.attendu.json
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// [date banque, libellé, montant en centimes (négatif = débit), lignes de détail, n° isolé à droite du libellé]
const OPENING = 154230; // solde précédent au 07/07/2026
const LINES = [
  ['08/07/2026', 'CARTE X1234 06/07 BOULANGERIE DU PARC', -420],
  ['08/07/2026', 'CARTE X1234 07/07 SUPER MARCHE BIO 0412', -5630],
  ['09/07/2026', 'CARTE X1234 07/07 BOULANGERIE DU PARC', -310],
  ['10/07/2026', 'VIR INST RE 550012345678', 4500, ['WERO', 'DE: JULIE MOREAU', 'DATE: 10/07/2026 09:12', 'MOTIF: Remboursement restaurant', 'REF: 0a1b2c3d4e5f60718293a4b5c6d7e8f9']],
  ['10/07/2026', '000001 VIR INSTANTANE EMIS LOGITEL', -12000, ['POUR: M. PAUL DURAND', '10 07 BQ EXEMPLE CPT 00011122233', 'DATE: 10/07/2026 18:40', 'MOTIF: Participation cadeau', 'REF: 550012349999', 'CHEZ: BANQUE EXEMPLE']],
  ['13/07/2026', 'CARTE X1234 10/07 PEAGE A10', -1290, [], '7700456'],
  ['13/07/2026', 'CARTE X1234 11/07 STATION SERVICE 77', -6240],
  ['15/07/2026', 'CARTE X1234 14/07 LIBRAIRIE DES ARTS', -2390, ['COMMERCE ELECTRONIQUE']],
  ['16/07/2026', 'PRELEVEMENT EUROPEEN 5500012301', -3999, ['DE: ENERGIE EXEMPLE SA', 'ID: FR00ZZZ123456', 'MOTIF: Facture juillet', 'REF: FACT-2026-07-0042', 'MANDAT M000123456']],
  ['20/07/2026', 'CARTE X1234 17/07 SUPER MARCHE BIO 0412', -4815],
  ['21/07/2026', 'COTISATION JAZZ', -720, [], null, 132.5],
  ['22/07/2026', 'CARTE X1234 21/07 CINEMA LE STUDIO', -1900],
  ['24/07/2026', 'CARTE X1234 23/07 PHARMACIE CENTRALE', -1185],
  ['27/07/2026', 'CARTE X1234 25/07 RESTAURANT LE JARDIN', -4350],
  ['28/07/2026', 'CARTE X1234 REMBT 26/07 LIBRAIRIE DES ARTS', 2390],
  ['30/07/2026', 'VIR RECU 5500045602S', 210000, ['DE: ENTREPRISE EXEMPLE SAS', 'MOTIF: SALAIRE JUILLET', 'REF: PAIE-2026-07']],
  ['31/07/2026', 'CARTE X1234 30/07 BOULANGERIE DU PARC', -560],
  ['03/08/2026', '000001 VIR PERM', -65000, ['POUR: SCI DES LILAS', '03 08 BQ EXEMPLE CPT 00044455566', 'MOTIF: Loyer mensuel', 'REF: 550012360001']],
  ['03/08/2026', 'CARTE X1234 01/08 SUPER MARCHE BIO 0412', -7245],
  ['05/08/2026', 'PRELEVEMENT EUROPEEN 5500078903', -1999, ['DE: TELEPHONE EXEMPLE', 'ID: FR11ZZZ654321', 'MOTIF: Forfait mobile', 'REF: TEL-0826', 'MANDAT M000987654']],
  ['06/08/2026', 'CARTE X1234 05/08 FLEURISTE ROSE', -2500],
  ['07/08/2026', 'CARTE X1234 06/08 SUPER MARCHE BIO 0412', -3120],
];
const CHECKPOINT_AFTER = '31/07/2026';

const fr = (cents) => {
  const abs = Math.abs(cents);
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${euros},${String(abs % 100).padStart(2, '0')}`;
};

const pdf = await PDFDocument.create();
pdf.setTitle('Relevé de compte fictif (exemple Mon Budget)');
pdf.setCreationDate(new Date('2026-08-08T08:00:00Z'));
pdf.setModificationDate(new Date('2026-08-08T08:00:00Z'));
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const SIZE = 8;
const DEBIT_RIGHT = 476.7;
const CREDIT_RIGHT = 559.6;
let page = null;
let pageNumber = 0;
let y = 0;
const pages = [];

const text = (p, str, x, yy, f = font, size = SIZE, opts = {}) => p.drawText(str, { x, y: yy, size, font: f, ...opts });
const right = (p, str, xRight, yy, f = font) => text(p, str, xRight - f.widthOfTextAtSize(str, SIZE), yy, f);

function newPage(first) {
  page = pdf.addPage([595.28, 841.89]);
  pages.push(page);
  pageNumber++;
  text(page, 'RELEVÉ DE COMPTE', 423.8, 801, bold, 12);
  text(page, 'COMPTE DE PARTICULIER - en euros', 380, 786);
  text(page, 'n° 30003 01234 00012345678 90', 418.3, 765);
  text(page, 'du 08/07/2026 au 07/08/2026', 434.6, 754);
  text(page, 'envoi n°8', 468, 742);
  page.drawText('N° EXEMPLE : DOCUMENT FICTIF', { x: 583.8, y: 202, size: 6, font, rotate: degrees(90) });
  text(page, 'Société Générale', 28.3, 40);
  text(page, 'Document fictif généré pour les tests de Mon Budget — aucune donnée réelle.', 175.7, 40, font, 6);
  if (first) {
    text(page, 'MME NADIA LEROUX', 314.6, 678);
    text(page, '12 RUE DES EXEMPLES', 314.6, 668);
    text(page, '75000 VILLE FICTIVE', 314.6, 658);
    text(page, 'Votre agence sera ouverte tout l\'été.', 195.4, 447);
    text(page, 'RELEVÉ DES OPÉRATIONS', 29.8, 364, bold, 10);
    y = 349;
  } else {
    y = 714;
  }
  text(page, 'Date', 40.6, y, bold);
  text(page, 'Valeur', 81.8, y, bold);
  text(page, "Nature de l'opération", 211.2, y, bold);
  text(page, 'Débit', 431, y, bold);
  text(page, 'Crédit', 511.4, y, bold);
  y -= 12;
}

function ensure(space, allowSplit = false) {
  if (y - space < 70 || allowSplit) {
    text(page, 'suite >>>', 529.2, y - 4);
    text(page, '1 Depuis l\'étranger : (+33) 1 00 00 00 00', 28.3, 113 > y - 20 ? y - 30 : 113);
    newPage(false);
  }
}

newPage(true);
text(page, 'SOLDE PRÉCÉDENT AU 07/07/2026', 262.6, y);
right(page, fr(OPENING), CREDIT_RIGHT, y);
y -= 12;

let running = OPENING;
let debit = 0;
let credit = 0;
let checkpointDone = false;
LINES.forEach(([date, label, amount, details = [], extra = null, labelX = 124.1], index) => {
  if (!checkpointDone && date.slice(3) !== CHECKPOINT_AFTER.slice(3) && date.slice(6) === '2026' && date.slice(3, 5) === '08') {
    ensure(14);
    text(page, `*** SOLDE AU ${CHECKPOINT_AFTER} ${running < 0 ? '-' : '+'} ${fr(running)} ***`, 253.7, y);
    y -= 14;
    checkpointDone = true;
  }
  // Une opération volontairement coupée entre deux pages (détails en haut de la page suivante)
  const split = index === 8;
  ensure(14 + (split ? 0 : details.length * 9));
  text(page, date, 31.2, y);
  text(page, date, 77, y);
  text(page, label, labelX, y);
  if (extra) text(page, extra, 263.8, y);
  right(page, fr(amount), amount < 0 ? DEBIT_RIGHT : CREDIT_RIGHT, y);
  y -= 9;
  details.forEach((d, i) => {
    if (split && i === 2) ensure(0, true);
    text(page, d, 124.1, y);
    y -= 9;
  });
  y -= 5;
  running += amount;
  if (amount < 0) debit += -amount;
  else credit += amount;
});

ensure(40);
text(page, 'TOTAUX DES MOUVEMENTS', 289.4, y, bold);
right(page, fr(debit), DEBIT_RIGHT, y);
right(page, fr(credit), CREDIT_RIGHT, y);
y -= 21;
text(page, 'NOUVEAU SOLDE AU 07/08/2026', 271.9, y, bold);
right(page, `${running < 0 ? '-' : '+'} ${fr(running)}`, CREDIT_RIGHT, y);
y -= 20;
text(page, 'Les écritures précédées du signe désignent les frais sur vos opérations bancaires courantes.', 28.3, y, font, 6);
text(page, 'Sur la période du 08/07/2026 au 07/08/2026, le total des frais est de 7,20 euros.', 40.1, y - 20, font, 6);

// Numéros de page (connus seulement maintenant que toutes les pages existent)
pages.forEach((p, i) => text(p, `Page ${i + 1}/${pages.length}`, 526.3, 742));

const bytes = await pdf.save({ useObjectStreams: false });
writeFileSync(join(root, 'www/exemples/releve-exemple.pdf'), bytes);
writeFileSync(
  join(root, 'tests/fixtures/releve-exemple.attendu.json'),
  JSON.stringify(
    {
      periodStart: '2026-07-08',
      periodEnd: '2026-08-07',
      openingBalance: OPENING,
      closingBalance: running,
      totalDebit: debit,
      totalCredit: credit,
      lineCount: LINES.length,
      amounts: LINES.map((l) => l[2]),
      detailCounts: LINES.map((l) => (l[3] || []).length),
      pages: pages.length,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Relevé fictif : ${LINES.length} lignes, ${pages.length} pages, débits ${fr(debit)}, crédits ${fr(credit)}, nouveau solde ${fr(running)}`);
