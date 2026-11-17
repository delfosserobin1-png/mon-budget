// Outils communs aux tests de bout en bout : un vrai navigateur (Chromium) pilote la vraie appli,
// servie par le petit serveur local. L'horloge est figée pour que les dates soient prévisibles.
//
// Les heures des tests (« 2026-11-15T23:58:30 ») sont des heures de Paris, comme dans le navigateur
// des tests (timezoneId). On règle donc aussi ce processus sur Paris : sans cela, sur un serveur à
// l'heure universelle (GitHub), 23 h 58 tomberait déjà le lendemain dans l'appli.
process.env.TZ = 'Europe/Paris';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { startServer } from '../../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Le numéro de version en cours (celui de package.json), pour ne pas le recopier dans chaque test. */
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
export const NOW = '2026-11-15T10:30:00';
export const TODAY = '2026-11-15';
export const SHOTS = join(ROOT, 'tests', 'e2e', 'captures');

let server = null;
let browser = null;

export async function startAll() {
  server = await startServer({ port: 0, root: join(ROOT, 'www') });
  browser = await chromium.launch();
  mkdirSync(SHOTS, { recursive: true });
  return { url: server.url };
}

export async function stopAll() {
  if (browser) await browser.close();
  if (server) await server.close();
}

/** Le navigateur des tests (pour les tests qui ont besoin de leur propre contexte ou serveur). */
export function getBrowser() {
  return browser;
}

/**
 * Ouvre l'appli dans un contexte neuf (base vide). Options :
 *   onboarding: false → saute l'écran de bienvenue ; dark: true → thème sombre ;
 *   now → date et heure simulées ; init → fonction exécutée dans la page avant l'appli ;
 *   pwa: true → laisse l'appli se mettre en réserve (service worker), comme une fois publiée ;
 *              sans cela chaque test charge les fichiers directement, sans intermédiaire ;
 *   setup(context) → appelé sur un contexte neuf avant l'ouverture (faux réseau, autorisations) ;
 *   url → autre adresse que le serveur des tests.
 */
export async function openApp({ onboarding = false, demo = false, dark = false, now = NOW, init = null, context: reuse = null, width = 412, height = 915, pwa = false, setup = null, url = null } = {}) {
  const context =
    reuse ||
    (await browser.newContext({
      viewport: { width, height },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      colorScheme: dark ? 'dark' : 'light',
      hasTouch: false,
      reducedMotion: 'reduce',
      serviceWorkers: pwa ? 'allow' : 'block',
    }));
  if (setup && !reuse) await setup(context);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`erreur page : ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console : ${message.text()}`);
  });
  await page.clock.install({ time: new Date(now) });
  if (init) await page.addInitScript(init);
  await page.goto(url || server.url);
  await page.waitForSelector('html[data-ready="true"]', { timeout: 15000 });
  if (demo) {
    await page.evaluate(() => window.monBudget.loadDemo());
    await page.locator('[data-action="start-later"]').click().catch(() => {});
    await page.waitForFunction(() => !document.querySelector('.sheet'));
  } else if (!onboarding) {
    const later = page.locator('[data-action="start-later"]');
    if (await later.count()) await later.click();
  }
  return { page, context, problems };
}

export async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Lit un montant affiché (« 1 234,56 € », « −12,00 € ») et le renvoie en centimes. */
export function cents(text) {
  // \s couvre aussi les espaces insécables ; le signe moins typographique est ramené au tiret
  const cleaned = text.replace(/[\s€]/g, '').replace(String.fromCharCode(0x2212), '-').replace('+', '');
  const m = /^(-)?(\d+),(\d{2})$/.exec(cleaned);
  if (!m) throw new Error(`Montant illisible : « ${text} »`);
  return (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3]));
}

export async function valueOf(page, name) {
  // on lit toujours un écran à jour : écritures terminées, affichage redessiné
  await page.waitForFunction(() => !window.monBudget.busy);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return cents(await page.locator(`[data-value="${name}"]`).first().innerText());
}

/** Remplit le formulaire d'opération ouvert et l'enregistre. */
export async function fillOperation(page, { mode, amount, label, date, counterparty, envelope, tags = [], importance, comment, simulated, save = true }) {
  const sheet = page.locator('.sheet').last();
  if (mode) await sheet.locator(`.seg button[data-value="${mode}"]`).click();
  if (amount !== undefined) await sheet.locator('input[name="amount"]').fill(String(amount));
  if (label !== undefined) await sheet.locator('input[name="label"]').fill(label);
  if (date) await sheet.locator('input[name="date"]').fill(date);
  if (counterparty !== undefined) await sheet.locator('input[name="counterparty"]').fill(counterparty);
  if (envelope) await sheet.locator('select[name="envelopeId"]').selectOption({ label: envelope });
  for (const tag of tags) await sheet.locator('.pick', { hasText: tag }).click();
  if (importance) await sheet.locator('.pick', { hasText: importance }).click();
  if (comment !== undefined) await sheet.locator('textarea[name="comment"]').fill(comment);
  if (simulated) await sheet.locator('[data-field="simulated"]').click();
  if (save) await sheet.locator('[data-action="save"]').click();
}

export async function addOperation(page, fields) {
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await fillOperation(page, fields);
  await noOverlay(page);
}

/** Change d'onglet (operations, envelopes, forecast, stats, more). */
export async function openTab(page, id) {
  await page.locator(`.tabbar button[data-tab="${id}"]`).click();
  await page.waitForSelector(`[data-screen="${id}"]:not([hidden])`);
}

/** La feuille (panneau) au premier plan. */
export function sheet(page) {
  return page.locator('.sheet').last();
}

/** Répond à la boîte de dialogue ouverte : true / false pour une confirmation, sinon l'identifiant du choix. */
export async function answer(page, value) {
  await page.locator(`.dialog [data-value="${value}"]`).last().click();
}

/** Attend que la boîte de dialogue soit refermée et son effet enregistré (la feuille en dessous peut rester ouverte). */
export async function dialogGone(page) {
  await page.waitForFunction(() => !document.querySelector('.dialog') && !window.monBudget.busy);
  await painted(page);
}

/** Laisse à l'écran le temps de se redessiner (l'affichage est mis à jour à l'image suivante). */
export async function painted(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Attend que tout soit refermé, enregistré ET affiché (aucune feuille ouverte, aucune écriture en cours). */
export async function noOverlay(page) {
  await page.waitForFunction(() => !document.querySelector('.overlay') && !window.monBudget.busy);
  await painted(page);
}

/** Attend la fin des écritures en cours (après une action qui ne ferme rien). */
export async function settled(page) {
  await page.waitForFunction(() => !window.monBudget.busy);
  await painted(page);
}

/** État complet de l'appli, lu dans la page (pour vérifier ce qui est réellement enregistré). */
export function readState(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.monBudget.state)));
}

/** Soldes calculés par l'appli à la date du jour simulée. */
export async function balancesOf(page) {
  return { available: await valueOf(page, 'available'), total: await valueOf(page, 'total') };
}

/** Choisit un fichier dans le sélecteur ouvert par `trigger` (une fonction qui clique le bouton). */
export async function chooseFile(page, trigger, path) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(path);
}

/** Récupère le fichier téléchargé suite à `trigger` : { name, bytes }. */
export async function download(page, trigger) {
  const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  return { name: file.suggestedFilename(), bytes: new Uint8Array(readFileSync(path)) };
}
