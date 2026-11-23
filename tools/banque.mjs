// La connexion à la banque, vue de l'ordinateur : Enable Banking (accès aux comptes, DSP2).
//
//   node tools/banque.mjs installer <id-application> <fichier-clé.pem>   réglages + phrase secrète
//   node tools/banque.mjs banques [FR]                 les banques proposées (le nom exact à utiliser)
//   node tools/banque.mjs connecter "Société Générale" l'adresse où donner ton accord à la banque
//   node tools/banque.mjs valider "<adresse de retour ou code>"   termine la connexion
//   node tools/banque.mjs compte <n°>                  le compte suivi, s'il y en a plusieurs
//   node tools/banque.mjs relever [--depuis AAAA-MM-JJ]  relève, chiffre et dépose les opérations
//   node tools/banque.mjs etat                         où en est la connexion
//   node tools/banque.mjs deconnecter                  ferme l'accès à la banque
//
// Réglages : mon-budget.banque.json (ignoré par git : il contient la phrase secrète et l'accès).
// La clé privée d'Enable Banking reste un fichier à part, sur cet ordinateur, jamais dans le projet.
// Les opérations relevées sont chiffrées (core/chiffre.js) puis déposées dans la boîte privée des
// commentaires, au chemin banque/releve.json.chiffre ; l'appli les y reprend (Plus › Banque).
// Un relevé ne contient que les opérations comptabilisées (« BOOK ») du compte suivi.

import { createPrivateKey, createSign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readConfig, resolveToken, UsageError } from './commentaires.mjs';
import { createGithubClient, GithubError } from '../www/js/io/github.js';
import { encryptText, newPhrase } from '../www/js/core/chiffre.js';
import { parseRepo } from '../www/js/core/comments.js';
import { addDays, isValidISO, todayISO } from '../www/js/core/dates.js';
import { BANK_FORMAT } from '../www/js/io/statement/text-formats.js';

export const BANK_CONFIG_FILE = 'mon-budget.banque.json';
export const EB_API = 'https://api.enablebanking.com';
export const BOX_PATH = 'banque/releve.json.chiffre';
export const RETURN_PAGE = 'banque-retour.html';
/** Premier relevé : les 30 derniers jours ; ensuite, depuis le précédent moins une marge. */
export const FIRST_DAYS = 30;
export const OVERLAP_DAYS = 10;
/** Durée de l'accord demandé à la banque (la plupart l'acceptent jusqu'à 180 jours). */
export const CONSENT_DAYS = 180;

export class BankError extends Error {
  constructor(message, code, detail = '') {
    super(message);
    this.name = 'BankError';
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------------------------
// Authentification : un jeton JWT signé par la clé privée de l'application (RS256)
// ---------------------------------------------------------------------------------------------

const b64url = (text) => Buffer.from(text).toString('base64url');

export function makeJwt({ appId, privateKey, now = Date.now(), ttl = 3600 }) {
  const iat = Math.floor(now / 1000);
  const header = { typ: 'JWT', alg: 'RS256', kid: appId };
  const claims = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + ttl };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

const MESSAGES = {
  EXPIRED_SESSION: "L'accord donné à ta banque a expiré : relance « npm run banque -- connecter ».",
  CLOSED_SESSION: "L'accès à la banque a été fermé : relance « npm run banque -- connecter ».",
  REVOKED_SESSION: "L'accord a été retiré depuis la banque : relance « npm run banque -- connecter ».",
  SESSION_DOES_NOT_EXIST: "Cette connexion à la banque n'existe plus : relance « npm run banque -- connecter ».",
  ASPSP_RATE_LIMIT_EXCEEDED: 'La banque limite le nombre de relevés par jour (souvent 4) : réessaie dans quelques heures.',
  ASPSP_ERROR: 'La banque ne répond pas correctement pour le moment : réessaie plus tard.',
  ASPSP_TIMEOUT: 'La banque met trop de temps à répondre : réessaie plus tard.',
  UNAUTHORIZED_ACCESS: "Enable Banking refuse la clé : vérifie l'identifiant de l'application et le fichier de clé.",
  REDIRECT_URI_NOT_ALLOWED: "L'adresse de retour n'est pas autorisée : ajoute-la dans les réglages de l'application, chez Enable Banking.",
  EXPIRED_AUTHORIZATION_CODE: 'Ce code a expiré : relance « connecter », puis « valider » dans la foulée.',
  WRONG_AUTHORIZATION_CODE: 'Ce code ne correspond pas (déjà utilisé ?) : relance « connecter ».',
  ALREADY_AUTHORIZED: 'Ce code a déjà servi : la connexion est peut-être déjà faite (« npm run banque -- etat »).',
  WRONG_ASPSP_PROVIDED: "Ce nom de banque n'est pas reconnu : « npm run banque -- banques » donne les noms exacts.",
  ACCESS_DENIED: "La banque a refusé l'accès (accord refusé ou annulé).",
  NO_ACCOUNTS_ADDED: "Aucun compte n'a été partagé : relance « connecter » et coche ton compte chez la banque.",
  WRONG_TRANSACTIONS_PERIOD: "La banque ne donne pas les opérations aussi anciennes : choisis une date plus récente (--depuis).",
};

/** Client minimal de l'API Enable Banking. `fetchImpl` et `api` servent aux tests (faux serveur). */
export function createEnableBankingClient({ appId, privateKey, fetchImpl = null, api = EB_API, now = () => Date.now() }) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  async function call(method, path, body = null) {
    const headers = { Authorization: `Bearer ${makeJwt({ appId, privateKey, now: now() })}`, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await doFetch(`${api}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new BankError("Pas de réponse d'Enable Banking (connexion internet ?).", 'offline');
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (response.ok) return data || {};
    const code = data && data.error ? String(data.error) : `HTTP_${response.status}`;
    const fallback = response.status === 401 ? MESSAGES.UNAUTHORIZED_ACCESS : `Enable Banking a répondu par une erreur (${code}).`;
    throw new BankError(MESSAGES[code] || fallback, code, String((data && data.message) || '').slice(0, 200));
  }
  return {
    async aspsps(country = 'FR') {
      const data = await call('GET', `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
      return Array.isArray(data.aspsps) ? data.aspsps : [];
    },
    startAuth: ({ aspsp, redirectUrl, state, validUntil }) => call('POST', '/auth', { access: { valid_until: validUntil }, aspsp, state, redirect_url: redirectUrl, psu_type: 'personal' }),
    createSession: (code) => call('POST', '/sessions', { code }),
    getSession: (id) => call('GET', `/sessions/${encodeURIComponent(id)}`),
    deleteSession: (id) => call('DELETE', `/sessions/${encodeURIComponent(id)}`),
    async balances(uid) {
      const data = await call('GET', `/accounts/${encodeURIComponent(uid)}/balances`);
      return Array.isArray(data.balances) ? data.balances : [];
    },
    /** Toutes les pages d'opérations depuis `dateFrom` (la banque découpe en pages). */
    async transactions(uid, { dateFrom }) {
      const out = [];
      let key = null;
      for (let page = 0; page < 500; page++) {
        const params = new URLSearchParams({ date_from: dateFrom });
        if (key) params.set('continuation_key', key);
        const data = await call('GET', `/accounts/${encodeURIComponent(uid)}/transactions?${params}`);
        if (Array.isArray(data.transactions)) out.push(...data.transactions);
        key = data.continuation_key || null;
        if (!key) return out;
      }
      throw new BankError('La banque renvoie trop de pages : relevé interrompu.', 'too-many-pages');
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Des opérations de la banque au relevé de l'appli (format « mon-budget-banque »)
// ---------------------------------------------------------------------------------------------

/** "123.45" → 12345 ; "-4.5" → -450 ; null si illisible. Jamais de calcul à virgule. */
export function amountToCents(value) {
  const m = /^\s*([+-])?(\d+)(?:[.,](\d+))?\s*$/.exec(String(value ?? ''));
  if (!m) return null;
  const decimals = ((m[3] || '') + '00').slice(0, 2);
  if (m[3] && m[3].length > 2 && /[1-9]/.test(m[3].slice(2))) return null; // plus fin que le centime : suspect
  const cents = Number(m[2]) * 100 + Number(decimals);
  return m[1] === '-' ? -cents : cents;
}

/** Les opérations comptabilisées, en lignes de relevé (montant signé : négatif = sortie). */
export function toBankLines(transactions) {
  const lines = [];
  let skipped = 0;
  for (const t of transactions || []) {
    if (t.status && t.status !== 'BOOK') continue; // en attente, annulées… : pas encore sûres
    const cents = amountToCents(t.transaction_amount && t.transaction_amount.amount);
    const currency = t.transaction_amount && t.transaction_amount.currency;
    const date = [t.booking_date, t.value_date, t.transaction_date].find((d) => isValidISO(d));
    if (cents === null || cents === 0 || !date || (currency && currency !== 'EUR')) {
      skipped++;
      continue;
    }
    const amount = t.credit_debit_indicator === 'DBIT' ? -Math.abs(cents) : Math.abs(cents);
    const remittance = (Array.isArray(t.remittance_information) ? t.remittance_information : []).map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const party = amount < 0 ? t.creditor && t.creditor.name : t.debtor && t.debtor.name;
    const label = remittance[0] || party || (t.bank_transaction_code && t.bank_transaction_code.description) || 'Opération';
    lines.push({
      date,
      valueDate: isValidISO(t.value_date) ? t.value_date : null,
      opDate: isValidISO(t.transaction_date) ? t.transaction_date : null,
      amount,
      label,
      details: remittance.slice(1),
      counterparty: String(party || '').trim(),
    });
  }
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { lines, skipped };
}

/** Le solde le plus sûr à comparer aux opérations comptabilisées : le « comptable » d'abord. */
export function pickBalance(balances, fallbackDate) {
  for (const type of ['CLBD', 'ITBD', 'XPCD', 'OPBD', 'CLAV', 'ITAV']) {
    const b = (balances || []).find((x) => x.balance_type === type && x.balance_amount && (!x.balance_amount.currency || x.balance_amount.currency === 'EUR'));
    if (!b) continue;
    const amount = amountToCents(b.balance_amount.amount);
    if (amount === null) continue;
    const date = [b.reference_date, String(b.last_change_date_time || '').slice(0, 10)].find((d) => isValidISO(d)) || fallbackDate;
    return { amount, date, type };
  }
  return null;
}

export function buildBankStatement({ bank, account, lines, balance, periodStart, periodEnd, fetchedAt, validUntil }) {
  return { format: BANK_FORMAT, version: 1, bank, account, fetchedAt, validUntil, periodStart, periodEnd, balance, lines };
}

const last4 = (account) => {
  const id = (account && account.account_id && (account.account_id.iban || (account.account_id.other && account.account_id.other.identification))) || '';
  return String(id).replace(/\s+/g, '').slice(-4);
};

// ---------------------------------------------------------------------------------------------
// Réglages (mon-budget.banque.json) et commandes
// ---------------------------------------------------------------------------------------------

export function readBankConfig(root = ROOT) {
  const path = join(root, BANK_CONFIG_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new UsageError(`${BANK_CONFIG_FILE} est illisible (ce doit être du JSON).`);
  }
}

function writeBankConfig(root, config) {
  writeFileSync(join(root, BANK_CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function loadKey(root, keyFile) {
  const path = isAbsolute(keyFile) ? keyFile : resolve(root, keyFile);
  if (!existsSync(path)) throw new UsageError(`Fichier de clé introuvable : ${keyFile}`);
  try {
    return createPrivateKey(readFileSync(path, 'utf8'));
  } catch {
    throw new UsageError("Ce fichier n'est pas une clé privée lisible (format PEM attendu, celui fourni par Enable Banking).");
  }
}

const USAGE =
  'Usage : node tools/banque.mjs installer <id-application> <clé.pem> | banques [FR] | connecter "<banque>" | valider "<adresse ou code>" | compte <n°> | relever [--depuis AAAA-MM-JJ] | etat | deconnecter';

/**
 * Lance une commande. Options de test : root, env, ebFetch / ebApi (faux Enable Banking),
 * ghFetch (faux GitHub), today, now, gh (lire le jeton de l'outil « gh »).
 */
export async function run(argv, { root = ROOT, env = process.env, log = console.log, fail = console.error, ebFetch = null, ebApi = undefined, ghFetch = null, today = null, now = () => Date.now(), gh = true } = {}) {
  const args = [...argv];
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--depuis') {
      options.since = args[i + 1];
      args.splice(i, 2);
      i--;
    }
  }
  const [command, ...rest] = args;
  const day = today || todayISO();
  try {
    if (!command) throw new UsageError(USAGE);
    if (command === 'installer') {
      const [appId, keyFile] = rest;
      if (!appId || !keyFile) throw new UsageError('Indique l’identifiant de l’application Enable Banking et le chemin de sa clé privée : installer <id> <clé.pem>');
      loadKey(root, keyFile); // vérifie qu'elle est lisible
      const previous = readBankConfig(root) || {};
      const phrase = previous.phrase || newPhrase();
      writeBankConfig(root, { ...previous, appId, keyFile, phrase });
      log(`Réglages enregistrés dans ${BANK_CONFIG_FILE} (ce fichier reste sur l'ordinateur).`);
      log(`\nPhrase secrète, à saisir une seule fois dans l'appli (Plus › Banque connectée) :\n\n    ${phrase}\n`);
      log("Elle chiffre tes opérations avant leur dépôt sur GitHub : garde-la, sans la partager.");
      return 0;
    }

    const config = readBankConfig(root);
    if (!config || !config.appId || !config.keyFile) throw new UsageError('La banque n’est pas encore installée : « node tools/banque.mjs installer <id-application> <clé.pem> ».');
    const client = createEnableBankingClient({ appId: config.appId, privateKey: loadKey(root, config.keyFile), fetchImpl: ebFetch, ...(ebApi ? { api: ebApi } : {}), now });
    const save = (patch) => {
      Object.assign(config, patch);
      writeBankConfig(root, config);
    };

    if (command === 'banques') {
      const list = await client.aspsps((rest[0] || 'FR').toUpperCase());
      log(list.map((a) => `- ${a.name}${a.beta ? ' (en test)' : ''}`).join('\n') || 'Aucune banque proposée pour ce pays.');
      return 0;
    }

    if (command === 'connecter') {
      const name = rest.join(' ').trim();
      if (!name) throw new UsageError('Indique le nom exact de ta banque, par exemple : connecter "Société Générale" (la liste : « banques »).');
      const site = readConfig(root).adresse;
      if (!site) throw new UsageError(`L'adresse du site n'est pas réglée dans mon-budget.config.json (« adresse ») : elle sert d'adresse de retour.`);
      const redirectUrl = new URL(RETURN_PAGE, site).href;
      const state = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(12))).toString('hex');
      const validUntil = new Date(now() + CONSENT_DAYS * 86400000).toISOString();
      const auth = await client.startAuth({ aspsp: { name, country: 'FR' }, redirectUrl, state, validUntil });
      save({ pending: { bank: name, state, authorizationId: auth.authorization_id || null, validUntil, at: new Date(now()).toISOString() } });
      log(`Ouvre cette adresse (sur l'ordinateur ou le téléphone), connecte-toi à ${name} et valide dans l'appli de la banque :\n\n${auth.url}\n`);
      log('La page de retour affichera un code : termine avec « npm run banque -- valider <code> ».');
      return 0;
    }

    if (command === 'valider') {
      const input = rest.join(' ').trim();
      if (!input) throw new UsageError('Colle l’adresse de la page de retour, ou le code qu’elle affiche : valider "<adresse ou code>".');
      if (!config.pending) throw new UsageError('Aucune connexion en cours : commence par « connecter ».');
      let code = input;
      if (/^https?:\/\//i.test(input)) {
        const url = new URL(input);
        if (url.searchParams.get('error')) throw new BankError(`La banque n'a pas donné son accord : ${url.searchParams.get('error_description') || url.searchParams.get('error')}.`, 'ACCESS_DENIED');
        if (url.searchParams.get('state') && url.searchParams.get('state') !== config.pending.state) throw new UsageError('Cette adresse de retour ne correspond pas à la connexion en cours : relance « connecter ».');
        code = url.searchParams.get('code') || '';
      }
      if (!/^[\w.~-]{6,}$/.test(code)) throw new UsageError('Ce code ne ressemble pas à celui de la page de retour.');
      const session = await client.createSession(code);
      const accounts = (session.accounts || []).map((a) => ({ uid: a.uid, last4: last4(a), name: a.name || a.product || '', currency: a.currency || '', type: a.cash_account_type || '' }));
      if (!accounts.length) throw new BankError(MESSAGES.NO_ACCOUNTS_ADDED, 'NO_ACCOUNTS_ADDED');
      const chosen = accounts.find((a) => a.type === 'CACC' && (!a.currency || a.currency === 'EUR')) || accounts[0];
      save({ bank: config.pending.bank, sessionId: session.session_id, validUntil: config.pending.validUntil, accounts, account: chosen.uid, pending: undefined, lastPeriodEnd: null });
      log(`Connexion faite avec ${config.bank}. Comptes partagés :`);
      accounts.forEach((a, i) => log(`  ${i + 1}. ${a.name || 'Compte'} se terminant par ${a.last4 || '????'}${a.uid === chosen.uid ? '   ← suivi par l’appli' : ''}`));
      log('\nProchaine étape : « npm run banque -- relever ».');
      return 0;
    }

    if (!config.sessionId) throw new UsageError('La banque n’est pas encore connectée : « connecter », puis « valider ».');

    if (command === 'compte') {
      const index = Number(rest[0]) - 1;
      const account = (config.accounts || [])[index];
      if (!account) throw new UsageError(`Choisis un numéro entre 1 et ${(config.accounts || []).length} (voir « etat »).`);
      save({ account: account.uid, lastPeriodEnd: null });
      log(`L'appli suivra désormais le compte se terminant par ${account.last4}.`);
      return 0;
    }

    if (command === 'etat') {
      const account = (config.accounts || []).find((a) => a.uid === config.account);
      const left = config.validUntil ? Math.round((Date.parse(config.validUntil) - now()) / 86400000) : null;
      log(`Banque : ${config.bank}`);
      log(`Compte suivi : ${account ? `${account.name || 'Compte'} se terminant par ${account.last4}` : '?'}`);
      if (left !== null) log(left > 0 ? `Accord valable encore ${left} jours (jusqu'au ${config.validUntil.slice(0, 10)}).` : 'Accord expiré : relance « connecter ».');
      log(config.lastFetchAt ? `Dernier relevé : ${config.lastFetchAt.slice(0, 16).replace('T', ' à ')} (UTC).` : 'Aucun relevé fait pour l’instant.');
      (config.accounts || []).forEach((a, i) => log(`  ${i + 1}. ${a.name || 'Compte'} se terminant par ${a.last4}${a.uid === config.account ? '   ← suivi' : ''}`));
      return 0;
    }

    if (command === 'deconnecter') {
      try {
        await client.deleteSession(config.sessionId);
      } catch (error) {
        if (!(error instanceof BankError) || !/SESSION/.test(error.code)) throw error;
      }
      save({ sessionId: undefined, accounts: undefined, account: undefined, validUntil: undefined, lastPeriodEnd: null });
      log('Accès à la banque fermé. Les relevés déjà déposés restent dans la boîte.');
      return 0;
    }

    if (command === 'relever') {
      if (!config.phrase) throw new UsageError('Pas de phrase secrète dans les réglages : relance « installer ».');
      if (config.validUntil && Date.parse(config.validUntil) <= now()) throw new BankError(MESSAGES.EXPIRED_SESSION, 'EXPIRED_SESSION');
      const account = (config.accounts || []).find((a) => a.uid === config.account);
      if (!account) throw new UsageError('Aucun compte suivi : « etat », puis « compte <n°> ».');
      if (options.since && !isValidISO(options.since)) throw new UsageError('--depuis attend une date AAAA-MM-JJ.');
      const dateFrom = options.since || (config.lastPeriodEnd ? addDays(config.lastPeriodEnd, -OVERLAP_DAYS) : addDays(day, -FIRST_DAYS));
      const repo = parseRepo(env.MON_BUDGET_COMMENTAIRES || readConfig(root).commentaires);
      if (!repo) throw new UsageError('La boîte privée n’est pas réglée (mon-budget.config.json → « commentaires »).');
      const token = resolveToken(env, { gh });
      if (!token) throw new UsageError("Aucun jeton d'accès à la boîte : connecte l'outil « gh » (gh auth login).");

      const transactions = await client.transactions(account.uid, { dateFrom });
      const { lines, skipped } = toBankLines(transactions);
      const balance = pickBalance(await client.balances(account.uid), day);
      const fetchedAt = new Date(now()).toISOString();
      const statement = buildBankStatement({
        bank: config.bank,
        account: { last4: account.last4, name: account.name },
        lines,
        balance,
        periodStart: dateFrom,
        periodEnd: day,
        fetchedAt,
        validUntil: config.validUntil || null,
      });
      const sealed = await encryptText(JSON.stringify(statement), config.phrase);
      const box = createGithubClient({ repo, token, fetchImpl: ghFetch, ...(env.MON_BUDGET_GITHUB_API ? { api: env.MON_BUDGET_GITHUB_API } : {}) });
      await box.putFile(BOX_PATH, new TextEncoder().encode(sealed), `Relevé de la banque du ${day}`);
      save({ lastPeriodEnd: day, lastFetchAt: fetchedAt });
      log(`${lines.length} opération${lines.length > 1 ? 's' : ''} relevée${lines.length > 1 ? 's' : ''} du ${dateFrom} au ${day}, chiffrée${lines.length > 1 ? 's' : ''} et déposée${lines.length > 1 ? 's' : ''} dans la boîte privée.`);
      if (skipped) log(`${skipped} opération${skipped > 1 ? 's' : ''} ignorée${skipped > 1 ? 's' : ''} (autre devise ou montant illisible).`);
      if (balance) log(`Solde donné par la banque : ${(balance.amount / 100).toFixed(2).replace('.', ',')} € au ${balance.date}.`);
      log("Dans l'appli : Plus › Banque connectée › Relever.");
      return 0;
    }

    throw new UsageError(USAGE);
  } catch (error) {
    if (error instanceof UsageError || error instanceof BankError || error instanceof GithubError) fail(error.message);
    else fail(`Erreur inattendue : ${error?.stack || error}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
