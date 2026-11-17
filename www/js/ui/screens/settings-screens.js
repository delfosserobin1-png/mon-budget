// Sous-écrans de réglages : Tags, Règles automatiques, Sécurité, À propos.

import { h, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { subTopbar } from '../shell.js';
import { openSheet, confirmDialog, promptDialog, alertDialog } from '../overlays.js';
import { textField, selectField, pickList, fieldGroup } from '../fields.js';
import { openTagForm } from '../forms/tag.js';
import { IMPORTANCE, importanceLabel, SCHEMA_VERSION, STORES } from '../../core/schema.js';
import { planDeleteTag, tagUsage } from '../../core/tags.js';
import { planDeleteRule, planSaveRule } from '../../core/rules.js';
import { checkPin, makePin, PIN_MAX, PIN_MIN } from './lock.js';
import { deviceSummary, filesBlocked, filesPlace, filesTarget, hasPlugin, isNative, storageEstimate, writeToDocuments } from '../../platform/platform.js';
import { CHANGES } from '../../changelog.js';
import { installApp, showWhatsNew } from '../pwa-ui.js';

function subScreen(app, name, title, ...actions) {
  const top = subTopbar(app, title, ...actions);
  const content = h('div.pad.stack');
  const el = h('section.screen', { dataset: { screen: name } }, top.el, h('main.scroll', content, h('div.bottom-space')));
  return { el, content, top };
}

// ---------------------------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------------------------

export function createTagsScreen(app) {
  const screen = subScreen(app, 'tags', 'Tags', h('button.icon-btn', { type: 'button', 'aria-label': 'Nouveau tag', dataset: { action: 'add-tag' }, onclick: () => openTagForm(app) }, icon('plus')));

  async function remove(tag) {
    const used = tagUsage(app.state, tag.id);
    const ok = await confirmDialog({
      title: `Supprimer le tag « ${tag.name} » ?`,
      message: used ? `Il sera retiré de ${plural(used, 'opération')}. Les opérations elles-mêmes ne sont pas supprimées.` : "Il n'est utilisé par aucune opération.",
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) app.run(planDeleteTag(app.state, tag.id), { label: 'Tag supprimé' });
  }

  function update() {
    clear(screen.content);
    const tags = app.state.tags.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    if (!tags.length) {
      screen.content.appendChild(
        h(
          'div.empty',
          h('div.empty-mark', icon('tag', 'lg')),
          h('h2', 'Aucun tag'),
          h('p', 'Les tags sont tes catégories : courses, loisirs, santé… Une opération peut en porter plusieurs.'),
          h('button.btn.primary', { type: 'button', onclick: () => openTagForm(app) }, icon('plus'), 'Créer un tag'),
        ),
      );
      return;
    }
    screen.content.appendChild(h('p.hint', 'Touche un tag pour changer son nom ou sa couleur.'));
    const menu = h('div.menu');
    for (const tag of tags) {
      const used = tagUsage(app.state, tag.id);
      menu.appendChild(
        h(
          'div.menu-item',
          { class: `k-${tag.color}`, style: { padding: '0' } },
          h(
            'button',
            { type: 'button', class: 'menu-item', style: { border: '0', flex: '1', minWidth: '0' }, dataset: { tag: tag.id }, onclick: () => openTagForm(app, { id: tag.id }) },
            h('span.chip', h('span.dot'), tag.name),
            h('span.texts', h('span', used ? plural(used, 'opération') : 'Pas encore utilisé')),
          ),
          h('button.icon-btn', { type: 'button', 'aria-label': `Supprimer le tag ${tag.name}`, dataset: { action: 'delete-tag' }, onclick: () => remove(tag) }, icon('trash')),
        ),
      );
    }
    screen.content.appendChild(menu);
  }
  return { el: screen.el, update };
}

// ---------------------------------------------------------------------------------------------
// Règles automatiques
// ---------------------------------------------------------------------------------------------

function openRuleForm(app, { id = null } = {}) {
  const existing = id ? app.state.rules.find((r) => r.id === id) : null;
  const f = { tags: existing ? [...existing.tags] : [], importance: existing?.importance || null };
  const display = textField({ label: 'Tiers (commerçant, personne, organisme)', value: existing?.display || '', name: 'display', placeholder: 'Ex. : Supermarché du Centre', autocapitalize: 'words' });
  const label = textField({ label: 'Libellé proposé', value: existing?.label || '', optional: true, name: 'label', placeholder: 'Courses' });
  const envelope = selectField({
    label: 'Enveloppe proposée',
    value: existing?.envelopeId || '',
    options: [{ value: '', label: 'Compte courant' }, ...app.state.envelopes.filter((e) => !e.closed || e.id === existing?.envelopeId).map((e) => ({ value: e.id, label: e.name }))],
  });
  const tags = pickList({ options: app.state.tags.map((t) => ({ id: t.id, label: t.name, color: t.color })), selected: f.tags, onChange: (list) => (f.tags = list) });
  const importance = pickList({ options: IMPORTANCE.map((i) => ({ id: i.id, label: i.label })), selected: f.importance ? [f.importance] : [], multiple: false, onChange: (list) => (f.importance = list[0] || null) });
  const save = h('button.btn.primary', { type: 'button', dataset: { action: 'save' } }, 'Enregistrer');
  const foot = [];
  const sheet = openSheet({
    title: existing ? 'Règle automatique' : 'Nouvelle règle',
    full: true,
    body: h(
      'div.stack.loose',
      display.el,
      label.el,
      app.state.tags.length ? fieldGroup('Tags proposés', tags.el) : null,
      fieldGroup('Importance proposée', importance.el),
      app.state.envelopes.length ? envelope.el : null,
      h('p.hint', "Quand une opération concerne ce tiers (saisie à la main ou lue sur un relevé), l'appli propose ces valeurs. Tu restes libre de les changer."),
    ),
    foot: [
      existing
        ? h(
            'button.btn.danger.fixed',
            {
              type: 'button',
              'aria-label': 'Supprimer la règle',
              dataset: { action: 'delete' },
              onclick: async () => {
                if (await app.run(planDeleteRule(app.state, existing.id), { label: 'Règle supprimée' })) sheet.close();
              },
            },
            icon('trash'),
          )
        : null,
      save,
      ...foot,
    ],
  });
  save.addEventListener('click', async () => {
    const plan = planSaveRule(app.state, { id: existing?.id, display: display.value, label: label.value, tags: f.tags, envelopeId: envelope.value || null, importance: f.importance });
    if (!plan.ok) {
      display.setError(plan.errors[0].message);
      return;
    }
    if (await app.commit(plan.cs, { label: existing ? 'Règle modifiée' : 'Règle créée' })) sheet.close();
  });
  return sheet.closed;
}

export function createRulesScreen(app) {
  const screen = subScreen(app, 'rules', 'Règles automatiques', h('button.icon-btn', { type: 'button', 'aria-label': 'Nouvelle règle', dataset: { action: 'add-rule' }, onclick: () => openRuleForm(app) }, icon('plus')));
  function update() {
    clear(screen.content);
    const state = app.state;
    screen.content.appendChild(
      h('div.notice', icon('wand'), h('div.grow', "L'appli retient comment tu ranges les opérations d'un même tiers et te le repropose, notamment à l'import d'un relevé. Ces règles se créent toutes seules ; tu peux les corriger ici.")),
    );
    if (!state.rules.length) {
      screen.content.appendChild(h('div.empty', h('p', "Aucune règle pour l'instant : elles apparaîtront dès que tu auras rangé quelques opérations (tags, importance, enveloppe).")));
      return;
    }
    const menu = h('div.menu');
    const rules = state.rules.slice().sort((a, b) => b.uses - a.uses || a.display.localeCompare(b.display, 'fr'));
    for (const rule of rules) {
      const bits = [];
      if (rule.label) bits.push(rule.label);
      for (const tagId of rule.tags) {
        const tag = state.tags.find((t) => t.id === tagId);
        if (tag) bits.push(tag.name);
      }
      if (rule.importance) bits.push(importanceLabel(rule.importance));
      const env = rule.envelopeId ? state.envelopes.find((e) => e.id === rule.envelopeId) : null;
      if (env) bits.push(`enveloppe ${env.name}`);
      menu.appendChild(
        h(
          'button.menu-item',
          { type: 'button', dataset: { rule: rule.id }, onclick: () => openRuleForm(app, { id: rule.id }) },
          h('span.texts', h('b', rule.display), h('span', bits.join(', ') || 'Rien de retenu')),
          h('span.count-badge', { title: "Nombre d'utilisations" }, String(rule.uses)),
        ),
      );
    }
    screen.content.appendChild(menu);
  }
  return { el: screen.el, update };
}

// ---------------------------------------------------------------------------------------------
// Sécurité (code de déverrouillage)
// ---------------------------------------------------------------------------------------------

export function createSecurityScreen(app) {
  const screen = subScreen(app, 'security', 'Sécurité');
  const codeRule = new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`);

  async function askCurrent(title) {
    const pin = app.setting('pin');
    const code = await promptDialog({
      title,
      label: 'Code actuel',
      type: 'password',
      inputMode: 'numeric',
      maxLength: PIN_MAX,
      confirmLabel: 'Continuer',
      validate: (text) => (checkPin(pin, text) ? null : 'Code incorrect.'),
    });
    return code !== null;
  }

  async function define() {
    if (app.setting('pin') && !(await askCurrent('Changer le code'))) return;
    const first = await promptDialog({
      title: 'Nouveau code',
      message: `De ${PIN_MIN} à ${PIN_MAX} chiffres. Il te sera demandé à chaque ouverture de l'appli.`,
      label: 'Nouveau code',
      type: 'password',
      inputMode: 'numeric',
      maxLength: PIN_MAX,
      confirmLabel: 'Continuer',
      validate: (text) => (codeRule.test(text) ? null : `Le code doit faire de ${PIN_MIN} à ${PIN_MAX} chiffres.`),
    });
    if (first === null) return;
    const second = await promptDialog({
      title: 'Confirme le code',
      label: 'Le même code, une seconde fois',
      type: 'password',
      inputMode: 'numeric',
      maxLength: PIN_MAX,
      confirmLabel: 'Activer le code',
      validate: (text) => (text === first ? null : 'Les deux codes sont différents.'),
    });
    if (second === null) return;
    await app.setSetting('pin', makePin(first));
    app.notify('Code activé');
  }

  async function removePin() {
    if (!(await askCurrent('Supprimer le code'))) return;
    await app.setSetting('pin', undefined);
    app.refreshLock();
    app.notify('Code supprimé');
  }

  function update() {
    clear(screen.content);
    const active = !!app.setting('pin');
    screen.content.appendChild(
      h(
        'div',
        { class: active ? 'notice good' : 'notice' },
        icon(active ? 'lock' : 'shield'),
        h('div.grow', active ? "L'appli est protégée par un code. Il est demandé à l'ouverture, et après une minute passée en arrière-plan." : "Sans code, toute personne qui a ton téléphone déverrouillé peut ouvrir l'appli."),
      ),
    );
    const menu = h('div.menu');
    menu.appendChild(
      h('button.menu-item', { type: 'button', dataset: { action: 'define-pin' }, onclick: define }, icon('lock'), h('span.texts', h('b', active ? 'Changer le code' : 'Définir un code'), h('span', `${PIN_MIN} à ${PIN_MAX} chiffres`)), h('span.chev', icon('right'))),
    );
    if (active) {
      menu.appendChild(h('button.menu-item', { type: 'button', dataset: { action: 'lock-now' }, onclick: () => app.lockNow() }, icon('shield'), h('span.texts', h('b', 'Verrouiller maintenant')), h('span.chev', icon('right'))));
      menu.appendChild(h('button.menu-item.danger', { type: 'button', dataset: { action: 'remove-pin' }, onclick: removePin }, icon('trash'), h('span.texts', h('b', 'Supprimer le code')), h('span.chev', icon('right'))));
    }
    screen.content.appendChild(menu);
    screen.content.appendChild(
      h(
        'p.hint',
        "Le code n'est enregistré nulle part en clair, et personne ne peut te le renvoyer : si tu l'oublies, il faudra effacer les données de l'appli puis restaurer une sauvegarde. Le code protège des regards, il ne chiffre pas les données : garde aussi le verrouillage de ton téléphone.",
      ),
    );
  }
  return { el: screen.el, update };
}

// ---------------------------------------------------------------------------------------------
// À propos (version, confidentialité, diagnostic)
// ---------------------------------------------------------------------------------------------

/** Petit bilan technique, joint aux signalements de bugs. */
export async function diagnosticsText(app) {
  const state = app.state;
  const lines = [
    `Mon Budget ${app.version} (schéma ${SCHEMA_VERSION})`,
    deviceSummary(),
    `Stockage : ${app.store.persistent ? 'base locale' : 'MÉMOIRE SEULEMENT (rien ne sera conservé)'}`,
    `Écran : ${app.currentScreenName()}`,
    `Date de l'appareil : ${new Date().toString()}`,
    `Fiches : ${STORES.map((name) => `${name}=${state[name].length}`).join(', ')}`,
    `Réglages : thème=${app.setting('theme', 'auto')}, code=${app.setting('pin') ? 'oui' : 'non'}, exemple=${app.setting('demo') ? 'oui' : 'non'}`,
  ];
  // Installation, fichiers, connexion : des oui / non, jamais le jeton ni l'adresse de la boîte.
  const pwa = app.pwa.state();
  const offline = pwa.offlineReady ? 'prêt' : pwa.supported ? 'en préparation' : 'non disponible';
  lines.push(`Installation : ${isNative() ? 'appli Android' : pwa.installed ? 'appli installée' : 'navigateur'}, hors connexion=${offline}, mise à jour en attente=${pwa.updateReady ? 'oui' : 'non'}${pwa.error ? `, erreur=${pwa.error}` : ''}`);
  lines.push(`Fichiers : ${filesTarget() === 'documents' ? 'Documents/MonBudget' : filesTarget() === 'folder' ? 'dossier choisi' : filesBlocked() ? 'dossier à réautoriser' : 'téléchargement'} ; Claude : ${app.claude.connected ? 'connecté' : 'non connecté'}`);
  const estimate = await storageEstimate();
  if (estimate) lines.push(`Espace : ${(estimate.usage / 1048576).toFixed(1)} Mo utilisés sur ${(estimate.quota / 1048576).toFixed(0)} Mo`);
  if (app.setting('autoBackupDate')) lines.push(`Dernière sauvegarde automatique : ${app.setting('autoBackupDate')}`);
  if (app.setting('autoBackupError')) lines.push(`Erreur de sauvegarde automatique : ${app.setting('autoBackupError')}`);
  if (app.errors.length) {
    lines.push('', 'Dernières erreurs :');
    for (const error of app.errors.slice(-8)) lines.push(`- ${error.at} [${error.context}] ${error.message}${error.stack ? `\n  ${error.stack.split('\n').slice(1, 3).join('\n  ')}` : ''}`);
  } else lines.push('Aucune erreur enregistrée depuis le démarrage.');
  return lines.join('\n');
}

export function createAboutScreen(app) {
  const screen = subScreen(app, 'about', 'À propos');
  const results = h('div');
  let persisted = null; // le téléphone s'est-il engagé à ne pas effacer les données de lui-même ?
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage
      .persisted()
      .then((value) => {
        persisted = value;
        if (!screen.el.hidden && screen.el.isConnected) update();
      })
      .catch(() => {});
  }

  /** Carte « Installation » : appli installée ou non, hors connexion, mises à jour. */
  function installCard() {
    const pwa = app.pwa.state();
    const chip = (tone, text) => h('span', { class: `chip ${tone}` }, text);
    const card = h('div.card.stack.tight', { dataset: { card: 'install' } }, h('h2', 'Installation'));
    // une ligne « intitulé … état », et l'explication dessous sur toute la largeur
    const row = (label, value, hint = '') => {
      card.appendChild(h('div.kv', h('span.k', label), h('span.v', value)));
      if (hint) card.appendChild(h('p.hint', hint));
    };
    row('Ouverte comme', pwa.installed ? chip('good', 'Appli installée') : chip('plain', 'Page du navigateur'), pwa.installed ? '' : "Installée, elle a son icône et s'ouvre en plein écran.");
    if (!pwa.installed && pwa.supported) {
      card.appendChild(h('button.btn.small', { type: 'button', dataset: { action: 'install' }, onclick: () => installApp(app) }, icon('phone'), pwa.canInstall ? "Installer l'appli" : "Comment installer l'appli"));
    }
    if (!pwa.supported) {
      row('Sans connexion', chip('plain', 'Non concerné'), "L'installation et le fonctionnement sans connexion demandent l'appli publiée sur internet (adresse en https).");
      return card;
    }
    row(
      'Sans connexion',
      pwa.offlineReady ? chip('good', 'Prêt') : chip('warn', 'En préparation'),
      pwa.offlineReady ? "Les fichiers de l'appli sont en réserve sur l'appareil." : pwa.error ? `Pas encore prêt : ${pwa.error}` : 'Les fichiers sont en cours de mise en réserve.',
    );
    row('Mise à jour', pwa.updateReady ? chip('blue', 'Nouvelle version prête') : chip('plain', 'Rien en attente'));
    card.appendChild(
      pwa.updateReady
        ? h('button.btn.small.primary', { type: 'button', dataset: { action: 'apply-update' }, onclick: () => app.pwa.update() }, 'Mettre à jour maintenant')
        : h(
            'button.btn.small',
            {
              type: 'button',
              dataset: { action: 'check-update' },
              onclick: async () => {
                const outcome = await app.pwa.check();
                if (outcome === 'offline') app.fail('Pas de connexion : impossible de vérifier pour le moment.');
                else if (outcome === 'unavailable') app.fail('Vérification indisponible ici.');
                else setTimeout(() => app.notify(app.pwa.state().updateReady ? 'Une nouvelle version est prête' : "Vérification faite : s'il y a du nouveau, un bandeau l'annoncera"), 1200);
              },
            },
            icon('refresh'),
            'Chercher une mise à jour',
          ),
    );
    if (persisted !== null) {
      row('Données protégées', persisted ? chip('good', 'Oui') : chip('plain', 'Pas encore'), persisted ? "Le téléphone ne les effacera pas de lui-même, même s'il manque de place." : "Installe l'appli : le téléphone s'engage alors à ne pas effacer ses données de lui-même.");
    }
    return card;
  }

  async function selfTest() {
    clear(results).appendChild(h('p.hint', 'Tests en cours…'));
    const rows = [];
    const check = async (label, fn) => {
      try {
        const detail = await fn();
        rows.push({ label, ok: true, detail: detail || '' });
      } catch (error) {
        rows.push({ label, ok: false, detail: String(error?.message || error) });
      }
    };
    await check('Base de données locale', async () => {
      if (!app.store.persistent) throw new Error('indisponible : les données restent en mémoire');
      await app.store.setSetting('selfTest', Date.now(), { silent: true });
      await app.store.setSetting('selfTest', undefined, { silent: true });
      return 'lecture et écriture réussies';
    });
    await check('Pièces jointes', async () => {
      const record = await app.store.saveBlob(new Uint8Array([1, 2, 3]), { kind: 'photo', name: 'test', mime: 'application/octet-stream' });
      const back = await app.store.readBlob(record.id);
      await app.store.db.deleteBlobs([record.id]);
      if (!back || back.bytes.length !== 3) throw new Error('relecture incorrecte');
      return 'écriture et relecture réussies';
    });
    await check(filesPlace() ? `Fichiers dans ${filesPlace()}` : 'Fichiers sur le téléphone', async () => {
      if (isNative() && !hasPlugin('Filesystem')) throw new Error('module Filesystem absent de cette version');
      if (filesBlocked()) throw new Error("le téléphone redemande l'accès au dossier (Plus › Sauvegarde et données)");
      if (!filesTarget()) return app.folder.info().supported ? 'aucun dossier choisi : les fichiers sont téléchargés (Plus › Sauvegarde et données pour en choisir un)' : 'non concerné ici : les fichiers sont téléchargés';
      const path = await writeToDocuments('Exports', 'test-ecriture.txt', `Test du ${new Date().toISOString()}`);
      return `écrit dans ${path}`;
    });
    if (!isNative()) {
      await check('Fonctionnement sans connexion', async () => {
        const pwa = app.pwa.state();
        if (!pwa.supported) return "non concerné ici (il faut l'appli publiée sur internet)";
        if (pwa.error && !pwa.offlineReady) return `pas encore prêt : ${pwa.error}`;
        if (!pwa.offlineReady) return "en préparation : les fichiers de l'appli sont en cours de mise en réserve";
        const reserve = await app.pwa.reserve();
        return reserve ? `prêt (version ${reserve.version}, ${reserve.files} fichiers en réserve)` : 'prêt';
      });
    }
    await check('Partage', async () => {
      if (isNative()) {
        if (!hasPlugin('Share')) throw new Error('module Share absent de cette version');
        return 'module de partage présent';
      }
      return navigator.share ? 'partage du navigateur disponible' : 'non disponible ici : les fichiers seront téléchargés';
    });
    await check('Bouton retour', async () => (isNative() ? (hasPlugin('App') ? 'module App présent' : "module App absent : le retour passe par l'historique") : "géré par l'historique du navigateur"));
    clear(results);
    for (const row of rows) {
      results.appendChild(h('div.kv', h('span.k', row.label), h('span.v', h('span', { class: row.ok ? 'chip good' : 'chip bad' }, icon(row.ok ? 'check' : 'x', 'sm'), row.ok ? 'OK' : 'Échec'), h('div.hint', row.detail))));
    }
  }

  function update() {
    clear(screen.content);
    screen.content.appendChild(
      h(
        'div.card.stack.tight',
        h('h2', `Mon Budget, version ${app.version}`),
        h('p.note', 'Tes comptes, tes enveloppes et tes prévisions, sur ton téléphone uniquement.'),
        h('div.kv', h('span.k', 'Format des données'), h('span.v', `version ${SCHEMA_VERSION}`)),
        h('div.kv', h('span.k', 'Appareil'), h('span.v.small', deviceSummary())),
        h('button.link-btn', { type: 'button', dataset: { action: 'whats-new' }, onclick: () => showWhatsNew(CHANGES.slice(0, 3)) }, 'Voir ce qui a changé récemment'),
      ),
    );
    if (!isNative()) screen.content.appendChild(installCard());
    screen.content.appendChild(
      h(
        'div.card.stack.tight',
        h('h2', 'Confidentialité'),
        h('p.note', "Pas de compte, pas de publicité, pas de mesure d'audience. Tes opérations, tes montants, tes enveloppes et tes relevés restent dans le stockage de l'appli et dans les fichiers que tu choisis d'exporter : ils ne sont jamais envoyés sur internet."),
        h(
          'p.note',
          { dataset: { value: 'network' } },
          app.claude.connected
            ? `La connexion à Claude est réglée : quand tu touches « Envoyer à Claude », ton commentaire (texte, captures jointes, informations techniques) part dans ta boîte privée, et l'appli y relit les réponses. ${isNative() ? "C'est son seul échange avec internet." : "C'est son seul échange avec internet, avec la recherche de ses propres mises à jour."}`
            : isNative()
              ? "L'appli ne se connecte à aucun serveur. Si tu règles un jour la connexion à Claude, seuls tes commentaires partiront, et uniquement quand tu les envoies."
              : "Son seul échange avec internet est la recherche de ses propres mises à jour. Si tu règles un jour la connexion à Claude, tes commentaires partiront aussi, uniquement quand tu les envoies.",
        ),
      ),
    );
    screen.content.appendChild(
      h(
        'div.card.stack.tight',
        { dataset: { card: 'self-test' } },
        h('h2', 'Vérifier que tout fonctionne'),
        h('p.hint', "À lancer après l'installation, ou si quelque chose semble ne pas s'enregistrer."),
        h('button.btn', { type: 'button', dataset: { action: 'self-test' }, onclick: selfTest }, 'Lancer la vérification'),
        results,
      ),
    );
    screen.content.appendChild(
      h(
        'div.card.stack.tight',
        h('h2', 'Composants utilisés'),
        h('p.hint', 'Police Inter (licence SIL Open Font 1.1). Lecture des PDF : pdf.js de Mozilla (licence Apache 2.0). Tout est embarqué dans l\'appli.'),
        h(
          'button.link-btn',
          { type: 'button', onclick: async () => alertDialog({ title: 'Diagnostic', message: await diagnosticsText(app) }) },
          'Afficher le diagnostic technique',
        ),
      ),
    );
  }
  return { el: screen.el, update };
}
