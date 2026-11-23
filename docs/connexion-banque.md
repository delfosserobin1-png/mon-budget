# Connecter directement ta banque

> Version 2.3.0 : **tout est construit et testé**, il ne manque que ton compte chez Enable Banking
> et ton accord dans l'appli de ta banque. Rien ne se fait sans toi.

## Ce que ça fait

Tes opérations Société Générale arrivent dans Mon Budget sans télécharger de relevé :

- une opération déjà saisie est **complétée** avec les informations de la banque (date de débit,
  libellé exact), et pointée ;
- une opération que tu n'avais pas saisie est **proposée à l'ajout**, déjà rangée d'après tes
  habitudes (ou d'après le nom du commerçant : Carrefour → Courses…) ;
- le **solde de la banque** sert de preuve : l'appli vérifie qu'elle retombe dessus au centime.

C'est l'assistant d'import que tu connais (Plus › Importer un relevé), alimenté tout seul.

## Comment ça marche

```
 Société Générale ──(ton accord, 180 jours)──► Enable Banking ──► ton PC
                                                                 │ npm run banque -- relever
                                                                 │ (chaque nuit, à la relève de 3 h 30)
                                                                 ▼
                                           ta boîte privée sur GitHub : banque/releve.json.chiffre
                                           (chiffré : même GitHub ne peut pas le lire)
                                                                 │
                                                                 ▼
               Mon Budget sur le téléphone : Plus › Banque connectée › « Reprendre les opérations »
               → déchiffré sur le téléphone → l'assistant d'import (rapprocher, compléter, ajouter)
```

- **Enable Banking** est un intermédiaire agréé (directive européenne DSP2), gratuit pour tes
  propres comptes. L'accès est en **lecture seule** : aucun virement possible par ce biais.
- La **clé privée** d'Enable Banking reste un fichier sur ton PC, hors du projet ; elle n'est jamais
  publiée.
- Les opérations sont **chiffrées** sur le PC (AES-GCM 256 bits) avec une **phrase secrète** que
  seuls ton PC et ton téléphone connaissent. Le téléphone la garde dans ses réglages : elle ne
  figure dans aucune sauvegarde ni aucun export.
- Seules les opérations **comptabilisées** sont reprises (pas celles « en attente », qui peuvent
  encore changer), du **compte courant** choisi.
- Ton accord à la banque dure **180 jours** ; le Bilan te prévient 14 jours avant la fin.

## Ce qu'il reste à faire (une seule fois)

### 1. Ton compte Enable Banking (toi, 10 minutes)

1. Sur https://enablebanking.com, crée un compte (**Sign up**), avec ton adresse mail. C'est toi
   qui choisis le mot de passe : ne le donne à personne, pas même à Claude.
2. Dans le **Control Panel**, crée une **application** :
   - environnement : **Production** ;
   - adresse de retour (« redirect URL ») :
     `https://delfosserobin1-png.github.io/mon-budget/banque-retour.html` ;
   - pour la clé, choisis de la **générer dans le navigateur** : le site te fait **télécharger un
     fichier `.pem`**. Range-le dans le dossier `Budget\banque\` de ton PC (à côté de `mon-budget`,
     pas dedans). Si le site demande plutôt un certificat, Claude le fabrique sur le PC (la clé
     privée ne quitte pas l'ordinateur) et tu n'as qu'à le téléverser.
3. Toujours dans le Control Panel, **active l'application en reliant ton compte** (« Activate by
   linking accounts ») : tu choisis Société Générale, tu valides dans l'appli SG. C'est ce qui
   rend l'usage gratuit, limité à tes propres comptes.
4. Note l'**identifiant de l'application** (une suite de chiffres et de lettres avec des tirets).

### 2. La connexion (avec Claude, 5 minutes)

Dis à Claude : « Connecte ma banque, l'identifiant est … ». Il lance :

```
npm run banque -- installer <identifiant> ..\banque\<fichier>.pem
npm run banque -- connecter "Société Générale"
```

Il te donne une adresse : ouvre-la, connecte-toi à la SG, valide dans l'appli SG. La page de retour
affiche un **code** : copie-le et donne-le à Claude (il ne vaut que quelques minutes et ne sert à rien
sans la clé du PC). Il termine avec `valider`, puis fait un premier `relever`.

### 3. Le téléphone (toi, 1 minute)

Plus › **Banque connectée** : saisis la **phrase secrète** que l'ordinateur a affichée à
l'installation, puis **Reprendre les opérations de la banque**.

## Ensuite, au quotidien

- La relève de 3 h 30 lance `npm run banque -- relever` (PC allumé, appli Claude ouverte).
- Sur le téléphone : Plus › Banque connectée › **Reprendre les opérations**, quand tu veux.
- Tous les 180 jours : renouveler l'accord (« connecter » puis « valider », avec Claude).

## Boursorama et les autres comptes

La documentation d'Enable Banking ne cite pas Boursorama / BoursoBank pour la France : la commande
`npm run banque -- banques` donnera la liste exacte une fois ton compte créé. L'appli ne suit pour
l'instant **qu'un compte** ; plusieurs comptes (SG + Bourso…) demandent de faire évoluer l'appli :
voir `feuille-de-route.md`.

## Les autres options, pour mémoire

| Option | Coût | Remarques |
| --- | --- | --- |
| **Enable Banking** (choisie) | gratuit pour tes propres comptes | agréé ; Société Générale (particuliers) prise en charge |
| GoCardless Bank Account Data (ex-Nordigen) | — | n'accepte plus de nouveaux inscrits |
| Powens, Bridge, Tink, Yapily | payant ou réservé aux entreprises | surdimensionné pour un usage personnel |
| Récupération sur le site de la banque (« woob ») | gratuit | déconseillé : ton identifiant bancaire stocké sur le PC, contraire aux conditions de la banque |
| Relevé PDF chaque mois | gratuit | toujours possible (Plus › Importer un relevé) |

## Pour Claude : la marche technique

- Outil : `tools/banque.mjs` (`npm run banque -- …`). Réglages : `mon-budget.banque.json` (ignoré
  par git ; il contient la phrase secrète et l'identifiant de session). Clé : chemin noté, jamais
  copiée. Fichier déposé : `banque/releve.json.chiffre` dans la boîte des commentaires.
- API : `https://api.enablebanking.com`, jeton JWT RS256 (`kid` = identifiant de l'application,
  `iss` enablebanking.com, `aud` api.enablebanking.com, 1 h). `POST /auth` → adresse d'accord ;
  `POST /sessions` avec le code → session et comptes ; `GET /accounts/{uid}/transactions`
  (pages par `continuation_key`) et `/balances`.
- Premier relevé : 30 jours ; ensuite depuis la fin du précédent moins 10 jours (les lignes déjà
  importées sont reconnues, sans doublon). Limite des banques : environ 4 relevés par jour sans toi.
- Tests : `tests/unit/banque.test.js` (faux Enable Banking `tests/fake-enablebanking.js` + faux
  GitHub), `tests/e2e/banque-connectee.test.js`.

Sources : [Enable Banking, référence de l'API](https://enablebanking.com/docs/api/reference/),
[Enable Banking, marché français](https://enablebanking.com/docs/markets/fr/),
[Enable Banking, questions fréquentes](https://enablebanking.com/docs/faq),
[Open Banking Tracker, API gratuites (2026)](https://www.openbankingtracker.com/guides/free-open-banking-apis),
[ACPR, l'open banking en France (2025)](https://acpr.banque-france.fr/system/files/2025-09/20250918_Document_reflexion_Open_banking_France.pdf).
