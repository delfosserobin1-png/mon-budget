// Capture de l'écran de l'appli, en image, sans bibliothèque ni permission particulière.
//
// Principe : on recopie l'écran affiché (la « frame » de l'appli, feuilles et dialogues compris),
// on lui joint la feuille de styles (polices incluses), et on fait dessiner le tout par le
// navigateur comme une image SVG (<foreignObject>), qu'on reporte sur un canvas → PNG.
// Rien ne quitte le téléphone ici : l'image est remise à l'appelant.
//
// Ce qui est adapté dans la copie : positions de défilement, valeurs des champs saisis, photos
// (remplacées par un cadre neutre), animations arrêtées, et — si demandé — montants masqués
// (« ••• € »), pour pouvoir montrer un écran sans dévoiler ses chiffres.

export const SKIP_ATTR = 'data-capture';
const ROOT_CLASS = 'mbx-root';
const MONEY = /[-−+]?\d[\d\s.,]*\s?€/g;
const PHOTO_PLACEHOLDER =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#c9cedb"/><path d="M16 44l12-12 8 8 6-6 6 10z" fill="#8d98b5"/></svg>');

/** Remplace les montants d'un texte par « ••• € » (« −1 234,56 € » → « ••• € »). */
export function maskAmountsText(text) {
  return String(text).replace(MONEY, '••• €');
}

let cssPromise = null;

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Les styles de l'appli, prêts à être embarqués dans l'image : règles de toutes les feuilles de
 * styles de la page, adresses des polices remplacées par leur contenu, « :root » rattaché à la
 * copie, animations coupées. Préparé une fois, puis gardé.
 */
export function captureCss() {
  if (!cssPromise) {
    cssPromise = (async () => {
      let css = '';
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) css += `${rule.cssText}\n`;
        } catch {
          /* feuille d'un autre site : illisible, et inutile ici */
        }
      }
      const urls = [...new Set([...css.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:')))];
      for (const url of urls) {
        try {
          const response = await fetch(url);
          const bytes = new Uint8Array(await response.arrayBuffer());
          const type = response.headers.get('Content-Type') || 'font/woff';
          css = css.split(url).join(`data:${type.split(';')[0]};base64,${toBase64(bytes)}`);
        } catch {
          /* police introuvable : l'image prendra la police du système */
        }
      }
      css = css.replace(/:root/g, `.${ROOT_CLASS}`);
      css += `\n.${ROOT_CLASS} *, .${ROOT_CLASS} *::before, .${ROOT_CLASS} *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scrollbar-width: none !important; }\n`;
      css += `.${ROOT_CLASS} *::-webkit-scrollbar { display: none !important; }\n`;
      return css;
    })();
    cssPromise.catch(() => {
      cssPromise = null;
    });
  }
  return cssPromise;
}

/** Thème réellement affiché : celui choisi dans l'appli, sinon celui du téléphone. */
function effectiveTheme() {
  const chosen = document.documentElement.getAttribute('data-theme');
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Copie de la frame, dans l'état où l'utilisateur la voit. */
function cloneFrame(frame, { maskAmounts }) {
  const clone = frame.cloneNode(true);
  const originals = [frame, ...frame.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < originals.length; i++) {
    const o = originals[i];
    const c = copies[i];
    if (!c) continue;
    if (o.scrollTop || o.scrollLeft) {
      c.style.overflow = 'hidden';
      for (const child of c.children) child.style.transform = `translate(${-o.scrollLeft}px, ${-o.scrollTop}px)`;
    }
    if (o instanceof HTMLInputElement) {
      if (o.type === 'checkbox' || o.type === 'radio') {
        if (o.checked) c.setAttribute('checked', '');
        else c.removeAttribute('checked');
      } else if (o.type !== 'file') {
        const sensitive = maskAmounts && /amount|balance|montant/i.test(o.name || '') && /\d/.test(o.value);
        c.setAttribute('value', sensitive ? '•••' : o.value);
      }
    } else if (o instanceof HTMLTextAreaElement) {
      c.textContent = o.value;
    } else if (o instanceof HTMLSelectElement) {
      Array.from(c.options).forEach((option, j) => {
        if (j === o.selectedIndex) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      });
    } else if (o instanceof HTMLImageElement) {
      c.setAttribute('src', PHOTO_PLACEHOLDER);
      c.removeAttribute('srcset');
    }
  }
  for (const node of clone.querySelectorAll(`[${SKIP_ATTR}="skip"]`)) node.remove();
  if (maskAmounts) {
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/\d/.test(node.nodeValue) && node.nodeValue.includes('€')) node.nodeValue = maskAmountsText(node.nodeValue);
    }
  }
  return clone;
}

/**
 * Prépare le document SVG de la capture (sans le dessiner). Renvoie { svg, width, height }.
 * Exporté pour les tests : on peut y vérifier que les montants sont bien masqués.
 */
export async function buildCaptureSvg({ frame = document.querySelector('.frame'), maskAmounts = true } = {}) {
  const css = await captureCss();
  const rect = frame.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const clone = cloneFrame(frame, { maskAmounts });
  Object.assign(clone.style, { width: `${width}px`, height: `${height}px`, maxWidth: 'none', margin: '0', boxShadow: 'none' });
  const body = getComputedStyle(document.body);
  const root = document.createElement('div');
  root.className = ROOT_CLASS;
  root.setAttribute('data-theme', effectiveTheme());
  Object.assign(root.style, {
    width: `${width}px`,
    height: `${height}px`,
    overflow: 'hidden',
    background: 'var(--paper)',
    color: 'var(--ink)',
    fontFamily: body.fontFamily,
    fontSize: body.fontSize,
    lineHeight: body.lineHeight,
    colorScheme: effectiveTheme(),
  });
  const style = document.createElement('style');
  style.textContent = css;
  root.append(style, clone);
  const xhtml = new XMLSerializer().serializeToString(root);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
  return { svg, width, height };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("La capture n'a pas pu être dessinée."));
    img.src = url;
  });
}

/**
 * Capture la frame de l'appli. options :
 *   maskAmounts (défaut true) : montants remplacés par « ••• € » ;
 *   draw(ctx) : dessin à ajouter par-dessus (le cercle tracé par l'utilisateur), en pixels CSS.
 * Renvoie { bytes (PNG), width, height } — la taille en pixels CSS ; l'image est 2× plus fine au plus.
 */
export async function captureFrame({ frame = document.querySelector('.frame'), maskAmounts = true, draw = null } = {}) {
  const { svg, width, height } = await buildCaptureSvg({ frame, maskAmounts });
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  if (draw) draw(ctx);
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image vide.'))), 'image/png');
    } catch (error) {
      reject(error);
    }
  });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}
