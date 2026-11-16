// Keep/transfer decision and nickname, following the user's rules:
//
// 1. A Pokémon belongs to a league/cup when it ranks within TOP (50) there,
//    either as it is or after evolving. After evolving it must still fit the
//    league's CP cap at its current level.
// 2. If several qualify: the most evolved form wins; on a tie the league
//    priority is ML > HL > SL > LC.
// 3. Name: <league><circled rank>, e.g. ML③.
//    Shadow in ML: <current rank>→<circled rank after purification>, e.g. ML239→㊵.
// 4. Kept unconditionally: shiny, Dynamax, Gigantamax, legendary, mythical,
//    background (field effect). If not in the top 50 anywhere:
//    shiny -> "＊", others -> <league><rank in digits> (1000 or worse -> 999+).
// 5. Everything else is a transfer candidate.
import { LEAGUE_DEFS, rankOf, cpAt } from './ranking.js';
import { resolve, evolutionLine } from './dex.js';

export const TOP = 50;
export const LEAGUE_ORDER = ['ML', 'HL', 'SL', 'LC'];

export const FLAG_DEFS = [
  { key: 'shiny', label: '色違い' },
  { key: 'dynamax', label: 'ダイマックス' },
  { key: 'gigantamax', label: 'キョダイマックス' },
  { key: 'background', label: 'フィールド効果' },
];

export function circled(n) {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32b1 + n - 36);
  return String(n);
}

const digits = n => (n >= 1000 ? '999+' : String(n));
const fmtRank = n => (n <= TOP ? circled(n) : digits(n));

// All (evolution stage x league) options for this Pokémon.
export function evaluate(p, { maxLevel = 40 } = {}) {
  if (p.atk == null || p.def == null || p.sta == null) return { error: '個体値が確定していません' };
  const self = resolve(p.dex, p.form);
  if (!self) return { error: 'ポケモンのデータが見つかりません' };
  const ivs = [p.atk, p.def, p.sta];
  const pur = ivs.map(v => Math.min(15, v + 2));
  const level = p.levelMin ?? p.levelMax;
  const shadow = p.shadow === 1;

  const options = [];
  for (const { sp, stage } of evolutionLine(self)) {
    if (sp.released === false) continue;
    for (const lg of LEAGUE_ORDER) {
      // Little Cup: only Pokémon that have not evolved yet and can still evolve.
      if (lg === 'LC' && (sp.parent || !sp.evos?.length)) continue;
      const cap = LEAGUE_DEFS[lg].cap;
      const cp = level != null ? cpAt(sp.base, ...ivs, level) : null;
      const fits = !cap || cp == null || cp <= cap;
      const rank = rankOf(sp.base, cap, ...ivs, maxLevel);
      const purifiedRank = shadow && lg === 'ML' ? rankOf(sp.base, cap, ...pur, maxLevel) : null;
      const best = purifiedRank != null ? Math.min(rank, purifiedRank) : rank;
      options.push({ league: lg, sp, stage, rank, purifiedRank, fits, cp, qualifies: fits && best <= TOP });
    }
  }
  return { self, options };
}

const byPriority = (a, b) =>
  b.stage - a.stage ||
  LEAGUE_ORDER.indexOf(a.league) - LEAGUE_ORDER.indexOf(b.league) ||
  Math.min(a.rank, a.purifiedRank ?? Infinity) - Math.min(b.rank, b.purifiedRank ?? Infinity);

function nameFor(o, inTop) {
  if (o.purifiedRank != null) return `${o.league}${fmtRank(o.rank)}→${fmtRank(o.purifiedRank)}`;
  return `${o.league}${inTop ? circled(o.rank) : digits(o.rank)}`;
}

export function specialReasons(p, self) {
  const r = [];
  const f = p.flags || {};
  if (f.shiny) r.push('色違い');
  if (f.dynamax) r.push('ダイマックス');
  if (f.gigantamax) r.push('キョダイマックス');
  if (self?.legendary) r.push('でんせつ');
  if (self?.mythical) r.push('まぼろし');
  if (f.background) r.push('フィールド効果');
  return r;
}

// Returns { decision: 'keep'|'transfer'|'unknown', name, chosen, reasons, options }
export function decide(p, settings) {
  const ev = evaluate(p, settings);
  if (ev.error) return { decision: 'unknown', error: ev.error, reasons: [], options: [] };
  const special = specialReasons(p, ev.self);
  const qualified = ev.options.filter(o => o.qualifies).sort(byPriority);

  if (qualified.length) {
    const chosen = qualified[0];
    return { decision: 'keep', name: nameFor(chosen, true), chosen, reasons: [`${chosen.league}で${TOP}位以内`, ...special], options: ev.options };
  }
  if (special.length) {
    if (p.flags?.shiny) return { decision: 'keep', name: '＊', chosen: null, reasons: special, options: ev.options };
    const chosen = ev.options.filter(o => o.fits).sort(byPriority)[0];
    return { decision: 'keep', name: chosen ? nameFor(chosen, false) : '', chosen, reasons: special, options: ev.options };
  }
  return { decision: 'transfer', name: '', chosen: null, reasons: [`どのリーグでも${TOP}位以内に入らない`], options: ev.options };
}
