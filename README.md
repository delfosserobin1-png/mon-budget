# Mon Budget

Appli personnelle pour suivre ses comptes : opérations, enveloppes par projet, prévisions,
rapprochement avec la banque, statistiques. Elle s'installe sur le téléphone comme une appli
normale, marche sans connexion, et tes comptes restent sur le téléphone : ils ne sont jamais envoyés
sur internet.

Version 2.2.0, en ligne : **https://delfosserobin1-png.github.io/mon-budget/**

## Par où commencer

| Tu veux… | Fais ceci |
| --- | --- |
| voir l'appli tout de suite sur ton PC | double-clique sur `dist/mon-budget.html` |
| l'installer sur ton téléphone | lis `docs/installer-sur-le-telephone.md` |
| savoir comment écrire à Claude depuis l'appli | lis `docs/connexion-claude.md` |
| mettre l'appli en ligne (une seule fois, avec Claude) | lis `docs/publication.md` |
| reprendre le projet avec Claude Code | lis `LANCER-AVEC-CLAUDE-CODE.md` |
| obtenir un APK à l'ancienne | lis `docs/guide-apk.md` (une commande : `npm run apk`) |
| comprendre comment c'est construit | lis `docs/architecture.md` |
| savoir ce qui a été décidé et pourquoi | lis `docs/decisions.md` |
| comparer avec ce que tu avais demandé | lis `docs/cahier-des-charges.md` |

## Ce que fait l'appli

- **Opérations** : dépenses et revenus avec date, heure, montant, libellé, tiers, commentaire, photo
  du ticket, importance (nécessité, confort, caprice), tags libres. Recherche, filtres croisés,
  sélection multiple, annulation sur 5 niveaux.
- **Enveloppes** : de l'argent mis de côté pour un projet, avec objectif et échéance. Alimenter,
  retirer, virer d'une enveloppe à l'autre, dépenser dedans. Jamais négatives. Clôture avec bilan,
  réouverture.
- **Prévisions** : opérations simulées à cocher pour estimer un solde à une date ; récurrences
  (salaire, loyer, abonnements, virements automatiques vers une enveloppe).
- **Banque** : import de relevé PDF, OFX ou CSV avec un assistant qui passe en revue les
  correspondances, ce qui manque et ce qui est en trop, puis vérifie les soldes. Rapprochement manuel.
- **Stats** : neuf graphiques, cliquables, chacun avec sa version tableau.
- **Données** : sauvegarde complète (ZIP avec les photos), export Excel et CSV, import en ajout ou en
  remplacement, copie quotidienne dans un dossier du téléphone, rappel de sauvegarde.
- **Appli installable** : icône sur l'écran d'accueil, plein écran, fonctionnement sans connexion,
  mises à jour automatiques annoncées par un bandeau, « Quoi de neuf » après chaque mise à jour.
- **Commentaires pour Claude** : un problème, une idée, une question, écrits dans l'appli avec une
  capture d'écran ; la réponse de Claude s'affiche sous le commentaire. Le **bouton IA** permet
  d'entourer directement l'endroit de l'écran concerné. Claude relève les commentaires 4 fois par jour.
- **Quotas par tag** : un plafond de dépenses par jour, semaine, mois, année ou entre deux dates,
  avec jauges et avertissement à la saisie.
- **Et aussi** : mode d'emploi intégré, code de verrouillage, thème clair ou sombre, données
  d'exemple pour découvrir.

## Organisation du dossier

```
www/            l'appli (c'est ce dossier qui est publié, et embarqué dans l'APK)
tests/          192 tests du moteur + 62 parcours dans un vrai navigateur
tools/          serveur local, liste des fichiers hors connexion, publication, lecture des
                commentaires, fichier unique, APK
docs/           installation, connexion à Claude, publication, architecture, décisions, cahier des
                charges, guide APK
resources/      icône et écran de démarrage Android (APK)
dist/           fichiers fabriqués : mon-budget.html, puis l'APK
CLAUDE.md       le contexte que lit Claude Code
```

## Commandes utiles

```
npm install                      installer les outils (une fois)
npm start                        ouvrir l'appli sur http://localhost:5173
npm test                         tests du moteur
npx playwright install chromium  (une fois) le navigateur des tests de bout en bout
npm run test:e2e                 parcours complets dans le navigateur
npm run pwa                      refaire la liste des fichiers (après toute modification de www/)
npm run commentaires -- lire     lire les commentaires envoyés depuis l'appli
npm run publier -- "message"     contrôler, envoyer, vérifier la mise en ligne
npm run build:fichier-unique     refaire dist/mon-budget.html
npm run apk                      fabriquer l'APK
```

## Confidentialité

L'appli ne contient aucun code de mesure d'audience ni aucune publicité. Les polices et le lecteur
de PDF sont embarqués. Le relevé d'exemple fourni est entièrement fictif.

Tes opérations, tes montants, tes enveloppes et tes relevés ne quittent jamais le téléphone. Les
seuls échanges avec internet sont la recherche des mises à jour de l'appli sur son propre site et,
si tu as réglé la connexion à Claude, l'envoi des commentaires que tu choisis d'envoyer (texte,
captures jointes, informations techniques) vers ta boîte privée.

## Licences des composants embarqués

- Police Inter : SIL Open Font License 1.1 (`www/fonts/LICENCE-Inter.txt`).
- pdf.js (Mozilla) : Apache License 2.0 (`www/vendor/pdfjs/LICENSE`).
