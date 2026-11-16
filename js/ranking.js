// IV ranking engine (same method as PvPoke / Poke Genie):
// for every IV combination, take the highest level whose CP stays under the
// league cap, then rank by stat product (atk * def * floor(hp)).

// CP multipliers from level 1 to 55 in 0.5 steps (source: PvPoke).
export const CPM = [0.0939999967813491, 0.135137430784308, 0.166397869586944, 0.192650914456886, 0.215732470154762, 0.236572655026622, 0.255720049142837, 0.273530381100769, 0.290249884128570, 0.306057381335773, 0.321087598800659, 0.335445032295077, 0.349212676286697, 0.362457748778790, 0.375235587358474, 0.387592411085168, 0.399567276239395, 0.411193549517250, 0.422500014305114, 0.432926413410414, 0.443107545375824, 0.453059953871985, 0.462798386812210, 0.472336077786704, 0.481684952974319, 0.490855810259008, 0.499858438968658, 0.508701756943992, 0.517393946647644, 0.525942508771329, 0.534354329109191, 0.542635762230353, 0.550792694091796, 0.558830599438087, 0.566754519939422, 0.574569148039264, 0.582278907299041, 0.589887911977272, 0.597400009632110, 0.604823657502073, 0.612157285213470, 0.619404110566050, 0.626567125320434, 0.633649181622743, 0.640652954578399, 0.647580963301656, 0.654435634613037, 0.661219263506722, 0.667934000492096, 0.674581899290818, 0.681164920330047, 0.687684905887771, 0.694143652915954, 0.700542893277978, 0.706884205341339, 0.713169102333341, 0.719399094581604, 0.725575616972598, 0.731700003147125, 0.734741011137376, 0.737769484519958, 0.740785574597326, 0.743789434432983, 0.746781208702482, 0.749761044979095, 0.752729105305821, 0.755685508251190, 0.758630366519684, 0.761563837528228, 0.764486065255226, 0.767397165298461, 0.770297273971590, 0.773186504840850, 0.776064945942412, 0.778932750225067, 0.781790064808426, 0.784636974334716, 0.787473583646825, 0.790300011634826, 0.792803950958807, 0.795300006866455, 0.797803921486970, 0.800300002098083, 0.802803892322847, 0.805299997329711, 0.807803863460723, 0.810299992561340, 0.812803834895026, 0.815299987792968, 0.817803806620319, 0.820299983024597, 0.822803778631297, 0.825299978256225, 0.827803750922782, 0.830299973487854, 0.832803753381377, 0.835300028324127, 0.837803755931569, 0.840300023555755, 0.842803729034748, 0.845300018787384, 0.847803702398935, 0.850300014019012, 0.852803676019539, 0.855300009250640, 0.857803649892077, 0.860300004482269, 0.862803624012168, 0.865299999713897];

export const LEAGUE_DEFS = {
  ML: { cap: null, label: 'マスター' },
  HL: { cap: 2500, label: 'ハイパー' },
  SL: { cap: 1500, label: 'スーパー' },
  LC: { cap: 500, label: 'リトル' },
};

const lvIndex = level => Math.round((level - 1) * 2);

export function cpAt(base, a, d, s, level) {
  const m = CPM[lvIndex(level)];
  return Math.max(10, Math.floor((base[0] + a) * Math.sqrt(base[1] + d) * Math.sqrt(base[2] + s) * m * m / 10));
}

const cache = new Map();

// Returns Int16Array(4096) of ranks, indexed by a*256 + d*16 + s.
export function rankTable(base, cap, maxLevel = 50) {
  const key = `${base.join(',')}|${cap}|${maxLevel}`;
  if (cache.has(key)) return cache.get(key);
  const maxIdx = lvIndex(maxLevel);
  const prods = new Float64Array(4096);
  for (let a = 0; a < 16; a++) for (let d = 0; d < 16; d++) for (let s = 0; s < 16; s++) {
    const A = base[0] + a, D = base[1] + d, S = base[2] + s;
    let idx = maxIdx;
    if (cap) {
      const k = A * Math.sqrt(D) * Math.sqrt(S) / 10;
      const fits = i => Math.max(10, Math.floor(k * CPM[i] * CPM[i])) <= cap;
      if (!fits(maxIdx)) {
        let lo = 0, hi = maxIdx; // highest index that fits (CP is monotonic in level)
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fits(mid)) lo = mid; else hi = mid - 1; }
        idx = lo;
      }
    }
    const m = CPM[idx];
    prods[a * 256 + d * 16 + s] = (A * m) * (D * m) * Math.floor(S * m);
  }
  const order = Array.from({ length: 4096 }, (_, i) => i).sort((x, y) => prods[y] - prods[x]);
  const ranks = new Int16Array(4096);
  // Equal stat products share a rank (1, 2, 2, 4, ...), as Poke Genie does.
  order.forEach((iv, i) => {
    const prev = order[i - 1];
    ranks[iv] = i > 0 && prods[prev] === prods[iv] ? ranks[prev] : i + 1;
  });
  cache.set(key, ranks);
  return ranks;
}

export function rankOf(base, cap, a, d, s, maxLevel = 50) {
  return rankTable(base, cap, maxLevel)[a * 256 + d * 16 + s];
}
