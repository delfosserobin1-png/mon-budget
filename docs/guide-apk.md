# Fabriquer l'APK à la main (sans Claude Code)

> Depuis la version 2.1.0, l'APK n'est plus nécessaire : l'appli s'installe directement depuis une
> adresse internet et se met à jour toute seule (voir `installer-sur-le-telephone.md`). Ce guide
> reste valable pour qui préfère un APK ; le même dossier `www/` sert aux deux.

L'appli est une page web (dossier `www/`) emballée dans une coquille Android par **Capacitor**.
Fabriquer l'APK, c'est : créer le projet Android, y copier `www/`, compiler. Une commande fait tout.

## Ce qu'il faut sur l'ordinateur

| Outil | Pourquoi | Où |
| --- | --- | --- |
| Node.js 22 ou plus | lance les outils du projet | https://nodejs.org (bouton LTS) |
| Android Studio | fournit le SDK Android et le JDK 21 | https://developer.android.com/studio |

Après avoir installé Android Studio, **ouvre-le une fois** et laisse l'assistant télécharger le SDK
(accepte les licences). C'est tout ce qu'on lui demande ; tu n'as pas besoin de savoir t'en servir.

## La commande

Dans PowerShell :

```powershell
cd "chemin\vers\mon-budget"
npm install
npm run apk
```

Ce que fait `npm run apk` (script `tools/android.mjs`) :

1. `npx cap add android` : crée le dossier `android/` (la première fois seulement) ;
2. `npx cap sync android` : y copie le contenu de `www/` et branche les trois modules
   (fichiers, partage, bouton retour) ;
3. applique quelques réglages au projet Android (voir plus bas) ;
4. génère l'icône et l'écran de démarrage à partir de `resources/` ;
5. compile avec Gradle ;
6. copie le résultat dans `dist/MonBudget-<version>-debug.apk`.

La première compilation télécharge Gradle et ses dépendances : compte 5 à 15 minutes et une connexion
internet. Les suivantes prennent une à deux minutes.

## Installer sur le téléphone

Envoie l'APK sur le téléphone, ouvre-le, autorise l'installation depuis cette source, puis
« Installer ». Une mise à jour s'installe par-dessus l'ancienne version sans perdre les données.

Un APK « debug » convient parfaitement à un usage personnel et à quelques proches. Pour une diffusion
plus large (ou le Play Store), il faudra un APK « release » signé : demande-le à Claude Code le
moment venu, c'est une étape à part (création d'une clé de signature à conserver précieusement).

## Les réglages appliqués au projet Android

`tools/android-tweaks.mjs` retouche deux fichiers générés par Capacitor. Les retouches sont
rejouables sans danger et testées (`tests/unit/android-tweaks.test.js`).

| Réglage | Fichier | Raison |
| --- | --- | --- |
| `allowBackup="false"` | AndroidManifest.xml | données 100 % locales : pas de copie vers le compte Google |
| `screenOrientation="portrait"` | AndroidManifest.xml | l'appli est pensée pour le téléphone tenu droit |
| `windowSoftInputMode="adjustResize"` | AndroidManifest.xml | les champs restent visibles au-dessus du clavier |
| `requestLegacyExternalStorage`, permissions de stockage limitées à Android 10 | AndroidManifest.xml | écrire dans `Documents/MonBudget` sur les anciens téléphones (inutile à partir d'Android 11) |
| `versionCode` / `versionName` | app/build.gradle | repris de `package.json` |

L'appli ne demande rien d'autre : ni contacts, ni position, ni micro. La permission « internet »
que Capacitor déclare par défaut sert à afficher la page embarquée dans l'appli ; Mon Budget n'envoie
et ne télécharge rien. L'appareil photo est ouvert par Android lui-même quand tu choisis « Prendre
une photo ».

## Autre méthode : compiler depuis Android Studio

```powershell
npm install
npm run android:preparer
```

Puis dans Android Studio : **Open** → choisir le dossier `mon-budget\android` → attendre la fin de la
synchronisation → menu **Build › Build App Bundle(s) / APK(s) › Build APK(s)**. Un lien « locate »
apparaît en bas à droite.

## Dépannage

| Message | Cause probable | Remède |
| --- | --- | --- |
| `SDK location not found` | SDK non installé ou introuvable | ouvrir Android Studio une fois ; sinon définir la variable `ANDROID_HOME` vers `%LOCALAPPDATA%\Android\Sdk` |
| `Unsupported class file major version` ou `requires Java 21` | mauvais JDK | définir `JAVA_HOME` vers `C:\Program Files\Android\Android Studio\jbr` |
| `License for package … not accepted` | licences du SDK | Android Studio › More Actions › SDK Manager, accepter ; ou `sdkmanager --licenses` |
| `Could not resolve …` / `timeout` | pas d'accès internet au premier lancement | vérifier la connexion (pare-feu d'entreprise ?) et relancer |
| l'APK s'installe mais l'écran est blanc | le WebView du téléphone est très ancien | mettre à jour « Android System WebView » et Chrome dans le Play Store |
| « Appli non installée » à la mise à jour | l'APK précédent venait d'un autre ordinateur (signature différente) | sauvegarder (Plus › Sauvegarde), désinstaller, réinstaller, restaurer |

## Après un changement dans `www/`

`npm run apk` suffit : il recopie `www/` dans le projet Android avant de compiler. Pense à augmenter
le numéro de version dans `package.json` et dans `www/js/ui/app.js` (`APP_VERSION`) pour t'y
retrouver entre deux APK.
