# Connecter directement ta banque : les options

> Document de réflexion du 18-11-2026. **Rien n'est encore construit** : c'est à toi de choisir.

## Ce que tu veux

Que les opérations de ta banque (Société Générale) arrivent toutes seules dans l'appli, pour :

- compléter une opération déjà saisie avec les informations de la banque (date de débit, libellé) ;
- ajouter une opération que tu n'avais pas saisie, et la ranger.

**Bonne nouvelle : la moitié du travail existe déjà.** L'import de relevé (Plus › Importer un relevé)
fait exactement cette consolidation : il retrouve les opérations communes, propose les manquantes
déjà remplies, signale celles en trop et vérifie les soldes. Il ne manque que la **source
automatique** des opérations, à la place du fichier PDF que tu télécharges aujourd'hui.

## Comment une appli lit un compte bancaire, en Europe

Depuis la directive européenne DSP2, une banque doit ouvrir l'accès aux comptes à des
intermédiaires agréés (« agrégateurs »). Une appli personnelle ne parle donc pas à la banque
elle-même : elle passe par l'un d'eux. Conséquences, quel que soit le choix :

- tu donnes ton accord dans l'appli de ta banque (notification Société Générale), et cet accord
  est à **renouveler tous les 180 jours** ;
- les opérations passent par l'agrégateur, un **tiers** : c'est la fin du principe « rien ne sort du
  téléphone » pour ces données-là (elles restent entre la banque, l'agrégateur et toi) ;
- l'accès est en **lecture seule** : aucun virement possible par ce biais.

## Les options

| Option | Coût | Mise en place | Remarques |
| --- | --- | --- | --- |
| **Enable Banking** (agrégateur agréé, offre gratuite pour ses propres comptes) | gratuit | compte à créer chez eux, application à déclarer, clé de signature à générer | **recommandé** ; Société Générale (particuliers) est prise en charge, validation par notification dans l'appli SG |
| GoCardless Bank Account Data (ex-Nordigen) | — | — | n'accepte plus de nouveaux inscrits |
| Powens, Bridge, Tink, Yapily | payant ou réservé aux entreprises | contrat | surdimensionné pour un usage personnel |
| Récupération automatique sur le site de la banque (outils type « woob ») | gratuit | ton identifiant et ton code bancaires stockés sur le PC | **déconseillé** : fragile, et contraire aux conditions de la banque ; l'authentification forte bloque régulièrement |
| Statu quo : relevé PDF chaque mois | gratuit | rien | déjà en place ; deux minutes par mois |

## Comment ça marcherait avec Enable Banking (proposition)

```
 banque SG ──(accord DSP2, 180 j)──► Enable Banking ──► ton PC (« serveur »)
                                                          │ relève les opérations chaque nuit
                                                          ▼
                                            dépôt GitHub privé (fichier chiffré)
                                                          │
                                                          ▼
                                 Mon Budget sur le téléphone : « Nouvelles opérations de la banque »
                                 → l'assistant d'import existant (rapprocher, compléter, ajouter)
```

- La **clé de signature** d'Enable Banking reste sur le PC (jamais dans l'appli publiée).
- Le fichier déposé sur GitHub est **chiffré** avec une phrase secrète connue seulement de ton
  téléphone et de ton PC : même GitHub ne peut pas le lire.
- Dans l'appli, rien ne change dans la façon de consolider : c'est l'assistant d'import que tu
  connais, alimenté tout seul.

Ce qu'il faudrait de ta part : créer le compte Enable Banking, déclarer l'application (je te
guide, et je prépare tout le reste), puis valider l'accès dans l'appli Société Générale.

## Ce que je te conseille

1. Tant que le relevé PDF mensuel te convient, rester ainsi : c'est le plus sûr pour tes données.
2. Si tu veux l'automatique : Enable Banking, avec l'architecture ci-dessus. C'est un vrai chantier
   (une à deux sessions de travail) ; il ne démarre qu'avec ton accord.

Sources consultées : [Open Banking Tracker, API gratuites (2026)](https://www.openbankingtracker.com/guides/free-open-banking-apis),
[Enable Banking, particularités françaises](https://enablebanking.com/docs/markets/fr/),
[discussion « Enable Banking, propres comptes, gratuit » (2026)](https://github.com/hugiFreezy0815/TrackMyWealth/issues/263),
[ACPR, l'open banking en France (2025)](https://acpr.banque-france.fr/system/files/2025-09/20250918_Document_reflexion_Open_banking_France.pdf).
