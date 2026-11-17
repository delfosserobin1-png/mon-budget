import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseStatementAmount, formatAmount, formatForInput } from '../../www/js/core/money.js';
import * as D from '../../www/js/core/dates.js';
import { normalize, partyKey, matchesQuery, wordOverlap } from '../../www/js/core/text.js';

// Caractères typographiques écrits par leur code : invisibles dans un éditeur, ils seraient fragiles en clair.
const NBSP = String.fromCharCode(0x00a0); // espace insécable (avant €)
const THIN = String.fromCharCode(0x202f); // espace fine insécable (milliers)
const MINUS = String.fromCharCode(0x2212); // signe moins typographique

test('parseAmount lit les saisies courantes et refuse le reste', () => {
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('12,5'), 1250);
  assert.equal(parseAmount('12.50'), 1250);
  assert.equal(parseAmount('0,35'), 35);
  assert.equal(parseAmount('1 234,56'), 123456);
  assert.equal(parseAmount(`1${THIN}234,56 €`), 123456);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('1,234'), null);
  assert.equal(parseAmount('1.2.3'), null);
  assert.equal(parseAmount('12,'), null);
});

test('les sommes en centimes restent exactes là où les décimaux dérivent', () => {
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.equal(parseAmount('0,1') + parseAmount('0,2'), parseAmount('0,3'));
  let total = 0;
  for (let i = 0; i < 1000; i++) total += parseAmount('0,35');
  assert.equal(total, 35000);
});

test('parseStatementAmount lit les montants de relevé', () => {
  assert.equal(parseStatementAmount('2.174,88'), 217488);
  assert.equal(parseStatementAmount('+ 1.542,30'), 154230);
  assert.equal(parseStatementAmount('- 12,00'), -1200);
  assert.equal(parseStatementAmount('0,35'), 35);
  assert.equal(parseStatementAmount('1.234.567,89'), 123456789);
  assert.equal(parseStatementAmount('7700456'), null);
  assert.equal(parseStatementAmount('06/07'), null);
  assert.equal(parseStatementAmount('12,5'), null);
});

test('formatAmount affiche à la française', () => {
  assert.equal(formatAmount(123456), `1${THIN}234,56${NBSP}€`);
  assert.equal(formatAmount(-800), `${MINUS}8,00${NBSP}€`);
  assert.equal(formatAmount(800, { sign: 'always' }), `+8,00${NBSP}€`);
  assert.equal(formatAmount(-800, { sign: 'never' }), `8,00${NBSP}€`);
  assert.equal(formatAmount(5, { currency: false }), '0,05');
  assert.equal(formatAmount(100000000), `1${THIN}000${THIN}000,00${NBSP}€`);
  assert.equal(formatForInput(-123456), '1234,56');
});

test('dates : validité, formats, arithmétique', () => {
  assert.equal(D.isValidISO('2026-02-28'), true);
  assert.equal(D.isValidISO('2026-02-30'), false);
  assert.equal(D.isValidISO('2026-13-01'), false);
  assert.equal(D.isValidISO('26-01-01'), false);
  assert.equal(D.formatDate('2026-11-05'), '05-11-2026');
  assert.equal(D.formatMonthKey('2026-11'), '11-2026');
  assert.equal(D.monthName('2026-08'), 'août 2026');
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(D.daysBetween('2026-07-06', '2026-07-08'), 2);
  assert.equal(D.parseFrenchDate('08/07/2026'), '2026-07-08');
  assert.equal(D.parseFrenchDate('31/02/2026'), null);
  assert.equal(D.endOfMonth('2028-02-10'), '2028-02-29');
  assert.deepEqual(D.monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('addMonths vise toujours le jour demandé (pas de dérive en fin de mois)', () => {
  const seq = [];
  for (let k = 0; k < 6; k++) seq.push(D.addMonths('2026-01-31', k));
  assert.deepEqual(seq, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  assert.equal(D.addMonths('2028-02-29', 12), '2029-02-28');
  assert.equal(D.addMonths('2028-02-29', 48), '2032-02-29');
  assert.equal(D.addMonths('2026-03-15', -3), '2025-12-15');
});

test('le passage à l\'heure d\'été ou d\'hiver ne décale aucune date', () => {
  // Dernier dimanche de mars et d'octobre (changements d'heure en France)
  assert.equal(D.addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(D.addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(D.addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(D.addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(D.daysBetween('2026-03-01', '2026-04-01'), 31);
});

test('texte : recherche sans accents ni casse', () => {
  assert.equal(normalize('  Café  de l\'Été '), "cafe de l'ete");
  assert.equal(partyKey('PEAGE NORD 7700456'), 'peage nord');
  assert.equal(partyKey('ABC*TRAIN EXPRESS'), 'abc train express');
  assert.equal(matchesQuery('Auberge du Pont — déjeuner', 'auberge dej'), true);
  assert.equal(matchesQuery('Auberge du Pont', 'sushi'), false);
  assert.equal(wordOverlap('AUBERGE DU PONT', "Déjeuner à l'auberge du pont"), 1);
  assert.equal(wordOverlap('DISTRIBUTEUR GARE', 'café'), 0);
});
