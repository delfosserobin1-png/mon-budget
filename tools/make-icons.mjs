// Fabrique les images de l'appli Android (icône, icône adaptative, écran de démarrage) à partir
// du dessin de l'enveloppe. Les fichiers obtenus dans resources/ sont ceux qu'attend l'outil
// officiel « @capacitor/assets » (npx @capacitor/assets generate --android).
// Usage : node tools/make-icons.mjs   (nécessite le module « sharp »)
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'resources');
mkdirSync(out, { recursive: true });

const BLUE = '#2b47c2';
const NIGHT = '#0f1528';
// L'enveloppe kraft, dessinée dans un carré de 512 : `scale` la réduit autour du centre.
const envelope = (scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <rect x="96" y="150" width="320" height="232" rx="22" fill="#d6b783"/>
    <path d="M96 172 L256 300 L416 172" fill="none" stroke="#a98450" stroke-width="14" stroke-linejoin="round"/>
    <circle cx="256" cy="296" r="34" fill="${BLUE}" stroke="#d6b783" stroke-width="10"/>
  </g>`;
const svg = (size, body, background = null) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${background ? `<rect width="512" height="512" fill="${background}"/>` : ''}${body}</svg>`);

// Icône classique (carré plein, Android arrondit lui-même les angles)
await sharp(svg(1024, envelope(1), BLUE)).png().toFile(join(out, 'icon-only.png'));
// Icône adaptative : le dessin doit tenir dans les 2/3 centraux (le reste peut être rogné)
await sharp(svg(1024, envelope(0.62))).png().toFile(join(out, 'icon-foreground.png'));
await sharp(svg(1024, '', BLUE)).png().toFile(join(out, 'icon-background.png'));
// Écran de démarrage (clair et sombre) : l'enveloppe, petite, au centre
await sharp(svg(2732, envelope(0.22), '#f6f7fb')).png().toFile(join(out, 'splash.png'));
await sharp(svg(2732, envelope(0.22), NIGHT)).png().toFile(join(out, 'splash-dark.png'));
console.log('resources/ : icon-only.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png');
