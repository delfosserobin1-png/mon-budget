// Réglages de l'appli fixés à la fabrication (ceux qu'on ne change pas depuis l'écran du téléphone).

/**
 * Adresse e-mail qui reçoit les signalements de bugs.
 * Vide par défaut : le bouton « Partager » laisse alors chacun choisir son destinataire.
 * Si tu diffuses l'appli à d'autres personnes, indique ici ton adresse : un bouton
 * « Envoyer par e-mail » apparaîtra dans Plus › Signaler un bug, pré-rempli vers cette adresse.
 * Exemple : export const BUG_REPORT_EMAIL = 'prenom.nom@exemple.fr';
 */
export const BUG_REPORT_EMAIL = '';

/**
 * Adresse de la boîte à commentaires (dépôt GitHub privé, voir docs/connexion-claude.md).
 * Elle pré-remplit l'écran Plus › Connexion à Claude : il ne reste qu'à coller le jeton d'accès.
 * Ce n'est pas un secret : sans jeton, l'adresse d'un dépôt privé ne donne accès à rien.
 */
export const COMMENTS_REPO = 'delfosserobin1-png/mon-budget-commentaires';
