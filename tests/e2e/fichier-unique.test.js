// Le fichier unique (dist/mon-budget.html) : ouvert directement depuis le disque, sans serveur,
// il doit démarrer, lire un PDF avec le lecteur embarqué et garder ses données.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from './harness.js';

test("fichier unique : s'ouvre d'un double-clic, importe le relevé d'exemple (PDF), conserve les données", async () => {
  execFileSync(process.execPath, [join(ROOT, 'tools', 'build-single.mjs')], { stdio: 'pipe' });
  const file = join(ROOT, 'dist', 'mon-budget.html');
  assert.ok(existsSync(file));
  assert.ok(statSync(file).size > 500_000, 'le fichier contient bien toute l\'appli');

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
    // aucun fichier annexe ne doit être demandé : tout est dans la page
    page.on('request', (r) => {
      if (!r.url().startsWith('file:///') || !r.url().endsWith('mon-budget.html')) {
        if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`requête inattendue : ${r.url().slice(0, 90)}`);
      }
    });
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector('html[data-ready]');
    assert.equal(await page.evaluate(() => window.monBudget.store.db.kind), 'indexeddb', 'les données sont enregistrées durablement');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.fonts.check('500 16px Inter')), true, 'la police embarquée est chargée');

    await page.locator('.sheet [data-action="start-statement"]').click();
    await page.locator('[data-action="example"]').click();
    await page.waitForSelector('[data-value="line-count"]', { timeout: 30000 });
    assert.equal(await page.locator('[data-value="line-count"]').innerText(), '22');
    assert.equal(await page.locator('[data-check="ok"]').count(), 1);
    await page.locator('[data-screen="statement"] [data-action="next"]').click();
    await page.locator('[data-screen="statement"] [data-action="next"]').click();
    await page.locator('[data-action="commit"]').click();
    await page.waitForSelector('[data-state="done"]');
    await page.waitForFunction(() => !window.monBudget.busy);
    assert.equal(await page.evaluate(() => window.monBudget.state.operations.length), 23);

    await page.reload();
    await page.waitForSelector('html[data-ready]');
    assert.equal(await page.evaluate(() => window.monBudget.state.operations.length), 23, 'les données sont toujours là après fermeture');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});
