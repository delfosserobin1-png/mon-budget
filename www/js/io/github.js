// Client minimal de GitHub, pour la boîte à commentaires.
//
// Utilisé par l'appli (dans le navigateur) et par tools/commentaires.mjs (sur l'ordinateur, par
// Claude) : uniquement `fetch`, aucune dépendance. C'est le SEUL endroit de l'appli qui parle à
// internet, et il ne parle qu'à api.github.com, uniquement quand la connexion à Claude est réglée.
//
// Le jeton d'accès n'apparaît jamais dans une adresse ni dans un message d'erreur : il voyage dans
// l'en-tête « Authorization », et les erreurs sont réécrites en français sans le citer.

export const GITHUB_API = 'https://api.github.com';

const MESSAGES = {
  offline: 'Pas de connexion à internet.',
  auth: "Le jeton d'accès est refusé : il a peut-être expiré ou été supprimé.",
  forbidden: "Le jeton n'a pas le droit de faire cette action : vérifie ses autorisations « Issues » et « Contents » (lecture et écriture).",
  rate: 'Trop de demandes en peu de temps : réessaie dans quelques minutes.',
  missing: "Boîte à commentaires introuvable : vérifie son nom, et que le jeton y donne bien accès.",
  invalid: 'GitHub a refusé la demande.',
  server: 'GitHub est momentanément indisponible : réessaie un peu plus tard.',
  unknown: "L'échange avec GitHub a échoué.",
};

export class GithubError extends Error {
  /** code : 'offline' | 'auth' | 'forbidden' | 'rate' | 'missing' | 'invalid' | 'server' | 'unknown' */
  constructor(code, { status = 0, detail = '' } = {}) {
    super(detail && code === 'invalid' ? `${MESSAGES[code]} (${detail})` : MESSAGES[code] || MESSAGES.unknown);
    this.name = 'GithubError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }

  /** Vrai si réessayer plus tard a des chances de marcher sans rien changer. */
  get temporary() {
    return this.code === 'offline' || this.code === 'server' || this.code === 'rate';
  }
}

export function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

const encodePath = (path) => String(path).split('/').map(encodeURIComponent).join('/');

function normalizeIssue(raw) {
  return {
    number: raw.number,
    title: String(raw.title || ''),
    body: String(raw.body || ''),
    state: raw.state === 'closed' ? 'closed' : 'open',
    url: String(raw.html_url || ''),
    createdAt: String(raw.created_at || ''),
    updatedAt: String(raw.updated_at || ''),
    closedAt: raw.closed_at || null,
    comments: Number(raw.comments || 0),
    labels: Array.isArray(raw.labels) ? raw.labels.map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean) : [],
  };
}

/**
 * createGithubClient({ repo: 'moi/ma-boite', token })
 * `fetchImpl` et `api` ne servent qu'aux tests (faux serveur).
 */
export function createGithubClient({ repo, token, fetchImpl = null, api = GITHUB_API }) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const base = `${api.replace(/\/+$/, '')}/repos/${repo}`;

  async function call(method, url, { body = null, accept = 'application/vnd.github+json', raw = false } = {}) {
    const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== null) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await doFetch(url, { method, headers, body: body === null ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch {
      throw new GithubError('offline');
    }
    if (response.ok) {
      if (raw) return new Uint8Array(await response.arrayBuffer());
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new GithubError('unknown', { status: response.status });
      }
    }
    let detail = '';
    try {
      const data = await response.json();
      detail = String((data && data.message) || '').slice(0, 160);
    } catch {
      /* réponse sans texte exploitable */
    }
    const status = response.status;
    const limited = response.headers && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after'));
    if (status === 401) throw new GithubError('auth', { status, detail });
    if (status === 429 || (status === 403 && (limited || /rate limit/i.test(detail)))) throw new GithubError('rate', { status, detail });
    if (status === 403) throw new GithubError('forbidden', { status, detail });
    if (status === 404 || status === 410) throw new GithubError('missing', { status, detail });
    if (status === 422 || status === 409 || status === 400) throw new GithubError('invalid', { status, detail });
    if (status >= 500) throw new GithubError('server', { status, detail });
    throw new GithubError('unknown', { status, detail });
  }

  return {
    repo,

    /** Vérifie que la boîte existe et que le jeton permet d'y lire les commentaires. */
    async check() {
      const info = await call('GET', base);
      await call('GET', `${base}/issues?per_page=1&state=all`);
      return {
        fullName: String(info.full_name || repo),
        private: info.private === true,
        issuesEnabled: info.has_issues !== false,
        owner: String((info.owner && info.owner.login) || ''),
        defaultBranch: String(info.default_branch || 'main'),
        webUrl: String(info.html_url || ''),
      };
    },

    async createIssue({ title, body, labels = [] }) {
      const created = await call('POST', `${base}/issues`, { body: { title, body, labels } });
      return { number: created.number, url: String(created.html_url || '') };
    },

    /** Issues de la boîte, les plus récemment modifiées d'abord. `since` : date ISO (facultative). */
    async listIssues({ state = 'open', since = null, perPage = 100, page = 1 } = {}) {
      const params = new URLSearchParams({ state, per_page: String(perPage), page: String(page), sort: 'updated', direction: 'desc' });
      if (since) params.set('since', since);
      const list = await call('GET', `${base}/issues?${params}`);
      return (Array.isArray(list) ? list : []).filter((item) => !item.pull_request).map(normalizeIssue);
    },

    async getIssue(number) {
      return normalizeIssue(await call('GET', `${base}/issues/${number}`));
    },

    /** Messages d'une issue, du plus ancien au plus récent. */
    async listComments(number) {
      const out = [];
      for (let page = 1; page <= 5; page++) {
        const list = await call('GET', `${base}/issues/${number}/comments?per_page=100&page=${page}`);
        if (!Array.isArray(list) || !list.length) break;
        for (const c of list) out.push({ id: c.id, body: String(c.body || ''), createdAt: String(c.created_at || ''), author: String((c.user && c.user.login) || '') });
        if (list.length < 100) break;
      }
      return out;
    },

    async addComment(number, body) {
      const created = await call('POST', `${base}/issues/${number}/comments`, { body: { body } });
      return { id: created.id, createdAt: String(created.created_at || '') };
    },

    /** state : 'open' ou 'closed'. */
    async setIssueState(number, state) {
      const payload = state === 'closed' ? { state: 'closed', state_reason: 'completed' } : { state: 'open' };
      return normalizeIssue(await call('PATCH', `${base}/issues/${number}`, { body: payload }));
    },

    /**
     * Dépose un fichier dans la boîte (capture d'écran). Si un fichier du même nom y est déjà
     * (envoi précédent interrompu), on considère que c'est fait. Renvoie { path }.
     */
    async uploadFile(path, bytes, message) {
      const url = `${base}/contents/${encodePath(path)}`;
      try {
        await call('PUT', url, { body: { message, content: toBase64(bytes) } });
      } catch (error) {
        if (!(error instanceof GithubError) || error.code !== 'invalid') throw error;
        await call('GET', url); // existe déjà : sinon, l'erreur d'origine remonte par cet appel
      }
      return { path };
    },

    /** Contenu d'un fichier de la boîte, en octets. */
    async downloadFile(path) {
      return call('GET', `${base}/contents/${encodePath(path)}`, { accept: 'application/vnd.github.raw+json', raw: true });
    },

    /** Dépose un fichier en remplaçant la version précédente s'il y en a une (relevé de la banque). */
    async putFile(path, bytes, message) {
      const url = `${base}/contents/${encodePath(path)}`;
      let sha = null;
      try {
        const info = await call('GET', url);
        sha = info && info.sha ? String(info.sha) : null;
      } catch (error) {
        if (!(error instanceof GithubError) || error.code !== 'missing') throw error;
      }
      await call('PUT', url, { body: { message, content: toBase64(bytes), ...(sha ? { sha } : {}) } });
      return { path, replaced: !!sha };
    },
  };
}
