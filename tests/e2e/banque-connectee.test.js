// Banque connectée : l'appli reprend le relevé que l'ordinateur a relevé chez la banque, déposé
// chiffré dans la boîte privée (faux GitHub), le déchiffre et le passe à l'assistant d'import.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, noOverlay, settled, readState, valueOf } from './harness.js';
import { createFakeGithub } from '../fake-github.js';
import { encryptText } from '../../www/js/core/chiffre.js';

before(startAll);
after(stopAll);

const PHRASE = 'k7mp-2xqa-r9tf-bb3d-hw4e';
const BOX_PATH = 'banque/releve.json.chiffre';
const LINES = [
  { date: '2026-11-03', amount: 250000, label: 'VIR SEPA RECU', details: ['DE: ATELIER DURAND', 'MOTIF: SALAIRE'], counterparty: 'ATELIER DURAND' },
  { date: '2026-11-05', amount: -4590, label: 'CARTE X1234 04/11 CARREFOUR CITY', details: [], opDate: '2026-11-04' },
  { date: '2026-11-12', amount: -1599, label: 'PRLV SEPA FREE MOBILE', details: ['DE: FREE MOBILE'] },
];

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

async function connect(page, fake) {
  await page.evaluate(() => window.monBudget.open('claude'));
  await page.locator('[data-screen="claude"] input[name="repo"]').fill(`${fake.repo}:${fake.token}`);
  await page.locator('[data-screen="claude"] [data-action="connect"]').click();
  await page.waitForSelector('[data-screen="claude"] [data-card="link"]');
  await page.waitForFunction(() => !window.monBudget.claude.status.busy);
  await page.evaluate(() => window.monBudget.back());
}

test('banque connectée : phrase secrète, mauvaise phrase signalée, puis le relevé de la banque passe dans l’assistant et s’importe', async () => {
  const fake = createFakeGithub({ repo: 'moi/mon-budget-commentaires' });
  const statement = {
    format: 'mon-budget-banque',
    version: 1,
    bank: 'Société Générale',
    account: { last4: '2345', name: 'Compte courant' },
    fetchedAt: '2026-11-15T05:00:00.000Z',
    validUntil: '2027-05-14T05:00:00.000Z',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-15',
    balance: { amount: 273811, date: '2026-11-15', type: 'CLBD' },
    lines: LINES,
  };
  fake.files.set(BOX_PATH, new TextEncoder().encode(await encryptText(JSON.stringify(statement), PHRASE, { iterations: 100000 })));
  const ctx = await openApp({ setup: (context) => fake.install(context) });
  const { page } = ctx;
  const screen = page.locator('[data-screen="bank"]');

  // sans connexion à la boîte ni phrase : on ne peut rien reprendre
  await page.evaluate(() => window.monBudget.open('bank'));
  assert.equal(await screen.locator('[data-action="fetch-bank"]').isDisabled(), true);
  await page.evaluate(() => window.monBudget.back());
  await connect(page, fake);
  await page.evaluate(() => window.monBudget.open('bank'));

  // une phrase trop courte est refusée ; une mauvaise phrase est signalée clairement
  await screen.locator('input[name="phrase"]').fill('abc');
  await screen.locator('[data-action="save-phrase"]').click();
  assert.match(await screen.locator('[data-notice="bank-error"]').innerText(), /trop courte/);
  await screen.locator('input[name="phrase"]').fill('aaaa-bbbb-cccc-dddd-eeee');
  await screen.locator('[data-action="save-phrase"]').click();
  await settled(page);
  await screen.locator('[data-action="fetch-bank"]').click();
  await screen.locator('[data-notice="bank-error"]').waitFor();
  await page.waitForFunction(() => /ne correspond pas/.test(document.querySelector('[data-notice="bank-error"]')?.textContent || ''));

  // la bonne phrase, recopiée en majuscules avec des espaces : acceptée
  await screen.locator('[data-action="change-phrase"]').click();
  await screen.locator('input[name="phrase"]').fill(PHRASE.toUpperCase().replace(/-/g, ' '));
  await screen.locator('[data-action="save-phrase"]').click();
  await settled(page);
  await screen.locator('[data-action="fetch-bank"]').click();

  // l'assistant d'import s'ouvre avec les opérations de la banque
  const wizard = page.locator('[data-screen="statement"]');
  await wizard.locator('[data-value="line-count"]').waitFor();
  assert.equal(await wizard.locator('[data-value="line-count"]').innerText(), '3');
  assert.match(await wizard.innerText(), /Société Générale, compte se terminant par 2345/);
  assert.equal(await valueOf(page, 'closing'), 273811);
  await wizard.locator('[data-action="next"]').click();
  await wizard.locator('[data-action="next"]').click();
  assert.equal(await wizard.locator('.topbar h1').innerText(), 'Bilan');
  await wizard.locator('[data-action="commit"]').click();
  await noOverlay(page);
  const state = await readState(page);
  const ops = state.operations.filter((o) => o.kind === 'operation');
  assert.deepEqual(ops.map((o) => [o.amount, !!o.bank]).sort((a, b) => a[0] - b[0]), [[-4590, true], [-1599, true], [250000, true]], 'les opérations sont créées et pointées sur la banque');
  assert.equal(state.statements.length, 1);

  // la phrase reste sur le téléphone : ni dans les données, ni dans une sauvegarde
  const leaks = await page.evaluate(async (phrase) => {
    const { buildBackupJson } = await import('./js/data/backup.js');
    const backup = buildBackupJson(window.monBudget.store, { appVersion: window.monBudget.version });
    return [JSON.stringify(window.monBudget.state).includes(phrase), backup.includes(phrase)];
  }, PHRASE);
  assert.deepEqual(leaks, [false, false]);

  // de retour sur l'écran : ce qui a été repris, et jusqu'à quand vaut l'accord de la banque
  await page.evaluate(() => window.monBudget.open('bank'));
  assert.match(await page.locator('[data-screen="bank"]').last().locator('[data-value="bank-last"]').innerText(), /3 opérations \(Société Générale\), relevées le 15-11-2026\. Accord de la banque valable jusqu'au 14-05-2027\./);
  await done(ctx);
});
