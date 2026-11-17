// Fabrique « dist/mon-budget.html » : toute l'appli dans UN seul fichier (code, styles, polices,
// lecteur de PDF, relevé d'exemple). On l'ouvre d'un double-clic sur un ordinateur, sans rien
// installer et sans connexion — pratique pour essayer l'appli ou la montrer.
//
// Les données saisies dans ce fichier restent dans le navigateur qui l'a ouvert.
// L'appli Android, elle, n'utilise pas ce fichier : elle embarque directement le dossier www/.
//
// Usage : npm run build:fichier-unique

import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');
const read = (path) => readFileSync(join(www, path));

// 1. Le code : tous les modules réunis (y compris pdf.js, chargé seulement quand on importe un PDF).
const bundle = await build({
  entryPoints: [join(www, 'js/main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome90'],
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'error',
  // pdf.js lit import.meta.url pour localiser des fichiers annexes dont on ne se sert pas ici.
  define: { 'import.meta.url': '""' },
});
let script = bundle.outputFiles[0].text;
// Une balise </script> dans le code fermerait prématurément le bloc : on la neutralise.
script = script.replace(/<\/script/gi, '<\\/script');

// 2. Les styles, polices incluses.
let css = read('css/app.css').toString('utf8');
css = css.replace(/url\("\.\.\/fonts\/([^"]+)"\)/g, (match, file) => `url("data:font/woff;base64,${read(`fonts/${file}`).toString('base64')}")`);
if (/url\("\.\.\//.test(css)) throw new Error('Une ressource des styles n\'a pas été intégrée.');

// 3. La page.
let html = read('index.html').toString('utf8');
const icon = `data:image/svg+xml;base64,${read('icons/icon.svg').toString('base64')}`;
const example = read('exemples/releve-exemple.pdf').toString('base64');
const replaceOnce = (source, search, replacement) => {
  if (!source.includes(search)) throw new Error(`Repère introuvable dans index.html : ${search}`);
  return source.replace(search, () => replacement);
};
html = replaceOnce(html, '<link rel="icon" href="icons/icon.svg" type="image/svg+xml">', `<link rel="icon" href="${icon}" type="image/svg+xml">`);
// Le fichier unique s'ouvre depuis le disque : il ne s'installe pas comme une appli et ne doit
// réclamer aucun fichier annexe (manifeste, icône d'écran d'accueil).
html = replaceOnce(html, '  <link rel="manifest" href="manifest.webmanifest">\n', '');
html = replaceOnce(html, '  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n', '');
html = replaceOnce(html, '<link rel="stylesheet" href="css/app.css">', `<style>\n${css}\n</style>`);
html = replaceOnce(
  html,
  '<script type="module" src="js/main.js"></script>',
  `<script>window.__MON_BUDGET_EXEMPLE_PDF__ = "${example}";</script>\n  <script>\n${script}\n</script>`,
);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'mon-budget.html');
writeFileSync(out, html);
console.log(`dist/mon-budget.html — ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} Mo`);
