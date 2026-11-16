// Keep/transfer decision and nickname, following the user's rules:
//
// League membership
//  - A Pokémon belongs to a league/cup when it ranks within TOP (50) there,
//    as it is or after evolving (the evolved form must still fit the CP cap
//    at the current level). Most evolved form wins; then ML > HL > SL > LC.
//  - Level above 40: always Master League, written "PL" + rank (PL③, PL123).
//
// Name = <league><rank> + <legacy move initials> + <＊ if shiny> + <XXL/XXS>
//  - rank: circled within 50 (ML③), digits otherwise, 1000 or worse -> 999+.
//  - Shadow in ML: <current rank>→<rank after purification> (ML239→㊵).
//  - Not in any league:
//      shiny / XXL / XXS / caught in 2017 or earlier -> "＊", "XXL", "2017" ...
//      Dynamax, Gigantamax, legendary, mythical, background -> ML123 style
//      nothing special -> transfer candidate, name stays the species name.
import { LEAGUE_DEFS, rankOf, cpAt } from './ranking.js';
import { resolve, evolutionLine } from './dex.js';

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

function rankText(o, prefix) {
  if (o.purifiedRank != null) return `${prefix}${fmtRank(o.rank)}→${fmtRank(o.purifiedRank)}`;
  return `${prefix}${fmtRank(o.rank)}`;
}

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

// Returns { decision: 'keep'|'transfer'|'unknown', name, chosen, reasons, notes, options }
export function decide(p, settings) {
  const ev = evaluate(p, settings);
  if (ev.error) return { decision: 'unknown', error: ev.error, reasons: [], notes: [], options: [] };
  const f = p.flags || {};
  const special = specialReasons(p, ev.self);
  const legacy = legacyMoves(p, ev.self);
  const marks = (f.shiny ? '＊' : '') + (f.xxl ? 'XXL' : f.xxs ? 'XXS' : '');
  const level = p.levelMin ?? p.levelMax;
  const year = catchYear(p);
  const notes = [];
  if (!p.catchDate) notes.push('捕まえた日が不明なため、2017年以前かどうか判定できません');
  const finish = r => {
    if (r.name && [...r.name].length > MAX_NICK) notes.push(`名前が${MAX_NICK}文字を超えています`);
    return { ...r, notes, legacy, options: ev.options };
  };
  const withExtras = base => base + legacy.map(m => m[0]).join('') + marks;
  const bestFit = () => ev.options.filter(o => o.fits).sort(byPriority);

  // Level above 40: Master League, "PL" prefix.
  if (level != null && level > 40) {
    const chosen = bestFit().find(o => o.league === 'ML');
    if (chosen) {
      return finish({ decision: 'keep', name: withExtras(rankText(chosen, 'PL')), chosen,
        reasons: ['レベル40超え', ...(legacy.length ? ['レガシー技'] : []), ...special] });
    }
  }

  const qualified = ev.options.filter(o => o.qualifies).sort(byPriority);
  if (qualified.length) {
    const chosen = qualified[0];
    return finish({ decision: 'keep', name: withExtras(rankText(chosen, chosen.league)), chosen,
      reasons: [`${chosen.league}で${TOP}位以内`, ...(legacy.length ? ['レガシー技'] : []), ...special] });
  }

  // Not in any league.
  const old = year != null && year <= OLD_YEAR;
  if (marks || old) {
    return finish({ decision: 'keep', name: marks + (old ? String(year) : ''), chosen: null,
      reasons: [...special, ...(old ? [`${year}年に捕まえた`] : [])] });
  }
  if (special.length) {
    const chosen = bestFit()[0];
    return finish({ decision: 'keep', name: chosen ? rankText(chosen, chosen.league) : '', chosen, reasons: special });
  }
  return finish({ decision: 'transfer', name: p.name, keepName: true, chosen: null,
    reasons: [`どのリーグでも${TOP}位以内に入らない`] });
}
