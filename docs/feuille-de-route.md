# Feuille de route : plusieurs comptes, partage, publication officielle

> Document de réflexion du 24-11-2026, à discuter ensemble. Rien de ceci n'est encore construit,
> sauf mention contraire. Je ne suis ni juriste ni conseiller financier : les points juridiques
> ci-dessous sont des repères pour savoir quoi faire vérifier, pas un avis juridique.

## Où on en est

Mon Budget est aujourd'hui une appli **personnelle** : une seule personne, un seul compte bancaire,
des données qui restent **sur le téléphone**, aucun serveur à nous. C'est sa force (rien à pirater,
rien à déclarer, rien à payer) et sa limite : tout ce qui suit (plusieurs comptes, partage, autres
personnes) demande de la faire évoluer, par étapes.

## 1. Plusieurs comptes (Société Générale, Boursorama, d'autres plus tard)

Ce qu'il faut changer :

- **Les comptes deviennent une liste** : nom, banque, type (courant, épargne), couleur. Chaque
  opération appartient à un compte. Les données actuelles passent automatiquement dans un premier
  compte « Société Générale » (migration testée, comme celle de la version 1 à la version 2).
- **Les soldes** : par compte, et le total de tous les comptes. Le compte courant « disponible »
  reste celui d'où partent les sorties de tous les jours.
- **Un vrai virement entre tes comptes** (SG → Bourso) : un nouveau type, neutre sur le total, qui
  apparaît dans les deux comptes. C'est le seul « virement » que l'appli connaîtra.
- **Les enveloppes** restent communes (de l'argent mis de côté, quel que soit le compte où il dort),
  avec la possibilité de dire « cette enveloppe est sur le livret Bourso ».
- **Les relevés** : l'import demande le compte (ou le reconnaît aux 4 derniers chiffres).
- **La banque connectée** : un accord par banque, un fichier chiffré par compte.

Effort : important (le modèle de données, tous les écrans, tous les tests), mais l'architecture s'y
prête. Deux à trois sessions de travail. **C'est l'étape suivante logique.**

## 2. Partager avec ta copine (tout, ou seulement certaines enveloppes)

Aujourd'hui, deux téléphones ne peuvent pas partager les mêmes données : il n'existe aucun endroit
commun où elles se retrouvent. Le partage demande donc une **synchronisation**, et des droits.

**Ce qu'il faudrait :**

- un **foyer** : toi, et les personnes que tu invites ;
- des **droits par enveloppe** : voir seulement ; ajouter des sorties ; tout gérer. Par exemple :
  elle voit et alimente « Vacances » et « Courses communes », elle ne voit pas le reste ;
- une **synchronisation** : chaque modification part vers un serveur et revient sur l'autre
  téléphone. L'appli est déjà construite autour de « lots de modifications » (chaque action est un
  lot) : c'est exactement ce qu'on échange, et les conflits (deux modifications de la même opération
  en même temps) se règlent fiche par fiche ;
- de **vrais comptes utilisateurs** (voir § 3), et un **serveur** (voir ci-dessous).

**Le choix du serveur**, à faire ensemble :

| Option | Pour | Contre |
| --- | --- | --- |
| Service hébergé en Europe (type Supabase, hébergement UE) | rapide à mettre en place, comptes et droits fournis | un tiers de plus ; coût dès que ça grandit |
| Serveur à nous (petit hébergement en France) | maîtrise complète | à entretenir, sécuriser, sauvegarder |
| Ton PC comme serveur | gratuit, déjà allumé | dépend du PC et de ta box ; exposer un PC sur internet est risqué |

**La sécurité que je recommande** : **chiffrement de bout en bout**. Les données sont chiffrées sur
le téléphone avant de partir ; le serveur ne stocke que du chiffré et ne peut rien lire. Partager une
enveloppe, c'est donner à ta copine la clé de cette enveloppe-là. C'est plus de travail, mais un
serveur piraté ne livrerait rien d'exploitable : pour des données bancaires, ça vaut l'effort.

Effort : le plus gros chantier de la liste (plusieurs sessions), à faire **après** les comptes
multiples.

## 3. Créer un compte, et ouvrir l'appli à d'autres personnes

Point important : **aujourd'hui, n'importe qui peut déjà ouvrir l'adresse et utiliser l'appli, sans
compte**, avec ses données sur son téléphone. Un compte ne devient nécessaire que pour la
synchronisation, le partage, et la connexion bancaire.

**Création de compte** (quand il y aura un serveur) : une adresse mail, puis connexion par **clé
d'accès** (« passkey » : l'empreinte ou le code du téléphone, pas de mot de passe à retenir ni à se
faire voler), ou par lien envoyé par mail. Suppression du compte et de toutes les données en un geste.

**Ce qui ne s'étend pas tel quel aux autres :**

- **La connexion bancaire** : l'offre gratuite d'Enable Banking ne couvre que **tes propres comptes**,
  pour un usage personnel non commercial. Pour d'autres personnes, il faut un **contrat** avec Enable
  Banking (vérification de l'entreprise, tarif par compte connecté). L'agrément, c'est eux qui l'ont ;
  toi, tu deviens leur client.
- **Les commentaires pour Claude** : la boîte est la tienne, et Claude modifie l'appli à ta demande.
  Pour d'autres utilisateurs, il faudrait un canal de retours séparé, et c'est toi qui déciderais de
  ce qui est fait.

## 4. RGPD (protection des données)

- **Aujourd'hui** : l'appli sert à toi seul, pour ta vie privée, et les données restent sur ton
  téléphone : c'est le cadre « strictement personnel » que le RGPD n'encadre pas.
- **Dès que d'autres personnes l'utilisent avec un serveur** (comptes, synchronisation, banque), tu
  deviens **responsable de traitement**. Il faut alors notamment :
  - une **politique de confidentialité** claire (quelles données, pourquoi, combien de temps, où) ;
  - une base légale (ici, le contrat : fournir le service demandé) et le **minimum de données** ;
  - les **droits** des personnes : accès, rectification, effacement, portabilité (l'export existe
    déjà, c'est un bon point de départ) ;
  - un **registre des traitements** ;
  - des **contrats avec les sous-traitants** (hébergeur, Enable Banking), hébergement de préférence
    dans l'Union européenne ;
  - une **analyse d'impact (AIPD)** est probable : données financières, éventuellement à grande échelle ;
  - en cas de fuite : **notification à la CNIL sous 72 heures**.
- Le chiffrement de bout en bout (§ 2) réduit beaucoup le risque, sans supprimer ces obligations.
- À faire relire par un professionnel (avocat ou DPO) avant toute ouverture au public.

## 5. CGU et mentions légales

Avant d'ouvrir l'appli à d'autres :

- **Mentions légales** (obligatoires pour un site publié en France) : qui édite le site, qui
  l'héberge. Un particulier peut rester anonyme vis-à-vis du public s'il a donné son identité à
  l'hébergeur.
- **Conditions générales d'utilisation** : ce que fait le service et ce qu'il ne fait pas (**pas de
  conseil financier**, chiffres indicatifs), responsabilités, compte et résiliation, propriété,
  droit applicable. S'il devient payant : conditions générales de vente en plus.
- Un **modèle** peut servir de base, mais la relecture par un juriste est recommandée.

## 6. Sécurité, robustesse, tests, évolutivité : ce qui existe, ce qu'il faudra

**Déjà en place** : 209 tests du moteur et 70 parcours dans un vrai navigateur à chaque publication ;
montants en centimes entiers ; toute action annulable ; migration de données testée ; fonctionnement
sans connexion ; mises à jour vérifiées fichier par fichier ; jeton et phrase secrète jamais exportés ;
relevé bancaire chiffré ; publication bloquée si un test échoue (ici, puis chez GitHub).

**À ajouter avec un serveur** : analyse des menaces écrite, tests des droits (« elle ne voit
vraiment pas cette enveloppe »), audit de sécurité extérieur avant ouverture, sauvegardes du
serveur, surveillance et plan de réaction en cas d'incident, limitation des tentatives de connexion.

**Évolutivité** : le cœur (règles métier) est séparé de l'affichage et du stockage ; ajouter une
banque, un format de relevé ou une règle se fait sans toucher au reste. Les comptes multiples et la
synchronisation s'appuieront sur ce découpage.

## 7. Les étapes proposées

| Étape | Contenu | Pour qui | Prérequis |
| --- | --- | --- | --- |
| 1 (faite) | appli installable, Bilan, quotas, bouton IA, banque connectée (SG) | toi | ton compte Enable Banking |
| 2 | **plusieurs comptes** (SG + Bourso), virements entre comptes | toi | — |
| 3 | **synchronisation** entre tes appareils, puis **foyer** avec partage par enveloppe | toi et ta copine | choix du serveur ; chiffrement de bout en bout |
| 4 | **bêta privée** : quelques proches, comptes par clé d'accès, sans connexion bancaire | quelques personnes | CGU, confidentialité, mentions légales, canal de retours |
| 5 | **publication officielle** | tout le monde | statut (micro-entreprise ?), contrat Enable Banking, conformité RGPD relue, audit de sécurité, prix éventuel |

## Les deux questions qui orientent tout

1. **Le partage avec ta copine**, tu le voudrais quand ? S'il est proche, le choix du serveur et du
   chiffrement (§ 2) se fait dès l'étape 2, pour ne pas refaire le travail.
2. **L'appli doit-elle rester un outil personnel (et de foyer), ou devenir un produit public ?** Pour
   un usage personnel, on peut aller vite et simple ; pour un produit, les étapes 4 et 5 imposent
   leur rythme (juridique, sécurité, coûts).
