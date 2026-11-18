# Architecture

## Vue d'ensemble

Mon Budget est une page web autonome (`www/`). Elle se distribue de deux façons, sans changer une
ligne : publiée à une adresse internet, elle s'installe sur le téléphone comme une appli (PWA, la
voie principale depuis la 2.1.0) ; emballée par Capacitor, elle devient un APK Android.
Pas de framework, pas d'étape de compilation du JavaScript : des modules ES chargés tels quels.
Trois raisons à ce choix : le code reste lisible par quelqu'un qui débute, rien ne casse quand une
bibliothèque change de version, et l'appli démarre vite.

```
            ┌───────────────────────── ui/ ─────────────────────────┐
  toucher → │ écrans, formulaires, feuilles, graphiques             │
            └───────────────┬───────────────────────▲───────────────┘
                            │ app.run(plan)         │ update() (l'écran se redessine)
            ┌───────────────▼───────────────────────┴───────────────┐
            │ data/store.js   état en mémoire, commit, annulation   │
            └───────┬───────────────────────────────────┬───────────┘
        plan = cs   │                                   │ écrit
            ┌───────▼──────────┐                ┌───────▼──────────┐
            │ core/  (pur)     │                │ data/db.js       │
            │ règles métier    │                │ IndexedDB        │
            └──────────────────┘                └──────────────────┘
   io/ = formats de fichiers (ZIP, Excel, CSV, relevés)    platform/ = Android ou navigateur
```

## Le cœur : des fonctions pures et des lots de modifications

Tout ce qui est règle métier vit dans `www/js/core/` et ne touche ni à l'écran ni au stockage.
Chaque action utilisateur passe par une fonction `plan…` :

```js
const plan = planSaveOperation(state, saisie, { today });
// → { ok: true, cs, op, topups }            si tout va bien
// → { ok: false, errors: [{ field, message }] }  sinon (rien n'est modifié)
```

`cs` est un **lot de modifications** (« changeset ») : `{ put: { operations: [...] }, del: { ... } }`.
Le magasin (`data/store.js`) calcule son inverse avant de l'appliquer : c'est ce qui rend
« Annuler » générique. Un import de relevé de 97 lignes, la suppression d'une enveloppe et de ses
virements, la clôture avec retour des fonds : chacun est UN lot, donc UNE annulation.

Conséquences pratiques :

- on teste les règles sans navigateur (`tests/unit/`, quelques secondes) ;
- une action ne peut pas s'appliquer à moitié : le lot est écrit dans une seule transaction ;
- ajouter une règle, c'est écrire une fonction et son test, sans toucher à l'interface.

## Modèle de données (version 2)

Décrit entièrement dans `core/schema.js`. Chaque famille a un « maker » qui normalise une fiche.

| Collection | Contenu | Champs notables |
| --- | --- | --- |
| `operations` | dépenses, revenus, mouvements d'enveloppe, ajustements | `kind`, `date`, `time`, `amount` (centimes, signé), `label`, `counterparty`, `comment`, `importance`, `tags`, `envelopeId`, `from` / `to` (virements), `simulated`, `checked`, `recurringId`, `photoIds`, `bank` (pointage relevé), `auto` |
| `envelopes` | enveloppes | `name`, `color`, `goalAmount`, `goalDate`, `closed` |
| `tags` | tags libres | `name`, `color`, `quota` (`amount`, `period`, `from` / `to` si période libre) |
| `recurring` | règles de récurrence | `frequency`, `interval`, `startDate`, `endDate`, `nextK`, `active` |
| `reconciliations` | constats de solde | `date`, `realBalance`, `computedBalance`, `gap`, `statementId` |
| `statements` | relevés importés | période, soldes, compteurs, `fingerprint`, `fileId` |
| `rules` | habitudes par tiers | `key`, `label`, `tags`, `envelopeId`, `importance`, `uses` |
| `bugReports` | commentaires pour Claude | `kind`, texte, étapes, diagnostic, `photoIds`, `origin` (formulaire ou bouton IA), `target` (élément visé) |
| `files` | fiches des pièces jointes | `kind`, `mime`, `size` (le contenu est dans `blobs`) |

Choix structurants :

- **Centimes entiers** partout : `12,30 €` est `1230`. Aucun arrondi flottant possible.
- **Dates en texte ISO** (`2026-11-15`), calculs en UTC : pas de décalage d'un jour selon l'heure d'été.
- **Un mouvement d'enveloppe** est une opération `kind: 'transfer'` avec `from` et `to` (`null` =
  compte courant). Il ne change jamais le solde total. À l'écran il s'appelle Alimentation (depuis
  le compte courant), Retrait (vers le compte courant) ou Déplacement (d'une enveloppe à l'autre) :
  `moveLabel(from, to)` dans `core/operations.js`. Le mot « virement » est réservé aux vrais
  virements bancaires, qui sont des dépenses ou des revenus.
- **Un quota** (`core/quotas.js`) se calcule, il n'est jamais stocké : pour une période (`windowAt`,
  semaine du lundi au dimanche), somme signée des opérations réelles du tag (un remboursement rend
  de la marge ; une opération à plusieurs tags compte en entier dans chacun). Les prévisions sont
  comptées à part (`planned`, `projected`). Niveaux : `ok`, `warn` dès 80 %, `over` au-delà.
  `quotaImpact(state, op)` dit ce que changerait une saisie, sans rien modifier.
- **Une prévision** est une opération `simulated: true`. Elle ne compte que dans l'écran Prévisions.
- **Une échéance de récurrence** est la k-ième date depuis `startDate` : pas de dérive (« le 31 »
  reste le 31 quand le mois le permet). Les échéances des 180 prochains jours sont générées comme
  prévisions, et deviennent réelles toutes seules le jour venu si elles sont cochées.
- **Le pointage** : une opération rapprochée d'un relevé porte `bank: { date, label, details,
  statementId, lineId }`. La date de l'utilisateur (celle de l'achat) est gardée ; `bank.date` est
  celle du débit. Le solde « vu par la banque » se calcule avec `bank.date`.

## Soldes

`core/balances.js`. Deux notions affichées partout :

- **Compte courant** = revenus − dépenses hors enveloppes − virements vers les enveloppes + retours ;
- **Solde total** = compte courant + contenu des enveloppes = ce que la banque affiche.

La garde « une enveloppe n'est jamais négative » compare le point bas de chaque enveloppe avant et
après un lot (`findEnvelopeShortfalls`). Elle ne bloque que ce qui aggrave la situation : des données
anciennes imparfaites n'empêchent pas de travailler.

## Import de relevé

1. `io/statement/` transforme un fichier en **relevé normalisé** (même forme pour PDF, OFX, CSV).
   Pour le PDF, pdf.js donne des textes positionnés ; le sens d'un montant se lit dans sa colonne
   (Débit ou Crédit), pas dans le texte. Les soldes imprimés servent de preuve de lecture.
2. `core/matching.js` compare aux opérations : même montant au centime, date dans une fenêtre de
   quelques jours autour de la date réelle de l'achat ; attribution un pour un, au plus proche.
3. `ui/screens/statement.js` fait décider l'utilisateur, étape par étape, et garde un brouillon.
4. `planStatementImport` construit le lot : fusions (les champs saisis sont gardés, les vides
   complétés), créations, suppressions choisies, ajustement d'ouverture, constat de clôture, règles
   apprises, compléments d'enveloppe. Un seul lot, une seule annulation.

## Stockage et fichiers

- **IndexedDB** (`data/db.js`) : une table par collection, `blobs` pour les contenus, `kv` pour les
  réglages et brouillons. Si IndexedDB est refusé, repli en mémoire avec un avertissement clair.
- **Pièces jointes** : la fiche (`files`) voyage avec les lots ; le contenu (`blobs`) est écrit à
  part, et nettoyé au démarrage suivant s'il n'est plus référencé depuis 24 h (ce délai protège
  l'annulation).
- **Android** (`platform/platform.js`) : écriture dans `Documents/MonBudget/…` par le module
  Filesystem, partage par le module Share, bouton retour par le module App. Chaque appel est
  entouré d'un repli : sans module, l'appli fonctionne comme dans un navigateur.
- **Appli installée (PWA)** (`platform/folder.js`) : l'utilisateur désigne une fois un dossier du
  téléphone ; le navigateur en garde l'accès (File System Access API, Chrome Android 132+) et
  l'appli y écrit les mêmes sous-dossiers que sur Android. `platform.filesTarget()` renvoie
  `'documents'`, `'folder'` ou `null` (téléchargement) : le reste du code ne se demande plus où il
  tourne. Si le téléphone redemande l'autorisation, `filesBlocked()` le signale et l'interface
  propose un bouton.
- Les réglages `link:*` (dossier choisi, connexion à Claude) sont propres à l'appareil : ils ne
  font partie d'aucun export et survivent à « Tout effacer ».

## Appli installable : hors connexion et mises à jour

```
  publication                      téléphone
  ───────────                      ─────────
  npm run pwa  → www/sw.js         1re visite : sw.js télécharge TOUS les fichiers listés,
  (liste : chemin + empreinte      vérifie l'empreinte SHA-256 de chacun, les range dans une
   SHA-256 de chaque fichier,      réserve « mon-budget-<empreinte de la version> ».
   + empreinte de la version)      Ensuite : chaque fichier est servi depuis la réserve.

  nouvelle version publiée  →      sw.js a changé → la nouvelle réserve est préparée à côté ;
                                   si un seul fichier ne correspond pas : abandon, l'ancienne reste ;
                                   sinon bandeau « Mettre à jour » (ou relais au lancement suivant),
                                   puis l'ancienne réserve est effacée.
```

- `www/manifest.webmanifest` : nom, icônes (dont « adaptables »), plein écran, raccourci. Adresses
  relatives partout : l'appli fonctionne dans un sous-dossier.
- `www/sw.js` : volontairement court et sans dépendance. Il ne touche jamais aux données
  (IndexedDB) et laisse passer tout ce qui n'est pas un fichier de l'appli (`api.github.com`).
- `platform/pwa.js` : enregistrement, détection d'une version en attente, bouton « Installer »
  (`beforeinstallprompt`), état exposé à l'interface (`app.pwa.state()`).
- `tools/pwa.mjs` : écrit la liste, vérifie qu'elle est à jour, compare un site publié aux fichiers
  locaux. L'empreinte de la version dépend de chaque fichier **et** du code de `sw.js`.
- `js/changelog.js` : ce que l'appli annonce après une mise à jour. Le réglage `seenVersion`
  retient la dernière version annoncée.

## Commentaires pour Claude

```
 écran « Commentaires »      core/comments.js            data/claude-link.js        io/github.js
 (ui/screens/bugs.js)   →    titre, corps, marqueur  →   envoi, file d'attente,  →  api.github.com
                             statuts, lots               relève des réponses        (dépôt privé)
```

- Un commentaire est une fiche `bugReports` : `kind`, `text`, `screen`, captures (`photoIds`),
  diagnostic technique, `queued` (envoi demandé, pas encore abouti), `remote` (numéro de l'issue,
  état, fil de discussion, nombre de réponses lues).
- Le corps envoyé se termine par un **marqueur** invisible (`<!-- mon-budget {…} -->`) : identifiant,
  type, écran, version, chemins des captures. Les outils s'y fient plutôt qu'à la mise en forme, et
  il sert à ne jamais créer deux fois le même commentaire (coupure juste après l'envoi).
- Les réponses écrites dans l'appli portent `<!-- mon-budget:suite -->` : tout autre message du fil
  est une réponse de Claude.
- Hors connexion, ou jeton refusé : le commentaire reste `queued` et repart à la prochaine relève
  (démarrage, retour au premier plan, retour du réseau, ouverture de l'écran).
- Les captures ne sont déposées que dans une boîte **privée**. Le jeton n'apparaît que dans
  l'en-tête `Authorization` ; les erreurs sont réécrites en français sans le citer.
- Côté ordinateur, `tools/commentaires.mjs` réutilise `io/github.js` et `core/comments.js`.

### Le bouton IA

```
 ui/annotate.js                      ui/capture.js                      même chemin que ci-dessus
 onglet IA → calque de dessin   →    clone de l'écran → SVG → PNG   →   fiche bugReports
 (entourer ou toucher)               (styles et polices recopiés,       origin: 'annotation'
 pickElement → élément visé           montants masqués « ••• € »)       target: écran, chemin…
```

- `pickElement` sonde l'écran en une dizaine de points de la zone entourée (ou au point touché) et
  garde l'élément le plus souvent rencontré, ou à défaut leur parent commun ; `selectorPath` en
  donne le chemin, `describeTarget` le nom lisible (« bouton
  « Alimenter » — écran « Enveloppes » »).
- La capture n'utilise aucune bibliothèque : l'écran est cloné, ses styles et ses polices sont
  recopiés dans une image SVG, que le navigateur dessine sur un `canvas`. Les éléments marqués
  `data-capture="skip"` (le calque, l'onglet IA) en sont exclus, et les photos de tickets aussi.
- L'élément visé voyage dans le marqueur (`target`) et en clair dans le corps (« Élément visé »).

## Interface

- `ui/dom.js` : `h('div.classe', { attributs }, enfants…)` construit le DOM, texte toujours échappé.
- `ui/shell.js` : cinq onglets, une pile de sous-écrans, un seul gestionnaire de « retour ».
- `ui/overlays.js` : feuilles, dialogues (jamais ceux du système), toasts, pile de fermeture.
- Chaque écran expose `{ el, update() }`. À chaque changement du magasin, l'écran visible se
  redessine à l'image suivante ; les autres sont marqués « à rafraîchir ».
- `ui/charts/charts.js` : graphiques SVG faits main, avec une version tableau pour chaque.
- `css/app.css` : jetons de couleur en tête (clair, sombre, auto), composants ensuite.

## Tests

- `tests/unit/` : règles métier, formats (un classeur Excel est relu, une archive ZIP est rouverte,
  le relevé d'exemple est lu par le vrai lecteur PDF), stockage, retouches Android.
- `tests/e2e/` : Chromium piloté par Playwright, écran de téléphone, horloge figée. Chaque test
  repart d'une appli vide et vérifie à la fin qu'aucune erreur n'est apparue dans la console.
  Thème sombre, écran de 320 px, grand écran, bouton retour, modules Android simulés.
- Le fichier unique est testé ouvert depuis le disque, sans serveur.
- **Appli installable** : le service worker est exécuté hors navigateur dans un bac à sable
  (`tests/unit/pwa.test.js` : installation, empreintes, activation, réponses), puis dans le vrai
  navigateur (`tests/e2e/pwa.test.js`) depuis une copie de `www/` servie dans un sous-dossier :
  critères d'installation de Chrome (interrogés par son protocole de débogage), démarrage sans
  connexion, lecture d'un PDF hors connexion, mise à jour avec bandeau, version abîmée refusée.
- **Commentaires** : un faux GitHub en mémoire (`tests/fake-github.js`) sert aux tests unitaires
  (par `fetch`) et aux parcours (branché sur les demandes du navigateur). Envoi, coupure, doublon,
  jeton expiré, boîte publique, réponses, discussion ; et l'outil de Claude contre le même faux.
- **Bouton IA** : un vrai tracé au doigt (souris simulée) sur l'écran, la capture produite est
  relue (dimensions, montants masqués), l'élément visé arrive dans le faux GitHub.
- **Quotas** : périodes et bornes (semaine à cheval sur deux années, février bissextile, dates
  libres), remboursements, prévisions, avertissement à la saisie, jauges dans Tags et Stats,
  passage par une sauvegarde.
- **Dossier du téléphone** : la fenêtre « choisir un dossier » ne se pilote pas ; elle est remplacée
  par un dossier du stockage privé du navigateur, qui s'utilise de la même façon, ce qui permet de
  relire réellement les fichiers écrits.

Ce que les tests ne couvrent pas : le comportement réel du téléphone (fenêtre d'installation,
choix du dossier et durée de son autorisation, partage, clavier, barres système, appareil photo),
et le vrai GitHub. Les listes de contrôle sont dans `docs/installer-sur-le-telephone.md` et
`docs/publication.md`.
