// Premier lancement : on propose de partir du solde du compte, d'un relevé ou d'une sauvegarde.

import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { openSheet } from '../overlays.js';
import { amountField, dateField, toggle } from '../fields.js';
import { planOpeningBalance } from '../../core/reconciliation.js';

export function maybeOnboard(app) {
  if (app.setting('onboarded') || !app.store.isEmpty) return null;
  return openOnboarding(app);
}

export function openOnboarding(app) {
  const body = h('div.stack.loose');
  const sheet = openSheet({ title: 'Bienvenue', body, label: 'Bienvenue dans Mon Budget' });
  const done = () => app.setSetting('onboarded', true, { silent: true }).catch(() => {});
  sheet.closed.then(done);

  function item(iconName, title, hint, action, name) {
    return h('button.menu-item', { type: 'button', dataset: { action: name }, onclick: action }, icon(iconName), h('span.texts', h('b', title), h('span', hint)), h('span.chev', icon('right')));
  }

  function showChoices() {
    clear(body);
    body.appendChild(h('p.note', "Tes comptes restent sur ton téléphone : pas d'inscription, rien n'est envoyé sur internet."));
    body.appendChild(
      h(
        'div.menu',
        item('wallet', 'Saisir le solde de mon compte', "Le plus rapide : le montant qu'affiche ta banque aujourd'hui.", showBalance, 'start-balance'),
        item(
          'bank',
          'Importer un relevé bancaire',
          'PDF, OFX ou CSV : le solde de départ est lu dessus.',
          () => {
            sheet.close();
            app.open('statement');
          },
          'start-statement',
        ),
        item(
          'upload',
          'Restaurer une sauvegarde',
          "Reprendre les données d'un autre téléphone ou de l'ancienne version.",
          () => {
            sheet.close();
            app.open('backup');
          },
          'start-restore',
        ),
      ),
    );
    body.appendChild(
      h(
        'div.menu',
        item(
          'book',
          "Essayer avec des données d'exemple",
          'Un budget fictif pour découvrir. Tu effaceras tout d\'un geste.',
          async () => {
            sheet.close();
            await app.loadDemo();
            app.notify("Données d'exemple chargées");
          },
          'start-demo',
        ),
      ),
    );
    body.appendChild(h('button.btn.quiet.block', { type: 'button', dataset: { action: 'start-later' }, onclick: () => sheet.close() }, 'Commencer sans rien pour l\'instant'));
  }

  function showBalance() {
    clear(body);
    const today = app.today();
    const amount = amountField({ label: 'Solde affiché par ta banque', autofocus: true });
    const date = dateField({ label: 'À la date du', value: today });
    const negative = toggle({ label: 'Mon compte est à découvert', hint: 'Le montant saisi sera compté en négatif.' });
    const save = h('button.btn.primary.block', { type: 'button', dataset: { action: 'save-balance' } }, 'Commencer avec ce solde');
    save.addEventListener('click', async () => {
      const cents = amount.cents;
      if (cents === null) {
        amount.setError(amount.isEmpty ? 'Indique le solde de ton compte (0 si tu pars de zéro).' : 'Montant illisible. Exemple : 1250,40');
        return;
      }
      const plan = planOpeningBalance(app.state, { date: date.value, amount: negative.value ? -cents : cents });
      if (!plan.ok) {
        (plan.errors[0].field === 'date' ? date : amount).setError(plan.errors[0].message);
        return;
      }
      if (cents === 0) {
        sheet.close();
        return;
      }
      if (await app.commit(plan.cs, { label: 'Solde de départ enregistré' })) sheet.close();
    });
    body.appendChild(
      h(
        'div.stack.loose',
        h('p.note', "C'est le point de départ de tes comptes. Tu pourras le corriger plus tard : il apparaît comme une ligne « Solde de départ » dans les opérations."),
        amount.el,
        date.el,
        negative.el,
        save,
        h('button.btn.quiet.block', { type: 'button', onclick: showChoices }, 'Retour'),
      ),
    );
    amount.focus();
  }

  showChoices();
  return sheet;
}
