// Plus › Banque connectée : reprendre les opérations que l'ordinateur a relevées chez la banque
// (tools/banque.mjs, via Enable Banking) et déposées, chiffrées, dans la boîte privée.
// Le téléphone garde la phrase secrète (réglage propre à l'appareil, jamais sauvegardé ni exporté),
// déchiffre le relevé, puis le confie à l'assistant d'import habituel (Plus › Importer un relevé).

import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { subTopbar } from '../shell.js';
import { confirmDialog } from '../overlays.js';
import { formatDate } from '../../core/dates.js';
import { cleanPhrase, ChiffreError, decryptText } from '../../core/chiffre.js';
import { BANK_FORMAT } from '../../io/statement/text-formats.js';

export const BANK_PHRASE_KEY = 'link:bankPhrase';
export const BANK_INFO_KEY = 'link:bank';
export const BANK_BOX_PATH = 'banque/releve.json.chiffre';

export function createBankScreen(app) {
  const top = subTopbar(app, 'Banque connectée');
  const content = h('div.pad.stack.loose');
  const el = h('section.screen', { dataset: { screen: 'bank' } }, top.el, h('main.scroll', content, h('div.bottom-space')));
  let busy = false;
  let error = '';
  let editing = false;

  const phrase = () => app.setting(BANK_PHRASE_KEY, '') || '';
  const info = () => app.setting(BANK_INFO_KEY, null);

  async function savePhrase(value) {
    const clean = cleanPhrase(value);
    if (clean.length < 12) {
      error = 'Cette phrase est trop courte : recopie celle que l’ordinateur a affichée (5 groupes de 4 signes).';
      update();
      return;
    }
    await app.setSetting(BANK_PHRASE_KEY, value.trim());
    editing = false;
    error = '';
    app.notify('Phrase secrète enregistrée sur ce téléphone');
    update();
  }

  async function forgetPhrase() {
    const ok = await confirmDialog({ title: 'Oublier la phrase secrète ?', message: 'Il faudra la saisir de nouveau pour reprendre les opérations de la banque.', confirmLabel: 'Oublier', danger: true });
    if (!ok) return;
    await app.setSetting(BANK_PHRASE_KEY, undefined);
    update();
  }

  async function fetchStatement() {
    if (busy) return;
    busy = true;
    error = '';
    update();
    try {
      const got = await app.claude.download(BANK_BOX_PATH);
      if (!got.ok) {
        error = got.code === 'missing' ? "Aucun relevé de la banque n'a encore été déposé : la connexion se fait d'abord sur l'ordinateur, avec Claude." : got.error;
        return;
      }
      const text = await decryptText(new TextDecoder().decode(got.bytes), phrase());
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!data || data.format !== BANK_FORMAT) {
        error = "Le fichier déposé n'est pas un relevé de la banque.";
        return;
      }
      await app.setSetting(BANK_INFO_KEY, { fetchedAt: String(data.fetchedAt || ''), validUntil: data.validUntil || null, lines: Array.isArray(data.lines) ? data.lines.length : 0, bank: String(data.bank || '') });
      const day = String(data.fetchedAt || '').slice(0, 10) || 'banque';
      app.open('statement', { incoming: { name: `banque-${day}.json`, bytes: new TextEncoder().encode(text), mime: 'application/json' } });
    } catch (e) {
      if (e instanceof ChiffreError) error = e.message;
      else {
        app.reportError(e, 'relevé de la banque');
        error = "Le relevé de la banque n'a pas pu être repris.";
      }
    } finally {
      busy = false;
      update();
    }
  }

  function phraseCard() {
    if (phrase() && !editing) {
      return h(
        'div.card.stack.tight',
        { dataset: { card: 'phrase' } },
        h('div.rowline.between', h('div', h('b', 'Phrase secrète'), h('div.hint', 'Enregistrée sur ce téléphone, jamais sauvegardée ni envoyée.')), icon('lock')),
        h('div.rowline', h('button.link-btn', { type: 'button', dataset: { action: 'change-phrase' }, onclick: () => ((editing = true), update()) }, 'Changer'), h('button.link-btn', { type: 'button', dataset: { action: 'forget-phrase' }, onclick: forgetPhrase }, 'Oublier')),
      );
    }
    const input = h('input.input', { type: 'password', name: 'phrase', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'xxxx-xxxx-xxxx-xxxx-xxxx', 'aria-label': 'Phrase secrète' });
    return h(
      'div.card.stack.tight',
      { dataset: { card: 'phrase' } },
      h('b', 'Phrase secrète'),
      h('p.hint', "L'ordinateur l'a affichée en installant la connexion. Elle sert à déchiffrer tes opérations : saisis-la une seule fois."),
      input,
      h('button.btn.primary.block', { type: 'button', dataset: { action: 'save-phrase' }, onclick: () => savePhrase(input.value) }, 'Enregistrer la phrase'),
    );
  }

  function update() {
    clear(content);
    content.appendChild(
      h(
        'div.notice',
        icon('bank'),
        h('div.grow', "L'ordinateur relève tes opérations chez ta banque (accès en lecture seule, accord donné dans l'appli de ta banque), les chiffre et les dépose dans ta boîte privée. Ici, un geste suffit pour les reprendre : l'assistant d'import les compare à tes opérations, complète ce qui manque et vérifie le solde."),
      ),
    );
    if (error) content.appendChild(h('div.notice.bad', { role: 'alert', dataset: { notice: 'bank-error' } }, icon('alert'), h('div.grow', error)));
    if (!app.claude.connected) {
      content.appendChild(
        h(
          'div.notice.warn',
          icon('link'),
          h('div.grow', 'Il faut d’abord régler la connexion à ta boîte privée : c’est là que l’ordinateur dépose les opérations.'),
          h('button.btn.small', { type: 'button', onclick: () => app.open('claude') }, 'Régler'),
        ),
      );
    }
    content.appendChild(phraseCard());
    const last = info();
    const ready = app.claude.connected && !!phrase();
    content.appendChild(
      h(
        'div.card.stack',
        { dataset: { card: 'fetch' } },
        h('button.btn.primary.block', { type: 'button', dataset: { action: 'fetch-bank' }, disabled: !ready || busy ? true : null, onclick: fetchStatement }, icon('download'), busy ? 'Récupération…' : 'Reprendre les opérations de la banque'),
        last
          ? h(
              'p.hint',
              { dataset: { value: 'bank-last' } },
              `Dernier relevé repris : ${last.lines} opération${last.lines > 1 ? 's' : ''}${last.bank ? ` (${last.bank})` : ''}, relevées le ${formatDate(String(last.fetchedAt).slice(0, 10))}.`,
              last.validUntil ? ` Accord de la banque valable jusqu'au ${formatDate(String(last.validUntil).slice(0, 10))}.` : '',
            )
          : h('p.hint', "Rien n'a encore été repris."),
      ),
    );
    content.appendChild(
      h(
        'div.card.stack.tight',
        h('h2', 'La première fois'),
        h(
          'ol.steps-list',
          h('li', 'Tu crées ton compte gratuit chez Enable Banking (l’intermédiaire agréé), Claude te guide.'),
          h('li', 'Claude installe la connexion sur l’ordinateur et te donne une adresse : tu y valides l’accès dans l’appli de ta banque.'),
          h('li', 'Ici, tu saisis la phrase secrète affichée par l’ordinateur.'),
        ),
        h('p.hint', "L'accord donné à la banque dure 180 jours ; l'appli te prévient quand il faut le renouveler."),
      ),
    );
  }

  update();
  return { el, update };
}
