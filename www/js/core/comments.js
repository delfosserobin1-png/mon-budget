// Commentaires pour Claude : ce que l'utilisateur écrit dans l'appli pour demander une correction
// ou une évolution, et le fil de la discussion qui s'ensuit.
//
// Un commentaire est une fiche « bugReports » (le nom vient de la première version, où ce n'étaient
// que des signalements de bugs). Sans connexion réglée, il reste dans le téléphone et se partage à
// la main. Avec la connexion à Claude, il est déposé dans la « boîte à commentaires » : un dépôt
// GitHub privé où chaque commentaire devient une « issue ». Claude y répond ; l'appli relit les
// réponses et les affiche sous le commentaire.
//
// Ce fichier ne contient que de la logique pure (aucun réseau, aucun écran) : mise en forme du
// texte envoyé, lecture de ce qui revient, statuts, et lots de modifications correspondants.

import { Draft } from './changeset.js';

export const COMMENT_KINDS = Object.freeze([
  { id: 'bug', label: 'Problème', hint: 'Quelque chose ne marche pas comme prévu' },
  { id: 'idee', label: 'Idée', hint: 'Une amélioration, une nouveauté' },
  { id: 'question', label: 'Question', hint: 'Je ne comprends pas quelque chose' },
]);

export function kindLabel(id) {
  return (COMMENT_KINDS.find((k) => k.id === id) || COMMENT_KINDS[0]).label;
}

/** Les écrans de l'appli, tels que l'utilisateur les connaît (pour dire de quoi parle un commentaire). */
export const SCREEN_NAMES = Object.freeze({
  operations: 'Opérations',
  envelopes: 'Enveloppes',
  envelope: "Fiche d'une enveloppe",
  forecast: 'Prévisions',
  stats: 'Stats',
  more: 'Plus',
  statement: "Import d'un relevé",
  reconcile: 'Rapprochement',
  archives: 'Archives',
  backup: 'Sauvegarde et données',
  tags: 'Tags',
  rules: 'Règles automatiques',
  security: 'Sécurité',
  about: 'À propos',
  guide: "Mode d'emploi",
  bugs: 'Commentaires',
  claude: 'Connexion à Claude',
  all: "Toute l'appli",
});

export function screenLabel(id) {
  return SCREEN_NAMES[id] || SCREEN_NAMES.all;
}

// ---------------------------------------------------------------------------------------------
// Réglage de la connexion
// ---------------------------------------------------------------------------------------------

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const NAME = '[A-Za-z0-9._-]{1,100}';
const TOKEN = /^[A-Za-z0-9_]{20,255}$/;

/**
 * Reconnaît l'adresse d'un dépôt GitHub, quelle que soit la façon de l'écrire :
 * « moi/ma-boite », « github.com/moi/ma-boite », « https://github.com/moi/ma-boite.git »…
 * Renvoie « moi/ma-boite », ou null si ce n'en est pas une.
 */
export function parseRepo(text) {
  let value = String(text || '').trim();
  value = value.replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const m = new RegExp(`^(${OWNER})/(${NAME})$`).exec(value);
  if (!m || m[2] === '.' || m[2] === '..') return null;
  return `${m[1]}/${m[2]}`;
}

export function isToken(text) {
  return TOKEN.test(String(text || '').trim());
}

/**
 * Lit un « code de connexion » collé d'un bloc : « moi/ma-boite:jeton », « moi/ma-boite jeton »,
 * ou { "depot": "moi/ma-boite", "jeton": "…" }. Renvoie { repo, token } ou null.
 */
export function parseLinkCode(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (value.startsWith('{')) {
    try {
      const obj = JSON.parse(value);
      const repo = parseRepo(obj.depot || obj.repo || obj.boite);
      const token = String(obj.jeton || obj.token || '').trim();
      return repo && isToken(token) ? { repo, token } : null;
    } catch {
      return null;
    }
  }
  const m = /^(\S+?)(?:\s*[:#]\s*|\s+)([A-Za-z0-9_]{20,255})$/.exec(value);
  if (!m) return null;
  const repo = parseRepo(m[1]);
  return repo ? { repo, token: m[2] } : null;
}

// ---------------------------------------------------------------------------------------------
// Ce qui part dans la boîte à commentaires
// ---------------------------------------------------------------------------------------------

const MARKER = /<!--\s*mon-budget\s+(\{[\s\S]*?\})\s*-->/g;
const FOLLOW_UP = '<!-- mon-budget:suite -->';

const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/** Titre de l'issue : « [Problème] première phrase du commentaire ». */
export function commentTitle(report) {
  const first = oneLine(String(report.text || '').split('\n')[0]);
  const short = first.length > 72 ? `${first.slice(0, 71).trimEnd()}…` : first;
  return `[${kindLabel(report.kind)}] ${short || 'Commentaire'}`;
}

/**
 * Corps de l'issue : le texte de l'utilisateur, le contexte, le diagnostic technique replié, et
 * une ligne invisible (« marqueur ») qui permet aux outils de relire les informations sans se
 * fier à la mise en forme. `attachments` : chemins des captures déposées dans la boîte.
 * `notes` : phrases à ajouter (ex. une capture qui n'a pas pu être envoyée).
 */
export function commentBody(report, { attachments = [], notes = [] } = {}) {
  const lines = [`**${kindLabel(report.kind)}** — écran « ${screenLabel(report.screen)} » — Mon Budget ${report.appVersion || '?'}`, '', String(report.text || '').trim()];
  if (report.steps) lines.push('', '**Juste avant**', '', String(report.steps).trim());
  if (attachments.length) {
    lines.push('', `**${attachments.length > 1 ? 'Captures jointes' : 'Capture jointe'}**`, '');
    for (const path of attachments) lines.push(`- \`${path}\``);
  }
  for (const note of notes) lines.push('', `_${note}_`);
  if (report.diagnostics) {
    // une suite de quatre accents graves ou plus dans le diagnostic fermerait le bloc : on la casse
    const safe = String(report.diagnostics).replace(/`{4,}/g, '```');
    lines.push('', '<details><summary>Informations techniques</summary>', '', '````text', safe, '````', '', '</details>');
  }
  const marker = { id: report.id, kind: report.kind || 'bug', screen: report.screen || '', version: report.appVersion || '', at: report.createdAt || '', captures: attachments };
  lines.push('', `<!-- mon-budget ${JSON.stringify(marker)} -->`);
  return lines.join('\n');
}

/** Relit le marqueur d'un corps d'issue (le dernier, s'il y en a plusieurs). Renvoie l'objet ou null. */
export function parseMarker(body) {
  let found = null;
  for (const m of String(body || '').matchAll(MARKER)) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj === 'object' && typeof obj.id === 'string') found = obj;
    } catch {
      /* marqueur abîmé : on l'ignore */
    }
  }
  return found;
}

/** Texte d'une réponse écrite dans l'appli (le marqueur dit qu'elle vient de l'utilisateur, pas de Claude). */
export function followUpBody(text) {
  return `${String(text || '').trim()}\n\n${FOLLOW_UP}`;
}

export function isFollowUp(body) {
  return String(body || '').includes(FOLLOW_UP);
}

/** Retire les lignes invisibles d'un message avant de l'afficher. */
export function cleanMessage(body) {
  return String(body || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Transforme les messages d'une issue (tels que GitHub les renvoie) en fil de discussion :
 * [{ id, at, from: 'claude' | 'moi', text }], du plus ancien au plus récent.
 */
export function threadFromRemote(comments) {
  const out = [];
  for (const c of comments || []) {
    const text = cleanMessage(c.body);
    if (!text) continue;
    out.push({ id: String(c.id), at: String(c.createdAt || c.created_at || ''), from: isFollowUp(c.body) ? 'moi' : 'claude', text });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// Statuts
// ---------------------------------------------------------------------------------------------

/** Nombre de réponses de Claude pas encore lues pour ce commentaire. */
export function unreadReplies(report) {
  const remote = report.remote;
  if (!remote) return 0;
  const fromClaude = remote.thread.filter((m) => m.from === 'claude').length;
  return Math.max(0, fromClaude - remote.seen);
}

export function unreadTotal(state) {
  let total = 0;
  for (const report of state.bugReports) total += unreadReplies(report);
  return total;
}

/**
 * Où en est un commentaire :
 *   'local'    écrit, jamais envoyé ni partagé
 *   'shared'   partagé à la main (mail, messagerie…)
 *   'queued'   envoi demandé, en attente de connexion
 *   'sent'     déposé dans la boîte, pas encore de réponse
 *   'answered' Claude a répondu et la réponse n'a pas encore été lue
 *   'talking'  discussion en cours (réponses lues, pas encore traité)
 *   'done'     traité
 */
export function commentStatus(report) {
  const remote = report.remote;
  if (!remote) return report.queued ? 'queued' : report.sentAt ? 'shared' : 'local';
  if (unreadReplies(report) > 0) return 'answered';
  if (remote.state === 'closed') return 'done';
  return remote.thread.some((m) => m.from === 'claude') ? 'talking' : 'sent';
}

export const STATUS_LABELS = Object.freeze({
  local: { label: 'À envoyer', tone: 'plain' },
  shared: { label: 'Partagé', tone: 'good' },
  queued: { label: 'En attente de connexion', tone: 'warn' },
  sent: { label: 'Envoyé à Claude', tone: 'plain' },
  answered: { label: 'Réponse de Claude', tone: 'blue' },
  talking: { label: 'En discussion', tone: 'plain' },
  done: { label: 'Traité', tone: 'good' },
});

/** Les commentaires dont l'envoi a été demandé et n'a pas encore abouti, du plus ancien au plus récent. */
export function queuedComments(state) {
  return state.bugReports.filter((r) => r.queued && !r.remote).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// Lots de modifications
// ---------------------------------------------------------------------------------------------

function editReport(state, id, change) {
  const draft = new Draft(state);
  const current = draft.get('bugReports', id);
  if (!current) return { ok: false, errors: [{ field: 'id', message: "Ce commentaire n'existe plus." }] };
  const next = change(current);
  if (next && next !== current) draft.put('bugReports', next);
  return { ok: true, cs: draft.cs, report: next || current };
}

/** Marque (ou démarque) un commentaire « à envoyer dès que possible ». */
export function planQueueComment(state, id, queued = true) {
  return editReport(state, id, (report) => (report.queued === queued || report.remote ? report : { ...report, queued }));
}

/** Le commentaire a été déposé dans la boîte : on retient son numéro et son adresse. */
export function planCommentSent(state, id, { number, url = '', at = new Date().toISOString() }) {
  return editReport(state, id, (report) => ({
    ...report,
    queued: false,
    sentAt: report.sentAt || at,
    remote: { number, url, state: 'open', thread: [], seen: 0, syncedAt: at },
  }));
}

const sameThread = (a, b) => a.length === b.length && a.every((m, i) => m.id === b[i].id && m.text === b[i].text && m.from === b[i].from);

/** Ce qui est revenu de la boîte pour ce commentaire : état (ouvert / traité) et fil de discussion. */
export function planRemoteUpdate(state, id, { state: remoteState, thread, at = new Date().toISOString() }) {
  return editReport(state, id, (report) => {
    if (!report.remote) return report;
    const nextState = remoteState === 'closed' ? 'closed' : 'open';
    if (report.remote.state === nextState && sameThread(report.remote.thread, thread)) return report;
    return { ...report, remote: { ...report.remote, state: nextState, thread, syncedAt: at } };
  });
}

/** L'utilisateur a lu les réponses de Claude. */
export function planRepliesSeen(state, id) {
  return editReport(state, id, (report) => {
    if (!report.remote) return report;
    const fromClaude = report.remote.thread.filter((m) => m.from === 'claude').length;
    return report.remote.seen === fromClaude ? report : { ...report, remote: { ...report.remote, seen: fromClaude } };
  });
}

/** L'utilisateur a répondu dans le fil : son message s'y ajoute, et un commentaire traité se rouvre. */
export function planFollowUp(state, id, { messageId, text, at = new Date().toISOString() }) {
  return editReport(state, id, (report) => {
    if (!report.remote) return report;
    const thread = [...report.remote.thread, { id: String(messageId), at, from: 'moi', text: String(text || '').trim() }];
    return { ...report, remote: { ...report.remote, state: 'open', thread, syncedAt: at } };
  });
}
