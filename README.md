# ポケモン手持ち管理

Poke GenieのCSVを取り込んで、手持ちのポケモンをリーグ別のランクで整理するウェブアプリです。スマホでもPCでも、ブラウザで使えます。

## 使い方

1. Poke Genieでポケモンをスキャンし、CSVを書き出す
2. アプリの「取り込み」タブでCSVを選ぶ（PCではドラッグ＆ドロップもできます）
3. 「手持ち」タブで、検索・並べ替え・絞り込みをする

- データは端末のブラウザ（IndexedDB）にだけ保存されます。どこにも送信しません。
- 同じCSVを何度取り込んでも、同じ個体が重複して登録されることはありません。
- スマホとPCの間でデータを移すときは、「データ」タブのバックアップと復元を使います。

## 残す・送るの判定と名前

**リーグ・カップへの所属**
- どこかのリーグ・カップで50位以内に入れば所属。進化後の順位も見るが、進化後も今のレベルでCP上限に収まる必要がある。
- 複数で50位以内なら、いちばん進化した形を優先。同じ進化段階なら ML > HL > SL > LC の順。
- レベル40超えは、常にマスターリーグとして `PL` ＋順位（`PL③`、`PL123`）。
- リトルカップは、まだ進化しておらず、これから進化できるポケモンだけが対象。

**名前** ＝ リーグ＋順位＋進化段階マーク ＋ レガシー技の頭文字 ＋ `＊`（色違い） ＋ `XXL`/`XXS` ＋ 捕まえた年（2017年以前）
- 例：`ML③`、`SL②♴`、`ML③ブ`、`ML⑧＊`、`ML③XXL`、`ML③2017`
- 順位：50位以内は丸数字、それ以外は数字、1000位以下は `999+`
- 進化段階マーク：HL・SL・LCで、進化のある系統のとき、順位の対象になった形の段階を `♳`（進化していない種類）`♴`（1回進化した種類）`♵`（2回進化した種類）で表す
- シャドウがMLに所属する場合：`ML239→㊵`（今の順位→リトレーン後の順位）

**どのリーグ・カップにも所属しない場合**
- 2017年以前に捕まえた：交換候補。名前は年（`2017`）。色違い・XXL・XXSなら前につける（`＊2017`）
- レガシー技・ダイマックス・キョダイマックス・でんせつ・まぼろし・フィールド効果：残す。いちばん順位が良いリーグと進化形で `ML128ガ` の形
- 色違い・XXL・XXSだけ：残す。`＊`、`XXL`、`XXS`
- どれにも当てはまらない：送る候補（名前はそのまま）

色違い・ダイマックス・キョダイマックス・フィールド効果・XXL・XXSはCSVに出ないため、カードのボタンで手動で印をつける。レガシー技はゲームデータから自動で判定する。

順位はPvPokeと同じ方法で計算する（CP上限以下の最も高いレベルでのステータス積の順位。同じ値は同じ順位）。最大レベルは「データ」タブで設定でき、初期値はPoke Genieの設定に合わせて40。

## ゲームデータの更新

```
curl -o gm.json https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json
curl -o names.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv
curl -o moves.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/moves.csv
curl -o move_names.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/move_names.csv
python3 tools/build_data.py gm.json names.csv moves.csv move_names.csv data/pokedex.json
```

## ローカルで動かす

```
python3 -m http.server 8000
```

ブラウザで http://localhost:8000 を開きます（`file://` で直接開くとES Modulesが動きません）。

## Poke Genie CSVについて

- リーグの列：`(G)` スーパー、`(U)` ハイパー、`(L)` リトルカップ。マスターリーグは含まれません。
- ランクは進化後のポケモンについての値です（`名前 (G)` などの列）。
- `シャドウ/リトレーン`：0 = 通常、1 = シャドウ、2 = リトレーン。
- 個体の判定：図鑑番号 + すがた + シャドウ/リトレーン + 個体値3つ + 捕まえた日（捕まえた日がない場合は元のスキャン日付）。

## 個人データ

CSVとバックアップのJSONは `.gitignore` で除外しています。コミットしないでください。

## 構成

- `index.html`, `css/style.css`：画面
- `js/csv.js`：CSVの読み込み
- `js/pokegenie.js`：Poke Genieの列の対応づけ、個体の判定キー
- `js/ranking.js`：個体値ランキングの計算
- `js/dex.js`：ポケモンの種類・進化の情報
- `js/naming.js`：残す・送るの判定と名前
- `js/compare.js`：最近捕まえたポケモンと手持ちの比較
- `data/pokedex.json`：ゲームデータ（PvPoke・PokeAPIから生成）
- `js/store.js`：手持ちデータへの統合、バックアップ
- `js/db.js`：IndexedDB
- `sw.js`, `manifest.webmanifest`：ホーム画面への追加とオフライン対応
