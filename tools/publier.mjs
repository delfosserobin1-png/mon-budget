// Publier une nouvelle version de l'appli : contrôles, envoi, vérification du site publié.
//
//   node tools/publier.mjs verifier               tout contrôler sans rien envoyer
//   node tools/publier.mjs "Message de la version" contrôler, envoyer, attendre que le site soit à jour
//   options : --sans-tests   ne pas relancer les tests (à éviter : ils sont le filet de sécurité)
//             --sans-attendre ne pas attendre la mise en ligne
//
// Ce que fait la commande, dans l'ordre :
//   1. met à jour la liste des fichiers de www/sw.js (sans elle, les téléphones ne verraient pas la mise à jour) ;
//   2. vérifie que le numéro de version est le même partout, et qu'il est annoncé dans www/js/changelog.js ;
//   3. lance les tests du moteur, puis les parcours dans le navigateur ;
//   4. refait le fichier unique dist/mon-budget.html ;
//   5. enregistre et envoie les changements (git) : l'hébergeur publie alors le dossier www/ ;
//   6. attend que le site publié soit, fichier pour fichier, celui d'ici.
// Les téléphones prennent la nouvelle version au lancement suivant de l'appli.
//
// Réglages : mon-budget.config.json → { "adresse": "https://…/mon-budget/" } (l'adresse publique de l'appli).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeServiceWorker, updateServiceWorker, verifyDeployed } from './pwa.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = 'mon-budget.config.json';

const step = (text) => console.log(`\n▸ ${text}`);
const note = (text) => console.log(`  ${text}`);

export class PublishError extends Error {}

function readConfig(root) {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new PublishError(`${CONFIG_FILE} est illisible : ce doit être du JSON.`);
  }
}

/** Le numéro de version doit être annoncé en tête du journal affiché dans l'appli. */
export async function checkChangelog(root, version) {
  const { CHANGES } = await import(pathToFileURL(join(root, 'www', 'js', 'changelog.js')).href);
  if (!CHANGES.length || CHANGES[0].version !== version) {
    throw new PublishError(`www/js/changelog.js n'annonce pas la version ${version} : ajoute une entrée en tête de liste (c'est ce que l'appli affiche dans « Quoi de neuf »).`);
  }
  return CHANGES[0];
}

function runTests(root, label, pattern, extra = []) {
  step(label);
  const result = spawnSync(process.execPath, ['--test', ...extra, pattern], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  const count = (name) => Number((new RegExp(`^# ${name} (\\d+)`, 'm').exec(out) || [])[1] || 0);
  const failed = out.split('\n').filter((line) => /^not ok /.test(line));
  if (result.status !== 0 || count('fail') > 0) {
    for (const line of failed.slice(0, 15)) console.error(`  ✖ ${line.replace(/^not ok \d+ - /, '')}`);
    throw new PublishError(`${count('fail') || 'Des'} test(s) en échec : rien n'a été publié. Relance « npm run test:tout » pour le détail.`);
  }
  note(`${count('pass')} tests réussis`);
}

/** Tous les contrôles d'avant publication. Renvoie { version, build, count, entry }. */
export async function preflight({ root = ROOT, tests = true } = {}) {
  step('Liste des fichiers pour le fonctionnement sans connexion');
  const sw = updateServiceWorker({ root });
  note(`${sw.changed ? 'mise à jour' : 'déjà à jour'} : version ${sw.version}, ${sw.count} fichiers, empreinte ${sw.build}`);

  step('Numéro de version');
  const entry = await checkChangelog(root, sw.version);
  note(`version ${sw.version}, annoncée par : « ${entry.title} »`);

  if (tests) {
    runTests(root, 'Tests du moteur', 'tests/unit/*.test.js');
    runTests(root, 'Parcours dans le navigateur (deux à trois minutes)', 'tests/e2e/*.test.js', ['--test-concurrency=1']);
  } else {
    step('Tests');
    note('non relancés (--sans-tests)');
  }

  step('Fichier unique dist/mon-budget.html');
  execFileSync(process.execPath, [join(root, 'tools', 'build-single.mjs')], { cwd: root, stdio: 'pipe' });
  note('refait');
  // les tests ou la fabrication n'ont pas dû toucher à www/
  if (!computeServiceWorker({ root }).upToDate) throw new PublishError("www/ a changé pendant les contrôles : relance la commande.");
  return { ...sw, entry };
}

function git(root, args, { quiet = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (error.code === 'ENOENT') throw new PublishError("L'outil « git » n'est pas installé sur cet ordinateur : il est nécessaire pour publier (voir docs/publication.md).");
    if (quiet) return null;
    throw new PublishError(`git ${args[0]} a échoué : ${String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ')}`);
  }
}

/** Enregistre et envoie les changements. Renvoie true s'il y avait quelque chose à envoyer. */
export function push(root, message) {
  if (git(root, ['rev-parse', '--is-inside-work-tree'], { quiet: true }) !== 'true') {
    throw new PublishError("Ce dossier n'est pas encore relié à un dépôt git : la publication n'a pas été mise en place (voir docs/publication.md).");
  }
  if (!git(root, ['remote'], { quiet: true })) throw new PublishError("Aucun dépôt distant n'est réglé (git remote) : la publication n'a pas été mise en place (voir docs/publication.md).");
  git(root, ['add', '-A']);
  const pending = git(root, ['status', '--porcelain']);
  if (pending) git(root, ['commit', '-m', message]);
  const ahead = git(root, ['rev-list', '--count', '@{u}..HEAD'], { quiet: true });
  if (!pending && ahead === '0') return false;
  git(root, ['push']);
  return true;
}

/** Attend que le site publié soit identique aux fichiers d'ici (l'hébergeur met une à deux minutes). */
export async function waitForDeployment(url, { root = ROOT, timeoutMs = 10 * 60 * 1000, everyMs = 15000, log = note } = {}) {
  const started = Date.now();
  let last = null;
  for (;;) {
    try {
      last = await verifyDeployed(url, { root });
      if (last.ok) return last;
    } catch (error) {
      last = { ok: false, checked: 0, problems: [String(error.message || error)] };
    }
    if (Date.now() - started > timeoutMs) return last;
    log(`pas encore en ligne (${last.problems[0]}) — nouvel essai dans ${Math.round(everyMs / 1000)} s`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const words = argv.filter((a) => !a.startsWith('--'));
  const onlyCheck = words[0] === 'verifier';
  const report = await preflight({ tests: !flags.has('--sans-tests') });
  if (onlyCheck) {
    console.log(`\n✔ Tout est prêt pour publier la version ${report.version} (rien n'a été envoyé).`);
    return 0;
  }
  const message = words.join(' ').trim() || `Version ${report.version} : ${report.entry.title}`;
  step('Envoi');
  const sent = push(ROOT, message);
  note(sent ? `envoyé : « ${message} »` : "rien de nouveau à envoyer");

  const url = readConfig(ROOT).adresse;
  if (!url) {
    console.log(`\n✔ Version ${report.version} envoyée. (Adresse du site non réglée dans ${CONFIG_FILE} : mise en ligne non vérifiée.)`);
    return 0;
  }
  if (flags.has('--sans-attendre')) {
    console.log(`\n✔ Version ${report.version} envoyée. Vérifie plus tard : node tools/pwa.mjs verifier ${url}`);
    return 0;
  }
  step(`Mise en ligne sur ${url}`);
  const online = await waitForDeployment(url);
  if (!online.ok) {
    console.error(`\n✖ Le site publié n'est toujours pas identique aux fichiers d'ici : ${online.problems.slice(0, 3).join(' ; ')}`);
    console.error("  Regarde l'onglet « Actions » du dépôt : la publication y a peut-être échoué.");
    return 1;
  }
  console.log(`\n✔ Version ${report.version} en ligne (${online.checked} fichiers vérifiés). Les téléphones la prendront au prochain lancement de l'appli.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof PublishError) console.error(`\n✖ ${error.message}\n`);
    else console.error(`\n✖ Erreur inattendue : ${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}
