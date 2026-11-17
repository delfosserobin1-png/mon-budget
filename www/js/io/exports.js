// Exports lisibles dans un tableur : classeur Excel (une feuille par type de donnée) et CSV.
// Ces fichiers servent à consulter, trier, imprimer ou archiver ; pour sauvegarder / restaurer
// l'appli, c'est la sauvegarde complète (JSON ou ZIP) qu'il faut utiliser.

import { KIND, frequencyLabel, importanceLabel } from '../core/schema.js';
import { toEuros } from '../core/money.js';
import { computeBalances } from '../core/balances.js';
import { accountName, operationTitle } from '../core/operations.js';
import { nextOccurrence } from '../core/recurring.js';
import { sortNewestFirst, typeOf } from '../core/filters.js';
import { buildCsv, buildXlsx } from './xlsx.js';

const yesNo = (v) => (v ? 'oui' : 'non');
const TYPE_LABEL = { expense: 'Dépense', income: 'Revenu', transfer: 'Virement interne', adjustment: 'Ajustement' };

function operationsSheet(state, operations) {
  const tags = new Map(state.tags.map((t) => [t.id, t.name]));
  const rules = new Map(state.recurring.map((r) => [r.id, r.label]));
  const columns = [
    { header: 'Date', type: 'date', width: 12 },
    { header: 'Heure', width: 7 },
    { header: 'Type', width: 16 },
    { header: 'Libellé', width: 34 },
    { header: 'Tiers', width: 24 },
    { header: 'Montant', type: 'money', width: 14 },
    { header: 'Compte', width: 30 },
    { header: 'Tags', width: 24 },
    { header: 'Importance', width: 12 },
    { header: 'Commentaire', width: 34 },
    { header: 'Simulée', width: 9 },
    { header: 'Comptée', width: 9 },
    { header: 'Date banque', type: 'date', width: 12 },
    { header: 'Libellé banque', width: 40 },
    { header: 'Récurrence', width: 22 },
    { header: 'Photos', type: 'int', width: 8 },
    { header: 'Identifiant', width: 18 },
  ];
  const rows = sortNewestFirst(operations).map((op) => [
    op.date,
    op.time || '',
    TYPE_LABEL[typeOf(op)],
    operationTitle(state, op),
    op.counterparty,
    toEuros(op.amount),
    op.kind === KIND.TRANSFER ? `${accountName(state, op.from)} → ${accountName(state, op.to)}` : accountName(state, op.envelopeId),
    op.tags.map((id) => tags.get(id) || '').filter(Boolean).join(', '),
    importanceLabel(op.importance),
    op.comment,
    yesNo(op.simulated),
    yesNo(!op.simulated || op.checked),
    op.bank?.date || '',
    op.bank?.label || '',
    op.recurringId ? rules.get(op.recurringId) || '' : '',
    op.photoIds.length || null,
    op.id,
  ]);
  return { name: 'Opérations', columns, rows };
}

export function sheetsFor(state, { today }) {
  const balances = computeBalances(state, { upTo: today });
  const tags = new Map(state.tags.map((t) => [t.id, t.name]));
  const sheets = [operationsSheet(state, state.operations)];

  sheets.push({
    name: 'Enveloppes',
    columns: [
      { header: 'Nom', width: 26 },
      { header: 'Description', width: 40 },
      { header: `Solde au ${today.split('-').reverse().join('-')}`, type: 'money', width: 18 },
      { header: 'Objectif', type: 'money', width: 14 },
      { header: "Date d'objectif", type: 'date', width: 14 },
      { header: 'Clôturée', width: 10 },
      { header: 'Clôturée le', type: 'date', width: 12 },
      { header: 'Identifiant', width: 18 },
    ],
    rows: [
      ['Compte courant (hors enveloppes)', '', toEuros(balances.available), null, '', '', '', ''],
      ...state.envelopes.map((e) => [e.name, e.description, toEuros(balances.envelopes.get(e.id) || 0), e.goalAmount ? toEuros(e.goalAmount) : null, e.goalDate || '', yesNo(e.closed), e.closedAt || '', e.id]),
      ['Solde total', '', toEuros(balances.total), null, '', '', '', ''],
    ],
  });

  sheets.push({
    name: 'Tags',
    columns: [
      { header: 'Nom', width: 24 },
      { header: 'Couleur', width: 12 },
      { header: "Nombre d'opérations", type: 'int', width: 20 },
      { header: 'Total dépensé', type: 'money', width: 16 },
    ],
    rows: state.tags.map((t) => {
      const ops = state.operations.filter((op) => !op.simulated && op.date <= today && op.tags.includes(t.id));
      const spent = ops.reduce((sum, op) => sum + (op.amount < 0 ? -op.amount : 0), 0);
      return [t.name, t.color, ops.length, toEuros(spent)];
    }),
  });

  sheets.push({
    name: 'Récurrences',
    columns: [
      { header: 'Libellé', width: 28 },
      { header: 'Type', width: 16 },
      { header: 'Montant', type: 'money', width: 14 },
      { header: 'Fréquence', width: 20 },
      { header: 'Première échéance', type: 'date', width: 16 },
      { header: 'Fin', type: 'date', width: 12 },
      { header: 'Prochaine échéance', type: 'date', width: 18 },
      { header: 'Active', width: 8 },
      { header: 'Compte', width: 30 },
      { header: 'Tags', width: 22 },
    ],
    rows: state.recurring.map((r) => [
      r.label,
      r.kind === KIND.TRANSFER ? 'Virement interne' : r.amount < 0 ? 'Dépense' : 'Revenu',
      toEuros(r.amount),
      frequencyLabel(r.frequency, r.interval),
      r.startDate,
      r.endDate || '',
      (r.active && nextOccurrence(r, today)) || '',
      yesNo(r.active),
      r.kind === KIND.TRANSFER ? `${accountName(state, r.from)} → ${accountName(state, r.to)}` : accountName(state, r.envelopeId),
      r.tags.map((id) => tags.get(id) || '').filter(Boolean).join(', '),
    ]),
  });

  sheets.push({
    name: 'Rapprochements',
    columns: [
      { header: 'Date', type: 'date', width: 12 },
      { header: 'Solde de la banque', type: 'money', width: 18 },
      { header: "Solde de l'appli", type: 'money', width: 18 },
      { header: 'Écart', type: 'money', width: 14 },
      { header: 'Ajusté', width: 9 },
      { header: 'Issu d\'un relevé', width: 16 },
    ],
    rows: state.reconciliations
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((r) => [r.date, toEuros(r.realBalance), toEuros(r.computedBalance), toEuros(r.gap), yesNo(!!r.adjustmentOperationId), yesNo(!!r.statementId)]),
  });

  sheets.push({
    name: 'Relevés importés',
    columns: [
      { header: 'Banque', width: 20 },
      { header: 'Compte', width: 28 },
      { header: 'Du', type: 'date', width: 12 },
      { header: 'Au', type: 'date', width: 12 },
      { header: 'Solde précédent', type: 'money', width: 16 },
      { header: 'Nouveau solde', type: 'money', width: 16 },
      { header: 'Lignes', type: 'int', width: 8 },
      { header: 'Rapprochées', type: 'int', width: 12 },
      { header: 'Créées', type: 'int', width: 8 },
      { header: 'Importé le', type: 'date', width: 12 },
    ],
    rows: state.statements.map((s) => [
      s.bank || 'Banque non reconnue',
      s.accountLabel,
      s.periodStart || '',
      s.periodEnd || '',
      s.openingBalance == null ? null : toEuros(s.openingBalance),
      s.closingBalance == null ? null : toEuros(s.closingBalance),
      s.lineCount,
      s.matchedCount,
      s.createdCount,
      s.importedAt.slice(0, 10),
    ]),
  });

  sheets.push({
    name: 'Règles automatiques',
    columns: [
      { header: 'Tiers', width: 28 },
      { header: 'Libellé proposé', width: 28 },
      { header: 'Tags', width: 24 },
      { header: 'Enveloppe', width: 22 },
      { header: 'Importance', width: 12 },
      { header: 'Utilisations', type: 'int', width: 12 },
    ],
    rows: state.rules.map((r) => [r.display, r.label, r.tags.map((id) => tags.get(id) || '').filter(Boolean).join(', '), r.envelopeId ? accountName(state, r.envelopeId) : '', importanceLabel(r.importance), r.uses]),
  });
  return sheets;
}

/** Classeur Excel complet (Uint8Array). */
export function buildWorkbook(state, { today }) {
  return buildXlsx(sheetsFor(state, { today }));
}

/** CSV d'une liste d'opérations (toutes par défaut, ou la sélection filtrée à l'écran). */
export function buildOperationsCsv(state, operations = state.operations) {
  const sheet = operationsSheet(state, operations);
  return buildCsv(sheet.columns, sheet.rows);
}

/** Nom de fichier daté : « mon-budget-2026-11-15.xlsx ». */
export function datedName(base, extension, today) {
  return `${base}-${today}.${extension}`;
}
