// Publication (tools/publier.mjs) : les contrôles d'avant envoi et l'attente de la mise en ligne.
// L'envoi lui-même (git) et la mise en ligne réelle demandent un compte et un dépôt : ils ne sont
// pas testés ici (voir docs/publication.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChangelog, push, waitForDeployment, PublishError } from '../../tools/publier.mjs';
import { updateServiceWorker } from '../../tools/pwa.mjs';
import { startServer } from '../../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Un petit projet d'essai : numéro de version partout, et le journal qui annonce `announced`. */
function project(version, announced = version, title = 'Essai') {
  const root = mkdtempSync(join(tmpdir(), 'mon-budget-publier-'));
  mkdirSync(join(root, 'www', 'js', 'ui'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version, type: 'module' }));
  writeFileSync(join(root, 'www', 'index.html'), `<!doctype html><title>${title}</title>`);
  writeFileSync(join(root, 'www', 'js', 'ui', 'app.js'), `export const APP_VERSION = '${version}';\n`);
  writeFileSync(join(root, 'www', 'js', 'changelog.js'), `export const CHANGES = [{ version: '${announced}', date: '2026-11-17', title: '${title}', items: ['Un changement.'] }];\n`);
  cpSync(join(ROOT, 'www', 'sw.js'), join(root, 'www', 'sw.js'));
  updateServiceWorker({ root });
  return root;
}

test('publier : la version doit être annoncée en tête du journal affiché par l’appli', async () => {
  const ok = await checkChangelog(project('3.0.0'), '3.0.0');
  assert.deepEqual([ok.version, ok.title], ['3.0.0', 'Essai']);
  await assert.rejects(checkChangelog(project('3.0.1', '3.0.0'), '3.0.1'), (error) => {
    assert.ok(error instanceof PublishError);
    assert.match(error.message, /n'annonce pas la version 3\.0\.1/);
    return true;
  });
});

test('publier : on attend que le site publié soit identique, fichier pour fichier', async () => {
  const local = project('3.0.0', '3.0.0', 'Nouvelle');
  const old = project('2.9.0', '2.9.0', 'Ancienne');
  const server = await startServer({ port: 0, root: join(old, 'www'), prefix: '/mon-budget/' });
  try {
    const waits = [];
    // l'hébergeur sert encore l'ancienne version… puis la nouvelle arrive
    const pending = waitForDeployment(server.url, { root: local, everyMs: 20, timeoutMs: 5000, log: (line) => waits.push(line) });
    setTimeout(() => server.setRoot(join(local, 'www')), 120);
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.checked, 3);
    assert.ok(waits.length >= 1, 'au moins un essai avant la mise en ligne');
    assert.match(waits[0], /^pas encore en ligne \(sw\.js : la version publiée est différente/);

    // la nouvelle version n'arrive jamais : on finit par le dire, sans attendre indéfiniment
    server.setRoot(join(old, 'www'));
    const late = await waitForDeployment(server.url, { root: local, everyMs: 10, timeoutMs: 60, log: () => {} });
    assert.equal(late.ok, false);
    assert.ok(late.problems.some((problem) => /index\.html : contenu différent/.test(problem)));
  } finally {
    await server.close();
  }
  // aucun site à cette adresse
  const nowhere = await waitForDeployment('http://127.0.0.1:9/mon-budget/', { root: local, everyMs: 10, timeoutMs: 30, log: () => {} });
  assert.equal(nowhere.ok, false);
});

test('publier : sans dépôt git, rien n’est envoyé et l’explication renvoie au guide', () => {
  const root = project('3.0.0');
  assert.throws(() => push(root, 'Version 3.0.0'), (error) => {
    assert.ok(error instanceof PublishError);
    // selon l'ordinateur : git absent, ou dossier pas encore relié à un dépôt
    assert.match(error.message, /git/);
    return true;
  });
});
