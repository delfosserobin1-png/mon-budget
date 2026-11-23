// Connexion bancaire : chiffrement, jeton Enable Banking, conversion des opérations, outil de
// l'ordinateur de bout en bout (faux Enable Banking + faux GitHub), lecture du relevé par l'appli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { amountToCents, BANK_CONFIG_FILE, BOX_PATH, makeJwt, pickBalance, run, toBankLines } from '../../tools/banque.mjs';
import { createFakeEnableBanking, ebTransaction } from '../fake-enablebanking.js';
import { createFakeGithub, FAKE_TOKEN } from '../fake-github.js';
import { ChiffreError, cleanPhrase, decryptText, encryptText, newPhrase } from '../../www/js/core/chiffre.js';
import { readStatementFile, StatementError } from '../../www/js/io/statement/index.js';
import { matchStatement, planStatementImport, proposeForLine } from '../../www/js/core/matching.js';
import { apply, cloneState } from '../../www/js/core/changeset.js';
import { stateWith } from './helpers.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const APP_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-11-24T06:00:00.000Z');
const TODAY = '2026-11-24';

/** Un dossier de projet jetable : réglages de l'appli, et la clé privée « fournie par Enable Banking ». */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'mon-budget-banque-'));
  writeFileSync(join(root, 'mon-budget.config.json'), JSON.stringify({ adresse: 'https://moi.github.io/mon-budget/', commentaires: 'moi/mon-budget-commentaires' }));
  writeFileSync(join(root, 'cle-privee.pem'), PEM);
  return root;
}

function tool(root, { eb, gh, today = TODAY, now = NOW } = {}) {
  return async (...argv) => {
    const out = [];
    const err = [];
    const code = await run(argv, { root, env: { MON_BUDGET_JETON: FAKE_TOKEN }, gh: false, log: (t) => out.push(t), fail: (t) => err.push(t), ebFetch: eb?.fetch, ghFetch: gh?.fetch, today, now: () => now });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
}

test('chiffre : aller-retour, mauvaise phrase, document abîmé, phrase trop courte ; phrases au hasard', async () => {
  const phrase = newPhrase();
  assert.match(phrase, /^[a-z2-9]{4}(-[a-z2-9]{4}){4}$/);
  assert.notEqual(newPhrase(), phrase);
  assert.ok(!/[01ilo]/.test(phrase.replace(/-/g, '')), 'pas de signes faciles à confondre');
  const doc = await encryptText('Opérations : −12,50 € chez Carrefour', phrase, { iterations: 100000 });
  assert.ok(!doc.includes('Carrefour'), 'le texte ne se lit pas dans le document chiffré');
  assert.equal(await decryptText(doc, phrase.toUpperCase().replace(/-/g, ' ')), 'Opérations : −12,50 € chez Carrefour', 'la phrase se recopie sans souci des majuscules ni des séparateurs');
  await assert.rejects(decryptText(doc, newPhrase()), (e) => e instanceof ChiffreError && e.code === 'phrase');
  const tampered = JSON.parse(doc);
  tampered.data = tampered.data.slice(0, -6) + 'AAAAAA';
  await assert.rejects(decryptText(JSON.stringify(tampered), phrase), (e) => e instanceof ChiffreError && e.code === 'phrase', 'une modification est détectée');
  await assert.rejects(decryptText('pas du json', phrase), (e) => e.code === 'format');
  await assert.rejects(decryptText(JSON.stringify({ format: 'autre' }), phrase), (e) => e.code === 'format');
  await assert.rejects(encryptText('x', 'court'), (e) => e.code === 'weak');
  assert.equal(cleanPhrase(' Ab-cd_EF.gh '), 'abcdefgh');
});

test('jeton Enable Banking : en-tête, destinataire, durée d’une heure, signature vérifiable avec la clé publique', () => {
  const jwt = makeJwt({ appId: APP_ID, privateKey, now: NOW });
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'RS256', kid: APP_ID });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.deepEqual([claims.iss, claims.aud, claims.exp - claims.iat, claims.iat], ['enablebanking.com', 'api.enablebanking.com', 3600, NOW / 1000]);
  assert.equal(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')), true);
  assert.ok(!/[+/=]/.test(jwt), 'encodage base64url (sans + / =)');
});

test('opérations de la banque : centimes exacts, sens, comptabilisées seulement, euros seulement', () => {
  assert.deepEqual(['12.30', '-4.5', '1234', '0.07', '12.300', '12.345', 'abc', '', null].map(amountToCents), [1230, -450, 123400, 7, 1230, null, null, null, null]);
  const { lines, skipped } = toBankLines([
    ebTransaction({ date: '2026-11-20', amount: -2350, label: 'CARTE X1234 18/11 CARREFOUR CITY', details: ['PARIS'], opDate: '2026-11-18' }),
    ebTransaction({ date: '2026-11-19', amount: 250000, label: 'VIR SEPA RECU', details: ['DE: ATELIER DURAND', 'MOTIF: SALAIRE NOVEMBRE'], party: 'ATELIER DURAND' }),
    ebTransaction({ date: '2026-11-21', amount: -999, label: 'CARTE X1234 21/11 EN ATTENTE', status: 'PDNG' }),
    ebTransaction({ date: '2026-11-21', amount: -5000, label: 'CARTE X1234 20/11 HOTEL', currency: 'USD' }),
    { ...ebTransaction({ date: '2026-11-22', amount: -1000, label: '' }), remittance_information: [], creditor: { name: 'Boulangerie Paul' } },
  ]);
  assert.equal(skipped, 1, 'la dépense en dollars est écartée (et dite)');
  assert.deepEqual(
    lines.map((l) => [l.date, l.amount, l.label, l.details, l.counterparty, l.opDate]),
    [
      ['2026-11-19', 250000, 'VIR SEPA RECU', ['DE: ATELIER DURAND', 'MOTIF: SALAIRE NOVEMBRE'], 'ATELIER DURAND', null],
      ['2026-11-20', -2350, 'CARTE X1234 18/11 CARREFOUR CITY', ['PARIS'], '', '2026-11-18'],
      ['2026-11-22', -1000, 'Boulangerie Paul', [], 'Boulangerie Paul', null],
    ],
  );
});

test('solde de la banque : le solde comptable d’abord, sinon le suivant, en centimes', () => {
  const balances = [
    { name: 'dispo', balance_type: 'ITAV', balance_amount: { currency: 'EUR', amount: '1500.00' }, reference_date: '2026-11-24' },
    { name: 'comptable', balance_type: 'CLBD', balance_amount: { currency: 'EUR', amount: '-12.40' }, reference_date: '2026-11-24' },
  ];
  assert.deepEqual(pickBalance(balances, TODAY), { amount: -1240, date: '2026-11-24', type: 'CLBD' });
  assert.deepEqual(pickBalance([balances[0]], TODAY), { amount: 150000, date: '2026-11-24', type: 'ITAV' });
  assert.equal(pickBalance([], TODAY), null);
});

test('outil de l’ordinateur : installer, connecter, valider, relever — le relevé arrive chiffré dans la boîte, et l’appli le lit', async () => {
  const root = project();
  let clock = NOW; // l'heure d'Enable Banking suit celle de l'ordinateur
  const eb = createFakeEnableBanking({ appId: APP_ID, publicKey, now: () => clock });
  const gh = createFakeGithub({ repo: 'moi/mon-budget-commentaires' });
  eb.transactions['acc-courant'] = [
    ebTransaction({ date: '2026-10-20', amount: -5000, label: 'TROP ANCIENNE' }),
    ebTransaction({ date: '2026-11-03', amount: 250000, label: 'VIR SEPA RECU', details: ['DE: ATELIER DURAND', 'MOTIF: SALAIRE'], party: 'ATELIER DURAND' }),
    ebTransaction({ date: '2026-11-05', amount: -4590, label: 'CARTE X1234 04/11 CARREFOUR CITY', opDate: '2026-11-04' }),
    ebTransaction({ date: '2026-11-12', amount: -1599, label: 'PRLV SEPA FREE MOBILE', details: ['DE: FREE MOBILE'] }),
    ebTransaction({ date: '2026-11-21', amount: -800, label: 'CARTE X1234 20/11 BOULANGERIE', status: 'PDNG' }),
  ];
  eb.balances['acc-courant'] = [{ name: 'comptable', balance_type: 'CLBD', balance_amount: { currency: 'EUR', amount: '2738.11' }, reference_date: TODAY }];
  const bank = tool(root, { eb, gh });

  const installed = await bank('installer', APP_ID, 'cle-privee.pem');
  assert.equal(installed.code, 0, installed.err);
  const config = JSON.parse(readFileSync(join(root, BANK_CONFIG_FILE), 'utf8'));
  assert.match(installed.out, new RegExp(config.phrase), 'la phrase secrète est affichée une fois, pour le téléphone');
  assert.equal(config.keyFile, 'cle-privee.pem', 'seul le chemin de la clé est noté, pas la clé');

  assert.match((await bank('banques')).out, /- Société Générale\n- Banque Exemple \(en test\)/);
  assert.match((await bank('relever')).err, /pas encore connectée/);

  const started = await bank('connecter', 'Société', 'Générale');
  assert.equal(started.code, 0, started.err);
  assert.match(started.out, /https:\/\/banque\.exemple\/accord/);
  const auth = eb.requests.find((r) => r.path === '/auth').body;
  assert.equal(auth.redirect_url, 'https://moi.github.io/mon-budget/banque-retour.html');
  assert.equal(auth.psu_type, 'personal');
  assert.equal(auth.access.valid_until, new Date(NOW + 180 * 86400000).toISOString(), 'accord demandé pour 180 jours');

  // une adresse de retour qui ne correspond pas à la demande en cours est refusée
  assert.match((await bank('valider', eb.lastRedirect.replace(/state=[^&]+/, 'state=autre'))).err, /ne correspond pas/);
  const done = await bank('valider', eb.lastRedirect);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /Compte courant se terminant par 2345 {3}← suivi par l’appli/);
  assert.match(done.out, /Livret A se terminant par 7890/);

  const fetched = await bank('relever');
  assert.equal(fetched.code, 0, fetched.err);
  assert.match(fetched.out, /3 opérations relevées du 2026-10-25 au 2026-11-24/);
  const query = eb.requests.filter((r) => r.path.endsWith('/transactions')).map((r) => r.query);
  assert.deepEqual(query.map((q) => q.continuation_key || null), [null, '2'], 'les pages successives sont toutes lues');
  assert.equal(query[0].date_from, '2026-10-25', 'premier relevé : les 30 derniers jours');

  // dans la boîte : un document chiffré, illisible sans la phrase
  const sealed = new TextDecoder().decode(gh.files.get(BOX_PATH));
  assert.ok(!sealed.includes('CARREFOUR') && !sealed.includes('2738'));
  const text = await decryptText(sealed, config.phrase);
  const statement = await readStatementFile({ name: 'banque-2026-11-24.json', bytes: new TextEncoder().encode(text) }, {});
  assert.equal(statement.format, 'api');
  assert.equal(statement.bank, 'Société Générale');
  assert.equal(statement.accountLabel, 'Société Générale, compte se terminant par 2345');
  assert.deepEqual([statement.periodStart, statement.periodEnd], ['2026-10-25', TODAY]);
  assert.deepEqual(
    statement.lines.map((l) => [l.date, l.amount, l.kind, l.counterparty]),
    [
      ['2026-11-03', 250000, 'transfer-in', 'Atelier Durand'],
      ['2026-11-05', -4590, 'card', 'Carrefour City'],
      ['2026-11-12', -1599, 'debit', 'Free Mobile'],
    ],
  );
  assert.equal(statement.lines[1].opDate, '2026-11-04', 'la date de l’achat est gardée');
  assert.deepEqual([statement.closingBalance, statement.closingDate, statement.openingBalance], [273811, TODAY, 273811 - 250000 + 4590 + 1599]);
  assert.ok(statement.fingerprint);

  // relevé suivant, une semaine plus tard : il repart 10 jours avant la fin du précédent
  clock = NOW + 7 * 86400000;
  const later = tool(root, { eb, gh, today: '2026-12-01', now: clock });
  const again = await later('relever');
  assert.equal(again.code, 0, again.err);
  assert.equal(eb.requests.filter((r) => r.path.endsWith('/transactions')).at(-1).query.date_from, '2026-11-14');
  assert.equal(gh.files.size, 1, 'le relevé déposé est remplacé, pas multiplié');

  // état, puis déconnexion
  assert.match((await later('etat')).out, /Accord valable encore 173 jours/);
  assert.equal((await later('deconnecter')).code, 0);
  assert.match((await later('relever')).err, /pas encore connectée/);
});

test('outil de l’ordinateur : accord expiré, limite de la banque, banque inconnue, mauvaise clé — un message clair, rien de déposé', async () => {
  const root = project();
  const eb = createFakeEnableBanking({ appId: APP_ID, publicKey, now: () => NOW });
  const gh = createFakeGithub({ repo: 'moi/mon-budget-commentaires' });
  const bank = tool(root, { eb, gh });
  await bank('installer', APP_ID, 'cle-privee.pem');
  assert.match((await bank('connecter', 'Banque Inconnue')).err, /« npm run banque -- banques » donne les noms exacts/);
  await bank('connecter', 'Société Générale');
  await bank('valider', new URL(eb.lastRedirect).searchParams.get('code'));

  eb.expired = true;
  assert.match((await bank('relever')).err, /L'accord donné à ta banque a expiré/);
  eb.expired = false;
  eb.failNext((m, p) => p.endsWith('/transactions'), 429, 'ASPSP_RATE_LIMIT_EXCEEDED');
  assert.match((await bank('relever')).err, /limite le nombre de relevés par jour/);
  assert.equal(gh.files.size, 0, 'rien n’a été déposé');

  // une autre clé (pas celle déclarée chez Enable Banking) : refusée
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(join(root, 'autre.pem'), other);
  await bank('installer', APP_ID, 'autre.pem');
  assert.match((await bank('banques')).err, /Enable Banking refuse la clé/);
  assert.match((await bank('installer', APP_ID, 'absente.pem')).err, /Fichier de clé introuvable/);
  assert.ok(existsSync(join(root, BANK_CONFIG_FILE)));
});

test('relevé de la banque dans l’assistant : deux relevés qui se chevauchent ne créent aucun doublon ; un fichier abîmé est refusé', async () => {
  const body = (lines, end) => JSON.stringify({ format: 'mon-budget-banque', version: 1, bank: 'Société Générale', account: { last4: '2345' }, fetchedAt: `${end}T06:00:00Z`, periodStart: lines[0].date, periodEnd: end, balance: null, lines });
  const read = (text) => readStatementFile({ name: 'banque.json', bytes: new TextEncoder().encode(text) }, {});
  const l1 = { date: '2026-11-03', amount: 250000, label: 'VIR SEPA RECU', details: ['DE: ATELIER DURAND'] };
  const l2 = { date: '2026-11-05', amount: -4590, label: 'CARTE X1234 04/11 CARREFOUR CITY', details: [] };
  const l3 = { date: '2026-11-20', amount: -1599, label: 'PRLV SEPA FREE MOBILE', details: ['DE: FREE MOBILE'] };
  const first = await read(body([l1, l2], '2026-11-10'));
  let state = stateWith({ tags: [{ id: 'tag_c', name: 'Courses' }] });
  const decide = (st) => {
    const m = matchStatement(state, st);
    const lines = {};
    for (const id of m.missing) lines[id] = { action: 'create', fields: proposeForLine(state, st.lines.find((l) => l.id === id)) };
    for (const id of m.already) lines[id] = { action: 'already' };
    return { lines, extras: {} };
  };
  const plan1 = planStatementImport(state, first, decide(first), { today: '2026-11-10' });
  assert.equal(plan1.ok, true, JSON.stringify(plan1.errors));
  state = apply(cloneState(state), plan1.cs);
  assert.deepEqual(state.operations.filter((o) => o.kind === 'operation').map((o) => [o.amount, o.tags]), [[250000, []], [-4590, ['tag_c']]], 'Carrefour rangé dans Courses grâce au catalogue');

  const second = await read(body([l1, l2, l3], '2026-11-24'));
  const m = matchStatement(state, second);
  assert.equal(m.already.length, 2, 'les deux lignes déjà importées sont reconnues');
  assert.equal(m.missing.length, 1);

  await assert.rejects(read('{"format":"mon-budget-banque","version":1'), (e) => e instanceof StatementError);
  await assert.rejects(read(JSON.stringify({ format: 'mon-budget-banque', version: 1, lines: [{ date: 'hier', amount: 1 }] })), (e) => e instanceof StatementError && e.code === 'empty');
});
