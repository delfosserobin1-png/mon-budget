# Commentaires pour Claude : comment l'appli et Claude se parlent

L'idée : tu utilises l'appli, quelque chose te gêne ou te donne une idée, tu l'écris **dans
l'appli**. Claude le lit, modifie l'appli, te répond. La correction arrive sur ton téléphone avec la
mise à jour suivante. Tu n'as ni fichier à transférer, ni ordinateur à allumer pour écrire.

```
  téléphone                         GitHub (ton compte)                    Claude
┌────────────┐  commentaire   ┌──────────────────────────┐   lit      ┌──────────────┐
│ Mon Budget │ ─────────────► │ boîte à commentaires     │ ─────────► │ lit, corrige, │
│            │ ◄───────────── │ (dépôt PRIVÉ)            │ ◄───────── │ teste, répond │
│            │    réponse     └──────────────────────────┘  réponse   │              │
│            │                ┌──────────────────────────┐            │              │
│            │ ◄───────────── │ l'appli publiée          │ ◄───────── │ publie       │
└────────────┘  mise à jour   │ (dépôt du code + site)   │  nouvelle  └──────────────┘
                              └──────────────────────────┘  version
```

Le « connecteur », c'est donc GitHub : un service gratuit où Claude sait lire et écrire. Deux
dépôts y sont utilisés :

| Dépôt | Contenu | Visibilité |
| --- | --- | --- |
| `mon-budget` | le code de l'appli, et le site d'où le téléphone l'installe | public (obligatoire pour l'hébergement gratuit) ; il ne contient aucune donnée personnelle |
| `mon-budget-commentaires` | tes commentaires, les captures que tu joins, les réponses de Claude | **privé** |

## Ce qui part, ce qui ne part jamais

Quand tu touches « Envoyer à Claude », partent dans ta boîte privée :

- le texte du commentaire (et « ce que tu faisais juste avant », pour un problème) ;
- les captures d'écran que tu as choisi de joindre ;
- quelques informations techniques : version de l'appli, modèle du téléphone, nombre de fiches,
  derniers messages d'erreur.

Ne partent **jamais** : tes opérations, tes montants, tes enveloppes, tes relevés, tes photos de
tickets. Attention seulement à ce que montre une capture d'écran avant de la joindre.

Rien ne part tant que tu n'as pas touché le bouton. Sans réseau, le commentaire attend dans l'appli
et part tout seul au retour de la connexion.

## Régler la connexion (une seule fois)

Il faut deux informations, à saisir dans l'appli : **Plus › Connexion à Claude**.

1. **L'adresse de la boîte** : `delfosserobin1-png/mon-budget-commentaires`. Elle est **déjà
   remplie** dans l'appli.
2. **Un jeton d'accès** : une sorte de clé, limitée à cette seule boîte. Tu le crées toi-même sur
   GitHub, pour que personne d'autre que toi ne l'ait jamais entre les mains :
   - depuis le téléphone, dans l'appli : Plus › Connexion à Claude › **Créer le jeton sur GitHub**
     (le formulaire s'ouvre déjà rempli) ;
   - dans « Repository access », choisis **Only select repositories** et coche uniquement
     `mon-budget-commentaires` ;
   - vérifie que « Issues » et « Contents » sont sur **Read and write**, puis **Generate token** ;
   - copie le jeton (il commence par `github_pat_`), reviens dans l'appli, colle-le, **Connecter**.

GitHub ne montre le jeton qu'une fois. S'il est perdu, on en crée simplement un autre ; on peut
aussi le supprimer à tout moment sur GitHub (Settings › Developer settings › Fine-grained tokens),
ce qui coupe la connexion.

Le jeton reste dans les réglages de l'appli, sur ton téléphone. Il ne figure dans aucune sauvegarde
ni aucun export, n'est jamais affiché, et « Déconnecter » l'efface.

## Le bouton IA : montrer du doigt ce qu'il faut changer

Sur tous les écrans, un onglet **IA** est collé au bord droit. S'il gêne, fais-le glisser plus
haut, plus bas ou jusqu'au bord gauche ; tu peux aussi le masquer dans Plus › Commentaires pour
Claude.

1. Touche **IA** : l'écran se fige légèrement teinté.
2. **Entoure** du doigt ce que tu veux commenter (un bouton, un total, une ligne…), ou **touche-le**
   simplement : il s'encadre en rouge. « Effacer » pour recommencer.
3. **Continuer** : une capture de l'écran, avec ton entourage en rouge, s'affiche au-dessus du
   commentaire. Tes montants y sont remplacés par « ••• € » (un interrupteur les montre si c'est
   utile, par exemple pour un total faux) ; tu peux aussi ne pas joindre la capture.
4. Écris ton commentaire, choisis Problème, Idée ou Question, et **Envoyer à Claude**.

Claude reçoit, en plus de ton texte et de la capture, l'**élément visé** : l'écran, la feuille
ouverte, et le chemin exact dans le code. Il sait donc précisément de quoi tu parles.

## Écrire, suivre, répondre

**Plus › Commentaires pour Claude** : choisis Problème, Idée ou Question, écris, joins une capture
si ça aide, **Envoyer à Claude**. Chaque commentaire a ensuite un état :

| État | Ce que ça veut dire |
| --- | --- |
| À envoyer | écrit, gardé dans l'appli, pas encore parti |
| En attente de connexion | l'envoi est demandé ; il partira dès que possible |
| Envoyé à Claude | arrivé dans la boîte |
| Réponse de Claude | une réponse t'attend (un point apparaît sur l'onglet Plus) |
| En discussion | tu as lu la réponse ; le sujet n'est pas clos |
| Traité | c'est réglé ; la correction arrive avec la mise à jour |

Touche un commentaire pour lire le fil et répondre. Répondre à un commentaire « traité » le rouvre.

## Comment Claude s'en occupe

**Automatiquement, 4 fois par jour** (3 h 30, 9 h, 15 h, 21 h 30) : une tâche programmée de
l'appli Claude de ton ordinateur relève la boîte et traite ce qui attend. Il faut que l'ordinateur
soit allumé et l'appli Claude ouverte ; sinon, la relève se fait à la prochaine ouverture. Tu la
retrouves (et peux la modifier ou la mettre en pause) dans l'appli Claude, rubrique des tâches
programmées.

**À la demande**, quand tu veux : dans l'appli Claude (sur l'ordinateur, ou sur le téléphone), ouvre
le projet et écris par exemple :

> Traite mes commentaires.

Claude lance alors `npm run commentaires -- lire`, traite chaque commentaire (modification, tests),
publie la nouvelle version, puis répond et clôt avec `npm run commentaires -- clore <n°> "…"`. La
marche complète est décrite dans `CLAUDE.md`.

Lors d'une relève automatique, personne ne regarde Claude travailler : il ne fait donc que les
demandes claires et sans risque, et répond par une question dans l'appli pour tout le reste
(détails dans `CLAUDE.md`, section « Traiter les commentaires »).

Un traitement **immédiat**, à la minute où tu envoies, demanderait un Claude qui tourne en
permanence sur l'ordinateur et modifie l'appli sans que personne ne le lance. Le garde-fou de
sécurité de Claude a refusé de le mettre en place de lui-même ; c'est à toi d'en décider
(voir `CHANGELOG.md`, version 2.2.0).

### Demander une modification sans passer par l'appli

Tu peux aussi parler directement à Claude, depuis l'appli Claude du téléphone : « dans l'onglet
Stats, je voudrais… ». Le résultat est le même : Claude modifie, teste, publie, et l'appli se met à
jour.

## Sans connexion réglée

Tout fonctionne quand même, à la main : le commentaire est gardé dans l'appli, et « Enregistrer et
partager » l'envoie par mail ou messagerie (texte, plus un fichier ZIP s'il y a des captures).
