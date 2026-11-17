// Prévisions : simulations à cocher, récurrences, passage des jours.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, addOperation, fillOperation, openTab, sheet, answer, noOverlay, readState, balancesOf, valueOf, TODAY } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

test('simulation : compte dans le solde estimé, pas dans le solde réel ; cocher, décocher, confirmer', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '1000', label: 'Salaire' });
  await openTab(page, 'forecast');
  assert.equal(await valueOf(page, 'projected'), 100000);

  await page.locator('[data-action="add-forecast"]').click();
  await fillOperation(page, { amount: '300', label: 'Vélo', date: '2026-11-20' });
  await noOverlay(page);
  assert.equal(await valueOf(page, 'projected'), 70000);
  let state = await readState(page);
  const sim = state.operations.find((o) => o.label === 'Vélo');
  assert.equal(sim.simulated, true);
  assert.equal(sim.checked, true);

  // décocher : l'estimation remonte
  await page.locator(`[data-op="${sim.id}"] .tick-hit`).click();
  await page.waitForFunction((id) => window.monBudget.state.operations.find((o) => o.id === id).checked === false, sim.id);
  assert.equal(await valueOf(page, 'projected'), 100000);
  await page.locator('[data-action="check-all"]').click();
  await page.waitForFunction((id) => window.monBudget.state.operations.find((o) => o.id === id).checked === true, sim.id);
  assert.equal(await valueOf(page, 'projected'), 70000);

  // le solde réel n'a pas bougé
  await openTab(page, 'operations');
  assert.deepEqual(await balancesOf(page), { available: 100000, total: 100000 });
  assert.equal(await page.locator('[data-screen="operations"] .op-row', { hasText: 'Vélo' }).count(), 0, 'une prévision ne se mélange pas aux opérations réelles');

  // « elle a eu lieu » : la prévision devient une vraie opération
  await openTab(page, 'forecast');
  await page.locator(`[data-op="${sim.id}"]`).click();
  await sheet(page).locator('[data-action="confirm-simulation"]').click();
  await noOverlay(page);
  state = await readState(page);
  assert.equal(state.operations.find((o) => o.id === sim.id).simulated, false);
  await openTab(page, 'operations');
  assert.equal((await balancesOf(page)).available, 70000);
  await done(ctx);
});

test('récurrence : échéances passées reprises, prévisions créées, pause, suppression', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await openTab(page, 'forecast');
  await page.locator('[data-screen="forecast"] .seg button[data-value="recurring"]').click();
  await page.locator('[data-action="create-first-recurring"]').click();
  await sheet(page).locator('.seg button[data-value="income"]').click();
  await sheet(page).locator('input[name="amount"]').fill('1800');
  await sheet(page).locator('input[name="label"]').fill('Salaire');
  await sheet(page).locator('input[name="startDate"]').fill('2026-09-28');
  await sheet(page).locator('[data-action="save"]').click();
  // deux échéances sont déjà passées (28-09 et 28-10) : l'appli demande quoi en faire
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog').innerText(), /2 échéances sont déjà passées/);
  await answer(page, 'all');
  await noOverlay(page);

  let state = await readState(page);
  const rule = state.recurring[0];
  const real = state.operations.filter((o) => !o.simulated);
  const planned = state.operations.filter((o) => o.simulated);
  assert.deepEqual(real.map((o) => o.date).sort(), ['2026-09-28', '2026-10-28']);
  assert.equal(planned[0].recurringId, rule.id);
  assert.ok(planned.length >= 5, 'les échéances des prochains mois sont prévues');
  assert.equal(planned.map((o) => o.date).sort()[0], '2026-11-28');
  await openTab(page, 'operations');
  assert.equal((await balancesOf(page)).available, 360000);

  // mise en pause : plus aucune échéance à venir, l'historique reste
  await openTab(page, 'forecast');
  await page.locator(`[data-rule="${rule.id}"]`).click();
  await sheet(page).locator('[data-field="active"]').click();
  await noOverlay(page);
  state = await readState(page);
  assert.equal(state.recurring[0].active, false);
  assert.equal(state.operations.filter((o) => o.simulated).length, 0);
  assert.equal(state.operations.filter((o) => !o.simulated).length, 2);

  // relance, puis suppression « tout »
  await page.locator(`[data-rule="${rule.id}"]`).click();
  await sheet(page).locator('[data-field="active"]').click();
  await noOverlay(page);
  assert.ok((await readState(page)).operations.filter((o) => o.simulated).length >= 5);
  await page.locator(`[data-rule="${rule.id}"]`).click();
  await sheet(page).locator('[data-action="delete"]').click();
  await answer(page, 'all');
  await noOverlay(page);
  state = await readState(page);
  assert.equal(state.recurring.length, 0);
  assert.equal(state.operations.length, 0);
  // et tout cela s'annule
  await page.evaluate(() => window.monBudget.undo());
  await page.waitForFunction(() => window.monBudget.state.recurring.length === 1);
  assert.equal((await readState(page)).operations.filter((o) => !o.simulated).length, 2);
  await done(ctx);
});

test("le jour venu, l'échéance d'une récurrence devient une vraie opération, toute seule", async () => {
  const ctx = await openApp({ now: '2026-11-15T23:58:30' });
  const { page } = ctx;
  await page.evaluate(async () => {
    const app = window.monBudget;
    const { planSaveRecurring } = await import('./js/core/recurring.js');
    const plan = planSaveRecurring(app.state, { kind: 'operation', label: 'Abonnement', amount: -999, frequency: 'monthly', interval: 1, startDate: '2026-11-16' }, { today: app.today() });
    await app.commit(plan.cs, { undoable: false });
  });
  assert.equal((await balancesOf(page)).available, 0);
  // minuit passe pendant que l'appli est ouverte
  await page.clock.fastForward('00:03:00');
  await page.waitForFunction(() => window.monBudget.state.operations.some((o) => o.date === '2026-11-16' && !o.simulated));
  await page.waitForFunction(() => document.querySelector('[data-value="available"]').textContent.includes('9,99'));
  assert.equal((await balancesOf(page)).available, -999);
  const state = await readState(page);
  assert.equal(state.operations.filter((o) => o.date === '2026-11-16').length, 1, 'pas de doublon');
  await done(ctx);
});

test('prévision décochée arrivée à sa date : elle reste une prévision « à confirmer »', async () => {
  const ctx = await openApp({ now: '2026-11-15T10:00:00' });
  const { page } = ctx;
  await openTab(page, 'forecast');
  await page.locator('[data-action="add-forecast"]').click();
  await fillOperation(page, { amount: '50', label: 'Peut-être un resto', date: '2026-11-16' });
  await noOverlay(page);
  const id = (await readState(page)).operations[0].id;
  await page.locator(`[data-op="${id}"] .tick-hit`).click();
  await page.waitForFunction(() => window.monBudget.state.operations[0].checked === false);
  await page.clock.fastForward('40:00:00');
  await page.waitForFunction(() => window.monBudget.today() === '2026-11-17');
  await page.waitForTimeout(200);
  const op = (await readState(page)).operations[0];
  assert.equal(op.simulated, true, 'une prévision manuelle ne devient jamais réelle sans toi');
  await openTab(page, 'operations');
  assert.equal((await balancesOf(page)).available, 0);
  await openTab(page, 'forecast');
  assert.match(await page.locator('[data-screen="forecast"] .month-sep').last().innerText(), /à confirmer/);
  await done(ctx);
});
