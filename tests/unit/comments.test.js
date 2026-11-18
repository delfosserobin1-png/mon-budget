// Commentaires pour Claude : mise en forme de ce qui est envoyé, lecture de ce qui revient,
// statuts et lots de modifications. Logique pure, sans réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyState, makeBugReport, makeOperation } from '../../www/js/core/schema.js';
import { apply, cloneState, isEmpty } from '../../www/js/core/changeset.js';
import { exportData, readImport } from '../../www/js/core/portable.js';
import {
  COMMENT_KINDS,
  STATUS_LABELS,
  cleanMessage,
  commentBody,
  commentStatus,
  commentTitle,
  followUpBody,
  isFollowUp,
  isToken,
  kindLabel,
  parseLinkCode,
  parseMarker,
  parseRepo,
  planCommentSent,
  planFollowUp,
  planQueueComment,
  planRemoteUpdate,
  planRepliesSeen,
  queuedComments,
  screenLabel,
  targetText,
  threadFromRemote,
  unreadReplies,
  unreadTotal,
} from '../../www/js/core/comments.js';
import { CHANGES, changesSince, compareVersions } from '../../www/js/changelog.js';

const TOKEN = 'github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

function stateWith(...reports) {
  const state = emptyState();
  state.bugReports = reports.map((r) => makeBugReport(r));
  return state;
}
const commit = (state, plan) => {
  assert.equal(plan.ok, true, JSON.stringify(plan.errors));
  return apply(cloneState(state), plan.cs);
};
const report = (fields = {}) => ({ id: 'bug_test00000001', text: "Le solde de l'enveloppe Vacances ne bouge pas.", screen: 'envelopes', appVersion: '2.1.0', createdAt: '2026-11-15T09:30:00.000Z', ...fields });

test('adresse de la boîte : toutes les façons de l’écrire sont comprises, le reste est refusé', () => {
  assert.equal(parseRepo('moi/mon-budget-commentaires'), 'moi/mon-budget-commentaires');
  assert.equal(parseRepo('  https://github.com/Moi-2/Ma.Boite_1/  '), 'Moi-2/Ma.Boite_1');
  assert.equal(parseRepo('github.com/moi/boite.git'), 'moi/boite');
  assert.equal(parseRepo('http://www.github.com/moi/boite'), 'moi/boite');
  for (const bad of ['', 'moi', 'moi/', '/boite', 'moi/boite/issues', 'moi boite', '-moi/boite', 'moi/..', 'moi/bo ite', null, undefined, 42]) {
    assert.equal(parseRepo(bad), null, `refusé : ${bad}`);
  }
});

test('code de connexion collé d’un bloc : adresse et jeton sont séparés', () => {
  assert.deepEqual(parseLinkCode(`moi/boite:${TOKEN}`), { repo: 'moi/boite', token: TOKEN });
  assert.deepEqual(parseLinkCode(`https://github.com/moi/boite : ${TOKEN}`), { repo: 'moi/boite', token: TOKEN });
  assert.deepEqual(parseLinkCode(`moi/boite ${TOKEN}\n`), { repo: 'moi/boite', token: TOKEN });
  assert.deepEqual(parseLinkCode(`moi/boite#${TOKEN}`), { repo: 'moi/boite', token: TOKEN });
  assert.deepEqual(parseLinkCode(JSON.stringify({ depot: 'moi/boite', jeton: TOKEN })), { repo: 'moi/boite', token: TOKEN });
  assert.deepEqual(parseLinkCode(JSON.stringify({ repo: 'moi/boite', token: TOKEN })), { repo: 'moi/boite', token: TOKEN });
  for (const bad of ['', 'moi/boite', TOKEN, 'moi/boite:court', '{"depot":"moi/boite"}', '{pas du json', `pas une adresse:${TOKEN}`]) {
    assert.equal(parseLinkCode(bad), null, `refusé : ${bad.slice(0, 30)}`);
  }
  assert.equal(isToken(TOKEN), true);
  assert.equal(isToken('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), true);
  assert.equal(isToken('trop court'), false);
  assert.equal(isToken(`${TOKEN} `), true, 'les espaces autour sont tolérés');
  assert.equal(isToken('avec espace au milieu abcdefghij'), false);
});

test('titre de l’envoi : type entre crochets, première ligne, coupée proprement', () => {
  assert.equal(commentTitle(makeBugReport(report())), "[Problème] Le solde de l'enveloppe Vacances ne bouge pas.");
  assert.equal(commentTitle(makeBugReport(report({ kind: 'idee', text: 'Un total par mois\nsur une seule ligne' }))), '[Idée] Un total par mois');
  const long = commentTitle(makeBugReport(report({ kind: 'question', text: 'a'.repeat(200) })));
  assert.ok(long.startsWith('[Question] ') && long.endsWith('…') && long.length <= 11 + 72);
  assert.equal(commentTitle(makeBugReport(report({ text: '   ' }))), '[Problème] Commentaire');
  assert.deepEqual(COMMENT_KINDS.map((k) => k.id), ['bug', 'idee', 'question']);
  assert.equal(kindLabel('inconnu'), 'Problème');
  assert.equal(screenLabel('stats'), 'Stats');
  assert.equal(screenLabel('nimporte'), "Toute l'appli");
});

test('corps de l’envoi : texte, contexte, captures, diagnostic replié, et marqueur relu à l’identique', () => {
  const r = makeBugReport(report({ steps: "J'ai fait Alimenter, 50 euros.", diagnostics: 'Mon Budget 2.1.0\nFiches : operations=12', photoIds: ['fic_a'] }));
  const body = commentBody(r, { attachments: ['captures/bug_test00000001-1.jpg'], notes: ['Capture 2 non envoyée.'] });
  assert.match(body, /^\*\*Problème\*\* — écran « Enveloppes » — Mon Budget 2\.1\.0\n\nLe solde de l'enveloppe Vacances ne bouge pas\./);
  assert.match(body, /\*\*Juste avant\*\*\n\nJ'ai fait Alimenter, 50 euros\./);
  assert.match(body, /\*\*Capture jointe\*\*\n\n- `captures\/bug_test00000001-1\.jpg`/);
  assert.match(body, /_Capture 2 non envoyée\._/);
  assert.match(body, /<details><summary>Informations techniques<\/summary>\n\n````text\nMon Budget 2\.1\.0\nFiches : operations=12\n````/);
  assert.deepEqual(parseMarker(body), { id: 'bug_test00000001', kind: 'bug', screen: 'envelopes', version: '2.1.0', at: '2026-11-15T09:30:00.000Z', captures: ['captures/bug_test00000001-1.jpg'] });
  // sans rien de facultatif : ni section vide, ni bloc de diagnostic
  const bare = commentBody(makeBugReport(report({ kind: 'idee' })));
  assert.ok(!bare.includes('Juste avant') && !bare.includes('Capture') && !bare.includes('<details>'));
  assert.equal(parseMarker(bare).kind, 'idee');
  assert.match(commentBody(makeBugReport(report()), { attachments: ['a', 'b'] }), /\*\*Captures jointes\*\*/);
});

test('corps de l’envoi : un texte piégé ne casse ni le bloc de diagnostic ni le marqueur', () => {
  const fake = '<!-- mon-budget {"id":"bug_usurpe","kind":"bug"} -->';
  const r = makeBugReport(report({ text: `Regarde : ${fake}`, diagnostics: 'avant\n`````\naprès' }));
  const body = commentBody(r);
  assert.equal(parseMarker(body).id, 'bug_test00000001', 'le marqueur écrit par l’appli (le dernier) fait foi');
  assert.equal((body.match(/````/g) || []).length, 2, 'seules les deux bornes du bloc restent');
  assert.equal(parseMarker('rien ici'), null);
  assert.equal(parseMarker('<!-- mon-budget {cassé} -->'), null);
  assert.equal(parseMarker('<!-- mon-budget {"kind":"bug"} -->'), null, 'sans identifiant, ce n’est pas un marqueur');
  assert.equal(parseMarker(null), null);
});

test('le texte envoyé ne contient que le commentaire : jamais les opérations ni les montants', () => {
  const state = emptyState();
  state.operations = [makeOperation({ date: '2026-11-10', amount: -123456, label: 'Loyer TRES SECRET', counterparty: 'Agence Dupont' })];
  const r = makeBugReport(report({ diagnostics: 'Fiches : operations=1' }));
  state.bugReports = [r];
  const sent = commentTitle(r) + commentBody(r);
  assert.ok(!sent.includes('SECRET') && !sent.includes('Dupont') && !sent.includes('123456') && !sent.includes('1234,56'));
});

test('réponses : celles écrites dans l’appli sont reconnues, les autres sont de Claude ; l’ordre est chronologique', () => {
  const mine = followUpBody('  Oui, sur l’écran Enveloppes.  ');
  assert.ok(isFollowUp(mine));
  assert.equal(cleanMessage(mine), 'Oui, sur l’écran Enveloppes.');
  assert.equal(isFollowUp('Bonjour'), false);
  assert.equal(cleanMessage('Ligne 1\r\n\r\n\r\n\r\nLigne 2 <!-- note interne -->'), 'Ligne 1\n\nLigne 2');
  const thread = threadFromRemote([
    { id: 12, body: mine, createdAt: '2026-11-15T12:00:00Z' },
    { id: 11, body: 'De quel écran parles-tu ?', created_at: '2026-11-15T11:00:00Z' },
    { id: 13, body: '   ', createdAt: '2026-11-15T13:00:00Z' },
    { id: 14, body: 'Corrigé dans la version 2.1.1.', createdAt: '2026-11-16T08:00:00Z' },
  ]);
  assert.deepEqual(thread.map((m) => [m.id, m.from]), [['11', 'claude'], ['12', 'moi'], ['14', 'claude']]);
  assert.equal(thread[1].text, 'Oui, sur l’écran Enveloppes.');
  assert.deepEqual(threadFromRemote(null), []);
});

test('statuts : du commentaire tout juste écrit au commentaire traité', () => {
  const statusOf = (fields) => commentStatus(makeBugReport(report(fields)));
  const remote = (extra = {}) => ({ number: 7, url: 'u', state: 'open', thread: [], seen: 0, ...extra });
  const claude = (id) => ({ id, at: '2026-11-15T11:00:00Z', from: 'claude', text: 'Réponse' });
  const me = (id) => ({ id, at: '2026-11-15T12:00:00Z', from: 'moi', text: 'Suite' });
  assert.equal(statusOf({}), 'local');
  assert.equal(statusOf({ sentAt: '2026-11-15T10:00:00Z' }), 'shared');
  assert.equal(statusOf({ queued: true }), 'queued');
  assert.equal(statusOf({ remote: remote() }), 'sent');
  assert.equal(statusOf({ remote: remote({ thread: [claude('1')] }) }), 'answered');
  assert.equal(statusOf({ remote: remote({ thread: [claude('1'), me('2')], seen: 1 }) }), 'talking');
  assert.equal(statusOf({ remote: remote({ state: 'closed', thread: [claude('1')], seen: 1 }) }), 'done');
  assert.equal(statusOf({ remote: remote({ state: 'closed', thread: [claude('1')], seen: 0 }) }), 'answered', 'une réponse non lue passe avant « traité »');
  for (const id of ['local', 'shared', 'queued', 'sent', 'answered', 'talking', 'done']) assert.ok(STATUS_LABELS[id].label && STATUS_LABELS[id].tone, id);

  const state = stateWith(
    report({ id: 'bug_a', remote: remote({ thread: [claude('1'), claude('2')], seen: 0 }) }),
    report({ id: 'bug_b', remote: remote({ number: 8, thread: [claude('3'), me('4')], seen: 1 }) }),
    report({ id: 'bug_c' }),
  );
  assert.equal(unreadReplies(state.bugReports[0]), 2);
  assert.equal(unreadReplies(state.bugReports[1]), 0);
  assert.equal(unreadReplies(state.bugReports[2]), 0);
  assert.equal(unreadTotal(state), 2);
});

test('fiche de commentaire : les anciennes fiches restent valables, le suivi est remis d’équerre', () => {
  const old = makeBugReport({ id: 'bug_ancien', text: 'Ancien signalement', sentAt: '2026-10-01T10:00:00Z' });
  assert.deepEqual([old.kind, old.queued, old.remote], ['bug', false, null]);
  assert.equal(makeBugReport({ kind: 'nimporte' }).kind, 'bug');
  assert.equal(makeBugReport({ remote: { number: 0 } }).remote, null);
  assert.equal(makeBugReport({ remote: { number: '12' } }).remote, null);
  assert.equal(makeBugReport({ remote: 'oui' }).remote, null);
  const tracked = makeBugReport({ queued: true, remote: { number: 12, state: 'bizarre', seen: -3, thread: [{ id: 5, from: 'pirate', text: 'Bonjour' }, { text: '' }, null, { id: '6', from: 'moi', text: 'Moi', at: 'x' }] } });
  assert.equal(tracked.queued, false, 'un commentaire déposé n’est plus « en attente »');
  assert.deepEqual(tracked.remote, { number: 12, url: '', state: 'open', thread: [{ id: '', at: '', from: 'claude', text: 'Bonjour' }, { id: '6', at: 'x', from: 'moi', text: 'Moi' }], seen: 0, syncedAt: null });
});

test('une sauvegarde exportée puis réimportée garde le type, l’attente et le fil des commentaires', () => {
  const state = stateWith(report({ id: 'bug_a', kind: 'question', queued: true }), report({ id: 'bug_b', remote: { number: 3, url: 'https://exemple/3', state: 'closed', seen: 1, syncedAt: '2026-11-15T12:00:00.000Z', thread: [{ id: '9', at: '2026-11-15T11:00:00Z', from: 'claude', text: 'Fait.' }] } }));
  const read = readImport(JSON.parse(JSON.stringify(exportData(state, { appVersion: '2.1.0' }))));
  assert.equal(read.ok, true);
  assert.deepEqual(read.state.bugReports, state.bugReports);
});

test('lots : mise en attente, envoi réussi, réponses reçues, lecture, réponse de l’utilisateur', () => {
  let state = stateWith(report({ id: 'bug_a' }), report({ id: 'bug_b', createdAt: '2026-11-14T09:00:00.000Z' }));
  assert.equal(planQueueComment(state, 'bug_inconnu').ok, false);
  assert.ok(isEmpty(planQueueComment(state, 'bug_a', false).cs), 'déjà pas en attente : rien à écrire');

  state = commit(state, planQueueComment(state, 'bug_a'));
  state = commit(state, planQueueComment(state, 'bug_b'));
  assert.deepEqual(queuedComments(state).map((r) => r.id), ['bug_b', 'bug_a'], 'du plus ancien au plus récent');

  state = commit(state, planCommentSent(state, 'bug_a', { number: 4, url: 'https://exemple/4', at: '2026-11-15T10:00:00.000Z' }));
  const sent = state.bugReports.find((r) => r.id === 'bug_a');
  assert.deepEqual([sent.queued, sent.sentAt, sent.remote.number, sent.remote.state, sent.remote.seen], [false, '2026-11-15T10:00:00.000Z', 4, 'open', 0]);
  assert.deepEqual(queuedComments(state).map((r) => r.id), ['bug_b']);
  assert.ok(isEmpty(planQueueComment(state, 'bug_a').cs), 'un commentaire déposé ne retourne pas en attente');

  const thread = [{ id: '10', at: '2026-11-15T11:00:00Z', from: 'claude', text: 'De quel écran ?' }];
  const update = planRemoteUpdate(state, 'bug_a', { state: 'open', thread, at: '2026-11-15T11:05:00.000Z' });
  state = commit(state, update);
  assert.equal(commentStatus(state.bugReports.find((r) => r.id === 'bug_a')), 'answered');
  assert.ok(isEmpty(planRemoteUpdate(state, 'bug_a', { state: 'open', thread }).cs), 'rien de neuf : rien à écrire');
  assert.ok(isEmpty(planRemoteUpdate(state, 'bug_b', { state: 'closed', thread }).cs), 'un commentaire jamais déposé n’a pas de suivi');

  state = commit(state, planRepliesSeen(state, 'bug_a'));
  assert.equal(commentStatus(state.bugReports.find((r) => r.id === 'bug_a')), 'talking');
  assert.ok(isEmpty(planRepliesSeen(state, 'bug_a').cs));

  state = commit(state, planRemoteUpdate(state, 'bug_a', { state: 'closed', thread }));
  assert.equal(commentStatus(state.bugReports.find((r) => r.id === 'bug_a')), 'done');
  state = commit(state, planFollowUp(state, 'bug_a', { messageId: 11, text: '  Sur Enveloppes.  ', at: '2026-11-15T12:00:00Z' }));
  const reopened = state.bugReports.find((r) => r.id === 'bug_a');
  assert.equal(reopened.remote.state, 'open', 'répondre rouvre un commentaire traité');
  assert.deepEqual(reopened.remote.thread[1], { id: '11', at: '2026-11-15T12:00:00Z', from: 'moi', text: 'Sur Enveloppes.' });
  assert.equal(unreadReplies(reopened), 0);
  // la fiche relue par le modèle de données est identique : rien d'invalide n'a été écrit
  assert.deepEqual(makeBugReport(reopened), reopened);
});

test('journal des versions : la dernière entrée est la version en cours, « quoi de neuf » ne montre que le nouveau', () => {
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  assert.equal(CHANGES[0].version, version, 'ajoute une entrée en tête de www/js/changelog.js à chaque nouvelle version');
  for (const entry of CHANGES) assert.ok(/^\d+\.\d+\.\d+$/.test(entry.version) && entry.title && entry.items.length, entry.version);
  for (let i = 1; i < CHANGES.length; i++) assert.equal(compareVersions(CHANGES[i - 1].version, CHANGES[i].version), 1, 'de la plus récente à la plus ancienne');
  assert.equal(compareVersions('2.1.0', '2.1.0'), 0);
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
  assert.equal(compareVersions('2.0', '2.0.1'), -1);
  const sample = [{ version: '2.2.0' }, { version: '2.1.1' }, { version: '2.1.0' }, { version: '2.0.0' }];
  assert.deepEqual(changesSince('2.1.0', '2.2.0', sample).map((e) => e.version), ['2.2.0', '2.1.1']);
  assert.deepEqual(changesSince('2.2.0', '2.2.0', sample), []);
  assert.deepEqual(changesSince('2.0.0', '2.1.0', sample).map((e) => e.version), ['2.1.0'], 'jamais une version plus récente que celle installée');
});

test('bouton IA : l’élément visé est décrit, mis en forme dans le texte, et relu depuis le marqueur', () => {
  const target = { screen: 'operations', context: '', path: 'section.screen[data-screen="operations"] > button.fab[data-action="add"]', label: 'Ajouter une opération', role: 'button', rect: { x: 340.4, y: 800, w: 56, h: 56 }, area: { x: 330, y: 790, w: 80, h: 80 }, frame: { w: 412, h: 915 } };
  const r = makeBugReport(report({ kind: 'idee', text: 'Plus gros, ce bouton.', origin: 'annotation', target }));
  assert.equal(r.origin, 'annotation');
  assert.deepEqual(r.target.rect, { x: 340, y: 800, w: 56, h: 56 }, 'positions arrondies');
  assert.equal(targetText(r.target), 'bouton « Ajouter une opération » — écran « Opérations »');
  assert.equal(targetText({ ...r.target, role: 'field', label: 'Montant', context: 'feuille « Nouvelle opération »' }), 'champ « Montant » — feuille « Nouvelle opération »');
  assert.equal(targetText(null), '');
  const body = commentBody(r);
  assert.match(body, /\*\*Élément visé\*\* : bouton « Ajouter une opération » — écran « Opérations »\n\n`section\.screen\[data-screen="operations"\] > button\.fab\[data-action="add"\]`/);
  assert.deepEqual(parseMarker(body).target, r.target, 'le marqueur porte la description complète');
  // un libellé contenant « --> » ne casse pas le marqueur
  const tricky = makeBugReport(report({ target: { ...target, label: 'a --> b' } }));
  const trickyBody = commentBody(tricky);
  const markerLine = trickyBody.split('\n').find((line) => line.startsWith('<!-- mon-budget'));
  assert.equal((markerLine.match(/-->/g) || []).length, 1, 'dans le marqueur, un seul « --> » : sa fin');
  assert.equal(parseMarker(trickyBody).target.label, 'a --> b');
  // sans bouton IA : rien de tout cela
  assert.deepEqual([makeBugReport(report()).origin, makeBugReport(report()).target], ['form', null]);
  assert.ok(!commentBody(makeBugReport(report())).includes('Élément visé'));
  assert.equal(makeBugReport(report({ origin: 'pirate', target: 'texte' })).origin, 'form');
  assert.equal(makeBugReport(report({ target: 'texte' })).target, null);
});