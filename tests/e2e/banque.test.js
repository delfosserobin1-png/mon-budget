// Banque : rapprochement manuel et import de relevé (PDF, OFX, CSV) avec son assistant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAll, stopAll, openApp, addOperation, openTab, sheet, answer, noOverlay, settled, readState, balancesOf, valueOf, chooseFile, ROOT } from './harness.js';

before(startAll);
after(stopAll);

const SAMPLE = join(ROOT, 'www', 'exemples', 'releve-exemple.pdf');
const EXPECTED = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'releve-exemple.attendu.json'), 'utf8'));
const TMP = mkdtempSync(join(tmpdir(), 'mon-budget-'));
const AFTER_STATEMENT = '2026-08-10T10:30:00';

async function done(ctx) {
  assert.deepEqual(ctx.problems, [], 'aucune erreur dans la console du navigateur');
  await ctx.context.close();
}

const wizard = (page) => page.locator('[data-screen="statement"]');
const stepTitle = (page) => wizard(page).locator('.topbar h1').innerText();
async function next(page) {
  await wizard(page).locator('[data-action="next"]').click();
}
async function importFile(page, path) {
  await page.evaluate(() => window.monBudget.open('statement'));
  await chooseFile(page, () => wizard(page).locator('[data-action="choose-file"]').click(), path);
}

test('rapprochement manuel : écart constaté, ajusté, puis plus aucun écart', async () => {
  const ctx = await openApp();
  const { page } = ctx;
  await addOperation(page, { mode: 'income', amount: '1000', label: 'Salaire' });
  await addOperation(page, { mode: 'expense', amount: '100', label: 'Courses' });
  await openTab(page, 'more');
  await page.locator('[data-open="reconcile"]').click();
  assert.equal(await valueOf(page, 'computed'), 90000);
  await page.locator('[data-screen="reconcile"] input[name="realBalance"]').fill('880');
  await page.locator('[data-action="compare"]').click();
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog h2').innerText(), /Écart de 20,00/);
  assert.match(await page.locator('.dialog').innerText(), /La banque a moins que l'appli/);
  await answer(page, 'adjust');
  await noOverlay(page);
  let state = await readState(page);
  assert.equal(state.reconciliations.length, 1);
  const adjustment = state.operations.find((o) => o.kind === 'adjustment');
  assert.equal(adjustment.amount, -2000);
  assert.equal(state.reconciliations[0].adjustmentOperationId, adjustment.id);
  assert.equal(await valueOf(page, 'computed'), 88000);

  await page.locator('[data-screen="reconcile"] input[name="realBalance"]').fill('880');
  await page.locator('[data-action="compare"]').click();
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog h2').innerText(), /Aucun écart/);
  await answer(page, true);
  await noOverlay(page);
  await page.evaluate(() => window.monBudget.back());
  await openTab(page, 'operations');
  assert.deepEqual(await balancesOf(page), { available: 88000, total: 88000 });
  await done(ctx);
});

test("premier relevé dans une appli vide : tout est créé, le solde retombe sur celui de la banque, et tout s'annule d'un geste", async () => {
  const ctx = await openApp({ onboarding: true, now: AFTER_STATEMENT });
  const { page } = ctx;
  await page.locator('.sheet [data-action="start-statement"]').click();
  await wizard(page).locator('[data-action="example"]').click();
  await page.waitForSelector('[data-value="line-count"]');
  assert.equal(await wizard(page).locator('[data-value="line-count"]').innerText(), String(EXPECTED.lineCount));
  assert.equal(await valueOf(page, 'opening'), EXPECTED.openingBalance);
  assert.equal(await valueOf(page, 'closing'), EXPECTED.closingBalance);
  assert.equal(await valueOf(page, 'total-debit'), -EXPECTED.totalDebit);
  assert.equal(await valueOf(page, 'total-credit'), EXPECTED.totalCredit);
  assert.equal(await wizard(page).locator('[data-check="ok"]').count(), 1, 'la lecture est vérifiée par les soldes imprimés');
  assert.equal(await wizard(page).locator('[data-value="count-missing"]').innerText(), String(EXPECTED.lineCount));

  await next(page);
  assert.equal(await stepTitle(page), 'À ajouter');
  assert.equal(await wizard(page).locator('.op-row').count(), EXPECTED.lineCount);

  // on range la première ligne « Super Marche Bio » : les autres lignes du même magasin suivent
  await wizard(page).locator('.op-row', { hasText: 'Super Marche Bio' }).first().click();
  await sheet(page).locator('[data-action="new-tag"]').click();
  await page.locator('.dialog input').fill('Courses');
  await answer(page, 'ok');
  await page.waitForFunction(() => window.monBudget.state.tags.length === 1 && !window.monBudget.busy);
  await sheet(page).locator('.pick', { hasText: 'Nécessité' }).click();
  await sheet(page).locator('input[name="label"]').fill('Courses');
  await sheet(page).locator('[data-action="save-line"]').click();
  await noOverlay(page);
  const tagged = wizard(page).locator('.op-row', { has: page.locator('.chip', { hasText: 'Courses' }) });
  const titles = await tagged.locator('.title').allInnerTexts();
  assert.equal(titles.filter((t) => t === 'Courses').length, 4, 'les 4 passages au même magasin sont rangés et renommés pareil');
  // et le tag « Courses » existant, le catalogue y range aussi la boulangerie (3 passages), sans la renommer
  assert.deepEqual(titles.filter((t) => t !== 'Courses').map((t) => t.toLowerCase()), ['boulangerie du parc', 'boulangerie du parc', 'boulangerie du parc']);

  // une ligne ignorée puis rétablie
  await wizard(page).locator('.op-row', { hasText: 'Fleuriste Rose' }).click();
  await sheet(page).locator('[data-action="skip-line"]').click();
  await noOverlay(page);
  assert.equal(await wizard(page).locator('.op-row[data-state="skipped"]').count(), 1);
  await wizard(page).locator('.op-row[data-state="skipped"]').click();
  await sheet(page).locator('[data-action="skip-line"]').click();
  await noOverlay(page);
  assert.equal(await wizard(page).locator('.op-row[data-state="skipped"]').count(), 0);

  await next(page);
  assert.equal(await stepTitle(page), 'Bilan');
  assert.equal(await wizard(page).locator('[data-value="created"]').innerText(), String(EXPECTED.lineCount));
  assert.equal(await valueOf(page, 'opening-bank'), EXPECTED.openingBalance);
  assert.equal(await wizard(page).locator('[data-check="closing-ok"]').count(), 1);
  assert.equal(await valueOf(page, 'total-after'), EXPECTED.closingBalance);
  await wizard(page).locator('[data-action="commit"]').click();
  await page.waitForSelector('[data-state="done"]');
  await settled(page);

  let state = await readState(page);
  const real = state.operations.filter((o) => o.kind === 'operation');
  assert.equal(real.length, EXPECTED.lineCount);
  assert.deepEqual(real.map((o) => o.amount).sort((a, b) => a - b), [...EXPECTED.amounts].sort((a, b) => a - b));
  assert.ok(real.every((o) => o.bank && o.bank.statementId === state.statements[0].id), 'chaque opération est pointée sur le relevé');
  const opening = state.operations.find((o) => o.auto === 'opening');
  // daté de la veille du plus ancien achat du relevé (06-07), pour que l'historique ne démarre pas à découvert
  assert.deepEqual([opening.amount, opening.date, opening.label], [EXPECTED.openingBalance, '2026-07-05', 'Solde de départ']);
  assert.match(opening.comment, /07-07-2026/);
  assert.equal(state.statements.length, 1);
  assert.equal(state.statements[0].lineCount, EXPECTED.lineCount);
  assert.equal(state.files.length, 1);
  assert.equal(state.files[0].kind, 'statement');
  assert.deepEqual([state.reconciliations[0].realBalance, state.reconciliations[0].gap], [EXPECTED.closingBalance, 0]);
  // détails lus sur le relevé : date réelle de l'achat, heure et tiers d'un virement
  const bakery = real.find((o) => o.bank.label.includes('06/07 BOULANGERIE'));
  assert.deepEqual([bakery.date, bakery.bank.date, bakery.counterparty], ['2026-07-06', '2026-07-08', 'Boulangerie du Parc']);
  const wero = real.find((o) => o.amount === 4500);
  assert.deepEqual([wero.label, wero.counterparty, wero.time], ['Remboursement restaurant', 'Julie Moreau', '09:12']);
  // les choix sont retenus pour la prochaine fois
  const rule = state.rules.find((r) => r.key === 'super marche bio');
  assert.deepEqual([rule.label, rule.importance, rule.tags.length], ['Courses', 'necessite', 1]);
  // la copie du fichier est lisible depuis les archives
  const blob = await page.evaluate(async (id) => {
    const b = await window.monBudget.store.readBlob(id);
    return { mime: b.mime, size: b.bytes.length, head: String.fromCharCode(...b.bytes.slice(0, 5)) };
  }, state.files[0].id);
  assert.deepEqual([blob.mime, blob.head], ['application/pdf', '%PDF-']);

  await wizard(page).locator('[data-action="see-operations"]').click();
  assert.deepEqual(await balancesOf(page), { available: EXPECTED.closingBalance, total: EXPECTED.closingBalance });
  assert.equal(await page.locator('[data-screen="operations"] .op-row .pointed').count(), EXPECTED.lineCount);

  // un seul « Annuler » défait tout l'import
  await page.locator('.undo-pill').click();
  await page.waitForFunction(() => window.monBudget.state.operations.length === 0 && !window.monBudget.busy);
  state = await readState(page);
  assert.deepEqual([state.statements.length, state.reconciliations.length, state.rules.length, state.files.length], [0, 0, 0, 0]);
  await done(ctx);
});

test('relevé déjà importé : refusé avec une explication, pas de doublons', async () => {
  const ctx = await openApp({ now: AFTER_STATEMENT });
  const { page } = ctx;
  await importFile(page, SAMPLE);
  await page.waitForSelector('[data-value="line-count"]');
  await next(page);
  await next(page);
  await wizard(page).locator('[data-action="commit"]').click();
  await page.waitForSelector('[data-state="done"]');
  await settled(page);
  const count = (await readState(page)).operations.length;
  await wizard(page).locator('[data-action="another"]').click();
  await chooseFile(page, () => wizard(page).locator('[data-action="choose-file"]').click(), SAMPLE);
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog').innerText(), /déjà été importé/);
  await answer(page, 'null');
  await noOverlay(page);
  assert.equal((await readState(page)).operations.length, count);
  await done(ctx);
});

test('relevé et opérations déjà saisies : fusion, vérification, séparation, association à la main, opération en trop', async () => {
  const ctx = await openApp({ now: AFTER_STATEMENT });
  const { page } = ctx;
  // saisies « à la main » avant le relevé
  await addOperation(page, { mode: 'expense', amount: '4,20', label: 'Pain', date: '2026-07-06', tags: [] }); // même montant, même date → sûre
  await addOperation(page, { mode: 'expense', amount: '19,00', label: 'Ciné avec Léa', date: '2026-07-19' }); // 2 jours d'écart → à vérifier
  await addOperation(page, { mode: 'expense', amount: '25,00', label: 'Bouquet', date: '2026-08-02', counterparty: 'Le fleuriste' }); // 3 jours → à vérifier (on dira non)
  await addOperation(page, { mode: 'expense', amount: '60,00', label: 'Plein', date: '2026-07-11' }); // montant faux (62,40 en banque) → association à la main
  await addOperation(page, { mode: 'expense', amount: '12,00', label: 'Marché en espèces', date: '2026-07-25' }); // absente du relevé, gardée
  await addOperation(page, { mode: 'expense', amount: '48,15', label: 'Courses (doublon)', date: '2026-07-30' }); // absente du relevé (hors fenêtre), supprimée
  const before = await readState(page);
  const idOf = (label) => before.operations.find((o) => o.label === label).id;

  await importFile(page, SAMPLE);
  await page.waitForSelector('[data-value="line-count"]');
  assert.match(await wizard(page).locator('[data-value="count-matches"]').innerText(), /^3, dont 2 à vérifier$/);
  await next(page);
  assert.equal(await stepTitle(page), 'Correspondances');
  assert.equal(await wizard(page).locator('.pair[data-state="to-check"]').count(), 2);
  assert.equal(await wizard(page).locator('.pair[data-state="accepted"]').count(), 1);
  assert.match(await wizard(page).locator('.pair[data-state="accepted"] [data-gain]').innerText(), /tiers Boulangerie du Parc/);

  // on ne peut pas continuer sans avoir répondu
  await next(page);
  assert.equal(await stepTitle(page), 'Correspondances');
  await wizard(page).locator('.pair', { hasText: 'Ciné avec Léa' }).locator('[data-action="confirm"]').click();
  await wizard(page).locator('.pair', { hasText: 'Bouquet' }).locator('[data-action="reject"]').click();
  assert.equal(await wizard(page).locator('.pair[data-state="to-check"]').count(), 0);
  await next(page);

  assert.equal(await stepTitle(page), 'À ajouter');
  // la ligne du fleuriste, séparée, est revenue dans les lignes à ajouter
  assert.equal(await wizard(page).locator('.op-row', { hasText: 'Fleuriste Rose' }).count(), 1);
  // association à la main de la station-service (62,40) avec « Plein » saisi 60,00
  await wizard(page).locator('.op-row', { hasText: 'Station Service' }).click();
  await sheet(page).locator('[data-action="link-line"]').click();
  await page.locator(`[data-candidate="${idOf('Plein')}"]`).click();
  await page.waitForSelector('.dialog');
  assert.match(await page.locator('.dialog').innerText(), /60,00.*62,40/s);
  await answer(page, true);
  await noOverlay(page);
  assert.equal(await wizard(page).locator('.op-row', { hasText: 'Station Service' }).count(), 0);
  await next(page);

  assert.equal(await stepTitle(page), 'Absentes du relevé');
  const extras = wizard(page).locator('.pair');
  assert.equal(await extras.count(), 3, 'bouquet séparé, marché en espèces, doublon');
  await wizard(page).locator(`.pair[data-extra="${idOf('Courses (doublon)')}"] [data-action="delete-extra"]`).click();
  await next(page);

  assert.equal(await stepTitle(page), 'Bilan');
  assert.equal(await wizard(page).locator('[data-value="merged"]').innerText(), '3');
  assert.equal(await wizard(page).locator('[data-value="created"]').innerText(), String(EXPECTED.lineCount - 3));
  assert.equal(await wizard(page).locator('[data-value="deleted"]').innerText(), '1');
  assert.match(await wizard(page).locator('[data-value="kept"]').innerText(), /^2 \(−37,00/);
  assert.equal(await wizard(page).locator('[data-check="closing-ok"]').count(), 1);
  await wizard(page).locator('[data-action="commit"]').click();
  await page.waitForSelector('[data-state="done"]');
  await settled(page);

  const state = await readState(page);
  const byId = (label) => state.operations.find((o) => o.id === idOf(label));
  // fusion : ce que j'avais saisi est gardé, les champs vides sont complétés par la banque
  const pain = byId('Pain');
  assert.deepEqual([pain.label, pain.counterparty, pain.date, pain.bank.date], ['Pain', 'Boulangerie du Parc', '2026-07-06', '2026-07-08']);
  const cine = byId('Ciné avec Léa');
  assert.deepEqual([cine.label, cine.counterparty, cine.date, cine.bank.date], ['Ciné avec Léa', 'Cinema Le Studio', '2026-07-19', '2026-07-22']);
  // association à la main : le montant devient celui de la banque
  const plein = byId('Plein');
  assert.deepEqual([plein.amount, plein.label, !!plein.bank], [-6240, 'Plein', true]);
  // séparée : mon opération reste telle quelle, la ligne de la banque est créée à part
  const bouquet = byId('Bouquet');
  assert.equal(bouquet.bank, null);
  assert.equal(state.operations.filter((o) => o.amount === -2500).length, 2);
  assert.equal(byId('Courses (doublon)'), undefined);
  assert.equal(byId('Marché en espèces').bank, null);
  // soldes : banque à la fin du relevé = 2 454,47 ; l'appli a en plus 2 opérations non débitées (−37,00)
  const rec = state.reconciliations[0];
  assert.deepEqual([rec.realBalance, rec.computedBalance, rec.gap], [EXPECTED.closingBalance, EXPECTED.closingBalance - 3700, 3700]);
  await openTab(page, 'operations').catch(() => {});
  await page.evaluate(() => window.monBudget.go('operations'));
  assert.equal((await balancesOf(page)).total, EXPECTED.closingBalance - 3700);
  await done(ctx);
});

test("l'assistant se reprend là où on l'a laissé, et s'abandonne sans rien toucher", async () => {
  const ctx = await openApp({ now: AFTER_STATEMENT });
  const { page } = ctx;
  await importFile(page, SAMPLE);
  await page.waitForSelector('[data-value="line-count"]');
  await next(page);
  await wizard(page).locator('.op-row', { hasText: 'Fleuriste Rose' }).click();
  await sheet(page).locator('input[name="label"]').fill('Fleurs pour maman');
  await sheet(page).locator('[data-action="save-line"]').click();
  await noOverlay(page);
  // retour : étape précédente, puis on quitte l'assistant
  await page.evaluate(() => window.monBudget.back());
  assert.equal(await stepTitle(page), 'Relevé lu');
  await page.evaluate(() => window.monBudget.back());
  await page.waitForFunction(() => !document.querySelector('[data-screen="statement"]'));
  assert.equal((await readState(page)).operations.length, 0);

  // on rouvre l'appli plus tard : le brouillon est là
  const again = await openApp({ context: ctx.context, now: AFTER_STATEMENT });
  await again.page.evaluate(() => window.monBudget.open('statement'));
  assert.equal(await stepTitle(again.page), 'Relevé lu');
  await next(again.page);
  assert.equal(await wizard(again.page).locator('.op-row', { hasText: 'Fleurs pour maman' }).count(), 1);
  await wizard(again.page).locator('[data-action="abandon"]').click();
  await answer(again.page, true);
  await noOverlay(again.page);
  assert.equal(await wizard(again.page).locator('[data-action="choose-file"]').count(), 1);
  assert.equal((await readState(again.page)).operations.length, 0);
  await again.page.waitForFunction(() => window.monBudget.setting('draft:statement', null) === null);
  assert.deepEqual(again.problems, []);
  await done(ctx);
});

test("relevé d'historique (antérieur au solde de départ) : l'historique s'enrichit, le solde d'aujourd'hui ne bouge pas", async () => {
  const ctx = await openApp({ onboarding: true });
  const { page } = ctx;
  await page.locator('.sheet [data-action="start-balance"]').click();
  await page.locator('.sheet input[name="amount"]').fill('3000');
  await page.locator('.sheet [data-action="save-balance"]').click();
  await noOverlay(page);
  await importFile(page, SAMPLE);
  await page.waitForSelector('[data-value="line-count"]');
  assert.match(await wizard(page).locator('.notice', { hasText: 'antérieur à ton solde de départ' }).innerText(), /15-11-2026/);
  await next(page);
  await next(page);
  assert.equal(await stepTitle(page), 'Bilan');
  assert.equal(await wizard(page).locator('[data-field="keep-current"]').getAttribute('aria-checked'), 'true');
  assert.equal(await valueOf(page, 'total-before'), 300000);
  assert.equal(await valueOf(page, 'total-after'), 300000);
  // en le désactivant, on voit ce que l'import changerait
  await wizard(page).locator('[data-field="keep-current"]').click();
  assert.equal(await valueOf(page, 'total-after'), 300000 + EXPECTED.closingBalance);
  await wizard(page).locator('[data-field="keep-current"]').click();
  await wizard(page).locator('[data-action="commit"]').click();
  await page.waitForSelector('[data-state="done"]');
  await settled(page);
  const state = await readState(page);
  assert.equal(state.operations.filter((o) => o.kind === 'operation').length, EXPECTED.lineCount);
  const bridge = state.operations.find((o) => o.label === 'Opérations non saisies après le relevé');
  assert.equal(bridge.amount, -EXPECTED.closingBalance);
  await page.evaluate(() => window.monBudget.go('operations'));
  assert.deepEqual(await balancesOf(page), { available: 300000, total: 300000 });
  await done(ctx);
});

test('fichiers OFX et CSV : lus, signés correctement ; fichier sans rapport : refusé clairement', async () => {
  const ctx = await openApp({ now: AFTER_STATEMENT });
  const { page } = ctx;
  const ofx = join(TMP, 'export.ofx');
  writeFileSync(
    ofx,
    'OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>00012345678</BANKACCTFROM>' +
      '<BANKTRANLIST><DTSTART>20260701<DTEND>20260731' +
      '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260703<TRNAMT>-45.90<FITID>1<NAME>CARTE X1234 02/07 LIBRAIRIE<MEMO>ACHAT</STMTTRN>' +
      '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260728<TRNAMT>+1850.00<FITID>2<NAME>VIR RECU SALAIRE</STMTTRN>' +
      '</BANKTRANLIST><LEDGERBAL><BALAMT>2104.10<DTASOF>20260731</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n',
  );
  await importFile(page, ofx);
  await page.waitForSelector('[data-value="line-count"]');
  assert.equal(await wizard(page).locator('[data-value="line-count"]').innerText(), '2');
  assert.equal(await valueOf(page, 'total-debit'), -4590);
  assert.equal(await valueOf(page, 'total-credit'), 185000);
  assert.equal(await valueOf(page, 'closing'), 210410);
  await wizard(page).locator('[data-action="abandon"]').click();
  await answer(page, true);
  await noOverlay(page);

  const csv = join(TMP, 'export.csv');
  writeFileSync(
    csv,
    'Compte courant;00012345678\r\n\r\nDate;Libellé;Débit;Crédit\r\n05/08/2026;"PRLV SEPA ASSURANCE; contrat 12";32,50;\r\n03/08/2026;VIR RECU REMBOURSEMENT;;120,00\r\n01/08/2026;CARTE X1234 31/07 BOULANGERIE;1 204,30;\r\n',
    'latin1',
  );
  await chooseFile(page, () => wizard(page).locator('[data-action="choose-file"]').click(), csv);
  await page.waitForSelector('[data-value="line-count"]');
  assert.equal(await wizard(page).locator('[data-value="line-count"]').innerText(), '3');
  assert.equal(await valueOf(page, 'total-debit'), -(3250 + 120430));
  assert.equal(await valueOf(page, 'total-credit'), 12000);
  assert.equal(await wizard(page).locator('[data-check="absent"]').count(), 1);
  await next(page);
  // ordre chronologique, quel que soit l'ordre du fichier
  const titles = await wizard(page).locator('.op-row .title').allInnerTexts();
  assert.equal(titles.length, 3);
  assert.match(titles[0], /Boulangerie/);
  await next(page);
  await wizard(page).locator('[data-action="commit"]').click();
  await page.waitForSelector('[data-state="done"]');
  await settled(page);
  const state = await readState(page);
  assert.deepEqual(state.operations.map((o) => o.amount).sort((a, b) => a - b), [-120430, -3250, 12000]);
  assert.equal(state.reconciliations.length, 0, 'pas de solde dans le fichier, pas de constat inventé');

  await wizard(page).locator('[data-action="another"]').click();
  const junk = join(TMP, 'notes.txt');
  writeFileSync(junk, 'Liste de courses : pain, lait, oeufs');
  await chooseFile(page, () => wizard(page).locator('[data-action="choose-file"]').click(), junk);
  await page.waitForSelector('[data-screen="statement"] .notice.bad');
  assert.match(await wizard(page).locator('.notice.bad').innerText(), /pas pris en charge|n'ont pas été reconnues/);
  await done(ctx);
});
