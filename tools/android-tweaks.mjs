// Réglages appliqués au projet Android généré par Capacitor (dossier android/).
// Ce sont de simples retouches de texte, sans danger si on les rejoue : chaque fonction renvoie
// { text, changed, note } et ne touche à rien si le réglage est déjà en place ou si le fichier ne
// ressemble pas à ce qu'elle attend (dans ce cas `note` l'explique, et on continue).

/** AndroidManifest.xml */
export function tweakManifest(source) {
  let text = source;
  const notes = [];
  const ensureAttribute = (tagPattern, name, value, label) => {
    const tag = tagPattern.exec(text);
    if (!tag) {
      notes.push(`${label} : balise introuvable, réglage ignoré`);
      return;
    }
    const attr = new RegExp(`\\s${name.replace(':', '\\:')}="[^"]*"`);
    let updated;
    if (attr.test(tag[0])) updated = tag[0].replace(attr, ` ${name}="${value}"`);
    else updated = tag[0].replace(/^(<[\w.]+)/, `$1 ${name}="${value}"`);
    if (updated !== tag[0]) {
      text = text.replace(tag[0], () => updated);
      notes.push(`${label} : ${name}="${value}"`);
    }
  };

  // 100 % local : pas de copie automatique des données de l'appli vers le compte Google.
  ensureAttribute(/<application\b[^>]*>/, 'android:allowBackup', 'false', 'application');
  // Android 10 : accès au dossier Documents (sans effet sur les versions suivantes).
  ensureAttribute(/<application\b[^>]*>/, 'android:requestLegacyExternalStorage', 'true', 'application');
  // Écran en portrait, et la page se redimensionne quand le clavier apparaît.
  ensureAttribute(/<activity\b[^>]*android:name="\.MainActivity"[^>]*>|<activity\b[^>]*>/, 'android:screenOrientation', 'portrait', 'activité');
  ensureAttribute(/<activity\b[^>]*android:name="\.MainActivity"[^>]*>|<activity\b[^>]*>/, 'android:windowSoftInputMode', 'adjustResize', 'activité');

  // Android 9 et 10 : autorisation d'écrire dans Documents/MonBudget (inutile ensuite).
  for (const permission of ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
    if (text.includes(`android.permission.${permission}`)) continue;
    const line = `    <uses-permission android:name="android.permission.${permission}" android:maxSdkVersion="29" />\n`;
    if (!text.includes('</manifest>')) {
      notes.push(`permission ${permission} : fin du fichier introuvable, réglage ignoré`);
      continue;
    }
    text = text.replace('</manifest>', () => `${line}</manifest>`);
    notes.push(`permission ${permission} (Android 10 et plus anciens)`);
  }
  return { text, changed: text !== source, notes };
}

/** android/app/build.gradle : numéro de version de l'appli (repris de package.json). */
export function tweakGradleVersion(source, version) {
  const parts = String(version).split('.').map((n) => Number.parseInt(n, 10) || 0);
  // 2.0.0 → 20000 ; 2.3.14 → 20314 : toujours croissant, comme l'exige Android pour une mise à jour
  const code = parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  let text = source;
  const notes = [];
  if (/versionCode\s+\d+/.test(text)) {
    const next = text.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    if (next !== text) notes.push(`versionCode ${code}`);
    text = next;
  } else notes.push('versionCode introuvable, réglage ignoré');
  if (/versionName\s+"[^"]*"/.test(text)) {
    const next = text.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
    if (next !== text) notes.push(`versionName "${version}"`);
    text = next;
  } else notes.push('versionName introuvable, réglage ignoré');
  return { text, changed: text !== source, notes };
}
