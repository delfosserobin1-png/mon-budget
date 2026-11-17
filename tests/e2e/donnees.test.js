// Données : sauvegardes, imports, exports tableur, effacement, code de verrouillage, signalement
// de bug, et comportement dans l'appli Android (modules Capacitor simulés).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAll, stopAll, openApp, addOperation, openTab, sheet, answer, noOverlay, settled, readState, balancesOf, chooseFile, download, ROOT, TODAY, VERSION } from './harness.js';
import { unzip, decodeText } from '../../www/js/io/zip.js';

before(startAll);
after(stopAll);

const TMP = mkdtempSync(join(tmpdir(), 'mon-budget-'));
// un vrai petit PNG (2 × 2 pixels) pour jouer le rôle d'une photo de ticket
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxAADAA0GAQPdvZd0AAAAAElFTkSuQmCC', 'base64');

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

async function openBackup(page) {
  await page.evaluate(() => window.monBudget.open('backup'));
  await page.waitForSelector('[data-screen="backup"]');
}

async function exportAs(page, action) {
  return download(page, async () => {
    await page.locator(`[data-screen="backup"] [data-action="${action}"]`).click();
    await answer(page, 'save');
  });
}

function strip(state) {
  // tout sauf les réglages (ils ne voyagent pas avec une sauvegarde)
  const { settings, ...rest } = state;
  return rest;
}

test('sauvegarde complète (ZIP, avec photo) puis restauration sur une appli vide : tout revient à l’identique', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const photo = join(TMP, 'ticket.png');
  writeFileSync(photo, PNG);
  // une opération avec une photo de ticket
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await sheet(page).locator('input[name="amount"]').fill('18,40');
  await sheet(page).locator('input[name="label"]').fill('Pharmacie de garde');
  await chooseFile(page, () => sheet(page).locator('[data-action="photo-gallery"]').click(), photo);
  await sheet(page).locator('.photo-wrap').waitFor();
  await sheet(page).locator('[data-action="save"]').click();
  await noOverlay(page);
  const before = await readState(page);
  const beforeBalances = await balancesOf(page);
  const withPhoto = before.operations.find((o) => o.label === 'Pharmacie de garde');
  assert.equal(withPhoto.photoIds.length, 1);
  assert.equal(before.files.length, 1);
  const originalSize = await page.evaluate(async (id) => (await window.monBudget.store.readBlob(id)).bytes.length, withPhoto.photoIds[0]);
  assert.ok(originalSize > 0);

  await openBackup(page);
  const zip = await exportAs(page, 'export-zip');
  assert.equal(zip.name, `mon-budget-sauvegarde-${TODAY}.zip`);
  const entries = await unzip(zip.bytes);
  const names = entries.map((e) => e.name).sort();
  assert.ok(names.includes('mon-budget.json') && names.includes('LISEZ-MOI.txt'));
  assert.equal(names.filter((n) => n.startsWith('pieces/')).length, 1);
  const json = JSON.parse(decodeText(entries.find((e) => e.name === 'mon-budget.json').data));
  assert.equal(json.format, 'mon-budget');
  assert.equal(json.data.operations.length, before.operations.length);
  const path = join(TMP, zip.name);
  writeFileSync(path, zip.bytes);

  // on efface tout (double confirmation), l'écran de bienvenue revient
  await page.locator('[data-screen="backup"] [data-action="wipe"]').click();
  await answer(page, true);
  await answer(page, true);
  await page.waitForSelector('.sheet [data-action="start-restore"]');
  assert.equal((await readState(page)).operations.length, 0);
  await page.locator('.sheet [data-action="start-restore"]').click();
  await chooseFile(page, () => page.locator('[data-screen="backup"] [data-action="import-backup"]').click(), path);
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog').innerText(), /opérations/);
  await answer(page, true);
  await page.waitForSelector('.dialog h2:has-text("Import terminé")');
  await answer(page, true);
  await noOverlay(page);

  const after = await readState(page);
  assert.deepEqual(strip(after), strip(before));
  const blob = await page.evaluate(async (id) => {
    const b = await window.monBudget.store.readBlob(id);
    return b ? { mime: b.mime, size: b.bytes.length } : null;
  }, withPhoto.photoIds[0]);
  assert.ok(blob && blob.size === originalSize && /^image\//.test(blob.mime), 'le contenu de la photo est revenu, octet pour octet');
  await page.evaluate(() => window.monBudget.go('operations'));
  assert.deepEqual(await balancesOf(page), beforeBalances);
  await done(ctx);
});

test("export des données seules (JSON), classeur Excel et CSV : fichiers bien formés", async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const state = await readState(page);
  await openBackup(page);

  const json = await exportAs(page, 'export-json');
  assert.equal(json.name, `mon-budget-donnees-${TODAY}.json`);
  const data = JSON.parse(decodeText(json.bytes));
  assert.deepEqual([data.format, data.schema, data.appVersion], ['mon-budget', 2, VERSION]);
  assert.equal(data.data.envelopes.length, state.envelopes.length);
  await page.waitForFunction(() => !!window.monBudget.setting('lastBackupAt'));

  const xlsx = await exportAs(page, 'export-xlsx');
  assert.equal(xlsx.name, `mon-budget-${TODAY}.xlsx`);
  const parts = await unzip(xlsx.bytes);
  const partNames = parts.map((p) => p.name);
  for (const needed of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(partNames.includes(needed), needed);
  const workbook = decodeText(parts.find((p) => p.name === 'xl/workbook.xml').data);
  for (const sheetName of ['Opérations', 'Enveloppes', 'Tags', 'Récurrences', 'Rapprochements']) assert.ok(workbook.includes(`name="${sheetName}"`), sheetName);
  const first = decodeText(parts.find((p) => p.name === 'xl/worksheets/sheet1.xml').data);
  assert.equal((first.match(/<row /g) || []).length, state.operations.length + 1, 'une ligne par opération, plus les titres');

  const csv = await exportAs(page, 'export-csv');
  const text = decodeText(csv.bytes);
  assert.equal(csv.bytes[0], 0xef, 'marque UTF-8 pour Excel');
  const lines = text.trim().split('\r\n');
  assert.match(lines[0], /Date;Heure;Type;Libellé/);
  assert.equal(lines.length, state.operations.length + 1);
  assert.ok(lines.some((l) => /;-?\d+,\d{2};/.test(l)), 'montants avec virgule décimale');
  await done(ctx);
});

test("import d'une sauvegarde de l'ancienne version, en « ajouter » : rien n'est écrasé, pas de doublon au second import", async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '500', label: 'Déjà là' });
  await openBackup(page);
  const v1 = join(ROOT, 'tests', 'fixtures', 'export-v1.json');
  await chooseFile(page, () => page.locator('[data-screen="backup"] [data-action="import-backup"]').click(), v1);
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog').innerText(), /ancienne version/);
  await answer(page, 'merge');
  await page.waitForSelector('.dialog h2:has-text("Import terminé")');
  await answer(page, true);
  await noOverlay(page);
  let state = await readState(page);
  assert.ok(state.operations.some((o) => o.label === 'Déjà là'));
  assert.equal(state.envelopes.length, 3);
  assert.equal(state.tags.length, 3);
  assert.equal(state.recurring.length, 3);
  assert.equal(state.files.length, 1, 'la photo incluse dans le fichier est reprise');
  const count = state.operations.filter((o) => !o.recurringId || !o.simulated).length;
  // second import du même fichier : tout est reconnu comme déjà présent
  await chooseFile(page, () => page.locator('[data-screen="backup"] [data-action="import-backup"]').click(), v1);
  await answer(page, 'merge');
  await page.waitForSelector('.dialog h2:has-text("Import terminé")');
  assert.match(await page.locator('.dialog').innerText(), /Déjà présent/);
  await answer(page, true);
  await noOverlay(page);
  state = await readState(page);
  assert.equal(state.operations.filter((o) => !o.recurringId || !o.simulated).length, count);
  assert.equal(state.envelopes.length, 3);

  // un fichier qui n'est pas une sauvegarde est refusé proprement
  const junk = join(TMP, 'autre.json');
  writeFileSync(junk, '{"bonjour": true}');
  await chooseFile(page, () => page.locator('[data-screen="backup"] [data-action="import-backup"]').click(), junk);
  await page.waitForSelector('.dialog h2:has-text("Import impossible")');
  await answer(page, true);
  await noOverlay(page);
  await done(ctx);
});

test('code de verrouillage : définition, mauvais code, bon code, demandé à la réouverture, suppression', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await page.evaluate(() => window.monBudget.open('security'));
  await page.locator('[data-action="define-pin"]').click();
  await page.locator('.dialog input').fill('12');
  await answer(page, 'ok');
  assert.match(await page.locator('.dialog .error:not([hidden])').innerText(), /4 à 6 chiffres/);
  await page.locator('.dialog input').fill('2580');
  await answer(page, 'ok');
  await page.waitForSelector('.dialog h2:has-text("Confirme le code")');
  await page.locator('.dialog input').fill('2581');
  await answer(page, 'ok');
  assert.match(await page.locator('.dialog .error:not([hidden])').innerText(), /différents/);
  await page.locator('.dialog input').fill('2580');
  await answer(page, 'ok');
  await noOverlay(page);
  await page.waitForFunction(() => !!window.monBudget.setting('pin'));
  const pin = await page.evaluate(() => window.monBudget.setting('pin'));
  assert.ok(!JSON.stringify(pin).includes('2580'), "le code n'est pas enregistré en clair");

  await page.locator('[data-action="lock-now"]').click();
  await page.waitForSelector('.lock');
  for (const d of '1111') await page.locator(`.lock [data-key="${d}"]`).click();
  assert.match(await page.locator('.lock [role="status"]').innerText(), /Code incorrect/);
  assert.equal(await page.locator('.lock').count(), 1);
  // « Code oublié » explique quoi faire, sans rien déverrouiller
  await page.locator('.lock .link-btn').click();
  assert.match(await page.locator('.lock [data-help="forgot"]').innerText(), /Effacer les données/);
  assert.equal(await page.locator('.lock').count(), 1);
  for (const d of '2580') await page.locator(`.lock [data-key="${d}"]`).click();
  await page.waitForFunction(() => !document.querySelector('.lock'));

  // à la réouverture, le code est demandé avant tout
  const again = await openApp({ context: ctx.context });
  assert.equal(await again.page.locator('.lock').count(), 1);
  assert.equal(await again.page.evaluate(() => window.monBudget.isLocked()), true);
  await again.page.keyboard.type('2580');
  await again.page.waitForFunction(() => !document.querySelector('.lock'));
  await again.page.evaluate(() => window.monBudget.open('security'));
  await again.page.locator('[data-action="remove-pin"]').click();
  await again.page.locator('.dialog input').fill('2580');
  await answer(again.page, 'ok');
  await again.page.waitForFunction(() => !window.monBudget.setting('pin'));
  assert.deepEqual(again.problems, []);
  await done(ctx);
});

test('commentaire sans connexion à Claude : texte obligatoire, capture jointe, informations techniques sans données personnelles', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  await page.evaluate(() => window.monBudget.open('bugs'));
  // sans connexion réglée : l'écran le dit, et propose le partage à la main
  assert.equal(await page.locator('[data-screen="bugs"] [data-notice="link-missing"]').count(), 1);
  assert.equal(await page.locator('[data-screen="bugs"] [data-action="save-report"]').count(), 1);
  assert.equal(await page.locator('[data-screen="bugs"] [data-action="send-report"]').count(), 0);
  await page.locator('[data-action="keep-report"]').click();
  assert.match(await page.locator('[data-screen="bugs"] .error:not([hidden])').innerText(), /Décris/);
  await page.locator('[data-screen="bugs"] textarea[name="text"]').fill("Le total de l'enveloppe Vacances ne bouge pas après un virement.");
  await page.locator('[data-screen="bugs"] textarea[name="steps"]').fill("J'ai fait Alimenter, 50 euros.");
  const capture = join(TMP, 'capture.png');
  writeFileSync(capture, PNG);
  await chooseFile(page, () => page.locator('[data-action="add-capture"]').click(), capture);
  await page.locator('[data-screen="bugs"] .photo-wrap').waitFor();
  await page.locator('[data-action="keep-report"]').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports.length === 1 && !window.monBudget.busy);
  const state = await readState(page);
  const report = state.bugReports[0];
  assert.equal(report.photoIds.length, 1);
  assert.equal(report.appVersion, VERSION);
  assert.deepEqual([report.kind, report.queued, report.remote], ['bug', false, null], "un problème, ni envoyé ni en attente d'envoi");
  assert.ok(report.diagnostics.includes(`Mon Budget ${VERSION}`));
  assert.match(report.diagnostics, /operations=\d+/);
  assert.match(report.diagnostics, /Claude : non connecté/);
  for (const op of state.operations.slice(0, 20)) {
    if (op.label && op.label.length > 4) assert.ok(!report.diagnostics.includes(op.label), 'aucun libellé d\'opération dans le diagnostic');
  }
  const row = page.locator(`[data-report="${report.id}"]`);
  assert.equal(await row.count(), 1);
  assert.equal(await row.locator('[data-status="local"]').count(), 1, 'marqué « à envoyer »');

  // export du commentaire : un ZIP avec le texte et la capture
  await row.click();
  await page.waitForSelector('.sheet [data-value="export"]');
  assert.equal(await page.locator('.sheet [data-value="send"]').count(), 0, "pas de bouton d'envoi tant que la connexion n'est pas réglée");
  const file = await download(page, () => page.locator('.sheet [data-value="export"]').click());
  assert.match(file.name, /^commentaire-\d{4}-\d{2}-\d{2}\.zip$/);
  const entries = await unzip(file.bytes);
  const entryNames = entries.map((e) => e.name).sort();
  assert.equal(entryNames.length, 2);
  assert.match(entryNames[0], /^capture-1\.(jpg|png)$/);
  assert.equal(entryNames[1], 'commentaire.txt');
  const exported = decodeText(entries.find((e) => e.name === 'commentaire.txt').data);
  assert.match(exported, /ne bouge pas après un virement/);
  assert.match(exported, /Juste avant :\s+J'ai fait Alimenter/);

  // suppression (avec confirmation), puis annulation : le commentaire revient
  await page.locator('.sheet [data-value="delete"]').click();
  await answer(page, true);
  await noOverlay(page);
  assert.equal((await readState(page)).bugReports.length, 0);
  await page.locator('.undo-pill').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports.length === 1 && !window.monBudget.busy);
  await done(ctx);
});

test("dans l'appli Android : sauvegarde automatique, export dans Documents/MonBudget, partage, bouton retour physique", async () => {
  const ctx = await openApp({
    init: () => {
      const files = {};
      const calls = { share: [], exit: 0, listeners: {} };
      window.__android = { files, calls };
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: {
          Filesystem: {
            async writeFile({ path, data, directory }) {
              files[`${directory}/${path}`] = data;
              return { uri: `file:///${directory}/${path}` };
            },
            async readdir({ path, directory }) {
              const prefix = `${directory}/${path}/`;
              return { files: Object.keys(files).filter((p) => p.startsWith(prefix)).map((p) => ({ name: p.slice(prefix.length) })) };
            },
            async deleteFile({ path, directory }) {
              delete files[`${directory}/${path}`];
            },
          },
          Share: {
            async share(options) {
              calls.share.push(options);
              return {};
            },
          },
          App: {
            addListener(name, handler) {
              calls.listeners[name] = handler;
              return { remove() {} };
            },
            minimizeApp() {
              calls.exit++;
            },
          },
        },
      };
    },
  });
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '1200', label: 'Salaire' });
  await openBackup(page);
  assert.match(await page.locator('[data-screen="backup"]').innerText(), /Documents\/MonBudget\/Sauvegardes/);

  await page.locator('[data-action="backup-now"]').click();
  await page.waitForFunction(() => Object.keys(window.__android.files).some((p) => p.includes('Sauvegardes/mon-budget-auto-')));
  let files = await page.evaluate(() => Object.keys(window.__android.files));
  assert.ok(files.includes(`DOCUMENTS/MonBudget/Sauvegardes/mon-budget-auto-${TODAY}.json`));
  const saved = await page.evaluate((p) => JSON.parse(decodeURIComponent(escape(atob(window.__android.files[p])))), `DOCUMENTS/MonBudget/Sauvegardes/mon-budget-auto-${TODAY}.json`);
  assert.equal(saved.data.operations.length, 1);

  // export Excel « Enregistrer » → Documents/MonBudget/Exports
  await page.locator('[data-screen="backup"] [data-action="export-xlsx"]').click();
  assert.match(await page.locator('.dialog').innerText(), /Enregistrer dans Documents\/MonBudget/);
  await answer(page, 'save');
  await page.waitForFunction(() => Object.keys(window.__android.files).some((p) => p.includes('Exports/')));
  files = await page.evaluate(() => Object.keys(window.__android.files));
  assert.ok(files.includes(`DOCUMENTS/MonBudget/Exports/mon-budget-${TODAY}.xlsx`));
  // export CSV « Partager » → menu de partage d'Android, avec le fichier
  await page.locator('[data-screen="backup"] [data-action="export-csv"]').click();
  await answer(page, 'share');
  await page.waitForFunction(() => window.__android.calls.share.length === 1);
  const shared = await page.evaluate(() => window.__android.calls.share[0]);
  assert.match(shared.files[0], /^file:\/\/\/CACHE\/partage\/mon-budget-operations-.*\.csv$/);

  // bouton « retour » du téléphone : ferme la feuille, puis le sous-écran, puis demande confirmation avant de quitter
  const back = () => page.evaluate(() => window.__android.calls.listeners.backButton());
  await page.evaluate(() => window.monBudget.go('operations'));
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await page.waitForSelector('.sheet');
  await back();
  await noOverlay(page);
  await page.evaluate(() => window.monBudget.open('guide'));
  await back();
  assert.equal(await page.evaluate(() => window.monBudget.currentScreenName()), 'operations');
  await openTab(page, 'stats');
  await back();
  assert.equal(await page.evaluate(() => window.monBudget.currentScreenName()), 'operations');
  await back();
  assert.equal(await page.evaluate(() => window.__android.calls.exit), 0, 'premier appui : simple avertissement');
  assert.match(await page.locator('.toast').innerText(), /encore une fois/);
  await back();
  assert.equal(await page.evaluate(() => window.__android.calls.exit), 1, "second appui : l'appli se met en arrière-plan");
  await settled(page);
  await done(ctx);
});

test("rappel de sauvegarde : il apparaît après deux semaines d'utilisation, et disparaît une fois la sauvegarde exportée", async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '1000', label: 'Salaire' });
  await openTab(page, 'more');
  assert.equal(await page.locator('[data-notice="backup-reminder"]').count(), 0);
  assert.equal(await page.locator('.tabbar button[data-tab="more"][data-badge]').count(), 0);

  // quinze jours passent
  await page.clock.fastForward(15 * 24 * 3600 * 1000);
  await page.waitForFunction(() => window.monBudget.today() === '2026-11-30');
  await openTab(page, 'operations');
  await page.waitForSelector('.tabbar button[data-tab="more"][data-badge]');
  await openTab(page, 'more');
  assert.match(await page.locator('[data-notice="backup-reminder"]').innerText(), /jamais été sauvegardées hors du téléphone/);
  await page.locator('[data-action="go-backup"]').click();
  await download(page, async () => {
    await page.locator('[data-screen="backup"] [data-action="export-zip"]').click();
    await answer(page, 'save');
  });
  await page.waitForFunction(() => !!window.monBudget.setting('lastBackupAt'));
  await page.evaluate(() => window.monBudget.back());
  await page.waitForFunction(() => !document.querySelector('[data-notice="backup-reminder"]'));
  assert.equal(await page.locator('.tabbar button[data-tab="more"][data-badge]').count(), 0);
  await done(ctx);
});
