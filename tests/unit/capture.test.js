// Capture d'écran du bouton IA : la partie qui se teste sans navigateur (le masquage des montants).
// La capture elle-même (dessin de l'écran en image) est vérifiée dans tests/e2e/annotation.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskAmountsText } from '../../www/js/ui/capture.js';

const nbsp = String.fromCharCode(0x00a0);
const narrow = String.fromCharCode(0x202f);

test('montants masqués : tous les formats affichés par l’appli, et rien d’autre', () => {
  assert.equal(maskAmountsText(`1${narrow}187,70${nbsp}€`), '••• €');
  assert.equal(maskAmountsText(`−12,30${nbsp}€`), '••• €');
  assert.equal(maskAmountsText(`+1${nbsp}200,00 €`), '••• €');
  assert.equal(maskAmountsText(`Reste 50,00${nbsp}€ ce mois-ci, soit 3,12${nbsp}€ par jour`), 'Reste ••• € ce mois-ci, soit ••• € par jour');
  assert.equal(maskAmountsText('15 dim. Courses 11-2026'), '15 dim. Courses 11-2026', 'dates et jours intacts');
  assert.equal(maskAmountsText('2 opérations, 12,00 €'), '2 opérations, ••• €');
  assert.equal(maskAmountsText(''), '');
});
