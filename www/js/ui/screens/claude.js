// Connexion à Claude : le réglage, fait une seule fois, qui permet d'envoyer ses commentaires
// d'un geste et de recevoir les réponses dans l'appli.
//
// La « boîte à commentaires » est un dépôt GitHub privé. Il faut deux informations : son adresse
// (« ton-nom/mon-budget-commentaires ») et un jeton d'accès limité à cette boîte. Les deux restent
// dans les réglages de ce téléphone : ils ne font partie d'aucune sauvegarde ni d'aucun export.

import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { subTopbar } from '../shell.js';
import { alertDialog, confirmDialog } from '../overlays.js';
import { textField } from '../fields.js';
import { formatDate } from '../../core/dates.js';
import { isToken, parseLinkCode, parseRepo, queuedComments } from '../../core/comments.js';
import { COMMENTS_REPO } from '../../config.js';

const HOW_TO = [
  "La boîte à commentaires est un dépôt GitHub privé, créé par Claude avec ton accord au moment de publier l'appli. Son adresse ressemble à « ton-nom/mon-budget-commentaires ».",
  "Le jeton d'accès est une clé limitée à cette boîte. Touche « Créer le jeton sur GitHub » : le formulaire s'ouvre déjà rempli (connecte-toi à GitHub si on te le demande).",
  "Dans « Repository access », choisis « Only select repositories » et coche uniquement la boîte à commentaires. Vérifie que « Issues » et « Contents » sont sur « Read and write », puis touche « Generate token ».",
  "Copie le jeton affiché (il commence par « github_pat_ »), reviens ici et colle-le. GitHub ne le montre qu'une fois : s'il est perdu, on en crée simplement un autre.",
].join('\n\n');

// Le formulaire de création de jeton de GitHub, déjà rempli : nom, droits (Issues et Contents en
// lecture et écriture), sans date d'expiration. Il reste à choisir le dépôt et à valider.
const TOKEN_URL = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
  name: 'Mon Budget (appli)',
  description: "Envoi des commentaires depuis l'appli Mon Budget",
  expires_in: 'none',
  issues: 'write',
  contents: 'write',
})}`;

export function createClaudeScreen(app) {
  const top = subTopbar(app, 'Connexion à Claude');
  const content = h('div.pad.stack.loose');
  const el = h('section.screen', { dataset: { screen: 'claude' } }, top.el, h('main.scroll', content, h('div.bottom-space')));

  let busy = false;
  const known = parseRepo(COMMENTS_REPO);
  const repo = textField({
    label: 'Adresse de la boîte à commentaires',
    name: 'repo',
    value: known || '',
    placeholder: 'ton-nom/mon-budget-commentaires',
    maxLength: 400,
    autocapitalize: 'none',
    hint: known ? 'Déjà remplie : il ne reste qu’à coller le jeton.' : 'Tu peux aussi coller ici le code de connexion complet.',
  });
  const token = textField({ label: "Jeton d'accès", name: 'token', type: 'password', placeholder: 'github_pat_…', maxLength: 300, autocapitalize: 'none' });
  repo.input.setAttribute('spellcheck', 'false');
  repo.input.setAttribute('autocorrect', 'off');
  token.input.setAttribute('spellcheck', 'false');
  const reveal = h('button.btn.small.quiet', { type: 'button', dataset: { action: 'reveal-token' } }, 'Afficher le jeton');
  reveal.addEventListener('click', () => {
    const shown = token.input.type === 'text';
    token.input.type = shown ? 'password' : 'text';
    clear(reveal).appendChild(document.createTextNode(shown ? 'Afficher le jeton' : 'Masquer le jeton'));
  });
  const connectBtn = h('button.btn.primary.block', { type: 'button', dataset: { action: 'connect' } }, icon('link'), 'Connecter');

  // Un code de connexion collé d'un bloc (« boîte:jeton ») remplit les deux champs.
  repo.input.addEventListener('input', () => {
    const code = parseLinkCode(repo.input.value);
    if (!code) return;
    repo.value = code.repo;
    token.value = code.token;
    token.setError('');
  });

  async function connect() {
    if (busy) return;
    const code = parseLinkCode(repo.value);
    const address = code ? code.repo : parseRepo(repo.value);
    const secret = (code ? code.token : token.value).trim();
    if (!address) {
      repo.setError("Écris l'adresse sous la forme « ton-nom/nom-de-la-boite ».");
      repo.focus();
      return;
    }
    if (!isToken(secret)) {
      token.setError(secret ? "Ce jeton n'a pas la bonne forme : colle-le en entier, sans espace." : "Colle le jeton d'accès.");
      token.focus();
      return;
    }
    busy = true;
    connectBtn.disabled = true;
    try {
      let result = await app.claude.connect({ repo: address, token: secret });
      if (!result.ok && result.code === 'public') {
        const sure = await confirmDialog({
          title: 'Cette boîte est publique',
          message: "N'importe qui pourrait lire tes commentaires. Mieux vaut un dépôt privé.\n\nSi tu continues quand même, les captures d'écran ne seront jamais envoyées.",
          confirmLabel: 'Connecter quand même',
          cancelLabel: 'Annuler',
          danger: true,
        });
        if (!sure) return;
        result = await app.claude.connect({ repo: address, token: secret, allowPublic: true });
      }
      if (!result.ok) {
        (result.code === 'missing' || result.code === 'issues' ? repo : token).setError(result.error);
        return;
      }
      repo.value = known || '';
      token.value = '';
      app.notify('Connecté à Claude');
      const waiting = queuedComments(app.state).length;
      app.claude.sync({ force: true }).then((sync) => {
        if (sync.ok && waiting && sync.sent) app.notify(sync.sent > 1 ? `${sync.sent} commentaires en attente envoyés` : 'Commentaire en attente envoyé');
      });
    } finally {
      busy = false;
      connectBtn.disabled = false;
    }
  }
  connectBtn.addEventListener('click', connect);
  token.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') connect();
  });

  async function disconnect() {
    const waiting = queuedComments(app.state).length;
    const ok = await confirmDialog({
      title: 'Déconnecter Claude ?',
      message: `Le jeton sera effacé de ce téléphone. Tes commentaires restent dans l'appli${waiting ? ' ; ceux qui attendaient un envoi ne partiront plus' : ''}. Tu pourras te reconnecter quand tu veux.`,
      confirmLabel: 'Déconnecter',
      danger: true,
    });
    if (!ok) return;
    await app.claude.disconnect();
    app.notify('Claude est déconnecté');
  }

  const form = h(
    'div.card.stack',
    repo.el,
    token.el,
    h('div.btn-row', h('a.btn.small', { href: TOKEN_URL, target: '_blank', rel: 'noopener noreferrer', dataset: { action: 'create-token' } }, 'Créer le jeton sur GitHub'), reveal),
    connectBtn,
    h('button.link-btn', { type: 'button', dataset: { action: 'how-to' }, onclick: () => alertDialog({ title: 'Où trouver ces deux informations ?', message: HOW_TO }) }, 'Où trouver ces deux informations ?'),
  );

  function update() {
    const info = app.claude.info;
    const status = app.claude.status;
    clear(content);
    content.appendChild(
      h(
        'div.card.stack.tight',
        h('h2', 'À quoi ça sert'),
        h('p.note', "Une fois la connexion réglée, tu écris un commentaire dans l'appli (un problème, une idée, une question), tu touches « Envoyer à Claude », et c'est tout. Claude le lit, modifie l'appli, et sa réponse s'affiche sous ton commentaire. L'appli se met ensuite à jour toute seule."),
        h('p.note', "Seuls tes commentaires partent : ton texte, les captures que tu joins et quelques informations techniques. Tes opérations, tes montants et tes relevés ne quittent jamais le téléphone."),
      ),
    );
    if (!info) {
      content.appendChild(form);
      return;
    }
    const card = h('div.card.stack.tight', { dataset: { card: 'link' } }, h('h2', 'Connexion active'));
    card.appendChild(h('div.kv', h('span.k', 'Boîte à commentaires'), h('span.v.small', info.repo)));
    card.appendChild(h('div.kv', h('span.k', 'Visibilité'), h('span.v', info.private ? h('span.chip.good', 'Privée') : h('span.chip.warn', 'Publique'))));
    if (info.connectedAt) card.appendChild(h('div.kv', h('span.k', 'Connectée le'), h('span.v', formatDate(info.connectedAt.slice(0, 10)))));
    card.appendChild(h('div.kv', h('span.k', 'Dernier échange'), h('span.v', status.lastError ? h('span.chip.bad', 'Échec') : info.lastPullAt || status.lastSyncAt ? h('span.chip.good', 'Réussi') : 'Pas encore')));
    if (status.lastError) card.appendChild(h('p.hint', { dataset: { value: 'link-error' } }, status.lastError));
    if (!info.private) card.appendChild(h('p.hint', "Boîte publique : les captures d'écran ne sont pas envoyées."));
    card.appendChild(
      h(
        'button.btn.small',
        {
          type: 'button',
          dataset: { action: 'check-link' },
          onclick: async () => {
            const result = await app.claude.sync({ force: true });
            if (result.ok) app.notify(result.newReplies ? 'Nouvelle réponse de Claude' : 'La connexion fonctionne');
            else app.fail(result.error || 'Connexion impossible.');
          },
        },
        icon('refresh'),
        'Vérifier maintenant',
      ),
    );
    content.appendChild(card);
    content.appendChild(
      h(
        'div.menu',
        h('button.menu-item', { type: 'button', dataset: { open: 'bugs' }, onclick: () => app.open('bugs') }, icon('chat'), h('span.texts', h('b', 'Écrire un commentaire'), h('span', 'Problème, idée ou question')), h('span.chev', icon('right'))),
        h('button.menu-item.danger', { type: 'button', dataset: { action: 'disconnect' }, onclick: disconnect }, icon('x'), h('span.texts', h('b', 'Déconnecter'), h('span', 'Efface le jeton de ce téléphone')), h('span.chev', icon('right'))),
      ),
    );
  }

  const off = app.claude.onChange(() => {
    if (!el.isConnected) {
      off();
      return;
    }
    if (!el.hidden) update();
  });

  return { el, update, onClose: () => off() };
}
