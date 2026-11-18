// Ce qui a changé d'une version à l'autre, tel que l'appli l'annonce après une mise à jour
// (« Quoi de neuf ») et le montre dans Plus › À propos.
//
// À chaque publication : ajouter une entrée EN TÊTE de liste, avec le même numéro que dans
// package.json et dans ui/app.js. Phrases courtes, tutoiement, pas de jargon ; quand un changement
// répond à un commentaire, le dire (« suite à ton commentaire n° 12 »).

export const CHANGES = [
  {
    version: '2.2.0',
    date: '2026-11-18',
    title: 'Bouton IA et quotas par tag',
    items: [
      "Bouton IA au bord de l'écran : entoure ce qui te gêne, écris un mot, et Claude reçoit ton commentaire avec la capture (montants masqués).",
      'Quotas par tag : un plafond par jour, semaine, mois ou entre deux dates, avec une jauge et un avertissement quand tu saisis une dépense.',
      "Le bouton + ne propose plus que Dépense et Revenu. Les mouvements d'enveloppe s'appellent Alimentation, Retrait et Déplacement.",
      'Claude relève tes commentaires 4 fois par jour.',
      'Quelques retouches visuelles : grand solde plus lisible, cartes en léger relief, transitions plus douces.',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-11-16',
    title: "L'appli s'installe, se met à jour seule et parle à Claude",
    items: [
      "Mon Budget s'installe sur le téléphone comme une appli : son icône, son écran à elle, et elle marche sans connexion.",
      'Les mises à jour arrivent toutes seules : un bandeau te prévient, un geste suffit.',
      "Commentaires pour Claude : écris un problème, une idée ou une question dans l'appli ; la réponse de Claude s'affiche dessous.",
      'Copie automatique des sauvegardes dans un dossier de ton téléphone (Plus › Sauvegarde et données).',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-11-01',
    title: 'Réécriture complète',
    items: ['Import de relevés bancaires, enveloppes avec objectif, prévisions, statistiques, sauvegardes.'],
  },
];

const parts = (version) => String(version || '').split('.').map((n) => Number.parseInt(n, 10) || 0);

/** -1, 0 ou 1 selon que la version a est plus ancienne, égale ou plus récente que b. */
export function compareVersions(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Les versions arrivées après `seen` (jusqu'à `current` comprise), la plus récente d'abord. */
export function changesSince(seen, current, changes = CHANGES) {
  return changes.filter((entry) => compareVersions(entry.version, seen) > 0 && compareVersions(entry.version, current) <= 0);
}
