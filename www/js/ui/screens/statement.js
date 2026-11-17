// Assistant d'import de relevé bancaire.
//
// Déroulé :
//   1. choisir le fichier (PDF, OFX ou CSV) → lecture + vérification avec les soldes imprimés ;
//   2. CORRESPONDANCES : les lignes du relevé qui ressemblent à une opération déjà saisie (même
//      montant, date proche) ; la fusion garde ce que tu as saisi et complète les champs vides ;
//   3. À AJOUTER : les lignes absentes de l'appli, pré-remplies (tiers, date réelle, tags habituels) ;
//   4. ABSENTES DU RELEVÉ : les opérations de l'appli que la banque n'a pas (encore) ;
//   5. BILAN : soldes avant / après, écarts, puis validation — en un seul bloc, annulable.
//
// Rien n'est modifié avant le bouton « Valider l'import ». L'avancement est gardé en brouillon :
// on peut quitter l'assistant et le reprendre plus tard.

import { h, clear, plural, amount } from '../dom.js';
import { icon } from '../icons.js';
import { subTopbar } from '../shell.js';
import { chooseDialog, confirmDialog, openSheet, infoButton } from '../overlays.js';
import { textField, textArea, dateField, selectField, pickList, toggle, fieldGroup } from '../fields.js';
import { askNewTag } from '../forms/tag.js';
import { IMPORTANCE, KIND, importanceLabel } from '../../core/schema.js';
import { matchStatement, proposeForLine, mergePreview, planStatementImport, isHistoryImport, findSameStatement, referenceDate, statementPeriod, startsHistory } from '../../core/matching.js';
import { operationTitle } from '../../core/operations.js';
import { openingOperation } from '../../core/reconciliation.js';
import { emptyFilter } from '../../core/filters.js';
import { partyKey } from '../../core/text.js';
import { formatAmount } from '../../core/money.js';
import { addDays, daysBetween, formatDate } from '../../core/dates.js';
import { readStatementFile, StatementError } from '../../io/statement/index.js';
import { loadPdfJs, extractPages } from '../../io/statement/pdf.js';
import { pickFile } from '../../platform/platform.js';
import { mirrorFile, extensionFor } from '../../data/backup.js';

const DRAFT_KEY = 'draft:statement';
const EXAMPLE_URL = 'exemples/releve-exemple.pdf';
const KIND_LABELS = { card: 'Carte', 'transfer-in': 'Virement reçu', 'transfer-out': 'Virement émis', debit: 'Prélèvement', fee: 'Frais', other: '' };
const STEP_TITLES = { overview: 'Relevé lu', matches: 'Correspondances', missing: 'À ajouter', extras: 'Absentes du relevé', summary: 'Bilan' };

function blank() {
  return { step: 'pick', statement: null, file: null, fileName: '', rejected: [], confirmed: [], manual: {}, fields: {}, skipped: [], extraDelete: [], opening: true, closing: true, keepCurrent: null, learn: true };
}

function isFree(op) {
  return !!op && !op.simulated && op.kind === KIND.OPERATION && !op.bank;
}

function base64ToBytes(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function createStatementScreen(app) {
  let w = blank();
  const saved = app.setting(DRAFT_KEY);
  if (saved && saved.statement && Array.isArray(saved.statement.lines)) w = { ...blank(), ...saved };
  let busy = false;
  let lastSummary = null;
  let showSure = false;

  const abandon = h('button.btn.quiet.small', { type: 'button', dataset: { action: 'abandon' }, hidden: true }, 'Abandonner');
  const top = subTopbar(app, 'Importer un relevé', abandon);
  const stepsBar = h('div.steps', { hidden: true });
  const content = h('div.pad.stack.loose');
  const scroll = h('main.scroll', content, h('div.bottom-space'));
  const foot = h('footer.wizard-foot', { hidden: true });
  const el = h('section.screen', { dataset: { screen: 'statement' } }, top.el, stepsBar, scroll, foot);

  function persist() {
    const value = w.statement && w.step !== 'done' ? w : undefined;
    app.setSetting(DRAFT_KEY, value, { silent: true }).catch(() => {});
  }

  // -------------------------------------------------------------------------------------------
  // Modèle : ce que deviennent les lignes du relevé, d'après les données et les choix en cours
  // -------------------------------------------------------------------------------------------

  function model() {
    const st = w.statement;
    const base = matchStatement(app.state, st);
    const ops = new Map(app.state.operations.map((o) => [o.id, o]));
    const lineById = new Map(st.lines.map((l) => [l.id, l]));
    const already = new Set(base.already);
    const usedOps = new Set();
    const merges = new Map(); // identifiant de ligne → { opId, manual, sure, gap }
    for (const [lineId, opId] of Object.entries(w.manual)) {
      const line = lineById.get(lineId);
      const op = ops.get(opId);
      if (!line || already.has(lineId) || !isFree(op) || usedOps.has(opId)) continue;
      merges.set(lineId, { opId, manual: true, sure: true, gap: Math.abs(daysBetween(op.date, referenceDate(line))) });
      usedOps.add(opId);
    }
    for (const m of base.matches) {
      if (merges.has(m.lineId) || w.rejected.includes(m.lineId) || usedOps.has(m.opId)) continue;
      merges.set(m.lineId, { opId: m.opId, manual: false, sure: m.sure, gap: m.gap });
      usedOps.add(m.opId);
    }
    const toCreate = st.lines.filter((l) => !already.has(l.id) && !merges.has(l.id));
    const { start, end } = statementPeriod(st);
    const extras = app.state.operations
      .filter((op) => isFree(op) && !usedOps.has(op.id) && op.date >= start && op.date <= end)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const toCheck = [...merges.entries()].filter(([lineId, m]) => !m.sure && !w.confirmed.includes(lineId)).map(([lineId]) => lineId);
    return { st, base, ops, lineById, already, merges, usedOps, toCreate, extras, toCheck, start, end };
  }

  function fieldsFor(line) {
    return w.fields[line.id] || proposeForLine(app.state, line);
  }

  function decisionsFrom(m) {
    const lines = {};
    for (const line of m.st.lines) {
      if (m.already.has(line.id)) lines[line.id] = { action: 'already' };
      else if (m.merges.has(line.id)) lines[line.id] = { action: 'merge', opId: m.merges.get(line.id).opId };
      else if (w.skipped.includes(line.id)) lines[line.id] = { action: 'skip' };
      else lines[line.id] = { action: 'create', fields: fieldsFor(line) };
    }
    const extras = {};
    for (const op of m.extras) extras[op.id] = w.extraDelete.includes(op.id) ? 'delete' : 'keep';
    return {
      lines,
      extras,
      opening: w.opening ? 'adjust' : 'ignore',
      closing: w.closing ? 'adjust' : 'ignore',
      keepCurrent: w.keepCurrent === null ? isHistoryImport(app.state, m.st) : w.keepCurrent,
      learn: w.learn,
    };
  }

  function stepsFor(m) {
    const list = ['overview'];
    if (m.merges.size || w.rejected.length) list.push('matches');
    if (m.toCreate.length) list.push('missing');
    if (m.extras.length) list.push('extras');
    list.push('summary');
    return list;
  }

  function go(step) {
    w.step = step;
    persist();
    render();
    scroll.scrollTop = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Étape 1 : choisir et lire le fichier
  // -------------------------------------------------------------------------------------------

  async function readFile({ name, bytes, mime = '' }) {
    if (busy) return;
    busy = true;
    render();
    try {
      const statement = await readStatementFile({ name, bytes }, { loadPdfJs, extractPages });
      const twin = findSameStatement(app.state, statement);
      if (twin) {
        busy = false;
        render();
        const choice = await chooseDialog({
          title: 'Relevé déjà importé',
          message: `Ce relevé (${periodText(statement)}) a déjà été importé le ${formatDate(twin.importedAt.slice(0, 10))}. L'importer une seconde fois créerait des doublons.`,
          options: [{ id: 'archives', label: 'Voir les relevés archivés', primary: true }],
          cancelLabel: 'Fermer',
        });
        if (choice === 'archives') {
          app.close();
          app.open('archives');
        }
        return;
      }
      const type = statement.format === 'pdf' ? 'application/pdf' : statement.format === 'csv' ? 'text/csv' : mime || 'application/octet-stream';
      const file = await app.store.saveBlob(bytes, { kind: 'statement', name, mime: type });
      w = { ...blank(), step: 'overview', statement, file, fileName: name };
      persist();
    } catch (error) {
      if (!(error instanceof StatementError)) app.reportError(error, 'lecture du relevé');
      w.readError = error instanceof StatementError ? error.message : "Ce fichier n'a pas pu être lu. S'il vient bien de ta banque, signale-le depuis Plus › Signaler un bug.";
    } finally {
      busy = false;
      render();
    }
  }

  async function chooseFile() {
    w.readError = '';
    const picked = await pickFile({ accept: '' });
    if (picked) await readFile(picked);
  }

  async function loadExample() {
    w.readError = '';
    try {
      let bytes;
      if (typeof window.__MON_BUDGET_EXEMPLE_PDF__ === 'string') bytes = base64ToBytes(window.__MON_BUDGET_EXEMPLE_PDF__);
      else {
        const response = await fetch(EXAMPLE_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      await readFile({ name: 'releve-exemple.pdf', bytes, mime: 'application/pdf' });
    } catch {
      w.readError = "Le relevé d'exemple n'est pas disponible ici.";
      render();
    }
  }

  function renderPick() {
    if (busy) {
      content.appendChild(h('div.empty', h('div.empty-mark', icon('file', 'lg')), h('h2', 'Lecture du relevé…'), h('p', 'Le fichier est lu sur ton téléphone, il ne part nulle part.')));
      return;
    }
    content.appendChild(
      h(
        'div.notice',
        icon('bank'),
        h('div.grow', "Télécharge ton relevé de compte depuis le site ou l'appli de ta banque, puis choisis-le ici. L'appli le compare à tes opérations, complète ce qui manque et vérifie les soldes."),
      ),
    );
    if (w.readError) content.appendChild(h('div.notice.bad', { role: 'alert' }, icon('alert'), h('div.grow', w.readError)));
    content.appendChild(
      h(
        'div.card.stack',
        h('button.btn.primary.block', { type: 'button', dataset: { action: 'choose-file' }, onclick: chooseFile }, icon('upload'), 'Choisir le fichier du relevé'),
        h('p.hint', 'Formats lus : PDF (relevé officiel), OFX ou CSV (export « Excel » ou « Money » proposé par la plupart des banques).'),
        h('button.btn.quiet.block', { type: 'button', dataset: { action: 'example' }, onclick: loadExample }, "Essayer avec un relevé d'exemple"),
      ),
    );
    content.appendChild(
      h(
        'div.card.stack.tight',
        h('h2', 'Bon à savoir'),
        h('p.note', "Le PDF a été mis au point sur les relevés de la Société Générale. Les autres banques qui présentent leurs relevés en colonnes Date / Libellé / Débit / Crédit sont lues de la même façon ; sinon, utilise l'export OFX ou CSV de ta banque."),
        h('p.note', "Rien n'est modifié tant que tu n'as pas validé la dernière étape, et l'import entier s'annule d'un seul geste."),
      ),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Étape 2 : ce qui a été lu
  // -------------------------------------------------------------------------------------------

  function periodText(st) {
    const { start, end } = statementPeriod(st);
    return start && end ? `du ${formatDate(start)} au ${formatDate(end)}` : 'période inconnue';
  }

  function kv(key, value, name = null) {
    return h('div.kv', h('span.k', key), h('span.v.num', { dataset: { value: name } }, value));
  }

  function renderOverview(m) {
    const st = m.st;
    const checks = st.checks || {};
    const formatName = st.format === 'pdf' ? 'PDF' : st.format === 'ofx' ? 'OFX' : 'CSV';
    content.appendChild(
      h(
        'div.card.stack.tight',
        h('h2', st.bank || 'Relevé bancaire'),
        h('p.note', [st.accountLabel, `Période ${periodText(st)}`, `fichier ${formatName}`].filter(Boolean).join(', ')),
        h(
          'div',
          { style: { marginTop: '6px' } },
          kv('Opérations lues', String(st.lines.length), 'line-count'),
          st.openingBalance === null ? null : kv('Solde précédent', formatAmount(st.openingBalance), 'opening'),
          kv('Total des débits', formatAmount(-st.totalDebit), 'total-debit'),
          kv('Total des crédits', formatAmount(st.totalCredit, { sign: 'always' }), 'total-credit'),
          st.closingBalance === null ? null : kv('Nouveau solde', formatAmount(st.closingBalance), 'closing'),
        ),
      ),
    );

    if (checks.balance === 'ok') {
      content.appendChild(h('div.notice.good', { dataset: { check: 'ok' } }, icon('checks'), h('div.grow', 'Lecture vérifiée : solde précédent, débits et crédits retombent exactement sur le nouveau solde imprimé par la banque.')));
    } else if (checks.balance === 'ko' || checks.totals === 'ko') {
      content.appendChild(
        h('div.notice.bad', { dataset: { check: 'ko' }, role: 'alert' }, icon('alert'), h('div.grow', "Attention : les lignes lues ne retombent pas sur les totaux imprimés. Une ligne a pu être mal lue. Tu peux continuer, mais vérifie le bilan à la fin, et signale ce relevé pour qu'on corrige la lecture.")),
      );
    } else {
      content.appendChild(h('div.notice.warn', { dataset: { check: 'absent' } }, icon('info'), h('div.grow', "Ce fichier n'indique pas de solde : la lecture ne peut pas être vérifiée automatiquement. Compare le nombre d'opérations avec ton relevé.")));
    }
    for (const warning of st.warnings || []) content.appendChild(h('div.notice.warn', icon('alert'), h('div.grow', warning)));

    const sure = [...m.merges.values()].filter((x) => x.sure).length;
    const unsure = m.merges.size - sure;
    const rows = [];
    if (m.merges.size) rows.push(kv('Déjà dans l\'appli (à fusionner)', unsure ? `${m.merges.size}, dont ${unsure} à vérifier` : String(m.merges.size), 'count-matches'));
    rows.push(kv('À ajouter dans l\'appli', String(m.toCreate.length), 'count-missing'));
    if (m.already.size) rows.push(kv('Déjà importées auparavant', String(m.already.size), 'count-already'));
    if (m.extras.length) rows.push(kv('Dans l\'appli mais pas sur le relevé', String(m.extras.length), 'count-extras'));
    content.appendChild(h('div.card.stack.tight', h('h2', 'Comparaison avec tes opérations'), h('div', rows)));

    if (isHistoryImport(app.state, st)) {
      const anchor = openingOperation(app.state);
      content.appendChild(
        h('div.notice', icon('clock'), h('div.grow', `Ce relevé est antérieur à ton solde de départ (${formatDate(anchor.date)}) : il enrichit ton historique, sans changer ton solde d'aujourd'hui. Tu pourras le confirmer au bilan.`)),
      );
    }
    setFoot(h('button.btn.primary.block', { type: 'button', dataset: { action: 'next' }, onclick: next }, 'Commencer la revue'));
  }

  // -------------------------------------------------------------------------------------------
  // Étape 3 : correspondances
  // -------------------------------------------------------------------------------------------

  function lineSide(line) {
    const real = referenceDate(line);
    const when = real !== line.date ? `${formatDate(real)}, débité le ${formatDate(line.date)}` : formatDate(line.date);
    return h(
      'div.side-row',
      h('span.who', 'Banque'),
      h('span.what', h('b', line.suggestedLabel || line.label), h('span', when), h('span', line.label)),
      amount(line.amount, { sign: 'always', colored: true }),
    );
  }

  function opSide(op, line = null) {
    const tags = op.tags.map((id) => app.state.tags.find((t) => t.id === id)?.name).filter(Boolean);
    const env = op.envelopeId ? app.state.envelopes.find((e) => e.id === op.envelopeId)?.name : '';
    const details = [formatDate(op.date), op.counterparty, env, ...tags].filter(Boolean).join(', ');
    const added = line ? mergePreview(op, line) : [];
    const gain = added.map((a) => (a.field === 'amount' ? `montant corrigé en ${formatAmount(a.value, { sign: 'always' })}` : `${a.label.toLowerCase()} ${a.value}`)).join(', ');
    return h(
      'div.side-row',
      h('span.who', 'Appli'),
      h('span.what', h('b', operationTitle(app.state, op)), h('span', details), gain ? h('span.wrap', { dataset: { gain: 'true' } }, `Le relevé ajoute : ${gain}`) : null),
      line && op.amount !== line.amount ? amount(op.amount, { sign: 'always', extra: 'quiet' }) : null,
    );
  }

  function reject(lineId) {
    w.rejected = [...new Set([...w.rejected, lineId])];
    w.confirmed = w.confirmed.filter((id) => id !== lineId);
    delete w.manual[lineId];
    persist();
    render();
  }

  function matchCard(m, line, info) {
    const op = m.ops.get(info.opId);
    const needsAnswer = !info.sure && !w.confirmed.includes(line.id);
    let status;
    if (info.manual) status = h('span.chip.plain', 'Associée à la main');
    else if (info.sure) status = h('span.chip.good', 'Même montant, même date');
    else status = h('span', { class: needsAnswer ? 'chip warn' : 'chip good' }, needsAnswer ? `À vérifier : ${plural(info.gap, 'jour')} d'écart` : 'Confirmée');
    const actions = needsAnswer
      ? h(
          'span.rowline',
          h('button.btn.small', { type: 'button', dataset: { action: 'reject' }, onclick: () => reject(line.id) }, 'Non'),
          h(
            'button.btn.small.primary',
            {
              type: 'button',
              dataset: { action: 'confirm' },
              onclick: () => {
                w.confirmed = [...w.confirmed, line.id];
                persist();
                render();
              },
            },
            'Oui, la même',
          ),
        )
      : h('button.btn.small.quiet', { type: 'button', dataset: { action: 'reject' }, onclick: () => reject(line.id) }, 'Séparer');
    return h('div.pair', { dataset: { line: line.id, state: needsAnswer ? 'to-check' : 'accepted' } }, lineSide(line), opSide(op, line), h('div.foot', status, actions));
  }

  function renderMatches(m) {
    const entries = m.st.lines
      .filter((l) => m.merges.has(l.id))
      .map((l, i) => ({ l, i, date: referenceDate(l) }))
      .sort((a, b) => (a.date === b.date ? a.i - b.i : a.date < b.date ? -1 : 1))
      .map(({ l }) => [l, m.merges.get(l.id)]);
    const toCheck = entries.filter(([l, info]) => !info.sure && !w.confirmed.includes(l.id));
    const settled = entries.filter(([l, info]) => info.sure || w.confirmed.includes(l.id));
    content.appendChild(
      h('p.note', "Ces lignes du relevé correspondent à des opérations que tu as déjà saisies. La fusion garde tout ce que tu as écrit (libellé, tags, enveloppe, photo) et complète les champs vides avec ceux de la banque."),
    );
    if (toCheck.length) {
      content.appendChild(
        h(
          'div.rowline.between',
          h('h2.section-title', `À vérifier (${toCheck.length})`),
          h(
            'button.btn.small',
            {
              type: 'button',
              dataset: { action: 'confirm-all' },
              onclick: () => {
                w.confirmed = [...new Set([...w.confirmed, ...toCheck.map(([l]) => l.id)])];
                persist();
                render();
              },
            },
            'Tout confirmer',
          ),
        ),
      );
      content.appendChild(h('div.stack', toCheck.map(([line, info]) => matchCard(m, line, info))));
    }
    if (settled.length) {
      const open = showSure || !toCheck.length || settled.length <= 3;
      content.appendChild(
        h(
          'div.rowline.between',
          h('h2.section-title', `${toCheck.length ? 'Sûres ou confirmées' : 'Correspondances'} (${settled.length})`),
          settled.length > 3 && toCheck.length
            ? h(
                'button.btn.small.quiet',
                {
                  type: 'button',
                  dataset: { action: 'toggle-sure' },
                  onclick: () => {
                    showSure = !showSure;
                    render();
                  },
                },
                open ? 'Replier' : 'Afficher',
              )
            : null,
        ),
      );
      if (open) content.appendChild(h('div.stack', settled.map(([line, info]) => matchCard(m, line, info))));
    }
    if (w.rejected.length) {
      content.appendChild(
        h(
          'button.btn.quiet.block',
          {
            type: 'button',
            dataset: { action: 'restore-rejected' },
            onclick: () => {
              w.rejected = [];
              persist();
              render();
            },
          },
          `Rétablir ${plural(w.rejected.length, 'correspondance séparée', 'correspondances séparées')}`,
        ),
      );
    }
    setFoot(
      h(
        'button.btn.primary.block',
        {
          type: 'button',
          dataset: { action: 'next' },
          onclick: () => {
            if (toCheck.length) {
              app.fail(`Il reste ${plural(toCheck.length, 'correspondance')} à vérifier : réponds Oui ou Non.`);
              const first = content.querySelector('[data-state="to-check"]');
              if (first) first.scrollIntoView({ block: 'center' });
              return;
            }
            next();
          },
        },
        'Continuer',
      ),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Étape 4 : lignes à ajouter
  // -------------------------------------------------------------------------------------------

  function lineChips(line, fields) {
    const chips = [];
    if (fields.envelopeId) {
      const env = app.state.envelopes.find((e) => e.id === fields.envelopeId);
      if (env) chips.push(h('span.chip.env', env.name));
    }
    for (const id of (fields.tags || []).slice(0, 2)) {
      const tag = app.state.tags.find((t) => t.id === id);
      if (tag) chips.push(h('span', { class: `chip k-${tag.color}` }, h('span.dot'), tag.name));
    }
    if ((fields.tags || []).length > 2) chips.push(h('span.chip.plain', `+${fields.tags.length - 2}`));
    if (fields.importance) chips.push(h('span.chip.plain', importanceLabel(fields.importance)));
    return chips;
  }

  function missingRow(m, line) {
    const fields = fieldsFor(line);
    const skipped = w.skipped.includes(line.id);
    const date = fields.date || referenceDate(line);
    const chips = skipped ? [h('span.chip.plain', 'Ignorée')] : lineChips(line, fields);
    const title = fields.label || line.suggestedLabel || line.label;
    const party = fields.counterparty && partyKey(fields.counterparty) !== partyKey(title) ? fields.counterparty : '';
    return h(
      'button',
      { type: 'button', class: `op-row${skipped ? ' sim unchecked' : ''}`, dataset: { line: line.id, state: skipped ? 'skipped' : 'create' }, onclick: () => editLine(line) },
      h('span.day', h('b', date.slice(8, 10)), h('span', date.slice(5, 7))),
      h('span.main', h('span.title', title), h('span.meta', ...chips, h('span.text', [KIND_LABELS[line.kind], party].filter(Boolean).join(', ')))),
      h('span.side', amount(line.amount, { sign: 'always', colored: true })),
    );
  }

  /** Autres lignes à créer qui concernent le même tiers (pour appliquer les mêmes choix). */
  function siblings(m, line) {
    const key = partyKey(line.counterparty || line.suggestedLabel || line.label);
    if (!key) return [];
    return m.toCreate.filter((other) => other.id !== line.id && other.amount < 0 === line.amount < 0 && partyKey(other.counterparty || other.suggestedLabel || other.label) === key);
  }

  function editLine(line) {
    const m = model();
    const before = fieldsFor(line);
    const f = { ...before, tags: [...(before.tags || [])] };
    const isDebit = line.amount < 0;
    const others = siblings(m, line);
    const skipped = w.skipped.includes(line.id);
    const body = h('div.stack');
    const real = referenceDate(line);

    body.appendChild(
      h(
        'div.card.stack.tight',
        h('div.rowline.between', h('b', line.label), amount(line.amount, { sign: 'always', colored: true })),
        h('p.note', real !== line.date ? `Opération du ${formatDate(real)}${line.time ? ` à ${line.time}` : ''}, passée en banque le ${formatDate(line.date)}` : `Passée en banque le ${formatDate(line.date)}`),
        line.details && line.details.length ? h('p.hint', { style: { whiteSpace: 'pre-wrap' } }, line.details.join('\n')) : null,
      ),
    );

    const label = textField({ label: 'Libellé', value: f.label, name: 'label', maxLength: 80 });
    const counterparty = textField({ label: isDebit ? 'Payé à' : 'Reçu de', value: f.counterparty, name: 'counterparty', optional: true, maxLength: 80 });
    const date = dateField({ label: "Date de l'opération", value: f.date || real, name: 'date', max: addDays(line.date, 3) });
    body.append(label.el, counterparty.el, date.el);

    let envelope = null;
    let importance = null;
    if (isDebit) {
      const openEnvelopes = app.state.envelopes.filter((e) => !e.closed);
      if (openEnvelopes.length) {
        envelope = selectField({
          label: 'Payé avec',
          value: f.envelopeId || '',
          name: 'envelopeId',
          options: [{ value: '', label: 'Compte courant' }, ...openEnvelopes.map((e) => ({ value: e.id, label: `Enveloppe ${e.name}` }))],
        });
        body.appendChild(envelope.el);
      }
      importance = pickList({ label: 'Importance', options: IMPORTANCE.map((i) => ({ id: i.id, label: i.label })), selected: f.importance ? [f.importance] : [], multiple: false });
      body.appendChild(fieldGroup('Importance', importance.el));
    }

    const newTag = h('button.pick.dashed', { type: 'button', dataset: { action: 'new-tag' } }, icon('plus', 'sm'), 'Nouveau tag');
    const tags = pickList({ label: 'Tags', options: app.state.tags.map((t) => ({ id: t.id, label: t.name, color: t.color })), selected: f.tags, multiple: true, extra: newTag });
    newTag.addEventListener('click', async () => {
      const tag = await askNewTag(app);
      if (!tag) return;
      const chosen = [...tags.value, tag.id];
      tags.setOptions(app.state.tags.map((t) => ({ id: t.id, label: t.name, color: t.color })));
      tags.value = chosen;
    });
    body.appendChild(fieldGroup('Tags', tags.el));

    const comment = textArea({ label: 'Commentaire', value: f.comment || '', optional: true, name: 'comment', rows: 2 });
    body.appendChild(comment.el);

    const spread = others.length
      ? toggle({
          label: `Appliquer aussi aux ${plural(others.length, 'autre ligne', 'autres lignes')} du même tiers`,
          hint: `Mêmes tags, importance et enveloppe pour « ${line.counterparty || line.suggestedLabel} ».`,
          checked: true,
          name: 'spread',
        })
      : null;
    if (spread) body.appendChild(spread.el);

    const save = h('button.btn.primary.block', { type: 'button', dataset: { action: 'save-line' } }, 'Valider');
    const skip = h('button.btn.quiet.block', { type: 'button', dataset: { action: 'skip-line' } }, skipped ? 'Ne plus ignorer cette ligne' : 'Ignorer cette ligne');
    const link = h('button.btn.quiet.block', { type: 'button', dataset: { action: 'link-line' } }, 'Associer à une opération déjà saisie');
    body.appendChild(h('div.stack.tight', link, skip));
    const sheet = openSheet({ title: skipped ? 'Ligne ignorée' : 'Ligne à ajouter', body, foot: [save], full: true });

    save.addEventListener('click', () => {
      if (!label.value) {
        label.setError('Donne un libellé à cette opération.');
        label.focus();
        return;
      }
      const updated = {
        ...f,
        label: label.value,
        counterparty: counterparty.value,
        date: date.value || real,
        envelopeId: envelope ? envelope.value || null : null,
        importance: importance ? importance.value[0] || null : null,
        tags: tags.value,
        comment: comment.value,
        hinted: false,
      };
      w.fields[line.id] = updated;
      w.skipped = w.skipped.filter((id) => id !== line.id);
      let spreadCount = 0;
      if (spread && spread.value) {
        for (const other of others) {
          const current = fieldsFor(other);
          // le libellé ne suit que s'il était identique avant la modification
          const sameLabel = current.label === before.label;
          w.fields[other.id] = { ...current, tags: [...updated.tags], importance: updated.importance, envelopeId: updated.envelopeId, label: sameLabel ? updated.label : current.label, hinted: false };
          spreadCount++;
        }
      }
      persist();
      sheet.close(true);
      render();
      if (spreadCount) app.notify(`Appliqué aussi à ${plural(spreadCount, 'autre ligne', 'autres lignes')}`);
    });
    skip.addEventListener('click', () => {
      if (skipped) w.skipped = w.skipped.filter((id) => id !== line.id);
      else w.skipped = [...w.skipped, line.id];
      persist();
      sheet.close(true);
      render();
    });
    link.addEventListener('click', async () => {
      const chosen = await pickOperationFor(line);
      if (!chosen) return;
      w.manual[line.id] = chosen;
      w.skipped = w.skipped.filter((id) => id !== line.id);
      w.rejected = w.rejected.filter((id) => id !== line.id);
      persist();
      sheet.close(true);
      render();
      app.notify('Ligne associée : elle apparaît dans les correspondances');
    });
  }

  /** Fait choisir, parmi les opérations saisies proches de la date, celle que cette ligne représente. */
  async function pickOperationFor(line) {
    const m = model();
    const ref = referenceDate(line);
    const lo = addDays(ref, -31);
    const hi = addDays(line.date, 31);
    const candidates = app.state.operations
      .filter((op) => isFree(op) && !m.usedOps.has(op.id) && op.date >= lo && op.date <= hi && op.amount < 0 === line.amount < 0)
      .map((op) => ({ op, diff: Math.abs(op.amount - line.amount), gap: Math.abs(daysBetween(op.date, ref)) }))
      .sort((a, b) => a.diff - b.diff || a.gap - b.gap)
      .slice(0, 40);
    if (!candidates.length) {
      app.fail("Aucune opération saisie autour de cette date n'est disponible.");
      return null;
    }
    const list = h('div.list.inset');
    const sheet = openSheet({ title: 'Quelle opération ?', body: h('div.stack', h('p.note', `Ligne du relevé : ${line.suggestedLabel || line.label}, ${formatAmount(line.amount, { sign: 'always' })} le ${formatDate(ref)}.`), list), full: true });
    for (const { op, diff } of candidates) {
      list.appendChild(
        h(
          'button.op-row',
          { type: 'button', dataset: { candidate: op.id }, onclick: () => sheet.close(op.id) },
          h('span.day', h('b', op.date.slice(8, 10)), h('span', op.date.slice(5, 7))),
          h('span.main', h('span.title', operationTitle(app.state, op)), h('span.meta', h('span.text', diff === 0 ? 'Même montant' : `Écart de ${formatAmount(diff)} avec la banque`))),
          h('span.side', amount(op.amount, { sign: 'always' })),
        ),
      );
    }
    const opId = await sheet.closed;
    if (!opId) return null;
    const op = app.state.operations.find((o) => o.id === opId);
    if (op && op.amount !== line.amount) {
      const ok = await confirmDialog({
        title: 'Corriger le montant ?',
        message: `Tu avais saisi ${formatAmount(op.amount, { sign: 'always' })} ; la banque indique ${formatAmount(line.amount, { sign: 'always' })}. En associant les deux, le montant de l'opération sera celui de la banque.`,
        confirmLabel: 'Associer et corriger',
      });
      if (!ok) return null;
    }
    return opId;
  }

  function renderMissing(m) {
    const active = m.toCreate.filter((l) => !w.skipped.includes(l.id));
    const untagged = active.filter((l) => !(fieldsFor(l).tags || []).length).length;
    const hinted = active.filter((l) => !w.fields[l.id] && fieldsFor(l).hinted).length;
    content.appendChild(
      h(
        'p.note',
        `Ces ${plural(m.toCreate.length, 'ligne')} du relevé ${m.toCreate.length > 1 ? 'ne sont' : "n'est"} pas dans l'appli. Elles seront ajoutées telles quelles ; touche une ligne pour préciser son libellé, ses tags ou son enveloppe (tu pourras aussi le faire plus tard).`,
      ),
    );
    const facts = [];
    if (hinted) facts.push(`${plural(hinted, 'ligne pré-remplie', 'lignes pré-remplies')} d'après tes habitudes`);
    if (untagged) facts.push(`${plural(untagged, 'ligne', 'lignes')} sans tag`);
    if (w.skipped.length) facts.push(`${plural(w.skipped.length, 'ignorée', 'ignorées')}`);
    if (facts.length) content.appendChild(h('p.hint', { dataset: { info: 'missing-facts' } }, facts.join(', ') + '.'));
    // dans l'ordre des dates réelles (celle de l'achat, pas celle du débit), comme on les a vécues
    const dateOf = (line) => fieldsFor(line).date || referenceDate(line);
    const ordered = m.toCreate.map((line, i) => ({ line, i, date: dateOf(line) })).sort((a, b) => (a.date === b.date ? a.i - b.i : a.date < b.date ? -1 : 1));
    const list = h('div.list.inset', { role: 'list' });
    for (const { line } of ordered) list.appendChild(missingRow(m, line));
    content.appendChild(list);
    setFoot(h('button.btn.primary.block', { type: 'button', dataset: { action: 'next' }, onclick: next }, 'Continuer'));
  }

  // -------------------------------------------------------------------------------------------
  // Étape 5 : opérations de l'appli absentes du relevé
  // -------------------------------------------------------------------------------------------

  function renderExtras(m) {
    content.appendChild(
      h(
        'p.note',
        "Ces opérations sont dans l'appli sur la période du relevé, mais la banque ne les a pas. Le plus souvent, c'est un paiement par carte pas encore débité : il sera sur le prochain relevé. Sinon, c'est un doublon ou une erreur de saisie.",
      ),
    );
    const stack = h('div.stack');
    for (const op of m.extras) {
      const removed = w.extraDelete.includes(op.id);
      stack.appendChild(
        h(
          'div',
          { class: removed ? 'pair off' : 'pair', dataset: { extra: op.id, state: removed ? 'delete' : 'keep' } },
          h('div.side-row', h('span.who', 'Appli'), h('span.what', h('b', operationTitle(app.state, op)), h('span', [formatDate(op.date), op.counterparty].filter(Boolean).join(', '))), amount(op.amount, { sign: 'always', colored: true })),
          h(
            'div.foot',
            h('span', { class: removed ? 'chip bad' : 'chip plain' }, removed ? 'Sera supprimée' : 'Gardée, en attente de débit'),
            h(
              'button',
              {
                type: 'button',
                class: removed ? 'btn small' : 'btn small quiet',
                dataset: { action: removed ? 'keep-extra' : 'delete-extra' },
                onclick: () => {
                  if (removed) w.extraDelete = w.extraDelete.filter((id) => id !== op.id);
                  else w.extraDelete = [...w.extraDelete, op.id];
                  persist();
                  render();
                },
              },
              removed ? 'Garder' : 'Supprimer',
            ),
          ),
        ),
      );
    }
    content.appendChild(stack);
    setFoot(h('button.btn.primary.block', { type: 'button', dataset: { action: 'next' }, onclick: next }, 'Continuer'));
  }

  // -------------------------------------------------------------------------------------------
  // Étape 6 : bilan et validation
  // -------------------------------------------------------------------------------------------

  function renderSummary(m) {
    const st = m.st;
    const decisions = decisionsFrom(m);
    const plan = planStatementImport(app.state, st, decisions, { today: app.today(), file: w.file });
    if (!plan.ok) {
      content.appendChild(h('div.notice.bad', { role: 'alert' }, icon('alert'), h('div.grow', plan.errors[0]?.message || "L'import ne peut pas être préparé.")));
      setFoot(h('button.btn.block', { type: 'button', onclick: () => go('overview') }, 'Revenir au début'));
      return;
    }
    const s = plan.summary;

    const done = [];
    if (s.merged) done.push(kv('Opérations complétées par le relevé', String(s.merged), 'merged'));
    if (s.created) done.push(kv('Opérations ajoutées', String(s.created), 'created'));
    if (s.skipped) done.push(kv('Lignes ignorées', String(s.skipped), 'skipped'));
    if (s.already) done.push(kv('Lignes déjà importées', String(s.already), 'already'));
    if (s.deleted) done.push(kv("Opérations supprimées de l'appli", String(s.deleted), 'deleted'));
    if (s.kept) done.push(kv('Gardées en attente de débit', `${s.kept} (${formatAmount(s.pendingSum, { sign: 'always' })})`, 'kept'));
    content.appendChild(h('div.card.stack.tight', h('h2', 'Ce qui va être fait'), h('div', done.length ? done : h('p.note', 'Rien à modifier.'))));

    if (st.openingBalance !== null) {
      const openingDate = st.openingDate || addDays(m.start, -1);
      const inApp = st.openingBalance - s.openingGap;
      const nothingBefore = startsHistory(app.state, openingDate);
      const card = h('div.card.stack.tight', h('h2', `Avant le relevé (au ${formatDate(openingDate)})`));
      card.appendChild(h('div', kv('Solde indiqué par la banque', formatAmount(st.openingBalance), 'opening-bank'), nothingBefore ? null : kv("Solde total dans l'appli", formatAmount(inApp), 'opening-app')));
      if (s.openingGap === 0) card.appendChild(h('div.notice.good', icon('check'), h('div.grow', "L'appli et la banque partent du même solde.")));
      else {
        card.appendChild(
          toggle({
            label: nothingBefore ? `Enregistrer ${formatAmount(st.openingBalance)} comme solde de départ` : `Aligner l'appli sur la banque (${formatAmount(s.openingGap, { sign: 'always' })})`,
            hint: nothingBefore
              ? "L'appli ne contient encore rien avant ce relevé : son solde précédent devient ton point de départ."
              : "Un ajustement daté de la veille du relevé absorbe l'écart : des opérations plus anciennes n'ont sans doute pas été saisies.",
            checked: w.opening,
            name: 'opening',
            onChange: (value) => {
              w.opening = value;
              persist();
              render();
            },
          }).el,
        );
      }
      content.appendChild(card);
    }

    if (st.closingBalance !== null) {
      const card = h('div.card.stack.tight', h('h2', `À la fin du relevé (au ${formatDate(m.end)})`));
      const afterImport = st.closingBalance - s.closingGap;
      card.appendChild(h('div', kv('Nouveau solde indiqué par la banque', formatAmount(st.closingBalance), 'closing-bank'), kv("Solde total dans l'appli après l'import", formatAmount(afterImport), 'closing-app')));
      if (s.residual === 0) {
        card.appendChild(
          h(
            'div.notice.good',
            { dataset: { check: 'closing-ok' } },
            icon('checks'),
            h('div.grow', s.pendingSum !== 0 ? `Tout s'explique : la différence (${formatAmount(-s.pendingSum, { sign: 'always' })}) vient ${s.kept > 1 ? `des ${s.kept} opérations pas encore débitées` : "de l'opération pas encore débitée"}.` : "L'appli retombe exactement sur le solde de la banque."),
          ),
        );
      } else {
        card.appendChild(
          h(
            'div.notice.warn',
            { dataset: { check: 'closing-gap' } },
            icon('alert'),
            h('div.grow', `Il reste un écart de ${formatAmount(s.residual, { sign: 'always' })}${s.pendingSum !== 0 ? ', en plus des opérations en attente' : ''}. Il vient des lignes ignorées, ou d'un écart avant le relevé laissé tel quel.`),
          ),
        );
        card.appendChild(
          toggle({
            label: `Ajuster cet écart (${formatAmount(s.residual, { sign: 'always' })})`,
            hint: 'Une ligne « Ajustement de rapprochement » est ajoutée à la date de fin du relevé.',
            checked: w.closing,
            name: 'closing',
            onChange: (value) => {
              w.closing = value;
              persist();
              render();
            },
          }).el,
        );
      }
      content.appendChild(card);
    }

    const history = isHistoryImport(app.state, st);
    const today = h('div.card.stack.tight', h('h2', "Ton solde total aujourd'hui"));
    today.appendChild(h('div', kv("Avant l'import", formatAmount(s.totalBefore), 'total-before'), kv("Après l'import", formatAmount(s.totalAfter), 'total-after')));
    if (history) {
      today.appendChild(
        toggle({
          label: "Garder mon solde d'aujourd'hui",
          hint: "Ce relevé est antérieur à ton solde de départ. Activé : l'historique s'enrichit sans rien changer au solde actuel (une ligne « Opérations non saisies après le relevé » fait le lien).",
          checked: decisions.keepCurrent,
          name: 'keep-current',
          onChange: (value) => {
            w.keepCurrent = value;
            persist();
            render();
          },
        }).el,
      );
    } else if (s.totalAfter !== s.totalBefore) {
      today.appendChild(h('p.hint', "Le solde change parce que l'import ajoute ou corrige des opérations."));
    }
    content.appendChild(today);

    for (const topup of s.topups) {
      const env = app.state.envelopes.find((e) => e.id === topup.envelopeId);
      content.appendChild(
        h('div.notice.warn', icon('envelope'), h('div.grow', `L'enveloppe « ${env ? env.name : '?'} » n'a pas assez pour ces dépenses : ${formatAmount(topup.amount)} seront virés du compte courant pour qu'elle ne passe pas en négatif.`)),
      );
    }

    content.appendChild(
      h(
        'div.card',
        toggle({
          label: 'Retenir mes choix pour la suite',
          hint: "L'appli proposera les mêmes libellés, tags et enveloppes pour ces tiers au prochain relevé.",
          checked: w.learn,
          name: 'learn',
          onChange: (value) => {
            w.learn = value;
            persist();
          },
        }).el,
      ),
    );

    lastSummary = s;
    setFoot(h('button.btn.primary.block', { type: 'button', dataset: { action: 'commit' }, onclick: () => commit(decisions) }, "Valider l'import"));
  }

  async function commit(decisions) {
    if (busy) return;
    busy = true;
    try {
      const st = w.statement;
      const plan = planStatementImport(app.state, st, decisions, { today: app.today(), file: w.file });
      if (!plan.ok) {
        app.fail(plan.errors[0]?.message || "L'import a échoué.");
        return;
      }
      if (!(await app.commit(plan.cs, { label: 'Relevé importé' }))) return;
      lastSummary = plan.summary;
      // copie lisible du fichier dans Documents/MonBudget/Releves (Android), sans bloquer
      if (w.file) {
        app.store
          .readBlob(w.file.id)
          .then((blob) => (blob ? mirrorFile('Releves', `releve-${statementPeriod(st).end || app.today()}.${extensionFor(blob.mime)}`, blob.bytes) : null))
          .catch(() => {});
      }
      const period = statementPeriod(st);
      w = { ...blank(), step: 'done', donePeriod: period };
      app.setSetting(DRAFT_KEY, undefined, { silent: true }).catch(() => {});
      render();
      scroll.scrollTop = 0;
    } finally {
      busy = false;
    }
  }

  function renderDone() {
    const s = lastSummary || {};
    const partsList = [];
    if (s.created) partsList.push(plural(s.created, 'opération ajoutée', 'opérations ajoutées'));
    if (s.merged) partsList.push(plural(s.merged, 'opération complétée', 'opérations complétées'));
    if (s.deleted) partsList.push(plural(s.deleted, 'opération supprimée', 'opérations supprimées'));
    content.appendChild(
      h(
        'div.empty',
        { dataset: { state: 'done' } },
        h('div.empty-mark', icon('checks', 'lg')),
        h('h2', 'Relevé importé'),
        h('p', partsList.length ? `${partsList.join(', ')}.` : "Rien n'était à modifier."),
        h('p.hint', "Une erreur ? Le bouton Annuler (en bas à gauche, ou dans l'onglet Plus) défait tout l'import d'un coup. Le fichier du relevé est rangé dans Plus › Archives."),
      ),
    );
    const period = w.donePeriod;
    content.appendChild(
      h(
        'div.stack',
        period && period.start
          ? h(
              'button.btn.primary.block',
              {
                type: 'button',
                dataset: { action: 'see-operations' },
                onclick: () => app.go('operations', { filter: { ...emptyFilter(), period: 'custom', from: addDays(period.start, -10), to: period.end } }),
              },
              'Voir les opérations du relevé',
            )
          : null,
        h(
          'button.btn.block',
          {
            type: 'button',
            dataset: { action: 'another' },
            onclick: () => {
              w = blank();
              render();
            },
          },
          'Importer un autre relevé',
        ),
        h('button.btn.quiet.block', { type: 'button', dataset: { action: 'finish' }, onclick: () => app.close() }, 'Terminer'),
      ),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Navigation entre les étapes
  // -------------------------------------------------------------------------------------------

  function setFoot(...children) {
    clear(foot);
    foot.hidden = false;
    for (const child of children) foot.appendChild(child);
  }

  function next() {
    const steps = stepsFor(model());
    const i = steps.indexOf(w.step);
    go(steps[Math.min(steps.length - 1, i + 1)]);
  }

  function previous() {
    const steps = stepsFor(model());
    const i = steps.indexOf(w.step);
    if (i <= 0) return false;
    go(steps[i - 1]);
    return true;
  }

  abandon.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Abandonner cet import ?', message: "Les choix faits dans l'assistant seront oubliés. Rien n'a été modifié dans tes opérations.", confirmLabel: 'Abandonner', danger: true });
    if (!ok) return;
    w = blank();
    app.setSetting(DRAFT_KEY, undefined, { silent: true }).catch(() => {});
    render();
  });

  function render() {
    const keep = scroll.scrollTop;
    clear(content);
    clear(foot);
    foot.hidden = true;
    const inReview = !!w.statement && w.step !== 'pick' && w.step !== 'done';
    abandon.hidden = !inReview;
    stepsBar.hidden = !inReview;
    if (!inReview) {
      top.titleEl.textContent = 'Importer un relevé';
      if (w.step === 'done') renderDone();
      else renderPick();
      return;
    }
    const m = model();
    const steps = stepsFor(m);
    if (!steps.includes(w.step)) w.step = steps[steps.length - 1];
    const index = steps.indexOf(w.step);
    top.titleEl.textContent = STEP_TITLES[w.step];
    clear(stepsBar);
    stepsBar.setAttribute('aria-label', `Étape ${index + 1} sur ${steps.length}`);
    steps.forEach((step, i) => stepsBar.appendChild(h('i', { class: i < index ? 'done' : i === index ? 'now' : null })));
    if (w.step === 'overview') renderOverview(m);
    else if (w.step === 'matches') renderMatches(m);
    else if (w.step === 'missing') renderMissing(m);
    else if (w.step === 'extras') renderExtras(m);
    else renderSummary(m);
    scroll.scrollTop = keep;
  }

  return {
    el,
    update: render,
    onShow: () => app.hideUndo(),
    /** Retour : étape précédente tant qu'on est dans la revue ; sinon on quitte (le brouillon reste). */
    handleBack() {
      if (!w.statement || w.step === 'pick' || w.step === 'done' || w.step === 'overview') return false;
      return previous();
    },
  };
}
