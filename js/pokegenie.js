// Mapping of Poke Genie CSV export (Japanese UI) to the app's record shape.
// League suffixes in the export: G = Great (スーパー), U = Ultra (ハイパー), L = Little (リトル).

export const LEAGUES = [
  { key: 'G', label: 'スーパー', short: 'S', cap: 1500 },
  { key: 'U', label: 'ハイパー', short: 'H', cap: 2500 },
  { key: 'L', label: 'リトル', short: 'L', cap: 500 },
];

const REQUIRED = ['Index', '名前', 'ポケモン番号', 'CP', '攻撃IV', '防御IV', 'スタミナIV'];

export function validateHeader(header) {
  const missing = REQUIRED.filter(h => !header.includes(h));
  return missing;
}

const num = v => {
  if (v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[%,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const int = v => { const n = num(v); return n === null ? null : Math.round(n); };

// "2026/11/13" -> "2026-11-13"; "2026-11-16 10:24" -> "2026-11-16T10:24"
function normDate(v) {
  if (!v) return null;
  const m = v.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return m[4] ? `${d}T${m[4].padStart(2, '0')}:${m[5]}` : d;
}

// 0 = normal, 1 = shadow, 2 = purified
export const SHADOW_LABEL = { 0: '', 1: 'シャドウ', 2: 'リトレーン' };

export function mapRow(r) {
  const leagues = {};
  for (const { key } of LEAGUES) {
    const rank = int(r[`ランク # (${key})`]);
    if (rank === null && !r[`名前 (${key})`]) continue;
    leagues[key] = {
      rank,
      rankPct: num(r[`ランク % (${key})`]),
      statProd: num(r[`積 (${key})`]),
      dustCost: int(r[`ほしのすなコスト (${key})`]),
      candyCost: int(r[`アメコスト (${key})`]),
      target: r[`名前 (${key})`] || null,
      targetForm: r[`すがた (${key})`] || null,
      targetShadow: int(r[`シャドウ/リトレーン (${key})`]) || 0,
    };
  }
  const levelMin = num(r['最低レベル']);
  const levelMax = num(r['最高レベル']);
  return {
    sourceIndex: int(r['Index']),
    name: r['名前'],
    form: r['すがた'] || '',
    dex: int(r['ポケモン番号']),
    gender: r['性別'] || '',
    cp: int(r['CP']),
    hp: int(r['HP']),
    atk: int(r['攻撃IV']),
    def: int(r['防御IV']),
    sta: int(r['スタミナIV']),
    ivPct: num(r['IV平均']),
    levelMin,
    levelMax,
    fastMove: r['ノーマルアタック'] || '',
    chargeMove1: r['スペシャルアタック'] || '',
    chargeMove2: r['スペシャルアタック 2'] || '',
    scanDate: normDate(r['スキャン日']),
    originalScanDate: normDate(r['元のスキャン日付']),
    catchDate: normDate(r['捕まった日付']),
    lucky: r['キラ'] === '1',
    shadow: int(r['シャドウ/リトレーン']) || 0,
    favorite: r['お気に入り'] === '1',
    dust: int(r['ほしのすな']),
    pvpFlag: r['PvP使用のフラグ付き'] || '',
    leagues,
  };
}

// Identity of an individual across exports. CP/HP/level change with power-ups,
// so they are not part of the key. When the catch date is missing, the original
// scan date (kept by Poke Genie across rescans) is used instead.
export function identityKey(p) {
  const when = p.catchDate ? `c${p.catchDate}` : `s${p.originalScanDate || ''}`;
  return [p.dex, p.form, p.shadow, p.atk, p.def, p.sta, when].join('|');
}
