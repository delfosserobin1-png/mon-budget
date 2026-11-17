// Sous-écrans liés aux données : Sauvegarde et données, Rapprochement, Archives.

import { h, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { subTopbar } from '../shell.js';
import { alertDialog, chooseDialog, confirmDialog, infoButton } from '../overlays.js';
import { amountField, dateField, toggle } from '../fields.js';
import { photoThumb } from '../photos.js';
import { buildBackupJson, buildBackupZip, readBackupFile, applyImport, autoBackup, extensionFor } from '../../data/backup.js';
import { buildOperationsCsv, buildWorkbook, datedName } from '../../io/exports.js';
import { filesBlocked, filesPlace, filesTarget, isNative, pickFile, saveFile, shareFile, storageEstimate } from '../../platform/platform.js';
import { bankBalanceAt, planAdjustment, planDeleteReconciliation, planReconciliation } from '../../core/reconciliation.js';
import { planDeleteStatement } from '../../core/matching.js';
import { emptyFilter } from '../../core/filters.js';
import { formatAmount } from '../../core/money.js';
import { daysBetween, formatDate } from '../../core/dates.js';

function subScreen(app, name, title, ...actions) {
  const top = subTopbar(app, title, ...actions);
  const content = h('div.pad.stack.loose');
  const el = h('section.screen', { dataset: { screen: name } }, top.el, h('main.scroll', content, h('div.bottom-space')));
  return { el, content, top };
}

const STORE_LABELS = { operations: ['opération'], envelopes: ['enveloppe'], tags: ['tag'], recurring: ['récurrence'], reconciliations: ['rapprochement'], statements: ['relevé'], rules: ['règle'], files: ['pièce jointe', 'pièces jointes'], bugReports: ['commentaire'] };

function countsText(counts) {
  const partsList = [];
  for (const [store, labels] of Object.entries(STORE_LABELS)) {
    if (counts[store]) partsList.push(plural(counts[store], labels[0], labels[1]));
  }
  return partsList.join(', ') || 'rien';
}

// ---------------------------------------------------------------------------------------------
// Sauvegarde et données
// ---------------------------------------------------------------------------------------------

export function createBackupScreen(app) {
  const screen = subScreen(app, 'backup', 'Sauvegarde et données');
  let usage = null;
  storageEstimate().then((estimate) => {
    usage = estimate;
    if (!screen.el.hidden) update();
  });

  async function deliver({ name, mime, build, markBackup = false }) {
    const how = await chooseDialog({
      title: name,
      options: [
        { id: 'save', label: filesTarget() ? `Enregistrer dans ${filesPlace()}` : 'Télécharger', primary: true },
        { id: 'share', label: 'Partager (mail, messagerie, Drive…)' },
      ],
    });
    if (!how) return;
    try {
      const data = await build();
      if (how === 'save') {
        const { where } = await saveFile({ name, mime, data, folder: 'Exports' });
        app.notify(where);
      } else {
        const result = await shareFile({ name, mime, data, title: 'Mon Budget' });
        if (result === 'saved') app.notify(`« ${name} » enregistré`);
      }
      if (markBackup) await app.setSetting('lastBackupAt', new Date().toISOString());
    } catch (error) {
      app.reportError(error, 'export');
      app.fail(`L'export a échoué : ${error?.message || error}`);
    }
  }

  async function importFile() {
    const picked = await pickFile({ accept: '.json,.zip,application/json,application/zip' });
    if (!picked) return;
    const read = await readBackupFile(picked);
    if (!read.ok) {
      await alertDialog({ title: 'Import impossible', message: read.error });
      return;
    }
    const lines = [`Ce fichier contient : ${countsText(read.read.counts)}.`];
    if (read.read.source === 'v1') lines.push("Il vient de l'ancienne version de l'appli : il sera converti au nouveau format.");
    if (read.read.counts.files && !read.blobs.size) lines.push("Les photos ne sont pas dans ce fichier (sauvegarde des données seules) : elles ne seront pas reprises.");
    for (const warning of read.read.warnings.slice(0, 3)) lines.push(warning);
    let mode = 'replace';
    if (!app.store.isEmpty) {
      mode = await chooseDialog({
        title: 'Importer cette sauvegarde',
        message: lines.join('\n'),
        options: [
          { id: 'merge', label: 'Ajouter à mes données (rien n\'est écrasé)', primary: true },
          { id: 'replace', label: 'Remplacer toutes mes données', danger: true },
        ],
      });
      if (!mode) return;
      if (mode === 'replace') {
        const sure = await confirmDialog({
          title: 'Tout remplacer ?',
          message: 'Tes données actuelles seront effacées et remplacées par celles du fichier. Cette action ne peut pas être annulée.',
          confirmLabel: 'Remplacer',
          danger: true,
        });
        if (!sure) return;
      }
    } else if (!(await confirmDialog({ title: 'Importer cette sauvegarde', message: lines.join('\n'), confirmLabel: 'Importer' }))) return;
    try {
      const plan = await applyImport(app.store, read, mode);
      await app.store.tickRecurring(app.today());
      await app.setSetting('onboarded', true, { silent: true });
      if (mode === 'replace') await app.setSetting('demo', undefined);
      const added = countsText(plan.added);
      const skipped = Object.values(plan.skipped).reduce((a, b) => a + b, 0);
      await alertDialog({ title: 'Import terminé', message: `Ajouté : ${added}.${skipped ? `\nDéjà présent, laissé tel quel : ${plural(skipped, 'élément')}.` : ''}` });
    } catch (error) {
      app.reportError(error, 'import');
      await alertDialog({ title: "L'import a échoué", message: `Rien n'a été modifié. Détail : ${error?.message || error}` });
    }
  }

  async function wipe() {
    const kept = [app.claude.connected ? 'la connexion à Claude' : null, app.folder.info().linked ? 'le dossier de copie' : null].filter(Boolean);
    const first = await confirmDialog({
      title: 'Tout effacer ?',
      message: `Toutes les opérations, enveloppes, photos et réglages de cet appareil seront supprimés. Pense à faire une sauvegarde avant.${kept.length ? `\n\nSeront gardés : ${kept.join(' et ')}.` : ''}`,
      confirmLabel: 'Continuer',
      danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({ title: 'Dernière confirmation', message: 'Cette action est définitive.', confirmLabel: 'Tout effacer', danger: true });
    if (second) await app.startOver();
  }

  function update() {
    clear(screen.content);
    const today = app.today();
    const state = app.state;
    const row = (iconName, title, hint, action, name, danger = false) =>
      h('button', { type: 'button', class: danger ? 'menu-item danger' : 'menu-item', dataset: { action: name }, onclick: action }, icon(iconName), h('span.texts', h('b', title), hint ? h('span', hint) : null), h('span.chev', icon('right')));

    const last = app.setting('lastBackupAt');
    const age = last ? daysBetween(last.slice(0, 10), today) : null;
    if (!app.store.isEmpty && (age === null || age > 30) && !app.setting('demo')) {
      screen.content.appendChild(
        h('div.notice.warn', icon('alert'), h('div.grow', age === null ? "Tu n'as encore jamais fait de sauvegarde. Si le téléphone est perdu ou réinitialisé, les données le sont aussi." : `Ta dernière sauvegarde date de ${plural(age, 'jour')}.`)),
      );
    }

    screen.content.appendChild(
      h(
        'section',
        h('h2.section-title', { style: { padding: '0 4px 8px' } }, 'Sauvegarder'),
        h(
          'div.menu',
          row('archive', 'Sauvegarde complète', 'Un fichier ZIP : toutes les données et les photos', () => deliver({ name: datedName('mon-budget-sauvegarde', 'zip', today), mime: 'application/zip', build: () => buildBackupZip(app.store, { appVersion: app.version }), markBackup: true }), 'export-zip'),
          row('file', 'Données seules', 'Un fichier JSON léger, sans les photos', () => deliver({ name: datedName('mon-budget-donnees', 'json', today), mime: 'application/json', build: () => buildBackupJson(app.store, { appVersion: app.version }), markBackup: true }), 'export-json'),
        ),
        last ? h('p.hint', { style: { padding: '8px 4px 0' } }, `Dernière sauvegarde manuelle le ${formatDate(last.slice(0, 10))}.`) : null,
      ),
    );

    screen.content.appendChild(
      h(
        'section',
        h('h2.section-title', { style: { padding: '0 4px 8px' } }, 'Consulter dans un tableur'),
        h(
          'div.menu',
          row('table', 'Classeur Excel', 'Une feuille par type : opérations, enveloppes, tags…', () => deliver({ name: datedName('mon-budget', 'xlsx', today), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', build: () => buildWorkbook(state, { today }) }), 'export-xlsx'),
          row('list', 'Opérations en CSV', 'Un tableau simple, lisible partout', () => deliver({ name: datedName('mon-budget-operations', 'csv', today), mime: 'text/csv', build: () => buildOperationsCsv(state) }), 'export-csv'),
        ),
      ),
    );

    screen.content.appendChild(
      h(
        'section',
        h('h2.section-title', { style: { padding: '0 4px 8px' } }, 'Restaurer ou importer'),
        h('div.menu', row('upload', 'Importer une sauvegarde', "Fichier ZIP ou JSON de l'appli (y compris l'ancienne version)", importFile, 'import-backup')),
      ),
    );

    // --- où sont les données ---
    const folder = app.folder.info();
    const target = filesTarget(); // 'documents' (appli Android), 'folder' (dossier choisi) ou null
    const place = filesPlace();
    const info = h('div.card.stack.tight', { dataset: { card: 'where' } }, h('h2', 'Où sont mes données ?'));
    let where;
    if (isNative()) {
      where = "Dans le stockage privé de l'appli, sur ce téléphone. Une copie de sauvegarde est écrite chaque jour dans Documents/MonBudget/Sauvegardes (les 7 dernières sont gardées), et tes exports vont dans Documents/MonBudget/Exports : tu peux les ouvrir avec l'appli Fichiers ou depuis un ordinateur.";
    } else if (target === 'folder') {
      where = `Dans le stockage de l'appli, sur cet appareil. Une copie de sauvegarde est écrite chaque jour dans ${place}/Sauvegardes (les 7 dernières sont gardées), et tes exports vont dans ${place}/Exports : tu peux les ouvrir avec l'appli Fichiers ou depuis un ordinateur.`;
    } else {
      where = app.pwa.state().installed
        ? "Dans le stockage de l'appli, sur cet appareil. Elles y restent même sans connexion ; les effacer demande de vider les données de l'appli ou de la désinstaller. Fais quand même une sauvegarde de temps en temps."
        : "Dans le stockage de ce navigateur, sur cet appareil. Effacer les données du navigateur les supprime : fais une sauvegarde de temps en temps.";
    }
    info.appendChild(h('p.note', where));

    const backupNow = () =>
      h(
        'button.btn.small',
        {
          type: 'button',
          dataset: { action: 'backup-now' },
          onclick: async () => {
            const report = await autoBackup(app.store, { appVersion: app.version, today, force: true });
            if (report.done) app.notify(`Sauvegardé dans ${report.path}`);
            else if (report.reason === 'permission') app.fail("Le téléphone redemande l'accès au dossier : touche « Autoriser ».");
            else app.fail(report.error ? `Échec : ${report.error}` : 'Rien à sauvegarder pour le moment.');
            update();
          },
        },
        'Sauvegarder maintenant',
      );
    const autoStatus = () => {
      const auto = app.setting('autoBackupDate');
      const error = app.setting('autoBackupError');
      const rows = [h('div.kv', h('span.k', 'Sauvegarde automatique'), h('span.v', error ? h('span.chip.bad', 'Échec') : auto ? formatDate(auto) : 'Pas encore faite'))];
      if (error) rows.push(h('p.hint', `Détail : ${error}`));
      return rows;
    };

    if (isNative()) {
      info.append(...autoStatus(), backupNow());
    } else if (folder.supported) {
      // Appli installée depuis le navigateur : l'utilisateur désigne une fois un dossier du téléphone.
      const pick = async () => {
        try {
          if (!(await app.folder.choose())) return;
          const report = await autoBackup(app.store, { appVersion: app.version, today, force: true });
          app.notify(report.done ? `Dossier prêt. Première copie : ${report.path}` : `Dossier prêt : ${filesPlace()}`);
        } catch (error) {
          app.fail(`Ce dossier ne peut pas être utilisé : ${error?.message || error}`);
        }
        update();
      };
      if (!folder.linked) {
        info.append(
          h('p.hint', "Pour garder une copie dans un vrai dossier du téléphone (visible dans l'appli Fichiers), choisis ou crée un dossier, par exemple « Documents/MonBudget ». L'appli y rangera une sauvegarde par jour et tes exports."),
          h('button.btn.small', { type: 'button', dataset: { action: 'choose-folder' }, onclick: pick }, icon('folder'), 'Choisir un dossier'),
        );
      } else {
        info.appendChild(h('div.kv', h('span.k', 'Dossier de copie'), h('span.v.small', { dataset: { value: 'folder' } }, folder.label)));
        if (filesBlocked()) {
          info.append(
            h('div.notice.warn', { dataset: { notice: 'folder-blocked' } }, icon('alert'), h('div.grow', "Le téléphone redemande l'accès à ce dossier avant d'y écrire.")),
            h(
              'button.btn.small.primary',
              {
                type: 'button',
                dataset: { action: 'allow-folder' },
                onclick: async () => {
                  if (await app.folder.allow()) app.notify('Accès au dossier rétabli');
                  else app.fail("L'accès au dossier n'a pas été accordé.");
                  update();
                },
              },
              'Autoriser',
            ),
          );
        } else {
          info.append(...autoStatus(), backupNow());
        }
        info.appendChild(
          h(
            'div.btn-row',
            h('button.btn.small', { type: 'button', dataset: { action: 'choose-folder' }, onclick: pick }, 'Changer de dossier'),
            h(
              'button.btn.small',
              {
                type: 'button',
                dataset: { action: 'forget-folder' },
                onclick: async () => {
                  const ok = await confirmDialog({ title: 'Ne plus copier dans ce dossier ?', message: "Les fichiers déjà écrits restent dans le dossier. Tes données dans l'appli ne changent pas.", confirmLabel: 'Arrêter la copie' });
                  if (!ok) return;
                  await app.folder.forget();
                  app.notify('Copie automatique arrêtée');
                },
              },
              'Ne plus copier',
            ),
          ),
        );
      }
    }
    info.appendChild(h('div.kv', h('span.k', 'Contenu'), h('span.v.small', countsText(Object.fromEntries(Object.keys(STORE_LABELS).map((s) => [s, state[s].length]))))));
    if (usage) info.appendChild(h('div.kv', h('span.k', 'Espace utilisé'), h('span.v', `${(usage.usage / 1048576).toFixed(1).replace('.', ',')} Mo`)));
    screen.content.appendChild(info);

    const danger = h('div.menu');
    if (app.store.isEmpty) {
      danger.appendChild(row('book', "Charger des données d'exemple", 'Un budget fictif pour découvrir', async () => {
        await app.loadDemo();
        app.notify("Données d'exemple chargées");
      }, 'load-demo'));
    }
    danger.appendChild(row('trash', app.setting('demo') ? "Effacer les données d'exemple" : 'Tout effacer', "Remet l'appli à zéro sur cet appareil", wipe, 'wipe', true));
    screen.content.appendChild(danger);
  }

  return { el: screen.el, update };
}

// ---------------------------------------------------------------------------------------------
// Rapprochement manuel
// ---------------------------------------------------------------------------------------------

export function createReconcileScreen(app) {
  const screen = subScreen(app, 'reconcile', 'Rapprochement');
  const formHost = h('div.card.stack');
  const history = h('div');
  screen.content.appendChild(
    h(
      'div.notice',
      icon('checks'),
      h('div.grow', "Saisis le solde qu'affiche ta banque : l'appli le compare à son solde total et te montre l'écart. Pour retrouver d'où vient un écart, le plus efficace est d'importer un relevé."),
    ),
  );
  screen.content.appendChild(formHost);
  screen.content.appendChild(h('button.btn.block', { type: 'button', dataset: { open: 'statement' }, onclick: () => app.open('statement') }, icon('bank'), 'Importer un relevé'));
  screen.content.appendChild(history);

  const date = dateField({
    label: 'Date du solde',
    value: app.today(),
    name: 'date',
    onChange: () => showComputed(),
  });
  const real = amountField({ label: 'Solde affiché par la banque', name: 'realBalance' });
  const negative = toggle({ label: 'Le compte est à découvert', hint: 'Le solde saisi est négatif.' });
  const computedLine = h('div.kv', { style: { borderTop: '0' } });
  const compare = h('button.btn.primary.block', { type: 'button', dataset: { action: 'compare' } }, 'Comparer');
  formHost.append(date.el, real.el, negative.el, computedLine, compare);

  function showComputed() {
    clear(computedLine);
    const day = date.value || app.today();
    computedLine.append(
      h('span.k', `Solde total dans l'appli au ${formatDate(day)}`, infoButton('Solde comparé', "C'est le solde total (compte courant + enveloppes), calculé avec les opérations réelles à leur date de banque. Les prévisions et les virements internes n'y changent rien.")),
      h('span.v.num', { dataset: { value: 'computed' } }, formatAmount(bankBalanceAt(app.state, day))),
    );
  }

  compare.addEventListener('click', async () => {
    const cents = real.cents;
    if (cents === null) {
      real.setError(real.isEmpty ? "Indique le solde affiché par ta banque." : 'Montant illisible. Exemple : 1250,40');
      return;
    }
    const plan = planReconciliation(app.state, { date: date.value, realBalance: negative.value ? -cents : cents });
    if (!plan.ok) {
      (plan.errors[0].field === 'date' ? date : real).setError(plan.errors[0].message);
      return;
    }
    if (!(await app.commit(plan.cs, { label: 'Rapprochement enregistré' }))) return;
    real.cents = null;
    await showResult(plan.record.id);
  });

  async function showResult(id) {
    const record = app.state.reconciliations.find((r) => r.id === id);
    if (!record) return;
    if (record.gap === 0) {
      await alertDialog({ title: 'Aucun écart', message: `Au ${formatDate(record.date)}, l'appli et la banque sont d'accord : ${formatAmount(record.realBalance)}.` });
      return;
    }
    const more = record.gap > 0;
    const choice = await chooseDialog({
      title: `Écart de ${formatAmount(Math.abs(record.gap))}`,
      message: `Au ${formatDate(record.date)}, la banque affiche ${formatAmount(record.realBalance)} et l'appli ${formatAmount(record.computedBalance)}.\n\n${more ? "La banque a plus que l'appli : un revenu n'a pas été saisi, ou une dépense a été saisie en trop." : "La banque a moins que l'appli : une dépense n'a pas été saisie, ou un revenu a été saisi en trop."}`,
      options: [
        { id: 'adjust', label: `Ajuster l'appli (${formatAmount(record.gap, { sign: 'always' })})`, primary: true },
        { id: 'search', label: 'Chercher les opérations non pointées' },
      ],
      cancelLabel: 'Laisser tel quel',
    });
    if (choice === 'adjust') await app.run(planAdjustment(app.state, record.id), { label: 'Écart ajusté' });
    else if (choice === 'search') app.go('operations', { filter: { ...emptyFilter(), unpointed: true } });
  }

  async function openRecord(record) {
    const adjusted = record.adjustmentOperationId && app.state.operations.some((o) => o.id === record.adjustmentOperationId);
    const options = [];
    if (record.gap !== 0 && !adjusted) options.push({ id: 'adjust', label: `Ajuster l'écart (${formatAmount(record.gap, { sign: 'always' })})`, primary: true });
    options.push({ id: 'delete', label: 'Supprimer ce constat', danger: true });
    const choice = await chooseDialog({
      title: `Constat du ${formatDate(record.date)}`,
      message: `Banque : ${formatAmount(record.realBalance)}\nAppli : ${formatAmount(record.computedBalance)}\nÉcart : ${formatAmount(record.gap, { sign: 'always' })}${adjusted ? ' (ajusté)' : ''}`,
      options,
      cancelLabel: 'Fermer',
    });
    if (choice === 'adjust') app.run(planAdjustment(app.state, record.id), { label: 'Écart ajusté' });
    else if (choice === 'delete') app.run(planDeleteReconciliation(app.state, record.id), { label: 'Constat supprimé' });
  }

  function update() {
    showComputed();
    clear(history);
    const records = app.state.reconciliations.slice().sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
    if (!records.length) return;
    history.appendChild(h('h2.section-title', { style: { padding: '4px 4px 8px' } }, 'Constats précédents'));
    const menu = h('div.menu');
    for (const record of records) {
      const adjusted = record.adjustmentOperationId && app.state.operations.some((o) => o.id === record.adjustmentOperationId);
      menu.appendChild(
        h(
          'button.menu-item',
          { type: 'button', dataset: { reconciliation: record.id }, onclick: () => openRecord(record) },
          icon(record.statementId ? 'file' : 'checks'),
          h('span.texts', h('b', formatDate(record.date)), h('span', `Banque ${formatAmount(record.realBalance)}${record.statementId ? ', sur relevé' : ''}`)),
          record.gap === 0 ? h('span.chip.good', 'Aucun écart') : h('span', { class: adjusted ? 'chip plain' : 'chip warn' }, `${formatAmount(record.gap, { sign: 'always' })}${adjusted ? ' ajusté' : ''}`),
        ),
      );
    }
    history.appendChild(menu);
  }

  return { el: screen.el, update };
}

// ---------------------------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------------------------

export function createArchivesScreen(app) {
  const screen = subScreen(app, 'archives', 'Archives');

  async function openStatement(statement) {
    const options = [];
    if (statement.fileId) options.push({ id: 'file', label: 'Ouvrir ou partager le fichier', primary: true });
    options.push({ id: 'operations', label: 'Voir ses opérations' });
    options.push({ id: 'delete', label: 'Retirer ce relevé des archives', danger: true });
    const period = statement.periodStart && statement.periodEnd ? `Du ${formatDate(statement.periodStart)} au ${formatDate(statement.periodEnd)}` : '';
    const choice = await chooseDialog({
      title: statement.bank || 'Relevé bancaire',
      message: [period, statement.accountLabel, `${plural(statement.lineCount, 'ligne')} : ${statement.matchedCount} rapprochées, ${statement.createdCount} créées`, statement.closingBalance === null ? '' : `Nouveau solde : ${formatAmount(statement.closingBalance)}`].filter(Boolean).join('\n'),
      options,
      cancelLabel: 'Fermer',
    });
    if (choice === 'file') {
      const blob = await app.store.readBlob(statement.fileId);
      if (!blob) {
        app.fail("Le fichier de ce relevé n'est plus disponible.");
        return;
      }
      const name = `releve-${statement.periodEnd || statement.importedAt.slice(0, 10)}.${extensionFor(blob.mime)}`;
      const result = await shareFile({ name, mime: blob.mime, data: blob.bytes, title: 'Relevé bancaire' });
      if (result === 'saved') app.notify(`« ${name} » enregistré`);
    } else if (choice === 'operations') {
      app.go('operations', { filter: { ...emptyFilter(), period: 'custom', from: statement.periodStart ? statement.periodStart.slice(0, 8) + '01' : null, to: statement.periodEnd } });
    } else if (choice === 'delete') {
      const ok = await confirmDialog({
        title: 'Retirer ce relevé ?',
        message: 'Ses opérations restent dans l\'appli, mais ne seront plus marquées comme pointées. Le fichier archivé est supprimé.',
        confirmLabel: 'Retirer',
        danger: true,
      });
      if (ok) app.run(planDeleteStatement(app.state, statement.id), { label: 'Relevé retiré' });
    }
  }

  function update() {
    clear(screen.content);
    const state = app.state;
    const statements = state.statements.slice().sort((a, b) => ((a.periodEnd || '') < (b.periodEnd || '') ? 1 : -1));
    const closed = state.envelopes.filter((e) => e.closed);
    const photoIds = [];
    for (const op of state.operations) for (const id of op.photoIds) photoIds.push({ id, op });

    const section = (title, body) => h('section', h('h2.section-title', { style: { padding: '0 4px 8px' } }, title), body);

    if (statements.length) {
      const menu = h('div.menu');
      for (const statement of statements) {
        menu.appendChild(
          h(
            'button.menu-item',
            { type: 'button', dataset: { statement: statement.id }, onclick: () => openStatement(statement) },
            icon('file'),
            h(
              'span.texts',
              h('b', statement.periodStart && statement.periodEnd ? `${formatDate(statement.periodStart)} au ${formatDate(statement.periodEnd)}` : `Importé le ${formatDate(statement.importedAt.slice(0, 10))}`),
              h('span', `${statement.bank || 'Banque non reconnue'}, ${plural(statement.lineCount, 'ligne')}`),
            ),
            statement.closingBalance === null ? null : h('span.amt', formatAmount(statement.closingBalance)),
          ),
        );
      }
      screen.content.appendChild(section('Relevés importés', menu));
    } else {
      screen.content.appendChild(
        section(
          'Relevés importés',
          h('div.card.stack.tight', h('p.note', "Aucun relevé pour l'instant. Chaque relevé importé est archivé ici, avec son fichier d'origine."), h('button.btn.small', { type: 'button', onclick: () => app.open('statement') }, icon('bank'), 'Importer un relevé')),
        ),
      );
    }

    if (closed.length) {
      const menu = h('div.menu');
      for (const env of closed) {
        menu.appendChild(
          h(
            'button.menu-item',
            { type: 'button', class: `k-${env.color}`, dataset: { envelope: env.id }, onclick: () => app.open('envelope', { id: env.id }) },
            icon('envelope'),
            h('span.texts', h('b', env.name), h('span', env.closedAt ? `Clôturée le ${formatDate(env.closedAt)}` : 'Clôturée')),
            h('span.chev', icon('right')),
          ),
        );
      }
      screen.content.appendChild(section('Enveloppes clôturées', menu));
    }

    if (photoIds.length) {
      const grid = h('div.photos');
      const recent = photoIds.slice().sort((a, b) => (a.op.date < b.op.date ? 1 : -1)).slice(0, 24);
      for (const { id } of recent) grid.appendChild(photoThumb(app, id));
      screen.content.appendChild(
        section(
          `Tickets photographiés (${photoIds.length})`,
          h(
            'div.card.stack.tight',
            grid,
            h('button.link-btn', { type: 'button', onclick: () => app.go('operations', { filter: { ...emptyFilter(), withPhoto: true } }) }, 'Voir toutes les opérations avec photo'),
          ),
        ),
      );
    }

    if (state.reconciliations.length) {
      screen.content.appendChild(
        section(
          'Rapprochements',
          h('div.menu', h('button.menu-item', { type: 'button', onclick: () => app.open('reconcile') }, icon('checks'), h('span.texts', h('b', plural(state.reconciliations.length, 'constat enregistré', 'constats enregistrés'))), h('span.chev', icon('right')))),
        ),
      );
    }
  }

  return { el: screen.el, update };
}
