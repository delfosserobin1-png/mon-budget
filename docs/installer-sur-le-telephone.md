# Installer Mon Budget sur le téléphone (sans APK)

Depuis la version 2.1.0, l'appli s'installe directement depuis une adresse internet : pas de fichier
à transférer, pas de réglage « sources inconnues ». Une fois installée, elle a son icône, s'ouvre en
plein écran comme n'importe quelle appli, marche sans connexion, et se met à jour toute seule.

Techniquement, c'est une « appli web installable » (PWA). C'est le moteur de Chrome qui la fait
tourner en coulisses, mais tu ne vois pas Chrome : ni barre d'adresse, ni onglets.

## Ce qu'il faut

- L'adresse de l'appli (elle ressemble à `https://ton-nom.github.io/mon-budget/`). Elle existe une
  fois l'appli publiée : voir [publication.md](publication.md).
- Sur Android : Chrome, à jour.

## Installer

1. Sur le téléphone, ouvre l'adresse de l'appli dans Chrome.
2. Onglet **Plus**, bouton **Installer**. (Si le bouton dit « Comment faire » : menu ⋮ de Chrome en
   haut à droite, « Ajouter à l'écran d'accueil », puis « Installer ».)
3. L'icône « Mon Budget » arrive sur l'écran d'accueil. Ouvre l'appli depuis cette icône : à partir
   de là, tu n'as plus besoin de Chrome ni de l'adresse.

Sur iPhone ou iPad : dans Safari, bouton Partager, puis « Sur l'écran d'accueil ».

Ce que tu as saisi dans le navigateur avant d'installer est conservé : c'est le même stockage.

## Où sont les données

Sur le téléphone, dans le stockage de l'appli. Elles ne sont jamais envoyées sur internet.

- **Elles restent** quand tu fermes l'appli, éteins le téléphone, ou quand l'appli se met à jour.
- **Elles sont effacées** si tu désinstalles l'appli en choisissant d'effacer ses données, ou si tu
  vides les « données de site » de Chrome pour cette adresse. D'où l'intérêt des copies ci-dessous.

### Copie automatique dans un dossier du téléphone

Dans l'appli : **Plus › Sauvegarde et données › Choisir un dossier**. Choisis ou crée un dossier, par
exemple `Documents/MonBudget`. L'appli y écrit alors toute seule :

| Sous-dossier | Contenu |
| --- | --- |
| `Sauvegardes/` | une sauvegarde par jour, les 7 dernières sont gardées |
| `Exports/` | les classeurs Excel, CSV et sauvegardes que tu enregistres |
| `Releves/` | les relevés bancaires importés |
| `Pieces-jointes/` | les copies des photos de tickets |
| `Commentaires/` | les commentaires enregistrés comme fichier |

Ces fichiers se voient dans l'appli « Fichiers » du téléphone et depuis un ordinateur. Il arrive que
le téléphone redemande l'accès au dossier après un redémarrage : l'onglet Plus affiche alors un
bouton **Autoriser**, un toucher suffit.

Cette copie protège d'une fausse manipulation, pas d'un téléphone perdu ou cassé : pour cela, pense
à envoyer de temps en temps une **sauvegarde complète** ailleurs (mail, Drive, ordinateur). L'appli
te le rappelle.

## Les mises à jour

Quand une nouvelle version est publiée, l'appli la télécharge en arrière-plan, vérifie chaque
fichier, puis affiche un bandeau **Une nouvelle version est prête**. Touche **Mettre à jour** quand
tu veux ; sinon elle prendra le relais au prochain lancement. L'appli annonce ensuite ce qui a
changé (« Quoi de neuf »). Une mise à jour ne touche jamais aux données.

Pour vérifier à la main : **Plus › À propos › Chercher une mise à jour**.

## À vérifier sur le vrai téléphone, la première fois

Tout ce qui suit a été testé automatiquement dans un navigateur d'ordinateur réglé comme un
téléphone. Ces points-ci dépendent du téléphone lui-même et n'ont pas pu l'être :

1. **Installation** : le bouton Installer apparaît, l'icône arrive sur l'écran d'accueil avec le
   dessin de l'enveloppe, l'appli s'ouvre sans barre d'adresse.
2. **Sans connexion** : mode avion, puis ouvrir l'appli depuis son icône : elle démarre et les
   données sont là. Plus › À propos › Lancer la vérification : tout est vert.
3. **Dossier de copie** : « Choisir un dossier » ouvre bien la fenêtre du téléphone ; après le choix,
   un fichier apparaît dans `Sauvegardes/`. Fermer complètement l'appli, la rouvrir : la copie
   fonctionne encore, ou le bouton Autoriser apparaît.
4. **Import** d'un relevé PDF et **photo** d'un ticket (appareil photo et galerie).
5. **Export** : « Partager » ouvre le menu du téléphone avec le fichier joint.
6. **Bouton retour** du téléphone : ferme la feuille, puis le sous-écran, puis revient au premier
   onglet.
7. **Thème sombre** du téléphone et **grande taille de police** : rien ne déborde.
8. **Raccourci** : appui long sur l'icône, « Nouvelle opération ».

Si quelque chose cloche, écris-le dans l'appli : Plus › Commentaires pour Claude.

## Et l'APK ?

Il reste possible (voir [guide-apk.md](guide-apk.md)) : le même dossier `www/` sert aux deux. Son
seul avantage est de ne dépendre d'aucune adresse internet ; en échange, chaque mise à jour demande
de refabriquer et de réinstaller le fichier à la main.
