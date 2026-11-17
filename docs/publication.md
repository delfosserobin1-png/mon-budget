# Publier l'appli : mise en place, puis chaque nouvelle version

Pour s'installer sur un téléphone et s'y mettre à jour toute seule, l'appli doit être disponible à
une adresse internet fixe, en https. Elle est conçue pour être hébergée gratuitement par
**GitHub Pages** : c'est aussi GitHub qui sert de boîte à commentaires (voir
[connexion-claude.md](connexion-claude.md)).

> **État au 17-11-2026 : la publication n'est pas encore en place.** Tout le reste est prêt et
> testé sur l'ordinateur ; il manque un compte GitHub et l'accord du propriétaire de l'appli pour
> créer les dépôts. Les étapes de la partie 1 n'ont donc jamais été exécutées « pour de vrai » :
> la première fois, suivre pas à pas et vérifier chaque résultat.

## 1. Mise en place (une seule fois)

### Ce que le propriétaire de l'appli doit faire lui-même

1. Créer un compte gratuit sur https://github.com (adresse e-mail, mot de passe, vérification).
2. Donner son accord à Claude pour créer deux dépôts sur ce compte :
   - `mon-budget` : **public**. Le code de l'appli et le site. L'hébergement gratuit de GitHub
     exige un dépôt public ; il ne contient aucune donnée personnelle (ni comptes, ni relevés).
   - `mon-budget-commentaires` : **privé**. Les commentaires et leurs captures.
3. Autoriser l'outil `gh` sur l'ordinateur quand Claude le demande (un code à recopier dans le
   navigateur ; aucun mot de passe n'est donné à Claude).

Si le code ne doit pas être public : GitHub Pro (payant) permet un dépôt privé, ou un autre
hébergeur de fichiers statiques (Cloudflare Pages, Netlify) peut publier le dossier `www/`. Rien
dans l'appli ne dépend de GitHub Pages : seules les adresses changent.

### Ce que Claude fait ensuite

Outils nécessaires sur l'ordinateur : `git` et `gh` (GitHub CLI), en plus de Node.

```
winget install Git.Git
winget install GitHub.cli
gh auth login                                   # le propriétaire valide dans son navigateur
```

Depuis le dossier du projet (`mon-budget/`) :

```
git init -b main
git add -A
git commit -m "Mon Budget 2.1.0"
gh repo create mon-budget --public --source . --push
gh repo create mon-budget-commentaires --private --add-readme
gh api -X POST repos/{owner}/mon-budget/pages -f build_type=workflow     # GitHub Pages publié par le workflow
```

Puis :

1. Copier `mon-budget.config.exemple.json` en `mon-budget.config.json` et y mettre l'adresse du site
   (`https://<compte>.github.io/mon-budget/`) et celle de la boîte (`<compte>/mon-budget-commentaires`).
2. Relancer la publication (`git commit` + `git push`, ou `npm run publier`) et attendre la fin du
   workflow « Publier l'appli » (onglet Actions du dépôt).
3. Vérifier que le site publié est identique aux fichiers d'ici :
   `node tools/pwa.mjs verifier https://<compte>.github.io/mon-budget/`
4. Donner l'adresse au propriétaire : il l'ouvre sur son téléphone et installe l'appli
   ([installer-sur-le-telephone.md](installer-sur-le-telephone.md)), puis règle la connexion à
   Claude ([connexion-claude.md](connexion-claude.md)).

Points d'attention à la première publication :

- Le fichier `.gitattributes` (`* -text`) doit être présent **avant** le premier `git add` : il
  empêche git de modifier les fins de ligne. Sans lui, les fichiers publiés pourraient différer
  d'un octet de ceux d'ici, et les téléphones refuseraient la mise à jour (chaque fichier est
  vérifié par son empreinte).
- Le workflow `.github/workflows/publier.yml` relance les tests avant de publier. S'il échoue, rien
  n'est mis en ligne : lire son journal dans l'onglet Actions.
- L'adresse ne doit plus changer ensuite : les données de l'appli installée sont attachées à cette
  adresse. En cas de changement d'adresse : sauvegarde complète, installation depuis la nouvelle
  adresse, restauration.

## 2. Publier une nouvelle version (à chaque modification)

1. Modifier le code, **augmenter le numéro de version aux trois endroits** :
   `package.json`, `www/js/ui/app.js` (`APP_VERSION`), et une entrée en tête de
   `www/js/changelog.js` (c'est ce que l'appli affichera dans « Quoi de neuf »).
2. Lancer :

   ```
   npm run publier -- "Ce qui change, en une phrase"
   ```

   La commande refait la liste des fichiers (`www/sw.js`), vérifie les numéros de version, lance
   tous les tests, envoie les changements, puis attend que le site publié soit, fichier pour
   fichier, celui d'ici. `npm run publier -- verifier` fait les contrôles sans rien envoyer.
3. Les téléphones voient la nouvelle version au prochain lancement de l'appli (ou dans Plus ›
   À propos › Chercher une mise à jour).

Ce qui protège d'une mauvaise publication :

| Garde-fou | Où |
| --- | --- |
| liste des fichiers pas à jour → `npm test` échoue | `tests/unit/pwa.test.js` |
| numéro de version oublié quelque part → refus | `tools/pwa.mjs`, `tools/publier.mjs` |
| un test en échec → rien n'est envoyé, rien n'est publié | `tools/publier.mjs`, workflow |
| un fichier publié différent de celui annoncé → le téléphone garde l'ancienne version | `www/sw.js` (empreinte SHA-256 de chaque fichier) |
| site publié ≠ fichiers d'ici → signalé | `node tools/pwa.mjs verifier <adresse>` |

## 3. Dépannage

| Ce qu'on voit | Cause probable | Remède |
| --- | --- | --- |
| `npm test` : « www/sw.js ne correspond plus aux fichiers de www/ » | un fichier de `www/` a été modifié après le dernier `npm run pwa` | `npm run pwa` |
| le téléphone ne voit pas la mise à jour | publication pas terminée, ou échouée | onglet Actions du dépôt ; `node tools/pwa.mjs verifier <adresse>` |
| Plus › À propos : « Sans connexion : pas encore prêt : … contenu différent » | le site sert un fichier différent de celui annoncé | republier ; vérifier `.gitattributes` ; `node tools/pwa.mjs verifier <adresse>` |
| le site affiche une erreur 404 | Pages pas activé, ou publié depuis une branche au lieu du workflow | réglages du dépôt › Pages › Source : « GitHub Actions » |
| `gh` ou `git` introuvable | outils non installés | voir la partie 1 |
