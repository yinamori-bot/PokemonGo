// Species lookup: Poke Genie (Japanese name / dex number / form) -> game data.
let byId = new Map();
let byDex = new Map();
let byJa = new Map();

// Poke Genie form labels -> PvPoke speciesId suffix.
const FORM_SUFFIX = {
  'あろーら': 'alolan', 'アローラ': 'alolan', 'がらる': 'galarian', 'ガラル': 'galarian',
  'ひすい': 'hisuian', 'ヒスイ': 'hisuian', 'ぱるでぁ': 'paldean', 'パルデア': 'paldean',
  'オリジン': 'origin', 'アナザー': 'altered', 'ディフェンス': 'defense', 'アタック': 'attack',
  'スピード': 'speed', 'たいよう': 'sunny', 'あまみず': 'rainy', 'ゆきぐも': 'snowy',
  'れいじゅう': 'therian', 'けしん': 'incarnate', 'スカイ': 'sky', 'ランド': 'land',
};

export function initDex(data) {
  byId = new Map(); byDex = new Map(); byJa = new Map();
  for (const p of data.pokemon) {
    byId.set(p.id, p);
    if (!byDex.has(p.dex)) byDex.set(p.dex, []);
    byDex.get(p.dex).push(p);
    const k = p.ja.normalize('NFKC');
    if (!byJa.has(k)) byJa.set(k, p.dex);
  }
}

export const getSpecies = id => byId.get(id);

export function resolve(dex, form) {
  const list = byDex.get(dex);
  if (!list) return null;
  const suf = FORM_SUFFIX[form];
  if (suf) {
    const hit = list.find(p => p.id.endsWith('_' + suf));
    if (hit) return hit;
  }
  // Default: the plain entry (no suffix), else the first one.
  return list.find(p => !p.id.includes('_')) || list.find(p => p.released !== false) || list[0];
}

export function resolveByName(ja, form, sameFormAs) {
  const dex = byJa.get(String(ja).normalize('NFKC'));
  if (dex == null) return null;
  // Regional forms carry over through evolution (e.g. alolan vulpix -> alolan ninetales).
  if (!form && sameFormAs) {
    const suf = sameFormAs.id.split('_').slice(1).join('_');
    if (suf) {
      const hit = (byDex.get(dex) || []).find(p => p.id.endsWith('_' + suf));
      if (hit) return hit;
    }
  }
  return resolve(dex, form);
}

// The species itself and every evolution after it, each with its stage
// (0 = the current species, 1 = one evolution later, ...).
export function evolutionLine(sp) {
  const out = [];
  const walk = (s, stage) => {
    out.push({ sp: s, stage });
    for (const e of s.evos || []) { const n = byId.get(e); if (n) walk(n, stage + 1); }
  };
  if (sp) walk(sp, 0);
  return out;
}

// Absolute stage in the family (0 = base form).
export function absoluteStage(sp) {
  let n = 0, cur = sp;
  while (cur?.parent && byId.get(cur.parent) && n < 5) { cur = byId.get(cur.parent); n++; }
  return n;
}
