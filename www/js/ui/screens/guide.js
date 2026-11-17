// Mode d'emploi (le « LISEZ-MOI » de l'appli) : des questions, des réponses courtes.

import { h } from '../dom.js';
import { subTopbar } from '../shell.js';

// Chaque réponse est une liste de blocs : une chaîne = un paragraphe, un tableau = une liste à puces.
// Le texte entre ** ** est mis en gras.
const SECTIONS = [
  {
    q: "L'essentiel en une minute",
    a: [
      "Tu notes tes dépenses et tes revenus (bouton **+**). L'appli calcule ce qu'il te reste et te montre où part ton argent.",
      [
        "**Opérations** : la liste de tout ce qui est entré et sorti, la plus récente en haut.",
        "**Enveloppes** : de l'argent mis de côté pour un projet.",
        "**Prévisions** : ce qui va arriver (loyer, salaire…) et le solde que tu auras à une date.",
        "**Stats** : des graphiques pour comprendre.",
        "**Plus** : relevés bancaires, sauvegardes, réglages, commentaires pour Claude.",
      ],
      "Tes comptes restent sur ton téléphone : ils ne sont jamais envoyés sur internet.",
    ],
  },
  {
    q: "Installer l'appli sur le téléphone",
    a: [
      "Ouverte dans le navigateur, l'appli peut s'**installer** : elle a alors son icône, s'ouvre en plein écran comme n'importe quelle appli, et marche sans connexion.",
      [
        "**Android (Chrome)** : onglet Plus, bouton **Installer**. Sinon : menu ⋮ en haut à droite, « Ajouter à l'écran d'accueil », puis « Installer ».",
        "**iPhone, iPad (Safari)** : bouton Partager, puis « Sur l'écran d'accueil ».",
      ],
      "Rien n'est perdu en installant : l'appli installée retrouve ce que tu avais déjà saisi dans le navigateur.",
      "Long appui sur l'icône de l'appli : le raccourci **Nouvelle opération** ouvre directement la saisie.",
    ],
  },
  {
    q: 'Les mises à jour',
    a: [
      "L'appli se met à jour toute seule. Quand une nouvelle version est arrivée, un bandeau **Une nouvelle version est prête** apparaît en haut : touche **Mettre à jour** quand tu veux. Sinon, elle prendra le relais au prochain lancement.",
      "Après une mise à jour, l'appli t'annonce ce qui a changé. Tu retrouves cette liste dans Plus › À propos.",
      "Une mise à jour ne touche jamais à tes données.",
    ],
  },
  {
    q: 'Compte courant, solde total : quelle différence ?',
    a: [
      "Le **solde total**, c'est ce que ta banque affiche.",
      "Le **compte courant**, c'est ce même montant, moins ce que tu as rangé dans tes enveloppes. C'est l'argent vraiment disponible pour les dépenses de tous les jours.",
      "Exemple : 2 000 € en banque, dont 500 € dans l'enveloppe Vacances. Solde total 2 000 €, compte courant 1 500 €.",
    ],
  },
  {
    q: 'Comment marchent les enveloppes ?',
    a: [
      "Une enveloppe réserve de l'argent pour un projet, sans le sortir de ta banque.",
      [
        "**Alimenter** : un virement du compte courant vers l'enveloppe. +500 € dans l'enveloppe, −500 € sur le compte courant, solde total inchangé.",
        "**Dépense** : une dépense payée avec l'enveloppe ne touche pas au compte courant.",
        "**Retirer** ou **Vers une autre** : pour reprendre l'argent ou le déplacer.",
      ],
      "Une enveloppe ne peut pas être à découvert. Si une dépense dépasse ce qu'elle contient, l'appli te propose de virer la différence depuis le compte courant.",
      "Tu peux lui donner un **objectif** (montant, date) : une jauge montre où tu en es et combien mettre de côté chaque mois.",
      "Projet terminé ? **Clôture** l'enveloppe : le reste revient sur le compte courant, l'historique et le bilan restent consultables, et tu peux la rouvrir.",
    ],
  },
  {
    q: 'Saisir une opération',
    a: [
      "Bouton **+**, choisis Dépense, Revenu ou Virement, tape le montant. Le reste est facultatif :",
      [
        "**Libellé** et **destinataire** : pour t'y retrouver et pour les statistiques.",
        "**Importance** : Nécessité, Confort ou Caprice. Utile pour voir ce que tu pourrais réduire.",
        "**Tags** : tes catégories, plusieurs possibles par opération.",
        "**Photo du ticket** : avec l'appareil photo ou depuis la galerie.",
        "**Répéter** : transforme la saisie en récurrence (loyer, abonnement…).",
      ],
      "Si tu fermes le formulaire par erreur, ta saisie est gardée en brouillon et revient à la prochaine ouverture.",
      "Pour modifier ou supprimer : touche l'opération dans la liste. Pour en traiter plusieurs d'un coup : appui long sur une ligne, ou l'icône de sélection en haut.",
    ],
  },
  {
    q: 'Annuler une erreur',
    a: [
      "Après chaque action, un petit bouton **Annuler** apparaît quelques secondes en bas à gauche. Il fonctionne pour un ajout, une modification, une suppression, un import de relevé…",
      "Les 5 dernières actions peuvent être annulées, l'une après l'autre. Si le bouton a disparu, tu le retrouves en haut de l'onglet **Plus**.",
    ],
  },
  {
    q: 'Prévisions et simulations',
    a: [
      "Une **prévision** est une opération simulée : elle ne change pas ton solde réel. Elle sert à répondre à « combien me restera-t-il le 30 ? ».",
      [
        "Choisis une date : l'appli affiche le compte courant estimé ce jour-là.",
        "**Coche ou décoche** une ligne pour voir ce que ça change (« et si je ne faisais pas ce week-end ? »).",
        "Quand une prévision a vraiment eu lieu, ouvre-la et touche **Elle a eu lieu**.",
      ],
      "Dans cette liste, le plus proche dans le temps est en bas.",
    ],
  },
  {
    q: 'Récurrences',
    a: [
      "Pour ce qui revient à intervalle fixe : salaire, loyer, abonnements, épargne mensuelle vers une enveloppe.",
      "Les échéances à venir apparaissent dans Prévisions. **Le jour venu, elles deviennent de vraies opérations toutes seules**, même si tu n'ouvres pas l'appli ce jour-là (elle se met à jour à l'ouverture suivante).",
      [
        "Une échéance que tu as décochée ne se valide pas seule : à toi de la confirmer ou de la supprimer.",
        "**Pause** : plus aucune échéance tant que tu ne la relances pas.",
        "**Supprimer** : tu choisis de garder les opérations passées ou de tout retirer.",
        "Modifier une récurrence ne change que les échéances à venir.",
      ],
    ],
  },
  {
    q: 'Rapprochement avec la banque',
    a: [
      "Le but : vérifier que l'appli et ta banque disent la même chose.",
      [
        "**Rapide** : Plus › Rapprochement. Tu saisis le solde affiché par la banque, l'appli montre l'écart et peut l'ajuster.",
        "**Complet** : Plus › Importer un relevé. L'appli lit ton relevé (PDF, OFX ou CSV) et le compare ligne à ligne avec tes opérations.",
      ],
      "Pendant l'import, trois cas : les opérations **retrouvées** (même montant, date proche) sont complétées avec les informations de la banque ; celles **qui manquent** dans l'appli sont proposées à l'ajout, déjà remplies ; celles **en trop** dans l'appli te sont montrées (souvent un paiement pas encore débité).",
      "Une opération retrouvée sur un relevé porte une double coche verte : elle est **pointée**.",
      "Les soldes imprimés sur le relevé servent de preuve : l'appli vérifie que sa lecture retombe dessus au centime près.",
    ],
  },
  {
    q: 'Les statistiques',
    a: [
      "Choisis la période en haut : tous les graphiques suivent. Touche une barre ou une colonne pour voir les opérations correspondantes.",
      "Chaque graphique a une icône tableau, en haut à droite de sa carte, pour lire les chiffres exacts.",
      "Seules les vraies dépenses et les vrais revenus sont comptés : ni les virements vers les enveloppes, ni les prévisions.",
    ],
  },
  {
    q: 'Où sont mes données ? Comment les sauvegarder ?',
    a: [
      "Dans l'appli, sur ton téléphone. Si tu changes de téléphone, désinstalles l'appli ou effaces ses données, il faut une sauvegarde pour les retrouver.",
      [
        "**Sauvegarde complète** (Plus › Sauvegarde et données) : un fichier ZIP avec tout, photos comprises. Envoie-le-toi par mail ou range-le sur un Drive.",
        "**Copie automatique dans un dossier** : dans Plus › Sauvegarde et données, choisis une fois un dossier du téléphone (par exemple Documents/MonBudget). L'appli y écrit une sauvegarde par jour (les 7 dernières sont gardées) et y range tes exports. Si le téléphone redemande l'accès au dossier, un bouton **Autoriser** apparaît.",
        "**Classeur Excel** ou **CSV** : pour consulter ou imprimer, pas pour restaurer.",
      ],
      "Pour restaurer : Plus › Sauvegarde et données › Importer une sauvegarde. Tu peux **ajouter** au contenu actuel ou **tout remplacer**.",
    ],
  },
  {
    q: 'Protéger l\'appli par un code',
    a: [
      "Plus › Sécurité. Le code est demandé à l'ouverture et après une minute en arrière-plan.",
      "Attention : personne ne peut te renvoyer un code oublié. Fais une sauvegarde avant de l'activer.",
    ],
  },
  {
    q: 'Écrire à Claude : un problème, une idée, une question',
    a: [
      "Plus › **Commentaires pour Claude**. Choisis Problème, Idée ou Question, écris avec tes mots, ajoute une capture d'écran si ça aide. Les informations techniques utiles (version, téléphone, dernier message d'erreur) sont jointes toutes seules ; aucune de tes opérations n'y figure.",
      [
        "**Connexion réglée** (Plus › Connexion à Claude, une seule fois) : le bouton **Envoyer à Claude** dépose le commentaire dans ta boîte privée. Sans réseau, il attend et part tout seul plus tard.",
        "**Sans connexion réglée** : le commentaire est gardé dans l'appli et tu le partages à la main (mail, messagerie).",
      ],
      "Claude lit le commentaire, modifie l'appli et te répond : sa réponse s'affiche sous ton commentaire, et un point apparaît sur l'onglet Plus. Tu peux lui répondre au même endroit. Quand c'est réglé, le commentaire passe à **Traité**, et la correction arrive avec la mise à jour suivante.",
    ],
  },
  {
    q: 'Quelque chose ne marche pas',
    a: [
      "Écris-le dans Plus › **Commentaires pour Claude**, en choisissant « Problème ».",
      "Plus › À propos › **Lancer la vérification** teste le stockage, l'écriture des fichiers et le fonctionnement sans connexion.",
    ],
  },
  {
    q: "Ce que l'appli ne fait pas",
    a: [
      [
        "Elle ne se connecte pas à ta banque : c'est toi qui importes tes relevés.",
        "Elle gère un seul compte bancaire (avec autant d'enveloppes que tu veux).",
        "Elle ne synchronise pas entre plusieurs téléphones : on passe par une sauvegarde.",
      ],
    ],
  },
];

function rich(text) {
  const out = [];
  text.split('**').forEach((part, i) => {
    if (!part) return;
    out.push(i % 2 ? h('b', part) : part);
  });
  return out;
}

export function createGuideScreen(app) {
  const top = subTopbar(app, "Mode d'emploi");
  const content = h('div.pad');
  const card = h('div.card.guide');
  SECTIONS.forEach((section, index) => {
    const answer = h('div.answer');
    for (const block of section.a) {
      if (Array.isArray(block)) answer.appendChild(h('ul', block.map((item) => h('li', rich(item)))));
      else answer.appendChild(h('p', rich(block)));
    }
    card.appendChild(h('details', { open: index === 0 ? true : null }, h('summary', section.q), answer));
  });
  content.appendChild(card);
  const el = h('section.screen', { dataset: { screen: 'guide' } }, top.el, h('main.scroll', content, h('div.bottom-space')));
  return { el, update() {} };
}
