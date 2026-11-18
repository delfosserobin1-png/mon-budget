// Formulaire d'opération : ce qui est écrit dans les champs fait foi, même quand une suggestion
// (liste du champ, clavier du téléphone) l'y a mis sans que l'appli en soit prévenue.
// Vu chez GitHub le 18-11-2026 : « Anniversaire » tapé, la suggestion « Cadeau d'anniversaire »
// survolée, puis Dépense → Revenu → Dépense : le libellé était perdu à l'enregistrement.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, sheet, noOverlay, readState } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

/** Écrit dans un champ comme une suggestion silencieuse : la valeur change, sans aucun événement. */
async function silentType(page, name, value) {
  await sheet(page).locator(`[name="${name}"]`).evaluate((input, text) => {
    input.value = text;
  }, value);
}

test('saisie : un libellé posé sans événement survit au changement de type, et c’est ce qui est écrit qui est enregistré', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  const form = sheet(page);
  await form.locator('input[name="amount"]').fill('12,34');
  await silentType(page, 'label', 'Anniversaire');
  // changer de type redessine le formulaire : le libellé reste
  await form.locator('.seg button[data-value="income"]').click();
  assert.equal(await form.locator('input[name="label"]').inputValue(), 'Anniversaire');
  await form.locator('.seg button[data-value="expense"]').click();
  assert.equal(await form.locator('input[name="label"]').inputValue(), 'Anniversaire');
  // à l'enregistrement aussi, ce qui est écrit fait foi
  await silentType(page, 'counterparty', 'Librairie du Centre');
  await silentType(page, 'comment', 'Pour Léa');
  await form.locator('[data-action="save"]').click();
  await noOverlay(page);
  const op = (await readState(page)).operations.find((o) => o.amount === -1234);
  assert.deepEqual([op.label, op.counterparty, op.comment], ['Anniversaire', 'Librairie du Centre', 'Pour Léa']);
  await done(ctx);
});

test('saisie : « Effacer » le brouillon repris vide vraiment le formulaire', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await sheet(page).locator('input[name="amount"]').fill('7');
  await sheet(page).locator('input[name="label"]').fill('Boulangerie');
  await sheet(page).locator('.sheet-head .icon-btn').click();
  await noOverlay(page);

  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  const form = sheet(page);
  assert.equal(await form.locator('input[name="label"]').inputValue(), 'Boulangerie', 'le brouillon est repris');
  await form.locator('.notice button', { hasText: 'Effacer' }).click();
  assert.equal(await form.locator('input[name="label"]').inputValue(), '', 'le libellé est vidé');
  assert.equal(await form.locator('input[name="amount"]').inputValue(), '', 'le montant aussi');
  assert.equal(await form.locator('.notice', { hasText: 'Brouillon repris' }).count(), 0);
  await form.locator('.sheet-head .icon-btn').click();
  await noOverlay(page);
  await done(ctx);
});
