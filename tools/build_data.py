"""Build data/pokedex.json from PvPoke's gamemaster.json and PokeAPI Japanese names.

Usage:
  curl -o gm.json https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json
  curl -o names.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv
  python3 tools/build_data.py gm.json names.csv data/pokedex.json
"""
import csv, json, sys

gm_path, names_path, out_path = sys.argv[1:4]
gm = json.load(open(gm_path, encoding='utf-8'))

ja = {}
for r in csv.DictReader(open(names_path, encoding='utf-8')):
    if r['local_language_id'] == '1':  # ja-Hrkt
        ja[int(r['pokemon_species_id'])] = r['name']

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
    out.append({
        'id': sid,
        'dex': p['dex'],
        'en': p['speciesName'],
        'ja': ja.get(p['dex'], p['speciesName']),
        'base': [b['atk'], b['def'], b['hp']],
        **({'parent': parent} if parent else {}),
        **({'evos': evos} if evos else {}),
        **({'legendary': True} if 'legendary' in tags else {}),
        **({'mythical': True} if 'mythical' in tags else {}),
        **({'released': False} if p.get('released') is False else {}),
    })

json.dump({'source': 'pvpoke gamemaster ' + str(gm.get('timestamp', '')), 'pokemon': out},
          open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'entries written')
