// Prépare le projet Android et fabrique l'APK — d'une seule commande.
//
//   node tools/android.mjs preparer   → crée/actualise le dossier android/ (sans compiler)
//   node tools/android.mjs apk        → idem, puis compile → dist/MonBudget-<version>-debug.apk
//
// Pré-requis sur l'ordinateur (voir docs/guide-apk.md) : Node.js, un JDK 21 (celui d'Android
// Studio convient) et le SDK Android (installé par Android Studio). Une connexion internet est
// nécessaire la première fois, pour télécharger Capacitor et Gradle.

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tweakGradleVersion, tweakManifest } from './android-tweaks.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'apk';
const isWindows = process.platform === 'win32';
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const step = (text) => console.log(`\n▸ ${text}`);
const stop = (text) => {
  console.error(`\n✖ ${text}\n`);
  process.exit(1);
};
const run = (command, cwd = root, env = process.env) => {
  console.log(`  $ ${command}`);
  execSync(command, { cwd, stdio: 'inherit', env });
};

if (!['preparer', 'apk'].includes(mode)) stop('Usage : node tools/android.mjs preparer | apk');

// 1. Dépendances
if (!existsSync(join(root, 'node_modules', '@capacitor', 'cli'))) {
  step('Installation des dépendances (npm install)…');
  run('npm install');
}

// 2. Projet Android
if (!existsSync(join(root, 'android'))) {
  step('Création du projet Android (npx cap add android)…');
  run('npx cap add android');
}
step('Copie de l\'appli dans le projet Android (npx cap sync android)…');
run('npx cap sync android');

// 3. Réglages (voir tools/android-tweaks.mjs)
step('Réglages du projet Android…');
const patch = (relative, tweak) => {
  const path = join(root, relative);
  if (!existsSync(path)) {
    console.log(`  ! ${relative} introuvable : réglage ignoré`);
    return;
  }
  const result = tweak(readFileSync(path, 'utf8'));
  if (result.changed) writeFileSync(path, result.text);
  for (const note of result.notes) console.log(`  • ${note}`);
  if (!result.notes.length) console.log(`  • ${relative} : déjà à jour`);
};
patch('android/app/src/main/AndroidManifest.xml', tweakManifest);
patch('android/app/build.gradle', (text) => tweakGradleVersion(text, version));

// 4. Icônes (facultatif : nécessite @capacitor/assets, téléchargé à la volée)
if (!existsSync(join(root, 'android', '.icones-faites'))) {
  step('Icône et écran de démarrage…');
  try {
    run('npx --yes @capacitor/assets generate --android --assetPath resources');
    writeFileSync(join(root, 'android', '.icones-faites'), 'Icônes générées à partir de resources/ — supprimer ce fichier pour les régénérer.\n');
  } catch {
    console.log("  ! Icônes non générées (l'appli garde l'icône par défaut de Capacitor). Ce n'est pas bloquant.");
  }
}

if (mode === 'preparer') {
  console.log('\n✔ Projet Android prêt dans android/. Pour compiler : node tools/android.mjs apk');
  console.log('  (ou ouvre le dossier android/ dans Android Studio, puis Build › Build APK)');
  process.exit(0);
}

// 5. Environnement de compilation
const env = { ...process.env };
if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
  const guesses = isWindows
    ? [join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk')]
    : [join(homedir(), 'Library', 'Android', 'sdk'), join(homedir(), 'Android', 'Sdk')];
  const sdk = guesses.find((p) => existsSync(p));
  if (sdk) {
    env.ANDROID_HOME = sdk;
    console.log(`\n  SDK Android trouvé : ${sdk}`);
  } else {
    stop("Le SDK Android est introuvable. Installe Android Studio (il installe le SDK), ouvre-le une fois, puis relance cette commande. Détails : docs/guide-apk.md");
  }
}
if (!env.JAVA_HOME) {
  const guesses = isWindows
    ? [join(env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'jbr')]
    : ['/Applications/Android Studio.app/Contents/jbr/Contents/Home', '/opt/android-studio/jbr', '/usr/lib/jvm/java-21-openjdk-amd64'];
  const jdk = guesses.find((p) => existsSync(p));
  if (jdk) {
    env.JAVA_HOME = jdk;
    console.log(`  JDK trouvé : ${jdk}`);
  }
}

// 6. Compilation
step('Compilation de l\'APK (la première fois, Gradle télécharge ses outils : plusieurs minutes)…');
try {
  run(isWindows ? 'gradlew.bat assembleDebug' : './gradlew assembleDebug', join(root, 'android'), env);
} catch {
  stop("La compilation a échoué. Le message d'erreur est juste au-dessus. Causes fréquentes : JDK absent ou trop ancien (il faut la version 21), licences du SDK non acceptées (ouvrir Android Studio une fois), pas de connexion internet au premier lancement. Voir docs/guide-apk.md.");
}

const built = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!existsSync(built)) stop(`Compilation terminée, mais le fichier attendu est introuvable : ${built}`);
mkdirSync(join(root, 'dist'), { recursive: true });
const target = join(root, 'dist', `MonBudget-${version}-debug.apk`);
copyFileSync(built, target);
console.log(`\n✔ APK prêt : ${target}`);
console.log("  Copie ce fichier sur le téléphone (câble USB, Drive, e-mail…), ouvre-le et accepte l'installation.");
