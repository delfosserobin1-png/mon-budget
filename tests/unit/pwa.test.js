// Appli installable (PWA) : le manifeste et les icônes, la liste des fichiers mis en réserve, et
// le service worker lui-même, exécuté ici dans un faux navigateur (réserve et réseau simulés).
// Le comportement dans un vrai navigateur est vérifié par tests/e2e/pwa.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeServiceWorker, listFiles, readVersion, updateServiceWorker, verifyDeployed } from '../../tools/pwa.mjs';
import { startServer } from '../../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WWW = join(ROOT, 'www');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const read = (path) => readFileSync(join(WWW, path));

// ---------------------------------------------------------------------------------------------
// Manifeste, icônes, page d'accueil
// ---------------------------------------------------------------------------------------------

function pngSize(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'signature PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

test('manifeste : tout ce qu’il faut pour que le téléphone propose l’installation', () => {
  const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'));
  assert.equal(manifest.name, 'Mon Budget');
  assert.ok(manifest.short_name.length <= 12, 'nom court : il doit tenir sous l’icône');
  assert.equal(manifest.display, 'standalone', 'plein écran, sans barre du navigateur');
  assert.equal(manifest.lang, 'fr');
  // adresses relatives : l'appli doit marcher telle quelle dans un sous-dossier (GitHub Pages)
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const color of [manifest.background_color, manifest.theme_color]) assert.match(color, /^#[0-9a-f]{6}$/);

  const wanted = new Set(['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable']);
  for (const icon of manifest.icons) {
    assert.ok(!/^(\/|https?:)/.test(icon.src), `adresse relative : ${icon.src}`);
    assert.equal(icon.type, 'image/png');
    const { width, height, colorType } = pngSize(read(icon.src));
    assert.equal(`${width}x${height}`, icon.sizes, icon.src);
    // une icône « adaptable » est rognée par le téléphone : elle ne doit pas avoir de coins transparents
    if (icon.purpose === 'maskable') assert.notEqual(colorType, 6, `${icon.src} : fond plein attendu`);
    wanted.delete(`${icon.sizes} ${icon.purpose}`);
  }
  assert.deepEqual([...wanted], [], 'tailles et usages d’icônes attendus par Android');

  for (const shortcut of manifest.shortcuts || []) {
    assert.ok(shortcut.url.startsWith('./'), shortcut.url);
    for (const icon of shortcut.icons) assert.ok(existsSync(join(WWW, icon.src)));
  }
});

test('page d’accueil : manifeste, icônes et couleur de barre sont déclarés, et les fichiers existent', () => {
  const html = read('index.html').toString('utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}">/);
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    assert.ok(!/^(https?:)?\/\//.test(m[1]), `aucune ressource extérieure : ${m[1]}`);
    assert.ok(existsSync(join(WWW, m[1])), `fichier présent : ${m[1]}`);
  }
  const apple = pngSize(read('icons/apple-touch-icon.png'));
  assert.deepEqual([apple.width, apple.height], [180, 180]);
  // le fichier unique (tools/build-single.mjs) retire ces deux lignes : elles doivent rester telles quelles
  assert.ok(html.includes('  <link rel="manifest" href="manifest.webmanifest">\n'));
  assert.ok(html.includes('  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n'));
});

// ---------------------------------------------------------------------------------------------
// Liste des fichiers mis en réserve
// ---------------------------------------------------------------------------------------------

test('réserve hors connexion : la liste de www/sw.js est à jour (sinon : npm run pwa)', () => {
  const result = computeServiceWorker();
  assert.equal(result.upToDate, true, 'www/sw.js ne correspond plus aux fichiers de www/ : lance « npm run pwa »');
  assert.equal(result.version, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  assert.match(result.build, /^[0-9a-f]{16}$/);
  const paths = result.files.map(([path]) => path);
  for (const needed of ['index.html', 'manifest.webmanifest', 'css/app.css', 'js/main.js', 'js/ui/app.js', 'js/platform/pwa.js', 'js/io/github.js', 'fonts/inter-400.woff', 'icons/icon-192.png', 'icons/maskable-512.png', 'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'exemples/releve-exemple.pdf']) {
    assert.ok(paths.includes(needed), `en réserve : ${needed}`);
  }
  assert.ok(!paths.includes('sw.js'), 'le service worker ne se met pas lui-même en réserve');
  assert.ok(!paths.some((p) => /LICEN[CS]E/i.test(p) || p.split('/').some((part) => part.startsWith('.'))));
  for (const [path, hash] of result.files) assert.equal(sha256(read(path)), hash, path);
  // le code actuel du service worker contient bien cette liste
  const source = read('sw.js').toString('utf8');
  assert.ok(source.includes(`const BUILD = "${result.build}";`));
  assert.ok(source.includes(`const VERSION = "${result.version}";`));
});

test('réserve hors connexion : chaque fichier que le code charge est dans la liste', () => {
  const listed = new Set(listFiles());
  const missing = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) {
        const rel = full.slice(WWW.length + 1).split('\\').join('/');
        const code = readFileSync(full, 'utf8');
        // imports statiques et import() à la demande, vers des fichiers de l'appli
        for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) {
          const target = posix.normalize(posix.join(posix.dirname(rel), m[1]));
          if (!listed.has(target)) missing.push(`${rel} → ${m[1]}`);
        }
      }
    }
  };
  walk(join(WWW, 'js'));
  assert.deepEqual(missing, [], 'fichiers importés mais absents de www/');
  // et ce que la feuille de styles va chercher (polices)
  const css = read('css/app.css').toString('utf8');
  for (const m of css.matchAll(/url\("([^"]+)"\)/g)) {
    if (m[1].startsWith('data:')) continue;
    assert.ok(listed.has(posix.normalize(posix.join('css', m[1]))), `police en réserve : ${m[1]}`);
  }
});

function tempProject() {
  const root = mkdtempSync(join(tmpdir(), 'mon-budget-pwa-'));
  mkdirSync(join(root, 'www', 'js', 'ui'), { recursive: true });
  mkdirSync(join(root, 'www', '.cache'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.8.7' }));
  writeFileSync(join(root, 'www', 'index.html'), '<!doctype html><title>Test</title>');
  writeFileSync(join(root, 'www', 'js', 'ui', 'app.js'), "export const APP_VERSION = '9.8.7';\n");
  writeFileSync(join(root, 'www', 'LICENSE'), 'texte de licence');
  writeFileSync(join(root, 'www', '.cache', 'x'), 'fichier caché');
  cpSync(join(WWW, 'sw.js'), join(root, 'www', 'sw.js'));
  return root;
}

test('outil pwa : toute modification d’un fichier change l’empreinte de la version', () => {
  const root = tempProject();
  assert.equal(computeServiceWorker({ root }).upToDate, false);
  const first = updateServiceWorker({ root });
  assert.deepEqual([first.changed, first.version, first.count], [true, '9.8.7', 2]);
  assert.deepEqual(computeServiceWorker({ root }).files.map(([path]) => path), ['index.html', 'js/ui/app.js'], 'ni sw.js, ni licence, ni fichier caché');
  assert.equal(updateServiceWorker({ root }).changed, false, 'relancer sans rien changer ne réécrit rien');

  // un fichier modifié → liste périmée → nouvelle empreinte
  writeFileSync(join(root, 'www', 'index.html'), '<!doctype html><title>Test modifié</title>');
  assert.equal(computeServiceWorker({ root }).upToDate, false);
  const second = updateServiceWorker({ root });
  assert.equal(second.changed, true);
  assert.notEqual(second.build, first.build);

  // un fichier ajouté aussi
  writeFileSync(join(root, 'www', 'js', 'nouveau.js'), 'export const x = 1;\n');
  const third = updateServiceWorker({ root });
  assert.deepEqual([third.changed, third.count], [true, 3]);
  assert.notEqual(third.build, second.build);

  // le code du service worker lui-même compte dans l'empreinte (sinon l'ancienne réserve serait réutilisée)
  const swPath = join(root, 'www', 'sw.js');
  writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('const PARALLEL = 6;', 'const PARALLEL = 4;'));
  const fourth = updateServiceWorker({ root });
  assert.equal(fourth.changed, true);
  assert.notEqual(fourth.build, third.build);

  // numéros de version incohérents : on refuse de publier
  writeFileSync(join(root, 'www', 'js', 'ui', 'app.js'), "export const APP_VERSION = '9.8.6';\n");
  assert.throws(() => readVersion(root), /Versions différentes/);
  assert.throws(() => updateServiceWorker({ root }), /Versions différentes/);
  writeFileSync(swPath, 'pas de repères');
  writeFileSync(join(root, 'www', 'js', 'ui', 'app.js'), "export const APP_VERSION = '9.8.7';\n");
  assert.throws(() => computeServiceWorker({ root }), /Repères/);
});

test('outil pwa : un site publié est comparé aux fichiers d’ici, octet pour octet', async () => {
  const root = tempProject();
  updateServiceWorker({ root });
  const server = await startServer({ port: 0, root: join(root, 'www') });
  try {
    const good = await verifyDeployed(server.url, { root });
    assert.deepEqual(good, { ok: true, checked: 2, problems: [] });
    assert.equal((await verifyDeployed(server.url.replace(/\/$/, ''), { root })).ok, true, 'avec ou sans barre finale');

    // le site « publié » a un fichier différent de celui d'ici (hébergeur qui le transforme, publication partielle…)
    const published = mkdtempSync(join(tmpdir(), 'mon-budget-site-'));
    cpSync(join(root, 'www'), published, { recursive: true });
    writeFileSync(join(published, 'index.html'), '<!doctype html><title>Autre</title>');
    const other = await startServer({ port: 0, root: published });
    try {
      const bad = await verifyDeployed(other.url, { root });
      assert.equal(bad.ok, false);
      assert.deepEqual(bad.problems, ['index.html : contenu différent']);
    } finally {
      await other.close();
    }

    // la liste d'ici a changé mais rien n'a été republié
    writeFileSync(join(root, 'www', 'js', 'nouveau.js'), 'export const x = 1;\n');
    updateServiceWorker({ root });
    const stale = await verifyDeployed(other.url, { root }).catch((error) => ({ ok: false, problems: [String(error.message)] }));
    assert.equal(stale.ok, false);
  } finally {
    await server.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Le service worker, dans un faux navigateur
// ---------------------------------------------------------------------------------------------

const SCOPE = 'https://exemple.test/mon-budget/';
const SITE = {
  'index.html': { body: '<!doctype html><title>Mon Budget</title>', type: 'text/html; charset=utf-8' },
  'js/main.js': { body: 'console.log("appli")', type: 'text/javascript; charset=utf-8' },
  'css/app.css': { body: 'body{margin:0}', type: 'text/css; charset=utf-8' },
};

/** Charge www/sw.js avec une liste de fichiers d'essai, dans un bac à sable qui imite le navigateur. */
function loadServiceWorker({ build = 'essai-1', site = SITE, served = site, caches: cacheStore = new Map() } = {}) {
  const block = ['/* GENERE:DEBUT */', 'const VERSION = "9.9.9";', `const BUILD = ${JSON.stringify(build)};`, `const FILES = ${JSON.stringify(Object.entries(site).map(([path, file]) => [path, sha256(file.body)]))};`, '/* GENERE:FIN */'].join('\n');
  const source = read('sw.js').toString('utf8').replace(/\/\* GENERE:DEBUT \*\/[\s\S]*\/\* GENERE:FIN \*\//, () => block);
  const listeners = {};
  const messages = [];
  const network = [];
  const caches = {
    async open(name) {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map());
      const map = cacheStore.get(name);
      return {
        async put(url, response) {
          map.set(String(url), response);
        },
        async match(key) {
          const hit = map.get(typeof key === 'string' ? key : key.url);
          return hit ? hit.clone() : undefined;
        },
      };
    },
    async keys() {
      return [...cacheStore.keys()];
    },
    async delete(name) {
      return cacheStore.delete(name);
    },
  };
  const self = {
    location: new URL('sw.js', SCOPE),
    skipped: false,
    claimed: false,
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    skipWaiting() {
      self.skipped = true;
    },
    clients: {
      async claim() {
        self.claimed = true;
      },
      async matchAll() {
        return [{ postMessage: (message) => messages.push(message) }];
      },
    },
  };
  const fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    network.push({ url, cache: init.cache || null });
    const path = url.startsWith(SCOPE) ? url.slice(SCOPE.length) : null;
    const file = path !== null ? served[path] : null;
    if (!file) return new Response('introuvable', { status: 404 });
    return new Response(file.body, { status: 200, headers: { 'Content-Type': file.type, 'Cache-Control': 'max-age=600' } });
  };
  vm.runInContext(source, vm.createContext({ self, caches, fetch, crypto: globalThis.crypto, Response, Headers, URL, console }), { filename: 'sw.js' });

  /** Envoie un événement au service worker ; renvoie ce qu'il a attendu ou répondu. */
  const dispatch = async (type, event = {}) => {
    let waited = null;
    let responded;
    listeners[type]({ ...event, waitUntil: (promise) => (waited = promise), respondWith: (promise) => (responded = promise) });
    if (waited) await waited;
    return { handled: responded !== undefined, response: responded === undefined ? null : await responded };
  };
  const request = (path, { method = 'GET', mode = 'cors', base = SCOPE } = {}) => ({ request: { url: new URL(path, base).href, method, mode } });
  return { self, cacheStore, messages, network, dispatch, request };
}

/** Les objets fabriqués dans le bac à sable viennent d'un « autre monde » : on les recopie pour les comparer. */
const plain = (value) => JSON.parse(JSON.stringify(value));

test('service worker : à l’installation, chaque fichier est téléchargé sans cache, vérifié, puis mis en réserve', async () => {
  const sw = loadServiceWorker();
  await sw.dispatch('install');
  assert.deepEqual([...sw.cacheStore.keys()], ['mon-budget-essai-1']);
  const reserve = sw.cacheStore.get('mon-budget-essai-1');
  assert.deepEqual([...reserve.keys()].sort(), ['css/app.css', 'index.html', 'js/main.js'].map((p) => SCOPE + p));
  assert.ok(sw.network.every((call) => call.cache === 'reload'), 'jamais de vieux fichier resservi par le cache du navigateur');
  const js = reserve.get(`${SCOPE}js/main.js`);
  assert.equal(js.headers.get('Content-Type'), 'text/javascript; charset=utf-8', 'le type du fichier est gardé (indispensable pour les modules)');
  assert.equal(await js.clone().text(), 'console.log("appli")');
  assert.equal(sw.self.skipped, false, 'une nouvelle version ne s’impose pas toute seule en pleine utilisation');
});

test('service worker : un fichier différent de la version publiée fait échouer l’installation, sans rien casser', async () => {
  const previous = new Map([['mon-budget-ancien', new Map([[`${SCOPE}index.html`, new Response('ancienne version')]])]]);
  const tampered = { ...SITE, 'js/main.js': { body: 'console.log("modifié en route")', type: 'text/javascript' } };
  const sw = loadServiceWorker({ served: tampered, caches: previous });
  await assert.rejects(sw.dispatch('install'), /js\/main\.js : contenu différent de la version publiée/);
  assert.deepEqual([...sw.cacheStore.keys()], ['mon-budget-ancien'], 'la réserve incomplète est effacée, l’ancienne reste');
  assert.deepEqual(plain(sw.messages), [{ type: 'INSTALL_ERROR', build: 'essai-1', message: 'js/main.js : contenu différent de la version publiée' }]);

  // un fichier manquant sur le site : même prudence
  const { 'css/app.css': removed, ...partial } = SITE;
  void removed;
  const missing = loadServiceWorker({ served: partial });
  await assert.rejects(missing.dispatch('install'), /css\/app\.css : réponse 404/);
  assert.deepEqual([...missing.cacheStore.keys()], []);
});

test('service worker : à l’activation, les réserves des anciennes versions sont effacées, pas celles des autres sites', async () => {
  const stores = new Map([['mon-budget-ancien', new Map()], ['mon-budget-plus-ancien', new Map()], ['autre-appli-v1', new Map()]]);
  const sw = loadServiceWorker({ caches: stores });
  await sw.dispatch('install');
  await sw.dispatch('activate');
  assert.deepEqual([...sw.cacheStore.keys()].sort(), ['autre-appli-v1', 'mon-budget-essai-1']);
  assert.equal(sw.self.claimed, true, 'la page ouverte est prise en charge tout de suite');
});

test('service worker : l’appli est servie depuis la réserve, sans réseau ; le reste ne le regarde pas', async () => {
  const sw = loadServiceWorker();
  await sw.dispatch('install');
  sw.network.length = 0;

  const page = await sw.dispatch('fetch', sw.request('', { mode: 'navigate' }));
  assert.equal(await page.response.text(), SITE['index.html'].body, "l'adresse du dossier ouvre l'appli");
  assert.equal(await (await sw.dispatch('fetch', sw.request('index.html?action=ajouter#x', { mode: 'navigate' }))).response.text(), SITE['index.html'].body, 'paramètres ignorés');
  assert.equal(await (await sw.dispatch('fetch', sw.request('js/main.js'))).response.text(), SITE['js/main.js'].body);
  assert.equal(await (await sw.dispatch('fetch', sw.request('css/app.css?v=3'))).response.text(), SITE['css/app.css'].body);
  // une adresse inconnue ouverte comme une page (vieux raccourci) : on sert l'appli plutôt qu'une erreur
  assert.equal(await (await sw.dispatch('fetch', sw.request('ancien/raccourci', { mode: 'navigate' }))).response.text(), SITE['index.html'].body);
  assert.deepEqual(sw.network, [], 'aucun accès au réseau pour tout cela');

  // un fichier hors réserve part normalement sur le réseau
  const outside = await sw.dispatch('fetch', sw.request('inconnu.png'));
  assert.equal(outside.response.status, 404);
  assert.equal(sw.network.length, 1);

  // tout ce qui n'est pas « lire un fichier de l'appli » est laissé tranquille
  assert.equal((await sw.dispatch('fetch', sw.request('index.html', { method: 'POST' }))).handled, false);
  assert.equal((await sw.dispatch('fetch', { request: { url: 'https://api.github.com/repos/moi/boite/issues', method: 'GET', mode: 'cors' } })).handled, false, 'la boîte à commentaires ne passe pas par lui');
  assert.equal((await sw.dispatch('fetch', sw.request('/autre-site/index.html'))).handled, false, 'un autre dossier du même hébergeur non plus');
});

test('service worker : il bascule sur demande et sait dire sa version', async () => {
  const sw = loadServiceWorker();
  await sw.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(sw.self.skipped, true);
  const answers = [];
  await sw.dispatch('message', { data: { type: 'GET_VERSION' }, ports: [{ postMessage: (answer) => answers.push(answer) }] });
  assert.deepEqual(plain(answers), [{ version: '9.9.9', build: 'essai-1', files: 3 }]);
  await sw.dispatch('message', { data: null });
  await sw.dispatch('message', { data: { type: 'AUTRE' } });
});
