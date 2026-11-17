// Enveloppes (clôture, réouverture, suppression), archives, règles automatiques, données d'exemple.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startAll, stopAll, openApp, openTab, sheet, answer, noOverlay, settled, dialogGone, readState, balancesOf, valueOf, chooseFile, download, ROOT } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

async function envelopeMenu(page, choice) {
  await page.locator('[data-action="envelope-menu"]').click();
  await answer(page, choice);
}

test("enveloppe : clôture (l'argent revient, les récurrences se mettent en pause), réouverture, suppression en gardant les dépenses", async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const before = await readState(page);
  const total = (await balancesOf(page)).total;
  const env = before.envelopes.find((e) => e.name === 'Vacances');
  const linked = before.recurring.filter((r) => r.to === env.id || r.from === env.id || r.envelopeId === env.id);
  assert.ok(linked.length >= 1, 'une récurrence alimente cette enveloppe dans le jeu d\'exemple');
  await openTab(page, 'envelopes');
  await page.locator(`.env-card[data-envelope="${env.id}"]`).click();
  const inside = await valueOf(page, 'envelope-balance');
  assert.ok(inside > 0);

  await envelopeMenu(page, 'close');
  await page.waitForSelector('.dialog h2:has-text("Clôturer")');
  assert.match(await page.locator('.dialog').innerText(), /retournent sur le compte courant/);
  assert.match(await page.locator('.dialog').innerText(), /en pause/);
  await answer(page, true);
  await noOverlay(page);
  let state = await readState(page);
  assert.equal(state.envelopes.find((e) => e.id === env.id).closed, true);
  assert.equal(await valueOf(page, 'envelope-balance'), 0);
  for (const rule of linked) assert.equal(state.recurring.find((r) => r.id === rule.id).active, false);
  assert.equal(state.operations.filter((o) => o.simulated && linked.some((r) => r.id === o.recurringId)).length, 0, 'plus aucune échéance prévue vers une enveloppe clôturée');
  // le solde total n'a pas bougé : l'argent a seulement changé de case
  await page.evaluate(() => window.monBudget.back());
  await openTab(page, 'operations');
  assert.equal((await balancesOf(page)).total, total);
  // la liste ne montre plus l'enveloppe clôturée, sauf si on le demande
  await openTab(page, 'envelopes');
  assert.equal(await page.locator(`[data-screen="envelopes"] .env-card[data-envelope="${env.id}"]`).count(), 0);
  await page.locator('[data-action="toggle-closed"]').click();
  await page.locator(`[data-screen="envelopes"] .env-card[data-envelope="${env.id}"]`).click();

  // réouverture : les récurrences mises en pause par la clôture repartent
  await page.locator('[data-screen="envelope"] [data-action="reopen"]').click();
  await settled(page);
  state = await readState(page);
  assert.equal(state.envelopes.find((e) => e.id === env.id).closed, false);
  for (const rule of linked) assert.equal(state.recurring.find((r) => r.id === rule.id).active, true);

  // suppression d'une enveloppe qui a des dépenses : on peut les garder (elles passent sur le compte courant)
  await page.evaluate(() => window.monBudget.back());
  const car = before.envelopes.find((e) => e.name === 'Voiture');
  const spent = before.operations.filter((o) => o.envelopeId === car.id && !o.simulated);
  assert.ok(spent.length >= 1);
  await page.locator(`[data-screen="envelopes"] .env-card[data-envelope="${car.id}"]`).click();
  await envelopeMenu(page, 'delete');
  await page.waitForSelector('.dialog h2:has-text("Supprimer")');
  await answer(page, 'detach');
  await noOverlay(page);
  await page.waitForFunction((id) => !window.monBudget.state.envelopes.some((e) => e.id === id), car.id);
  state = await readState(page);
  for (const op of spent) {
    const kept = state.operations.find((o) => o.id === op.id);
    assert.ok(kept, 'la dépense existe toujours');
    assert.equal(kept.envelopeId, null);
  }
  assert.ok(!state.operations.some((o) => o.from === car.id || o.to === car.id));
  await page.evaluate(() => window.monBudget.go('operations'));
  // une suppression aussi s'annule
  await page.evaluate(() => window.monBudget.undo());
  await page.waitForFunction((id) => window.monBudget.state.envelopes.some((e) => e.id === id), car.id);
  await settled(page);
  assert.equal((await balancesOf(page)).total, total);
  await done(ctx);
});

test('enveloppe : objectif, modification, virement vers une autre enveloppe, bilan', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const before = await readState(page);
  const vac = before.envelopes.find((e) => e.name === 'Vacances');
  const gifts = before.envelopes.find((e) => e.name === 'Cadeaux');
  await openTab(page, 'envelopes');
  await page.locator(`.env-card[data-envelope="${vac.id}"]`).click();
  const start = await valueOf(page, 'envelope-balance');
  await envelopeMenu(page, 'edit');
  await sheet(page).locator('input[name="name"]').fill('Cadeaux');
  await sheet(page).locator('[data-action="save"]').click();
  assert.match(await sheet(page).locator('.error:not([hidden])').innerText(), /porte déjà ce nom/);
  await sheet(page).locator('input[name="name"]').fill('Vacances été');
  await sheet(page).locator('input[name="goalAmount"]').fill('2000');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  assert.equal(await page.locator('[data-screen="envelope"] .topbar h1').innerText(), 'Vacances été');
  assert.match(await page.locator('[data-screen="envelope"] .env-hero').innerText(), /2\s?000,00/);

  await page.locator('[data-action="env-move"]').click();
  await sheet(page).locator('select[name="to"]').selectOption(gifts.id);
  await sheet(page).locator('input[name="amount"]').fill('100');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  assert.equal(await valueOf(page, 'envelope-balance'), start - 10000);
  const state = await readState(page);
  const move = state.operations.find((o) => o.kind === 'transfer' && o.from === vac.id && o.to === gifts.id);
  assert.equal(move.amount, 10000);

  await page.locator('[data-screen="envelope"] .seg button[data-value="report"]').click();
  const report = await page.locator('[data-screen="envelope"] .tiles').innerText();
  assert.match(report, /Reçu/);
  assert.match(report, /Rendu ou viré ailleurs/);
  await done(ctx);
});

test("archives : le relevé importé s'y retrouve avec son fichier ; le retirer « dé-pointe » les opérations sans les supprimer", async () => {
  const ctx = await openApp({ now: '2026-08-10T10:30:00' });
  const { page } = ctx;
  await page.evaluate(() => window.monBudget.open('statement'));
  await chooseFile(page, () => page.locator('[data-action="choose-file"]').click(), join(ROOT, 'www', 'exemples', 'releve-exemple.pdf'));
  await page.waitForSelector('[data-value="line-count"]');
  await page.locator('[data-screen="statement"] [data-action="next"]').click();
  await page.locator('[data-screen="statement"] [data-action="next"]').click();
  await page.locator('[data-action="commit"]').click();
  await page.waitForSelector('[data-state="done"]');
  await settled(page);
  await page.locator('[data-action="finish"]').click();
  let state = await readState(page);
  const statement = state.statements[0];
  const count = state.operations.length;

  await page.evaluate(() => window.monBudget.open('archives'));
  const row = page.locator(`[data-statement="${statement.id}"]`);
  assert.match(await row.innerText(), /08-07-2026 au 07-08-2026/);
  assert.match(await row.innerText(), /22 lignes/);
  // le fichier d'origine se récupère tel quel
  const file = await download(page, async () => {
    await row.click();
    await answer(page, 'file');
  });
  assert.equal(file.name, 'releve-2026-08-07.pdf');
  assert.equal(String.fromCharCode(...file.bytes.slice(0, 5)), '%PDF-');
  await dialogGone(page);

  await row.click();
  await answer(page, 'delete');
  await page.waitForSelector('.dialog h2:has-text("Retirer ce relevé")');
  await answer(page, true);
  await noOverlay(page);
  state = await readState(page);
  assert.equal(state.statements.length, 0);
  assert.equal(state.operations.length, count, 'aucune opération supprimée');
  assert.ok(state.operations.every((o) => !o.bank), 'plus aucune opération pointée');
  assert.equal(state.files.length, 0);
  assert.equal(state.reconciliations.length, 1, 'le constat de solde reste dans l\'historique');
  assert.equal(state.reconciliations[0].statementId, null);
  await done(ctx);
});

test("règles automatiques : ce que l'appli a retenu se retrouve, se corrige, se supprime, et sert à la saisie suivante", async () => {
  const ctx = await openApp();
  const { page } = ctx;
  // une première dépense rangée à la main
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await sheet(page).locator('input[name="amount"]').fill('42');
  await sheet(page).locator('input[name="label"]').fill('Plein');
  await sheet(page).locator('input[name="counterparty"]').fill('Station du Rond-Point');
  await sheet(page).locator('.pick', { hasText: 'Nécessité' }).click();
  await sheet(page).locator('[data-action="new-tag"]').click();
  await page.locator('.dialog input').fill('Transport');
  await answer(page, 'ok');
  await dialogGone(page);
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  let state = await readState(page);
  assert.equal(state.rules.length, 1);
  assert.deepEqual([state.rules[0].key, state.rules[0].label, state.rules[0].importance], ['station du rond point', 'Plein', 'necessite']);

  // à la saisie suivante pour ce tiers, l'appli propose le même rangement
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await sheet(page).locator('input[name="amount"]').fill('38,50');
  await sheet(page).locator('input[name="counterparty"]').fill('station du rond-point');
  await sheet(page).locator('[data-action="apply-habit"]').click();
  assert.equal(await sheet(page).locator('input[name="label"]').inputValue(), 'Plein');
  assert.equal(await sheet(page).locator('.pick[aria-pressed="true"]', { hasText: 'Transport' }).count(), 1);
  assert.equal(await sheet(page).locator('.pick[aria-pressed="true"]', { hasText: 'Nécessité' }).count(), 1);
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  state = await readState(page);
  assert.equal(state.operations.length, 2);
  assert.deepEqual(state.operations.map((o) => o.tags.length), [1, 1]);
  assert.equal(state.rules[0].uses, 2);

  // la règle est visible et supprimable dans Plus › Règles automatiques
  await page.evaluate(() => window.monBudget.open('rules'));
  assert.match(await page.locator(`[data-rule="${state.rules[0].id}"]`).innerText(), /Station du Rond-Point/);
  await page.locator(`[data-rule="${state.rules[0].id}"]`).click();
  await sheet(page).locator('[data-action="delete"]').click();
  await noOverlay(page);
  await page.waitForFunction(() => window.monBudget.state.rules.length === 0);
  await done(ctx);
});

test("données d'exemple : chargées depuis l'accueil, cohérentes, puis effacées pour repartir de zéro", async () => {
  const ctx = await openApp({ onboarding: true });
  const { page } = ctx;
  await page.locator('.sheet [data-action="start-demo"]').click();
  await page.waitForFunction(() => window.monBudget.state.operations.length > 50 && !window.monBudget.busy);
  await noOverlay(page);
  const state = await readState(page);
  const b = await balancesOf(page);
  assert.ok(b.available > 0 && b.total > b.available);
  // les soldes affichés correspondent à la somme des opérations réelles jusqu'à aujourd'hui
  const real = state.operations.filter((o) => !o.simulated && o.date <= '2026-11-15');
  const total = real.filter((o) => o.kind !== 'transfer').reduce((s, o) => s + o.amount, 0);
  assert.equal(b.total, total);
  assert.equal(await page.locator('[data-action="leave-demo"]').count(), 1);
  await page.locator('[data-action="leave-demo"]').click();
  await answer(page, true);
  await page.waitForSelector('.sheet [data-action="start-balance"]');
  assert.equal((await readState(page)).operations.length, 0);
  assert.equal(await page.evaluate(() => window.monBudget.setting('demo', null)), null);
  await done(ctx);
});
