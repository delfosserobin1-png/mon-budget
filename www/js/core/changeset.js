// Lots de modifications (« changesets »).
//
// Toute modification des données — créer une opération, supprimer une enveloppe, importer un
// relevé entier — est décrite par UN objet :
//     { put: { operations: [fiche, …], … }, del: { operations: [id, …], … } }
// Avantages : (1) la modification est appliquée d'un bloc, jamais à moitié ; (2) on sait calculer
// automatiquement son inverse, donc « Annuler » fonctionne pour n'importe quelle action sans code
// spécifique ; (3) la logique métier reste testable sans base de données ni interface.

import { STORES } from './schema.js';

export function emptyChangeset() {
  return { put: {}, del: {} };
}

export function isEmpty(cs) {
  return !STORES.some((s) => (cs.put?.[s]?.length || 0) + (cs.del?.[s]?.length || 0) > 0);
}

/** Ajoute (ou remplace) des fiches dans un lot en cours de construction. */
export function put(cs, store, ...records) {
  const target = (cs.put[store] ||= []);
  for (const rec of records) {
    const i = target.findIndex((r) => r.id === rec.id);
    if (i >= 0) target[i] = rec;
    else target.push(rec);
    const d = cs.del[store];
    if (d) {
      const j = d.indexOf(rec.id);
      if (j >= 0) d.splice(j, 1);
    }
  }
  return cs;
}

/** Marque des fiches à supprimer dans un lot en cours de construction. */
export function del(cs, store, ...ids) {
  const target = (cs.del[store] ||= []);
  for (const id of ids) {
    if (!target.includes(id)) target.push(id);
    const p = cs.put[store];
    if (p) {
      const j = p.findIndex((r) => r.id === id);
      if (j >= 0) p.splice(j, 1);
    }
  }
  return cs;
}

/** Fusionne `b` dans `a` (comme si `b` était appliqué juste après `a`). */
export function merge(a, b) {
  for (const store of STORES) {
    if (b.put?.[store]?.length) put(a, store, ...b.put[store]);
    if (b.del?.[store]?.length) del(a, store, ...b.del[store]);
  }
  return a;
}

/**
 * Calcule le lot inverse : appliqué après `cs`, il remet l'état exactement comme avant.
 * À appeler AVANT d'appliquer `cs`.
 */
export function invert(state, cs) {
  const inverse = emptyChangeset();
  for (const store of STORES) {
    const current = new Map(state[store].map((r) => [r.id, r]));
    for (const rec of cs.put?.[store] || []) {
      const before = current.get(rec.id);
      if (before) put(inverse, store, before);
      else del(inverse, store, rec.id);
    }
    for (const id of cs.del?.[store] || []) {
      const before = current.get(id);
      if (before) put(inverse, store, before);
    }
  }
  return inverse;
}

/** Applique un lot à un état (modifie l'objet `state` reçu et le renvoie). */
export function apply(state, cs) {
  for (const store of STORES) {
    const puts = cs.put?.[store];
    const dels = cs.del?.[store];
    if (!puts?.length && !dels?.length) continue;
    const delSet = new Set(dels || []);
    const putMap = new Map((puts || []).map((r) => [r.id, r]));
    const next = [];
    for (const rec of state[store]) {
      if (delSet.has(rec.id)) continue;
      if (putMap.has(rec.id)) {
        next.push(putMap.get(rec.id));
        putMap.delete(rec.id);
      } else {
        next.push(rec);
      }
    }
    for (const rec of putMap.values()) next.push(rec);
    state[store] = next;
  }
  return state;
}

/** Copie légère d'un état (les tableaux sont dupliqués, pas les fiches — elles sont immuables par convention). */
export function cloneState(state) {
  const copy = { settings: { ...state.settings } };
  for (const store of STORES) copy[store] = state[store].slice();
  return copy;
}

/** Compte les fiches touchées (pour les messages : « 12 opérations supprimées »). */
export function countChanges(cs, store) {
  return (cs.put?.[store]?.length || 0) + (cs.del?.[store]?.length || 0);
}

/**
 * Brouillon de travail : une copie de l'état sur laquelle on enchaîne des modifications tout en
 * accumulant le lot correspondant. La logique métier travaille toujours sur un brouillon, jamais
 * sur l'état réel : tant que le lot n'est pas validé (commit), rien n'a changé pour l'utilisateur.
 */
export class Draft {
  constructor(state) {
    this.state = cloneState(state);
    this.cs = emptyChangeset();
    this.index = {};
  }

  indexOf(store) {
    if (!this.index[store]) {
      const map = new Map();
      this.state[store].forEach((rec, i) => map.set(rec.id, i));
      this.index[store] = map;
    }
    return this.index[store];
  }

  get(store, id) {
    const i = this.indexOf(store).get(id);
    return i === undefined ? null : this.state[store][i];
  }

  put(store, rec) {
    const map = this.indexOf(store);
    const i = map.get(rec.id);
    if (i === undefined) {
      map.set(rec.id, this.state[store].length);
      this.state[store].push(rec);
    } else {
      this.state[store][i] = rec;
    }
    put(this.cs, store, rec);
    return rec;
  }

  del(store, id) {
    const map = this.indexOf(store);
    const i = map.get(id);
    if (i === undefined) return;
    this.state[store].splice(i, 1);
    this.index[store] = null; // les positions ont bougé : l'index sera reconstruit à la demande
    del(this.cs, store, id);
  }
}
