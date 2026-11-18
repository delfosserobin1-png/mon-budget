// Commentaires pour Claude : un problème, une idée, une question — écrits dans l'appli, avec une
// capture d'écran si besoin. Les informations techniques sont jointes automatiquement.
//
// Deux façons de faire parvenir un commentaire :
//   - connexion à Claude réglée (Plus › Connexion à Claude) : un bouton « Envoyer à Claude » le
//     dépose dans la boîte à commentaires ; les réponses de Claude reviennent s'afficher ici ;
//   - sinon : partage à la main (mail, messagerie…), comme un simple signalement.
// Rien n'est envoyé sans que l'utilisateur touche lui-même un bouton d'envoi ou de partage.
//
// (L'écran s'appelle encore « bugs » dans le code : c'était l'écran « Signaler un bug ».)

import { h, clear, plural } from '../dom.js';
import { icon } from '../icons.js';
import { subTopbar } from '../shell.js';
import { alertDialog, confirmDialog, openSheet } from '../overlays.js';
import { textArea, fieldGroup, segmented, selectField, toggle } from '../fields.js';
import { addPhoto, photoThumb } from '../photos.js';
import { diagnosticsText } from './settings-screens.js';
import { BUG_REPORT_EMAIL } from '../../config.js';
import { Draft } from '../../core/changeset.js';
import { makeBugReport } from '../../core/schema.js';
import { formatDate } from '../../core/dates.js';
import { COMMENT_KINDS, SCREEN_NAMES, STATUS_LABELS, commentStatus, kindLabel, screenLabel, targetText, unreadReplies } from '../../core/comments.js';
import { AI_SETTING } from '../annotate.js';
import { zipStore } from '../../io/zip.js';
import { extensionFor } from '../../data/backup.js';
import { copyText, deviceSummary, saveFile, shareFile, shareText } from '../../platform/platform.js';

const KIND_ICONS = { bug: 'bug', idee: 'bulb', question: 'help' };
const FORM_TEXTS = {
  bug: { label: "Que s'est-il passé ?", placeholder: "Ex. : en enregistrant une dépense dans l'enveloppe Vacances, le solde n'a pas bougé.", error: "Décris en une phrase ce qui s'est passé." },
  idee: { label: 'Quelle est ton idée ?', placeholder: 'Ex. : dans Stats, je voudrais voir le total par mois sur une seule ligne.', error: 'Décris ton idée en une phrase.' },
  question: { label: 'Quelle est ta question ?', placeholder: 'Ex. : à quoi sert le bouton « Elle a eu lieu » dans les prévisions ?', error: 'Décris ta question en une phrase.' },
};
// Les écrans proposés dans « Ça concerne » (ceux où l'on travaille, puis « toute l'appli »).
const SCREEN_CHOICES = ['all', 'operations', 'envelopes', 'envelope', 'forecast', 'stats', 'statement', 'reconcile', 'archives', 'backup', 'tags', 'rules', 'security', 'guide', 'about'];

const day = (iso) => formatDate(String(iso || '').slice(0, 10));

function reportText(report) {
  const lines = [`${kindLabel(report.kind)} — Mon Budget, le ${day(report.createdAt)}`, `Écran concerné : ${screenLabel(report.screen)}`, '', report.text];
  if (report.steps) lines.push('', 'Juste avant :', report.steps);
  lines.push('', '--- Informations techniques ---', report.diagnostics);
  if (report.photoIds.length) lines.push('', `${plural(report.photoIds.length, "capture d'écran jointe", "captures d'écran jointes")}.`);
  return lines.join('\n');
}

function statusChip(report) {
  const status = STATUS_LABELS[commentStatus(report)];
  return h('span', { class: `chip ${status.tone}`, dataset: { status: commentStatus(report) } }, status.label);
}

export function createBugsScreen(app, params = {}) {
  const refresh = h('button.icon-btn', { type: 'button', 'aria-label': 'Relever les réponses de Claude', dataset: { action: 'sync' }, hidden: true }, icon('refresh'));
  const top = subTopbar(app, 'Commentaires pour Claude', refresh);
  const linkHost = h('div');
  const formHost = h('div.card.stack');
  const listHost = h('div');
  const aiHost = h('div.card.stack.tight', { dataset: { card: 'ai-button' } });
  const content = h('div.pad.stack.loose', linkHost, formHost, listHost, aiHost);
  const el = h('section.screen', { dataset: { screen: 'bugs' } }, top.el, h('main.scroll', content, h('div.bottom-space')));
  const origin = SCREEN_CHOICES.includes(params.from) ? params.from : SCREEN_CHOICES.includes(app.lastPlace?.()) ? app.lastPlace() : 'all';

  let kind = 'bug';
  let photos = [];
  let newFiles = [];
  let sending = false;

  const kindChoice = segmented({ label: 'Type de commentaire', value: kind, options: COMMENT_KINDS.map((k) => ({ value: k.id, label: k.label })), onChange: (value) => setKind(value) });
  const screenChoice = selectField({ label: 'Ça concerne', name: 'screen', value: origin, options: SCREEN_CHOICES.map((id) => ({ value: id, label: SCREEN_NAMES[id] })) });
  const text = textArea({ label: FORM_TEXTS.bug.label, name: 'text', placeholder: FORM_TEXTS.bug.placeholder, rows: 4 });
  const steps = textArea({ label: 'Que faisais-tu juste avant ?', name: 'steps', optional: true, rows: 2 });
  const photoHost = h('div');
  const actions = h('div.stack.tight');

  function setKind(value) {
    kind = value;
    const texts = FORM_TEXTS[kind];
    const label = text.el.querySelector('label');
    if (label) label.firstChild.nodeValue = texts.label;
    text.input.placeholder = texts.placeholder;
    text.setError('');
    steps.el.hidden = kind !== 'bug';
  }

  function renderPhotos() {
    clear(photoHost);
    const row = h('div.photos');
    for (const id of photos) {
      row.appendChild(
        photoThumb(app, id, {
          onRemove: (removed) => {
            photos = photos.filter((x) => x !== removed);
            renderPhotos();
          },
        }),
      );
    }
    photoHost.appendChild(
      fieldGroup(
        "Capture d'écran",
        photos.length ? row : null,
        h(
          'button.btn.small',
          {
            type: 'button',
            dataset: { action: 'add-capture' },
            onclick: async () => {
              const record = await addPhoto(app, { kind: 'bug' });
              if (!record) return;
              photos = [...photos, record.id];
              newFiles = [...newFiles, record];
              renderPhotos();
            },
          },
          icon('image'),
          'Ajouter une image',
        ),
        h('p.hint', "Pour faire une capture : appuie en même temps sur Marche/Arrêt et Volume bas, puis reviens ici l'ajouter."),
      ),
    );
  }

  formHost.append(
    kindChoice.el,
    text.el,
    steps.el,
    screenChoice.el,
    photoHost,
    h('p.note', "Les informations techniques (version, téléphone, dernière erreur) sont ajoutées toutes seules ; tes opérations et tes montants n'y figurent pas. Vérifie seulement ce que montre une capture avant de la joindre."),
    actions,
  );
  renderPhotos();

  /** Enregistre le commentaire dans l'appli (toujours la première étape). Renvoie sa fiche, ou null. */
  async function save() {
    if (!text.value) {
      text.setError(FORM_TEXTS[kind].error);
      text.focus();
      return null;
    }
    const used = new Set(photos);
    const report = makeBugReport({
      kind,
      text: text.value,
      steps: kind === 'bug' ? steps.value : '',
      screen: screenChoice.value,
      appVersion: app.version,
      device: deviceSummary(),
      diagnostics: await diagnosticsText(app),
      photoIds: photos,
    });
    const draft = new Draft(app.state);
    for (const file of newFiles) if (used.has(file.id)) draft.put('files', file);
    draft.put('bugReports', report);
    if (!(await app.commit(draft.cs, { undoable: false }))) return null;
    text.value = '';
    steps.value = '';
    photos = [];
    newFiles = [];
    renderPhotos();
    return report;
  }

  /** Fichier à partager : le texte seul, ou un ZIP (texte + captures) s'il y a des images. */
  async function bundle(report) {
    const body = reportText(report);
    const stamp = report.createdAt.slice(0, 10);
    if (!report.photoIds.length) return { name: `commentaire-${stamp}.txt`, mime: 'text/plain', data: body, body };
    const files = [{ name: 'commentaire.txt', data: body }];
    let n = 1;
    for (const id of report.photoIds) {
      const blob = await app.store.readBlob(id);
      if (blob) files.push({ name: `capture-${n++}.${extensionFor(blob.mime)}`, data: blob.bytes });
    }
    return { name: `commentaire-${stamp}.zip`, mime: 'application/zip', data: zipStore(files), body };
  }

  async function share(report) {
    const pack = await bundle(report);
    let result;
    if (report.photoIds.length) result = await shareFile({ name: pack.name, mime: pack.mime, data: pack.data, title: 'Commentaire Mon Budget', text: report.text });
    else result = await shareText({ title: 'Commentaire Mon Budget', text: pack.body });
    if (result === 'cancelled') return;
    if (result === 'copied') app.notify('Commentaire copié : colle-le dans un message');
    else if (result === 'saved') app.notify(`« ${pack.name} » enregistré : joins-le à ton message`);
    else if (result === 'failed') {
      await alertDialog({ title: 'Commentaire', message: pack.body });
      return;
    }
    const current = app.state.bugReports.find((r) => r.id === report.id);
    if (current && !current.sentAt) {
      const draft = new Draft(app.state);
      draft.put('bugReports', { ...current, sentAt: new Date().toISOString() });
      await app.commit(draft.cs, { undoable: false });
    }
  }

  /** Dépose le commentaire dans la boîte de Claude et dit ce qu'il en est. */
  async function sendToClaude(id) {
    const result = await app.claude.send(id);
    if (result.ok) app.notify(result.already ? 'Déjà envoyé à Claude' : `Envoyé à Claude (commentaire n° ${result.number})`);
    else if (result.queued) app.fail(`${result.error} Le commentaire est gardé : il partira tout seul dès que possible.`);
    else app.fail(result.error);
    return result.ok;
  }

  async function busy(task) {
    if (sending) return;
    sending = true;
    renderActions();
    try {
      await task();
    } finally {
      sending = false;
      renderActions();
    }
  }

  function renderActions() {
    clear(actions);
    const connected = app.claude.connected;
    if (connected) {
      actions.append(
        h(
          'button.btn.primary.block',
          {
            type: 'button',
            disabled: sending,
            dataset: { action: 'send-report' },
            onclick: () =>
              busy(async () => {
                const report = await save();
                if (report) await sendToClaude(report.id);
              }),
          },
          icon('send'),
          sending ? 'Envoi en cours…' : 'Envoyer à Claude',
        ),
      );
    } else {
      actions.append(
        h(
          'button.btn.primary.block',
          {
            type: 'button',
            disabled: sending,
            dataset: { action: 'save-report' },
            onclick: () =>
              busy(async () => {
                const report = await save();
                if (report) await share(report);
              }),
          },
          icon('share'),
          'Enregistrer et partager',
        ),
      );
    }
    actions.append(
      h(
        'button.btn.quiet.block',
        {
          type: 'button',
          disabled: sending,
          dataset: { action: 'keep-report' },
          onclick: () =>
            busy(async () => {
              if (await save()) app.notify('Commentaire enregistré');
            }),
        },
        connected ? 'Enregistrer sans envoyer' : 'Enregistrer sans partager',
      ),
    );
  }

  // ---- un commentaire ouvert : le fil de la discussion, la réponse, les actions ----
  function openReport(id) {
    const first = app.state.bugReports.find((r) => r.id === id);
    if (!first) return;
    const head = h('div.stack.tight');
    const thread = h('div.thread', { dataset: { thread: id } });
    const reply = textArea({ label: 'Ta réponse à Claude', name: 'reply', rows: 2, placeholder: 'Écris ta réponse…' });
    const replyBtn = h('button.btn.primary.block', { type: 'button', dataset: { action: 'reply' } }, icon('send'), 'Répondre');
    const replyHost = h('div.stack.tight', reply.el, replyBtn);
    const actionsHost = h('div.menu');
    const sheet = openSheet({ title: `${kindLabel(first.kind)} du ${day(first.createdAt)}`, full: true, body: h('div.stack.loose', head, thread, replyHost, actionsHost) });

    const action = (value, iconName, label, run, danger = false) =>
      h('button', { type: 'button', class: danger ? 'menu-item danger' : 'menu-item', 'data-value': value, onclick: run }, icon(iconName), h('span.texts', h('b', label)));

    const bubble = (from, when, body, extra = null) =>
      h('div', { class: `msg ${from === 'claude' ? 'claude' : 'me'}`, dataset: { from } }, h('span.who', `${from === 'claude' ? 'Claude' : 'Toi'}${when ? `, le ${day(when)}` : ''}`), body, extra);

    function render() {
      const report = app.state.bugReports.find((r) => r.id === id);
      if (!report) {
        sheet.close();
        return;
      }
      const remote = report.remote;
      clear(head);
      head.append(
        h('div.chips', statusChip(report), remote ? h('span.chip.plain', `n° ${remote.number}`) : null, h('span.chip.plain', screenLabel(report.screen))),
        report.target ? h('p.hint', { dataset: { value: 'target' } }, `Élément visé : ${targetText(report.target)}`) : null,
        report.queued && !remote ? h('p.hint', "Ce commentaire attend une connexion : il partira tout seul dès que l'appli pourra joindre la boîte de Claude.") : null,
      );

      clear(thread);
      const photoRow = report.photoIds.length ? h('div.photos', report.photoIds.map((photoId) => photoThumb(app, photoId))) : null;
      thread.append(bubble('moi', report.createdAt, report.steps ? `${report.text}\n\nJuste avant : ${report.steps}` : report.text, photoRow));
      for (const message of remote ? remote.thread : []) thread.append(bubble(message.from, message.at, message.text));
      if (remote && !remote.thread.length) thread.append(h('p.hint.center', "Claude n'a pas encore répondu. La réponse s'affichera ici."));

      replyHost.hidden = !(remote && app.claude.connected);

      clear(actionsHost);
      if (!remote && app.claude.connected) {
        actionsHost.append(
          action('send', 'send', report.queued ? 'Réessayer l\'envoi à Claude' : 'Envoyer à Claude', async () => {
            await sendToClaude(id);
          }),
        );
      }
      actionsHost.append(
        action('share', 'share', 'Partager', () => share(report)),
        action('copy', 'copy', 'Copier le texte', async () => app.notify((await copyText(reportText(report))) ? 'Texte copié' : 'Copie impossible sur cet appareil')),
      );
      if (BUG_REPORT_EMAIL) {
        actionsHost.append(
          action('mail', 'envelope', 'Envoyer par e-mail', () => {
            const subject = encodeURIComponent(`Mon Budget ${report.appVersion} : ${kindLabel(report.kind).toLowerCase()}`);
            const mailBody = encodeURIComponent(reportText(report).slice(0, 1800));
            window.location.href = `mailto:${BUG_REPORT_EMAIL}?subject=${subject}&body=${mailBody}`;
          }),
        );
      }
      actionsHost.append(
        action('export', 'download', 'Enregistrer le fichier', async () => {
          const pack = await bundle(report);
          try {
            const { where } = await saveFile({ name: pack.name, mime: pack.mime, data: pack.data, folder: 'Commentaires' });
            app.notify(where);
          } catch (error) {
            app.fail(`Enregistrement impossible : ${error.message}`);
          }
        }),
        action(
          'delete',
          'trash',
          'Supprimer',
          async () => {
            const ok = await confirmDialog({
              title: 'Supprimer ce commentaire ?',
              message: remote ? "Il sera retiré de l'appli. Claude l'a déjà reçu : il reste dans sa boîte à commentaires." : '',
              confirmLabel: 'Supprimer',
              danger: true,
            });
            if (!ok) return;
            const draft = new Draft(app.state);
            draft.del('bugReports', id);
            if (await app.commit(draft.cs, { label: 'Commentaire supprimé' })) sheet.close();
          },
          true,
        ),
      );
      // Les réponses affichées sont lues : la pastille « Réponse de Claude » peut s'éteindre.
      if (unreadReplies(report) > 0) app.claude.markSeen(id);
    }

    replyBtn.addEventListener('click', async () => {
      if (!reply.value) {
        reply.setError('Écris ta réponse.');
        reply.focus();
        return;
      }
      replyBtn.disabled = true;
      const result = await app.claude.reply(id, reply.value);
      replyBtn.disabled = false;
      if (result.ok) {
        reply.value = '';
        app.notify('Réponse envoyée à Claude');
      } else reply.setError(result.error);
    });

    const unsubscribe = app.store.subscribe(() => {
      if (sheet.isOpen) render();
    });
    sheet.closed.then(unsubscribe);
    render();
  }

  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    const result = await app.claude.sync({ force: true });
    refresh.disabled = false;
    if (!result.ok) app.fail(result.error || 'Impossible de joindre la boîte à commentaires.');
    else if (result.newReplies) app.notify(plural(result.newReplies, 'nouvelle réponse de Claude', 'nouvelles réponses de Claude'));
    else app.notify(result.sent ? `${plural(result.sent, 'commentaire envoyé', 'commentaires envoyés')}` : 'Tout est à jour');
  });

  function renderLink() {
    clear(linkHost);
    const info = app.claude.info;
    const status = app.claude.status;
    refresh.hidden = !info;
    if (!info) {
      linkHost.appendChild(
        h(
          'div.notice',
          { dataset: { notice: 'link-missing' } },
          icon('link'),
          h('div.grow', h('b', "Claude ne reçoit pas encore tes commentaires"), h('div', "Règle la connexion une fois : ensuite, un bouton suffit, et ses réponses s'affichent ici. En attendant, tu peux les partager à la main.")),
          h('button.btn.small', { type: 'button', dataset: { action: 'open-link' }, onclick: () => app.open('claude') }, 'Régler'),
        ),
      );
      return;
    }
    if (status.lastError) {
      linkHost.appendChild(h('div.notice.warn', { dataset: { notice: 'link-error' } }, icon('alert'), h('div.grow', h('b', "Le dernier échange avec la boîte de Claude a échoué"), h('div', status.lastError))));
    } else {
      linkHost.appendChild(h('div.notice.good', { dataset: { notice: 'link-ok' } }, icon('check'), h('div.grow', 'Connecté : tes commentaires arrivent directement à Claude, et ses réponses reviennent ici.')));
    }
  }

  function renderAiSetting() {
    clear(aiHost);
    const switcher = toggle({
      label: 'Bouton IA sur tous les écrans',
      hint: "L'onglet « IA » sur le bord droit : touche-le, entoure un endroit de l'appli, écris ton commentaire. Fais-le glisser s'il gêne.",
      checked: app.setting(AI_SETTING, true) !== false,
      name: 'aiButton',
      onChange: (value) => app.setSetting(AI_SETTING, value),
    });
    aiHost.append(switcher.el);
  }

  function update() {
    renderLink();
    renderActions();
    renderAiSetting();
    clear(listHost);
    const reports = app.state.bugReports.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (!reports.length) return;
    listHost.appendChild(h('h2.section-title', { style: { padding: '0 4px 8px' } }, 'Mes commentaires'));
    const menu = h('div.menu');
    for (const report of reports) {
      const bits = [day(report.createdAt)];
      if (report.remote) bits.push(`n° ${report.remote.number}`);
      if (report.photoIds.length) bits.push(plural(report.photoIds.length, 'image'));
      menu.appendChild(
        h(
          'button.menu-item',
          { type: 'button', dataset: { report: report.id }, onclick: () => openReport(report.id) },
          icon(KIND_ICONS[report.kind] || 'bug'),
          h('span.texts', h('b', report.text.split('\n')[0].slice(0, 60)), h('span', bits.join(', '))),
          statusChip(report),
        ),
      );
    }
    listHost.appendChild(menu);
  }

  const offLink = app.claude.onChange(() => {
    if (!el.isConnected) {
      offLink(); // l'écran a été quitté : on n'écoute plus
      return;
    }
    if (!el.hidden) {
      renderLink();
      renderActions();
    }
  });

  return {
    el,
    update,
    onShow() {
      if (app.claude.connected) app.claude.sync({ force: true });
    },
    onClose() {
      offLink();
    },
  };
}
