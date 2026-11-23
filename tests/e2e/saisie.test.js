// Formulaire d'opération : ce qui est écrit dans les champs fait foi, même quand une suggestion
// (liste du champ, clavier du téléphone) l'y a mis sans que l'appli en soit prévenue ; et le curseur
// n'est jamais arraché à un champ qu'on a commencé à remplir.
// Vu chez GitHub (18 et 24-11-2026) : un libellé tapé juste après l'ouverture du formulaire était
// perdu. La cause : le curseur, posé sur le Montant « à l'image suivante », arrivait en retard sur
// ces machines lentes, en pleine frappe du libellé ; le texte partait dans le Montant (qui refuse les
// lettres). Voir focusOnOpen dans ui/overlays.js.
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

test('saisie : à l’ouverture, le curseur va au montant, mais jamais hors d’un champ déjà commencé', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  // ouverture normale : le montant reçoit le curseur
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await page.waitForFunction(() => document.activeElement?.name === 'amount');
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);
  // un champ commencé avant l'image suivante (machine lente, automate) garde le curseur et son texte
  const kept = await page.evaluate(async () => {
    const { openOperationForm } = await import('./js/ui/forms/operation.js');
    openOperationForm(window.monBudget);
    const label = document.querySelector('.sheet input[name="label"]');
    label.focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.activeElement === label;
  });
  assert.equal(kept, true, 'le libellé garde le curseur');
  // et ce qu'on y tape va bien au libellé
  await page.keyboard.type('Boulangerie');
  await page.locator('.sheet input[name="amount"]').fill('3,20');
  await page.locator('.sheet [data-action="save"]').click();
  await noOverlay(page);
  assert.deepEqual((await readState(page)).operations.map((o) => [o.label, o.amount]), [['Boulangerie', -320]]);
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
