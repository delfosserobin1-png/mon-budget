// Appli installable (PWA), dans un vrai navigateur : critères d'installation, fonctionnement sans
// connexion, mise à jour, version abîmée refusée, bouton « Installer », « Quoi de neuf ».
//
// L'appli est servie comme elle le sera une fois publiée : dans un sous-dossier (« /mon-budget/ »),
// à partir d'une copie du dossier www/ qu'on peut modifier pour simuler une nouvelle version.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAll, stopAll, openApp, addOperation, openTab, answer, noOverlay, settled, readState, shot, ROOT, VERSION } from './harness.js';
import { startServer } from '../../tools/serve.mjs';
import { computeServiceWorker, updateServiceWorker } from '../../tools/pwa.mjs';

before(startAll);
after(stopAll);

const sites = [];
after(async () => {
  for (const site of sites) await site.close();
});

/** « Publie » une copie de l'appli sur un petit serveur, dans le sous-dossier /mon-budget/. */
async function publish() {
  const root = mkdtempSync(join(tmpdir(), 'mon-budget-site-'));
  cpSync(join(ROOT, 'package.json'), join(root, 'package.json'));
  cpSync(join(ROOT, 'www'), join(root, 'www'), { recursive: true });
  const server = await startServer({ port: 0, root: join(root, 'www'), prefix: '/mon-budget/' });
  const site = { root, www: join(root, 'www'), url: server.url, close: server.close };
  sites.push(site);
  return site;
}

/** Prépare une nouvelle version dans la copie publiée : numéro, annonce, liste des fichiers. */
function release(site, version, note) {
  const edit = (path, from, to) => {
    const file = join(site.root, path);
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes(from), `repère trouvé dans ${path}`);
    writeFileSync(file, text.replace(from, () => to));
  };
  edit('package.json', `"version": "${VERSION}"`, `"version": "${version}"`);
  edit('www/js/ui/app.js', `export const APP_VERSION = '${VERSION}';`, `export const APP_VERSION = '${version}';`);
  edit('www/js/changelog.js', 'export const CHANGES = [', `export const CHANGES = [\n  { version: '${version}', date: '2026-11-20', title: 'Version de test', items: [${JSON.stringify(note)}] },`);
  return updateServiceWorker({ root: site.root });
}

/** Attend que l'appli soit entièrement en réserve et prise en charge par son service worker. */
async function offlineReady(page) {
  await page.waitForFunction(() => window.monBudget.pwa.state().offlineReady && !!navigator.serviceWorker.controller, null, { timeout: 60000 });
}

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

test('installation : le navigateur juge l’appli installable, depuis un sous-dossier, sans adresse absolue', async () => {
  const site = await publish();
  const ctx = await openApp({ pwa: true, url: site.url });
  const { page } = ctx;
  await offlineReady(page);
  const cdp = await ctx.context.newCDPSession(page);

  // Les contextes de test sont « privés », ce que Chrome signale ; tout autre reproche est une vraie faute.
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito'), [], 'critères d’installation de Chrome');
  const manifest = await cdp.send('Page.getAppManifest');
  assert.equal(manifest.url, `${site.url}manifest.webmanifest`);
  assert.deepEqual(manifest.errors, [], 'manifeste lu sans erreur');
  const declared = JSON.parse(manifest.data);
  assert.equal(new URL(declared.start_url, manifest.url).href, site.url, "l'appli démarre dans son sous-dossier");
  assert.equal(new URL(declared.scope, manifest.url).href, site.url);

  // tout est en réserve, sous la bonne adresse, et rien d'autre
  const expected = computeServiceWorker({ root: site.root });
  const reserve = await page.evaluate(() => window.monBudget.pwa.reserve());
  assert.deepEqual(reserve, { version: VERSION, build: expected.build, files: expected.files.length });
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const keys = await (await caches.open(names[0])).keys();
    return { names, urls: keys.map((request) => request.url) };
  });
  assert.deepEqual(cached.names, [`mon-budget-${expected.build}`]);
  assert.deepEqual(cached.urls.sort(), expected.files.map(([path]) => site.url + path).sort());
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL), `${site.url}sw.js`);

  // l'écran À propos dit la même chose à l'utilisateur
  await page.evaluate(() => window.monBudget.open('about'));
  const card = page.locator('[data-screen="about"] [data-card="install"]');
  assert.match(await card.innerText(), /Sans connexion\s*Prêt/);
  assert.match(await card.innerText(), /Page du navigateur/);
  await page.locator('[data-action="self-test"]').click();
  await page.waitForFunction(() => /prêt \(version [\d.]+, \d+ fichiers en réserve\)/.test(document.querySelector('[data-card="self-test"]').innerText));
  assert.equal(await page.locator('[data-screen="about"] .chip.bad').count(), 0);
  await done(ctx);
});

test('sans connexion : l’appli installée démarre, garde ses données, lit un PDF et ouvre son raccourci', async () => {
  const site = await publish();
  const ctx = await openApp({ pwa: true, url: site.url });
  const { page } = ctx;
  await offlineReady(page);
  await addOperation(page, { mode: 'income', amount: '1200', label: 'Salaire' });

  await ctx.context.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  assert.deepEqual((await readState(page)).operations.map((o) => o.label), ['Salaire'], 'les données sont toujours là');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('500 16px Inter')), true, 'la police vient de la réserve');

  // le lecteur de PDF (gros fichier chargé à la demande) et le relevé d'exemple viennent aussi de la réserve
  await page.evaluate(() => window.monBudget.open('statement'));
  await page.locator('[data-action="example"]').click();
  await page.waitForSelector('[data-value="line-count"]', { timeout: 30000 });
  assert.equal(await page.locator('[data-value="line-count"]').innerText(), '22');

  // tous les écrans s'ouvrent sans réseau
  for (const name of ['backup', 'about', 'guide', 'bugs', 'claude']) {
    await page.evaluate((n) => window.monBudget.open(n), name);
    await page.waitForSelector(`[data-screen="${name}"]`);
  }
  await page.evaluate(() => window.monBudget.go('operations'));
  for (const tab of ['envelopes', 'forecast', 'stats', 'more', 'operations']) await openTab(page, tab);

  // raccourci de l'icône (« Nouvelle opération ») : l'adresse avec son paramètre est servie hors connexion
  await page.goto(`${site.url}?action=ajouter`);
  await page.waitForSelector('html[data-ready="true"]');
  await page.waitForSelector('.sheet input[name="amount"]');
  assert.equal(await page.evaluate(() => location.search), '', "le paramètre est retiré de l'adresse");
  await page.locator('.sheet input[name="amount"]').fill('4,50');
  await page.locator('.sheet input[name="label"]').fill('Café');
  await page.locator('.sheet [data-action="save"]').click();
  await noOverlay(page);
  assert.equal((await readState(page)).operations.length, 2, 'la saisie fonctionne sans connexion');
  await done(ctx);
});

test('mise à jour : annoncée par un bandeau, appliquée d’un geste, données intactes, « quoi de neuf » affiché', async () => {
  const site = await publish();
  const ctx = await openApp({ pwa: true, url: site.url });
  const { page } = ctx;
  await offlineReady(page);
  await addOperation(page, { mode: 'income', amount: '1200', label: 'Salaire' });
  assert.equal(await page.locator('.update-bar').isHidden(), true);

  // une nouvelle version est publiée pendant que l'appli est ouverte
  const next = release(site, '2.9.9', 'Une nouveauté de test.');
  assert.equal(next.changed, true);
  assert.equal(await page.evaluate(() => window.monBudget.pwa.check()), 'checked');
  await page.waitForSelector('.update-bar [data-action="apply-update"]', { timeout: 60000 });
  assert.match(await page.locator('.update-bar').innerText(), /nouvelle version est prête/);
  // tant qu'on ne touche pas le bouton, rien ne change sous les doigts de l'utilisateur
  assert.equal(await page.evaluate(() => window.monBudget.version), VERSION);
  await addOperation(page, { amount: '12,30', label: 'Boulangerie' });
  await shot(page, 'pwa-bandeau-mise-a-jour');
  await page.evaluate(() => window.monBudget.open('about'));
  assert.match(await page.locator('[data-card="install"]').innerText(), /Nouvelle version prête/);
  await shot(page, 'pwa-a-propos-installation');
  await page.evaluate(() => window.monBudget.back());

  const reloaded = page.waitForEvent('load');
  await page.locator('.update-bar [data-action="apply-update"]').click();
  await reloaded;
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.evaluate(() => window.monBudget.version), '2.9.9');

  // l'appli annonce ce qui a changé, une seule fois
  await page.waitForSelector('.dialog .whats-new');
  const news = page.locator('.dialog .whats-new');
  assert.equal(await news.locator('[data-version]').count(), 1, 'seulement la version nouvelle');
  assert.match(await news.innerText(), /Version 2\.9\.9 : Version de test\s+Une nouveauté de test\./);
  await shot(page, 'pwa-quoi-de-neuf');
  await answer(page, true);
  await noOverlay(page);

  assert.deepEqual((await readState(page)).operations.map((o) => o.label).sort(), ['Boulangerie', 'Salaire'], 'aucune donnée perdue');
  assert.equal(await page.locator('.update-bar').isHidden(), true);
  const reserve = await page.evaluate(() => window.monBudget.pwa.reserve());
  assert.deepEqual([reserve.version, reserve.build], ['2.9.9', next.build]);
  await page.waitForFunction(async () => (await caches.keys()).length === 1);
  assert.deepEqual(await page.evaluate(() => caches.keys()), [`mon-budget-${next.build}`], "la réserve de l'ancienne version est effacée");

  const again = await openApp({ context: ctx.context, url: site.url });
  assert.equal(await again.page.locator('.dialog').count(), 0, "« Quoi de neuf » ne revient pas à l'ouverture suivante");
  assert.equal(await again.page.evaluate(() => window.monBudget.version), '2.9.9');
  assert.deepEqual(again.problems, []);
  await done(ctx);
});

test('une version abîmée en route n’est jamais installée : l’ancienne continue, même sans connexion', async () => {
  const site = await publish();
  const ctx = await openApp({ pwa: true, url: site.url });
  const { page } = ctx;
  await offlineReady(page);
  const before = await page.evaluate(() => window.monBudget.pwa.reserve());

  // la nouvelle version annonce un fichier… qui n'est pas celui que le site renvoie
  release(site, '2.9.9', 'Version abîmée.');
  const css = join(site.www, 'css', 'app.css');
  writeFileSync(css, `${readFileSync(css, 'utf8')}\n/* modifié après la publication */\n`);
  await page.evaluate(() => window.monBudget.pwa.check());
  await page.waitForFunction(() => /css\/app\.css : contenu différent/.test(window.monBudget.pwa.state().error), null, { timeout: 60000 });

  const state = await page.evaluate(() => window.monBudget.pwa.state());
  assert.deepEqual([state.updateReady, state.offlineReady], [false, true]);
  assert.equal(await page.locator('.update-bar').isHidden(), true, 'aucune mise à jour proposée');
  assert.deepEqual(await page.evaluate(() => window.monBudget.pwa.reserve()), before, "la réserve en place n'a pas bougé");
  assert.deepEqual(await page.evaluate(() => caches.keys()), [`mon-budget-${before.build}`], 'la réserve incomplète a été effacée');

  await ctx.context.setOffline(true);
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]');
  assert.equal(await page.evaluate(() => window.monBudget.version), VERSION);
  await done(ctx);
});

test('bouton « Installer » : proposé dans le navigateur, explications si le téléphone ne le propose pas, absent une fois installée', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await openTab(page, 'more');
  const notice = page.locator('[data-screen="more"] [data-notice="install"]');
  assert.equal(await notice.count(), 1);

  // le navigateur n'a rien proposé : le bouton explique la marche à suivre
  assert.equal(await notice.locator('[data-action="install"]').innerText(), 'Comment faire');
  await notice.locator('[data-action="install"]').click();
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog').innerText(), /Ajouter à l'écran d'accueil/);
  await answer(page, true);
  await noOverlay(page);

  // le navigateur propose l'installation : un toucher l'ouvre
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    window.__prompts = 0;
    event.prompt = async () => {
      window.__prompts++;
    };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
    window.__prevented = event.defaultPrevented;
  });
  assert.equal(await page.evaluate(() => window.__prevented), true, 'pas de bandeau automatique du navigateur');
  await page.waitForFunction(() => document.querySelector('[data-notice="install"] [data-action="install"]').textContent === 'Installer');
  await notice.locator('[data-action="install"]').click();
  await page.waitForFunction(() => window.__prompts === 1);
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').innerText(), /Installation lancée/);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.waitForFunction(() => !document.querySelector('[data-notice="install"]'));

  // Ouverte depuis son icône (plein écran) : plus rien à installer, et l'appli le sait. Le navigateur
  // des tests ne sait pas se mettre dans ce mode : on lui fait répondre « plein écran » à la question
  // que pose l'appli.
  const fresh = await openApp({
    init: () => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query) => (/display-mode:\s*standalone/.test(query) ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : real(query));
    },
  });
  assert.equal(await fresh.page.evaluate(() => window.monBudget.pwa.state().installed), true);
  await openTab(fresh.page, 'more');
  assert.equal(await fresh.page.locator('[data-notice="install"]').count(), 0);
  await fresh.page.evaluate(() => window.monBudget.open('about'));
  assert.match(await fresh.page.locator('[data-card="install"]').innerText(), /Appli installée/);
  assert.equal(await fresh.page.locator('[data-card="install"] [data-action="install"]').count(), 0);
  assert.match(await fresh.page.locator('[data-screen="about"]').innerText(), /Appareil\s*Appli installée/);
  await done(fresh);
  await done(ctx);
});

test('« quoi de neuf » pour qui avait la version précédente ; rien pour une première installation', async () => {
  const ctx = await openApp({ onboarding: true });
  const { page } = ctx;
  // première installation : l'accueil, pas d'annonce
  assert.equal(await page.locator('.dialog').count(), 0);
  assert.equal(await page.locator('.sheet [data-action="start-later"]').count(), 1);
  await page.locator('.sheet [data-action="start-later"]').click();
  await noOverlay(page);
  await page.waitForFunction((v) => window.monBudget.setting('seenVersion') === v, VERSION);

  // l'appli avait été utilisée dans la version précédente
  await page.evaluate(() => window.monBudget.setSetting('seenVersion', '2.0.0'));
  await settled(page);
  const upgraded = await openApp({ context: ctx.context, onboarding: true });
  await upgraded.page.waitForSelector('.dialog .whats-new');
  assert.match(await upgraded.page.locator('.dialog').innerText(), new RegExp(`Version ${VERSION.replace(/\./g, '\\.')}`));
  assert.equal(await upgraded.page.locator('.dialog [data-version="2.0.0"]').count(), 0, "pas l'annonce d'une version déjà connue");
  await answer(upgraded.page, true);
  await noOverlay(upgraded.page);
  const third = await openApp({ context: ctx.context, onboarding: true });
  assert.equal(await third.page.locator('.dialog').count(), 0);

  // la liste reste consultable dans À propos
  await third.page.evaluate(() => window.monBudget.open('about'));
  await third.page.locator('[data-action="whats-new"]').click();
  await third.page.waitForSelector('.dialog .whats-new');
  assert.ok((await third.page.locator('.dialog [data-version]').count()) >= 1);
  await answer(third.page, true);
  assert.deepEqual([...upgraded.problems, ...third.problems], []);
  await done(ctx);
});

test('raccourci « Nouvelle opération » : ouvre la saisie, sauf par-dessus l’accueil du premier lancement', async () => {
  const ctx = await openApp({ onboarding: true });
  const first = ctx.page;
  const url = first.url();
  // premier lancement avec le raccourci : l'accueil reste seul à l'écran
  const cold = await openApp({ context: ctx.context, url: `${url}?action=ajouter`, onboarding: true });
  await cold.page.waitForSelector('.sheet [data-action="start-later"]');
  assert.equal(await cold.page.locator('.sheet').count(), 1);
  await cold.page.locator('.sheet [data-action="start-later"]').click();
  await noOverlay(cold.page);
  await cold.page.waitForFunction(() => window.monBudget.setting('onboarded') === true);
  // ensuite : la saisie s'ouvre directement
  const warm = await openApp({ context: ctx.context, url: `${url}?action=ajouter`, onboarding: true });
  await warm.page.waitForSelector('.sheet input[name="amount"]');
  assert.equal(await warm.page.evaluate(() => location.search), '');
  assert.deepEqual([...cold.problems, ...warm.problems], []);
  await done(ctx);
});
