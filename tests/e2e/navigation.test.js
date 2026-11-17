// Navigation et robustesse de l'affichage : bouton retour, thèmes, petits écrans, tous les écrans
// parcourus sans la moindre erreur, graphiques cliquables.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, openTab, answer, noOverlay, settled, readState, shot } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

const TABS = ['operations', 'envelopes', 'forecast', 'stats', 'more'];
const SUBS = ['statement', 'reconcile', 'archives', 'backup', 'tags', 'rules', 'security', 'about', 'guide', 'bugs', 'claude'];

/** Rien ne doit dépasser en largeur : ni la page, ni la zone de défilement de l'écran affiché. */
async function assertNoOverflow(page, where) {
  const report = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`page (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    for (const el of document.querySelectorAll('.screen:not([hidden]) .scroll, .sheet-body')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className} (${el.scrollWidth} > ${el.clientWidth})`);
    }
    // aucun élément visible ne doit sortir de l'écran par la droite
    const frame = document.querySelector('.frame').getBoundingClientRect();
    for (const el of document.querySelectorAll('.screen:not([hidden]) *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > frame.right + 1 && !el.closest('.filter-line, .table-wrap, .chips-scroll, svg')) {
        out.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(' ')[0]} dépasse de ${Math.round(r.right - frame.right)} px`);
        break;
      }
    }
    return out;
  });
  assert.deepEqual(report, [], `débordement horizontal : ${where}`);
}

async function tour(page, label, { capture = false } = {}) {
  for (const tab of TABS) {
    await openTab(page, tab);
    await page.waitForTimeout(60);
    await assertNoOverflow(page, `${label} / ${tab}`);
    if (capture) await shot(page, `${label}-${tab}`);
  }
  for (const name of SUBS) {
    await page.evaluate((n) => window.monBudget.open(n), name);
    await page.waitForSelector(`[data-screen="${name}"]`);
    await page.waitForTimeout(60);
    await assertNoOverflow(page, `${label} / ${name}`);
    if (capture) await shot(page, `${label}-${name}`);
    await page.evaluate(() => window.monBudget.back());
    await page.waitForFunction((n) => !document.querySelector(`[data-screen="${n}"]`), name);
  }
  // fiche d'une enveloppe et ses trois vues
  await openTab(page, 'envelopes');
  await page.locator('.env-card').first().click();
  await page.waitForSelector('[data-screen="envelope"]');
  for (const view of ['operations', 'upcoming', 'report']) {
    await page.locator(`[data-screen="envelope"] .seg button[data-value="${view}"]`).click();
    await assertNoOverflow(page, `${label} / enveloppe ${view}`);
    if (capture) await shot(page, `${label}-enveloppe-${view}`);
  }
  await page.evaluate(() => window.monBudget.back());
  // prévisions : vue Récurrences
  await openTab(page, 'forecast');
  await page.locator('[data-screen="forecast"] .seg button[data-value="recurring"]').click();
  await assertNoOverflow(page, `${label} / récurrences`);
  if (capture) await shot(page, `${label}-recurrences`);
  await page.locator('[data-screen="forecast"] .seg button[data-value="simulation"]').click();
  // formulaires
  await openTab(page, 'operations');
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await page.waitForSelector('.sheet');
  await assertNoOverflow(page, `${label} / formulaire`);
  if (capture) await shot(page, `${label}-formulaire`);
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);
  await page.locator('[data-action="filters"]').click();
  await page.waitForSelector('.sheet');
  await assertNoOverflow(page, `${label} / filtres`);
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);
}

test('tous les écrans, thème clair, téléphone standard (412 × 915) : aucune erreur, rien ne déborde', async () => {
  const ctx = await openApp({ demo: true });
  await tour(ctx.page, 'clair', { capture: true });
  await done(ctx);
});

test('tous les écrans, thème sombre : aucune erreur, rien ne déborde', async () => {
  const ctx = await openApp({ demo: true, dark: true });
  const scheme = await ctx.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
  assert.notEqual(scheme, '#f6f7fb', 'le thème sombre est bien appliqué');
  await tour(ctx.page, 'sombre', { capture: true });
  await done(ctx);
});

test('tous les écrans, petit téléphone (320 × 568) et grand texte : aucune erreur, rien ne déborde', async () => {
  const ctx = await openApp({ demo: true, width: 320, height: 568 });
  await tour(ctx.page, 'petit');
  await done(ctx);
});

test('tablette ou navigateur large (1024 × 768) : la mise en page reste celle d’un téléphone, centrée', async () => {
  const ctx = await openApp({ demo: true, width: 1024, height: 768 });
  const { page } = ctx;
  const frame = await page.evaluate(() => {
    const r = document.querySelector('.frame').getBoundingClientRect();
    return { width: r.width, left: r.left, right: window.innerWidth - r.right };
  });
  assert.ok(frame.width <= 560);
  assert.ok(Math.abs(frame.left - frame.right) <= 1, 'centrée');
  await tour(page, 'large');
  await done(ctx);
});

test('bouton retour du navigateur : ferme la feuille, puis le sous-écran, revient au premier onglet, puis prévient avant de quitter', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const back = async () => {
    await page.evaluate(() => history.back());
    await page.waitForTimeout(80);
  };
  await openTab(page, 'more');
  await page.locator('[data-open="tags"]').click();
  await page.locator('[data-action="add-tag"]').click();
  await page.waitForSelector('.sheet');
  await back();
  await noOverlay(page);
  assert.equal(await page.evaluate(() => window.monBudget.currentScreenName()), 'tags');
  await back();
  assert.equal(await page.evaluate(() => window.monBudget.currentScreenName()), 'more');
  await back();
  assert.equal(await page.evaluate(() => window.monBudget.currentScreenName()), 'operations');
  // mode sélection : retour en sort, sans quitter l'écran
  await page.locator('[data-action="select"]').click();
  await back();
  assert.equal(await page.locator('.select-bar').isHidden(), true);
  await back();
  assert.match(await page.locator('.toast').innerText(), /encore une fois/);
  assert.equal(await page.evaluate(() => !!window.monBudget), true, "l'appli est toujours là");
  await done(ctx);
});

test('une modification de formulaire non enregistrée demande confirmation avant de fermer', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const before = await readState(page);
  await page.locator('[data-screen="operations"] .op-row').first().click();
  await page.locator('.sheet input[name="label"]').fill('Modifié par erreur');
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog h2').innerText(), /Quitter sans enregistrer/);
  await answer(page, false);
  assert.equal(await page.locator('.sheet').count(), 1, 'on reste dans le formulaire');
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await answer(page, true);
  await noOverlay(page);
  assert.deepEqual((await readState(page)).operations, before.operations);
  await done(ctx);
});

test("stats : périodes, graphiques ouvrables en tableau, clic sur une catégorie → opérations filtrées", async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  await openTab(page, 'stats');
  const stats = page.locator('[data-screen="stats"]');
  for (const period of ['lastMonth', '3months', '12months', 'year', 'all', 'month']) {
    await stats.locator(`[data-period="${period}"]`).click();
    await page.waitForTimeout(50);
    assert.ok((await stats.locator('.chart-card').count()) >= 4, `graphiques affichés pour ${period}`);
    assert.equal(await stats.locator('svg').evaluateAll((list) => list.filter((svg) => /NaN|undefined|Infinity/.test(svg.outerHTML)).length), 0, 'aucune valeur invalide dans les graphiques');
  }
  // chaque graphique a une version tableau (accessibilité, lecture exacte des chiffres)
  const toggles = stats.locator('[data-action="toggle-table"]');
  const n = await toggles.count();
  assert.ok(n >= 3);
  await toggles.first().click();
  assert.ok((await stats.locator('.table-wrap table tr').count()) > 2);
  await toggles.first().click();

  // clic sur le tag « Courses » → la liste des opérations, filtrée sur ce tag et cette période
  const state = await readState(page);
  const courses = state.tags.find((t) => t.name === 'Courses');
  await stats.locator('[data-bar="Courses"]').click();
  await page.waitForSelector('[data-screen="operations"]:not([hidden])');
  const chips = (await page.locator('.filter-line .chip').allInnerTexts()).map((c) => c.trim());
  assert.ok(chips.includes('Courses'));
  const expected = state.operations.filter((o) => !o.simulated && o.kind === 'operation' && o.amount < 0 && o.tags.includes(courses.id) && o.date >= '2026-11-01' && o.date <= '2026-11-15').length;
  assert.equal(await page.locator('[data-screen="operations"] .op-row').count(), expected);
  await done(ctx);
});

test("thème : choisi dans l'appli, appliqué tout de suite et retrouvé à la réouverture", async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await openTab(page, 'more');
  await page.locator('[data-screen="more"] .seg button[data-value="dark"]').click();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await settled(page);
  await page.waitForFunction(() => window.monBudget.setting('theme') === 'dark');
  const again = await openApp({ context: ctx.context });
  assert.equal(await again.page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  assert.deepEqual(again.problems, []);
  await done(ctx);
});

test("mode d'emploi et vérification de l'installation", async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await page.evaluate(() => window.monBudget.open('guide'));
  const guide = page.locator('[data-screen="guide"]');
  const sections = guide.locator('details, .guide section, [data-topic]');
  assert.ok((await guide.innerText()).length > 600, 'le mode d\'emploi a du contenu');
  assert.ok((await sections.count()) >= 6);
  await page.evaluate(() => window.monBudget.back());
  await page.evaluate(() => window.monBudget.open('about'));
  await page.locator('[data-action="self-test"]').click();
  const checks = '[data-screen="about"] [data-card="self-test"]';
  await page.waitForSelector(`${checks} .chip.good`);
  await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .kv .chip`).length >= 6, checks);
  assert.equal(await page.locator('[data-screen="about"] .chip.bad').count(), 0, 'toutes les vérifications passent dans le navigateur');
  assert.match(await page.locator(checks).innerText(), /Fonctionnement sans connexion/);
  await done(ctx);
});
