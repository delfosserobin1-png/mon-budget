// Client GitHub (boîte à commentaires) et connexion à Claude : envoi, file d'attente, réponses.
// Tout passe par un faux GitHub en mémoire (tests/fake-github.js) : aucun accès à internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../../www/js/data/db.js';
import { Store } from '../../www/js/data/store.js';
import { createGithubClient, GithubError, toBase64 } from '../../www/js/io/github.js';
import { createClaudeLink, LINK_KEY, SYNC_EVERY_MS } from '../../www/js/data/claude-link.js';
import { buildBackupJson } from '../../www/js/data/backup.js';
import { makeBugReport } from '../../www/js/core/schema.js';
import { Draft } from '../../www/js/core/changeset.js';
import { commentStatus, parseMarker, unreadTotal } from '../../www/js/core/comments.js';
import { createFakeGithub, FAKE_TOKEN } from '../fake-github.js';

const REPO = 'moi/mon-budget-commentaires';
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxAADAA0GAQPdvZd0AAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));

const clientFor = (fake, token = FAKE_TOKEN) => createGithubClient({ repo: fake.repo, token, fetchImpl: fake.fetch });

async function setup({ fake = createFakeGithub({ repo: REPO }), connect = true } = {}) {
  const store = await new Store(new MemoryAdapter()).init();
  let online = true;
  // (appel indirect : un test peut ainsi remplacer fake.fetch pour simuler une coupure)
  const link = createClaudeLink(store, { fetchImpl: (...args) => fake.fetch(...args), online: () => online });
  if (connect) assert.equal((await link.connect({ repo: REPO, token: FAKE_TOKEN })).ok, true);
  const addComment = async (fields = {}, { photo = false } = {}) => {
    const draft = new Draft(store.state);
    const photoIds = [];
    if (photo) {
      const record = await store.saveBlob(PNG, { kind: 'bug', name: 'capture.png', mime: 'image/png' });
      draft.put('files', record);
      photoIds.push(record.id);
    }
    const report = makeBugReport({ text: "Le solde de l'enveloppe ne bouge pas.", screen: 'envelopes', appVersion: '2.1.0', diagnostics: 'Mon Budget 2.1.0', photoIds, ...fields });
    draft.put('bugReports', report);
    await store.commit(draft.cs, { undoable: false });
    return report.id;
  };
  const get = (id) => store.state.bugReports.find((r) => r.id === id);
  return { store, link, fake, addComment, get, setOnline: (value) => (online = value) };
}

// ---------------------------------------------------------------------------------------------
// Le client
// ---------------------------------------------------------------------------------------------

test('client : vérification de la boîte, jeton dans l’en-tête seulement', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const info = await clientFor(fake).check();
  assert.deepEqual(info, { fullName: REPO, private: true, issuesEnabled: true, owner: 'moi', defaultBranch: 'main', webUrl: `https://github.com/${REPO}` });
  assert.deepEqual(fake.requests.map((r) => `${r.method} ${r.path}`), [`GET /repos/${REPO}`, `GET /repos/${REPO}/issues?per_page=1&state=all`]);
  for (const request of fake.requests) {
    assert.equal(request.auth, `Bearer ${FAKE_TOKEN}`);
    assert.ok(!request.path.includes(FAKE_TOKEN), 'le jeton ne figure jamais dans une adresse');
  }
});

test('client : créer, lister, lire, répondre, clore et rouvrir une issue', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const client = clientFor(fake);
  const first = await client.createIssue({ title: '[Problème] Un', body: 'Corps un', labels: ['mon-budget'] });
  const second = await client.createIssue({ title: '[Idée] Deux', body: 'Corps deux' });
  assert.deepEqual([first.number, second.number], [1, 2]);
  assert.equal(first.url, `https://github.com/${REPO}/issues/1`);
  const old = new Date(fake.clock - 3600 * 1000).toISOString();
  fake.issues.push({ number: 99, title: 'PR', body: '', state: 'open', labels: [], created_at: old, updated_at: old, closed_at: null, comments: [], pull: true });

  const open = await client.listIssues();
  assert.deepEqual(open.map((i) => i.number), [2, 1], 'les plus récemment modifiées d’abord, sans les « pull requests »');
  assert.deepEqual(open[1].labels, ['mon-budget']);

  const created = await client.addComment(1, 'De quel écran parles-tu ?');
  assert.ok(created.id && created.createdAt);
  assert.deepEqual((await client.listComments(1)).map((c) => c.body), ['De quel écran parles-tu ?']);
  assert.equal((await client.getIssue(1)).comments, 1);

  assert.equal((await client.setIssueState(1, 'closed')).state, 'closed');
  assert.deepEqual((await client.listIssues()).map((i) => i.number), [2]);
  assert.deepEqual((await client.listIssues({ state: 'all' })).map((i) => i.number), [1, 2]);
  const since = fake.issues[0].updated_at;
  assert.deepEqual((await client.listIssues({ state: 'all', since })).map((i) => i.number), [1], 'seulement ce qui a bougé depuis');
  assert.equal((await client.setIssueState(1, 'open')).state, 'open');
});

test('client : plus de cent messages sont lus page après page', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const client = clientFor(fake);
  await client.createIssue({ title: 'Long fil', body: '' });
  for (let i = 0; i < 205; i++) fake.claudeReplies(1, `Message ${i}`);
  const comments = await client.listComments(1);
  assert.equal(comments.length, 205);
  assert.equal(comments[204].body, 'Message 204');
});

test('client : dépôt et relecture d’un fichier, octet pour octet ; un fichier déjà déposé n’est pas une erreur', async () => {
  const fake = createFakeGithub({ repo: REPO });
  const client = clientFor(fake);
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
  assert.deepEqual(await client.uploadFile('captures/bug_x-1.jpg', bytes, 'Capture'), { path: 'captures/bug_x-1.jpg' });
  assert.deepEqual(fake.files.get('captures/bug_x-1.jpg'), bytes);
  assert.deepEqual(await client.downloadFile('captures/bug_x-1.jpg'), bytes);
  assert.deepEqual(await client.uploadFile('captures/bug_x-1.jpg', bytes, 'Capture'), { path: 'captures/bug_x-1.jpg' }, 'second dépôt du même fichier : considéré comme fait');
  assert.equal(toBase64(new Uint8Array([77, 97, 110])), 'TWFu');
  await assert.rejects(client.downloadFile('captures/absent.jpg'), (error) => error.code === 'missing');
});

test('client : chaque refus devient une explication en français, sans jamais citer le jeton', async () => {
  const cases = [
    [401, 'auth', /jeton d'accès est refusé/],
    [403, 'forbidden', /autorisations « Issues » et « Contents »/],
    [404, 'missing', /introuvable/],
    [422, 'invalid', /a refusé la demande/],
    [500, 'server', /momentanément indisponible/],
    [418, 'unknown', /a échoué/],
  ];
  for (const [status, code, pattern] of cases) {
    const fake = createFakeGithub({ repo: REPO });
    fake.failNext(() => true, status, { message: `détail ${FAKE_TOKEN.slice(0, 6)}` });
    await assert.rejects(clientFor(fake).createIssue({ title: 't', body: 'b' }), (error) => {
      assert.ok(error instanceof GithubError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.match(error.message, pattern);
      assert.ok(!error.message.includes(FAKE_TOKEN));
      return true;
    });
  }
  // trop de demandes : 403 ou 429 avec le compteur à zéro
  for (const [status, headers, message] of [[403, { 'x-ratelimit-remaining': '0' }, 'API rate limit exceeded'], [429, {}, 'Too many'], [403, { 'retry-after': '60' }, 'secondary']]) {
    const fake = createFakeGithub({ repo: REPO });
    fake.failNext(() => true, status, { message, headers });
    await assert.rejects(clientFor(fake).listIssues(), (error) => error.code === 'rate' && error.temporary === true);
  }
  // pas de réseau du tout
  const fake = createFakeGithub({ repo: REPO });
  fake.offline = true;
  await assert.rejects(clientFor(fake).check(), (error) => error.code === 'offline' && error.temporary && /Pas de connexion/.test(error.message));
  // mauvais jeton : c'est le faux GitHub lui-même qui refuse
  await assert.rejects(clientFor(createFakeGithub({ repo: REPO }), 'github_pat_mauvais_jeton_0000000000').check(), (error) => error.code === 'auth' && !error.temporary);
});

// ---------------------------------------------------------------------------------------------
// La connexion à Claude
// ---------------------------------------------------------------------------------------------

test('connexion : boîte privée acceptée ; boîte publique, jeton refusé ou issues désactivées expliqués', async () => {
  const { store, link } = await setup({ connect: false });
  assert.equal(link.connected, false);
  assert.equal(link.info, null);
  assert.equal((await link.connect({ repo: REPO, token: 'github_pat_mauvais_jeton_0000000000' })).code, 'auth');
  assert.equal((await link.connect({ repo: 'moi/autre-boite', token: FAKE_TOKEN })).code, 'missing');
  assert.equal(link.connected, false, 'rien n’est enregistré tant que la vérification échoue');

  const ok = await link.connect({ repo: 'MOI/Mon-Budget-Commentaires', token: FAKE_TOKEN });
  assert.equal(ok.ok, true);
  assert.equal(link.connected, true);
  assert.equal(link.info.repo, REPO, 'l’adresse retenue est celle que GitHub renvoie');
  assert.equal(link.info.private, true);
  assert.ok(!('token' in link.info), 'le jeton n’est jamais exposé à l’interface');
  assert.equal(store.setting(LINK_KEY).token, FAKE_TOKEN);
  // les réglages (donc le jeton) ne font pas partie d'une sauvegarde exportée
  assert.ok(!buildBackupJson(store, { appVersion: '2.1.0' }).includes(FAKE_TOKEN));

  await link.disconnect();
  assert.equal(link.connected, false);
  assert.equal(store.setting(LINK_KEY, null), null);

  const open = await setup({ fake: createFakeGithub({ repo: REPO, isPrivate: false }), connect: false });
  const refused = await open.link.connect({ repo: REPO, token: FAKE_TOKEN });
  assert.deepEqual([refused.ok, refused.code], [false, 'public']);
  assert.equal(open.link.connected, false);
  assert.equal((await open.link.connect({ repo: REPO, token: FAKE_TOKEN, allowPublic: true })).ok, true);
  assert.equal(open.link.info.private, false);

  const noIssues = await setup({ fake: createFakeGithub({ repo: REPO, issuesEnabled: false }), connect: false });
  assert.equal((await noIssues.link.connect({ repo: REPO, token: FAKE_TOKEN })).code, 'issues');
});

test('envoi : le commentaire devient une issue, la capture est déposée, la fiche garde son numéro', async () => {
  const { link, fake, addComment, get } = await setup();
  const id = await addComment({ kind: 'idee', steps: '' }, { photo: true });
  const result = await link.send(id);
  assert.deepEqual([result.ok, result.number], [true, 1]);
  const issue = fake.issues[0];
  assert.equal(issue.title, "[Idée] Le solde de l'enveloppe ne bouge pas.");
  assert.deepEqual(issue.labels, ['mon-budget', 'idée']);
  const marker = parseMarker(issue.body);
  assert.equal(marker.id, id);
  assert.deepEqual(marker.captures, [`captures/${id}-1.png`]);
  assert.deepEqual(fake.files.get(`captures/${id}-1.png`), PNG, 'la capture arrive intacte');
  const report = get(id);
  assert.deepEqual([report.queued, report.remote.number, report.remote.state, !!report.sentAt], [false, 1, 'open', true]);
  assert.equal(commentStatus(report), 'sent');
  assert.deepEqual(await link.send(id), { ok: true, number: 1, already: true }, 'un second appui ne renvoie rien');
  assert.equal(fake.issues.length, 1);
});

test('envoi : deux appuis en même temps ne créent qu’une issue', async () => {
  const { link, fake, addComment } = await setup();
  const id = await addComment();
  const [a, b] = await Promise.all([link.send(id), link.send(id)]);
  assert.deepEqual([a.ok, b.ok, fake.issues.length], [true, true, 1]);
});

test('hors connexion : le commentaire attend, puis part tout seul, une seule fois', async () => {
  const { link, fake, addComment, get, setOnline } = await setup();
  const id = await addComment();
  fake.offline = true;
  const failed = await link.send(id);
  assert.deepEqual([failed.ok, failed.queued, failed.code], [false, true, 'offline']);
  assert.equal(commentStatus(get(id)), 'queued');
  assert.match(link.status.lastError, /Pas de connexion/);

  setOnline(false);
  assert.deepEqual(await link.sync({ force: true }), { ok: false, code: 'offline', error: 'Pas de connexion à internet.' });
  setOnline(true);
  fake.offline = false;
  const sync = await link.sync({ force: true });
  assert.deepEqual([sync.ok, sync.sent], [true, 1]);
  assert.equal(get(id).remote.number, 1);
  assert.equal(link.status.lastError, '');
  assert.equal((await link.sync({ force: true })).sent, 0);
  assert.equal(fake.issues.length, 1);
});

test('coupure juste après l’envoi : à la reprise, le commentaire déjà arrivé est retrouvé, pas dupliqué', async () => {
  const { link, fake, addComment, get } = await setup();
  const id = await addComment();
  // l'issue est bien créée chez GitHub, mais la réponse n'arrive jamais jusqu'au téléphone
  const realFetch = fake.fetch;
  let cut = true;
  fake.fetch = async (url, init = {}) => {
    const response = await realFetch(url, init);
    if (cut && init.method === 'POST' && String(url).endsWith('/issues')) {
      cut = false;
      throw new TypeError('connexion coupée');
    }
    return response;
  };
  const first = await link.send(id);
  assert.deepEqual([first.ok, first.queued, first.code], [false, true, 'offline']);
  assert.equal(fake.issues.length, 1, 'le commentaire est arrivé malgré la coupure');
  assert.equal(get(id).remote, null, "mais l'appli ne le sait pas encore");
  assert.equal(commentStatus(get(id)), 'queued');
  const second = await link.send(id);
  assert.deepEqual([second.ok, second.number], [true, 1]);
  assert.equal(fake.issues.length, 1, 'pas de doublon');
  assert.equal(get(id).remote.number, 1);
});

test('captures : jamais envoyées vers une boîte publique ; un droit manquant n’empêche pas le texte de partir', async () => {
  const open = await setup({ fake: createFakeGithub({ repo: REPO, isPrivate: false }), connect: false });
  await open.link.connect({ repo: REPO, token: FAKE_TOKEN, allowPublic: true });
  const id = await open.addComment({}, { photo: true });
  assert.equal((await open.link.send(id)).ok, true);
  assert.equal(open.fake.files.size, 0, 'aucun fichier déposé dans une boîte publique');
  assert.match(open.fake.issues[0].body, /captures d'écran n'ont pas été envoyées : cette boîte à commentaires est publique/);
  assert.deepEqual(parseMarker(open.fake.issues[0].body).captures, []);

  const { link, fake, addComment } = await setup();
  fake.failNext((method, path) => method === 'PUT' && path.includes('/contents/'), 403, { message: 'Resource not accessible by personal access token' });
  const other = await addComment({}, { photo: true });
  assert.equal((await link.send(other)).ok, true);
  assert.equal(fake.files.size, 0);
  assert.match(fake.issues[0].body, /Capture 1 non envoyée : le jeton n'a pas l'autorisation « Contents »/);

  // une panne passagère pendant le dépôt d'une capture : tout est reporté, rien n'est créé à moitié
  fake.failNext((method, path) => method === 'PUT' && path.includes('/contents/'), 503);
  const third = await addComment({}, { photo: true });
  const failed = await link.send(third);
  assert.deepEqual([failed.ok, failed.queued, failed.code, fake.issues.length], [false, true, 'server', 1]);
  assert.equal((await link.sync({ force: true })).sent, 1);
  assert.equal(fake.issues.length, 2);
  assert.equal(fake.files.size, 1);
});

test('jeton expiré : le commentaire attend, l’erreur est claire, et tout repart après reconnexion', async () => {
  const { link, fake, addComment, get } = await setup();
  const id = await addComment();
  fake.token = 'github_pat_NOUVEAU_jeton_00000000000000000000';
  const failed = await link.send(id);
  assert.deepEqual([failed.ok, failed.queued, failed.code], [false, true, 'auth']);
  assert.match(failed.error, /expiré ou été supprimé/);
  assert.equal((await link.sync({ force: true })).ok, false);
  assert.equal((await link.connect({ repo: REPO, token: fake.token })).ok, true);
  assert.equal((await link.sync({ force: true })).sent, 1);
  assert.equal(get(id).remote.number, 1);
});

test('réponses de Claude : relevées, comptées comme non lues, puis lues ; « traité » quand Claude clôt', async () => {
  const { store, link, fake, addComment, get } = await setup();
  const id = await addComment();
  const other = await addComment({ text: 'Autre sujet' });
  await link.send(id);
  await link.send(other);
  assert.deepEqual(await link.sync({ force: true }), { ok: true, sent: 0, updated: 0, newReplies: 0 });
  assert.ok(store.setting(LINK_KEY).lastPullAt, 'la date de la dernière relève est retenue');

  fake.claudeReplies(1, 'De quel écran parles-tu ?');
  const sync = await link.sync({ force: true });
  assert.deepEqual([sync.ok, sync.updated, sync.newReplies], [true, 1, 1]);
  assert.equal(commentStatus(get(id)), 'answered');
  assert.equal(commentStatus(get(other)), 'sent');
  assert.equal(unreadTotal(store.state), 1);
  assert.deepEqual(get(id).remote.thread.map((m) => [m.from, m.text]), [['claude', 'De quel écran parles-tu ?']]);
  const lastRequests = fake.requests.slice(-2).map((r) => r.path);
  assert.match(lastRequests[0], /\/issues\?state=all&per_page=100&page=1&sort=updated&direction=desc&since=/, 'seules les issues modifiées depuis la dernière relève sont demandées');
  assert.match(lastRequests[1], /\/issues\/1\/comments/);

  await link.markSeen(id);
  assert.equal(commentStatus(get(id)), 'talking');
  assert.equal(unreadTotal(store.state), 0);

  // l'utilisateur répond dans le fil : son message est reconnu comme le sien à la relève suivante
  const reply = await link.reply(id, '  Sur la fiche Vacances.  ');
  assert.equal(reply.ok, true);
  assert.deepEqual(get(id).remote.thread.map((m) => m.from), ['claude', 'moi']);
  assert.match(fake.issues[0].comments[1].body, /^Sur la fiche Vacances\.\n\n<!-- mon-budget:suite -->$/);
  await link.sync({ force: true });
  assert.deepEqual(get(id).remote.thread.map((m) => [m.from, m.text]), [['claude', 'De quel écran parles-tu ?'], ['moi', 'Sur la fiche Vacances.']]);
  assert.equal(unreadTotal(store.state), 0, 'sa propre réponse ne compte pas comme une réponse de Claude');

  fake.claudeReplies(1, 'Corrigé dans la version 2.1.1.');
  fake.claudeCloses(1);
  assert.equal((await link.sync({ force: true })).newReplies, 1);
  assert.equal(commentStatus(get(id)), 'answered');
  await link.markSeen(id);
  assert.equal(commentStatus(get(id)), 'done');

  // répondre à un commentaire traité le rouvre, ici comme chez GitHub
  assert.equal((await link.reply(id, 'Ça ne marche toujours pas.')).ok, true);
  assert.equal(fake.issues[0].state, 'open');
  assert.equal(get(id).remote.state, 'open');
  assert.equal((await link.reply(id, '   ')).code, 'empty');
  const unsent = await addComment({ text: 'Pas encore envoyé' });
  assert.equal((await link.reply(unsent, 'Bonjour')).ok, false);
});

test('relève de fond : pas plus d’une fois toutes les dix minutes, sauf demande expresse', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-15T10:00:00Z') });
  const { link, fake, addComment } = await setup();
  await link.send(await addComment());
  assert.equal((await link.sync()).ok, true);
  const before = fake.requests.length;
  assert.deepEqual(await link.sync(), { ok: true, skipped: true, sent: 0, updated: 0 });
  assert.equal(fake.requests.length, before, 'aucune demande pendant le délai');
  t.mock.timers.tick(SYNC_EVERY_MS + 1000);
  assert.equal((await link.sync()).skipped, undefined);
  assert.ok(fake.requests.length > before);
  const forced = fake.requests.length;
  await link.sync({ force: true });
  assert.ok(fake.requests.length > forced, 'une demande expresse passe toujours');
});

test('déconnecté : plus aucun échange, les commentaires restent dans l’appli', async () => {
  const { link, fake, addComment, get } = await setup();
  const id = await addComment();
  await link.disconnect();
  const before = fake.requests.length;
  assert.equal((await link.send(id)).code, 'not-connected');
  assert.equal((await link.sync({ force: true })).code, 'not-connected');
  assert.equal(fake.requests.length, before);
  assert.equal(commentStatus(get(id)), 'local');
  assert.equal((await link.send('bug_inconnu')).code, 'gone');
});

test('les écrans sont prévenus des changements de la connexion', async () => {
  const { link, addComment } = await setup({ connect: false });
  let calls = 0;
  const off = link.onChange(() => calls++);
  await link.connect({ repo: REPO, token: FAKE_TOKEN });
  assert.equal(calls, 1);
  await link.send(await addComment());
  assert.ok(calls >= 2);
  off();
  const frozen = calls;
  await link.disconnect();
  assert.equal(calls, frozen);
});
