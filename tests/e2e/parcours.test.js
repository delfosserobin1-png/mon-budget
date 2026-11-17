// Parcours de bout en bout, dans un vrai navigateur : ce que fait un utilisateur, de la première
// ouverture à la saisie quotidienne. Chaque test part d'une appli vide.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, addOperation, fillOperation, openTab, sheet, answer, dialogGone, noOverlay, readState, balancesOf, valueOf, TODAY } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

test('première ouverture : bienvenue, solde de départ, et tout est encore là après fermeture', async () => {
  const ctx = await openApp({ onboarding: true });
  const { page } = ctx;
  await page.locator('.sheet [data-action="start-balance"]').click();
  await page.locator('.sheet input[name="amount"]').fill('1500');
  await page.locator('.sheet [data-action="save-balance"]').click();
  await noOverlay(page);
  assert.deepEqual(await balancesOf(page), { available: 150000, total: 150000 });
  assert.equal(await page.locator('.op-row .title').first().innerText(), 'Solde de départ');

  // on « ferme et rouvre » l'appli : même stockage, nouvelle page
  const again = await openApp({ context: ctx.context });
  assert.equal(await again.page.locator('.sheet').count(), 0, "l'écran de bienvenue ne revient pas");
  assert.deepEqual(await balancesOf(again.page), { available: 150000, total: 150000 });
  assert.deepEqual(again.problems, []);
  await done(ctx);
});

test('dépense : saisie complète, modification, suppression puis annulation', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await sheet(page).locator('input[name="amount"]').fill('23,90');
  await sheet(page).locator('input[name="label"]').fill('Courses du samedi');
  await sheet(page).locator('input[name="counterparty"]').fill('Marché des Halles');
  await sheet(page).locator('.pick', { hasText: 'Nécessité' }).click();
  await sheet(page).locator('[data-action="new-tag"]').click();
  await page.locator('.dialog input').fill('Courses');
  await answer(page, 'ok');
  await dialogGone(page);
  await sheet(page).locator('.pick[aria-pressed="true"]', { hasText: 'Courses' }).waitFor();
  await sheet(page).locator('textarea[name="comment"]').fill('Fruits et légumes');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);

  let state = await readState(page);
  assert.equal(state.operations.length, 1);
  const op = state.operations[0];
  assert.equal(op.amount, -2390);
  assert.equal(op.label, 'Courses du samedi');
  assert.equal(op.counterparty, 'Marché des Halles');
  assert.equal(op.importance, 'necessite');
  assert.equal(op.date, TODAY);
  assert.equal(state.tags.length, 1);
  assert.deepEqual(op.tags, [state.tags[0].id]);
  assert.equal(op.comment, 'Fruits et légumes');
  assert.deepEqual(await balancesOf(page), { available: -2390, total: -2390 });
  assert.match(await page.locator('.op-row .meta').first().innerText(), /Courses/);

  // modification du montant
  await page.locator('.op-row').first().click();
  await sheet(page).locator('input[name="amount"]').fill('25');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  assert.equal((await balancesOf(page)).available, -2500);

  // suppression, puis « Annuler »
  await page.locator('.op-row').first().click();
  await sheet(page).locator('[data-action="delete"]').click();
  await noOverlay(page);
  assert.equal((await readState(page)).operations.length, 0);
  await page.locator('.undo-pill').click();
  await page.waitForFunction(() => window.monBudget.state.operations.length === 1);
  assert.equal((await balancesOf(page)).available, -2500);

  // une deuxième annulation remet l'ancien montant, une troisième retire l'opération
  await page.evaluate(() => window.monBudget.undo());
  await page.waitForFunction(() => window.monBudget.state.operations[0]?.amount === -2390);
  await page.evaluate(() => window.monBudget.undo());
  await page.waitForFunction(() => window.monBudget.state.operations.length === 0);
  state = await readState(page);
  assert.equal(state.tags.length, 1, 'le tag créé à part reste');
  await done(ctx);
});

test('saisie : montants refusés, virgule ou point, brouillon retrouvé', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await sheet(page).locator('[data-action="save"]').click();
  assert.match(await sheet(page).locator('[data-field="amount"] .error').innerText(), /Indique un montant/);
  await sheet(page).locator('input[name="amount"]').fill('12,345');
  await sheet(page).locator('[data-action="save"]').click();
  assert.match(await sheet(page).locator('[data-field="amount"] .error').innerText(), /illisible/);
  // on ferme sans enregistrer : la saisie est gardée en brouillon
  await sheet(page).locator('input[name="amount"]').fill('7.5');
  await sheet(page).locator('input[name="label"]').fill('Café');
  await page.waitForTimeout(450);
  await sheet(page).locator('.sheet-head .icon-btn').click();
  await noOverlay(page);
  assert.equal((await readState(page)).operations.length, 0);
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  assert.equal(await sheet(page).locator('input[name="label"]').inputValue(), 'Café');
  assert.equal(await sheet(page).locator('input[name="amount"]').inputValue(), '7.5');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  assert.equal((await readState(page)).operations[0].amount, -750);
  // le brouillon est consommé
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  assert.equal(await sheet(page).locator('input[name="label"]').inputValue(), '');
  await done(ctx);
});

test('revenu, puis virement vers une enveloppe : le solde total ne bouge pas', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '2000', label: 'Salaire' });
  await openTab(page, 'envelopes');
  await page.locator('[data-screen="envelopes"] [data-action="add-envelope"]').click();
  await sheet(page).locator('input[name="name"]').fill('Vacances');
  await sheet(page).locator('input[name="goalAmount"]').fill('1200');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  // la fiche de la nouvelle enveloppe s'ouvre d'elle-même
  await page.waitForSelector('[data-screen="envelope"]');
  await page.locator('[data-action="env-fund"]').click();
  await sheet(page).locator('input[name="amount"]').fill('500');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  assert.equal(await valueOf(page, 'envelope-balance'), 50000);
  await page.evaluate(() => window.monBudget.back());
  await openTab(page, 'operations');
  assert.deepEqual(await balancesOf(page), { available: 150000, total: 200000 });
  await done(ctx);
});

test("enveloppe : jamais négative (complément proposé), retrait au-delà du contenu refusé", async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '1000', label: 'Salaire' });
  await page.evaluate(async () => {
    const app = window.monBudget;
    const { planSaveEnvelope } = await import('./js/core/envelopes.js');
    const { planSaveTransfer } = await import('./js/core/operations.js');
    const env = planSaveEnvelope(app.state, { name: 'Voiture' });
    await app.commit(env.cs, { undoable: false });
    const tr = planSaveTransfer(app.state, { amount: 10000, date: app.today(), from: null, to: env.envelope.id }, { today: app.today() });
    await app.commit(tr.cs, { undoable: false });
  });
  await openTab(page, 'envelopes');
  await page.locator('.env-card', { hasText: 'Voiture' }).click();
  assert.equal(await valueOf(page, 'envelope-balance'), 10000);

  // dépense de 135 € dans une enveloppe qui en contient 100 → complément de 35 € proposé
  await page.locator('[data-action="env-spend"]').click();
  await fillOperation(page, { amount: '135', label: 'Pneus' });
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog').innerText(), /il manque 35,00/);
  await answer(page, true);
  await noOverlay(page);
  assert.equal(await valueOf(page, 'envelope-balance'), 0);
  let state = await readState(page);
  const topup = state.operations.find((o) => o.auto === 'topup');
  assert.equal(topup.amount, 3500);

  // refus du complément : rien n'est enregistré
  await page.locator('[data-action="env-spend"]').click();
  await fillOperation(page, { amount: '20', label: 'Lavage' });
  await page.waitForSelector('.dialog');
  await answer(page, false);
  assert.equal((await readState(page)).operations.length, state.operations.length);
  assert.equal(await page.locator('.sheet').count(), 1, 'le formulaire reste ouvert pour corriger');
  await sheet(page).locator('.sheet-head .icon-btn').click();
  await noOverlay(page);

  // retirer plus que le contenu : refusé avec une explication, rien n'est écrit
  await page.locator('[data-action="env-fund"]').click();
  await fillOperation(page, { amount: '40' });
  await noOverlay(page);
  assert.equal(await valueOf(page, 'envelope-balance'), 4000);
  await page.locator('[data-action="env-withdraw"]').click();
  await fillOperation(page, { amount: '60' });
  assert.match(await sheet(page).locator('.error:not([hidden])').first().innerText(), /il manquerait 20,00/);
  await sheet(page).locator('input[name="amount"]').fill('40');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  assert.equal(await valueOf(page, 'envelope-balance'), 0);
  // enveloppe vide : « Retirer » n'est plus proposé
  assert.equal(await page.locator('[data-action="env-withdraw"]').isDisabled(), true);
  state = await readState(page);
  await page.evaluate(() => window.monBudget.back());
  await openTab(page, 'operations');
  assert.deepEqual(await balancesOf(page), { available: 100000 - 13500, total: 100000 - 13500 });
  await done(ctx);
});
