# Cahier des charges, version 2

Le document d'origine, repris point par point avec ce qui est livré dans la version 2.0.0.
« Fait » veut dire : écrit, et couvert par au moins un test automatique.

## 1. Principe général

| Exigence | État | Remarque |
| --- | --- | --- |
| Appli Android en .apk, usage personnel | Prêt à compiler | la compilation se fait sur ton PC (`npm run apk`) ; depuis la 2.1.0, l'appli s'installe aussi sans APK (voir § 15) |
| Données 100 % locales | Fait | les données du budget ne sortent jamais ; seuls partent les commentaires que tu envoies (§ 15) ; copie Google désactivée dans l'APK |
| Fichiers rangés dans des dossiers lisibles | Fait | `Documents/MonBudget/` (ou le dossier choisi) : Sauvegardes, Exports, Releves, Pieces-jointes, Commentaires |
| Interface simple | Fait | cinq onglets, un bouton + |
| Bouton d'information sur les notions délicates | Fait | soldes, enveloppes, estimation, rapprochement |
| Export et import à tout moment | Fait | Plus › Sauvegarde et données |

## 2. Opérations

| Champ | État |
| --- | --- |
| Date et heure | Fait |
| Montant | Fait (saisie avec virgule ou point, contrôlée) |
| Raison / motif | Fait (« Libellé ») |
| Commentaire | Fait |
| Destinataire ou émetteur | Fait (« Payé à » / « Reçu de ») |
| Photo depuis l'appareil ou la galerie | Fait (plusieurs photos possibles, plein écran, réduction automatique) |
| Importance : nécessité, confort, caprice | Fait |
| Tags libres, créables à la volée | Fait |
| Catégories « projet » | Fait : ce sont les enveloppes |

En plus : duplication d'une opération, brouillon gardé si tu fermes sans enregistrer, proposition
automatique du rangement habituel pour un tiers déjà vu, transformation en récurrence (« Répéter »).

## 3. Enveloppes

| Exigence | État |
| --- | --- |
| Une enveloppe par usage ou projet | Fait |
| +500 dans l'enveloppe = −500 sur le compte courant | Fait (virement interne, solde total inchangé) |
| Fiche propre : historique, solde | Fait, avec « À venir » et « Bilan » |
| Compte courant et solde total affichés ensemble | Fait |
| Jamais négative ; complément proposé ; retrait excessif refusé | Fait |
| Retirer de l'argent d'une enveloppe, virer entre enveloppes | Fait |
| Virements récurrents vers, depuis, entre enveloppes | Fait |
| Clôture avec rapport, réouverture | Fait |

En plus : objectif (montant, date) avec progression, couleur, suppression en gardant ou non les dépenses.

## 4. Opérations simulées

| Exigence | État |
| --- | --- |
| Cocher / décocher, écran dédié « Prévisions » | Fait |
| Solde estimé (courant et total) à une date choisie | Fait |
| Jamais mélangées au réel | Fait |
| Tout cocher / tout décocher | Fait |
| Simulations dans les enveloppes | Fait (onglet « À venir » de la fiche) |

## 5. Récurrences

| Exigence | État |
| --- | --- |
| Fréquence libre | Fait : toutes les N semaines, N mois, N années |
| Abonnements, salaires, loyers | Fait, plus virements internes |
| Échéances d'abord prévues, puis réelles le jour venu | Fait |
| Liste dans l'ordre voulu, sur plus de 3 mois | Fait (6 mois) |
| Suppression : à venir seulement, ou tout | Fait |
| Salaire arrivé un jour plus tôt | Fait : « Elle a eu lieu » sur l'échéance, qui prend la date du jour |
| Pause | Fait |

## 6. Rapprochement bancaire

| Exigence | État |
| --- | --- |
| Pas de connexion automatique à la banque | Respecté |
| Saisie du solde réel, écart calculé sur le solde total | Fait |
| Ajustement traçable, historique des écarts | Fait (et courbe dans Stats) |
| Import de relevé | Fait : PDF (Société Générale et relevés en colonnes), OFX, CSV |
| Rapprochement par date et montant, pointage ligne à ligne | Fait, avec confirmation des cas douteux |
| Fusion des informations, réédition possible | Fait |
| Opérations du relevé absentes de l'appli | Fait (étape « À ajouter ») |
| Opérations de l'appli absentes du relevé | Fait (étape « Absentes du relevé ») |
| Champs manquants proposés | Fait : tiers, date réelle, heure, motif lus sur le relevé ; tags et enveloppe proposés d'après tes habitudes |
| Solde final du relevé utilisé comme rapprochement | Fait (étape « Bilan ») |
| Relevés archivés | Fait (Plus › Archives, fichier d'origine récupérable) |

## 7. Consultation, filtres, recherche

| Exigence | État |
| --- | --- |
| Filtres croisés : date, enveloppe, tag, importance, montant, tiers | Fait, plus type, « avec photo », « non pointées » |
| Recherche libre | Fait, insensible aux accents, y compris sur les montants |
| Total de la sélection | Fait |

## 8. Archives

| Exigence | État |
| --- | --- |
| Relevés importés | Fait |
| Photos de tickets | Fait (galerie, lien vers l'opération) |
| Enveloppes clôturées | Fait |
| Sauvegardes exportées | Sur Android, elles sont dans `Documents/MonBudget/Sauvegardes` (visibles avec l'appli Fichiers) |

## 9. Graphiques

| Demandé | État |
| --- | --- |
| Répartition des dépenses par tag | Fait (barres classées, plus lisibles qu'un camembert sur téléphone) |
| Dépenses par enveloppe | Fait |
| Évolution du solde, réel et prévisionnel | Fait (compte courant, solde total, estimation en pointillé) |
| Nécessité / confort / caprice dans le temps | Fait (barres empilées par mois) |
| Calendrier des jours de forte dépense | Fait |
| Comparaison mois par mois | Fait, et comparaison à la période précédente |
| Écart de rapprochement dans le temps | Fait |
| Graphiques cliquables vers la liste filtrée | Fait |
| Diagramme de flux (Sankey) | Reporté (voir `decisions.md`) |

En plus : principaux tiers, dépenses fixes et variables, version tableau de chaque graphique.

## 10. Sécurité et confort

| Exigence | État |
| --- | --- |
| Code à l'ouverture | Fait (4 à 6 chiffres) |
| Empreinte digitale | Reporté |
| Multi-comptes | Reporté |
| Plafonds et alertes | Reporté (l'objectif d'enveloppe existe) |
| Règles de catégorisation automatique | Fait (apprises toutes seules, modifiables) |
| Rappel de sauvegarde | Fait |

## 11. Mode d'emploi

Fait : Plus › Mode d'emploi, treize rubriques, dont la confidentialité et « ce que l'appli ne fait pas ».

## 12. Import / export

| Exigence | État |
| --- | --- |
| Export JSON complet | Fait, et ZIP avec les photos |
| Export tableur | Fait : Excel (sept feuilles) et CSV |
| Import JSON en ajout ou en remplacement | Fait |
| Reprise des données de l'ancienne version | Fait |
| Import de relevés | Fait (voir 6) |

## 13. Architecture

Code en modules indépendants, logique séparée de l'affichage, voir `architecture.md`.

## 14. Ajouts demandés en cours de route

| Demande | État |
| --- | --- |
| Signalement de bug dans l'appli, avec photo | Fait |
| Signalements exploitables si l'appli est diffusée | Fait : partage, export ZIP, adresse de réception configurable |
| Numéro de version visible | Fait (Plus › À propos, et dans chaque signalement) |
| Annulation discrète | Fait |
| Jeu de données d'essai | Fait (« Découvrir avec des données d'exemple ») |
| Relevé d'essai | Fait (« Essayer avec un relevé d'exemple », fichier fictif) |

## 15. Demandes de la version 2.1.0

| Demande | État | Remarque |
| --- | --- | --- |
| Pas forcément un APK, mais une appli « normale » | Fait | appli web installable ; l'APK reste possible |
| Avec logo | Fait | icône de l'enveloppe, y compris en version « adaptable » pour Android |
| Qui ne s'ouvre pas dans Chrome | Fait | plein écran, sans barre d'adresse (c'est le moteur de Chrome qui tourne en coulisses) |
| Import / export | Fait | inchangés, et « Enregistrer » va dans le dossier choisi |
| Stockage en dur sur le téléphone | Fait | base locale, plus copie quotidienne dans un dossier du téléphone |
| Commenter directement depuis l'appli | Fait | Plus › Commentaires pour Claude ; réponses affichées dans l'appli |
| Savoir comment connecter | Fait | Plus › Connexion à Claude, expliqué dans `connexion-claude.md` |
| Que Claude puisse modifier l'appli directement | Fait | Claude relève la boîte, corrige, teste, publie ; l'appli se met à jour seule |
| Tout tester | Fait | 180 tests du moteur, 57 parcours ; voir « ce que les tests ne couvrent pas » dans `architecture.md` |
| Mise en ligne | Fait | https://delfosserobin1-png.github.io/mon-budget/ (`publication.md`) |

« Fait » veut dire ici : écrit, et vérifié par des tests automatiques sur l'ordinateur. Le
comportement sur ton téléphone reste à constater (`installer-sur-le-telephone.md`).

## 16. Demandes de la version 2.2.0

| Demande | État | Remarque |
| --- | --- | --- |
| Traiter les commentaires 4 fois par jour (3 h 30, 9 h, 15 h, 21 h 30) | Fait | tâche programmée de l'appli Claude ; ordinateur allumé et appli Claude ouverte |
| Bouton IA : sélectionner ou entourer un endroit, écrire un commentaire, l'envoyer à Claude | Fait | onglet IA sur tous les écrans ; capture annotée, montants masqués ; élément visé transmis |
| Correction immédiate dès l'envoi, ordinateur allumé en permanence comme serveur | Pas fait | refusé par le garde-fou de sécurité de Claude : à décider par toi (`connexion-claude.md`) |
| « Virement » inutile à côté de Dépense / Revenu | Fait | retiré du bouton + ; mouvements d'enveloppe renommés Alimentation, Retrait, Déplacement |
| Meilleurs termes que Dépense / Revenu ? | Proposé | gardés (standard des applis de budget) ; « Sortie / Entrée » possible sur demande |
| Quotas par tag (jour, semaine, mois, durée libre) | Fait | aussi par année ; jauges, avertissement à la saisie, colonne dans l'export Excel |
| Connexion directe à la banque | Étudié | options et proposition dans `connexion-banque.md` ; demande ton accord et ton compte |
| Tableau de bord ? | Proposé | en attente de ton choix |
| Améliorer le rendu visuel | Fait | grand solde, cartes en relief, titres, transitions, poignée des panneaux |
| Code structuré, tous les tests nécessaires | Fait | 192 tests du moteur, 62 parcours dans un vrai navigateur |

## Hors périmètre

Connexion bancaire automatique : écartée au départ ; étudiée en 2.2.0 (`connexion-banque.md`),
en attente de ta décision.
