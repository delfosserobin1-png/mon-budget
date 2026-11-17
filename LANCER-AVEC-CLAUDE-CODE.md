# Reprendre le projet avec Claude

(Les chemins de ce guide partent du dossier `mon-budget`.)

## Où on en est

L'appli est en version 2.1.0. Elle n'a plus besoin d'un APK : elle s'installe sur le téléphone
depuis une adresse internet, comme une appli normale (icône, plein écran, sans connexion), se met à
jour toute seule, et tu peux écrire à Claude depuis l'appli. Tout cela est écrit et testé sur
l'ordinateur.

Il reste **une étape, à faire avec toi** : mettre l'appli en ligne. Tant que ce n'est pas fait,
elle ne peut pas être installée sur le téléphone.

Pour la voir tout de suite sur l'ordinateur : double-clique sur `dist\mon-budget.html`.

## Ce qu'il te reste à faire

| Étape | Qui | Durée | Détail |
| --- | --- | --- | --- |
| 1. Créer un compte GitHub gratuit | toi | 5 min | https://github.com (e-mail, mot de passe) |
| 2. Mettre l'appli en ligne | Claude, avec ton accord | 15 min | `docs/publication.md` |
| 3. Installer l'appli sur le téléphone | toi | 2 min | `docs/installer-sur-le-telephone.md` |
| 4. Régler la connexion à Claude dans l'appli | toi | 5 min | `docs/connexion-claude.md` |
| 5. Vérifier sur le téléphone | toi | 10 min | la liste à la fin de `docs/installer-sur-le-telephone.md` |

## Comment demander quelque chose à Claude

Ouvre l'appli Claude (onglet **Code**), choisis le dossier `mon-budget`, et écris avec tes mots.
Claude lit tout seul `CLAUDE.md`, qui lui explique le projet, ses règles et où il en est.

Pour la suite immédiate :

```text
J'ai créé mon compte GitHub. Mets l'appli en ligne en suivant docs/publication.md.
Dis-moi avant chaque étape ce que tu vas faire, et ce que je dois faire de mon côté.
```

Ensuite, au quotidien :

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

- **Node.js** (nécessaire aux outils et aux tests) : une version portable, rangée dans le dossier
  `.outils` à côté de `mon-budget`. Rien n'a été installé dans Windows ; supprimer ce dossier suffit
  à tout retirer. Pour lancer une commande toi-même dans PowerShell, depuis `mon-budget` :

  ```powershell
  . ..\.outils\env.ps1
  ```

  ```powershell
  npm test
  ```

- **Le navigateur des tests** (Chromium de Playwright), dans ton dossier utilisateur
  (`AppData\Local\ms-playwright`).
- Pour la mise en ligne, il faudra en plus **Git** et **GitHub CLI** : Claude te demandera avant de
  les installer.

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
