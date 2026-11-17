// Export / import des données, et reprise des fichiers de l'ancienne version (v1).
//
// Format d'export (v2) :
//   { format: "mon-budget", schema: 2, appVersion, exportedAt, data: { operations: [...], envelopes: [...], … } }
// Deux façons d'importer :
//   - « ajouter »   : la base actuelle est conservée, ce qui manque est ajouté (rien n'est écrasé) ;
//   - « remplacer » : la base actuelle est effacée et remplacée par le fichier.

import { Draft } from './changeset.js';
import { KIND, MAKERS, SCHEMA_VERSION, STORES, COLORS, emptyState, makeFile } from './schema.js';
import { isValidISO } from './dates.js';
import { newId, PREFIX } from './ids.js';
import { normalize, partyKey } from './text.js';
import { firstKOnOrAfter } from './recurring.js';

export const FORMAT = 'mon-budget';

export function exportData(state, { appVersion = '', now = new Date() } = {}) {
  const data = {};
  for (const store of STORES) data[store] = state[store];
  return { format: FORMAT, schema: SCHEMA_VERSION, appVersion, exportedAt: now.toISOString(), data };
}

const cents = (euros) => (Number.isFinite(Number(euros)) ? Math.round(Number(euros) * 100) : 0);

function isV1(obj) {
  return !!obj && typeof obj === 'object' && !obj.format && Array.isArray(obj.operations) && (obj.operations.length === 0 || 'isTransfer' in obj.operations[0] || 'motif' in obj.operations[0]);
}

/**
 * Convertit un export de l'ancienne version (montants en euros à virgule, champs motif / isTransfer…).
 * Renvoie { state, photos: [{ fileId, dataUrl }], warnings }.
 */
export function migrateV1(v1) {
  const state = emptyState();
  const photos = [];
  const warnings = [];

  state.envelopes = (v1.envelopes || []).map((e, i) =>
    MAKERS.envelopes({ id: e.id, name: e.name, description: e.description, closed: !!e.closed, closedAt: e.closed ? (e.closedAt || null) : null, color: COLORS[i % COLORS.length], createdAt: e.createdAt }),
  );
  state.tags = (v1.tags || []).map((t, i) => MAKERS.tags({ id: t.id, name: t.name, color: COLORS[i % COLORS.length] }));
  const envIds = new Set(state.envelopes.map((e) => e.id));
  const tagIds = new Set(state.tags.map((t) => t.id));
  const envOrNull = (id) => (id && envIds.has(id) ? id : null);

  state.recurring = (v1.recurring || []).map((r) => {
    const isTransfer = !!r.isTransfer;
    const rule = MAKERS.recurring({
      id: r.id,
      kind: isTransfer ? KIND.TRANSFER : KIND.OPERATION,
      label: r.label,
      amount: cents(r.amount),
      frequency: r.frequency,
      interval: 1,
      startDate: r.startDate,
      endDate: r.endDate,
      envelopeId: envOrNull(r.envelopeId),
      from: envOrNull(r.transferFrom),
      to: envOrNull(r.transferTo),
      tags: (r.tags || []).filter((id) => tagIds.has(id)),
      importance: r.importance,
      counterparty: r.counterparty,
      comment: r.comment,
      active: r.active !== false,
      createdAt: r.createdAt,
    });
    // L'ancienne version retenait « la dernière échéance générée » ; la nouvelle « la prochaine à générer ».
    rule.nextK = isValidISO(r.lastGeneratedDate) ? firstKOnOrAfter(rule, r.lastGeneratedDate) + 1 : 0;
    return rule;
  });
  const ruleIds = new Set(state.recurring.map((r) => r.id));

  for (const o of v1.operations || []) {
    const kind = o.isTransfer ? KIND.TRANSFER : o.isAdjustment ? KIND.ADJUSTMENT : KIND.OPERATION;
    let label = o.motif || '';
    if (kind === KIND.TRANSFER && /^Virement\s*:/i.test(label)) label = ''; // l'ancien libellé automatique est recalculé à l'affichage
    const photoIds = [];
    if (typeof o.photoPath === 'string' && o.photoPath.startsWith('data:')) {
      const fileId = newId(PREFIX.files);
      photos.push({ fileId, dataUrl: o.photoPath });
      photoIds.push(fileId);
    } else if (o.photoPath) {
      warnings.push(`La photo de « ${label || o.date} » n'a pas pu être reprise.`);
    }
    if (!isValidISO(o.date)) {
      warnings.push(`Opération ignorée (date illisible) : « ${label} ».`);
      continue;
    }
    const amount = cents(o.amount);
    let envelopeId = kind === KIND.OPERATION ? envOrNull(o.envelopeId) : null;
    if (envelopeId && amount > 0) {
      // Ancien comportement : un « + » direct dans une enveloppe. Désormais : revenu sur le compte
      // courant + virement vers l'enveloppe.
      state.operations.push(
        MAKERS.operations({ kind: KIND.TRANSFER, from: null, to: envelopeId, amount, date: o.date, simulated: !!o.isSimulated, checked: o.isChecked !== false, createdAt: o.createdAt }),
      );
      envelopeId = null;
    }
    state.operations.push(
      MAKERS.operations({
        id: o.id,
        kind,
        date: o.date,
        time: o.time,
        amount,
        label,
        counterparty: o.counterparty,
        comment: o.comment,
        importance: o.importance,
        tags: (o.tags || []).filter((id) => tagIds.has(id)),
        envelopeId,
        from: envOrNull(o.transferFrom),
        to: envOrNull(o.transferTo),
        simulated: !!o.isSimulated,
        checked: o.isChecked !== false,
        recurringId: o.recurringId && ruleIds.has(o.recurringId) ? o.recurringId : null,
        photoIds,
        createdAt: o.createdAt,
        updatedAt: o.createdAt,
      }),
    );
  }
  for (const p of photos) state.files.push(makeFile({ id: p.fileId, kind: 'photo', name: 'photo', mime: (/^data:([^;,]+)/.exec(p.dataUrl) || [])[1] || 'image/jpeg' }));

  const opIds = new Set(state.operations.map((o) => o.id));
  state.reconciliations = (v1.reconciliation || v1.reconciliations || [])
    .filter((r) => isValidISO(r.date))
    .map((r) =>
      MAKERS.reconciliations({
        id: r.id,
        date: r.date,
        realBalance: cents(r.realBalance),
        computedBalance: cents(r.computedBalance),
        adjustmentOperationId: r.adjustmentOperationId && opIds.has(r.adjustmentOperationId) ? r.adjustmentOperationId : null,
        createdAt: r.createdAt,
      }),
    );
  return { state, photos, warnings };
}

/** Remet d'équerre les liens internes (tags, enveloppes, récurrences inconnus → retirés). */
function sanitize(state) {
  const envIds = new Set(state.envelopes.map((e) => e.id));
  const tagIds = new Set(state.tags.map((t) => t.id));
  const ruleIds = new Set(state.recurring.map((r) => r.id));
  const fileIds = new Set(state.files.map((f) => f.id));
  const env = (id) => (id && envIds.has(id) ? id : null);
  state.operations = state.operations
    .filter((op) => isValidISO(op.date) && op.date !== '1970-01-01')
    .map((op) => {
      const fixed = {
        ...op,
        tags: op.tags.filter((id) => tagIds.has(id)),
        envelopeId: env(op.envelopeId),
        from: env(op.from),
        to: env(op.to),
        recurringId: op.recurringId && ruleIds.has(op.recurringId) ? op.recurringId : null,
        photoIds: op.photoIds.filter((id) => fileIds.has(id)),
      };
      return fixed;
    })
    // un virement dont les deux côtés ont disparu ne déplace plus rien
    .filter((op) => op.kind !== KIND.TRANSFER || op.from !== op.to);
  state.recurring = state.recurring
    .map((r) => ({ ...r, tags: r.tags.filter((id) => tagIds.has(id)), envelopeId: env(r.envelopeId), from: env(r.from), to: env(r.to) }))
    .filter((r) => r.kind !== KIND.TRANSFER || r.from !== r.to);
  state.rules = state.rules.filter((r) => r.key).map((r) => ({ ...r, tags: r.tags.filter((id) => tagIds.has(id)), envelopeId: env(r.envelopeId) }));
  return state;
}

/**
 * Lit le contenu d'un fichier d'import (objet déjà décodé du JSON).
 * Renvoie { ok: true, state, photos, source: 'v2' | 'v1', warnings, counts } ou { ok: false, error }.
 */
export function readImport(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: "Ce fichier n'est pas une sauvegarde de Mon Budget." };
  if (obj.format === FORMAT) {
    if (!Number.isInteger(obj.schema) || obj.schema > SCHEMA_VERSION) {
      return { ok: false, error: "Cette sauvegarde vient d'une version plus récente de l'appli. Mets l'appli à jour pour l'importer." };
    }
    if (!obj.data || typeof obj.data !== 'object') return { ok: false, error: 'Cette sauvegarde est incomplète (aucune donnée).' };
    const state = emptyState();
    for (const store of STORES) {
      const seen = new Set();
      for (const raw of Array.isArray(obj.data[store]) ? obj.data[store] : []) {
        if (!raw || typeof raw !== 'object') continue;
        const rec = MAKERS[store](raw);
        if (seen.has(rec.id)) continue;
        seen.add(rec.id);
        state[store].push(rec);
      }
    }
    sanitize(state);
    return { ok: true, state, photos: [], source: 'v2', warnings: [], counts: countsOf(state) };
  }
  if (isV1(obj)) {
    const { state, photos, warnings } = migrateV1(obj);
    sanitize(state);
    return { ok: true, state, photos, source: 'v1', warnings, counts: countsOf(state) };
  }
  return { ok: false, error: "Ce fichier n'est pas une sauvegarde de Mon Budget." };
}

export function countsOf(state) {
  const counts = {};
  for (const store of STORES) counts[store] = state[store].length;
  return counts;
}

/**
 * Prépare l'import dans la base actuelle.
 * mode 'replace' : tout est remplacé. mode 'merge' : on ajoute ce qui manque, sans rien écraser ;
 * une enveloppe ou un tag qui porte le même nom qu'un existant est fusionné avec lui.
 * `availableFiles` : identifiants des pièces jointes dont on possède réellement le contenu (les
 * autres sont retirées des opérations pour ne pas laisser de lien mort).
 */
export function planImport(state, incoming, mode, { availableFiles = null } = {}) {
  const draft = new Draft(state);
  const added = {};
  const skipped = {};
  for (const store of STORES) {
    added[store] = 0;
    skipped[store] = 0;
  }
  const hasFile = (id) => !availableFiles || availableFiles.has(id);
  const files = incoming.files.filter((f) => hasFile(f.id));
  const fileIds = new Set(files.map((f) => f.id));
  const keepPhotos = (ids) => ids.filter((id) => fileIds.has(id) || (mode === 'merge' && state.files.some((f) => f.id === id)));

  if (mode === 'replace') {
    for (const store of STORES) for (const rec of state[store]) draft.del(store, rec.id);
    for (const store of STORES) {
      const list = store === 'files' ? files : incoming[store];
      for (const rec of list) {
        let out = rec;
        if (store === 'operations' || store === 'bugReports') out = { ...rec, photoIds: keepPhotos(rec.photoIds) };
        if (store === 'statements' && rec.fileId && !fileIds.has(rec.fileId)) out = { ...rec, fileId: null };
        draft.put(store, out);
        added[store]++;
      }
    }
    return { ok: true, cs: draft.cs, added, skipped };
  }

  // --- mode « ajouter » ---
  const idMap = new Map(); // identifiant du fichier → identifiant dans la base (enveloppes et tags fusionnés par nom)
  const mapId = (id) => (id && idMap.has(id) ? idMap.get(id) : id);
  for (const store of ['envelopes', 'tags']) {
    const byName = new Map(state[store].map((r) => [normalize(r.name), r]));
    const ids = new Set(state[store].map((r) => r.id));
    for (const rec of incoming[store]) {
      const twin = byName.get(normalize(rec.name));
      if (ids.has(rec.id)) skipped[store]++;
      else if (twin) {
        idMap.set(rec.id, twin.id);
        skipped[store]++;
      } else {
        draft.put(store, rec);
        byName.set(normalize(rec.name), rec);
        ids.add(rec.id);
        added[store]++;
      }
    }
  }
  const existing = (store) => new Set(state[store].map((r) => r.id));

  const ruleIds = existing('recurring');
  for (const rec of incoming.recurring) {
    if (ruleIds.has(rec.id)) {
      skipped.recurring++;
      continue;
    }
    draft.put('recurring', { ...rec, tags: rec.tags.map(mapId), envelopeId: mapId(rec.envelopeId), from: mapId(rec.from), to: mapId(rec.to) });
    added.recurring++;
  }

  const fileExisting = existing('files');
  for (const rec of files) {
    if (fileExisting.has(rec.id)) skipped.files++;
    else {
      draft.put('files', rec);
      added.files++;
    }
  }

  const opIds = existing('operations');
  for (const op of incoming.operations) {
    if (opIds.has(op.id)) {
      skipped.operations++;
      continue;
    }
    const mapped = { ...op, tags: [...new Set(op.tags.map(mapId))], envelopeId: mapId(op.envelopeId), from: mapId(op.from), to: mapId(op.to), photoIds: keepPhotos(op.photoIds) };
    if (mapped.kind === KIND.TRANSFER && mapped.from === mapped.to) {
      skipped.operations++;
      continue;
    }
    // Un seul solde de départ : celui de la base actuelle est prioritaire.
    if (mapped.auto === 'opening' && state.operations.some((o) => o.auto === 'opening')) mapped.auto = null;
    draft.put('operations', mapped);
    added.operations++;
  }

  const ruleKeys = new Set(state.rules.map((r) => r.key));
  for (const rec of incoming.rules) {
    if (ruleKeys.has(rec.key)) skipped.rules++;
    else {
      draft.put('rules', { ...rec, key: rec.key || partyKey(rec.display), tags: rec.tags.map(mapId), envelopeId: mapId(rec.envelopeId) });
      ruleKeys.add(rec.key);
      added.rules++;
    }
  }

  for (const store of ['reconciliations', 'statements', 'bugReports']) {
    const ids = existing(store);
    const prints = store === 'statements' ? new Set(state.statements.map((s) => s.fingerprint).filter(Boolean)) : null;
    for (const rec of incoming[store]) {
      if (ids.has(rec.id) || (prints && rec.fingerprint && prints.has(rec.fingerprint))) {
        skipped[store]++;
        continue;
      }
      let out = rec;
      if (store === 'bugReports') out = { ...rec, photoIds: keepPhotos(rec.photoIds) };
      if (store === 'statements' && rec.fileId && !fileIds.has(rec.fileId)) out = { ...rec, fileId: null };
      draft.put(store, out);
      added[store]++;
    }
  }
  return { ok: true, cs: draft.cs, added, skipped };
}

/** Décode une image « data:image/png;base64,… » en octets. Renvoie { mime, bytes } ou null. */
export function decodeDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  try {
    const text = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return { mime: m[1] || 'application/octet-stream', bytes };
  } catch {
    return null;
  }
}
