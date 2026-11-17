// Extraction du texte d'un PDF avec pdf.js (bibliothèque Mozilla, embarquée dans vendor/pdfjs —
// aucune connexion internet n'est nécessaire, le fichier ne quitte jamais le téléphone).

import { StatementError } from './pdf-table.js';

let pdfjsPromise = null;

/** Charge pdf.js à la demande (il pèse lourd : on ne le charge que si on importe un PDF). */
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('../../../vendor/pdfjs/pdf.min.js');
      // Le « worker » est chargé dans la page elle-même : pas de fichier séparé à aller chercher,
      // ce qui fonctionne partout (appli Android, fichier ouvert en local, navigateur).
      const worker = await import('../../../vendor/pdfjs/pdf.worker.min.js');
      globalThis.pdfjsWorker = worker;
      return pdfjs;
    })();
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/**
 * Renvoie les pages du PDF sous forme de textes positionnés :
 * [{ items: [{ str, x, y, w, rot }] }]  (x,y en points, origine en bas à gauche de la page).
 */
export async function extractPages(pdfjs, data) {
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
  } catch (error) {
    if (error?.name === 'PasswordException') throw new StatementError('Ce PDF est protégé par un mot de passe : enregistre-le sans mot de passe pour pouvoir le lire.', 'password');
    throw new StatementError("Ce fichier PDF est illisible (il est peut-être incomplet ou abîmé).", 'unreadable');
  }
  const pages = [];
  let count = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = [];
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        items.push({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          w: it.width,
          rot: Math.round((Math.atan2(it.transform[1], it.transform[0]) * 180) / Math.PI),
        });
      }
      count += items.length;
      pages.push({ items });
    }
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* rien à faire */
    }
  }
  if (!count) {
    throw new StatementError("Ce PDF ne contient pas de texte : c'est sans doute une image scannée. Télécharge le relevé PDF d'origine depuis le site de ta banque.", 'no-text');
  }
  return pages;
}
