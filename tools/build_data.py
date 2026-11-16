"""Build data/pokedex.json from PvPoke's gamemaster.json and PokeAPI Japanese names.

Usage:
  curl -o gm.json https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json
  curl -o names.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv
  curl -o moves.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/moves.csv
  curl -o move_names.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/move_names.csv
  python3 tools/build_data.py gm.json names.csv moves.csv move_names.csv data/pokedex.json
"""
import csv, json, sys

gm_path, names_path, moves_path, move_names_path, out_path = sys.argv[1:6]
gm = json.load(open(gm_path, encoding='utf-8'))

ja = {}
for r in csv.DictReader(open(names_path, encoding='utf-8')):
    if r['local_language_id'] == '1':  # ja-Hrkt
        ja[int(r['pokemon_species_id'])] = r['name']

# GO move id (BLAST_BURN) -> Japanese name, via PokeAPI identifiers (blast-burn).
move_ident = {r['identifier']: r['id'] for r in csv.DictReader(open(moves_path, encoding='utf-8'))}
move_ja = {}
for r in csv.DictReader(open(move_names_path, encoding='utf-8')):
    if r['local_language_id'] == '1':
        move_ja[r['move_id']] = r['name']
unmapped = set()

ALIASES = {'super_power': 'superpower'}

def ja_move(move_id):
    parts = ALIASES.get(move_id.lower(), move_id.lower()).split('_')
    while parts:  # HIDDEN_POWER_FIRE -> hidden-power
        mid = move_ident.get('-'.join(parts))
        if mid and mid in move_ja:
            return move_ja[mid]
        parts = parts[:-1]
    unmapped.add(move_id)
    return None

out = []
for p in gm['pokemon']:
    tags = p.get('tags', [])
    sid = p['speciesId']
    if 'shadow' in tags or 'mega' in tags or 'supermega' in tags or sid.endswith('_shadow'):
        continue
    fam = p.get('family') or {}
    evos = [e for e in fam.get('evolutions', []) if not e.endswith('_shadow')]
    parent = fam.get('parent')
    if parent and parent.endswith('_shadow'):
        parent = None
    b = p['baseStats']
    legacy = sorted({n for m in (p.get('eliteMoves') or []) + (p.get('legacyMoves') or []) if (n := ja_move(m))})
    out.append({
        'id': sid,
        'dex': p['dex'],
        'en': p['speciesName'],
        'ja': ja.get(p['dex'], p['speciesName']),
        'base': [b['atk'], b['def'], b['hp']],
        **({'parent': parent} if parent else {}),
        **({'evos': evos} if evos else {}),
        **({'legacy': legacy} if legacy else {}),
        **({'legendary': True} if 'legendary' in tags else {}),
        **({'mythical': True} if 'mythical' in tags else {}),
        **({'released': False} if p.get('released') is False else {}),
    })

json.dump({'source': 'pvpoke gamemaster ' + str(gm.get('timestamp', '')), 'pokemon': out},
          open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'entries written')
if unmapped:
    print('legacy moves without a Japanese name:', ' '.join(sorted(unmapped)))
