# Reprendre le projet avec Claude

(Les chemins de ce guide partent du dossier `mon-budget`.)

## Où on en est

L'appli est en version 2.3.0. Elle n'a plus besoin d'un APK : elle s'installe sur le téléphone
depuis une adresse internet, comme une appli normale (icône, plein écran, sans connexion), se met à
jour toute seule, et tu peux écrire à Claude depuis l'appli.

**Elle est en ligne** à l'adresse : **https://delfosserobin1-png.github.io/mon-budget/**

Pour la voir sur l'ordinateur sans connexion : double-clique sur `dist\mon-budget.html`.

## Ce qu'il te reste à faire

| Étape | Qui | Durée | Détail |
| --- | --- | --- | --- |
| 1. Créer un compte GitHub gratuit | toi | fait | |
| 2. Mettre l'appli en ligne | Claude | fait | `docs/publication.md` |
| 3. Installer l'appli sur le téléphone | toi | 2 min | `docs/installer-sur-le-telephone.md` |
| 4. Régler la connexion à Claude dans l'appli | toi | 5 min | `docs/connexion-claude.md` |
| 5. Vérifier sur le téléphone | toi | 10 min | la liste à la fin de `docs/installer-sur-le-telephone.md` |

## Comment demander quelque chose à Claude

Ouvre l'appli Claude (onglet **Code**), choisis le dossier `mon-budget`, et écris avec tes mots.
Claude lit tout seul `CLAUDE.md`, qui lui explique le projet, ses règles et où il en est.

Au quotidien :

```text
Traite mes commentaires.
```

```text
Dans l'onglet Stats, je voudrais voir le total par mois. Lance les tests avant et après.
```

Une fois la connexion réglée, le plus simple est d'écrire dans l'appli elle-même : Plus ›
Commentaires pour Claude. Claude relève la boîte quand tu lui dis « traite mes commentaires ».

Depuis le téléphone, l'appli Claude permet aussi de lui parler directement ; le résultat est le
même : il modifie, teste, publie, et l'appli se met à jour.

## Ce qui est installé sur cet ordinateur

- **Node.js, Git et GitHub CLI** (nécessaires aux outils, aux tests et à la publication) : des
  versions portables, rangées dans le dossier `.outils` à côté de `mon-budget`. Rien n'a été
  installé dans Windows ; supprimer ce dossier suffit à tout retirer. GitHub CLI est connecté à ton
  compte GitHub (tu peux retirer cet accès sur GitHub : Settings › Applications). Pour lancer une
  commande toi-même dans PowerShell, depuis `mon-budget` :

  ```powershell
  . ..\.outils\env.ps1
  ```

  ```powershell
  npm test
  ```

- **Le navigateur des tests** (Chromium de Playwright), dans ton dossier utilisateur
  (`AppData\Local\ms-playwright`).

Une copie du projet tel qu'il était avant ces changements est gardée dans
`..\_archives\mon-budget-2.0.0-origine.zip`.

## En cas de pépin

| Ce que tu vois | Ce que ça veut dire |
| --- | --- |
| `npm` ou `node` n'est pas reconnu | lance d'abord `. ..\.outils\env.ps1` dans la même fenêtre |
| un test échoue après une modification | ne publie pas ; montre le message à Claude |
| l'appli installée ne se met pas à jour | Plus › À propos › Chercher une mise à jour ; sinon voir le dépannage de `docs/publication.md` |
| « Claude ne reçoit pas encore tes commentaires » dans l'appli | la connexion n'est pas réglée : `docs/connexion-claude.md` |

## Et l'APK ?

Toujours possible : `docs/guide-apk.md`. Il demande Android Studio, et chaque mise à jour doit être
refabriquée et réinstallée à la main ; c'est pour cela que l'installation depuis une adresse
internet est maintenant la voie normale.
