// Les commentaires envoyés depuis l'appli, vus de l'ordinateur : l'outil de Claude.
//
//   node tools/commentaires.mjs lire                   les commentaires à traiter (captures téléchargées)
//   node tools/commentaires.mjs lire --tous            y compris ceux déjà traités
//   node tools/commentaires.mjs voir 12                un commentaire et tout son fil
//   node tools/commentaires.mjs repondre 12 "texte"    répondre : la réponse s'affiche dans l'appli
//   node tools/commentaires.mjs clore 12 "texte"       répondre et marquer « traité »
//   node tools/commentaires.mjs rouvrir 12             remettre « à traiter »
//   (ajouter --json à lire / voir pour une sortie exploitable par un programme)
//
// Réglages : mon-budget.config.json à la racine du projet → { "commentaires": "ton-nom/ta-boite" }.
// Jeton d'accès : variable MON_BUDGET_JETON, sinon GH_TOKEN / GITHUB_TOKEN, sinon celui de l'outil
// « gh » (gh auth token). Il n'est jamais écrit dans un fichier du projet.
//
// Les captures sont rangées dans commentaires/n-<numéro>/ (dossier ignoré par git : elles peuvent
// montrer des montants).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGithubClient, GithubError } from '../www/js/io/github.js';
import { cleanMessage, kindLabel, parseMarker, parseRepo, screenLabel, targetText, threadFromRemote } from '../www/js/core/comments.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = 'mon-budget.config.json';
export const OUT_DIR = 'commentaires';

export class UsageError extends Error {}

export function readConfig(root = ROOT) {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new UsageError(`${CONFIG_FILE} est illisible : ce doit être du JSON, par exemple { "commentaires": "ton-nom/mon-budget-commentaires" }.`);
  }
}

/** Le jeton d'accès : une variable d'environnement, sinon celui de l'outil « gh » (si `gh` vaut true). */
export function resolveToken(env = process.env, { gh = true } = {}) {
  for (const name of ['MON_BUDGET_JETON', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    if (env[name] && env[name].trim()) return env[name].trim();
  }
  if (!gh) return null;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

const day = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/** Sépare le texte de l'utilisateur du diagnostic technique replié et des lignes invisibles. */
export function splitBody(body) {
  let diagnostics = '';
  let rest = String(body || '').replace(/\r\n/g, '\n');
  rest = rest.replace(/<details>[\s\S]*?`{4}text\n([\s\S]*?)\n`{4}[\s\S]*?<\/details>/, (match, inner) => {
    diagnostics = inner;
    return '';
  });
  const lines = cleanMessage(rest).split('\n');
  if (/^\*\*.+\*\* — écran « /.test(lines[0] || '')) lines.shift();
  // l'élément visé (bouton IA) est rendu à part, à partir du marqueur
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\*\*Élément visé\*\* : /.test(lines[i])) {
      if (lines[i + 1] === '' && /^`.*`$/.test(lines[i + 2] || '')) i += 2;
      continue;
    }
    kept.push(lines[i]);
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), diagnostics };
}

/** Met une issue et ses messages sous une forme simple à lire et à traiter. */
export function describe(issue, comments = []) {
  const marker = parseMarker(issue.body);
  const { text, diagnostics } = splitBody(issue.body);
  const thread = threadFromRemote(comments);
  const last = thread[thread.length - 1];
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    fromApp: !!marker,
    id: marker ? marker.id : null,
    kind: marker ? marker.kind : null,
    kindLabel: marker ? kindLabel(marker.kind) : 'Écrit hors de l\'appli',
    screen: marker ? marker.screen : '',
    screenLabel: marker ? screenLabel(marker.screen) : '',
    version: marker ? marker.version : '',
    captures: marker && Array.isArray(marker.captures) ? marker.captures : [],
    // commentaire fait au bouton IA : l'élément entouré (écran, chemin dans le code, libellé, position)
    target: marker && marker.target && typeof marker.target === 'object' ? marker.target : null,
    text,
    diagnostics,
    thread,
    // À qui de jouer : tant que le dernier mot n'est pas de Claude, c'est à Claude de répondre.
    waitingFor: issue.state === 'closed' ? 'personne' : last && last.from === 'claude' ? 'utilisateur' : 'claude',
  };
}

function render(item, files = []) {
  const head = [`n° ${item.number}`, item.kindLabel];
  if (item.screenLabel) head.push(`écran ${item.screenLabel}`);
  if (item.version) head.push(`version ${item.version}`);
  head.push(day(item.createdAt));
  if (item.state === 'closed') head.push('traité');
  const lines = [`── ${head.join(' · ')} ──`, item.text || item.title];
  if (item.target) {
    lines.push('', `Élément visé : ${targetText(item.target)}`);
    if (item.target.path) lines.push(`  ${item.target.path}`);
  }
  if (files.length) lines.push('', `Captures : ${files.join(', ')}`);
  if (item.thread.length) {
    lines.push('', 'Fil :');
    for (const message of item.thread) lines.push(`  [${message.from === 'claude' ? 'Claude' : 'utilisateur'}, ${day(message.at)}] ${message.text.replace(/\n/g, '\n    ')}`);
  }
  lines.push('', item.waitingFor === 'claude' ? '→ à traiter' : item.waitingFor === 'utilisateur' ? "→ en attente d'une réponse de l'utilisateur" : '→ traité');
  return lines.join('\n');
}

async function fetchCaptures(client, item, root) {
  const saved = [];
  if (!item.captures.length) return saved;
  const dir = join(root, OUT_DIR, `n-${item.number}`);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const path of item.captures) {
    n++;
    // on n'écrit jamais ailleurs que dans le dossier du commentaire, quel que soit le chemin annoncé
    const extension = (/\.([a-z0-9]{1,5})$/i.exec(path) || [])[1] || 'bin';
    const target = join(dir, `capture-${n}.${extension}`);
    try {
      if (!existsSync(target)) writeFileSync(target, await client.downloadFile(path));
      saved.push(`${OUT_DIR}/n-${item.number}/capture-${n}.${extension}`);
    } catch (error) {
      saved.push(`(capture ${n} illisible : ${error.message})`);
    }
  }
  return saved;
}

function numberOf(value) {
  const n = Number.parseInt(String(value || '').replace(/^n°\s*|^#/i, ''), 10);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError('Indique le numéro du commentaire, par exemple : voir 12');
  return n;
}

/**
 * Exécute une commande. Renvoie le code de sortie (0 = tout va bien).
 * Options de test : env, root, log / fail (affichage), fetchImpl, gh (false = ne pas demander le
 * jeton à l'outil « gh »).
 */
export async function run(argv, { env = process.env, root = ROOT, log = console.log, fail = console.error, fetchImpl = null, gh = true } = {}) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [command, ...rest] = argv.filter((a) => !a.startsWith('--'));
  const json = flags.has('--json');
  try {
    if (!command || !['lire', 'voir', 'repondre', 'clore', 'rouvrir'].includes(command)) {
      throw new UsageError('Usage : node tools/commentaires.mjs lire [--tous] | voir <n°> | repondre <n°> "texte" | clore <n°> "texte" | rouvrir <n°>   (--json possible avec lire et voir)');
    }
    const config = readConfig(root);
    const repo = parseRepo(env.MON_BUDGET_COMMENTAIRES || config.commentaires);
    if (!repo) throw new UsageError(`La boîte à commentaires n'est pas réglée : indique son adresse dans ${CONFIG_FILE}, par exemple { "commentaires": "ton-nom/mon-budget-commentaires" }.`);
    const token = resolveToken(env, { gh });
    if (!token) throw new UsageError("Aucun jeton d'accès trouvé : connecte l'outil « gh » (gh auth login), ou définis la variable MON_BUDGET_JETON.");
    const client = createGithubClient({ repo, token, fetchImpl, ...(env.MON_BUDGET_GITHUB_API ? { api: env.MON_BUDGET_GITHUB_API } : {}) });

    if (command === 'lire') {
      const issues = await client.listIssues({ state: flags.has('--tous') ? 'all' : 'open' });
      issues.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)); // du plus ancien au plus récent : l'ordre de traitement
      const items = [];
      for (const issue of issues) {
        const item = describe(issue, issue.comments > 0 ? await client.listComments(issue.number) : []);
        item.files = await fetchCaptures(client, item, root);
        items.push(item);
      }
      if (json) log(JSON.stringify(items, null, 2));
      else if (!items.length) log(`Aucun commentaire ${flags.has('--tous') ? '' : 'à traiter '}dans ${repo}.`);
      else {
        const todo = items.filter((i) => i.waitingFor === 'claude').length;
        log(`${items.length} commentaire${items.length > 1 ? 's' : ''} dans ${repo}, dont ${todo} à traiter.\n`);
        for (const item of items) log(`${render(item, item.files)}\n`);
      }
      return 0;
    }

    const number = numberOf(rest[0]);
    if (command === 'voir') {
      const issue = await client.getIssue(number);
      const item = describe(issue, await client.listComments(number));
      item.files = await fetchCaptures(client, item, root);
      if (json) log(JSON.stringify(item, null, 2));
      else {
        log(render(item, item.files));
        if (item.diagnostics) log(`\nInformations techniques :\n${item.diagnostics}`);
      }
      return 0;
    }
    if (command === 'rouvrir') {
      await client.setIssueState(number, 'open');
      log(`Commentaire n° ${number} remis « à traiter ».`);
      return 0;
    }
    const text = rest.slice(1).join(' ').trim();
    if (!text) throw new UsageError(`Écris le texte de la réponse entre guillemets : ${command} ${number} "…"`);
    await client.addComment(number, text);
    if (command === 'clore') {
      await client.setIssueState(number, 'closed');
      log(`Réponse envoyée, commentaire n° ${number} marqué « traité ».`);
    } else log(`Réponse envoyée au commentaire n° ${number}.`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError || error instanceof GithubError) fail(error.message);
    else fail(`Erreur inattendue : ${error?.stack || error}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
