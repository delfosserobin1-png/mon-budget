# Mon Budget — notes pour Claude Code

Appli personnelle de suivi de budget par enveloppes. Interface en français, données 100 % locales.
L'utilisateur n'est pas développeur : parle-lui en français, simplement, tutoie-le, et explique ce
que tu fais sans jargon.

## Où en est le projet

Version 2.1.0. L'appli (dossier `www/`) est terminée et testée. Depuis la 2.1.0 elle est d'abord une
**appli web installable (PWA)** : elle s'installe sur le téléphone depuis une adresse internet, a son
icône, marche sans connexion, se met à jour toute seule, et l'utilisateur peut écrire à Claude
depuis l'appli (« Commentaires pour Claude »). La voie APK (Capacitor) reste possible avec le même
dossier `www/`, mais n'est plus la voie principale.

**Publication en place depuis le 17-11-2026** (`docs/publication.md`) :

| | |
| --- | --- |
| Appli | https://delfosserobin1-png.github.io/mon-budget/ |
| Code | https://github.com/delfosserobin1-png/mon-budget — public ; chaque envoi sur `main` relance les tests puis publie `www/` (`.github/workflows/publier.yml`) |
| Commentaires | `delfosserobin1-png/mon-budget-commentaires` — privé ; n° 1 et 2 = essais de connexion faits par Claude (fermés) |

Reste à faire par l'utilisateur : installer l'appli sur son téléphone, régler la connexion à
Claude dans l'appli (jeton fine-grained limité à la boîte ; l'adresse est déjà remplie via
`www/js/config.js`), puis vérifier la liste de `docs/installer-sur-le-telephone.md`.

Ne lui demande jamais de te donner un mot de passe ou un jeton dans la conversation.

Ne réécris pas ce qui marche. Pas de framework, pas de dépendance d'exécution, pas de build
obligatoire : `www/` est servi tel quel.

## Commandes

| Commande | Effet |
| --- | --- |
| `npm install` | installe les outils (Capacitor, esbuild, Playwright) |
| `npm start` | sert `www/` sur http://localhost:5173 (ouvrir dans Chrome, mode mobile) |
| `npm test` | tests du moteur, des formats, de la boîte à commentaires, de la PWA (quelques secondes) |
| `npx playwright install chromium` | une fois, avant les tests de bout en bout |
| `npm run test:e2e` | parcours dans un vrai navigateur (environ 3 minutes) |
| `npm run test:tout` | les deux à la suite |
| `npm run pwa` | refait la liste des fichiers de `www/sw.js` — **après toute modification de `www/`** |
| `npm run pwa:icones` | refait les icônes PNG de `www/icons/` |
| `npm run commentaires -- lire` | les commentaires envoyés depuis l'appli (voir plus bas) |
| `npm run publier -- "message"` | contrôles, envoi, vérification du site (`-- verifier` : contrôles seuls) |
| `npm run build:fichier-unique` | `dist/mon-budget.html`, l'appli en un seul fichier pour PC |
| `npm run apk` | fabrique l'APK (voir `docs/guide-apk.md` ; demande JDK 21 et SDK Android) |

Sur l'ordinateur de l'utilisateur (Windows), ni Node, ni git, ni gh ne sont installés pour tout le
système : des versions portables sont rangées dans le dossier `.outils/` **à côté** du projet. Dans
PowerShell, avant toute commande `node` / `npm` / `git` / `gh` : `. ..\.outils\env.ps1`. `gh` est
connecté au compte GitHub de l'utilisateur ; git s'en sert pour s'identifier (réglage local du dépôt).

Avec Windows PowerShell 5.1, une valeur vide (`""`) ou contenant des guillemets est mal transmise
aux programmes, et `--%` avale le reste de la ligne : passer par `Start-Process -ArgumentList`.

Après toute modification : `npm run pwa`, `npm test`, puis `npm run test:e2e`. Tout doit rester vert.

## Architecture en une page

```
www/
  index.html, css/app.css        une page, une feuille de styles (thème clair / sombre / auto)
  manifest.webmanifest, sw.js    appli installable : identité, et service worker (hors connexion,
                                 mises à jour) — la liste de sw.js est écrite par « npm run pwa »
  fonts/ icons/ exemples/        polices Inter embarquées, icônes, relevé PDF fictif d'essai
  vendor/pdfjs/                  pdf.js (lecture des relevés PDF), chargé à la demande
  js/
    config.js                    réglages de fabrication
    changelog.js                 ce que l'appli annonce après une mise à jour (« Quoi de neuf »)
    core/      LOGIQUE PURE, sans navigateur — c'est là que vivent les règles métier
      schema.js                  modèle de données v2 (toutes les fiches passent par ses « makers »)
      money.js dates.js text.js ids.js sha256.js
      changeset.js               lots de modifications { put, del } + inverse (base de « Annuler »)
      balances.js                soldes : compte courant, enveloppes, total ; garde « jamais négatif »
      operations.js envelopes.js tags.js recurring.js reconciliation.js rules.js
      matching.js                relevé ↔ opérations : correspondances, plan d'import, bilan
      stats.js filters.js        calculs des graphiques, recherche et filtres
      portable.js                export / import JSON, reprise des données de la v1
      comments.js                commentaires pour Claude : texte envoyé, statuts, fil, lots
      demo.js                    jeu de données d'exemple
    io/        formats de fichiers : zip.js, xlsx.js, exports.js, statement/ (PDF, OFX, CSV)
               github.js : le seul code qui parle à internet (boîte à commentaires)
    data/      db.js (IndexedDB + repli mémoire), store.js (état, commit, undo), backup.js,
               claude-link.js (envoi des commentaires, file d'attente, relève des réponses)
    platform/  platform.js : ce qui diffère entre Android (Capacitor), appli installée et navigateur
               pwa.js : service worker, mises à jour, installation
               folder.js : le dossier du téléphone où l'appli installée copie ses fichiers
    ui/        dom.js (h()), shell.js (onglets, pile d'écrans, retour, bandeau de mise à jour),
               overlays.js, fields.js, oprow.js, photos.js, pwa-ui.js, charts/, forms/, screens/
               (screens/bugs.js = « Commentaires pour Claude », screens/claude.js = la connexion)
tests/unit/    node:test — moteur, formats, stockage, commentaires, faux GitHub, PWA, outils
tests/e2e/     node:test + Playwright — parcours complets, horloge figée au 15-11-2026
tests/fake-github.js   faux GitHub en mémoire, partagé par les deux familles de tests
tools/         serve.mjs, pwa.mjs, publier.mjs, commentaires.mjs, build-single.mjs,
               make-pwa-icons.mjs, android.mjs (+ android-tweaks.mjs), générateurs
docs/          architecture, décisions, cahier des charges, installation, connexion à Claude,
               publication, guide APK
```

Principes à respecter :

- **Montants en centimes entiers**, jamais de flottants. Dates en chaînes ISO `AAAA-MM-JJ`.
- **Toute modification est un changeset** produit par une fonction pure `plan…(state, …)` qui renvoie
  `{ ok: true, cs, … }` ou `{ ok: false, errors: [{ field, message }] }`. L'interface ne modifie jamais
  l'état directement : elle appelle `app.run(plan, { label })`. L'annulation (5 niveaux) en découle.
- Les fiches sont **immuables par convention** : on remplace, on ne mute pas.
- L'interface se reconstruit depuis l'état (`update()` de chaque écran) ; pas d'état caché dans le DOM,
  sauf les champs des formulaires ouverts.
- `h()` n'insère que du texte (`textContent`) : pas de `innerHTML` avec des données.
- **Réseau** : aucune bibliothèque chargée depuis internet. Les seuls échanges sont (1) la recherche
  des mises à jour de l'appli sur son propre site, (2) `api.github.com` par `io/github.js`, et
  seulement si l'utilisateur a réglé la connexion à Claude. Les données du budget ne sortent jamais.

## Règles de produit (demandées par l'utilisateur, ne pas les « corriger »)

- Dates affichées **JJ-MM-AAAA** partout.
- Listes : **le plus récent en haut, le plus ancien en bas**. Prévisions : la plus proche en bas.
- Séparateur de mois discret : un trait et `MM-AAAA`.
- Vocabulaire : **Compte courant** (argent disponible, hors enveloppes) et **Solde total** (courant +
  enveloppes = ce que voit la banque). Les deux s'accompagnent d'un bouton d'information.
- Une **enveloppe ne peut jamais être négative** : une dépense qui dépasse propose un virement de
  complément depuis le compte courant ; un retrait qui dépasse est refusé avec une explication.
- Un revenu arrive toujours sur le compte courant (on peut enchaîner un virement vers une enveloppe).
- Onglets, dans cet ordre : Opérations, Enveloppes, **Prévisions (3e)**, Stats, Plus.
- « Annuler » : une pastille discrète en bas à gauche, 5 niveaux, couvre création, modification, suppression.
- Toucher une opération ouvre sa fiche (jamais une demande de suppression directe).
- Import : toujours le choix entre **ajouter** (la base grandit) et **remplacer**.
- Ton de l'interface : phrases courtes, tutoiement, pas de majuscules criardes, pas de jargon.
- Identité visuelle « cahier de comptes » : encre = réel, crayon gris pointillé = prévision, rouge =
  attention, cartes kraft pour les enveloppes. Jetons de couleur en tête de `www/css/app.css`.
- L'appli doit s'ouvrir comme une appli normale (icône, plein écran, pas dans Chrome), garder ses
  données sur le téléphone, et l'utilisateur doit pouvoir commenter depuis l'appli.

## Stockage

- IndexedDB `mon-budget-v2` : un magasin par collection (`operations`, `envelopes`, `tags`, `recurring`,
  `reconciliations`, `statements`, `rules`, `bugReports`, `files`), `blobs` (contenu des photos et des
  relevés), `kv` (réglages, brouillons `draft:*`).
- `bugReports` contient les **commentaires pour Claude** (le nom date de la v2.0.0). Champs ajoutés en
  2.1.0 : `kind` (bug / idee / question), `queued`, `remote` (numéro, état, fil de discussion).
- Réglages `link:*` (dans `kv`) : propres à l'appareil, gardés par « Tout effacer », jamais exportés.
  `link:claude` = `{ repo, token, private, … }` ; `link:folder` = le dossier choisi.
  **Le jeton ne doit apparaître nulle part ailleurs** : ni sauvegarde, ni diagnostic, ni écran, ni
  message d'erreur, ni adresse. Des tests le vérifient ; garde-les verts.
- Fichiers lisibles (copies de confort, la vérité est dans IndexedDB), sous-dossiers `Sauvegardes/`
  (une par jour, 7 gardées), `Exports/`, `Releves/`, `Pieces-jointes/`, `Commentaires/` :
  - appli Android (APK) : dans `Documents/MonBudget/` ;
  - appli installée (PWA) : dans le dossier que l'utilisateur désigne une fois (Chrome Android 132+) ;
  - sinon : téléchargement ou partage.
  `platform.js` : `filesTarget()` dit lequel s'applique ; ne teste plus `isNative()` pour ça.
- Le code PIN est un écran de discrétion (empreinte SHA-256 salée), pas un chiffrement.

## Appli installable (PWA) : ce qu'il faut savoir avant d'y toucher

- `www/sw.js` met en réserve **tous** les fichiers de `www/` et vérifie l'empreinte SHA-256 de chacun.
  Sa liste est écrite par `npm run pwa` ; `npm test` échoue si elle n'est pas à jour.
- Une version n'est installée sur le téléphone que si tous ses fichiers correspondent ; sinon
  l'ancienne continue. D'où `.gitattributes` (`* -text`) : git ne doit jamais modifier un octet.
- Toutes les adresses sont **relatives** (l'appli est publiée dans un sous-dossier). Ne jamais écrire
  d'adresse commençant par `/`.
- Une nouvelle version ne s'impose pas en pleine utilisation : bandeau « Mettre à jour », ou relais
  au lancement suivant.
- **Numéro de version à trois endroits** : `package.json`, `APP_VERSION` dans `www/js/ui/app.js`,
  et une entrée en tête de `www/js/changelog.js`. Les outils refusent de publier s'ils diffèrent.
- Dans l'APK (Capacitor) et dans le fichier unique ouvert du disque, rien de tout cela ne s'active.

## Traiter les commentaires de l'utilisateur

Quand l'utilisateur dit « traite mes commentaires » (ou équivalent) :

1. `npm run commentaires -- lire` : liste les commentaires à traiter, du plus ancien au plus récent ;
   les captures sont téléchargées dans `commentaires/n-<numéro>/` (regarde-les). `voir <n°>` montre
   un commentaire, son fil et le diagnostic technique.
2. Pour chacun : comprendre (au besoin, poser une question avec `repondre <n°> "…"`, elle s'affichera
   dans l'appli sous son commentaire), puis modifier le code **avec un test**.
3. `npm run pwa`, `npm test`, `npm run test:e2e` : tout vert.
4. Augmenter la version (trois endroits) et écrire l'entrée de `changelog.js` en citant le
   commentaire (« suite à ton commentaire n° 12 »).
5. `npm run publier -- "…"`, puis `npm run commentaires -- clore <n°> "Fait dans la version X : …"`.
   Écris ces réponses comme à l'utilisateur : en français, courtes, sans jargon.

Réglages : `mon-budget.config.json` (`commentaires`, `adresse`) ; modèle dans
`mon-budget.config.exemple.json`. Le jeton vient de `gh auth token` ou de la variable
`MON_BUDGET_JETON` ; ne l'écris jamais dans un fichier du projet. Si l'adresse de la boîte change,
la changer aussi dans `www/js/config.js` (`COMMENTS_REPO`, qui pré-remplit l'écran de connexion).

Les captures peuvent montrer des montants : ne les copie pas dans le dépôt, ne les cite pas ailleurs.

## À vérifier sur un vrai téléphone

Liste complète pour l'appli installée : `docs/installer-sur-le-telephone.md`. Les points que seuls
des essais sur l'appareil peuvent confirmer : la fenêtre d'installation de Chrome et l'icône, le
choix du dossier de copie et la durée de son autorisation, le partage de fichiers, l'appareil photo,
le bouton retour, les zones système (encoches) en plein écran.

Pour la voie APK, la liste d'origine reste valable (démarrage, « Lancer la vérification », zones
système — `capacitor.config.json` : `android.adjustMarginsForEdgeToEdge`, clavier, bouton retour,
photo, import PDF, sauvegarde dans `Documents/MonBudget`, récurrences à la réouverture, thème sombre
et grande police). Si un module Capacitor change d'interface, tout est isolé dans
`www/js/platform/platform.js`.

## Limites connues, assumées

- Un seul compte bancaire. Pas de synchronisation, pas de connexion à la banque (voulu).
- Lecture PDF mise au point sur les relevés Société Générale ; les autres banques « en colonnes
  Date / Libellé / Débit / Crédit » sont lues par le même code, sinon OFX ou CSV. Pour ajouter une
  banque : un lecteur dans `www/js/io/statement/` qui renvoie le « relevé normalisé » décrit dans
  `index.js`, plus un test dans `tests/unit/statement.test.js`.
- Le vrai relevé de l'utilisateur ne doit **jamais** être ajouté au dépôt ni aux tests (données personnelles).
  Le fichier d'essai `www/exemples/releve-exemple.pdf` est entièrement fictif
  (`tools/make-sample-statement.mjs`). Le dépôt du code est destiné à être public : n'y mets aucune
  donnée personnelle (nom, adresse, chemins de l'ordinateur, captures).
- Les données de l'appli installée sont attachées à l'adresse du site : elle ne doit pas changer.
- Claude ne relève pas la boîte à commentaires tout seul : il faut le lui demander (ou programmer
  une tâche récurrente).

## Pièges rencontrés

- Ne jamais écrire de caractères invisibles (espace insécable, BOM) en dur dans le code : utiliser
  `String.fromCharCode(0x00a0)` etc. Certains outils les abîment.
- Les écrans cachés restent dans le DOM : dans les tests, cibler `[data-screen="…"]`.
- L'affichage se met à jour à l'image suivante : dans les tests, passer par `noOverlay()`,
  `settled()` ou `valueOf()` du harnais plutôt que lire le DOM tout de suite.
- `node --test` veut des motifs entre guillemets (`"tests/unit/*.test.js"`), pas un dossier.
- Pendant `npm test`, l'avertissement « Cannot load "@napi-rs/canvas" » vient de pdf.js lancé hors
  navigateur : il est sans conséquence (la lecture du texte n'utilise pas le dessin).
- Les parcours e2e chargent `www/` en direct : ne modifie pas `www/` pendant qu'ils tournent.
- Les serveurs de GitHub sont à l'heure universelle : `tests/e2e/harness.js` règle le processus sur
  Paris (`process.env.TZ`), et le workflow aussi. Pour reproduire un échec vu chez GitHub :
  `$env:TZ='UTC'` puis les tests.
- Dans les tests e2e, le service worker est bloqué par défaut (`openApp({ pwa: true })` l'autorise) ;
  le navigateur de test ne sait pas émuler le mode « plein écran » : voir `tests/e2e/pwa.test.js`.
- Avec Playwright, une demande interceptée (faux GitHub) aboutit même « hors connexion » : pour
  simuler une coupure, mettre aussi `fake.offline = true`.
- Un objet créé dans un bac à sable `vm` (test du service worker) n'est pas « égal » à son jumeau
  d'ici : le recopier avant `assert.deepEqual`.
