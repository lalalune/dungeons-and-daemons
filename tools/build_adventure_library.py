import json, sys, glob, os, re
briefs_dir, out = sys.argv[1], sys.argv[2]
FIELDS = ['id','title','credit','levels','tone','length','tagline','summary','startLocation','opening','dmBrief']
items, problems = [], []
for path in sorted(glob.glob(os.path.join(briefs_dir, '*.json'))):
    try:
        d = json.load(open(path, encoding='utf-8'))
    except Exception as e:
        problems.append(f'{os.path.basename(path)}: bad JSON {e}'); continue
    miss = [f for f in FIELDS if not d.get(f)]
    if miss: problems.append(f"{d.get('id')}: missing {miss}"); continue
    if not re.fullmatch(r'[a-z0-9-]{3,60}', d['id']): problems.append(f"{d['id']}: bad id")
    words = lambda t: len(str(t).split())
    if words(d['dmBrief']) > 450: problems.append(f"{d['id']}: dmBrief {words(d['dmBrief'])} words")
    if words(d['opening']) > 170: problems.append(f"{d['id']}: opening {words(d['opening'])} words")
    item = {f: d[f] for f in FIELDS}
    item['levels'] = str(item['levels'])
    item['startLocation'] = {'name': d['startLocation']['name'], 'description': d['startLocation']['description']}
    items.append((d.get('isAdventure', True), item, words(d['dmBrief']), words(d['opening'])))
items.sort(key=lambda t: (int(re.match(r'\d+', t[1]['levels']).group()) if re.match(r'\d+', t[1]['levels']) else 99, t[1]['title']))
body = json.dumps([i[1] for i in items], indent=2, ensure_ascii=False)
open(out, 'w', encoding='utf-8', newline='\n').write(
    "/**\n * Adventure briefs: short, originally worded summaries written from the\n * source adventures. Generated; edit the briefs and regenerate.\n */\n\nimport type { Adventure } from './index';\n\nexport const LIBRARY: Adventure[] = " + body + ";\n")
for adv, i, b, o in items:
    print(f"{i['levels']:>6} | {i['title'][:44]:44} | brief {b:3}w open {o:3}w | {'adventure' if adv else 'ORIGINAL PREMISE'}")
print(len(items), 'adventures;', 'problems:', problems or 'none')
