// Un faux GitHub, en mémoire, pour tester la boîte à commentaires sans internet ni compte.
// Il imite juste ce dont l'appli et tools/commentaires.mjs se servent : le dépôt, ses issues,
// leurs messages et ses fichiers. Il sert aux tests unitaires (par `fetch`) et aux tests de bout
// en bout (branché sur les requêtes du navigateur).

export const FAKE_TOKEN = 'github_pat_FAUX0000000000000000_jetonDeTest0000000000000000000000000000000000';

export function createFakeGithub({ repo = 'moi/mon-budget-commentaires', isPrivate = true, token = FAKE_TOKEN, issuesEnabled = true } = {}) {
  const fake = {
    repo,
    token,
    isPrivate,
    issuesEnabled,
    issues: [], // { number, title, body, state, labels, created_at, updated_at, closed_at, comments: [...] }
    files: new Map(), // chemin → Uint8Array
    requests: [], // { method, path, auth, body }
    offline: false,
    failures: [], // { test(method, path), status, message, times, headers }
    // Comme le vrai GitHub, il date ce qu'il reçoit à l'heure qu'il est (une seconde de plus à
    // chaque écriture, pour que l'ordre soit net) : l'appli s'en sert pour ne relire que le nouveau.
    clock: Date.now(),
    nextComment: 5000,
  };

  const tick = () => {
    fake.clock += 1000;
    return new Date(fake.clock).toISOString();
  };
  const json = (status, data, headers = {}) => ({ status, json: data, headers });
  const issueJson = (issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    html_url: `https://github.com/${fake.repo}/issues/${issue.number}`,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    comments: issue.comments.length,
    labels: issue.labels.map((name) => ({ name })),
    ...(issue.pull ? { pull_request: {} } : {}),
  });
  const commentJson = (comment) => ({ id: comment.id, body: comment.body, created_at: comment.created_at, user: { login: comment.author } });

  /** Fait échouer les prochaines demandes qui correspondent (pour simuler une panne, un droit manquant…). */
  fake.failNext = (test, status, { message = 'Erreur simulée', times = 1, headers = {} } = {}) => {
    fake.failures.push({ test, status, message, times, headers });
  };

  /** Ce que ferait Claude depuis l'ordinateur : répondre à un commentaire. */
  fake.claudeReplies = (number, body) => {
    const issue = fake.issues.find((i) => i.number === number);
    const at = tick();
    issue.comments.push({ id: fake.nextComment++, body, created_at: at, author: 'claude' });
    issue.updated_at = at;
  };
  fake.claudeCloses = (number) => {
    const issue = fake.issues.find((i) => i.number === number);
    const at = tick();
    issue.state = 'closed';
    issue.closed_at = at;
    issue.updated_at = at;
  };

  fake.handle = ({ method, url, headers = {}, body = null }) => {
    const parsed = new URL(url);
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const auth = lower.authorization || '';
    const prefix = `/repos/${fake.repo}`;
    const path = parsed.pathname;
    fake.requests.push({ method, path: `${path}${parsed.search}`, auth, body, accept: lower.accept || '' });

    for (const failure of fake.failures) {
      if (failure.times > 0 && failure.test(method, path)) {
        failure.times--;
        return json(failure.status, { message: failure.message }, failure.headers);
      }
    }
    if (auth !== `Bearer ${fake.token}`) return json(401, { message: 'Bad credentials' });
    if (path.toLowerCase() !== prefix.toLowerCase() && !path.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) return json(404, { message: 'Not Found' });
    const rest = path.slice(prefix.length);
    const data = body ? JSON.parse(body) : {};

    if (rest === '' && method === 'GET') {
      return json(200, { full_name: fake.repo, private: fake.isPrivate, has_issues: fake.issuesEnabled, default_branch: 'main', html_url: `https://github.com/${fake.repo}`, owner: { login: fake.repo.split('/')[0] } });
    }
    if (rest === '/issues' && method === 'GET') {
      const wanted = parsed.searchParams.get('state') || 'open';
      const since = parsed.searchParams.get('since');
      const perPage = Number(parsed.searchParams.get('per_page') || 30);
      const page = Number(parsed.searchParams.get('page') || 1);
      let list = fake.issues.filter((i) => wanted === 'all' || i.state === wanted);
      if (since) list = list.filter((i) => i.updated_at >= since);
      list = list.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      return json(200, list.slice((page - 1) * perPage, page * perPage).map(issueJson));
    }
    if (rest === '/issues' && method === 'POST') {
      if (!fake.issuesEnabled) return json(410, { message: 'Issues are disabled for this repo' });
      const at = tick();
      const issue = { number: fake.issues.length + 1, title: String(data.title || ''), body: String(data.body || ''), state: 'open', labels: data.labels || [], created_at: at, updated_at: at, closed_at: null, comments: [] };
      fake.issues.push(issue);
      return json(201, issueJson(issue));
    }
    let m = /^\/issues\/(\d+)$/.exec(rest);
    if (m) {
      const issue = fake.issues.find((i) => i.number === Number(m[1]));
      if (!issue) return json(404, { message: 'Not Found' });
      if (method === 'GET') return json(200, issueJson(issue));
      if (method === 'PATCH') {
        const at = tick();
        if (data.state === 'closed' || data.state === 'open') {
          issue.state = data.state;
          issue.closed_at = data.state === 'closed' ? at : null;
        }
        issue.updated_at = at;
        return json(200, issueJson(issue));
      }
    }
    m = /^\/issues\/(\d+)\/comments$/.exec(rest);
    if (m) {
      const issue = fake.issues.find((i) => i.number === Number(m[1]));
      if (!issue) return json(404, { message: 'Not Found' });
      if (method === 'GET') {
        const perPage = Number(parsed.searchParams.get('per_page') || 30);
        const page = Number(parsed.searchParams.get('page') || 1);
        return json(200, issue.comments.slice((page - 1) * perPage, page * perPage).map(commentJson));
      }
      if (method === 'POST') {
        const at = tick();
        const comment = { id: fake.nextComment++, body: String(data.body || ''), created_at: at, author: fake.repo.split('/')[0] };
        issue.comments.push(comment);
        issue.updated_at = at;
        return json(201, commentJson(comment));
      }
    }
    m = /^\/contents\/(.+)$/.exec(rest);
    if (m) {
      const file = decodeURIComponent(m[1]);
      if (method === 'PUT') {
        if (fake.files.has(file) && !data.sha) return json(422, { message: 'Invalid request. "sha" wasn\'t supplied.' });
        fake.files.set(file, Uint8Array.from(atob(String(data.content || '')), (c) => c.charCodeAt(0)));
        return json(201, { content: { path: file, html_url: `https://github.com/${fake.repo}/blob/main/${file}` } });
      }
      if (method === 'GET') {
        if (!fake.files.has(file)) return json(404, { message: 'Not Found' });
        if ((lower.accept || '').includes('raw')) return { status: 200, bytes: fake.files.get(file), headers: {} };
        return json(200, { path: file, type: 'file' });
      }
    }
    return json(404, { message: `Route inconnue du faux GitHub : ${method} ${rest}` });
  };

  /** Un `fetch` qui répond avec ce faux GitHub (pour les tests sans navigateur). */
  fake.fetch = async (url, init = {}) => {
    if (fake.offline) throw new TypeError('fetch failed');
    const result = fake.handle({ method: init.method || 'GET', url: String(url), headers: init.headers || {}, body: init.body || null });
    if (result.bytes) return new Response(result.bytes, { status: result.status, headers: result.headers });
    const noBody = result.status === 204;
    return new Response(noBody ? null : JSON.stringify(result.json), { status: result.status, headers: { 'Content-Type': 'application/json', ...result.headers } });
  };

  /** Branche ce faux GitHub sur un contexte de navigateur Playwright (tests de bout en bout). */
  fake.install = async (context) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-expose-headers': '*' };
    await context.route('https://api.github.com/**', async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (fake.offline) return route.abort('internetdisconnected');
      const result = fake.handle({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postData() });
      if (result.bytes) return route.fulfill({ status: result.status, headers: { ...cors, ...result.headers }, body: Buffer.from(result.bytes) });
      return route.fulfill({ status: result.status, headers: { ...cors, 'content-type': 'application/json', ...result.headers }, body: JSON.stringify(result.json) });
    });
  };

  return fake;
}
