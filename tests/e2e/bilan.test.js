// Écran « Bilan » (ancien « Stats ») : le tableau de bord du jour en haut, les statistiques dessous.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, openTab, noOverlay, settled, valueOf, cents, shot } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

test('bilan : compte courant identique à l’écran Opérations, fin du mois estimée, 7 prochains jours, quotas, puis statistiques', async () => {
  const ctx = await openApp({ demo: true, width: 360, height: 746 });
  const { page } = ctx;
  const available = await valueOf(page, 'available');
  await openTab(page, 'stats');
  const screen = page.locator('[data-screen="stats"]');
  assert.equal(await screen.locator('.topbar h1').innerText(), 'Bilan');
  assert.equal(await page.locator('.tabbar button[data-tab="stats"]').innerText(), 'Bilan');
  assert.equal(cents(await screen.locator('[data-card="outlook"] [data-value="today"]').innerText()), available);
  // la fin du mois : le compte courant + ce qui est prévu (coché) ou déjà daté d'ici la fin du mois
  const expected = await page.evaluate(async () => {
    const { monthOutlook } = await import('./js/core/dashboard.js');
    return monthOutlook(window.monBudget.state, window.monBudget.today()).end;
  });
  assert.equal(cents(await screen.locator('[data-card="outlook"] [data-value="month-end"]').innerText()), expected);
  const cards = await screen.locator('[data-card]').evaluateAll((els) => els.map((el) => el.dataset.card));
  assert.deepEqual(cards.slice(0, 3), ['outlook', 'upcoming', 'quotas'], 'le jour d’abord, les statistiques ensuite');
  assert.ok((await screen.locator('[data-card="upcoming"] .op-row').count()) >= 1);
  assert.equal(await screen.locator('.stats-title').innerText(), 'Statistiques');
  assert.deepEqual(await screen.locator('[data-tile] .label').allInnerTexts(), ['Sorties', 'Entrées', 'Entrées moins sorties']);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 360, `rien ne déborde sur un écran de 360 px (${width})`);
  await shot(page, 'bilan-360');

  // toucher une échéance l'ouvre ; « Voir toutes les prévisions » mène à l'onglet Prévisions
  await screen.locator('[data-card="upcoming"] .op-row').first().click();
  await page.locator('.sheet input[name="amount"]').waitFor();
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);
  await screen.locator('[data-action="see-forecast"]').click();
  await page.waitForSelector('[data-screen="forecast"]:not([hidden])');
  await done(ctx);
});

test('bilan : une alerte annonce le découvert à venir et mène aux prévisions ; rien à regarder quand tout va bien', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  await openTab(page, 'stats');
  assert.equal(await page.locator('[data-card="alerts"]').count(), 0, 'données d’exemple : rien d’alarmant');

  // une grosse prévision dans 3 jours fait passer le compte courant sous zéro
  await page.evaluate(async () => {
    const { planSaveOperation } = await import('./js/core/operations.js');
    const { addDays } = await import('./js/core/dates.js');
    const today = window.monBudget.today();
    const plan = planSaveOperation(window.monBudget.state, { amount: -900000, date: addDays(today, 3), label: 'Travaux', simulated: true, checked: true }, { today });
    await window.monBudget.run(plan, { label: 'Prévision ajoutée' });
  });
  await settled(page);
  const alert = page.locator('[data-card="alerts"] [data-alert="overdraft-soon"]');
  await alert.waitFor();
  assert.equal(await alert.getAttribute('data-level'), 'bad');
  assert.match((await alert.innerText()).replace(/\s/g, ' '), /D'après tes prévisions, ton compte courant passera à −[\d ]+,\d\d € le \d\d-\d\d-\d{4}\./);
  assert.ok((await page.locator('[data-card="outlook"] [data-value="month-end"]').getAttribute('class')).includes('alert'));
  await shot(page, 'bilan-alerte');
  await alert.locator('button').click();
  await page.waitForSelector('[data-screen="forecast"]:not([hidden])');
  await done(ctx);
});

test('bilan : en thème sombre, et sans aucune opération (rien que l’invitation à commencer)', async () => {
  const dark = await openApp({ demo: true, dark: true });
  await openTab(dark.page, 'stats');
  await dark.page.locator('[data-card="outlook"]').waitFor();
  await shot(dark.page, 'bilan-sombre');
  await done(dark);

  const empty = await openApp();
  await openTab(empty.page, 'stats');
  const screen = empty.page.locator('[data-screen="stats"]');
  await screen.locator('.empty').waitFor();
  assert.equal(await screen.locator('[data-card="outlook"]').count(), 0);
  assert.equal(await screen.locator('.stats-title').isHidden(), true);
  await done(empty);
});
