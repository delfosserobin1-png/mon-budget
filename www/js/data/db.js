// Stockage sur l'appareil.
//
// Les données vivent dans IndexedDB, la base de données intégrée au téléphone / au navigateur :
//   - une « table » par collection (operations, envelopes, tags…), une fiche par ligne ;
//   - « blobs »  : le contenu des pièces jointes (photos, relevés PDF), rangé à part pour que la
//                  liste des opérations reste légère ;
//   - « kv »     : les réglages et les brouillons (clé → valeur).
// Rien ne sort de l'appareil. Si IndexedDB est indisponible (navigation privée très stricte…),
// l'appli fonctionne quand même en mémoire et prévient que rien ne sera conservé.

import { STORES, emptyState } from '../core/schema.js';

export const DB_NAME = 'mon-budget-v2';
const DB_VERSION = 1;

const wrap = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Erreur de lecture / écriture'));
  });

const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Écriture impossible'));
    tx.onabort = () => reject(tx.error || new Error('Écriture annulée (espace de stockage insuffisant ?)'));
  });

class IndexedDbAdapter {
  constructor(db) {
    this.db = db;
    this.kind = 'indexeddb';
  }

  async loadAll() {
    const tx = this.db.transaction([...STORES, 'kv'], 'readonly');
    const state = emptyState();
    const pending = STORES.map(async (store) => {
      state[store] = await wrap(tx.objectStore(store).getAll());
    });
    const kv = tx.objectStore('kv');
    const [keys, values] = await Promise.all([wrap(kv.getAllKeys()), wrap(kv.getAll()), ...pending]);
    const settings = {};
    keys.forEach((key, i) => {
      settings[key] = values[i];
    });
    return { state, settings };
  }

  /** Applique un lot de modifications d'un seul bloc : tout est écrit, ou rien. */
  async commit(cs) {
    const touched = STORES.filter((s) => cs.put?.[s]?.length || cs.del?.[s]?.length);
    if (!touched.length) return;
    const tx = this.db.transaction(touched, 'readwrite');
    const done = finished(tx);
    for (const store of touched) {
      const os = tx.objectStore(store);
      for (const id of cs.del?.[store] || []) os.delete(id);
      for (const rec of cs.put?.[store] || []) os.put(rec);
    }
    await done;
  }

  async setSetting(key, value) {
    const tx = this.db.transaction('kv', 'readwrite');
    const done = finished(tx);
    if (value === undefined) tx.objectStore('kv').delete(key);
    else tx.objectStore('kv').put(value, key);
    await done;
  }

  async putBlob(id, { mime, data }) {
    const tx = this.db.transaction('blobs', 'readwrite');
    const done = finished(tx);
    tx.objectStore('blobs').put({ mime, data }, id);
    await done;
  }

  async getBlob(id) {
    const tx = this.db.transaction('blobs', 'readonly');
    return (await wrap(tx.objectStore('blobs').get(id))) || null;
  }

  async deleteBlobs(ids) {
    if (!ids.length) return;
    const tx = this.db.transaction('blobs', 'readwrite');
    const done = finished(tx);
    for (const id of ids) tx.objectStore('blobs').delete(id);
    await done;
  }

  async blobIds() {
    const tx = this.db.transaction('blobs', 'readonly');
    return wrap(tx.objectStore('blobs').getAllKeys());
  }

  /** Efface tout (données, pièces jointes, réglages). */
  async wipe() {
    const names = [...STORES, 'blobs', 'kv'];
    const tx = this.db.transaction(names, 'readwrite');
    const done = finished(tx);
    for (const name of names) tx.objectStore(name).clear();
    await done;
  }

  close() {
    this.db.close();
  }
}

/** Même interface, mais tout reste en mémoire (secours, et tests). */
export class MemoryAdapter {
  constructor(reason = '') {
    this.kind = 'memory';
    this.reason = reason;
    this.state = emptyState();
    this.settings = {};
    this.blobs = new Map();
  }

  async loadAll() {
    const state = emptyState();
    for (const store of STORES) state[store] = this.state[store].slice();
    return { state, settings: { ...this.settings } };
  }

  async commit(cs) {
    for (const store of STORES) {
      const dels = new Set(cs.del?.[store] || []);
      const puts = new Map((cs.put?.[store] || []).map((r) => [r.id, r]));
      if (!dels.size && !puts.size) continue;
      const next = [];
      for (const rec of this.state[store]) {
        if (dels.has(rec.id)) continue;
        if (puts.has(rec.id)) {
          next.push(puts.get(rec.id));
          puts.delete(rec.id);
        } else next.push(rec);
      }
      for (const rec of puts.values()) next.push(rec);
      this.state[store] = next;
    }
  }

  async setSetting(key, value) {
    if (value === undefined) delete this.settings[key];
    else this.settings[key] = value;
  }

  async putBlob(id, blob) {
    this.blobs.set(id, blob);
  }

  async getBlob(id) {
    return this.blobs.get(id) || null;
  }

  async deleteBlobs(ids) {
    for (const id of ids) this.blobs.delete(id);
  }

  async blobIds() {
    return [...this.blobs.keys()];
  }

  async wipe() {
    this.state = emptyState();
    this.settings = {};
    this.blobs.clear();
  }

  close() {}
}

/** Ouvre la base de l'appareil ; à défaut, renvoie un stockage en mémoire (`kind: 'memory'`). */
export async function openDb({ factory = globalThis.indexedDB, name = DB_NAME } = {}) {
  if (!factory) return new MemoryAdapter("Ce navigateur ne propose pas de stockage local.");
  try {
    const db = await new Promise((resolve, reject) => {
      const request = factory.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const store of STORES) {
          if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('blobs')) database.createObjectStore('blobs');
        if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Ouverture impossible'));
      request.onblocked = () => reject(new Error("La base est utilisée par une autre fenêtre de l'appli."));
    });
    // Si une autre fenêtre demande une mise à niveau, on lâche la base plutôt que de la bloquer.
    db.onversionchange = () => db.close();
    return new IndexedDbAdapter(db);
  } catch (error) {
    return new MemoryAdapter(error?.message || 'Stockage local indisponible.');
  }
}

/**
 * Lit les données de l'ancienne version de l'appli (base « budget-app »), sans la modifier ni la
 * créer. Renvoie l'objet au format d'export v1, ou null s'il n'y a rien à reprendre.
 */
export async function readLegacyV1({ factory = globalThis.indexedDB } = {}) {
  if (!factory) return null;
  try {
    if (typeof factory.databases === 'function') {
      const list = await factory.databases();
      if (!list.some((d) => d.name === 'budget-app')) return null;
    }
    const db = await new Promise((resolve, reject) => {
      const request = factory.open('budget-app');
      request.onupgradeneeded = () => {
        // La base n'existait pas : on annule pour ne pas en créer une vide.
        request.transaction.abort();
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains('collections')) {
      db.close();
      return null;
    }
    const tx = db.transaction('collections', 'readonly');
    const os = tx.objectStore('collections');
    const read = async (key) => {
      const value = await wrap(os.get(key));
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value ?? null;
    };
    const [operations, envelopes, tags, recurring, reconciliation] = await Promise.all(['operations', 'envelopes', 'tags', 'recurring', 'reconciliation'].map(read));
    db.close();
    if (!Array.isArray(operations) || !operations.length) return null;
    return { operations, envelopes: envelopes || [], tags: tags || [], recurring: recurring || [], reconciliation: reconciliation || [] };
  } catch {
    return null;
  }
}
