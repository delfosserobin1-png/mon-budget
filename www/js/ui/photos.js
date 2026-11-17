// Photos de tickets : prise de vue ou galerie, réduction de taille, vignettes, affichage plein écran.

import { h } from './dom.js';
import { icon } from './icons.js';
import { pickFile, saveFile, shareFile } from '../platform/platform.js';
import { extensionFor, mirrorFile } from '../data/backup.js';

const MAX_SIDE = 1600; // largement assez pour relire un ticket, et ~10 fois plus léger que l'original
const QUALITY = 0.82;
const urlCache = new Map(); // identifiant de pièce jointe → adresse temporaire de l'image

/** Réduit une image (côté le plus long : 1600 px) et la convertit en JPEG. Renvoie { bytes, mime }. */
export async function compressImage(bytes, mime) {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime || 'image/jpeg' }), { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('conversion impossible');
    const out = new Uint8Array(await blob.arrayBuffer());
    // si la « réduction » alourdit le fichier (petite image déjà compressée), on garde l'original
    if (out.length >= bytes.length && scale === 1 && /^image\/(jpeg|png|webp)$/.test(mime)) return { bytes, mime };
    return { bytes: out, mime: 'image/jpeg' };
  } catch {
    if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) return { bytes, mime };
    throw new Error("Cette image n'a pas pu être lue.");
  }
}

/**
 * Fait choisir ou prendre une photo, l'enregistre et renvoie sa fiche (à joindre au lot de
 * l'opération). Renvoie null si l'utilisateur annule.
 */
export async function addPhoto(app, { camera = false, kind = 'photo', mirrorName = '' } = {}) {
  const picked = await pickFile({ accept: 'image/*', capture: camera ? 'environment' : null });
  if (!picked) return null;
  let image;
  try {
    image = await compressImage(picked.bytes, picked.mime || 'image/jpeg');
  } catch (error) {
    app.fail(error.message);
    return null;
  }
  try {
    const name = picked.name || `photo.${extensionFor(image.mime)}`;
    const record = await app.store.saveBlob(image.bytes, { kind, name, mime: image.mime });
    if (mirrorName) mirrorFile('Pieces-jointes', `${mirrorName}-${record.id.slice(-6)}.${extensionFor(image.mime)}`, image.bytes);
    return record;
  } catch (error) {
    app.reportError(error, 'photo');
    app.fail("La photo n'a pas pu être enregistrée (espace de stockage insuffisant ?).");
    return null;
  }
}

export async function photoUrl(app, fileId) {
  if (urlCache.has(fileId)) return urlCache.get(fileId);
  const blob = await app.store.readBlob(fileId);
  if (!blob) return null;
  const url = URL.createObjectURL(new Blob([blob.bytes], { type: blob.mime }));
  urlCache.set(fileId, url);
  if (urlCache.size > 40) {
    const [oldId, oldUrl] = urlCache.entries().next().value;
    URL.revokeObjectURL(oldUrl);
    urlCache.delete(oldId);
  }
  return url;
}

/** Vignette cliquable ; onRemove ajoute la petite croix de suppression. */
export function photoThumb(app, fileId, { onRemove = null } = {}) {
  const img = h('img', { alt: 'Photo jointe', loading: 'lazy' });
  const button = h('button.photo', { type: 'button', 'aria-label': 'Voir la photo en grand', onclick: () => openPhotoViewer(app, fileId) }, img);
  photoUrl(app, fileId).then((url) => {
    if (url) img.src = url;
    else {
      button.replaceChildren(icon('image'));
      button.disabled = true;
      button.title = 'Photo introuvable';
    }
  });
  const wrap = h('div.photo-wrap', button);
  if (onRemove) {
    wrap.appendChild(h('button.photo-remove', { type: 'button', 'aria-label': 'Retirer la photo', onclick: () => onRemove(fileId) }, icon('x', 'sm')));
  }
  return wrap;
}

/** Affiche une photo en plein écran, avec partage / enregistrement. */
export async function openPhotoViewer(app, fileId) {
  const url = await photoUrl(app, fileId);
  if (!url) {
    app.fail('Cette photo est introuvable.');
    return;
  }
  const frame = document.querySelector('.frame');
  const close = () => {
    viewer.remove();
    document.removeEventListener('keydown', onKey);
    app.viewerClose = null;
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  const share = async () => {
    const blob = await app.store.readBlob(fileId);
    if (!blob) return;
    const name = `ticket-${fileId.slice(-6)}.${extensionFor(blob.mime)}`;
    const result = await shareFile({ name, mime: blob.mime, data: blob.bytes, title: 'Photo du ticket' });
    if (result === 'saved') app.notify('Photo enregistrée');
  };
  const save = async () => {
    const blob = await app.store.readBlob(fileId);
    if (!blob) return;
    try {
      const { where } = await saveFile({ name: `ticket-${fileId.slice(-6)}.${extensionFor(blob.mime)}`, mime: blob.mime, data: blob.bytes, folder: 'Pieces-jointes' });
      app.notify(where);
    } catch (error) {
      app.fail(`Enregistrement impossible : ${error.message}`);
    }
  };
  const viewer = h(
    'div.viewer',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo du ticket' },
    h(
      'div.bar',
      h('button.icon-btn', { type: 'button', 'aria-label': 'Fermer', onclick: close }, icon('x')),
      h('div', h('button.icon-btn', { type: 'button', 'aria-label': 'Enregistrer la photo', onclick: save }, icon('download')), h('button.icon-btn', { type: 'button', 'aria-label': 'Partager la photo', onclick: share }, icon('share'))),
    ),
    h('div.stage', h('img', { src: url, alt: 'Photo du ticket' })),
  );
  frame.appendChild(viewer);
  document.addEventListener('keydown', onKey);
  app.viewerClose = close;
}

export function forgetPhotoUrls() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}
