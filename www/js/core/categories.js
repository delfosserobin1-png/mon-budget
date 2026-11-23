// Premier rangement des commerçants jamais vus. Les règles automatiques (rules.js) retiennent comment
// TU ranges chaque tiers ; pour un tiers encore inconnu (première ligne d'un relevé, par exemple), ce
// petit catalogue de noms courants propose un tag… seulement si tu as un tag de ce nom-là.
// Le catalogue ne crée jamais de tag, et une règle apprise passe toujours avant lui.

import { normalize } from './text.js';

// Pour chaque famille : les noms de tag acceptés (sans accents, en minuscules) et les mots qui la
// trahissent dans un libellé bancaire. Un mot est cherché entier (« total » ne trouve pas « totalement »).
// L'ordre compte : la première famille dont un mot apparaît l'emporte (le logement passe avant le
// transport, pour qu'une facture « TotalEnergies électricité » n'aille pas dans le carburant).
const CATALOGUE = [
  {
    tags: ['logement', 'maison', 'loyer', 'energie', 'charges'],
    words: ['loyer', 'electricite', 'edf', 'engie', 'veolia', 'suez', 'eau de paris', 'gaz', 'syndic', 'taxe fonciere'],
  },
  {
    tags: ['courses', 'alimentation', 'supermarche', 'nourriture'],
    words: ['carrefour', 'leclerc', 'e leclerc', 'auchan', 'lidl', 'aldi', 'intermarche', 'super u', 'hyper u', 'u express', 'casino', 'monoprix', 'franprix', 'picard', 'grand frais', 'biocoop', 'netto', 'cora', 'spar', 'naturalia', 'la vie claire', 'boulangerie', 'boucherie', 'primeur'],
  },
  {
    tags: ['transport', 'transports', 'carburant', 'essence', 'voiture', 'auto'],
    words: ['totalenergies', 'total access', 'esso', 'shell', 'avia', 'station service', 'sncf', 'ouigo', 'ratp', 'navigo', 'uber', 'bolt', 'blablacar', 'vinci autoroutes', 'sanef', 'aprr', 'peage', 'parking', 'indigo', 'tisseo', 'tcl', 'velib'],
  },
  {
    tags: ['restaurant', 'restaurants', 'resto', 'sorties', 'repas'],
    words: ['restaurant', 'brasserie', 'pizzeria', 'sushi', 'kebab', 'mcdonald', 'mcdonalds', 'mc donald', 'burger king', 'kfc', 'quick', 'subway', 'five guys', 'deliveroo', 'uber eats', 'just eat', 'starbucks', 'brioche doree', 'columbus cafe'],
  },
  {
    tags: ['abonnements', 'abonnement', 'telephone', 'internet', 'telecom'],
    words: ['netflix', 'spotify', 'deezer', 'disney plus', 'canal plus', 'canal', 'amazon prime', 'prime video', 'free mobile', 'free telecom', 'orange', 'sosh', 'sfr', 'red by sfr', 'bouygues telecom', 'b and you', 'youtube premium', 'icloud', 'apple com bill', 'google storage'],
  },
  {
    tags: ['sante', 'pharmacie', 'medical'],
    words: ['pharmacie', 'pharma', 'medecin', 'docteur', 'dentiste', 'kine', 'kinesitherapeute', 'opticien', 'optique', 'laboratoire', 'radiologie', 'doctolib', 'cpam', 'ameli', 'mutuelle'],
  },
  {
    tags: ['bricolage', 'maison', 'jardin'],
    words: ['leroy merlin', 'castorama', 'brico depot', 'bricomarche', 'mr bricolage', 'weldom', 'bricorama', 'point p', 'ikea', 'conforama', 'jardiland', 'truffaut', 'gamm vert'],
  },
  {
    tags: ['loisirs', 'culture', 'sport'],
    words: ['fnac', 'cultura', 'decathlon', 'go sport', 'intersport', 'cinema', 'pathe', 'ugc', 'gaumont', 'cgr', 'steam', 'playstation', 'nintendo', 'ticketmaster', 'fnac spectacles', 'basic fit', 'fitness park'],
  },
  {
    tags: ['vetements', 'habillement', 'shopping'],
    words: ['zara', 'h m', 'kiabi', 'uniqlo', 'celio', 'jules', 'primark', 'vinted', 'zalando', 'galeries lafayette', 'printemps', 'sephora', 'nocibe'],
  },
  {
    tags: ['salaire', 'revenus', 'paie', 'entrees'],
    words: ['salaire', 'paie', 'remuneration'],
  },
];

/** Texte comparable : sans accents, minuscules, lettres et chiffres séparés par une seule espace. */
function comparable(text) {
  return ` ${normalize(text).replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * Tag proposé par le catalogue pour un libellé ou un tiers, parmi les tags de l'utilisateur.
 * Renvoie { tagId, tagName, word } ou null.
 */
export function catalogueTag(state, text) {
  const hay = comparable(text);
  if (hay.trim() === '') return null;
  const byName = new Map(state.tags.map((t) => [comparable(t.name).trim(), t]));
  for (const family of CATALOGUE) {
    const word = family.words.find((w) => hay.includes(` ${w} `));
    if (!word) continue;
    for (const name of family.tags) {
      const tag = byName.get(name);
      if (tag) return { tagId: tag.id, tagName: tag.name, word };
    }
  }
  return null;
}
