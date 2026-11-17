// Petits morceaux d'interface liés à l'appli installable : proposer l'installation, annoncer ce
// qui a changé après une mise à jour.

import { h } from './dom.js';
import { alertDialog } from './overlays.js';

export const INSTALL_HELP =
  "Sur Android, dans Chrome : ouvre le menu ⋮ (en haut à droite), puis touche « Ajouter à l'écran d'accueil » et « Installer ».\n\nSur iPhone ou iPad, dans Safari : touche le bouton Partager, puis « Sur l'écran d'accueil ».\n\nSur un ordinateur : l'icône d'installation est à droite de la barre d'adresse.\n\nTes données ne bougent pas : l'appli installée retrouve tout ce que tu as saisi ici.";

/** Lance l'installation de l'appli, ou explique comment faire quand le navigateur ne la propose pas. */
export async function installApp(app) {
  const outcome = await app.pwa.install();
  if (outcome === 'accepted') app.notify("Installation lancée : l'icône arrive sur ton écran d'accueil");
  else if (outcome === 'unavailable') await alertDialog({ title: "Installer l'appli", message: INSTALL_HELP });
  return outcome;
}

/** « Quoi de neuf » : les changements des versions données (voir changelog.js), la plus récente d'abord. */
export function showWhatsNew(entries) {
  const content = h(
    'div.whats-new',
    entries.map((entry) => h('section', { dataset: { version: entry.version } }, h('h3', `Version ${entry.version} : ${entry.title}`), h('ul', entry.items.map((item) => h('li', item))))),
  );
  return alertDialog({ title: 'Quoi de neuf', content, okLabel: 'Compris' });
}
