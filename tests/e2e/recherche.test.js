// Retrouver et manipuler ses opérations : recherche, filtres, sélection multiple, tags.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, openTab, sheet, answer, noOverlay, readState, balancesOf, cents } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

const rows = (page) => page.locator('[data-screen="operations"] .op-row');
const titles = async (page) => (await rows(page).locator('.title').allInnerTexts()).map((t) => t.trim());

test("recherche : par libellé, tiers, tag ou montant, sans tenir compte des accents", async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const total = await rows(page).count();
  assert.ok(total > 20);
  await page.locator('[data-action="search"]').click();
  const input = page.locator('[data-screen="operations"] input[type="search"]');
  await input.fill('epicerie');
  await page.waitForFunction((n) => document.querySelectorAll('[data-screen="operations"] .op-row').length < n, total);
  const found = await rows(page).count();
  assert.ok(found >= 1 && found < total);
  for (const meta of await rows(page).locator('.meta').allInnerTexts()) assert.match(meta, /Épicerie/);
  // le total affiché est bien celui des lignes trouvées
  const state = await readState(page);
  const expected = state.operations.filter((o) => !o.simulated && /épicerie/i.test(o.counterparty)).reduce((s, o) => s + o.amount, 0);
  assert.equal(cents((await page.locator('.result-line .amt').innerText()).trim()), expected);

  await input.fill('720');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="operations"] .op-row .title')].every((t) => t.textContent.includes('Loyer')));
  assert.ok((await rows(page).count()) >= 1);
  await input.fill('zzzz introuvable');
  await page.waitForSelector('[data-screen="operations"] .empty');
  assert.match(await page.locator('[data-screen="operations"] .empty h2').innerText(), /Aucun résultat/);
  // « retour » ferme la recherche et rend toute la liste
  await page.evaluate(() => window.monBudget.back());
  await page.waitForFunction((n) => document.querySelectorAll('[data-screen="operations"] .op-row').length >= Math.min(n, 60), total);
  await done(ctx);
});

test('filtres : type, tag, période ; le compteur et le résumé suivent ; tout effacer', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const state = await readState(page);
  const courses = state.tags.find((t) => t.name === 'Courses');
  await page.locator('[data-action="filters"]').click();
  await sheet(page).locator('.pick', { hasText: 'Ce mois' }).click();
  await sheet(page).locator('.pick', { hasText: 'Sorties' }).click();
  await sheet(page).locator(`.pick[data-value="${courses.id}"]`).click();
  await sheet(page).locator('[data-action="apply-filters"]').click();
  await noOverlay(page);
  const expected = state.operations.filter((o) => !o.simulated && o.kind === 'operation' && o.amount < 0 && o.tags.includes(courses.id) && o.date >= '2026-11-01' && o.date <= '2026-11-30');
  assert.equal(await rows(page).count(), expected.length);
  assert.equal(await page.locator('[data-action="filters"] .badge').innerText(), '3');
  const chips = await page.locator('.filter-line .chip').allInnerTexts();
  assert.deepEqual(chips.map((c) => c.trim()), ['Ce mois', 'Sorties', 'Courses']);
  assert.equal(cents((await page.locator('.result-line .amt').innerText()).trim()), expected.reduce((s, o) => s + o.amount, 0));
  await page.locator('[data-action="clear-filters"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-action="filters"] .badge'));
  assert.ok((await rows(page).count()) > expected.length);
  await done(ctx);
});

test('sélection multiple : supprimer plusieurs opérations, annuler, ajouter un tag', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const before = await readState(page);
  const beforeBalances = await balancesOf(page);
  await page.locator('[data-action="select"]').click();
  await rows(page).nth(0).click();
  await rows(page).nth(1).click();
  await rows(page).nth(2).click();
  assert.match(await page.locator('.select-bar .count').innerText(), /3 sélectionnées/);
  const picked = await page.locator('[data-screen="operations"] .op-row.selected').evaluateAll((els) => els.map((el) => el.dataset.op));
  await page.locator('[data-action="delete-selection"]').click();
  await answer(page, true);
  await noOverlay(page);
  let state = await readState(page);
  assert.equal(state.operations.length, before.operations.length - 3);
  for (const id of picked) assert.ok(!state.operations.some((o) => o.id === id));
  assert.equal(await page.locator('.select-bar').isHidden(), true, 'le mode sélection se referme');
  await page.locator('.undo-pill').click();
  await page.waitForFunction((n) => window.monBudget.state.operations.length === n, before.operations.length);
  assert.deepEqual(await balancesOf(page), beforeBalances);

  // un tag sur plusieurs opérations
  const tag = before.tags.find((t) => t.name === 'Loisirs');
  await page.locator('[data-action="select"]').click();
  await rows(page).nth(0).click();
  await rows(page).nth(1).click();
  const tagged = await page.locator('[data-screen="operations"] .op-row.selected').evaluateAll((els) => els.map((el) => el.dataset.op));
  await page.locator('[data-action="tag-selection"]').click();
  await answer(page, tag.id);
  await noOverlay(page);
  state = await readState(page);
  for (const id of tagged) {
    const op = state.operations.find((o) => o.id === id);
    if (op.kind !== 'transfer') assert.ok(op.tags.includes(tag.id));
  }
  await done(ctx);
});

test('sélection multiple : ranger des sorties dans une enveloppe d’un geste (commentaire n° 4), les entrées restent, puis annuler', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const before = await readState(page);
  const beforeBalances = await balancesOf(page);
  // deux petites sorties du compte courant et une entrée, toutes visibles dans la liste
  const shown = new Set(await rows(page).evaluateAll((els) => els.map((el) => el.dataset.op)));
  const real = before.operations.filter((o) => shown.has(o.id) && o.kind === 'operation' && !o.simulated && !o.envelopeId);
  const outs = real.filter((o) => o.amount < 0 && o.amount > -5000).slice(0, 2);
  const entry = real.find((o) => o.amount > 0);
  assert.equal(outs.length, 2);
  assert.ok(entry);
  // l'enveloppe la mieux garnie : pas de complément à prévoir
  const target = await page.evaluate(async () => {
    const { computeBalances } = await import('./js/core/balances.js');
    const b = computeBalances(window.monBudget.state, { upTo: window.monBudget.today() });
    return [...b.envelopes.entries()].filter(([id]) => !window.monBudget.state.envelopes.find((e) => e.id === id).closed).sort((x, y) => y[1] - x[1])[0][0];
  });

  await page.locator('[data-action="select"]').click();
  for (const o of [...outs, entry]) await page.locator(`[data-screen="operations"] .op-row[data-op="${o.id}"]`).click();
  assert.match(await page.locator('.select-bar .count').innerText(), /3 sélectionnées/);
  await page.locator('[data-action="envelope-selection"]').click();
  assert.match(await page.locator('.dialog').innerText(), /Seules les sorties sont rangées/);
  await answer(page, target);
  await noOverlay(page);
  const state = await readState(page);
  for (const o of outs) assert.equal(state.operations.find((x) => x.id === o.id).envelopeId, target);
  assert.equal(state.operations.find((x) => x.id === entry.id).envelopeId, null, 'l’entrée reste sur le compte courant');
  assert.match(await page.locator('.toast').innerText(), /2 sorties rangées dans « .+ » ; 1 entrée laissée sur le compte courant/);
  assert.equal(await page.locator('.select-bar').isHidden(), true, 'le mode sélection se referme');
  const moved = -(outs[0].amount + outs[1].amount);
  const after = await balancesOf(page);
  assert.equal(after.available, beforeBalances.available + moved, 'le compte courant récupère ces sorties');
  assert.equal(after.total, beforeBalances.total, 'le solde total ne bouge pas');

  await page.locator('.undo-pill').click();
  await page.waitForFunction((id) => !window.monBudget.state.operations.find((o) => o.id === id).envelopeId, outs[0].id);
  assert.deepEqual(await balancesOf(page), beforeBalances);
  await done(ctx);
});

test("tags : renommer, supprimer (les opérations le perdent, sans disparaître)", async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const before = await readState(page);
  const tag = before.tags.find((t) => t.name === 'Restaurant');
  const used = before.operations.filter((o) => o.tags.includes(tag.id)).length;
  assert.ok(used > 0);
  await openTab(page, 'more');
  await page.locator('[data-open="tags"]').click();
  await page.locator(`[data-screen="tags"] [data-tag="${tag.id}"]`).click();
  await sheet(page).locator('input[name="name"]').fill('Courses');
  await sheet(page).locator('[data-action="save"]').click();
  assert.match(await sheet(page).locator('.error:not([hidden])').innerText(), /existe déjà/);
  await sheet(page).locator('input[name="name"]').fill('Sorties');
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  assert.equal((await readState(page)).tags.find((t) => t.id === tag.id).name, 'Sorties');

  await page.locator(`[data-screen="tags"] [data-tag="${tag.id}"]`).locator('xpath=..').locator('[data-action="delete-tag"]').click();
  assert.match(await page.locator('.dialog').innerText(), new RegExp(String(used)));
  await answer(page, true);
  await noOverlay(page);
  const state = await readState(page);
  assert.ok(!state.tags.some((t) => t.id === tag.id));
  assert.equal(state.operations.length, before.operations.length);
  assert.ok(!state.operations.some((o) => o.tags.includes(tag.id)));
  assert.ok(!state.rules.some((r) => r.tags.includes(tag.id)));
  await done(ctx);
});
