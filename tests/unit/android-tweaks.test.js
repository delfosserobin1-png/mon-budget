import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tweakManifest, tweakGradleVersion } from '../../tools/android-tweaks.mjs';

// Le manifeste tel que le génère Capacitor (npx cap add android).
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths"></meta-data>
        </provider>
    </application>

    <!-- Permissions -->

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

test('manifeste Android : réglages appliqués une fois, sans rien casser', () => {
  const first = tweakManifest(MANIFEST);
  assert.equal(first.changed, true);
  assert.match(first.text, /<application\s[^>]*android:allowBackup="false"/);
  assert.ok(!first.text.includes('android:allowBackup="true"'));
  assert.match(first.text, /<application\s[^>]*android:requestLegacyExternalStorage="true"/);
  assert.match(first.text, /<activity\s[^>]*android:screenOrientation="portrait"/);
  assert.match(first.text, /<activity\s[^>]*android:windowSoftInputMode="adjustResize"/);
  assert.match(first.text, /WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29"/);
  assert.match(first.text, /READ_EXTERNAL_STORAGE" android:maxSdkVersion="29"/);
  // rien d'autre n'a bougé : mêmes balises, même nombre de fermetures
  for (const tag of ['<intent-filter>', '</activity>', '<provider', '</application>', 'android.permission.INTERNET', 'android:name=".MainActivity"', 'android:exported="true"']) {
    assert.equal(first.text.split(tag).length, MANIFEST.split(tag).length, tag);
  }
  assert.equal(first.text.split('</manifest>').length, 2);
  // rejouer ne change plus rien
  const second = tweakManifest(first.text);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
  assert.deepEqual(second.notes, []);
});

test('manifeste inattendu : on ne casse rien et on le dit', () => {
  const odd = tweakManifest('<manifest></manifest>');
  assert.ok(odd.notes.some((n) => n.includes('introuvable')));
  assert.equal(odd.text.split('</manifest>').length, 2);
});

test('version Android reprise de package.json', () => {
  const gradle = `android {\n    defaultConfig {\n        applicationId "fr.monbudget.app"\n        versionCode 1\n        versionName "1.0"\n    }\n}\n`;
  const out = tweakGradleVersion(gradle, '2.0.0');
  assert.match(out.text, /versionCode 20000\n/);
  assert.match(out.text, /versionName "2\.0\.0"/);
  assert.equal(tweakGradleVersion(out.text, '2.0.0').changed, false);
  assert.match(tweakGradleVersion(gradle, '2.3.14').text, /versionCode 20314\n/);
  assert.ok(tweakGradleVersion('rien', '2.0.0').notes.length === 2);
});

test("le numéro de version est le même partout (package.json, appli)", async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const source = readFileSync(new URL('../../www/js/ui/app.js', import.meta.url), 'utf8');
  const match = /APP_VERSION = '([^']+)'/.exec(source);
  assert.ok(match, 'APP_VERSION introuvable dans www/js/ui/app.js');
  assert.equal(match[1], pkg.version);
  const config = JSON.parse(readFileSync(new URL('../../capacitor.config.json', import.meta.url), 'utf8'));
  assert.deepEqual([config.appId, config.webDir], ['fr.monbudget.app', 'www']);
});
