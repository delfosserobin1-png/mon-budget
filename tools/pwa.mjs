// Tient à jour la liste des fichiers de l'appli installable (PWA) dans www/sw.js.
//
// Le « service worker » (www/sw.js) télécharge tous les fichiers de l'appli pour qu'elle marche
// sans connexion. Il lui faut donc la liste exacte de ces fichiers, avec l'empreinte de chacun :
// c'est aussi cette liste qui lui permet de savoir qu'une nouvelle version a été publiée.
//
//   node tools/pwa.mjs                 met la liste à jour (à lancer après toute modification de www/)
//   node tools/pwa.mjs verifier        dit si la liste est à jour (code de sortie 1 sinon)
//   node tools/pwa.mjs verifier <url>  compare un site publié aux fichiers d'ici, un par un
//
// « npm test » échoue si la liste n'est pas à jour : impossible de publier une version bancale.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const WWW = join(ROOT, 'www');
const START = '/* GENERE:DEBUT */';
const END = '/* GENERE:FIN */';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Ce qui n'a pas à être mis en réserve : le service worker lui-même, les textes de licence, les
 * fichiers et dossiers cachés (leur nom commence par un point).
 */
function skipped(path) {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  return path === 'sw.js' || parts.some((part) => part.startsWith('.')) || /^(LICENSE|LICENCE)/i.test(name) || name.endsWith('.map');
}

/** Tous les fichiers de www/ à mettre en réserve, chemins relatifs avec des « / », triés. */
export function listFiles(www = WWW) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else if (!skipped(rel)) out.push(rel);
    }
  };
  walk(www, '');
  return out.sort();
}

function splitServiceWorker(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < 0 || end < start) throw new Error('Repères GENERE:DEBUT / GENERE:FIN introuvables dans www/sw.js');
  return { before: source.slice(0, start), after: source.slice(end + END.length) };
}

/** Version de l'appli : celle de package.json, qui doit être aussi celle affichée par l'appli. */
export function readVersion(root = ROOT) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const app = readFileSync(join(root, 'www', 'js', 'ui', 'app.js'), 'utf8');
  const shown = (/export const APP_VERSION = '([^']+)'/.exec(app) || [])[1];
  if (shown !== version) throw new Error(`Versions différentes : package.json dit ${version}, www/js/ui/app.js dit ${shown}. Mets les deux au même numéro.`);
  return version;
}

/** Calcule la liste, les empreintes et le texte attendu de www/sw.js. */
export function computeServiceWorker({ root = ROOT } = {}) {
  const www = join(root, 'www');
  const version = readVersion(root);
  const files = listFiles(www).map((path) => [path, sha256(readFileSync(join(www, path)))]);
  const current = readFileSync(join(www, 'sw.js'), 'utf8');
  const { before, after } = splitServiceWorker(current);
  // L'empreinte de la version dépend de chaque fichier ET du code du service worker lui-même.
  const build = sha256([version, ...files.map(([path, hash]) => `${path}:${hash}`), before, after].join('\n')).slice(0, 16);
  const block = [
    START,
    `const VERSION = ${JSON.stringify(version)};`,
    `const BUILD = ${JSON.stringify(build)};`,
    'const FILES = [',
    ...files.map(([path, hash]) => `  [${JSON.stringify(path)}, ${JSON.stringify(hash)}],`),
    '];',
    END,
  ].join('\n');
  const expected = `${before}${block}${after}`;
  return { version, build, files, expected, current, upToDate: expected === current };
}

/** Réécrit www/sw.js si nécessaire. Renvoie { changed, version, build, count }. */
export function updateServiceWorker({ root = ROOT } = {}) {
  const result = computeServiceWorker({ root });
  if (!result.upToDate) writeFileSync(join(root, 'www', 'sw.js'), result.expected);
  return { changed: !result.upToDate, version: result.version, build: result.build, count: result.files.length };
}

/**
 * Compare un site publié aux fichiers locaux : même service worker, mêmes fichiers, octet pour octet.
 * Renvoie { ok, checked, problems: [texte] }.
 */
export async function verifyDeployed(url, { root = ROOT, fetchImpl = fetch } = {}) {
  const base = url.endsWith('/') ? url : `${url}/`;
  const { files, expected } = computeServiceWorker({ root });
  const problems = [];
  const get = async (path) => {
    const response = await fetchImpl(new URL(path, base), { cache: 'no-store' });
    if (!response.ok) throw new Error(`réponse ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };
  try {
    const remote = await get('sw.js');
    if (sha256(remote) !== sha256(Buffer.from(expected))) problems.push('sw.js : la version publiée est différente de celle d\'ici (publication pas encore arrivée, ou liste pas à jour)');
  } catch (error) {
    problems.push(`sw.js : ${error.message}`);
  }
  let checked = 0;
  for (const [path, hash] of files) {
    try {
      if (sha256(await get(path)) !== hash) problems.push(`${path} : contenu différent`);
      checked++;
    } catch (error) {
      problems.push(`${path} : ${error.message}`);
    }
  }
  return { ok: problems.length === 0, checked, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, target] = process.argv.slice(2);
  if (!command) {
    const result = updateServiceWorker();
    console.log(`www/sw.js ${result.changed ? 'mis à jour' : 'déjà à jour'} — version ${result.version}, ${result.count} fichiers, empreinte ${result.build}`);
  } else if (command === 'verifier' && !target) {
    const result = computeServiceWorker();
    if (result.upToDate) console.log(`www/sw.js est à jour (version ${result.version}, ${result.files.length} fichiers).`);
    else {
      console.error('www/sw.js n\'est pas à jour : lance « npm run pwa ».');
      process.exit(1);
    }
  } else if (command === 'verifier') {
    const result = await verifyDeployed(target);
    if (result.ok) console.log(`Site publié conforme : ${result.checked} fichiers identiques à ceux d'ici.`);
    else {
      console.error(`Site publié différent (${result.problems.length} écart${result.problems.length > 1 ? 's' : ''}) :`);
      for (const problem of result.problems.slice(0, 20)) console.error(`  - ${problem}`);
      process.exit(1);
    }
  } else {
    console.error('Usage : node tools/pwa.mjs [verifier [adresse du site]]');
    process.exit(1);
  }
}
