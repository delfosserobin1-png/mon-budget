// Copie des fichiers dans un vrai dossier du téléphone (appli installée depuis le navigateur) :
// choix du dossier, sauvegarde automatique, exports, accès à réautoriser, arrêt de la copie.
//
// La fenêtre « choisir un dossier » du téléphone ne peut pas être pilotée par un test : elle est
// remplacée par un dossier du stockage privé du navigateur, qui s'utilise exactement de la même
// façon (mêmes méthodes), ce qui permet de relire réellement les fichiers écrits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, addOperation, openTab, answer, noOverlay, settled, shot, TODAY } from './harness.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

/** À exécuter dans la page avant l'appli : le faux sélecteur de dossier et la fausse autorisation. */
function fakePicker() {
  window.showDirectoryPicker = async () => {
    localStorage.setItem('test-picks', String(Number(localStorage.getItem('test-picks') || 0) + 1));
    if (localStorage.getItem('test-picker') === 'cancel') throw new DOMException('annulé', 'AbortError');
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(localStorage.getItem('test-folder') || 'Documents', { create: true });
  };
  // « test-permission = prompt » : le téléphone a retiré l'accès et le redemande à l'utilisateur
  const realQuery = FileSystemHandle.prototype.queryPermission;
  FileSystemHandle.prototype.queryPermission = function queryPermission(...args) {
    if (localStorage.getItem('test-permission') === 'prompt') return Promise.resolve('prompt');
    return realQuery ? realQuery.apply(this, args) : Promise.resolve('granted');
  };
  FileSystemHandle.prototype.requestPermission = function requestPermission() {
    localStorage.setItem('test-requests', String(Number(localStorage.getItem('test-requests') || 0) + 1));
    localStorage.removeItem('test-permission');
    return Promise.resolve('granted');
  };
}

/** Tous les fichiers du faux téléphone, sous forme de chemins triés. */
function tree(page) {
  return page.evaluate(async () => {
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`);
        else out.push(`${prefix}${name}`);
      }
    };
    await walk(await navigator.storage.getDirectory(), '');
    return out.sort();
  });
}

function readText(page, path) {
  return page.evaluate(async (wanted) => {
    let dir = await navigator.storage.getDirectory();
    const parts = wanted.split('/');
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
  }, path);
}

async function openBackup(page) {
  await page.evaluate(() => window.monBudget.open('backup'));
  await page.waitForSelector('[data-screen="backup"]');
}

const toastText = (page) => page.locator('.toast').innerText();
const AUTO = `Documents/MonBudget/Sauvegardes/mon-budget-auto-${TODAY}.json`;

test('dossier du téléphone : choisi une fois, il reçoit la sauvegarde du jour et les exports, et reste lié', async () => {
  const ctx = await openApp({ init: fakePicker });
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '1200', label: 'Salaire' });
  await openBackup(page);
  const where = page.locator('[data-screen="backup"] [data-card="where"]');
  assert.match(await where.innerText(), /stockage de ce navigateur/);
  assert.equal(await where.locator('[data-action="backup-now"]').count(), 0, 'pas de copie automatique tant qu’aucun dossier n’est choisi');
  assert.match(await page.evaluate(() => document.querySelector('[data-screen="backup"] [data-action="export-xlsx"]') && 'ok'), /ok/);

  // l'utilisateur renonce dans la fenêtre du téléphone : rien ne change, aucune erreur
  await page.evaluate(() => localStorage.setItem('test-picker', 'cancel'));
  await where.locator('[data-action="choose-folder"]').click();
  await settled(page);
  assert.equal(await page.evaluate(() => window.monBudget.folder.info().linked), false);
  assert.equal(await page.locator('.toast.bad').count(), 0);
  await page.evaluate(() => localStorage.removeItem('test-picker'));

  // il choisit « Documents » : l'appli y crée MonBudget et écrit tout de suite une première copie
  await where.locator('[data-action="choose-folder"]').click();
  await page.waitForFunction(() => window.monBudget.folder.info().ready === true);
  await page.waitForSelector('.toast');
  assert.equal(await toastText(page), `Dossier prêt. Première copie : ${AUTO}`);
  assert.deepEqual(await tree(page), [AUTO]);
  const first = JSON.parse(await readText(page, AUTO));
  assert.deepEqual([first.format, first.data.operations.length, first.data.operations[0].label], ['mon-budget', 1, 'Salaire']);
  const card = await where.innerText();
  assert.match(card, /Documents\/MonBudget\/Sauvegardes \(les 7 dernières sont gardées\)/);
  assert.match(card, /Dossier de copie\s*Documents\/MonBudget/);
  assert.match(card, /Sauvegarde automatique\s*15-11-2026/);
  await where.scrollIntoViewIfNeeded();
  await shot(page, 'dossier-lie');

  // « Sauvegarder maintenant » réécrit la copie du jour avec les dernières données
  await page.evaluate(() => window.monBudget.go('operations'));
  await addOperation(page, { amount: '12,30', label: 'Boulangerie' });
  await openBackup(page);
  await page.locator('[data-screen="backup"] [data-action="backup-now"]').click();
  await page.waitForFunction((text) => document.querySelector('.toast')?.textContent === text, `Sauvegardé dans ${AUTO}`);
  assert.equal(JSON.parse(await readText(page, AUTO)).data.operations.length, 2);

  // un export « Enregistrer » va dans le dossier (plus de téléchargement)
  await page.locator('[data-screen="backup"] [data-action="export-xlsx"]').click();
  assert.match(await page.locator('.dialog').innerText(), /Enregistrer dans Documents\/MonBudget/);
  await answer(page, 'save');
  await page.waitForFunction((text) => document.querySelector('.toast')?.textContent === text, `Enregistré dans Documents/MonBudget/Exports/mon-budget-${TODAY}.xlsx`);
  await noOverlay(page);

  // la vérification de l'installation écrit réellement dans le dossier
  await page.evaluate(() => window.monBudget.open('about'));
  await page.locator('[data-action="self-test"]').click();
  await page.waitForFunction(() => /écrit dans Documents\/MonBudget\/Exports\/test-ecriture\.txt/.test(document.querySelector('[data-card="self-test"]').innerText));
  assert.equal(await page.locator('[data-screen="about"] .chip.bad').count(), 0);
  assert.match(await readText(page, 'Documents/MonBudget/Exports/test-ecriture.txt'), /^Test du \d{4}-/);

  // un commentaire enregistré comme fichier va dans son sous-dossier
  await page.evaluate(() => window.monBudget.open('bugs'));
  await page.locator('[data-screen="bugs"] textarea[name="text"]').fill('Un bouton est trop petit.');
  await page.locator('[data-screen="bugs"] [data-action="keep-report"]').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports.length === 1 && !window.monBudget.busy);
  await page.locator('[data-screen="bugs"] [data-report]').click();
  await page.locator('.sheet [data-value="export"]').click();
  await page.waitForFunction(() => /Enregistré dans Documents\/MonBudget\/Commentaires\/commentaire-/.test(document.querySelector('.toast')?.textContent || ''));
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);

  assert.deepEqual(await tree(page), [
    `Documents/MonBudget/Commentaires/commentaire-${TODAY}.txt`,
    `Documents/MonBudget/Exports/mon-budget-${TODAY}.xlsx`,
    'Documents/MonBudget/Exports/test-ecriture.txt',
    AUTO,
  ]);
  assert.equal(await page.evaluate(() => localStorage.getItem('test-picks')), '2', 'le dossier n’a été demandé qu’une fois (plus l’annulation)');

  // à la réouverture, le dossier est toujours lié : rien à refaire
  const again = await openApp({ context: ctx.context, init: fakePicker });
  assert.deepEqual(await again.page.evaluate(() => [window.monBudget.folder.info().ready, window.monBudget.folder.info().label]), [true, 'Documents/MonBudget']);
  await openTab(again.page, 'more');
  assert.equal(await again.page.locator('[data-notice="folder-blocked"]').count(), 0);
  assert.equal(await again.page.evaluate(() => localStorage.getItem('test-picks')), '2');

  // « Ne plus copier » : le lien est défait, les fichiers déjà écrits restent
  await openBackup(again.page);
  await again.page.locator('[data-screen="backup"] [data-action="forget-folder"]').click();
  await answer(again.page, true);
  await again.page.waitForFunction(() => window.monBudget.folder.info().linked === false);
  await again.page.waitForFunction(() => !document.querySelector('[data-screen="backup"] [data-action="backup-now"]'));
  assert.equal(await again.page.evaluate(() => window.monBudget.setting('link:folder')), null);
  assert.equal((await tree(again.page)).length, 4);
  assert.deepEqual(again.problems, []);
  await done(ctx);
});

test('le téléphone redemande l’accès au dossier : l’appli le signale, un geste suffit, la copie reprend', async () => {
  const ctx = await openApp({ init: fakePicker });
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '1200', label: 'Salaire' });
  await openBackup(page);
  await page.locator('[data-screen="backup"] [data-action="choose-folder"]').click();
  await page.waitForFunction(() => window.monBudget.folder.info().ready === true);
  await settled(page);

  // entre deux ouvertures, le téléphone a retiré l'accès
  await page.evaluate(() => localStorage.setItem('test-permission', 'prompt'));
  const again = await openApp({ context: ctx.context, init: fakePicker });
  const p = again.page;
  assert.deepEqual(await p.evaluate(() => [window.monBudget.folder.info().linked, window.monBudget.folder.info().ready, window.monBudget.folder.info().permission]), [true, false, 'prompt']);
  await p.waitForSelector('.tabbar button[data-tab="more"][data-badge]');

  // l'écran des sauvegardes l'explique et ne prétend pas sauvegarder
  await openBackup(p);
  assert.equal(await p.locator('[data-screen="backup"] [data-notice="folder-blocked"]').count(), 1);
  assert.equal(await p.locator('[data-screen="backup"] [data-action="backup-now"]').count(), 0);
  // un export demandé maintenant est simplement téléchargé, comme sans dossier
  await p.locator('[data-screen="backup"] [data-action="export-csv"]').click();
  assert.match(await p.locator('.dialog').innerText(), /Télécharger/);
  await answer(p, null);
  await noOverlay(p);
  await p.evaluate(() => window.monBudget.back());

  // l'onglet Plus propose de réautoriser : un toucher
  await openTab(p, 'more');
  const notice = p.locator('[data-screen="more"] [data-notice="folder-blocked"]');
  assert.match(await notice.innerText(), /redemande l'accès au dossier « Documents »/);
  await notice.locator('[data-action="allow-folder"]').click();
  await p.waitForFunction(() => window.monBudget.folder.info().ready === true);
  assert.equal(await toastText(p), 'Accès au dossier rétabli');
  assert.equal(await p.evaluate(() => localStorage.getItem('test-requests')), '1');
  await p.waitForFunction(() => !document.querySelector('[data-notice="folder-blocked"]') && !document.querySelector('.tabbar button[data-tab="more"][data-badge]'));

  // et la copie reprend
  await addOperationFromMore(p);
  await openBackup(p);
  await p.locator('[data-screen="backup"] [data-action="backup-now"]').click();
  await p.waitForFunction((text) => document.querySelector('.toast')?.textContent === text, `Sauvegardé dans ${AUTO}`);
  assert.equal(JSON.parse(await readText(p, AUTO)).data.operations.length, 2);
  assert.deepEqual(again.problems, []);
  await done(ctx);
});

async function addOperationFromMore(page) {
  await page.evaluate(() => window.monBudget.go('operations'));
  await addOperation(page, { amount: '8', label: 'Café' });
}
