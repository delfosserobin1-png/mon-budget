// Les données d'exemple doivent respecter toutes les garanties de l'appli, quelle que soit la date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoState } from '../../www/js/core/demo.js';
import { computeBalances, envelopeLowPoint } from '../../www/js/core/balances.js';
import { tick } from '../../www/js/core/recurring.js';
import { isEmpty } from '../../www/js/core/changeset.js';
import { exportData, readImport } from '../../www/js/core/portable.js';
import { bankBalanceAt } from '../../www/js/core/reconciliation.js';

for (const today of ['2026-11-15', '2027-01-31', '2028-02-29', '2026-03-01']) {
  test(`données d'exemple au ${today} : cohérentes, sans enveloppe à découvert, stables`, () => {
    const state = buildDemoState(today);
    assert.ok(state.operations.length > 80);
    assert.equal(state.envelopes.length, 3);
    assert.equal(state.recurring.length, 6);
    const b = computeBalances(state, { upTo: today });
    assert.equal(b.total, b.available + b.envelopesTotal);
    assert.ok(b.available > 0, `compte courant positif (${b.available})`);
    for (const env of state.envelopes) assert.ok(envelopeLowPoint(state, env.id, '1900-01-01') >= 0, `${env.name} jamais négative`);
    assert.ok(state.operations.every((op) => op.simulated || op.recurringId === null || op.date <= today), 'les échéances futures sont simulées');
    assert.ok(state.operations.some((op) => op.simulated && op.recurringId), 'des échéances à venir existent');
    assert.equal(state.reconciliations.length, 1);
    assert.equal(bankBalanceAt(state, state.reconciliations[0].date), state.reconciliations[0].realBalance, "l'ajustement a comblé l'écart");
    assert.ok(state.rules.length >= 5, 'des règles automatiques ont été apprises');
    // rien à régénérer : l'état est déjà à jour pour ce jour-là
    assert.equal(isEmpty(tick(state, { today })), true);
    // identique à chaque construction (hors identifiants et horodatages)
    const again = buildDemoState(today);
    assert.deepEqual(again.operations.map((o) => [o.date, o.amount, o.label]), state.operations.map((o) => [o.date, o.amount, o.label]));
    // et l'export / import la restitue telle quelle
    const read = readImport(JSON.parse(JSON.stringify(exportData(state))));
    assert.equal(read.ok, true);
    assert.deepEqual(read.state.operations, state.operations);
  });
}
