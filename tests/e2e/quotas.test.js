// Quotas par tag (réglage, jauges, avertissement à la saisie, carte dans Stats) et vocabulaire des
// mouvements d'enveloppe (plus de « Virement » dans le bouton +), dans un vrai navigateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, openTab, sheet, noOverlay, settled, readState, fillOperation, shot } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

const plain = (text) => String(text).replace(/\s/g, ' ');

async function openTags(page) {
  await openTab(page, 'more');
  await page.locator('[data-screen="more"] [data-open="tags"]').click();
  await page.waitForSelector('[data-screen="tags"]');
}

test('quota : réglé dans un tag, refusé s’il est incohérent, visible dans Tags et dans Stats', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  await openTags(page);
  // les données d'exemple ont déjà deux quotas (Courses par mois, Restaurant par semaine)
  const state = await readState(page);
  const courses = state.tags.find((t) => t.name === 'Courses');
  assert.deepEqual(courses.quota, { amount: 40000, period: 'month', from: null, to: null });
  assert.equal(await page.locator(`[data-screen="tags"] [data-tag="${courses.id}"] .quota-meter`).count(), 1);
  assert.match(plain(await page.locator(`[data-screen="tags"] [data-tag="${courses.id}"]`).innerText()), /quota 400,00 € par mois/);

  // nouveau tag avec un quota par semaine
  await page.locator('[data-screen="tags"] [data-action="add-tag"]').click();
  const form = sheet(page);
  await form.locator('input[name="name"]').fill('Cadeaux');
  await form.locator('[data-field="quota"]').click();
  assert.equal(await form.locator('[data-block="quota"]').isVisible(), true);
  await form.locator('[data-action="save"]').click();
  assert.match(await form.locator('[data-field="quotaAmount"] .error:not([hidden])').innerText(), /montant à ne pas dépasser/, 'pas de montant : refusé');
  await form.locator('input[name="quotaAmount"]').fill('50');
  // dates choisies, à l'envers : refusé
  await form.locator('.seg button[data-value="custom"]').click();
  await form.locator('input[name="quotaFrom"]').fill('2026-12-20');
  await form.locator('input[name="quotaTo"]').fill('2026-12-01');
  await form.locator('[data-action="save"]').click();
  assert.match(await form.locator('[data-field="quotaTo"] .error:not([hidden])').innerText(), /après le début/);
  await form.locator('.seg button[data-value="week"]').click();
  assert.equal(await form.locator('input[name="quotaFrom"]').isVisible(), false, 'les dates ne servent qu’à « Dates »');
  await form.locator('[data-action="save"]').click();
  await noOverlay(page);
  const gift = (await readState(page)).tags.find((t) => t.name === 'Cadeaux');
  assert.deepEqual(gift.quota, { amount: 5000, period: 'week', from: null, to: null });
  assert.match(plain(await page.locator(`[data-tag="${gift.id}"]`).innerText()), /Reste 50,00 € cette semaine/);

  // une dépense de 45 € : prévenu à 90 % ; 60 € : dépassement annoncé ; on enregistre quand même
  await page.evaluate(() => window.monBudget.go('operations'));
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await fillOperation(page, { amount: '45', label: 'Anniversaire', tags: ['Cadeaux'], save: false });
  const notice = sheet(page).locator('[data-notice="quota"]');
  await notice.waitFor();
  assert.equal(await notice.getAttribute('data-level'), 'warn');
  assert.match(plain(await notice.innerText()), /« Cadeaux » atteint 90 % de son quota \(45,00 € sur 50,00 € cette semaine\)/);
  await sheet(page).locator('input[name="amount"]').fill('60');
  await page.waitForFunction(() => document.querySelector('.sheet [data-notice="quota"]')?.dataset.level === 'over');
  assert.match(plain(await notice.innerText()), /dépasse son quota : 60,00 € sur 50,00 € cette semaine/);
  // un revenu ne déclenche rien
  await sheet(page).locator('.seg button[data-value="income"]').click();
  assert.equal(await sheet(page).locator('[data-notice="quota"]').count(), 0);
  await sheet(page).locator('.seg button[data-value="expense"]').click();
  await sheet(page).locator('.pick', { hasText: 'Cadeaux' }).waitFor();
  await page.waitForFunction(() => !!document.querySelector('.sheet [data-notice="quota"]'));
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);

  // Stats : la carte des quotas, le dépassé en premier ; le toucher ouvre ses dépenses
  await openTab(page, 'stats');
  const card = page.locator('[data-screen="stats"] [data-card="quotas"]');
  await card.waitFor();
  assert.match(await card.locator('.card-head').innerText(), /1 dépassé/);
  assert.equal(await card.locator('[data-quota-row]').first().getAttribute('data-quota-row'), gift.id);
  assert.equal(await card.locator(`[data-quota="${gift.id}"]`).getAttribute('data-level'), 'over');
  await shot(page, 'quotas-stats');
  await card.locator(`[data-quota-row="${gift.id}"]`).click();
  await page.waitForSelector('[data-screen="operations"]:not([hidden])');
  await settled(page);
  const rows = page.locator('[data-screen="operations"] .op-row');
  assert.equal(await rows.count(), 1);
  assert.match(await rows.first().innerText(), /Anniversaire/);
  await done(ctx);
});

test('plus de « Virement » dans le bouton + ; les mouvements d’enveloppe portent leur nom', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await sheet(page).locator('.seg').first().waitFor();
  assert.deepEqual(await sheet(page).locator('.seg').first().locator('button').evaluateAll((list) => list.map((b) => b.dataset.value)), ['expense', 'income']);
  assert.ok(!/virement/i.test(await sheet(page).innerText()), 'le mot « virement » n’apparaît plus dans le formulaire');
  await sheet(page).locator('.sheet-head .icon-btn').click();
  await noOverlay(page);

  // alimenter une enveloppe depuis sa fiche
  const env = (await readState(page)).envelopes.find((e) => !e.closed);
  await openTab(page, 'envelopes');
  await page.locator(`.env-card[data-envelope="${env.id}"]`).click();
  await page.locator('[data-screen="envelope"] [data-action="env-fund"]').click();
  assert.equal(await sheet(page).locator('.sheet-head h2').innerText(), 'Alimenter une enveloppe');
  // inverser le sens change le titre
  await sheet(page).locator('[aria-label="Inverser le sens"]').click();
  assert.equal(await sheet(page).locator('.sheet-head h2').innerText(), "Retirer d'une enveloppe");
  await sheet(page).locator('[aria-label="Inverser le sens"]').click();
  await sheet(page).locator('input[name="amount"]').fill('10');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  assert.equal(await page.locator('.undo-pill').getAttribute('aria-label'), 'Annuler : Enveloppe alimentée');
  const moved = (await readState(page)).operations.filter((o) => o.kind === 'transfer' && o.to === env.id && o.amount === 1000);
  assert.equal(moved.length, 1);
  await page.evaluate(() => window.monBudget.go('operations'));
  await settled(page);
  assert.match(await page.locator(`[data-screen="operations"] [data-op="${moved[0].id}"]`).innerText(), /Alimentation/);
  assert.ok(!/virement interne/i.test(await page.locator('[data-screen="operations"]').innerText()));
  await done(ctx);
});
