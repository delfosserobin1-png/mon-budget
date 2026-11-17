// Fabrique les icônes de l'appli installable (PWA) dans www/icons/, à partir du même dessin
// d'enveloppe que l'icône Android (tools/make-icons.mjs).
//
//   icon-192.png, icon-512.png           icône « classique » (carré bleu aux angles arrondis)
//   maskable-192.png, maskable-512.png   icône « adaptable » : fond plein, dessin dans la zone
//                                        centrale, pour qu'Android puisse la rogner en rond
//   apple-touch-icon.png                 pour un iPhone ou un iPad (180 px, fond plein)
//
// Le dessin est rendu par le navigateur des tests (Playwright) : aucune dépendance de plus.
// Usage : node tools/make-pwa-icons.mjs
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www', 'icons');
mkdirSync(out, { recursive: true });

const BLUE = '#2b47c2';
// L'enveloppe kraft, dessinée dans un carré de 512 : `scale` la réduit autour du centre.
const envelope = (scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <rect x="96" y="150" width="320" height="232" rx="22" fill="#d6b783"/>
    <path d="M96 172 L256 300 L416 172" fill="none" stroke="#a98450" stroke-width="14" stroke-linejoin="round"/>
    <circle cx="256" cy="296" r="34" fill="${BLUE}" stroke="#d6b783" stroke-width="10"/>
  </g>`;
const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${body}</svg>`;

const rounded = `<rect width="512" height="512" rx="112" fill="${BLUE}"/>${envelope(1)}`;
// Zone sûre d'une icône adaptable : un disque de 80 % du côté. À l'échelle 0,78 le coin de
// l'enveloppe est à 31 % du centre : il reste de la marge quelle que soit la forme de rognage.
const maskable = `<rect width="512" height="512" fill="${BLUE}"/>${envelope(0.78)}`;
const square = `<rect width="512" height="512" fill="${BLUE}"/>${envelope(0.9)}`;

const ICONS = [
  { file: 'icon-192.png', size: 192, body: rounded, transparent: true },
  { file: 'icon-512.png', size: 512, body: rounded, transparent: true },
  { file: 'maskable-192.png', size: 192, body: maskable, transparent: false },
  { file: 'maskable-512.png', size: 512, body: maskable, transparent: false },
  { file: 'apple-touch-icon.png', size: 180, body: square, transparent: false },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg(icon.size, icon.body)}</body></html>`);
    await page.screenshot({ path: join(out, icon.file), omitBackground: icon.transparent, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
  }
} finally {
  await browser.close();
}
console.log(`www/icons/ : ${ICONS.map((i) => i.file).join(', ')}`);
