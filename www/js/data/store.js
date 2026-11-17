// Le « magasin » : l'état de l'appli en mémoire, synchronisé avec le stockage de l'appareil.
//
// Toute modification passe par commit(lot) : le lot est d'abord écrit sur l'appareil (tout ou
// rien), puis appliqué en mémoire, puis les écrans sont prévenus. L'inverse de chaque lot est
// gardé dans une pile de 5 pour le bouton « Annuler ».

import { apply, invert, isEmpty } from '../core/changeset.js';
import { emptyState, makeFile, STORES } from '../core/schema.js';
import { newId, PREFIX } from '../core/ids.js';
import { tick } from '../core/recurring.js';

export const UNDO_DEPTH = 5;
const ORPHAN_GRACE_MS = 24 * 3600 * 1000;

export class Store {
  constructor(db) {
    this.db = db;
    this.state = emptyState();
    this.settings = {};
    this.undoStack = [];
    this.listeners = new Set();
    this.revision = 0; // augmente à chaque changement (sert à savoir s'il faut refaire une sauvegarde)
    this.backedUpRevision = -1;
    this.sessionBlobs = new Set(); // pièces jointes ajoutées depuis l'ouverture (jamais nettoyées en cours de route)
  }

  async init() {
    const { state, settings } = await this.db.loadAll();
    this.state = state;
    this.state.settings = settings;
    this.settings = settings;
    return this;
  }

  /** Vrai si l'appli ne contient encore aucune donnée. */
  get isEmpty() {
    return STORES.every((s) => this.state[s].length === 0);
  }

  get persistent() {
    return this.db.kind !== 'memory';
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(reason = 'change') {
    this.revision++;
    for (const listener of [...this.listeners]) {
      try {
        listener(reason);
      } catch (error) {
        console.error(error);
      }
    }
  }

  /**
   * Valide un lot de modifications. `label` décrit l'action pour le bouton Annuler
   * (« Opération ajoutée »…) ; undoable: false pour les mises à jour automatiques.
   */
  async commit(cs, { label = '', undoable = true } = {}) {
    if (!cs || isEmpty(cs)) return false;
    const inverse = invert(this.state, cs);
    await this.db.commit(cs);
    apply(this.state, cs);
    if (undoable) {
      this.undoStack.push({ label, cs: inverse });
      if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    }
    this.emit('commit');
    return true;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get undoLabel() {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : '';
  }

  /** Annule la dernière action. Renvoie son libellé, ou null s'il n'y a rien à annuler. */
  async undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    try {
      await this.db.commit(entry.cs);
    } catch (error) {
      this.undoStack.push(entry);
      throw error;
    }
    apply(this.state, entry.cs);
    this.emit('undo');
    return entry.label || 'Action';
  }

  clearUndo() {
    this.undoStack = [];
  }

  setting(key, fallback = null) {
    return key in this.settings ? this.settings[key] : fallback;
  }

  async setSetting(key, value, { silent = false } = {}) {
    await this.db.setSetting(key, value);
    if (value === undefined) delete this.settings[key];
    else this.settings[key] = value;
    if (!silent) this.emit('setting');
  }

  // --- Pièces jointes -----------------------------------------------------------------------

  /**
   * Enregistre le contenu d'un fichier et renvoie sa fiche descriptive. La fiche n'est PAS encore
   * dans la base : c'est le lot de l'action en cours (enregistrer l'opération…) qui l'y mettra.
   */
  async saveBlob(bytes, { kind = 'photo', name = '', mime = 'application/octet-stream' } = {}) {
    const id = newId(PREFIX.files);
    const data = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    await this.db.putBlob(id, { mime, data });
    this.sessionBlobs.add(id);
    return makeFile({ id, kind, name, mime, size: data.byteLength });
  }

  /** Contenu d'une pièce jointe : { mime, bytes } ou null. */
  async readBlob(id) {
    const blob = await this.db.getBlob(id);
    if (!blob) return null;
    return { mime: blob.mime, bytes: new Uint8Array(blob.data) };
  }

  /** Identifiants de pièces jointes encore utilisés quelque part. */
  referencedFileIds() {
    const used = new Set();
    for (const op of this.state.operations) for (const id of op.photoIds) used.add(id);
    for (const report of this.state.bugReports) for (const id of report.photoIds) used.add(id);
    for (const statement of this.state.statements) if (statement.fileId) used.add(statement.fileId);
    return used;
  }

  /**
   * Ménage : supprime les pièces jointes qui ne sont plus rattachées à rien depuis plus de 24 h
   * (ce délai laisse le temps d'annuler une suppression). Les brouillons en cours sont respectés,
   * ainsi que tout ce qui a été ajouté depuis l'ouverture de l'appli : un contenu sans fiche peut
   * appartenir à un formulaire encore ouvert.
   */
  async collectGarbage(now = Date.now()) {
    const used = this.referencedFileIds();
    const drafts = JSON.stringify(Object.entries(this.settings).filter(([key]) => key.startsWith('draft:')));
    const staleRecords = this.state.files.filter((f) => !used.has(f.id) && !drafts.includes(f.id) && now - Date.parse(f.createdAt) > ORPHAN_GRACE_MS);
    const known = new Set(this.state.files.map((f) => f.id));
    const blobIds = await this.db.blobIds();
    const strayBlobs = blobIds.filter((id) => !known.has(id) && !used.has(id) && !drafts.includes(id) && !this.sessionBlobs.has(id) && !String(id).startsWith('tmp:'));
    if (staleRecords.length) {
      await this.db.commit({ put: {}, del: { files: staleRecords.map((f) => f.id) } });
      apply(this.state, { put: {}, del: { files: staleRecords.map((f) => f.id) } });
    }
    await this.db.deleteBlobs([...staleRecords.map((f) => f.id), ...strayBlobs]);
    return staleRecords.length + strayBlobs.length;
  }

  // --- Opérations globales --------------------------------------------------------------------

  /** Met à jour les récurrences (échéances à créer, échéances arrivées à leur date). */
  async tickRecurring(today) {
    const cs = tick(this.state, { today });
    if (isEmpty(cs)) return false;
    await this.commit(cs, { undoable: false });
    return true;
  }

  /** Efface toutes les données de l'appareil. */
  async wipe() {
    await this.db.wipe();
    this.state = emptyState();
    this.settings = {};
    this.state.settings = this.settings;
    this.undoStack = [];
    this.emit('wipe');
  }
}
