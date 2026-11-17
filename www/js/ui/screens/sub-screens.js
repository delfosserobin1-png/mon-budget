// Les sous-écrans (ceux qu'on ouvre depuis un onglet et qu'on quitte avec « retour »).
// Pour en ajouter un : écrire sa fabrique `createXxxScreen(app, params)` et l'inscrire ici ;
// on l'ouvre ensuite avec app.open('nom', params).

import { createBackupScreen, createReconcileScreen, createArchivesScreen } from './data-screens.js';
import { createTagsScreen, createRulesScreen, createSecurityScreen, createAboutScreen } from './settings-screens.js';
import { createGuideScreen } from './guide.js';
import { createBugsScreen } from './bugs.js';
import { createClaudeScreen } from './claude.js';
import { createStatementScreen } from './statement.js';

export const SUB_SCREENS = {
  statement: createStatementScreen,
  reconcile: createReconcileScreen,
  archives: createArchivesScreen,
  backup: createBackupScreen,
  tags: createTagsScreen,
  rules: createRulesScreen,
  security: createSecurityScreen,
  about: createAboutScreen,
  guide: createGuideScreen,
  bugs: createBugsScreen, // « Commentaires pour Claude » (l'ancien « Signaler un bug »)
  claude: createClaudeScreen,
};
