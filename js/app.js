import { csvToObjects } from './csv.js';
import { LEAGUES, SHADOW_LABEL, validateHeader } from './pokegenie.js';
import * as store from './store.js';
import { buildGroups, pickRecent, compareOne } from './compare.js';
import { initDex } from './dex.js';
import { decide, FLAG_DEFS, LEAGUE_ORDER, TOP } from './naming.js';
import { LEAGUE_DEFS } from './ranking.js';

const $ = s => document.querySelector(s);
const PAGE = 60;
let state = { pokemon: [], imports: [] };
let shown = PAGE;
let settings = { maxLevel: 40 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('settings') || '{}')); } catch {}
let dexReady = false;
const decisions = new Map();
const judge = p => {
  if (!dexReady) return { decision: 'unknown', error: '読み込み中', reasons: [], options: [] };
  if (!decisions.has(p.id)) decisions.set(p.id, decide(p, settings));
  return decisions.get(p.id);
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => d ? d.replace('T', ' ') : '';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---- tabs -------------------------------------------------------------
function showView(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === name)));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${name}`; });
  try { localStorage.setItem('view', name); } catch {}
}
document.querySelectorAll('[data-view],[data-goto]').forEach(b =>
  b.addEventListener('click', () => showView(b.dataset.view || b.dataset.goto)));

// ---- judgement (keep / transfer + nickname) ------------------------------
function judgeBlock(p) {
  const d = judge(p);
  const flags = p.flags || {};
  const chips = FLAG_DEFS.map(f =>
    `<button class="flag ${flags[f.key] ? 'on' : ''}" data-flag="${f.key}" data-id="${esc(p.id)}" aria-pressed="${!!flags[f.key]}">${f.label}</button>`).join('');
  let head;
  if (d.decision === 'keep') {
    head = `<span class="verdict v-keep">残す</span>
      ${d.name ? `<span class="nick">${esc(d.name)}</span><button class="copy" data-copy="${esc(d.name)}">コピー</button>` : ''}
      <span class="muted small">${esc(d.reasons.join('・'))}${d.chosen && d.chosen.stage > 0 ? `（${esc(d.chosen.sp.ja)}に進化）` : ''}</span>`;
  } else if (d.decision === 'transfer') {
    head = `<span class="verdict v-transfer">送る候補</span><span class="muted small">${esc(d.reasons.join('・'))}</span>`;
  } else {
    head = `<span class="verdict v-unknown">判定できません</span><span class="muted small">${esc(d.error || '')}</span>`;
  }
  const rows = (d.options || []).slice().sort((a, b) => a.stage - b.stage || LEAGUE_ORDER.indexOf(a.league) - LEAGUE_ORDER.indexOf(b.league))
    .map(o => `<tr class="${o === d.chosen ? 'self' : ''}${o.fits ? '' : ' nofit'}"><td class="nm">${esc(o.sp.ja)}</td><td>${o.league}</td>
      <td>${o.rank}位${o.purifiedRank != null ? `→${o.purifiedRank}位` : ''}</td><td>${o.fits ? (o.rank <= TOP || (o.purifiedRank ?? 99) <= TOP ? '◎' : '') : 'CP超過'}</td></tr>`).join('');
  return `<div class="judge">
    <div class="judge-head">${head}</div>
    <div class="flags">${chips}</div>
    ${rows ? `<details class="opts"><summary>リーグ別の順位（進化後を含む）</summary>
      <table class="mtable"><thead><tr><th>ポケモン</th><th>リーグ</th><th>順位</th><th></th></tr></thead><tbody>${rows}</tbody></table></details>` : ''}
  </div>`;
}

document.addEventListener('click', async e => {
  const c = e.target.closest('[data-copy]');
  if (c) {
    const text = c.dataset.copy;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {} t.remove();
    }
    toast(`「${text}」をコピーしました`);
    return;
  }
  const f = e.target.closest('[data-flag]');
  if (f) {
    const p = state.pokemon.find(x => x.id === f.dataset.id);
    if (!p) return;
    p.flags = { ...(p.flags || {}), [f.dataset.flag]: !(p.flags?.[f.dataset.flag]) };
    decisions.delete(p.id);
    await store.savePokemon(p);
    renderList(); renderCompare();
  }
});

// ---- list -------------------------------------------------------------
function rankClass(rank) {
  if (rank == null) return 'r-low';
  if (rank <= 10) return 'r-gold';
  if (rank <= 100) return 'r-good';
  if (rank <= 500) return 'r-ok';
  return 'r-low';
}

function matches(p, q) {
  if (!q) return true;
  const hay = [p.name, p.form, ...Object.values(p.leagues || {}).map(l => l.target)].join(' ');
  return hay.includes(q) || String(p.dex) === q;
}

function filtered() {
  const q = $('#q').value.trim();
  const sort = $('#sort').value;
  const topN = parseInt($('#topN').value, 10) || 0;
  const kind = $('#kind').value;
  const leagueSort = LEAGUES.some(l => l.key === sort) ? sort : null;

  let list = state.pokemon.filter(p => p.status !== 'removed' && matches(p, q));
  if (kind === 'shadow') list = list.filter(p => p.shadow === 1);
  if (kind === 'purified') list = list.filter(p => p.shadow === 2);
  if (kind === 'lucky') list = list.filter(p => p.lucky);
  if (kind === 'hundo') list = list.filter(p => p.atk === 15 && p.def === 15 && p.sta === 15);
  if (kind === 'dup') list = list.filter(p => p.possibleDuplicate);
  const jd = $('#judgeFilter').value;
  if (jd) list = list.filter(p => judge(p).decision === jd);
  if (topN) {
    list = list.filter(p => leagueSort
      ? (p.leagues[leagueSort]?.rank ?? Infinity) <= topN
      : LEAGUES.some(l => (p.leagues[l.key]?.rank ?? Infinity) <= topN));
  }

  const r = (p, k) => p.leagues[k]?.rank ?? Infinity;
  const cmp = {
    iv: (a, b) => (b.ivPct ?? -1) - (a.ivPct ?? -1),
    cp: (a, b) => (b.cp ?? 0) - (a.cp ?? 0),
    dex: (a, b) => a.dex - b.dex || a.form.localeCompare(b.form),
    catch: (a, b) => (b.catchDate || '').localeCompare(a.catchDate || ''),
    scan: (a, b) => (b.scanDate || '').localeCompare(a.scanDate || ''),
  }[sort] || ((a, b) => r(a, sort) - r(b, sort));
  return list.sort(cmp);
}

function card(p) {
  const badges = [];
  if (p.form) badges.push(`<span class="badge b-form">${esc(p.form)}</span>`);
  if (p.shadow) badges.push(`<span class="badge ${p.shadow === 1 ? 'b-shadow' : 'b-pure'}">${SHADOW_LABEL[p.shadow]}</span>`);
  if (p.lucky) badges.push('<span class="badge b-lucky">キラ</span>');
  if (p.possibleDuplicate) badges.push('<span class="badge b-warn">重複の疑い</span>');
  const lv = p.levelMin === p.levelMax ? p.levelMin : `${p.levelMin}〜${p.levelMax}`;
  const leagues = LEAGUES.map(({ key, label }) => {
    const l = p.leagues[key];
    if (!l) return `<div class="lg r-low"><span class="lg-label">${label}</span><span class="lg-rank">—</span></div>`;
    const target = l.target && l.target !== p.name ? `→ ${l.target}${l.targetForm && l.targetForm !== 'ノーマル' ? `（${l.targetForm}）` : ''}` : '';
    return `<div class="lg ${rankClass(l.rank)}" title="${esc(label)} ${l.rankPct ?? ''}%">
      <span class="lg-label">${label}</span><span class="lg-rank">${l.rank ?? '—'}<small>位</small></span>
      <span class="lg-target">${esc(target) || '&nbsp;'}</span></div>`;
  }).join('');
  const moves = [p.fastMove, p.chargeMove1, p.chargeMove2].filter(Boolean).join(' / ');
  return `<li class="card">
    <div class="card-head">
      <span class="card-name">${esc(p.name)}</span><span class="dex">No.${p.dex}</span>${badges.join('')}
      <span class="card-cp">CP ${p.cp ?? '?'}</span>
    </div>
    <div class="stats">
      <span>個体値 <b>${p.atk}/${p.def}/${p.sta}</b>（${p.ivPct ?? '?'}%）</span>
      <span>Lv <b>${lv ?? '?'}</b></span>
      <span>捕まえた日 <b>${p.catchDate || '不明'}</b></span>
    </div>
    ${judgeBlock(p)}
    <div class="leagues">${leagues}</div>
    ${moves ? `<div class="moves">${esc(moves)}</div>` : ''}
  </li>`;
}

function renderList() {
  const total = state.pokemon.filter(p => p.status !== 'removed').length;
  $('#empty').hidden = total > 0;
  const list = filtered();
  $('#count').textContent = total ? `${list.length}匹を表示（手持ち全体 ${total}匹）` : '';
  $('#list').innerHTML = list.slice(0, shown).map(card).join('');
  $('#more').hidden = list.length <= shown;
}
['#q', '#sort', '#topN', '#kind', '#judgeFilter'].forEach(s => $(s).addEventListener('input', () => { shown = PAGE; renderList(); saveFilters(); }));
$('#more').addEventListener('click', () => { shown += PAGE; renderList(); });

function saveFilters() {
  try { localStorage.setItem('filters', JSON.stringify({ sort: $('#sort').value, topN: $('#topN').value, kind: $('#kind').value, judgeFilter: $('#judgeFilter').value })); } catch {}
}
function loadFilters() {
  try {
    const f = JSON.parse(localStorage.getItem('filters') || '{}');
    for (const k of ['sort', 'topN', 'kind', 'judgeFilter']) if (f[k] != null) $(`#${k}`).value = f[k];
  } catch {}
}

// ---- compare ----------------------------------------------------------
const SHOW_TOP = 5;

function memberRow(m, lk, self, idx) {
  const l = m.leagues[lk];
  const isSelf = m === self;
  const name = `${esc(m.name)}${m.shadow === 2 ? '（リ）' : ''}${m.lucky ? '（キラ）' : ''}${isSelf ? '<span class="new-tag">これ</span>' : ''}`;
  const date = m.catchDate ? m.catchDate.slice(2).replace(/-/g, '/') : '不明';
  return `<tr class="${isSelf ? 'self' : ''}"><td>${l.rank ?? '—'}位</td><td class="nm">${name}</td>
    <td>${m.cp ?? '?'}</td><td>${m.atk}/${m.def}/${m.sta}</td><td>${date}</td></tr>`;
}

function cmpLeague(row, p) {
  if (row.missing) return `<div class="cmp-league muted small">${row.label}：データなし</div>`;
  const target = row.target && row.target !== p.name ? ` → ${esc(row.target)}${row.targetForm && row.targetForm !== 'ノーマル' ? `（${esc(row.targetForm)}）` : ''}` : '';
  const posCls = row.position === 1 ? 'r-gold' : 'r-low';
  const posText = row.total === 1 ? '手持ちはこれだけ' : `手持ち${row.total}匹中 ${row.position}番目`;
  const idx = row.members.indexOf(p);
  const rows = [];
  row.members.forEach((m, i) => {
    if (i < SHOW_TOP || i === idx) {
      if (i === idx && idx > SHOW_TOP) rows.push('<tr class="gap"><td colspan="5">⋯</td></tr>');
      rows.push(memberRow(m, row.key, p, i + 1));
    }
  });
  if (row.members.length > Math.max(SHOW_TOP, idx + 1)) rows.push(`<tr class="gap"><td colspan="5">ほか ${row.members.length - Math.max(SHOW_TOP, idx + 1)}匹</td></tr>`);
  return `<details class="cmp-league" ${row.total > 1 ? 'open' : ''}>
    <summary><span class="lname">${row.label}</span><span class="lrank">${row.rank ?? '—'}位</span><span class="muted small">${target}</span>
      <span class="pos ${posCls}">${posText}</span></summary>
    <table class="mtable"><thead><tr><th>順位</th><th>名前</th><th>CP</th><th>個体値</th><th>捕まえた日</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>
  </details>`;
}

function renderCompare() {
  const owned = state.pokemon.filter(p => p.status !== 'removed');
  const groups = buildGroups(owned);
  const recent = pickRecent(owned, state.imports, $('#recent').value)
    .sort((a, b) => (b.catchDate || '').localeCompare(a.catchDate || '') || a.dex - b.dex);
  $('#compare-count').textContent = recent.length ? `${recent.length}匹` : '対象のポケモンがいません。「対象」を変えてみてください。';
  $('#compare').innerHTML = recent.map(p => {
    const badges = [];
    if (p.form) badges.push(`<span class="badge b-form">${esc(p.form)}</span>`);
    if (p.shadow) badges.push(`<span class="badge ${p.shadow === 1 ? 'b-shadow' : 'b-pure'}">${SHADOW_LABEL[p.shadow]}</span>`);
    if (p.lucky) badges.push('<span class="badge b-lucky">キラ</span>');
    return `<li class="card">
      <div class="card-head"><span class="card-name">${esc(p.name)}</span><span class="dex">No.${p.dex}</span>${badges.join('')}
        <span class="card-cp">CP ${p.cp ?? '?'}</span></div>
      <div class="stats"><span>個体値 <b>${p.atk}/${p.def}/${p.sta}</b>（${p.ivPct ?? '?'}%）</span><span>捕まえた日 <b>${p.catchDate || '不明'}</b></span></div>
      ${judgeBlock(p)}
      ${compareOne(p, groups).map(r => cmpLeague(r, p)).join('')}
    </li>`;
  }).join('');
}
$('#recent').addEventListener('input', () => {
  renderCompare();
  try { localStorage.setItem('recent', $('#recent').value); } catch {}
});

// ---- import -----------------------------------------------------------
function renderHistory() {
  $('#history').innerHTML = state.imports.slice().reverse().map(i =>
    `<li><b>${esc(fmtDate(i.importedAt.slice(0, 16)))}</b> ${esc(i.fileName)}<br>
     <span class="muted">${i.rowCount}行：新規 ${i.added}・更新 ${i.updated}・変化なし ${i.unchanged}${i.dupInFile ? `・重複の疑い ${i.dupInFile}` : ''}</span></li>`
  ).join('') || '<li class="muted">まだ取り込んでいません</li>';
}

async function handleCSV(file) {
  const out = $('#import-result');
  try {
    const text = await file.text();
    const { header, records } = csvToObjects(text);
    const missing = validateHeader(header);
    if (missing.length) throw new Error(`Poke GenieのCSVではないようです（見つからない列：${missing.join('、')}）`);
    const imp = await store.importRows(records, file.name, state.pokemon);
    state = await store.loadState(); decisions.clear();
    out.innerHTML = `<div class="result">${records.length}匹を読み込みました。<br>
      新規 ${imp.added}匹・更新 ${imp.updated}匹・変化なし ${imp.unchanged}匹${imp.dupInFile ? `<br>重複の疑い ${imp.dupInFile}件（手持ちタブの「種別：重複の疑い」で確認できます）` : ''}</div>`;
    renderAll();
  } catch (e) {
    out.innerHTML = `<div class="result err">${esc(e.message)}</div>`;
  }
}

$('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleCSV(f); e.target.value = ''; });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleCSV(f); });

// ---- data -------------------------------------------------------------
$('#backup').addEventListener('click', async () => {
  const data = await store.exportBackup();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pogo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#restore').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!confirm(`今のデータを消して、バックアップ（${data.pokemon?.length ?? 0}匹）で置き換えます。よろしいですか？`)) return;
    await store.restoreBackup(data);
    state = await store.loadState(); decisions.clear();
    renderAll(); toast('復元しました');
  } catch (err) { alert(err.message); }
});
$('#wipe').addEventListener('click', async () => {
  if (!confirm('この端末のデータをすべて削除します。よろしいですか？')) return;
  await store.clearAll();
  state = await store.loadState(); decisions.clear();
  renderAll(); toast('削除しました');
});

// ---- settings -----------------------------------------------------------
$('#maxLevel').value = String(settings.maxLevel);
$('#maxLevel').addEventListener('input', () => {
  settings.maxLevel = Number($('#maxLevel').value);
  try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {}
  decisions.clear(); renderAll(); toast('判定をやり直しました');
});

// ---- boot -------------------------------------------------------------
function renderAll() { renderList(); renderCompare(); renderHistory(); }

(async function boot() {
  loadFilters();
  try { const r = localStorage.getItem('recent'); if (r) $('#recent').value = r; } catch {}
  try { const v = localStorage.getItem('view'); if (v) showView(v); } catch {}
  state = await store.loadState(); decisions.clear();
  renderAll();
  try {
    initDex(await (await fetch('data/pokedex.json')).json());
    dexReady = true; decisions.clear(); renderAll();
  } catch (e) { toast('ポケモンのデータを読み込めませんでした'); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
