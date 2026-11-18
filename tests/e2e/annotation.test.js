// Bouton IA, dans un vrai navigateur : entourer un endroit de l'écran (ou le toucher), écrire, envoyer.
// GitHub est remplacé par le faux GitHub en mémoire (tests/fake-github.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startAll, stopAll, openApp, openTab, sheet, noOverlay, settled, readState, shot } from './harness.js';
import { parseMarker } from '../../www/js/core/comments.js';
import { createFakeGithub } from '../fake-github.js';

before(startAll);
after(stopAll);

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

async function connect(page, fake) {
  await page.evaluate(() => window.monBudget.open('claude'));
  await page.locator('[data-screen="claude"] input[name="repo"]').fill(`${fake.repo}:${fake.token}`);
  await page.locator('[data-screen="claude"] [data-action="connect"]').click();
  await page.waitForSelector('[data-screen="claude"] [data-card="link"]');
  await page.waitForFunction(() => !window.monBudget.claude.status.busy);
  await page.evaluate(() => window.monBudget.go('operations'));
  await settled(page);
}

/** Trace un cercle à la souris autour d'une boîte (comme un doigt sur l'écran). */
async function circle(page, box, radius = 38) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // on part du côté gauche : le bouton + est collé au bord droit de l'écran
  await page.mouse.move(cx - radius, cy);
  await page.mouse.down();
  for (let step = 1; step <= 24; step++) {
    const angle = Math.PI + (step / 24) * Math.PI * 2;
    await page.mouse.move(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  await page.mouse.up();
}

const pngSize = (bytes) => ({ width: (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19], height: (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23] });

test('bouton IA : entourer le bouton +, écrire, envoyer : capture annotée et élément visé arrivent chez Claude', async () => {
  const fake = createFakeGithub({ repo: 'moi/mon-budget-commentaires' });
  const ctx = await openApp({ demo: true, setup: (context) => fake.install(context) });
  const { page } = ctx;
  await connect(page, fake);

  const ai = page.locator('.ai-fab');
  assert.equal(await ai.isVisible(), true, 'le bouton IA est là, sur le bord droit');
  await ai.click();
  await page.waitForSelector('.annotate-layer');
  assert.equal(await ai.isVisible(), false, 'il s’efface pendant qu’on entoure');
  assert.equal(await page.locator('[data-action="annotate-next"]').isDisabled(), true, 'rien d’entouré : on ne peut pas continuer');

  const plus = await page.locator('[data-screen="operations"] [data-action="add"]').boundingBox();
  await circle(page, plus);
  assert.equal(await page.locator('[data-action="annotate-next"]').isDisabled(), false);
  await shot(page, 'ia-entourer');
  await page.locator('[data-action="annotate-next"]').click();

  const form = sheet(page);
  await form.locator('[data-value="target"]').waitFor();
  assert.equal(await form.locator('.sheet-head h2').innerText(), 'Commentaire pour Claude');
  assert.match(await form.locator('[data-value="target"]').innerText(), /bouton « Ajouter une opération » — écran « Opérations »/);
  await page.waitForFunction(() => document.querySelector('.annotate-preview img')?.naturalWidth > 0);
  assert.equal(await page.locator('.annotate-layer').count(), 0);
  // la capture masque les montants par défaut, et les montre si on le demande
  const svgs = await page.evaluate(async () => {
    const { buildCaptureSvg } = await import('./js/ui/capture.js');
    window.monBudget.notify('Message passager'); // les messages passagers ne figurent pas sur la capture
    const masked = (await buildCaptureSvg({ maskAmounts: true })).svg;
    const plain = (await buildCaptureSvg({ maskAmounts: false })).svg;
    const money = /\d,\d\d[\s  ]?€/;
    return {
      maskedHasMoney: money.test(masked),
      maskedHasDots: masked.includes('••• €'),
      plainHasMoney: money.test(plain),
      embedsFonts: masked.includes('data:font/woff;base64,'),
      toastShown: document.querySelector('.toast')?.textContent === 'Message passager',
      toastCaptured: plain.includes('Message passager'),
    };
  });
  assert.deepEqual(svgs, { maskedHasMoney: false, maskedHasDots: true, plainHasMoney: true, embedsFonts: true, toastShown: true, toastCaptured: false });
  await shot(page, 'ia-commentaire');

  await form.locator('[data-action="send-annotation"]').click();
  assert.match(await form.locator('[data-field="text"] .error:not([hidden])').innerText(), /Écris ton commentaire/);
  await form.locator('textarea[name="text"]').fill('Ce bouton pourrait être un peu plus grand.');
  await form.locator('[data-action="send-annotation"]').click();
  await noOverlay(page);
  await page.waitForFunction(() => window.monBudget.state.bugReports[0]?.remote?.number === 1);
  assert.match(await page.locator('.toast').innerText(), /Envoyé à Claude/);
  assert.equal(await ai.isVisible(), true, 'le bouton revient');

  // ce que Claude reçoit
  const issue = fake.issues[0];
  assert.equal(issue.title, '[Idée] Ce bouton pourrait être un peu plus grand.');
  assert.match(issue.body, /\*\*Élément visé\*\* : bouton « Ajouter une opération » — écran « Opérations »/);
  const marker = parseMarker(issue.body);
  assert.match(marker.target.path, /button\.fab\[data-action="add"\]$/);
  assert.equal(marker.target.screen, 'operations');
  assert.ok(marker.target.area.w > 50 && marker.target.area.h > 50, 'la zone entourée est transmise');
  assert.equal(marker.captures.length, 1);
  const png = fake.files.get(marker.captures[0]);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'une vraie image PNG');
  assert.deepEqual(pngSize(png), { width: 412, height: 915 }, "l'écran entier, à sa taille");
  assert.ok(png.length > 5000);
  const report = (await readState(page)).bugReports[0];
  assert.deepEqual([report.origin, report.kind, report.screen, report.photoIds.length], ['annotation', 'idee', 'operations', 1]);

  // dans Plus › Commentaires, le commentaire rappelle l'élément visé
  await page.evaluate(() => window.monBudget.open('bugs'));
  await page.locator(`[data-report="${report.id}"]`).click();
  assert.match(await sheet(page).locator('[data-value="target"]').innerText(), /Élément visé : bouton « Ajouter une opération »/);
  await done(ctx);
});

test('bouton IA : un simple toucher choisit l’élément, par-dessus un formulaire ouvert, en thème sombre ; sans connexion le commentaire est gardé', async () => {
  const ctx = await openApp({ demo: true, dark: true });
  const { page } = ctx;
  await page.locator('[data-screen="operations"] [data-action="add"]').click();
  await sheet(page).locator('input[name="amount"]').waitFor();
  await page.locator('.ai-fab').click();
  await page.waitForSelector('.annotate-layer');
  // Échap (comme le bouton retour) ferme ce mode sans rien faire
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.annotate-layer'));
  assert.equal(await page.locator('.sheet').count(), 1, 'le formulaire est toujours là');

  await page.locator('.ai-fab').click();
  await page.waitForSelector('.annotate-layer');
  const amount = await sheet(page).locator('input[name="amount"]').boundingBox();
  await page.mouse.click(amount.x + amount.width / 2, amount.y + amount.height / 2);
  await page.locator('[data-action="annotate-next"]').click();
  const form = sheet(page);
  await form.locator('[data-value="target"]').waitFor();
  assert.match(await form.locator('[data-value="target"]').innerText(), /champ « Montant » — feuille « Nouvelle opération »/);
  await page.waitForFunction(() => document.querySelector('.annotate-preview img')?.naturalWidth > 0);
  // pas de connexion : on enregistre, sans envoyer
  assert.match(await form.locator('[data-action="send-annotation"]').innerText(), /Enregistrer/);
  await form.locator('.seg button[data-value="bug"]').click();
  await form.locator('textarea[name="text"]').fill('Le champ montant est trop petit en mode sombre.');
  // sans la capture, cette fois
  await form.locator('[data-action="remove-capture"]').click();
  await form.locator('[data-action="send-annotation"]').click();
  await page.waitForFunction(() => window.monBudget.state.bugReports.length === 1 && !window.monBudget.busy);
  const report = (await readState(page)).bugReports[0];
  assert.deepEqual([report.kind, report.origin, report.photoIds.length, report.queued, report.remote], ['bug', 'annotation', 0, false, null]);
  assert.equal(report.target.role, 'field');
  assert.match(report.target.context, /Nouvelle opération/);
  assert.match(await page.locator('.toast').innerText(), /Commentaire enregistré/);
  await sheet(page).locator('.sheet-head .icon-btn').click();
  await noOverlay(page);
  await done(ctx);
});

test('bouton IA : il ne cache aucun chiffre ; on le fait glisser le long du bord ou vers l’autre bord, il garde sa place ; on peut le masquer', async () => {
  const ctx = await openApp({ demo: true });
  const { page } = ctx;
  const ai = page.locator('.ai-fab');
  // dans la liste des opérations, l'onglet couvre au plus le « € » des montants à sa hauteur
  const rows = await page.evaluate(() => {
    const tab = document.querySelector('.ai-fab').getBoundingClientRect();
    const out = [];
    for (const amt of document.querySelectorAll('[data-screen="operations"] [data-op] .side .amt')) {
      const box = amt.getBoundingClientRect();
      if (box.bottom <= tab.top || box.top >= tab.bottom) continue;
      const text = amt.firstChild;
      const digits = document.createRange();
      digits.setStart(text, 0);
      digits.setEnd(text, text.nodeValue.lastIndexOf(' '));
      out.push({ amount: amt.textContent, digitsRight: digits.getBoundingClientRect().right, tabLeft: tab.left });
    }
    return out;
  });
  assert.ok(rows.length > 0, 'l’onglet est à hauteur d’une ligne de la liste');
  for (const row of rows) assert.ok(row.digitsRight <= row.tabLeft, `les chiffres de « ${row.amount} » restent visibles (${row.digitsRight} ≤ ${row.tabLeft})`);

  const before = await ai.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 60, { steps: 6 });
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 140, { steps: 6 });
  await page.mouse.up();
  await settled(page);
  assert.equal(await page.locator('.annotate-layer').count(), 0, 'glisser ne lance pas le mode « entourer »');
  const moved = await ai.boundingBox();
  assert.ok(Math.abs(moved.y - before.y - 140) < 4, `déplacé de 140 px (${moved.y - before.y})`);
  assert.ok(moved.x + moved.width > 410, 'toujours collé au bord droit');
  // glissé vers la gauche : passé le milieu de l'écran, il change de bord
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(150, moved.y + moved.height / 2, { steps: 8 });
  await page.mouse.move(30, moved.y + moved.height / 2, { steps: 8 });
  await page.mouse.up();
  await settled(page);
  assert.equal(await page.locator('.annotate-layer').count(), 0);
  const left = await ai.boundingBox();
  assert.ok(left.x < 1 && Math.abs(left.y - moved.y) < 4, `collé au bord gauche, à la même hauteur (${left.x}, ${left.y - moved.y})`);
  const again = await openApp({ context: ctx.context, demo: false });
  const kept = await again.page.locator('.ai-fab').boundingBox();
  assert.ok(Math.abs(kept.y - moved.y) < 4 && kept.x < 1, 'la place et le bord sont retenus');

  // masqué depuis Plus › Commentaires pour Claude, et toujours masqué à la réouverture
  await again.page.evaluate(() => window.monBudget.open('bugs'));
  await again.page.locator('[data-screen="bugs"] [data-field="aiButton"]').click();
  await again.page.waitForFunction(() => document.querySelector('.ai-fab').hidden);
  const third = await openApp({ context: ctx.context });
  assert.equal(await third.page.locator('.ai-fab').isVisible(), false);
  await third.page.evaluate(() => window.monBudget.open('bugs'));
  await third.page.locator('[data-screen="bugs"] [data-field="aiButton"]').click();
  await third.page.waitForFunction(() => !document.querySelector('.ai-fab').hidden);
  // pas de bouton IA sur l'écran de verrouillage
  await third.page.evaluate(async () => {
    const { makePin } = await import('./js/ui/screens/lock.js');
    await window.monBudget.setSetting('pin', makePin('2580'));
    window.monBudget.lockNow();
  });
  await third.page.waitForSelector('.lock');
  assert.equal(await third.page.locator('.ai-fab').isVisible(), false);
  assert.deepEqual([...again.problems, ...third.problems], []);
  await done(ctx);
});
