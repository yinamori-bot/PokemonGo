// Keep/transfer decision and nickname, following the user's rules:
//
// League membership
//  - A Pokémon belongs to a league/cup when it ranks within TOP (50) there,
//    as it is or after evolving (the evolved form must still fit the CP cap
//    at the current level). Most evolved form wins; then ML > HL > SL > LC.
//  - Level above 40: always Master League, written "PL" + rank (PL③, PL123).
//  - Little Cup: only Pokémon that have not evolved and can still evolve.
//
// Name = <league><rank><stage mark> + <legacy initials> + <＊> + <XXL/XXS> + <year>
//  - rank: circled within 50 (ML③), digits otherwise, 1000 or worse -> 999+.
//  - stage mark (HL/SL/LC, families with evolutions): ♳ ♴ ♵ = stage 1/2/3
//    of the form the rank is for (SL②♴).
//  - Shadow in ML: <current rank>→<rank after purification> (ML239→㊵).
//  - year: caught in 2017 or earlier (ML③2017).
//
// Not in any league
//  - caught in 2017 or earlier          -> trade candidate, name = marks + year (2017, ＊2017)
//  - legacy move / Dynamax / Gigantamax / legendary / mythical / background
//                                        -> keep, best rank anywhere (ML128ガ)
//  - shiny / XXL / XXS only              -> keep, ＊ / XXL / XXS
//  - nothing                             -> transfer, name stays as is
import { LEAGUE_DEFS, rankOf, cpAt } from './ranking.js';
import { resolve, evolutionLine, absoluteStage } from './dex.js';

export const TOP = 50;
export const LEAGUE_ORDER = ['ML', 'HL', 'SL', 'LC'];

export const FLAG_DEFS = [
  { key: 'shiny', label: '色違い' },
  { key: 'dynamax', label: 'ダイマックス' },
  { key: 'gigantamax', label: 'キョダイマックス' },
  { key: 'background', label: 'フィールド効果' },
  { key: 'xxl', label: 'XXL' },
  { key: 'xxs', label: 'XXS' },
];

export const MAX_NICK = 12;
export const OLD_YEAR = 2017;

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

const STAGE_MARKS = ['♳', '♴', '♵'];

// ♳♴♵ for HL/SL/LC when the family has evolutions.
export function stageMark(o) {
  if (o.league === 'ML') return '';
  if (!o.sp.parent && !o.sp.evos?.length) return '';
  return STAGE_MARKS[absoluteStage(o.sp)] || '';
}

function rankText(o, prefix = o.league) {
  if (o.purifiedRank != null) return `${prefix}${fmtRank(o.rank)}→${fmtRank(o.purifiedRank)}`;
  return `${prefix}${fmtRank(o.rank)}${stageMark(o)}`;
}

// Best rank anywhere, for Pokémon kept without belonging to a league.
const byRank = (a, b) =>
  Math.min(a.rank, a.purifiedRank ?? Infinity) - Math.min(b.rank, b.purifiedRank ?? Infinity) || byPriority(a, b);

// First character of each legacy move the Pokémon knows (ブラストバーン -> ブ).
export function legacyMoves(p, self) {
  const legacy = new Set((self?.legacy || []).map(n => n.normalize('NFKC')));
  return [p.fastMove, p.chargeMove1, p.chargeMove2].filter(m => m && legacy.has(m.normalize('NFKC')));
}

export function specialReasons(p, self) {
  const r = [];
  const f = p.flags || {};
  if (f.shiny) r.push('色違い');
  if (f.xxl) r.push('XXL');
  if (f.xxs) r.push('XXS');
  if (f.dynamax) r.push('ダイマックス');
  if (f.gigantamax) r.push('キョダイマックス');
  if (self?.legendary) r.push('でんせつ');
  if (self?.mythical) r.push('まぼろし');
  if (f.background) r.push('フィールド効果');
  return r;
}

const catchYear = p => (p.catchDate ? Number(p.catchDate.slice(0, 4)) : null);

// Returns { decision: 'keep'|'trade'|'transfer'|'unknown', name, chosen, reasons, notes, options }
export function decide(p, settings) {
  const ev = evaluate(p, settings);
  if (ev.error) return { decision: 'unknown', error: ev.error, reasons: [], notes: [], options: [] };
  const f = p.flags || {};
  const special = specialReasons(p, ev.self);
  const legacy = legacyMoves(p, ev.self);
  const marks = (f.shiny ? '＊' : '') + (f.xxl ? 'XXL' : f.xxs ? 'XXS' : '');
  const level = p.levelMin ?? p.levelMax;
  const year = catchYear(p);
  const old = year != null && year <= OLD_YEAR;
  const notes = [];
  if (!p.catchDate) notes.push('捕まえた日が不明なため、2017年以前かどうか判定できません');
  const finish = r => {
    if (r.name && [...r.name].length > MAX_NICK) notes.push(`名前が${MAX_NICK}文字を超えています`);
    return { ...r, notes, legacy, options: ev.options };
  };
  const legacyText = legacy.map(m => m[0]).join('');
  const full = base => base + legacyText + marks + (old ? String(year) : '');
  const why = first => [first, ...(legacy.length ? ['レガシー技'] : []), ...special, ...(old ? [`${year}年に捕まえた`] : [])];
  const fitting = ev.options.filter(o => o.fits);

  // Level above 40: Master League, "PL" prefix.
  if (level != null && level > 40) {
    const chosen = fitting.slice().sort(byPriority).find(o => o.league === 'ML');
    if (chosen) return finish({ decision: 'keep', name: full(rankText(chosen, 'PL')), chosen, reasons: why('レベル40超え') });
  }

  const qualified = ev.options.filter(o => o.qualifies).sort(byPriority);
  if (qualified.length) {
    const chosen = qualified[0];
    return finish({ decision: 'keep', name: full(rankText(chosen)), chosen, reasons: why(`${chosen.league}で${TOP}位以内`) });
  }

  // Not in any league.
  if (old) {
    return finish({ decision: 'trade', name: marks + String(year), chosen: null, reasons: [`${year}年に捕まえた（交換候補）`, ...special] });
  }
  const strong = special.filter(r => !['色違い', 'XXL', 'XXS'].includes(r));
  if (legacy.length || strong.length) {
    const chosen = fitting.slice().sort(byRank)[0];
    const base = chosen ? rankText(chosen) : '';
    return finish({ decision: 'keep', name: base + legacyText + marks, chosen,
      reasons: [...(legacy.length ? ['レガシー技'] : []), ...special, ...(chosen ? [`いちばん良いのは${chosen.league}`] : [])] });
  }
  if (marks) return finish({ decision: 'keep', name: marks, chosen: null, reasons: special });
  return finish({ decision: 'transfer', name: p.name, keepName: true, chosen: null,
    reasons: [`どのリーグでも${TOP}位以内に入らない`] });
}
