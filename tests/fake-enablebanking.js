// Un faux Enable Banking, en mémoire, pour tester la connexion bancaire sans compte ni banque :
// il imite ce dont tools/banque.mjs se sert (banques, accord, session, opérations, soldes), vérifie
// le jeton JWT comme le vrai (signature RS256, identifiant de l'application, durée), et découpe les
// opérations en pages pour éprouver la reprise par « continuation_key ».

import { createVerify } from 'node:crypto';

const fromB64url = (text) => JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));

export function createFakeEnableBanking({ appId, publicKey, now = () => Date.now() }) {
  const fake = {
    appId,
    aspsps: [
      { name: 'Société Générale', country: 'FR', psu_types: ['personal'], maximum_consent_validity: 15552000, beta: false, logo: '', auth_methods: [] },
      { name: 'Banque Exemple', country: 'FR', psu_types: ['personal'], maximum_consent_validity: 7776000, beta: true, logo: '', auth_methods: [] },
    ],
    accounts: [
      { uid: 'acc-courant', account_id: { iban: 'FR7630003000000000000012345' }, name: 'Compte courant', currency: 'EUR', cash_account_type: 'CACC', identification_hash: 'h1', identification_hashes: ['h1'] },
      { uid: 'acc-livret', account_id: { iban: 'FR7630003000000000000067890' }, name: 'Livret A', currency: 'EUR', cash_account_type: 'SVGS', identification_hash: 'h2', identification_hashes: ['h2'] },
    ],
    transactions: {}, // uid → [transaction]
    balances: {}, // uid → [balance]
    pageSize: 2,
    auths: new Map(), // code → { state, redirectUrl, aspsp, validUntil }
    sessions: new Map(), // id → { status }
    requests: [],
    failures: [], // { test(method, path), status, error, times }
    lastRedirect: null,
    next: 1,
    expired: false,
  };

  fake.failNext = (test, status, error, times = 1) => fake.failures.push({ test, status, error, times });

  function checkJwt(auth) {
    const token = String(auth || '').replace(/^Bearer /, '');
    const parts = token.split('.');
    if (parts.length !== 3) return 'jeton mal formé';
    let header;
    let claims;
    try {
      header = fromB64url(parts[0]);
      claims = fromB64url(parts[1]);
    } catch {
      return 'jeton illisible';
    }
    if (header.alg !== 'RS256' || header.typ !== 'JWT' || header.kid !== fake.appId) return 'en-tête incorrect';
    if (claims.iss !== 'enablebanking.com' || claims.aud !== 'api.enablebanking.com') return 'destinataire incorrect';
    const t = Math.floor(now() / 1000);
    if (!(claims.iat <= t + 60) || !(claims.exp > t) || claims.exp - claims.iat > 86400) return 'durée incorrecte';
    const ok = createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(publicKey, Buffer.from(parts[2], 'base64url'));
    return ok ? null : 'signature invalide';
  }

  const reply = (status, data) => ({ status, data });
  const error = (status, code, message = code) => reply(status, { message, code: status, error: code, detail: null });

  fake.handle = ({ method, url, headers = {}, body = null }) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const auth = headers.Authorization || headers.authorization;
    const data = body ? JSON.parse(body) : {};
    fake.requests.push({ method, path, query: Object.fromEntries(parsed.searchParams), body: data });
    for (const failure of fake.failures) {
      if (failure.times > 0 && failure.test(method, path)) {
        failure.times--;
        return error(failure.status, failure.error);
      }
    }
    const problem = checkJwt(auth);
    if (problem) return error(401, 'UNAUTHORIZED_ACCESS', problem);

    if (method === 'GET' && path === '/aspsps') {
      const country = parsed.searchParams.get('country');
      return reply(200, { aspsps: fake.aspsps.filter((a) => !country || a.country === country) });
    }
    if (method === 'POST' && path === '/auth') {
      const aspsp = fake.aspsps.find((a) => a.name === data.aspsp?.name && a.country === data.aspsp?.country);
      if (!aspsp) return error(422, 'WRONG_ASPSP_PROVIDED');
      if (!data.state || !data.redirect_url || !data.access?.valid_until) return error(422, 'WRONG_REQUEST_PARAMETERS');
      const code = `code${fake.next++}abcdef`;
      fake.auths.set(code, { state: data.state, redirectUrl: data.redirect_url, aspsp, validUntil: data.access.valid_until });
      // ce que le navigateur recevra au retour de la banque, une fois l'accord donné
      fake.lastRedirect = `${data.redirect_url}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(data.state)}`;
      return reply(200, { url: `https://banque.exemple/accord?a=${fake.next}`, authorization_id: `auth-${fake.next}`, psu_id_hash: 'psu' });
    }
    if (method === 'POST' && path === '/sessions') {
      const pending = fake.auths.get(data.code);
      if (!pending) return error(422, 'WRONG_AUTHORIZATION_CODE');
      fake.auths.delete(data.code);
      const id = `session-${fake.next++}`;
      fake.sessions.set(id, { status: 'AUTHORIZED' });
      return reply(200, { session_id: id, accounts: fake.accounts, aspsp: { name: pending.aspsp.name, country: 'FR' }, psu_type: 'personal', access: { valid_until: pending.validUntil } });
    }
    let m = /^\/sessions\/([^/]+)$/.exec(path);
    if (m && method === 'DELETE') {
      if (!fake.sessions.has(m[1])) return error(404, 'SESSION_DOES_NOT_EXIST');
      fake.sessions.get(m[1]).status = 'CLOSED';
      return reply(200, { message: 'OK' });
    }
    m = /^\/accounts\/([^/]+)\/(transactions|balances)$/.exec(path);
    if (m && method === 'GET') {
      if (fake.expired) return error(401, 'EXPIRED_SESSION');
      if (!fake.accounts.some((a) => a.uid === m[1])) return error(404, 'ACCOUNT_DOES_NOT_EXIST');
      if (m[2] === 'balances') return reply(200, { balances: fake.balances[m[1]] || [] });
      const from = parsed.searchParams.get('date_from') || '0000-00-00';
      const all = (fake.transactions[m[1]] || []).filter((t) => (t.booking_date || t.value_date || '') >= from);
      const offset = Number(parsed.searchParams.get('continuation_key') || 0);
      const page = all.slice(offset, offset + fake.pageSize);
      const next = offset + fake.pageSize < all.length ? String(offset + fake.pageSize) : null;
      return reply(200, { transactions: page, continuation_key: next });
    }
    return error(404, 'NOT_FOUND', `Route inconnue du faux Enable Banking : ${method} ${path}`);
  };

  fake.fetch = async (url, init = {}) => {
    const result = fake.handle({ method: init.method || 'GET', url: String(url), headers: init.headers || {}, body: init.body || null });
    return new Response(JSON.stringify(result.data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  };

  return fake;
}

/** Une opération telle que la renvoie l'API (montant en texte, sens à part). */
export function ebTransaction({ date, amount, label, details = [], party = '', status = 'BOOK', currency = 'EUR', opDate = null }) {
  const debit = amount < 0;
  return {
    entry_reference: `ref-${date}-${Math.abs(amount)}`,
    transaction_amount: { currency, amount: (Math.abs(amount) / 100).toFixed(2) },
    credit_debit_indicator: debit ? 'DBIT' : 'CRDT',
    status,
    booking_date: date,
    value_date: date,
    transaction_date: opDate,
    remittance_information: [label, ...details],
    ...(party ? (debit ? { creditor: { name: party } } : { debtor: { name: party } }) : {}),
  };
}
