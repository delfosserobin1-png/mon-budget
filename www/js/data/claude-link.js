// La connexion à Claude : dépôt des commentaires dans la boîte privée (un dépôt GitHub) et
// relecture des réponses.
//
// Ce qui sort du téléphone, et seulement quand la connexion est réglée :
//   - le texte du commentaire, ce que l'utilisateur a noté « juste avant » ;
//   - les captures d'écran qu'il a choisi de joindre (uniquement si la boîte est privée) ;
//   - le diagnostic technique (version, appareil, compteurs, dernières erreurs).
// Les opérations, les montants, les enveloppes, les relevés ne sont jamais envoyés.
//
// Le réglage { repo, token, … } est rangé dans les réglages de l'appareil (clé LINK_KEY) : il ne
// fait pas partie des sauvegardes exportées et n'apparaît dans aucun diagnostic.

import { createGithubClient, GithubError } from '../io/github.js';
import { isEmpty } from '../core/changeset.js';
import {
  commentBody,
  commentTitle,
  followUpBody,
  kindLabel,
  parseMarker,
  planCommentSent,
  planFollowUp,
  planQueueComment,
  planRemoteUpdate,
  planRepliesSeen,
  queuedComments,
  threadFromRemote,
  unreadTotal,
} from '../core/comments.js';
import { extensionFor } from './backup.js';

export const LINK_KEY = 'link:claude';
export const SYNC_EVERY_MS = 10 * 60 * 1000;
const SINCE_MARGIN_MS = 2 * 60 * 1000;

const messageOf = (error) => (error instanceof GithubError ? error.message : `L'envoi a échoué (${String(error?.message || error).slice(0, 120)}).`);
const codeOf = (error) => (error instanceof GithubError ? error.code : 'unknown');

/**
 * createClaudeLink(store)
 * Options de test : fetchImpl (faux réseau), api (adresse d'un faux GitHub), online (fonction).
 */
export function createClaudeLink(store, { fetchImpl = null, api = undefined, online = () => typeof navigator === 'undefined' || navigator.onLine !== false } = {}) {
  const listeners = new Set();
  const status = { busy: false, lastSyncAt: 0, lastError: '', lastErrorCode: '' };
  let running = null;

  const config = () => {
    const saved = store.setting(LINK_KEY, null);
    return saved && typeof saved === 'object' && saved.repo && saved.token ? saved : null;
  };
  const clientFor = (cfg) => createGithubClient({ repo: cfg.repo, token: cfg.token, fetchImpl, ...(api ? { api } : {}) });
  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  };
  const apply = async (plan) => {
    if (plan.ok && !isEmpty(plan.cs)) await store.commit(plan.cs, { undoable: false });
    return plan;
  };
  const remember = (error) => {
    status.lastError = error ? messageOf(error) : '';
    status.lastErrorCode = error ? codeOf(error) : '';
  };

  /** Vérifie l'adresse et le jeton, puis enregistre la connexion. */
  async function connect({ repo, token, allowPublic = false }) {
    let info;
    try {
      info = await createGithubClient({ repo, token, fetchImpl, ...(api ? { api } : {}) }).check();
    } catch (error) {
      return { ok: false, code: codeOf(error), error: messageOf(error) };
    }
    if (!info.issuesEnabled) return { ok: false, code: 'issues', error: 'Les « issues » sont désactivées sur ce dépôt : active-les dans ses réglages, sur GitHub.' };
    if (!info.private && !allowPublic) {
      return { ok: false, code: 'public', info, error: 'Ce dépôt est public : tout le monde pourrait lire tes commentaires. Utilise plutôt un dépôt privé.' };
    }
    await store.setSetting(LINK_KEY, { repo: info.fullName, token, private: info.private, connectedAt: new Date().toISOString(), lastPullAt: null });
    remember(null);
    emit();
    return { ok: true, info };
  }

  async function disconnect() {
    await store.setSetting(LINK_KEY, undefined);
    remember(null);
    status.lastSyncAt = 0;
    emit();
  }

  /** Un envoi précédent a pu aboutir juste avant une coupure : on cherche le commentaire dans la boîte. */
  async function findExisting(gh, reportId) {
    const issues = await gh.listIssues({ state: 'all', perPage: 50 });
    const hit = issues.find((issue) => parseMarker(issue.body)?.id === reportId);
    return hit ? { number: hit.number, url: hit.url } : null;
  }

  async function uploadCaptures(gh, cfg, report) {
    const attachments = [];
    const notes = [];
    if (!report.photoIds.length) return { attachments, notes };
    if (!cfg.private) {
      notes.push("Les captures d'écran n'ont pas été envoyées : cette boîte à commentaires est publique.");
      return { attachments, notes };
    }
    let n = 0;
    for (const photoId of report.photoIds) {
      n++;
      const blob = await store.readBlob(photoId);
      if (!blob) continue;
      const path = `captures/${report.id}-${n}.${extensionFor(blob.mime)}`;
      try {
        await gh.uploadFile(path, blob.bytes, `Capture du commentaire ${report.id}`);
        attachments.push(path);
      } catch (error) {
        // Seul un refus propre à ce fichier (droit « Contents » manquant, fichier refusé) n'empêche pas
        // d'envoyer le texte ; toute autre erreur fait réessayer l'ensemble plus tard.
        if (!(error instanceof GithubError) || (error.code !== 'forbidden' && error.code !== 'invalid')) throw error;
        notes.push(error.code === 'forbidden' ? `Capture ${n} non envoyée : le jeton n'a pas l'autorisation « Contents ».` : `Capture ${n} non envoyée : GitHub l'a refusée.`);
      }
    }
    return { attachments, notes };
  }

  /**
   * Dépose un commentaire dans la boîte. En cas d'échec, il reste « en attente » et repartira tout
   * seul. Un même commentaire n'est jamais envoyé deux fois en parallèle (bouton + envoi de fond).
   */
  const sending = new Map();
  function send(id) {
    if (!sending.has(id)) sending.set(id, sendNow(id).finally(() => sending.delete(id)));
    return sending.get(id);
  }

  async function sendNow(id) {
    const cfg = config();
    const report = store.state.bugReports.find((r) => r.id === id);
    if (!report) return { ok: false, code: 'gone', error: "Ce commentaire n'existe plus." };
    if (report.remote) return { ok: true, number: report.remote.number, already: true };
    if (!cfg) return { ok: false, code: 'not-connected', error: "La connexion à Claude n'est pas réglée." };
    const retried = report.queued;
    try {
      await apply(planQueueComment(store.state, id, true));
      const gh = clientFor(cfg);
      let issue = retried ? await findExisting(gh, id) : null;
      if (!issue) {
        const { attachments, notes } = await uploadCaptures(gh, cfg, report);
        issue = await gh.createIssue({ title: commentTitle(report), body: commentBody(report, { attachments, notes }), labels: ['mon-budget', kindLabel(report.kind).toLowerCase()] });
      }
      await apply(planCommentSent(store.state, id, { number: issue.number, url: issue.url }));
      remember(null);
      emit();
      return { ok: true, number: issue.number };
    } catch (error) {
      remember(error);
      emit();
      return { ok: false, queued: true, code: codeOf(error), error: messageOf(error) };
    }
  }

  /** Relit l'état et les réponses des commentaires déjà déposés. Renvoie le nombre de fiches mises à jour. */
  async function pull(cfg) {
    const tracked = store.state.bugReports.filter((r) => r.remote);
    if (!tracked.length) return 0;
    const startedAt = new Date();
    const since = cfg.lastPullAt ? new Date(Date.parse(cfg.lastPullAt) - SINCE_MARGIN_MS).toISOString() : null;
    const gh = clientFor(cfg);
    const issues = await gh.listIssues({ state: 'all', since });
    const byNumber = new Map(issues.map((issue) => [issue.number, issue]));
    let updated = 0;
    for (const report of tracked) {
      const issue = byNumber.get(report.remote.number);
      if (!issue) continue;
      const thread = issue.comments > 0 ? threadFromRemote(await gh.listComments(issue.number)) : [];
      const plan = planRemoteUpdate(store.state, report.id, { state: issue.state, thread });
      if (plan.ok && !isEmpty(plan.cs)) {
        await store.commit(plan.cs, { undoable: false });
        updated++;
      }
    }
    const current = config();
    if (current && current.repo === cfg.repo) await store.setSetting(LINK_KEY, { ...current, lastPullAt: startedAt.toISOString() }, { silent: true });
    return updated;
  }

  /**
   * Envoie ce qui attend, puis relit les réponses. `force: false` (démarrage, retour au premier
   * plan) ne fait rien si un échange a eu lieu il y a moins de dix minutes.
   */
  function sync({ force = false } = {}) {
    if (running) return running;
    const cfg = config();
    if (!cfg) return Promise.resolve({ ok: false, code: 'not-connected' });
    if (!online()) return Promise.resolve({ ok: false, code: 'offline', error: 'Pas de connexion à internet.' });
    if (!force && status.lastSyncAt && Date.now() - status.lastSyncAt < SYNC_EVERY_MS) return Promise.resolve({ ok: true, skipped: true, sent: 0, updated: 0 });
    running = (async () => {
      status.busy = true;
      emit();
      const unreadBefore = unreadTotal(store.state);
      let sent = 0;
      try {
        for (const report of queuedComments(store.state)) {
          const result = await send(report.id);
          if (!result.ok) return { ok: false, code: result.code, error: result.error, sent, updated: 0 };
          sent++;
        }
        const updated = await pull(cfg);
        status.lastSyncAt = Date.now();
        remember(null);
        return { ok: true, sent, updated, newReplies: Math.max(0, unreadTotal(store.state) - unreadBefore) };
      } catch (error) {
        remember(error);
        return { ok: false, code: codeOf(error), error: messageOf(error), sent, updated: 0 };
      } finally {
        status.busy = false;
        running = null;
        emit();
      }
    })();
    return running;
  }

  /** Répond dans le fil d'un commentaire déjà déposé (il faut être connecté à internet). */
  async function reply(id, text) {
    const cfg = config();
    const report = store.state.bugReports.find((r) => r.id === id);
    const body = String(text || '').trim();
    if (!body) return { ok: false, code: 'empty', error: 'Écris ta réponse.' };
    if (!cfg || !report || !report.remote) return { ok: false, code: 'not-connected', error: "Ce commentaire n'a pas encore été envoyé à Claude." };
    try {
      const gh = clientFor(cfg);
      const created = await gh.addComment(report.remote.number, followUpBody(body));
      if (report.remote.state === 'closed') await gh.setIssueState(report.remote.number, 'open');
      await apply(planFollowUp(store.state, id, { messageId: created.id, text: body, at: created.createdAt || new Date().toISOString() }));
      remember(null);
      emit();
      return { ok: true };
    } catch (error) {
      return { ok: false, code: codeOf(error), error: messageOf(error) };
    }
  }

  async function markSeen(id) {
    await apply(planRepliesSeen(store.state, id));
  }

  return {
    connect,
    disconnect,
    send,
    sync,
    reply,
    markSeen,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get connected() {
      return !!config();
    },
    /** Un fichier de la boîte privée (le relevé de la banque déposé par l'ordinateur), en octets. */
    async download(path) {
      const cfg = config();
      if (!cfg) return { ok: false, code: 'not-connected', error: "La connexion à ta boîte privée n'est pas réglée : Plus › Connexion à Claude." };
      try {
        return { ok: true, bytes: await clientFor(cfg).downloadFile(path) };
      } catch (error) {
        return { ok: false, code: codeOf(error), error: messageOf(error) };
      }
    },
    /** Ce qu'on peut afficher de la connexion (jamais le jeton). */
    get info() {
      const cfg = config();
      return cfg ? { repo: cfg.repo, private: cfg.private === true, connectedAt: cfg.connectedAt || null, lastPullAt: cfg.lastPullAt || null } : null;
    },
    get status() {
      return { ...status };
    },
  };
}
