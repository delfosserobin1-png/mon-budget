// Fabrique un classeur Excel (.xlsx) sans bibliothèque externe.
// Un .xlsx est une archive ZIP contenant quelques fichiers XML ; on écrit le strict nécessaire :
// plusieurs feuilles, en-têtes en gras figés, largeurs de colonnes, vraies dates et vrais montants
// (pour que les tris, filtres et sommes fonctionnent dans Excel, LibreOffice ou Google Sheets).

import { zipStore } from './zip.js';

// Types de colonne : 'text' | 'money' (euros, nombre) | 'date' ("AAAA-MM-JJ") | 'int'
const STYLE = { text: 0, header: 1, date: 2, money: 3, int: 4 };

// Caractères interdits en XML 1.0 (caractères de contrôle et deux « non-caractères »).
const XML_FORBIDDEN = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F' + String.fromCharCode(0xfffe, 0xffff) + ']', 'g');
const BOM = String.fromCharCode(0xfeff); // marque d'encodage attendue par Excel pour lire les accents

function esc(value) {
  return String(value ?? '')
    .replace(XML_FORBIDDEN, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** "AAAA-MM-JJ" → numéro de série Excel (jours depuis le 30-12-1899). */
export function excelSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) + 25569;
}

function cell(ref, value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'date') {
    const serial = excelSerial(value);
    if (serial === null) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
  }
  if ((type === 'money' || type === 'int') && Number.isFinite(value)) {
    return `<c r="${ref}" s="${type === 'money' ? STYLE.money : STYLE.int}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(sheet) {
  const cols = sheet.columns;
  const lastCol = columnName(cols.length - 1);
  const lastRow = sheet.rows.length + 1;
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  xml += `<dimension ref="A1:${lastCol}${lastRow}"/>`;
  xml += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  xml += '<cols>' + cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('') + '</cols>';
  xml += '<sheetData>';
  xml += '<row r="1">' + cols.map((c, i) => `<c r="${columnName(i)}1" s="${STYLE.header}" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`).join('') + '</row>';
  sheet.rows.forEach((row, r) => {
    xml += `<row r="${r + 2}">` + cols.map((c, i) => cell(`${columnName(i)}${r + 2}`, row[i], c.type || 'text')).join('') + '</row>';
  });
  xml += '</sheetData>';
  if (sheet.rows.length) xml += `<autoFilter ref="A1:${lastCol}${lastRow}"/>`;
  xml += '</worksheet>';
  return xml;
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00\\ &quot;€&quot;;[Red]\\-#,##0.00\\ &quot;€&quot;"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE7ECFC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Nom de feuille accepté par Excel : 31 caractères max, sans \ / ? * [ ] : */
function sheetName(name, used) {
  let base = String(name || 'Feuille').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Feuille';
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base.slice(0, 28)} ${n++}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * sheets : [{ name, columns: [{ header, type?, width? }], rows: [[valeur, …], …] }]
 * Renvoie le contenu du fichier .xlsx (Uint8Array).
 */
export function buildXlsx(sheets) {
  const used = new Set();
  const names = sheets.map((s) => sheetName(s.name, used));
  const files = [];
  files.push({
    name: '[Content_Types].xml',
    data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>',
  });
  files.push({
    name: '_rels/.rels',
    data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  });
  files.push({
    name: 'xl/workbook.xml',
    data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
      '</workbook>',
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  });
  files.push({ name: 'xl/styles.xml', data: STYLES_XML });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
  return zipStore(files);
}

/** Fichier CSV lisible par Excel en français : séparateur point-virgule, virgule décimale, BOM UTF-8. */
export function buildCsv(columns, rows) {
  const field = (value, type) => {
    if (value === null || value === undefined) return '';
    let text;
    if (type === 'money' && Number.isFinite(value)) text = value.toFixed(2).replace('.', ',');
    else if (type === 'date') text = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : String(value);
    else text = String(value);
    // Protection contre l'exécution de formules à l'ouverture dans un tableur
    if (type !== 'money' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((c) => field(c.header, 'text')).join(';')];
  for (const row of rows) lines.push(columns.map((c, i) => field(row[i], c.type || 'text')).join(';'));
  return BOM + lines.join('\r\n') + '\r\n';
}
