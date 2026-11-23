// Formulaire d'une opération : sortie ou entrée ; mouvement d'enveloppe (alimentation, retrait,
// déplacement) quand il est ouvert depuis la fiche d'une enveloppe ; ajustement existant.
// Une seule feuille pour créer et pour modifier. Pendant une création, la saisie est gardée en
// brouillon à chaque frappe : si on ferme par erreur, on retrouve tout en rouvrant.

import { h, clear, debounce, plural } from '../dom.js';
import { icon } from '../icons.js';
import { openSheet, confirmDialog, chooseDialog } from '../overlays.js';
import { amountField, dateField, timeField, textField, textArea, selectField, segmented, pickList, toggle, fieldGroup } from '../fields.js';
import { KIND, IMPORTANCE, FREQUENCIES, frequencyLabel } from '../../core/schema.js';
import { planSaveOperation, planSaveTransfer, planCreditThenTransfer, planDeleteOperations, planConfirmSimulation, topupChangeset, accountName, moveDoneLabel, moveTitle } from '../../core/operations.js';
import { planSaveAdjustment } from '../../core/reconciliation.js';
import { planSaveRecurring, countBackfill } from '../../core/recurring.js';
import { computeBalances } from '../../core/balances.js';
import { Draft, merge, put } from '../../core/changeset.js';
import { learnInto, suggestFor } from '../../core/rules.js';
import { formatAmount, formatForInput, parseAmount } from '../../core/money.js';
import { impactText, quotaImpact } from '../../core/quotas.js';
import { formatDate, nowTime } from '../../core/dates.js';
import { addPhoto, photoThumb } from '../photos.js';
import { askNewTag } from './tag.js';
import { confirmTopups as askTopups } from '../topups.js';

const DRAFT_KEY = 'draft:operation';

function blank(today) {
  return {
    mode: 'expense',
    amountText: '',
    label: '',
    counterparty: '',
    date: today,
    time: null,
    envelopeId: '',
    thenEnvelopeId: '',
    importance: null,
    tags: [],
    comment: '',
    photoIds: [],
    newFiles: [],
    simulated: false,
    from: '',
    to: '',
    repeat: false,
    frequency: 'monthly',
    interval: 1,
    endDate: null,
  };
}

function fromOperation(op) {
  const base = blank(op.date);
  if (op.kind === KIND.TRANSFER) {
    return { ...base, mode: 'transfer', amountText: formatForInput(op.amount), label: op.label, comment: op.comment, date: op.date, time: op.time, from: op.from || '', to: op.to || '', simulated: op.simulated };
  }
  return {
    ...base,
    mode: op.kind === KIND.ADJUSTMENT ? 'adjustment' : op.amount < 0 ? 'expense' : 'income',
    positive: op.amount >= 0,
    amountText: formatForInput(op.amount),
    label: op.label,
    counterparty: op.counterparty,
    date: op.date,
    time: op.time,
    envelopeId: op.envelopeId || '',
    importance: op.importance,
    tags: [...op.tags],
    comment: op.comment,
    photoIds: [...op.photoIds],
    simulated: op.simulated,
  };
}

function isWorthKeeping(f) {
  return !!(f.amountText.trim() || f.label.trim() || f.counterparty.trim() || f.comment.trim() || f.photoIds.length || f.tags.length);
}

/**
 * Ouvre le formulaire.
 *   id      : opération à modifier (sinon création)
 *   preset  : valeurs de départ pour une création ({ mode, envelopeId, from, to, simulated, date… })
 * Renvoie une promesse résolue à la fermeture (true si quelque chose a été enregistré).
 */
export function openOperationForm(app, { id = null, preset = null } = {}) {
  const today = app.today();
  const existing = id ? app.state.operations.find((o) => o.id === id) : null;
  if (id && !existing) {
    app.fail("Cette opération n'existe plus.");
    return Promise.resolve(false);
  }
  const useDraft = !existing && !preset;
  let f;
  let restored = false;
  if (existing) f = fromOperation(existing);
  else {
    f = blank(today);
    const saved = useDraft ? app.setting(DRAFT_KEY) : null;
    if (saved && typeof saved === 'object' && isWorthKeeping({ ...f, ...saved })) {
      f = { ...f, ...saved };
      restored = true;
    } else {
      f.time = nowTime();
    }
    if (preset) f = { ...f, ...preset, time: preset.time === undefined ? f.time : preset.time };
    // Le bouton + ne propose que Sortie et Entrée : un ancien brouillon de « virement » repart en sortie.
    if (!preset && f.mode === 'transfer') f.mode = 'expense';
  }
  const rule = existing?.recurringId ? app.state.recurring.find((r) => r.id === existing.recurringId) : null;

  let saved = false;
  let dirty = false;
  const body = h('div.stack.loose');
  const saveBtn = h('button.btn.primary', { type: 'button', dataset: { action: 'save' } }, 'Enregistrer');
  const foot = [];
  if (existing) {
    foot.push(h('button.btn.danger.fixed', { type: 'button', 'aria-label': 'Supprimer', dataset: { action: 'delete' }, onclick: () => remove() }, icon('trash')));
  }
  foot.push(saveBtn);

  const persistDraft = debounce(() => {
    if (useDraft && !saved) app.setSetting(DRAFT_KEY, isWorthKeeping(f) ? f : undefined, { silent: true }).catch(() => {});
  }, 350);
  const touch = () => {
    dirty = true;
    persistDraft();
  };

  const sheet = openSheet({
    title: titleFor(),
    body,
    foot,
    full: true,
    canClose: async () => {
      persistDraft.flush();
      if (existing && dirty && !saved) {
        return confirmDialog({ title: 'Quitter sans enregistrer ?', message: 'Tes modifications seront perdues.', confirmLabel: 'Quitter', cancelLabel: 'Continuer', danger: true });
      }
      return true;
    },
  });
  saveBtn.addEventListener('click', () => save());

  function titleFor() {
    if (f.mode === 'transfer') return moveTitle(f.from, f.to);
    if (!existing) return 'Nouvelle opération';
    if (f.mode === 'adjustment') return existing.auto === 'opening' ? 'Solde de départ' : 'Ajustement';
    return 'Opération';
  }

  const fields = {};
  const setError = (name, message) => {
    const target = fields[name];
    if (target && target.setError) {
      target.setError(message);
      target.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    }
    return false;
  };

  function envelopeOptions(currentId, { withBalance = true } = {}) {
    const balances = computeBalances(app.state, { upTo: today }).envelopes;
    return app.state.envelopes
      .filter((e) => !e.closed || e.id === currentId)
      .map((e) => ({ value: e.id, label: withBalance ? `${e.name} (${formatAmount(balances.get(e.id) || 0)})` : e.name }));
  }

  // Ce qui est écrit dans les champs fait foi : on le relit avant de redessiner le formulaire et
  // avant d'enregistrer (une suggestion du champ ou du clavier ne prévient pas toujours).
  function syncTyped() {
    for (const key of ['label', 'counterparty', 'comment']) {
      const input = fields[key]?.input;
      if (input && input.isConnected) f[key] = input.value;
    }
  }

  // sync: false quand l'appelant vient lui-même de changer libellé, tiers ou commentaire
  function render({ sync = true } = {}) {
    if (sync) syncTyped();
    // on reconstruit le formulaire sans faire sauter la position de lecture
    const scroller = sheet.body;
    const top = scroller.scrollTop;
    build();
    scroller.scrollTop = top;
  }

  function build() {
    clear(body);
    quotaHost = null;
    for (const key of Object.keys(fields)) delete fields[key];
    if (f.mode === 'transfer' && !existing && !f.from && !f.to) {
      const first = app.state.envelopes.find((e) => !e.closed);
      if (first) f.to = first.id;
    }

    if (restored) {
      body.appendChild(
        h(
          'div.notice',
          icon('pencil'),
          h('div.grow', 'Brouillon repris là où tu l\'avais laissé.'),
          h(
            'button.link-btn',
            {
              type: 'button',
              onclick: () => {
                const keepMode = f.mode;
                f = { ...blank(today), mode: keepMode, time: nowTime() };
                restored = false;
                app.setSetting(DRAFT_KEY, undefined, { silent: true }).catch(() => {});
                render({ sync: false });
              },
            },
            'Effacer',
          ),
        ),
      );
    }

    // --- type --- (les mouvements d'enveloppe se font depuis la fiche de l'enveloppe : Alimenter, Retirer…)
    if (f.mode === 'expense' || f.mode === 'income') {
      const seg = segmented({
        label: 'Type',
        value: f.mode,
        options: [
          { value: 'expense', label: 'Sortie' },
          { value: 'income', label: 'Entrée' },
        ],
        onChange: (mode) => {
          f.mode = mode;
          touch();
          render();
        },
      });
      body.appendChild(seg.el);
    } else if (f.mode === 'adjustment') {
      const seg = segmented({
        label: 'Sens',
        value: f.positive ? 'plus' : 'minus',
        options: [
          { value: 'plus', label: 'En plus (+)' },
          { value: 'minus', label: 'En moins (−)' },
        ],
        onChange: (value) => {
          f.positive = value === 'plus';
          touch();
        },
      });
      body.appendChild(seg.el);
    }

    // --- montant ---
    fields.amount = amountField({
      label: 'Montant',
      autofocus: !existing && !f.amountText,
      onInput: (text) => {
        f.amountText = text;
        touch();
        updateQuotaHint();
      },
    });
    fields.amount.raw = f.amountText;
    body.appendChild(fields.amount.el);

    if (f.mode === 'transfer') renderTransfer();
    else if (f.mode === 'adjustment') renderAdjustment();
    else renderOperation();
  }

  function dateTimeRow() {
    fields.date = dateField({
      label: 'Date',
      value: f.date,
      name: 'date',
      onChange: (value) => {
        f.date = value;
        touch();
        updateDateHint();
        updateQuotaHint();
      },
    });
    fields.time = timeField({
      label: 'Heure',
      value: f.time,
      optional: 'f',
      name: 'time',
      onChange: (value) => {
        f.time = value;
        touch();
      },
    });
    return h('div.field-row', fields.date.el, fields.time.el);
  }

  let dateHint = null;
  function updateDateHint() {
    if (!dateHint) return;
    const future = f.date && f.date > today && !f.simulated && !f.repeat;
    dateHint.hidden = !future;
  }

  // Quotas des tags : on prévient avant d'enregistrer une sortie qui les ferait (presque) atteindre.
  let quotaHost = null;
  function updateQuotaHint() {
    if (!quotaHost) return;
    clear(quotaHost);
    if (f.mode !== 'expense' || !f.tags.length) return;
    const cents = f.amountText && f.amountText.trim() ? parseAmount(f.amountText) : null;
    if (!cents) return;
    const impacts = quotaImpact(app.state, { id: existing?.id || null, date: f.date || today, amount: -Math.abs(cents), tags: f.tags, simulated: f.simulated });
    for (const impact of impacts) {
      quotaHost.appendChild(h('div', { class: impact.level === 'over' ? 'notice bad' : 'notice warn', dataset: { notice: 'quota', tag: impact.tagId, level: impact.level } }, icon('target'), h('div.grow', impactText(impact, today))));
    }
  }

  function optionsBlock({ allowRepeat }) {
    const block = h('div.card.stack.tight');
    if (!f.repeat) {
      const sim = toggle({
        label: 'Prévision (opération simulée)',
        hint: 'Ne compte pas dans le solde réel : sert à estimer un solde futur.',
        checked: f.simulated,
        name: 'simulated',
        onChange: (value) => {
          f.simulated = value;
          touch();
          render();
        },
      });
      block.appendChild(sim.el);
    }
    if (allowRepeat && !existing) {
      const repeat = toggle({
        label: 'Répéter',
        hint: 'Loyer, abonnement, salaire… crée une récurrence.',
        checked: f.repeat,
        name: 'repeat',
        onChange: (value) => {
          f.repeat = value;
          touch();
          render();
        },
      });
      block.appendChild(repeat.el);
      if (f.repeat) {
        fields.frequency = selectField({
          label: 'Fréquence',
          value: f.frequency,
          options: FREQUENCIES.map((x) => ({ value: x.id, label: x.every })),
          onChange: (value) => {
            f.frequency = value;
            touch();
            render();
          },
        });
        const unit = FREQUENCIES.find((x) => x.id === f.frequency);
        fields.interval = selectField({
          label: 'Intervalle',
          value: String(f.interval),
          options: [1, 2, 3, 4, 6, 12].map((n) => ({ value: String(n), label: n === 1 ? unit.every : frequencyLabel(f.frequency, n) })),
          onChange: (value) => {
            f.interval = Number(value);
            touch();
          },
        });
        fields.endDate = dateField({
          label: 'Jusqu\'au',
          value: f.endDate,
          optional: true,
          onChange: (value) => {
            f.endDate = value;
            touch();
          },
        });
        block.appendChild(h('div.field-row', fields.interval.el, fields.endDate.el));
        block.appendChild(h('p.hint', 'La date ci-dessus est celle de la première échéance.'));
      }
    }
    return block;
  }

  function renderOperation() {
    const isExpense = f.mode === 'expense';
    const labels = [];
    const parties = [];
    const seenL = new Set();
    const seenP = new Set();
    for (let i = app.state.operations.length - 1; i >= 0 && (labels.length < 60 || parties.length < 60); i--) {
      const op = app.state.operations[i];
      if (op.kind !== KIND.OPERATION) continue;
      if (op.label && !seenL.has(op.label)) {
        seenL.add(op.label);
        labels.push(op.label);
      }
      if (op.counterparty && !seenP.has(op.counterparty)) {
        seenP.add(op.counterparty);
        parties.push(op.counterparty);
      }
    }

    fields.label = textField({
      label: 'Libellé',
      value: f.label,
      name: 'label',
      placeholder: isExpense ? 'Courses, restaurant, essence…' : 'Salaire, remboursement…',
      suggestions: labels,
      onInput: (value) => {
        f.label = value;
        touch();
      },
    });
    body.appendChild(fields.label.el);
    body.appendChild(dateTimeRow());
    dateHint = h('p.hint', { hidden: true }, 'Datée dans le futur : elle comptera dans le solde à partir de ce jour-là.');
    body.appendChild(dateHint);
    updateDateHint();

    // --- tiers, avec rappel des habitudes ---
    const habit = h('div', { hidden: true });
    const showHabit = () => {
      clear(habit);
      habit.hidden = true;
      if (!f.counterparty.trim() || f.tags.length || f.importance) return;
      const hint = suggestFor(app.state, { counterparty: f.counterparty });
      if (!hint) return;
      const partsList = [];
      if (hint.label && !f.label.trim()) partsList.push(hint.label);
      for (const tagId of hint.tags) partsList.push(app.state.tags.find((t) => t.id === tagId)?.name);
      const importance = IMPORTANCE.find((i) => i.id === hint.importance);
      if (importance && isExpense) partsList.push(importance.label);
      const text = partsList.filter(Boolean).join(', ');
      if (!text) return;
      habit.hidden = false;
      habit.appendChild(
        h(
          'div.notice',
          icon('wand'),
          h('div.grow', `Comme d'habitude : ${text}`),
          h(
            'button.link-btn',
            {
              type: 'button',
              dataset: { action: 'apply-habit' },
              onclick: () => {
                syncTyped();
                if (hint.label && !f.label.trim()) f.label = hint.label;
                f.tags = [...hint.tags];
                if (isExpense) {
                  f.importance = hint.importance;
                  if (hint.envelopeId && !f.envelopeId) f.envelopeId = hint.envelopeId;
                }
                touch();
                render({ sync: false });
              },
            },
            'Reprendre',
          ),
        ),
      );
    };
    fields.counterparty = textField({
      label: isExpense ? 'Destinataire' : 'Émetteur',
      value: f.counterparty,
      optional: true,
      name: 'counterparty',
      placeholder: isExpense ? 'Commerçant, personne…' : 'Employeur, personne…',
      suggestions: parties,
      autocapitalize: 'words',
      onInput: (value) => {
        f.counterparty = value;
        touch();
        showHabit();
      },
    });
    body.appendChild(fields.counterparty.el);
    body.appendChild(habit);
    showHabit();

    // --- compte ---
    if (isExpense) {
      fields.envelopeId = selectField({
        label: 'Payé avec',
        value: f.envelopeId,
        name: 'envelopeId',
        options: [{ value: '', label: 'Compte courant' }, ...envelopeOptions(existing?.envelopeId)],
        onChange: (value) => {
          f.envelopeId = value;
          touch();
        },
      });
      if (app.state.envelopes.length) body.appendChild(fields.envelopeId.el);
    } else if (!existing && !f.simulated && !f.repeat && app.state.envelopes.some((e) => !e.closed)) {
      fields.thenEnvelopeId = selectField({
        label: 'Ensuite',
        value: f.thenEnvelopeId,
        name: 'thenEnvelopeId',
        hint: 'Une entrée arrive toujours sur le compte courant ; tu peux aussitôt en mettre le montant dans une enveloppe.',
        options: [{ value: '', label: 'Laisser sur le compte courant' }, ...envelopeOptions(null, { withBalance: false }).map((o) => ({ value: o.value, label: `Alimenter ${o.label}` }))],
        onChange: (value) => {
          f.thenEnvelopeId = value;
          touch();
        },
      });
      body.appendChild(fields.thenEnvelopeId.el);
    }

    // --- importance ---
    if (isExpense) {
      const importance = pickList({
        label: 'Importance',
        options: IMPORTANCE.map((i) => ({ id: i.id, label: i.label })),
        selected: f.importance ? [f.importance] : [],
        multiple: false,
        onChange: (list) => {
          f.importance = list[0] || null;
          touch();
          showHabit();
        },
      });
      body.appendChild(fieldGroup('Importance', importance.el));
    }

    // --- tags ---
    const newTag = h('button.pick.dashed', { type: 'button', dataset: { action: 'new-tag' } }, icon('plus', 'sm'), 'Nouveau tag');
    const tags = pickList({
      label: 'Tags',
      options: app.state.tags.map((t) => ({ id: t.id, label: t.name, color: t.color })),
      selected: f.tags,
      multiple: true,
      extra: newTag,
      onChange: (list) => {
        f.tags = list;
        touch();
        showHabit();
        updateQuotaHint();
      },
    });
    newTag.addEventListener('click', async () => {
      const tag = await askNewTag(app);
      if (!tag) return;
      f.tags = [...f.tags, tag.id];
      touch();
      render();
    });
    body.appendChild(fieldGroup('Tags', tags.el));
    quotaHost = h('div.stack.tight', { dataset: { block: 'quota-hint' } });
    body.appendChild(quotaHost);
    updateQuotaHint();

    fields.comment = textArea({
      label: 'Commentaire',
      value: f.comment,
      optional: true,
      name: 'comment',
      onInput: (value) => {
        f.comment = value;
        touch();
      },
    });
    body.appendChild(fields.comment.el);

    // --- photos ---
    if (!f.repeat) {
      const photos = h('div.photos');
      for (const fileId of f.photoIds) {
        photos.appendChild(
          photoThumb(app, fileId, {
            onRemove: (removed) => {
              f.photoIds = f.photoIds.filter((x) => x !== removed);
              touch();
              render();
            },
          }),
        );
      }
      const add = async (camera) => {
        const record = await addPhoto(app, { camera, mirrorName: `${f.date || today}-${f.label || 'ticket'}` });
        if (!record) return;
        f.photoIds = [...f.photoIds, record.id];
        f.newFiles = [...f.newFiles, record];
        touch();
        render();
      };
      body.appendChild(
        fieldGroup(
          'Photo du ticket',
          f.photoIds.length ? photos : null,
          h(
            'div.btn-row',
            h('button.btn.small', { type: 'button', dataset: { action: 'photo-camera' }, onclick: () => add(true) }, icon('camera'), 'Prendre une photo'),
            h('button.btn.small', { type: 'button', dataset: { action: 'photo-gallery' }, onclick: () => add(false) }, icon('image'), 'Galerie'),
          ),
        ),
      );
    }

    body.appendChild(optionsBlock({ allowRepeat: true }));
    renderExtras();
  }

  function renderTransfer() {
    const accounts = (currentId) => [{ value: '', label: 'Compte courant' }, ...envelopeOptions(currentId)];
    if (!app.state.envelopes.length) {
      body.appendChild(h('div.notice.warn', icon('alert'), h('div.grow', "Ce mouvement met de l'argent de côté dans une enveloppe, ou l'en retire. Crée d'abord une enveloppe (onglet Enveloppes).")));
    }
    fields.from = selectField({
      label: 'De',
      value: f.from,
      name: 'from',
      options: accounts(existing?.from),
      onChange: (value) => {
        f.from = value;
        sheet.setTitle(titleFor());
        touch();
      },
    });
    fields.to = selectField({
      label: 'Vers',
      value: f.to,
      name: 'to',
      options: accounts(existing?.to),
      onChange: (value) => {
        f.to = value;
        sheet.setTitle(titleFor());
        touch();
      },
    });
    const swap = h(
      'button.icon-btn',
      {
        type: 'button',
        'aria-label': 'Inverser le sens',
        style: { alignSelf: 'flex-end', flex: 'none' },
        onclick: () => {
          [f.from, f.to] = [f.to, f.from];
          sheet.setTitle(titleFor());
          touch();
          render();
        },
      },
      icon('transfer'),
    );
    body.appendChild(h('div.field-row', fields.from.el, swap, fields.to.el));
    body.appendChild(dateTimeRow());
    dateHint = null;
    fields.label = textField({
      label: 'Motif',
      value: f.label,
      optional: !f.repeat,
      name: 'label',
      placeholder: 'Épargne du mois, cadeau…',
      onInput: (value) => {
        f.label = value;
        touch();
      },
    });
    body.appendChild(fields.label.el);
    fields.comment = textArea({
      label: 'Commentaire',
      value: f.comment,
      optional: true,
      name: 'comment',
      rows: 2,
      onInput: (value) => {
        f.comment = value;
        touch();
      },
    });
    body.appendChild(fields.comment.el);
    body.appendChild(optionsBlock({ allowRepeat: true }));
    renderExtras();
  }

  function renderAdjustment() {
    body.appendChild(
      h(
        'div.notice',
        icon('info'),
        h(
          'div.grow',
          existing.auto === 'opening'
            ? "C'est le solde de ton compte au moment où tu as commencé à utiliser l'appli."
            : "Un ajustement corrige l'écart entre l'appli et la banque, sans correspondre à une vraie sortie ni à une vraie entrée.",
        ),
      ),
    );
    fields.label = textField({
      label: 'Libellé',
      value: f.label,
      name: 'label',
      onInput: (value) => {
        f.label = value;
        touch();
      },
    });
    body.appendChild(fields.label.el);
    fields.date = dateField({
      label: 'Date',
      value: f.date,
      name: 'date',
      onChange: (value) => {
        f.date = value;
        touch();
      },
    });
    body.appendChild(fields.date.el);
    fields.comment = textArea({
      label: 'Commentaire',
      value: f.comment,
      optional: true,
      name: 'comment',
      rows: 2,
      onInput: (value) => {
        f.comment = value;
        touch();
      },
    });
    body.appendChild(fields.comment.el);
  }

  /** Informations et actions propres à une opération existante. */
  function renderExtras() {
    if (!existing) return;
    const extras = h('div.stack');
    if (existing.simulated) {
      extras.appendChild(
        h('button.btn.block', { type: 'button', dataset: { action: 'confirm-simulation' }, onclick: () => confirmSimulation() }, icon('check'), 'Elle a eu lieu : la rendre réelle'),
      );
    }
    if (rule) {
      extras.appendChild(
        h(
          'div.notice',
          icon('repeat'),
          h('div.grow', `Échéance de la récurrence « ${rule.label} ». Tu ne modifies ici que cette échéance.`),
          h(
            'button.link-btn',
            {
              type: 'button',
              onclick: async () => {
                sheet.close();
                const { openRecurringForm } = await import('./recurring.js');
                openRecurringForm(app, { id: rule.id });
              },
            },
            'Voir la récurrence',
          ),
        ),
      );
    }
    if (existing.bank) {
      extras.appendChild(
        h(
          'div.card.stack.tight',
          h('div.rowline', h('span.chip.good', icon('checks', 'sm'), 'Pointée'), h('span.hint', `Débitée par la banque le ${formatDate(existing.bank.date)}`)),
          h('div.small', existing.bank.label),
          existing.bank.details.length ? h('div.hint', existing.bank.details.join(' | ')) : null,
        ),
      );
    }
    if (existing.kind === KIND.OPERATION) {
      extras.appendChild(
        h(
          'button.btn.quiet.block',
          {
            type: 'button',
            dataset: { action: 'duplicate' },
            onclick: () => {
              const copy = { ...f, date: today, time: nowTime(), photoIds: [], newFiles: [], simulated: false };
              sheet.close();
              openOperationForm(app, { preset: copy });
            },
          },
          icon('copy'),
          'Dupliquer à la date d\'aujourd\'hui',
        ),
      );
    }
    if (extras.childNodes.length) body.appendChild(extras);
  }

  // ------------------------------------------------------------------------------------------

  function readAmount() {
    const cents = fields.amount.cents;
    if (cents === null || cents === 0) {
      fields.amount.setError(fields.amount.isEmpty ? 'Indique un montant.' : 'Montant illisible. Exemple : 12,50');
      fields.amount.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      fields.amount.focus();
      return null;
    }
    return cents;
  }

  function showErrors(errors) {
    let placed = false;
    for (const error of errors) {
      if (!placed && setError(error.field, error.message)) placed = true;
    }
    if (!placed) app.fail(errors[0].message);
  }

  const confirmTopups = (topups) => askTopups(app, topups);

  function finish(label) {
    saved = true;
    persistDraft.cancel();
    if (useDraft) app.setSetting(DRAFT_KEY, undefined, { silent: true }).catch(() => {});
    sheet.close(true);
    return label;
  }

  let busy = false;
  async function save() {
    if (busy) return;
    busy = true;
    try {
      await doSave();
    } catch (error) {
      app.reportError(error, 'formulaire opération');
    } finally {
      busy = false;
    }
  }

  async function doSave() {
    syncTyped();
    const cents = readAmount();
    if (cents === null) return;
    const state = app.state;

    if (f.repeat && !existing) {
      const isTransfer = f.mode === 'transfer';
      const input = {
        kind: isTransfer ? KIND.TRANSFER : KIND.OPERATION,
        label: f.label.trim() || (isTransfer ? '' : f.counterparty.trim()),
        amount: isTransfer ? cents : f.mode === 'expense' ? -cents : cents,
        frequency: f.frequency,
        interval: f.interval,
        startDate: f.date,
        endDate: f.endDate,
        envelopeId: f.mode === 'expense' ? f.envelopeId || null : null,
        from: isTransfer ? f.from || null : null,
        to: isTransfer ? f.to || null : null,
        tags: f.tags,
        importance: f.mode === 'expense' ? f.importance : null,
        counterparty: f.counterparty,
        comment: f.comment,
      };
      let backfill = true;
      const past = f.date ? countBackfill(input, today) : 0;
      if (past > 1) {
        const choice = await chooseDialog({
          title: 'Échéances déjà passées',
          message: `La première échéance est le ${formatDate(f.date)} : ${plural(past, 'échéance est déjà passée', 'échéances sont déjà passées')}.`,
          options: [
            { id: 'all', label: `Les enregistrer aussi (${past})`, primary: true },
            { id: 'future', label: "Commencer à partir d'aujourd'hui" },
          ],
        });
        if (!choice) return;
        backfill = choice === 'all';
      }
      const plan = planSaveRecurring(state, input, { today, backfill });
      if (!plan.ok) {
        showErrors(plan.errors.map((e) => (e.field === 'startDate' ? { ...e, field: 'date' } : e)));
        return;
      }
      if (await app.commit(plan.cs, { label: 'Récurrence créée' })) finish();
      return;
    }

    if (f.mode === 'transfer') {
      const plan = planSaveTransfer(
        state,
        { id: existing?.id, amount: cents, date: f.date, time: f.time, from: f.from || null, to: f.to || null, label: f.label, comment: f.comment, simulated: f.simulated, checked: existing?.checked ?? true },
        { today },
      );
      if (!plan.ok) {
        showErrors(plan.errors);
        return;
      }
      if (await app.commit(plan.cs, { label: existing ? 'Mouvement modifié' : moveDoneLabel(f.from, f.to) })) finish();
      return;
    }

    if (f.mode === 'adjustment') {
      const plan = planSaveAdjustment(state, { id: existing.id, date: f.date, amount: f.positive ? cents : -cents, label: f.label, comment: f.comment });
      if (!plan.ok) {
        showErrors(plan.errors);
        return;
      }
      if (await app.commit(plan.cs, { label: 'Ajustement modifié' })) finish();
      return;
    }

    const input = {
      id: existing?.id,
      date: f.date,
      time: f.time,
      amount: f.mode === 'expense' ? -cents : cents,
      label: f.label,
      counterparty: f.counterparty,
      comment: f.comment,
      importance: f.mode === 'expense' ? f.importance : null,
      tags: f.tags,
      envelopeId: f.mode === 'expense' ? f.envelopeId || null : null,
      simulated: f.simulated,
      checked: existing?.checked ?? true,
      photoIds: f.photoIds,
    };
    const viaEnvelope = f.mode === 'income' && !existing && !f.simulated && f.thenEnvelopeId;
    const plan = viaEnvelope ? planCreditThenTransfer(state, { ...input, envelopeId: f.thenEnvelopeId }, { today }) : planSaveOperation(state, input, { today });
    if (!plan.ok) {
      showErrors(plan.errors);
      return;
    }
    if (plan.topups && plan.topups.length) {
      if (!(await confirmTopups(plan.topups))) return;
      merge(plan.cs, topupChangeset(state, plan.topups));
    }
    const used = new Set(f.photoIds);
    const records = f.newFiles.filter((file) => used.has(file.id) && !state.files.some((x) => x.id === file.id));
    if (records.length) put(plan.cs, 'files', ...records);
    if (!plan.op.simulated) {
      const learner = new Draft(state);
      learnInto(learner, plan.op);
      merge(plan.cs, learner.cs);
    }
    if (await app.commit(plan.cs, { label: existing ? 'Opération modifiée' : 'Opération ajoutée' })) finish();
  }

  async function remove() {
    const plan = planDeleteOperations(app.state, [existing.id], { today });
    if (!plan.ok) {
      app.fail(plan.errors[0].message);
      return;
    }
    const label = existing.kind === KIND.TRANSFER ? 'Mouvement supprimé' : 'Opération supprimée';
    if (await app.commit(plan.cs, { label })) finish();
  }

  async function confirmSimulation() {
    const plan = planConfirmSimulation(app.state, existing.id, { today });
    if (!plan.ok) {
      app.fail(plan.errors[0].message);
      return;
    }
    if (plan.topups.length) {
      if (!(await confirmTopups(plan.topups))) return;
      merge(plan.cs, topupChangeset(app.state, plan.topups));
    }
    if (await app.commit(plan.cs, { label: 'Prévision confirmée' })) finish();
  }

  render();
  return sheet.closed.then((value) => !!value);
}
