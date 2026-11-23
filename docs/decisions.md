# Décisions prises, et pourquoi

Le questionnaire de clarification n'ayant pas été rempli, chaque point ouvert a été tranché avec le
choix le plus prudent ou le plus simple. Tout est listé ici pour que tu puisses dire « non, pas
comme ça » : aucune de ces décisions n'est coûteuse à changer.

## Ce que tu avais demandé explicitement (respecté tel quel)

| Demande | Où c'est fait |
| --- | --- |
| Dates en JJ-MM-AAAA partout | `core/dates.js` (`formatDate`), utilisé par tous les écrans |
| Le plus ancien en bas des listes ; en prévision, le plus proche en bas | `core/filters.js` (`sortNewestFirst`), `ui/screens/forecast.js` |
| Séparateur de mois discret (trait + numéro) | `ui/oprow.js` |
| « Compte courant » et « Solde total » avec bouton d'information | en-tête de l'écran Opérations |
| Enveloppe jamais négative, complément proposé avec avertissement | `core/balances.js`, `core/operations.js` |
| Prévisions en 3e onglet | `ui/app.js` (`TABS`) |
| Annulation discrète, 5 niveaux, y compris les modifications | `data/store.js`, pastille dans `ui/shell.js` |
| Toucher un virement ouvre sa fiche | `ui/forms/operation.js` |
| Sélection multiple pour supprimer | écran Opérations, bouton « Sélectionner » ou appui long |
| Supprimer une récurrence : seulement à venir, ou tout | `core/recurring.js` (`planDeleteRecurring`) |
| Tout cocher / tout décocher en prévision | écran Prévisions |
| Import qui ajoute ou qui remplace | Plus › Sauvegarde et données |
| Export Excel avec un onglet par type de donnée | `io/exports.js` |
| Relevé : revue chronologique des correspondances, puis manquantes, puis en trop ; champs complétés | assistant d'import |
| Le solde final du relevé sert de rapprochement | dernière étape de l'assistant (« Bilan ») |
| Signalement de bug avec photo, utilisable par plusieurs personnes | Plus › Signaler un bug |

## Décisions par défaut

### Soldes et opérations

- **Un seul compte bancaire.** Le multi-comptes (carte, espèces, livret) change presque tous les
  écrans ; il mérite d'être décidé avec toi plutôt que deviné.
- **Une opération réelle datée dans le futur** est acceptée mais ne compte dans les soldes que le jour
  venu ; elle apparaît en haut de la liste, en style « à venir ».
- **Un revenu ne va jamais directement dans une enveloppe** : il arrive sur le compte courant, et le
  formulaire propose d'enchaîner le virement. Ainsi le solde total reste toujours celui de la banque.
- **Confirmer une prévision en avance** (salaire arrivé un jour plus tôt) lui donne la date du jour.
- **Solde de départ** : une ligne « Solde de départ » datée, modifiable comme une autre. Il n'y en a
  qu'un.

### Enveloppes

- **Objectif** : un montant et, si tu veux, une date. L'appli affiche la progression et l'effort
  mensuel nécessaire. Pas de plafond ni d'alerte de dépassement dans cette version.
- **Clôture** : ce qui reste retourne sur le compte courant, les récurrences liées se mettent en
  pause, l'enveloppe passe dans les archives avec son bilan. La réouverture relance ces récurrences.
- **Suppression** : deux choix, garder les dépenses (elles passent sur le compte courant) ou tout
  supprimer. Dans les deux cas, annulable.

### Récurrences

- Fréquences : toutes les N semaines, tous les N mois, tous les N ans (N de 1 à 99).
- À la création d'une récurrence commencée dans le passé, l'appli demande s'il faut créer les
  échéances déjà écoulées.
- Une échéance cochée devient réelle le jour venu ; décochée, elle reste « à confirmer ».
- Les prévisions sont générées sur 6 mois.

### Import de relevé

- **Fenêtre de rapprochement** : même montant au centime, date à 4 jours près autour de la date
  réelle de l'achat. Une correspondance le même jour est acceptée d'office ; au-delà d'un jour, ou
  s'il y a plusieurs candidates, l'appli demande confirmation.
- **Date retenue pour une opération créée depuis le relevé** : celle de l'achat quand le relevé la
  donne (« CARTE X1234 06/07 … »), sinon celle de la banque. La date de débit est gardée à part.
- **Fusion** : ce que tu avais saisi n'est jamais écrasé ; seuls les champs vides sont complétés. Si
  tu associes à la main deux montants différents, celui de la banque l'emporte (après confirmation).
- **Opérations de l'appli absentes du relevé** : gardées par défaut (paiement pas encore débité).
- **Relevé plus ancien que ton solde de départ** : l'historique s'enrichit, le solde d'aujourd'hui
  ne change pas (option proposée et expliquée au bilan).
- **Relevé déjà importé** : refusé, pour éviter les doublons. Le retirer des archives le « dé-pointe ».
- **Autres banques** : même lecteur pour tout relevé PDF en colonnes ; OFX et CSV en secours.

### Données et confidentialité

- **Aucune donnée ne sort du téléphone** d'elle-même. La copie automatique des données d'applis vers
  Google (`allowBackup`) est désactivée dans l'APK.
- **Sauvegarde automatique** : une par jour dans `Documents/MonBudget/Sauvegardes`, 7 conservées. Un
  rappel apparaît quand aucune sauvegarde n'a quitté le téléphone depuis 30 jours.
- **Photos** : réduites à 1600 px de côté (qualité largement suffisante pour un ticket, dix fois
  moins de place).
- **Code de verrouillage** : 4 à 6 chiffres, redemandé après une minute en arrière-plan. C'est un
  écran de discrétion, pas un chiffrement ; il est dit clairement que le code ne se récupère pas.
- **Commentaires (anciennement « signalements de bug »)** : enregistrés dans l'appli, envoyés
  seulement quand tu touches « Envoyer à Claude » ou « Partager ». Le diagnostic joint ne contient
  que des compteurs et la version, jamais tes libellés ni tes montants. Pour recevoir par e-mail
  ceux d'autres utilisateurs, renseigne ton adresse dans `www/js/config.js` : un bouton « Envoyer
  par e-mail » apparaît.

### Technique

- **Pas de framework** et aucune dépendance à l'exécution : moins de pièces qui cassent, code lisible.
- **Graphiques faits maison** en SVG : l'ancienne version chargeait une bibliothèque depuis internet,
  d'où les graphiques vides hors connexion.
- **Polices et lecteur PDF embarqués.**
- **Identifiant de l'appli** : `fr.monbudget.app`. À changer avant une publication sur le Play Store
  (un identifiant ne se change plus ensuite).

## Version 2.1.0 : installation sans APK, commentaires pour Claude

Ta demande : « pas forcément un APK ; que ça s'ouvre comme une appli normale, avec logo, avec
l'import / export, le stockage sur le téléphone, pas dans Chrome ; pouvoir commenter depuis
l'appli ; que Claude puisse modifier l'appli directement ».

| Demande | Réponse retenue | Où |
| --- | --- | --- |
| Appli normale, logo, pas dans Chrome | appli web installable (PWA) : icône, plein écran, hors connexion | `www/manifest.webmanifest`, `www/sw.js`, `platform/pwa.js` |
| Import / export | inchangés ; « Enregistrer » écrit dans le dossier du téléphone s'il est choisi | `platform/platform.js` |
| Stockage sur le téléphone | base locale comme avant, plus une copie quotidienne dans un vrai dossier | `platform/folder.js`, `data/backup.js` |
| Commenter depuis l'appli | écran « Commentaires pour Claude », réponses affichées sous le commentaire | `ui/screens/bugs.js`, `data/claude-link.js` |
| Claude modifie l'appli | Claude lit la boîte, corrige, teste, publie ; l'appli se met à jour seule | `tools/commentaires.mjs`, `tools/publier.mjs` |

Choix faits en ton absence, à valider ou à changer :

- **PWA plutôt qu'APK.** Un APK ne se met pas à jour tout seul : chaque correction demanderait de
  refabriquer et de réinstaller un fichier. La PWA se met à jour au lancement suivant, ce qui rend
  possible le circuit « commentaire → correction → mise à jour ». Contrepartie honnête : c'est le
  moteur de Chrome qui la fait tourner (invisible), et ses données vivent dans le stockage de
  Chrome pour cette adresse. L'APK reste possible avec le même code.
- **GitHub comme « connecteur ».** Il faut un endroit en ligne où l'appli dépose les commentaires
  et où Claude sait lire, et un hébergement pour l'appli : GitHub fait les deux gratuitement, et
  Claude sait y travailler depuis l'ordinateur comme depuis le téléphone. Il demande un compte, que
  toi seul peux créer.
- **Deux dépôts.** Le code est public (condition de l'hébergement gratuit, et il ne contient rien de
  personnel) ; les commentaires vont dans un dépôt **privé** séparé, parce qu'une capture d'écran
  peut montrer des montants. Le jeton rangé dans le téléphone ne donne accès qu'à cette boîte : il
  ne permet pas de toucher au code de l'appli.
- **Rien ne part sans geste.** Un commentaire n'est envoyé que par le bouton « Envoyer à Claude ».
  Vers une boîte publique, les captures ne sont jamais envoyées.
- **Jeton sans date d'expiration** proposé par défaut dans le formulaire de GitHub : un jeton qui
  expire couperait la connexion sans prévenir. Il se supprime à tout moment sur GitHub.
- **« Tout effacer » garde la connexion à Claude et le dossier de copie** : ce sont des réglages du
  téléphone, pas des données du budget. « Déconnecter » et « Ne plus copier » existent à part.
- **Mise à jour jamais imposée en pleine saisie** : un bandeau propose, tu choisis le moment.
- **Chaque fichier d'une mise à jour est vérifié** (empreinte) avant d'être accepté : une
  publication incomplète ne peut pas casser l'appli installée.
- **Claude ne surveille pas la boîte en permanence** : tu lui demandes « traite mes commentaires ».
  Une relève automatique (tâche programmée) est possible une fois la publication en place.
- **« Signaler un bug » devient « Commentaires pour Claude »** : mêmes fiches, plus le type (idée,
  question), l'écran concerné, l'envoi et le fil de discussion. Les anciens signalements restent lisibles.

## Version 2.2.0 : bouton IA, quotas, vocabulaire

Choix faits en ton absence, à valider ou à changer :

- **« Virement » retiré du bouton +.** Tu as raison : pour toi, un virement est un vrai virement
  bancaire (donc une dépense ou un revenu). Les déplacements d'argent vers ou depuis une enveloppe
  existent toujours (sans eux, pas d'enveloppes), mais ils se font depuis la fiche de l'enveloppe
  et s'appellent Alimentation, Retrait, Déplacement. J'ai gardé « Dépense » et « Revenu » : ce sont
  les mots de toutes les applis de budget. Si tu préfères « Sortie / Entrée », c'est un changement
  de quelques lignes.
- **Un quota par tag**, avec une seule période (jour, semaine, mois, année ou deux dates). Plusieurs
  quotas sur un même tag (par semaine ET par mois) compliqueraient l'écran pour un cas rare.
- **La semaine va du lundi au dimanche.**
- **Une dépense à plusieurs tags compte en entier dans chacun de leurs quotas** (et non au prorata,
  comme dans les graphiques) : un quota « Restaurant » doit voir tout le repas.
- **Un remboursement portant le même tag rend de la marge.**
- **Un quota prévient, il ne bloque jamais** : à 80 % (orange), au-delà (rouge), et au moment de la
  saisie.
- **Bouton IA : montants masqués par défaut sur la capture.** Un interrupteur les montre quand c'est
  utile (un total faux, par exemple). Les photos de tickets ne figurent jamais sur la capture.
- **Bouton IA : un onglet fin sur le bord droit** plutôt qu'un rond flottant au milieu de l'écran :
  dans les listes, il ne couvre que le « € » des montants (un test le vérifie). Il se déplace d'un
  glissé, passe sur le bord gauche si on le préfère, et se masque dans les réglages.
- **Les messages passagers** (« Enregistré », bouton « Annuler ») n'apparaissent pas sur la capture.
- **Relève des commentaires 4 fois par jour** par une tâche programmée de l'appli Claude, visible et
  modifiable dans l'appli. Lors d'une relève, Claude ne fait que ce qui est clair et sans risque ; il
  répond par une question pour le reste.

## Version 2.3.0 : Bilan, Sortie / Entrée, banque connectée

- **Le tableau de bord remplace l'onglet Stats** (renommé « Bilan ») plutôt qu'un 6e onglet : cinq
  onglets tiennent sur un écran de 360 px, et le jour et les statistiques se complètent. Le tableau de
  bord ne dépend pas de la période choisie plus bas : il parle d'aujourd'hui.
- **« Fin du mois, estimé »** = compte courant + opérations réelles déjà datées + prévisions
  **cochées**, comme l'écran Prévisions. Le point bas n'est montré que s'il est plus bas que les deux.
- **Les alertes** ne répètent pas les quotas (leur carte est juste en dessous). Un objectif
  d'enveloppe est « en retard » si l'effort du mois (reste ÷ mois restants) n'est pas fait, en
  comptant les alimentations déjà prévues ; « manqué » si sa date est passée. Un relevé est
  « ancien » après 40 jours (un par mois, plus une marge).
- **Sortie / Entrée**, à ta demande, dans toute l'appli. Le verbe « dépenser » reste là où il est le
  plus naturel (« Là où tu dépenses le plus »).
- **Ranger plusieurs opérations dans une enveloppe** : seules les sorties bougent (une entrée arrive
  toujours sur le compte courant) ; le complément éventuel est daté de la plus ancienne sortie rangée,
  pour que l'enveloppe ne soit jamais à découvert.
- **Le catalogue des commerçants** ne crée jamais de tag et ne passe jamais avant une règle apprise :
  il ne sert qu'à un premier rangement, pour un commerçant jamais vu, si tu as le tag du même nom.
- **Banque connectée : l'ordinateur fait l'intermédiaire.** La clé d'Enable Banking ne peut pas
  être dans l'appli (le code de l'appli est public) ; l'ordinateur relève, **chiffre** et dépose dans
  la boîte privée, que l'appli sait déjà lire. Phrase secrète générée par l'ordinateur (environ 99
  bits), saisie une fois sur le téléphone, jamais exportée. Seules les opérations
  **comptabilisées** sont reprises ; elles passent par l'**assistant d'import existant** (même
  rapprochement, mêmes vérifications, pas de doublon entre deux relevés qui se chevauchent).
- **Un seul compte suivi** pour l'instant (le compte courant) : plusieurs comptes, c'est l'étape 2
  de `feuille-de-route.md`.

## Reporté à plus tard

| Sujet | Pourquoi pas maintenant |
| --- | --- |
| Multi-comptes | touche tous les écrans ; à cadrer ensemble |
| Empreinte digitale | demande un module natif de plus, à tester sur ton téléphone |
| Plafonds et alertes par enveloppe ou par tag | simple à ajouter une fois l'usage réel observé |
| Diagramme de flux (Sankey) | peu lisible sur un écran de téléphone ; à rediscuter |
| Traitement immédiat des commentaires (Claude lancé automatiquement sur l'ordinateur) | refusé par le garde-fou de sécurité de Claude : à décider par toi |
| Connexion directe à la banque | construite et testée (2.3.0) ; attend ton compte Enable Banking (`connexion-banque.md`) |
| Plusieurs comptes, partage avec une autre personne, ouverture au public | étudiés dans `feuille-de-route.md` |
| Recevoir un relevé « partagé » depuis une autre appli (menu Partager du téléphone) | possible pour une appli installée ; à faire si l'import par le sélecteur de fichiers te paraît long |
| Connexion par QR code au lieu de coller le jeton | confort ; à voir après le premier réglage réel |
| Refonte visuelle d'après tes maquettes | j'attends tes maquettes ; l'habillage actuel est isolé dans `css/app.css` |
| APK signé pour diffusion large | une clé de signature à créer et à conserver ; à faire avec Claude Code |
