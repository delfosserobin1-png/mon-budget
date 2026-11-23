# Journal des versions

## 2.3.0 — novembre 2026

### Nouveau

- **Bilan** (l'onglet Stats change de nom) : en haut, le tableau de bord du jour — compte courant
  aujourd'hui et **estimé en fin de mois** (réel déjà daté + prévisions cochées), point le plus bas,
  **alertes** (découvert aujourd'hui ou à venir, objectif d'enveloppe en retard, sauvegarde trop
  ancienne, relevé pas importé depuis 40 jours, réponse de Claude, accord bancaire bientôt expiré),
  **les 7 prochains jours**, les quotas ; en dessous, les statistiques.
- **Banque connectée** (Plus) : l'ordinateur relève les opérations chez la banque (Enable Banking,
  accès DSP2 en lecture seule), les chiffre (AES-GCM, phrase secrète) et les dépose dans la boîte
  privée ; le téléphone les déchiffre et les passe à l'assistant d'import. Outil :
  `npm run banque`. Reste à faire : ton compte Enable Banking (`docs/connexion-banque.md`).
- **Sélection multiple → enveloppe** : ranger plusieurs sorties dans une enveloppe d'un geste (ou
  les ramener sur le compte courant), avec complément proposé si l'enveloppe manque d'argent. Suite
  au commentaire n° 4.
- **Premier rangement des commerçants courants** à l'import (Carrefour → Courses, SNCF → Transport…),
  si un tag de ce nom existe ; une règle apprise passe toujours avant.

### Changé

- **Sortie / Entrée** remplacent Dépense / Revenu dans toute l'appli (formulaires, filtres, Bilan,
  exports Excel, mode d'emploi).
- Les compléments d'enveloppe disent « ajouter depuis le compte courant » au lieu de « virer ».

### À décider

- **Relève programmée des commentaires** : les tâches créées le 18-11 s'arrêtaient toutes à leur
  première commande (aucune autorisation réglée), si bien que rien n'était traité. Supprimées pour
  être recréées dans le mode de la conversation, leur recréation a été refusée par le garde-fou de
  sécurité de Claude. À recréer par toi dans l'appli Claude (avec le mode d'autorisation de ton
  choix), ou sur ta demande explicite.
- **Traitement immédiat** : un garde-fou de sécurité ne se contourne pas, même avec ton accord ;
  voir `docs/connexion-claude.md` pour les autres voies.

### Sous le capot

- `core/dashboard.js` (Bilan), `core/categories.js` (catalogue), `core/chiffre.js` (chiffrement
  partagé PC / téléphone), `tools/banque.mjs` (Enable Banking), format de relevé « mon-budget-banque »
  lu par `io/statement/text-formats.js`, `ui/screens/bank.js`, `www/banque-retour.html`.
- `docs/feuille-de-route.md` : plusieurs comptes, partage, comptes utilisateurs, RGPD, CGU, étapes
  d'une publication officielle.
- 209 tests du moteur (17 nouveaux, dont un faux Enable Banking qui vérifie la signature du jeton) et
  69 parcours dans un vrai navigateur (7 nouveaux).

## 2.2.0 — novembre 2026

### Nouveau

- **Bouton IA** sur tous les écrans : on le touche, on entoure (ou on touche) un endroit de
  l'écran, on écrit un commentaire, et il part chez Claude avec une capture de l'écran annotée
  (montants masqués par défaut) et la description exacte de l'élément visé. Onglet fin, qui ne
  cache aucun chiffre ; déplaçable le long du bord ou sur le bord gauche, masquable.
- **Quotas par tag** : un plafond de dépenses par jour, semaine, mois, année ou entre deux dates.
  Jauges dans Plus › Tags et en tête de Stats ; avertissement au moment de saisir une dépense qui
  ferait atteindre 80 % ou dépasser. Remboursements déduits, prévisions affichées à part.
- **Relève programmée** des commentaires par Claude, 4 fois par jour (3 h 30, 9 h, 15 h, 21 h 30),
  depuis l'appli Claude de l'ordinateur.

### Changé

- Le bouton + ne propose plus que **Dépense** et **Revenu**. Les mouvements d'enveloppe se font
  depuis la fiche de l'enveloppe et portent un nom clair : **Alimentation**, **Retrait**,
  **Déplacement** (« Mise de côté » pour une récurrence). Le mot « virement » n'est plus employé
  que pour les vrais virements bancaires.
- Rendu : centimes plus discrets dans le grand solde, milliers mieux séparés dans les grands
  chiffres, relief léger sous les cartes, titres plus fins, transitions douces entre les écrans,
  poignée sur les panneaux.

### Pas fait, à décider

- **Traitement immédiat** des commentaires (dès l'envoi, ordinateur allumé en permanence) : il
  faudrait un Claude lancé automatiquement, sans personne pour le surveiller, qui modifie et publie
  l'appli. Le garde-fou de sécurité de Claude a refusé de l'installer de lui-même. Si tu le veux
  quand même, c'est toi qui installes Claude Code en ligne de commande (une commande) et
  t'y connectes ; on construira alors le programme de surveillance ensemble.
- **Connexion directe à la banque** : options et proposition dans `docs/connexion-banque.md`.

### Sous le capot

- `core/quotas.js` (moteur des quotas), `ui/annotate.js` (bouton IA), `ui/capture.js` (photo de
  l'écran sans bibliothèque : DOM → SVG → PNG), `ui/quotas-ui.js`.
- 192 tests du moteur (12 nouveaux) et 64 parcours dans un vrai navigateur (7 nouveaux), dont la
  capture réelle d'un écran entouré au doigt et son envoi au faux GitHub.

### Corrigé

- Formulaire d'opération : un libellé, un tiers ou un commentaire mis dans le champ par une
  suggestion (liste du champ, clavier du téléphone) pouvait se perdre en passant de Dépense à
  Revenu, ou à l'enregistrement. Ce qui est écrit dans les champs fait désormais foi. Repéré par
  les tests de GitHub lors de la première tentative de publication de la 2.2.0.

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

### Mise en ligne

- Publiée le 17-11-2026 sur https://delfosserobin1-png.github.io/mon-budget/ ; la boîte à
  commentaires privée a été vérifiée de bout en bout sur le vrai GitHub (envoi avec capture,
  réponse, discussion, clôture).
- L'adresse de la boîte est pré-remplie dans l'appli : il ne reste qu'à coller le jeton.
- Les tests de bout en bout raisonnent à l'heure de Paris quel que soit l'ordinateur (les serveurs
  de GitHub sont à l'heure universelle ; un test de récurrence à 23 h 58 y échouait).
- Reste à faire : installer sur le téléphone, régler la connexion dans l'appli, vérifications de
  `docs/installer-sur-le-telephone.md`.

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
