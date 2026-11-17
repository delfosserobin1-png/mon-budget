// Onglet « Plus » : tout ce qui n'est pas la saisie de tous les jours.

import { h, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { segmented } from '../fields.js';
import { installApp } from '../pwa-ui.js';
import { backupReminderFor } from '../../data/backup.js';
import { unreadTotal } from '../../core/comments.js';
import { filesBlocked, isNative } from '../../platform/platform.js';

export function createMoreScreen(app) {
  const content = h('div.pad.stack.loose');
  const el = h('section.screen', { dataset: { screen: 'more' } }, h('header.topbar', h('h1', 'Plus')), h('main.scroll', content, h('div.bottom-space')));

  function item(iconName, title, hint, target, extra = {}) {
    return h(
      'button',
      { type: 'button', class: extra.danger ? 'menu-item danger' : 'menu-item', dataset: { open: typeof target === 'string' ? target : extra.name || null }, onclick: typeof target === 'string' ? () => app.open(target) : target },
      icon(iconName),
      h('span.texts', h('b', title), hint ? h('span', hint) : null),
      extra.badge ? h('span.count-badge.blue', String(extra.badge)) : h('span.chev', icon('right')),
    );
  }

  function group(title, ...items) {
    return h('section', h('h2.section-title', { style: { padding: '0 4px 8px' } }, title), h('div.menu', ...items));
  }

  function update() {
    const state = app.state;
    clear(content);

    if (app.store.canUndo) {
      content.appendChild(
        h('div.menu', item('undo', 'Annuler la dernière action', app.store.undoLabel || '', () => app.undo(), { name: 'undo' })),
      );
    }

    // Ouverte dans un navigateur : on propose de l'installer (icône, plein écran, hors connexion).
    const pwa = app.pwa.state();
    if (!isNative() && pwa.supported && !pwa.installed) {
      content.appendChild(
        h(
          'div.notice',
          { dataset: { notice: 'install' } },
          icon('phone'),
          h('div.grow', h('b', "Installe l'appli sur ton téléphone"), h('div', "Elle aura son icône, s'ouvrira en plein écran et marchera sans connexion. Tes données restent les mêmes.")),
          h('button.btn.small', { type: 'button', dataset: { action: 'install' }, onclick: () => installApp(app) }, pwa.canInstall ? 'Installer' : 'Comment faire'),
        ),
      );
    }

    // Rappel de sauvegarde : rien ne quitte le téléphone tout seul, donc on le rappelle de temps en temps.
    const reminder = backupReminderFor(app.store);
    if (reminder) {
      content.appendChild(
        h(
          'div.notice.warn',
          { dataset: { notice: 'backup-reminder' } },
          icon('database'),
          h(
            'div.grow',
            h('b', reminder.never ? "Tes données n'ont jamais été sauvegardées hors du téléphone" : `Dernière sauvegarde hors du téléphone : il y a ${plural(reminder.days, 'jour')}`),
            h('div', "Si le téléphone est perdu ou cassé, tout serait perdu. Une sauvegarde complète envoyée sur ton ordinateur ou ton Drive prend dix secondes."),
          ),
          h('button.btn.small', { type: 'button', dataset: { action: 'go-backup' }, onclick: () => app.open('backup') }, 'Sauvegarder'),
        ),
      );
    }

    // Le téléphone redemande parfois l'accès au dossier de copie : un toucher suffit.
    if (filesBlocked()) {
      content.appendChild(
        h(
          'div.notice.warn',
          { dataset: { notice: 'folder-blocked' } },
          icon('folder'),
          h('div.grow', h('b', 'La copie automatique attend ton accord'), h('div', `Le téléphone redemande l'accès au dossier « ${app.folder.info().name} ».`)),
          h(
            'button.btn.small',
            {
              type: 'button',
              dataset: { action: 'allow-folder' },
              onclick: async () => {
                if (await app.folder.allow()) app.notify('Accès au dossier rétabli');
                else app.fail("L'accès au dossier n'a pas été accordé.");
              },
            },
            'Autoriser',
          ),
        ),
      );
    }

    const lastCheck = state.reconciliations.length ? state.reconciliations.reduce((a, b) => (a.date > b.date ? a : b)) : null;
    content.appendChild(
      group(
        'Banque',
        item('bank', 'Importer un relevé', 'PDF, OFX ou CSV : rapproche et complète tes opérations', 'statement'),
        item('checks', 'Rapprochement', lastCheck ? `Dernier constat le ${lastCheck.date.split('-').reverse().join('-')}` : "Comparer le solde de l'appli à celui de la banque", 'reconcile'),
        item('archive', 'Archives', 'Relevés importés, enveloppes clôturées, tickets', 'archives'),
      ),
    );
    content.appendChild(
      group(
        'Organisation',
        item('tag', 'Tags', state.tags.length ? plural(state.tags.length, 'tag') : 'Tes catégories libres', 'tags'),
        item('wand', 'Règles automatiques', state.rules.length ? `${plural(state.rules.length, 'tiers reconnu', 'tiers reconnus')}` : "Ce que l'appli retient de tes habitudes", 'rules'),
      ),
    );

    const unread = unreadTotal(state);
    const link = app.claude.info;
    content.appendChild(
      group(
        'Claude',
        item('chat', 'Commentaires pour Claude', unread ? plural(unread, 'réponse de Claude à lire', 'réponses de Claude à lire') : 'Un problème, une idée, une question : écris-le ici', 'bugs', { badge: unread }),
        item('link', 'Connexion à Claude', link ? `Connectée : ${link.repo}` : "À régler une fois, pour envoyer d'un geste", 'claude'),
      ),
    );

    const theme = segmented({
      label: 'Apparence',
      value: app.setting('theme', 'auto'),
      options: [
        { value: 'auto', label: 'Automatique' },
        { value: 'light', label: 'Clair' },
        { value: 'dark', label: 'Sombre' },
      ],
      onChange: (value) => app.setTheme(value),
    });
    content.appendChild(
      h(
        'section',
        h('h2.section-title', { style: { padding: '0 4px 8px' } }, 'Données et réglages'),
        h(
          'div.menu',
          item('database', 'Sauvegarde et données', 'Exporter, importer, Excel, tout effacer', 'backup'),
          item('shield', 'Sécurité', app.setting('pin') ? 'Code de déverrouillage activé' : "Protéger l'appli par un code", 'security'),
        ),
        h('div.field', { style: { marginTop: '14px' } }, h('div.label', 'Apparence'), theme.el),
      ),
    );

    content.appendChild(
      group(
        'Aide',
        item('book', "Mode d'emploi", "Comprendre l'appli en quelques minutes", 'guide'),
        item('info', 'À propos', `Version ${app.version}`, 'about'),
      ),
    );
  }

  return { el, update };
}
