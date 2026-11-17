// Commentaires pour Claude, dans un vrai navigateur : réglage de la connexion, envoi d'un
// commentaire avec capture, réponses de Claude, discussion, file d'attente hors connexion.
// GitHub est remplacé par un faux, en mémoire (tests/fake-github.js) : rien ne sort de la machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAll, stopAll, openApp, addOperation, openTab, answer, noOverlay, settled, readState, chooseFile, download, shot, VERSION } from './harness.js';
import { decodeText } from '../../www/js/io/zip.js';
import { parseMarker } from '../../www/js/core/comments.js';
import { COMMENTS_REPO } from '../../www/js/config.js';
import { createFakeGithub, FAKE_TOKEN } from '../fake-github.js';

before(startAll);
after(stopAll);

const REPO = 'moi/mon-budget-commentaires';
const TMP = mkdtempSync(join(tmpdir(), 'mon-budget-commentaires-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxAADAA0GAQPdvZd0AAAAAElFTkSuQmCC', 'base64');
const CAPTURE = join(TMP, 'capture.png');
writeFileSync(CAPTURE, PNG);

/**
 * Fin d'un test : aucune erreur dans la console, sauf celles que le navigateur écrit lui-même
 * quand une demande échoue — ce que certains tests provoquent exprès (`expected`).
 */
async function done(ctx, expected = []) {
  const unexpected = ctx.problems.filter((problem) => !expected.some((pattern) => pattern.test(problem)));
  assert.deepEqual(unexpected, [], 'aucune erreur inattendue dans la console du navigateur');
  await ctx.context.close();
}
const REFUSED = /Failed to load resource: the server responded with a status of (401|403|404)/;
const NO_NETWORK = /ERR_INTERNET_DISCONNECTED/;

async function open(fake, options = {}) {
  return openApp({ demo: true, setup: (context) => fake.install(context), ...options });
}

/** Règle la connexion en collant le « code de connexion » complet, comme le fera l'utilisateur. */
async function connect(page, fake) {
  await page.evaluate(() => window.monBudget.open('claude'));
  await page.locator('[data-screen="claude"] input[name="repo"]').fill(`${fake.repo}:${fake.token}`);
  await page.locator('[data-screen="claude"] [data-action="connect"]').click();
  await page.waitForSelector('[data-screen="claude"] [data-card="link"]');
  await page.waitForFunction(() => !window.monBudget.claude.status.busy);
  await page.evaluate(() => window.monBudget.go('operations'));
}

async function openComments(page) {
  await openTab(page, 'more');
  await page.locator('[data-screen="more"] [data-open="bugs"]').click();
  await page.waitForSelector('[data-screen="bugs"]');
}

async function writeComment(page, { kind = null, text, steps = null, capture = false }) {
  const screen = page.locator('[data-screen="bugs"]');
  if (kind) await screen.locator(`.seg button[data-value="${kind}"]`).click();
  await screen.locator('textarea[name="text"]').fill(text);
  if (steps) await screen.locator('textarea[name="steps"]').fill(steps);
  if (capture) {
    await chooseFile(page, () => screen.locator('[data-action="add-capture"]').click(), CAPTURE);
    await screen.locator('.photo-wrap').waitFor();
  }
}

const statusOf = (page, id) => page.locator(`[data-report="${id}"] [data-status]`).getAttribute('data-status');
const quiet = (page) => page.waitForFunction(() => !window.monBudget.busy && !window.monBudget.claude.status.busy);

test('connexion à Claude : saisie guidée, erreurs expliquées, jeton jamais montré ni exporté', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const ctx = await open(fake);
  const { page } = ctx;
  await openTab(page, 'more');
  assert.match(await page.locator('[data-open="claude"]').innerText(), /À régler une fois/);
  await page.locator('[data-open="claude"]').click();
  const screen = page.locator('[data-screen="claude"]');
  const repo = screen.locator('input[name="repo"]');
  const token = screen.locator('input[name="token"]');
  const errorOf = (name) => screen.locator(`[data-field="${name}"] .error:not([hidden])`).innerText();
  const submit = () => screen.locator('[data-action="connect"]').click();

  // l'adresse de la boîte réglée dans config.js est déjà remplie : il ne reste qu'à coller le jeton
  assert.equal(await repo.inputValue(), COMMENTS_REPO);
  assert.match(await screen.locator('[data-field="repo"]').innerText(), /il ne reste qu’à coller le jeton/);
  await submit();
  assert.match(await errorOf('token'), /Colle le jeton/);
  // adresse effacée : l'appli explique la forme attendue
  await repo.fill('');
  await submit();
  assert.match(await errorOf('repo'), /ton-nom\/nom-de-la-boite/);
  await repo.fill(REPO);
  await submit();
  assert.match(await errorOf('token'), /Colle le jeton/);
  await token.fill('trop court');
  await submit();
  assert.match(await errorOf('token'), /pas la bonne forme/);
  assert.equal(fake.requests.length, 0, "rien n'est demandé à GitHub tant que la saisie est incomplète");

  // l'aide : un lien ouvre le formulaire de GitHub déjà rempli (bons droits, rien de plus), dans une autre fenêtre
  const link = screen.locator('[data-action="create-token"]');
  const target = new URL(await link.getAttribute('href'));
  assert.equal(`${target.origin}${target.pathname}`, 'https://github.com/settings/personal-access-tokens/new');
  assert.deepEqual(Object.fromEntries(target.searchParams), { name: 'Mon Budget (appli)', description: "Envoi des commentaires depuis l'appli Mon Budget", expires_in: 'none', issues: 'write', contents: 'write' });
  assert.deepEqual([await link.getAttribute('target'), await link.getAttribute('rel')], ['_blank', 'noopener noreferrer']);
  await screen.locator('[data-action="how-to"]').click();
  assert.match(await page.locator('.dialog').innerText(), /Only select repositories[\s\S]*Issues[\s\S]*Contents[\s\S]*github_pat_/);
  await answer(page, true);
  await noOverlay(page);

  // le jeton reste masqué, sauf demande expresse
  assert.equal(await token.getAttribute('type'), 'password');
  await screen.locator('[data-action="reveal-token"]').click();
  assert.equal(await token.getAttribute('type'), 'text');
  await screen.locator('[data-action="reveal-token"]').click();
  assert.equal(await token.getAttribute('type'), 'password');

  await token.fill('github_pat_mauvais_jeton_00000000000000');
  await submit();
  await page.waitForFunction(() => document.querySelector('[data-screen="claude"] [data-field="token"] .error:not([hidden])'));
  assert.match(await errorOf('token'), /jeton d'accès est refusé/);
  await repo.fill('moi/une-autre-boite');
  await token.fill(FAKE_TOKEN);
  await submit();
  await page.waitForFunction(() => document.querySelector('[data-screen="claude"] [data-field="repo"] .error:not([hidden])'));
  assert.match(await errorOf('repo'), /introuvable/);
  assert.equal(await page.evaluate(() => window.monBudget.claude.connected), false);

  // le code de connexion collé d'un bloc dans le premier champ remplit les deux
  await token.fill('');
  await repo.fill(`https://github.com/${REPO} : ${FAKE_TOKEN}`);
  assert.equal(await repo.inputValue(), REPO);
  assert.equal(await token.inputValue(), FAKE_TOKEN);
  await submit();
  await page.waitForSelector('[data-screen="claude"] [data-card="link"]');
  const card = await page.locator('[data-card="link"]').innerText();
  assert.match(card, new RegExp(REPO));
  assert.match(card, /Privée/);
  await quiet(page);
  await shot(page, 'claude-connexion-active');

  // le jeton n'apparaît nulle part : ni à l'écran, ni dans un champ, ni dans le diagnostic, ni dans une sauvegarde
  const leaks = await page.evaluate((secret) => {
    const fields = [...document.querySelectorAll('input, textarea')].some((field) => field.value.includes(secret));
    return { text: document.body.innerText.includes(secret), html: document.documentElement.outerHTML.includes(secret), fields, info: JSON.stringify(window.monBudget.claude.info).includes(secret) };
  }, FAKE_TOKEN);
  assert.deepEqual(leaks, { text: false, html: false, fields: false, info: false });
  await page.evaluate(() => window.monBudget.open('about'));
  await page.locator('[data-screen="about"] .link-btn', { hasText: 'diagnostic' }).click();
  const diagnostic = await page.locator('.dialog').innerText();
  assert.match(diagnostic, /Claude : connecté/);
  assert.ok(!diagnostic.includes(FAKE_TOKEN) && !diagnostic.includes(REPO), 'ni jeton ni adresse de la boîte dans le diagnostic');
  await answer(page, true);
  assert.match(await page.locator('[data-screen="about"] [data-value="network"]').innerText(), /ton commentaire .* part dans ta boîte privée/);
  await page.evaluate(() => window.monBudget.open('backup'));
  const backup = await download(page, async () => {
    await page.locator('[data-screen="backup"] [data-action="export-json"]').click();
    await answer(page, 'save');
  });
  const exported = decodeText(backup.bytes);
  assert.ok(!exported.includes(FAKE_TOKEN) && !exported.includes('link:claude'), 'la connexion ne voyage pas avec une sauvegarde');

  // elle survit à la fermeture de l'appli…
  const again = await openApp({ context: ctx.context });
  assert.equal(await again.page.evaluate(() => window.monBudget.claude.info.repo), REPO);
  await openTab(again.page, 'more');
  assert.match(await again.page.locator('[data-open="claude"]').innerText(), new RegExp(`Connectée : ${REPO}`));
  // … et se retire d'un geste
  await again.page.locator('[data-open="claude"]').click();
  await again.page.locator('[data-action="disconnect"]').click();
  await answer(again.page, true);
  await again.page.waitForSelector('[data-screen="claude"] input[name="repo"]');
  assert.equal(await again.page.evaluate(() => window.monBudget.setting('link:claude')), null);
  assert.deepEqual(again.problems, []);
  await done(ctx, [REFUSED]);
});

test('commentaire envoyé à Claude (petit écran) : capture déposée, réponse reçue, discussion, puis « traité »', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const ctx = await open(fake, { width: 320, height: 568 });
  const { page } = ctx;
  await connect(page, fake);

  // on vient de l'onglet Stats : le commentaire propose de lui-même « Ça concerne : Stats »
  await openTab(page, 'stats');
  await openComments(page);
  const screen = page.locator('[data-screen="bugs"]');
  assert.equal(await screen.locator('[data-notice="link-ok"]').count(), 1);
  assert.equal(await screen.locator('select[name="screen"]').inputValue(), 'stats');
  await writeComment(page, { kind: 'idee', text: 'Un total par mois sur une seule ligne.\nCe serait plus lisible.', capture: true });
  assert.match(await screen.locator('[data-field="text"] label').innerText(), /Quelle est ton idée/);
  assert.equal(await screen.locator('[data-field="steps"]').isHidden(), true, '« juste avant » ne concerne que les problèmes');
  await screen.locator('[data-action="send-report"]').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports[0]?.remote);
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').innerText(), /Envoyé à Claude \(commentaire n° 1\)/);
  await quiet(page);

  // ce que Claude trouve dans sa boîte
  assert.equal(fake.issues.length, 1);
  const issue = fake.issues[0];
  assert.equal(issue.title, '[Idée] Un total par mois sur une seule ligne.');
  assert.match(issue.body, /^\*\*Idée\*\* — écran « Stats » — Mon Budget /);
  assert.match(issue.body, /Ce serait plus lisible\./);
  const marker = parseMarker(issue.body);
  const report = (await readState(page)).bugReports[0];
  assert.deepEqual([marker.id, marker.kind, marker.screen, marker.version], [report.id, 'idee', 'stats', VERSION]);
  assert.equal(marker.captures.length, 1);
  assert.ok(fake.files.get(marker.captures[0]).length > 20, 'la capture est déposée dans la boîte');
  const state = await readState(page);
  for (const op of state.operations.slice(0, 30)) {
    if (op.label && op.label.length > 4) assert.ok(!issue.body.includes(op.label), "aucun libellé d'opération n'est parti");
  }
  assert.ok(fake.requests.every((request) => !request.path.includes(FAKE_TOKEN)));
  assert.equal(await statusOf(page, report.id), 'sent');
  assert.match(await page.locator(`[data-report="${report.id}"]`).innerText(), /n° 1/);
  assert.equal(await screen.locator('textarea[name="text"]').inputValue(), '', 'le formulaire est prêt pour le commentaire suivant');

  // Claude répond : la relève l'annonce, un point apparaît sur l'onglet Plus
  fake.claudeReplies(1, "Bonne idée. Tu la veux en haut ou en bas de l'écran ?");
  await screen.locator('[data-action="sync"]').click();
  await page.waitForFunction((id) => document.querySelector(`[data-report="${id}"] [data-status="answered"]`), report.id);
  assert.match(await page.locator('.toast').innerText(), /1 nouvelle réponse de Claude/);
  await page.evaluate(() => window.monBudget.back());
  assert.equal(await page.locator('.tabbar button[data-tab="more"][data-badge]').count(), 1);
  const entry = page.locator('[data-screen="more"] [data-open="bugs"]');
  assert.match(await entry.innerText(), /1 réponse de Claude à lire/);
  assert.equal(await entry.locator('.count-badge').innerText(), '1');
  await entry.scrollIntoViewIfNeeded();
  await shot(page, 'claude-plus-reponse-a-lire');

  // lire la réponse l'éteint ; on peut répondre au même endroit
  await entry.click();
  await page.locator(`[data-report="${report.id}"]`).click();
  await page.waitForSelector('.sheet .thread');
  const thread = page.locator('.sheet .thread .msg');
  assert.deepEqual(await thread.evaluateAll((list) => list.map((m) => m.dataset.from)), ['moi', 'claude']);
  assert.match(await thread.nth(0).innerText(), /Un total par mois/);
  assert.equal(await thread.nth(0).locator('.photo-wrap').count(), 1, 'la capture jointe est rappelée');
  assert.match(await thread.nth(1).innerText(), /Claude, le \d{2}-\d{2}-\d{4}\s+Bonne idée/);
  await page.waitForFunction((id) => document.querySelector(`[data-report="${id}"] [data-status="talking"]`), report.id);
  const overflow = await page.evaluate(() => {
    const body = document.querySelector('.sheet-body');
    return body.scrollWidth > body.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1;
  });
  assert.equal(overflow, false, 'rien ne déborde sur un petit écran');

  await page.locator('.sheet [data-action="reply"]').click();
  assert.match(await page.locator('.sheet [data-field="reply"] .error:not([hidden])').innerText(), /Écris ta réponse/);
  await page.locator('.sheet textarea[name="reply"]').fill('En haut, sous le titre.');
  await page.locator('.sheet [data-action="reply"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.sheet .thread .msg').length === 3);
  assert.equal(await page.locator('.sheet textarea[name="reply"]').inputValue(), '');
  await shot(page, 'claude-fil-petit-ecran');
  assert.match(fake.issues[0].comments[1].body, /^En haut, sous le titre\.\n\n<!-- mon-budget:suite -->$/);
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);
  assert.equal(await page.locator('.tabbar button[data-tab="more"][data-badge]').count(), 0);

  // Claude corrige, répond et clôt : « traité » une fois la réponse lue
  fake.claudeReplies(1, 'Fait dans la version 2.1.1.');
  fake.claudeCloses(1);
  await screen.locator('[data-action="sync"]').click();
  await page.waitForFunction((id) => document.querySelector(`[data-report="${id}"] [data-status="answered"]`), report.id);
  await page.locator(`[data-report="${report.id}"]`).click();
  await page.waitForFunction(() => document.querySelectorAll('.sheet .thread .msg').length === 4);
  assert.deepEqual(await page.locator('.sheet .thread .msg').evaluateAll((list) => list.map((m) => m.dataset.from)), ['moi', 'claude', 'moi', 'claude']);
  await page.waitForFunction((id) => document.querySelector(`[data-report="${id}"] [data-status="done"]`), report.id);
  assert.match(await page.locator('.sheet .chips').innerText(), /Traité/);
  assert.equal(await page.locator('.sheet [data-value="send"]').count(), 0, 'déjà envoyé : pas de second envoi possible');
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);
  await page.locator(`[data-report="${report.id}"]`).scrollIntoViewIfNeeded();
  await shot(page, 'claude-liste-traite');
  await done(ctx);
});

test('sans réseau : le commentaire attend dans l’appli et part tout seul au retour de la connexion', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const ctx = await open(fake);
  const { page } = ctx;
  await connect(page, fake);
  await openComments(page);
  const screen = page.locator('[data-screen="bugs"]');

  // plus de réseau : ni pour le téléphone (navigator.onLine), ni pour les demandes vers GitHub
  fake.offline = true;
  await ctx.context.setOffline(true);
  await writeComment(page, { text: "Le solde de l'enveloppe Vacances ne bouge pas.", steps: "J'ai fait Alimenter, 50 euros." });
  await screen.locator('[data-action="send-report"]').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports[0]?.queued === true);
  await page.waitForFunction(() => /gardé : il partira tout seul/.test(document.querySelector('.toast')?.textContent || ''));
  const report = (await readState(page)).bugReports[0];
  assert.deepEqual([report.queued, report.remote], [true, null]);
  assert.equal(await statusOf(page, report.id), 'queued');
  assert.equal(await screen.locator('[data-notice="link-error"]').count(), 1, "l'écran dit que le dernier échange a échoué");
  assert.equal(fake.issues.length, 0);

  // le commentaire en attente explique sa situation et propose de réessayer
  await page.locator(`[data-report="${report.id}"]`).click();
  await page.waitForSelector('.sheet [data-value="send"]');
  assert.match(await page.locator('.sheet').innerText(), /attend une connexion/);
  assert.match(await page.locator('.sheet [data-value="send"]').innerText(), /Réessayer/);
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);

  // la connexion revient : rien à faire, il part
  fake.offline = false;
  await ctx.context.setOffline(false);
  await page.waitForFunction(() => window.monBudget.state.bugReports[0]?.remote?.number === 1, null, { timeout: 20000 });
  await quiet(page);
  assert.equal(fake.issues.length, 1, 'envoyé une seule fois');
  assert.match(fake.issues[0].body, /\*\*Juste avant\*\*\n\nJ'ai fait Alimenter, 50 euros\./);
  await page.waitForFunction((id) => document.querySelector(`[data-report="${id}"] [data-status="sent"]`), report.id);
  assert.equal(await screen.locator('[data-notice="link-ok"]').count(), 1);
  await done(ctx, [NO_NETWORK]);
});

test('commentaire écrit avant de régler la connexion : il s’envoie ensuite depuis sa fiche', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const ctx = await open(fake);
  const { page } = ctx;
  await openComments(page);
  await writeComment(page, { kind: 'question', text: 'À quoi sert « Elle a eu lieu » ?' });
  await page.locator('[data-screen="bugs"] [data-action="keep-report"]').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports.length === 1 && !window.monBudget.busy);
  const report = (await readState(page)).bugReports[0];
  assert.equal(await statusOf(page, report.id), 'local');

  // le bandeau mène au réglage ; une fois réglé, l'écran propose l'envoi
  await page.locator('[data-screen="bugs"] [data-action="open-link"]').click();
  await page.waitForSelector('[data-screen="claude"]');
  await page.locator('[data-screen="claude"] input[name="repo"]').fill(`${REPO}:${FAKE_TOKEN}`);
  await page.locator('[data-screen="claude"] [data-action="connect"]').click();
  await page.waitForSelector('[data-screen="claude"] [data-card="link"]');
  await page.evaluate(() => window.monBudget.back());
  await page.waitForSelector('[data-screen="bugs"] [data-action="send-report"]');
  assert.equal(fake.issues.length, 0, 'un commentaire simplement enregistré ne part pas sans qu’on le demande');

  await page.locator(`[data-report="${report.id}"]`).click();
  await page.locator('.sheet [data-value="send"]').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports[0].remote?.number === 1);
  assert.equal(fake.issues[0].title, '[Question] À quoi sert « Elle a eu lieu » ?');
  await page.waitForFunction(() => !document.querySelector('.sheet [data-value="send"]'));
  assert.equal(await page.locator('.sheet textarea[name="reply"]').isVisible(), true, 'une fois envoyé, on peut y répondre');
  await page.locator('.sheet .sheet-head .icon-btn').click();
  await noOverlay(page);
  await done(ctx);
});

test('boîte publique : avertissement clair, et les captures ne partent jamais', async () => {
  const fake = createFakeGithub({ repo: REPO, isPrivate: false });
  const ctx = await open(fake);
  const { page } = ctx;
  await page.evaluate(() => window.monBudget.open('claude'));
  const screen = page.locator('[data-screen="claude"]');
  await screen.locator('input[name="repo"]').fill(`${REPO}:${FAKE_TOKEN}`);
  await screen.locator('[data-action="connect"]').click();
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog').innerText(), /Cette boîte est publique[\s\S]*captures d'écran ne seront jamais envoyées/);
  await answer(page, false);
  await noOverlay(page);
  assert.equal(await page.evaluate(() => window.monBudget.claude.connected), false, 'annuler ne connecte pas');

  await screen.locator('[data-action="connect"]').click();
  await page.waitForSelector('.dialog');
  await answer(page, true);
  await page.waitForSelector('[data-screen="claude"] [data-card="link"]');
  assert.match(await page.locator('[data-card="link"]').innerText(), /Publique/);
  await quiet(page);

  await page.locator('[data-screen="claude"] [data-open="bugs"]').click();
  await page.waitForSelector('[data-screen="bugs"]');
  await writeComment(page, { text: 'Le graphique est vide.', capture: true });
  await page.locator('[data-screen="bugs"] [data-action="send-report"]').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports[0]?.remote);
  assert.equal(fake.files.size, 0, 'aucune image déposée dans une boîte publique');
  assert.match(fake.issues[0].body, /captures d'écran n'ont pas été envoyées : cette boîte à commentaires est publique/);
  await quiet(page);
  await done(ctx);
});

test('« tout effacer » garde la connexion à Claude, et le dit', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const ctx = await openApp({ setup: (context) => fake.install(context) });
  const { page } = ctx;
  await connect(page, fake);
  await addOperation(page, { mode: 'income', amount: '1200', label: 'Salaire' });
  await page.evaluate(() => window.monBudget.open('backup'));
  await page.locator('[data-screen="backup"] [data-action="wipe"]').click();
  assert.match(await page.locator('.dialog').innerText(), /Seront gardés : la connexion à Claude\./);
  await answer(page, true);
  await answer(page, true);
  await page.waitForSelector('.sheet [data-action="start-later"]');
  await settled(page);
  assert.equal((await readState(page)).operations.length, 0);
  assert.deepEqual(await page.evaluate(() => [window.monBudget.claude.connected, window.monBudget.claude.info.repo]), [true, REPO]);
  await page.locator('.sheet [data-action="start-later"]').click();
  await noOverlay(page);
  await done(ctx);
});
