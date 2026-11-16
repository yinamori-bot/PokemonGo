// Comparison of recently caught Pokémon against owned Pokémon that share the
// same evolution target in each league.
import { LEAGUES } from './pokegenie.js';

// Shadow Pokémon have different battle stats, so they form their own group.
// Purified and normal share stats and are grouped together.
export function groupKey(p, leagueKey) {
  const l = p.leagues?.[leagueKey];
  if (!l?.target) return null;
  return `${leagueKey}|${l.target}|${l.targetForm || ''}|${p.shadow === 1 ? 'S' : 'N'}`;
}

export function buildGroups(owned) {
  const groups = new Map();
  for (const p of owned) {
    for (const { key } of LEAGUES) {
      const g = groupKey(p, key);
      if (!g) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
  }
  for (const [g, list] of groups) {
    const lk = g.split('|')[0];
    list.sort((a, b) => (a.leagues[lk].rank ?? Infinity) - (b.leagues[lk].rank ?? Infinity));
  }
  return groups;
}

const daysAgo = n => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// mode: 'last-import' | 'days:N'
export function pickRecent(owned, imports, mode) {
  if (mode === 'last-import') {
    const last = imports[imports.length - 1];
    return last ? owned.filter(p => p.firstImportId === last.id) : [];
  }
  const n = parseInt(mode.split(':')[1], 10) || 7;
  const since = daysAgo(n);
  return owned.filter(p => p.catchDate && p.catchDate >= since);
}

// For one recent Pokémon, return per-league comparison rows.
export function compareOne(p, groups) {
  return LEAGUES.map(({ key, label }) => {
    const g = groupKey(p, key);
    const l = p.leagues?.[key];
    if (!g || !l) return { key, label, missing: true };
    const members = groups.get(g) || [p];
    const position = members.indexOf(p) + 1;
    return {
      key, label, rank: l.rank, rankPct: l.rankPct, target: l.target, targetForm: l.targetForm,
      position, total: members.length, betterCount: position - 1, members,
    };
  });
}
