// L'outil de Claude pour lire les commentaires et y répondre (tools/commentaires.mjs), essayé
// contre le faux GitHub : exactement ce que l'appli y dépose, relu depuis l'ordinateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryAdapter } from '../../www/js/data/db.js';
import { Store } from '../../www/js/data/store.js';
import { createClaudeLink } from '../../www/js/data/claude-link.js';
import { makeBugReport } from '../../www/js/core/schema.js';
import { Draft } from '../../www/js/core/changeset.js';
import { commentStatus } from '../../www/js/core/comments.js';
import { CONFIG_FILE, describe, readConfig, resolveToken, run, splitBody } from '../../tools/commentaires.mjs';
import { createFakeGithub, FAKE_TOKEN } from '../fake-github.js';

const REPO = 'moi/mon-budget-commentaires';
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DAwMDAxAADAA0GAQPdvZd0AAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));

/** Une appli (sans écran) connectée au faux GitHub, et l'outil de Claude branché sur le même. */
async function world() {
  const fake = createFakeGithub({ repo: REPO });
  const store = await new Store(new MemoryAdapter()).init();
  const link = createClaudeLink(store, { fetchImpl: (...args) => fake.fetch(...args) });
  assert.equal((await link.connect({ repo: REPO, token: FAKE_TOKEN })).ok, true);
  const root = mkdtempSync(join(tmpdir(), 'mon-budget-outil-'));
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ commentaires: REPO }));

  const write = async (fields, { photo = false } = {}) => {
    const draft = new Draft(store.state);
    const photoIds = [];
    if (photo) {
      const record = await store.saveBlob(PNG, { kind: 'bug', name: 'capture.png', mime: 'image/png' });
      draft.put('files', record);
      photoIds.push(record.id);
    }
    const report = makeBugReport({ screen: 'stats', appVersion: '2.1.0', diagnostics: 'Mon Budget 2.1.0\nFiches : operations=12', photoIds, ...fields });
    draft.put('bugReports', report);
    await store.commit(draft.cs, { undoable: false });
    assert.equal((await link.send(report.id)).ok, true);
    return report.id;
  };
  /** Lance l'outil comme le ferait Claude ; renvoie ce qu'il affiche. */
  const tool = async (...argv) => {
    const out = [];
    const err = [];
    const code = await run(argv, { env: { MON_BUDGET_JETON: FAKE_TOKEN }, root, log: (line) => out.push(line), fail: (line) => err.push(line), fetchImpl: (...args) => fake.fetch(...args), gh: false });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const status = (id) => commentStatus(store.state.bugReports.find((r) => r.id === id));
  return { fake, store, link, root, write, tool, status };
}

test('lire : les commentaires à traiter, du plus ancien au plus récent, captures téléchargées', async () => {
  const { write, tool, root, fake } = await world();
  const first = await write({ kind: 'bug', text: 'Le total du mois est faux.\nIl manque le loyer.', steps: "J'ai changé de période." }, { photo: true });
  await write({ kind: 'idee', text: 'Un bouton pour dupliquer une enveloppe.', screen: 'envelopes' });
  const result = await tool('lire');
  assert.equal(result.code, 0);
  assert.match(result.out, /^2 commentaires dans moi\/mon-budget-commentaires, dont 2 à traiter\./);
  assert.ok(result.out.indexOf('n° 1 · Problème · écran Stats · version 2.1.0') < result.out.indexOf('n° 2 · Idée · écran Enveloppes'), 'ordre de traitement');
  assert.match(result.out, /Le total du mois est faux\.\nIl manque le loyer\./);
  assert.match(result.out, /\*\*Juste avant\*\*\n\nJ'ai changé de période\./);
  assert.match(result.out, /Captures : commentaires\/n-1\/capture-1\.png/);
  assert.ok(!result.out.includes('operations=12'), 'le diagnostic technique ne noie pas la liste');
  assert.ok(!result.out.includes(FAKE_TOKEN));
  assert.deepEqual(new Uint8Array(readFileSync(join(root, 'commentaires', 'n-1', 'capture-1.png'))), PNG, 'la capture est arrivée intacte');

  // sortie exploitable par un programme
  const json = JSON.parse((await tool('lire', '--json')).out);
  assert.deepEqual(json.map((item) => [item.number, item.kind, item.screen, item.version, item.waitingFor, item.fromApp]), [[1, 'bug', 'stats', '2.1.0', 'claude', true], [2, 'idee', 'envelopes', '2.1.0', 'claude', true]]);
  assert.equal(json[0].id, first);
  assert.equal(json[0].diagnostics, 'Mon Budget 2.1.0\nFiches : operations=12');
  assert.deepEqual(json[0].files, ['commentaires/n-1/capture-1.png']);

  // Le nom du fichier écrit ne dépend jamais du chemin annoncé dans le commentaire : toujours
  // commentaires/n-<numéro>/capture-<rang>, même si ce chemin est inhabituel…
  fake.issues[1].body = fake.issues[1].body.replace('"captures":[]', '"captures":["ailleurs/sous-dossier/image.png","../../../hors-du-projet.png"]');
  fake.files.set('ailleurs/sous-dossier/image.png', PNG);
  const tricky = await tool('lire');
  assert.equal(tricky.code, 0);
  assert.ok(existsSync(join(root, 'commentaires', 'n-2', 'capture-1.png')));
  assert.ok(!existsSync(join(root, 'commentaires', 'n-2', 'ailleurs')));
  // … ou carrément piégé : la capture est signalée illisible, et rien n'est écrit hors du dossier
  assert.match(tricky.out, /\(capture 2 illisible : /);
  assert.ok(!existsSync(join(root, 'commentaires', 'n-2', 'capture-2.png')));
  assert.ok(!existsSync(join(root, 'hors-du-projet.png')) && !existsSync(join(root, '..', 'hors-du-projet.png')));
});

test('répondre, clore, rouvrir : l’appli voit la réponse de Claude, puis « traité »', async () => {
  const { write, tool, link, status, store } = await world();
  const id = await write({ kind: 'question', text: 'À quoi sert « Elle a eu lieu » ?' });
  assert.equal(status(id), 'sent');

  const answer = await tool('repondre', '1', 'Ce bouton confirme une prévision :', 'elle devient une vraie opération.');
  assert.deepEqual([answer.code, answer.out], [0, 'Réponse envoyée au commentaire n° 1.']);
  await link.sync({ force: true });
  assert.equal(status(id), 'answered');
  const report = store.state.bugReports.find((r) => r.id === id);
  assert.deepEqual(report.remote.thread.map((m) => [m.from, m.text]), [['claude', 'Ce bouton confirme une prévision : elle devient une vraie opération.']]);

  // l'utilisateur répond dans l'appli : l'outil voit que c'est de nouveau à Claude de jouer
  await link.markSeen(id);
  await link.reply(id, "D'accord, mais où est-il ?");
  const seen = await tool('voir', '1');
  assert.match(seen.out, /\[Claude, \d{2}-\d{2}-\d{4}\] Ce bouton confirme/);
  assert.match(seen.out, /\[utilisateur, \d{2}-\d{2}-\d{4}\] D'accord, mais où est-il \?/);
  assert.match(seen.out, /→ à traiter/);
  assert.match(seen.out, /Informations techniques :\nMon Budget 2\.1\.0/);

  const closed = await tool('clore', 'n°1', 'Il est dans la fiche de la prévision. Corrigé dans la version 2.1.1.');
  assert.deepEqual([closed.code, closed.out], [0, 'Réponse envoyée, commentaire n° 1 marqué « traité ».']);
  await link.sync({ force: true });
  await link.markSeen(id);
  assert.equal(status(id), 'done');
  assert.equal((await tool('lire')).out, `Aucun commentaire à traiter dans ${REPO}.`);
  assert.match((await tool('lire', '--tous')).out, /n° 1 · Question · écran Stats · version 2\.1\.0 · \d{2}-\d{2}-\d{4} · traité/);

  assert.equal((await tool('rouvrir', '1')).out, 'Commentaire n° 1 remis « à traiter ».');
  await link.sync({ force: true });
  assert.equal(status(id), 'talking');
});

test('un commentaire écrit directement sur GitHub (hors de l’appli) est lu quand même', async () => {
  const { tool, fake } = await world();
  await fake.fetch(`https://api.github.com/repos/${REPO}/issues`, { method: 'POST', headers: { Authorization: `Bearer ${FAKE_TOKEN}` }, body: JSON.stringify({ title: 'Note rapide', body: 'Penser au thème sombre des graphiques.' }) });
  const json = JSON.parse((await tool('lire', '--json')).out);
  assert.deepEqual([json[0].fromApp, json[0].kind, json[0].kindLabel, json[0].text, json[0].waitingFor], [false, null, "Écrit hors de l'appli", 'Penser au thème sombre des graphiques.', 'claude']);
});

test('erreurs : réglage manquant, jeton absent, numéro ou texte oublié, panne — un message clair, rien d’autre', async () => {
  const { tool, root, fake } = await world();
  const bare = async (argv, { env = {}, at = root } = {}) => {
    const err = [];
    const code = await run(argv, { env, root: at, log: () => {}, fail: (line) => err.push(line), fetchImpl: (...args) => fake.fetch(...args), gh: false });
    return { code, err: err.join('\n') };
  };
  assert.match((await tool()).err, /^Usage : node tools\/commentaires\.mjs lire/);
  assert.equal((await tool('supprimer', '1')).code, 1);
  assert.match((await bare(['lire'])).err, /Aucun jeton d'accès trouvé/);
  const empty = mkdtempSync(join(tmpdir(), 'mon-budget-vide-'));
  assert.match((await bare(['lire'], { env: { MON_BUDGET_JETON: FAKE_TOKEN }, at: empty })).err, /n'est pas réglée : indique son adresse dans mon-budget\.config\.json/);
  // l'adresse peut aussi venir de l'environnement, sans fichier de réglages
  assert.equal((await bare(['lire'], { env: { MON_BUDGET_JETON: FAKE_TOKEN, MON_BUDGET_COMMENTAIRES: REPO }, at: empty })).code, 0);
  writeFileSync(join(empty, CONFIG_FILE), '{ pas du json');
  assert.match((await bare(['lire'], { env: { MON_BUDGET_JETON: FAKE_TOKEN }, at: empty })).err, /illisible/);

  assert.match((await tool('voir')).err, /numéro du commentaire/);
  assert.match((await tool('voir', 'douze')).err, /numéro du commentaire/);
  assert.match((await tool('repondre', '1')).err, /texte de la réponse entre guillemets/);
  assert.match((await tool('voir', '42')).err, /introuvable/);
  assert.match((await bare(['lire'], { env: { MON_BUDGET_JETON: 'github_pat_mauvais_jeton_000000000000' } })).err, /jeton d'accès est refusé/);
  fake.offline = true;
  const offline = await tool('lire');
  assert.deepEqual([offline.code, offline.err], [1, 'Pas de connexion à internet.']);
});

test('petits morceaux : réglages, jeton, découpage du texte', () => {
  assert.deepEqual(readConfig(mkdtempSync(join(tmpdir(), 'mon-budget-conf-'))), {});
  assert.equal(resolveToken({ MON_BUDGET_JETON: ' abc ', GH_TOKEN: 'def' }, { gh: false }), 'abc');
  assert.equal(resolveToken({ GH_TOKEN: 'def', GITHUB_TOKEN: 'ghi' }, { gh: false }), 'def');
  assert.equal(resolveToken({ GITHUB_TOKEN: 'ghi' }, { gh: false }), 'ghi');
  assert.equal(resolveToken({ MON_BUDGET_JETON: '   ' }, { gh: false }), null);
  const body = '**Problème** — écran « Stats » — Mon Budget 2.1.0\n\nTexte.\n\n<details><summary>Informations techniques</summary>\n\n````text\nDiag\nligne 2\n````\n\n</details>\n\n<!-- mon-budget {"id":"bug_a","kind":"bug"} -->';
  assert.deepEqual(splitBody(body), { text: 'Texte.', diagnostics: 'Diag\nligne 2' });
  assert.deepEqual(splitBody('Texte libre'), { text: 'Texte libre', diagnostics: '' });
  const item = describe({ number: 3, title: 't', body, state: 'open', url: 'u', createdAt: 'c', updatedAt: 'm' }, [{ id: 1, body: 'Réponse', createdAt: '2026-11-15T10:00:00Z' }]);
  assert.deepEqual([item.id, item.kindLabel, item.waitingFor, item.thread.length], ['bug_a', 'Problème', 'utilisateur', 1]);
  assert.equal(describe({ number: 3, title: 't', body, state: 'closed', url: 'u' }, []).waitingFor, 'personne');
});
