# Journal des versions

## 2.1.0 — novembre 2026

L'appli s'installe sans APK, se met à jour toute seule, et l'on peut écrire à Claude depuis l'appli.

### Nouveau

- **Appli installable (PWA)** : installée depuis une adresse internet, elle a son icône, s'ouvre en
  plein écran (pas dans Chrome) et fonctionne sans connexion. Raccourci « Nouvelle opération » sur
  l'icône. Bouton « Installer » dans l'onglet Plus.
- **Mises à jour automatiques** : la nouvelle version est téléchargée en arrière-plan, chaque
  fichier est vérifié par son empreinte, un bandeau propose « Mettre à jour » ; l'appli annonce
  ensuite ce qui a changé (« Quoi de neuf »). Une version abîmée en route n'est jamais installée.
- **Commentaires pour Claude** (remplace « Signaler un bug ») : problème, idée ou question, écran
  concerné pré-rempli, capture d'écran. Avec la connexion réglée (Plus › Connexion à Claude), un
  bouton dépose le commentaire dans une boîte privée ; sans réseau il attend et part tout seul. Les
  réponses de Claude s'affichent sous le commentaire, on peut y répondre, et l'état passe à
  « Traité » quand c'est réglé.
- **Copie automatique dans un dossier du téléphone** pour l'appli installée (Plus › Sauvegarde et
  données › Choisir un dossier) : sauvegarde quotidienne (7 gardées), exports, relevés, tickets.
- Plus › À propos : état de l'installation, du fonctionnement sans connexion et des mises à jour.

### Sous le capot

- `www/sw.js` (service worker) et `www/manifest.webmanifest` ; `npm run pwa` tient la liste des
  fichiers à jour, et `npm test` échoue si elle ne l'est pas.
- `tools/commentaires.mjs` : lire les commentaires, y répondre, les clore, depuis l'ordinateur.
- `tools/publier.mjs` et `.github/workflows/publier.yml` : contrôles, envoi, vérification du site.
- 180 tests du moteur (54 nouveaux) et 57 parcours (15 nouveaux), dont : critères d'installation de
  Chrome, démarrage sans connexion, mise à jour, envoi et réponses avec un faux GitHub, dossier du
  téléphone.
- Le jeton d'accès à la boîte ne figure dans aucune sauvegarde, aucun diagnostic, aucun écran.

### Reste à faire

- Mettre l'appli en ligne (compte GitHub, dépôts) : `docs/publication.md`. Tant que ce n'est pas
  fait, l'installation sur le téléphone et l'envoi des commentaires ne sont pas utilisables.
- Vérifications sur le vrai téléphone : `docs/installer-sur-le-telephone.md`.

## 2.0.0 — novembre 2026

Réécriture complète sur des fondations testées. Les données de la version 1 sont reprises
automatiquement (ou par import d'un ancien fichier d'export).

### Nouveau

- Import de relevé bancaire (PDF, OFX, CSV) avec assistant : correspondances, lignes à ajouter,
  opérations absentes du relevé, bilan des soldes ; fichier archivé ; un seul geste pour tout annuler.
- Règles automatiques : l'appli retient le rangement habituel de chaque tiers et le repropose.
- Recherche, filtres croisés, sélection multiple (supprimer, ajouter un tag).
- Objectif et échéance sur les enveloppes ; virements entre enveloppes ; suppression au choix.
- Signalement de bug dans l'appli, avec capture d'écran et diagnostic sans données personnelles.
- Code de verrouillage, thème sombre, mode d'emploi intégré, données d'exemple, relevé d'essai.
- Sauvegarde complète en ZIP (photos comprises), copie quotidienne sur Android, rappel de sauvegarde.
- Export Excel à sept feuilles, avec de vraies dates et de vrais montants.
- Archives : relevés, enveloppes clôturées, tickets photographiés, constats de solde.
- Graphiques dessinés par l'appli elle-même (plus de bibliothèque à télécharger), cliquables, avec
  une version tableau ; comparaison à la période précédente.

### Corrigé par construction

- Montants en centimes entiers : plus aucune erreur d'arrondi.
- Graphiques vides hors connexion : tout est embarqué.
- Récurrences limitées à 3 mois et mal ordonnées : 6 mois, ordre demandé, pas de dérive de date.
- Toucher un virement proposait de le supprimer : il s'ouvre pour modification.
- Enveloppe négative possible : impossible, un complément est proposé.
- Photos stockées dans les opérations (base lourde) : stockées à part, réduites.
- Annulation limitée : toute action s'annule, y compris un import entier.

### Sous le capot

- Moteur de règles sans interface (`www/js/core/`), 126 tests.
- 42 parcours automatiques dans un vrai navigateur, dont thème sombre, petit écran, bouton retour.
- Fichier unique `dist/mon-budget.html` pour essayer l'appli sur un ordinateur.
- Fabrication de l'APK en une commande : `npm run apk`.

## 1.0 — octobre 2026

Première maquette fonctionnelle (opérations, enveloppes, prévisions, récurrences, rapprochement
manuel, statistiques).
