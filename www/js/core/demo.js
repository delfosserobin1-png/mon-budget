// Données d'exemple : un petit budget fictif, construit autour de la date du jour, pour découvrir
// l'appli sans rien saisir (et pour les tests). Tout passe par les mêmes règles métier que les
// vraies saisies : les données d'exemple respectent donc les mêmes garanties (aucune enveloppe à
// découvert, soldes cohérents…).

import { apply, cloneState } from './changeset.js';
import { emptyState, makeEnvelope, makeTag, KIND } from './schema.js';
import { addDays, addMonths, makeISO, parts, startOfMonth, weekday } from './dates.js';
import { planSaveOperation, planSaveTransfer, topupChangeset } from './operations.js';
import { planSaveRecurring } from './recurring.js';
import { planOpeningBalance, planReconciliation, planAdjustment } from './reconciliation.js';
import { merge, Draft } from './changeset.js';
import { learnInto } from './rules.js';

/** Générateur pseudo-aléatoire reproductible (les données d'exemple sont identiques d'un essai à l'autre). */
function generator(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

export function buildDemoState(today) {
  let state = emptyState();
  const random = generator(20261115);
  const between = (min, max) => Math.round(min + random() * (max - min));
  const run = (plan) => {
    if (!plan.ok) throw new Error(`Données d'exemple refusées : ${plan.errors[0].message}`);
    if (plan.topups && plan.topups.length) merge(plan.cs, topupChangeset(state, plan.topups));
    state = apply(cloneState(state), plan.cs);
    return plan;
  };
  const ctx = { today };

  const tag = (id, name, color, quota = null) => makeTag({ id: `tag_demo_${id}`, name, color, quota });
  state.tags = [
    tag('courses', 'Courses', 'vert', { amount: 40000, period: 'month' }),
    tag('resto', 'Restaurant', 'ambre', { amount: 6000, period: 'week' }),
    tag('transport', 'Transport', 'bleu'),
    tag('loisirs', 'Loisirs', 'violet'),
    tag('sante', 'Santé', 'rose'),
    tag('logement', 'Logement', 'ardoise'),
    tag('abonnements', 'Abonnements', 'sarcelle'),
  ];
  const T = Object.fromEntries(state.tags.map((t) => [t.id.replace('tag_demo_', ''), t.id]));
  state.envelopes = [
    makeEnvelope({ id: 'env_demo_vacances', name: 'Vacances', description: "Une semaine au bord de la mer l'été prochain", color: 'sarcelle', goalAmount: 150000, goalDate: addMonths(today, 8) }),
    makeEnvelope({ id: 'env_demo_voiture', name: 'Voiture', description: 'Entretien, pneus, contrôle technique', color: 'ambre', goalAmount: 80000 }),
    makeEnvelope({ id: 'env_demo_cadeaux', name: 'Cadeaux', description: '', color: 'rose' }),
  ];

  const start = addDays(today, -100);
  run(planOpeningBalance(state, { date: start, amount: 184250 }));

  // --- ce qui revient chaque mois ---
  const firstOf = (monthsBack, day) => {
    const { year, month } = parts(addMonths(startOfMonth(today), -monthsBack));
    return makeISO(year, month, day);
  };
  const recurring = (input) => run(planSaveRecurring(state, input, { today, backfill: true }));
  recurring({ kind: KIND.OPERATION, label: 'Salaire', amount: 225000, frequency: 'monthly', startDate: firstOf(3, 28), counterparty: 'Atelier Durand' });
  recurring({ kind: KIND.OPERATION, label: 'Loyer', amount: -72000, frequency: 'monthly', startDate: firstOf(3, 5), counterparty: 'Agence des Lilas', tags: [T.logement], importance: 'necessite' });
  recurring({ kind: KIND.OPERATION, label: 'Forfait mobile', amount: -1599, frequency: 'monthly', startDate: firstOf(3, 12), counterparty: 'Téléphone Exemple', tags: [T.abonnements], importance: 'necessite' });
  recurring({ kind: KIND.OPERATION, label: 'Films et séries', amount: -1349, frequency: 'monthly', startDate: firstOf(3, 20), counterparty: 'Vidéo Exemple', tags: [T.abonnements, T.loisirs], importance: 'confort' });
  recurring({ kind: KIND.OPERATION, label: 'Assurance habitation', amount: -18600, frequency: 'yearly', startDate: addMonths(today, 2), counterparty: 'Assurances Exemple', tags: [T.logement], importance: 'necessite' });
  recurring({ kind: KIND.TRANSFER, label: 'Épargne vacances', amount: 15000, frequency: 'monthly', startDate: firstOf(3, 1), from: null, to: 'env_demo_vacances' });

  // --- virements ponctuels vers les enveloppes ---
  const transfer = (date, to, amount, label = '') => run(planSaveTransfer(state, { date, from: null, to, amount, label }, ctx));
  transfer(addDays(today, -80), 'env_demo_voiture', 40000, 'Mise de départ');
  transfer(addDays(today, -62), 'env_demo_cadeaux', 12000);
  transfer(addDays(today, -20), 'env_demo_voiture', 10000);

  // --- la vie de tous les jours, sur 90 jours ---
  const spend = (date, cents, label, counterparty, tags, importance, extra = {}) => {
    const plan = run(planSaveOperation(state, { date, amount: -cents, label, counterparty, tags, importance, ...extra }, ctx));
    const learner = new Draft(state);
    learnInto(learner, plan.op);
    state = apply(cloneState(state), learner.cs);
  };
  const shops = ['Marché des Halles', 'Supermarché du Centre', 'Épicerie Verte'];
  const restaurants = ['Auberge du Pont', 'Chez Lucie', 'Trattoria Roma'];
  for (let d = 90; d >= 1; d--) {
    const date = addDays(today, -d);
    const dow = weekday(date);
    if (dow === 6 || dow === 3) spend(date, between(2800, 7400), 'Courses', shops[between(0, 2)], [T.courses], 'necessite');
    if (dow === 5 && random() < 0.6) spend(date, between(1600, 4200), 'Restaurant', restaurants[between(0, 2)], [T.resto], random() < 0.5 ? 'confort' : 'caprice');
    if (dow === 1 && random() < 0.7) spend(date, between(3800, 6100), 'Essence', 'Station du Rond-Point', [T.transport], 'necessite');
    if (random() < 0.07) spend(date, between(900, 3200), 'Pharmacie', 'Pharmacie Centrale', [T.sante], 'necessite');
    if (random() < 0.08) spend(date, between(1200, 2900), 'Cinéma', 'Cinéma Le Studio', [T.loisirs], 'caprice');
    if (random() < 0.05) spend(date, between(500, 1400), 'Café', 'Café de la Gare', [T.resto], 'caprice', { time: '08:15' });
  }
  spend(addDays(today, -41), 8900, 'Billets de train', 'Trains Exemple', [T.transport, T.loisirs], 'confort', { envelopeId: 'env_demo_vacances', comment: 'Aller-retour pour le repérage' });
  spend(addDays(today, -33), 4500, "Cadeau d'anniversaire", 'Librairie des Arts', [T.loisirs], 'confort', { envelopeId: 'env_demo_cadeaux' });
  spend(addDays(today, -12), 16500, 'Révision annuelle', 'Garage Martin', [T.transport], 'necessite', { envelopeId: 'env_demo_voiture' });
  run(planSaveOperation(state, { date: addDays(today, -9), amount: 2390, label: 'Remboursement livre', counterparty: 'Librairie des Arts', tags: [T.loisirs] }, ctx));
  run(planSaveOperation(state, { date: addDays(today, -3), amount: 4500, label: 'Remboursement de Julie', counterparty: 'Julie Moreau', comment: 'Sa part du restaurant' }, ctx));

  // --- un rapprochement avec la banque, avec un petit écart ajusté ---
  const checkDate = addDays(today, -30);
  let balanceThen = 0;
  for (const op of state.operations) if (!op.simulated && op.kind !== KIND.TRANSFER && op.date <= checkDate) balanceThen += op.amount;
  const reconciliation = run(planReconciliation(state, { date: checkDate, realBalance: balanceThen - 420 }));
  run(planAdjustment(state, reconciliation.record.id));

  // --- quelques prévisions ---
  run(planSaveOperation(state, { date: addDays(today, 9), amount: -32000, label: 'Pneus hiver', counterparty: 'Garage Martin', tags: [T.transport], importance: 'necessite', envelopeId: 'env_demo_voiture', simulated: true }, ctx));
  run(planSaveOperation(state, { date: addDays(today, 20), amount: -18000, label: 'Week-end à Lyon', tags: [T.loisirs], importance: 'caprice', simulated: true, checked: false }, ctx));
  run(planSaveOperation(state, { date: addDays(today, 26), amount: 12000, label: 'Prime de fin d\'année', counterparty: 'Atelier Durand', simulated: true }, ctx));
  return state;
}
