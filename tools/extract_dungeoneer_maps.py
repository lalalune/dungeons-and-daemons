import json, sys, base64, io, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
def load(name):
    return json.load(open(os.path.join(src, name + '.dungeoneer_map'), encoding='utf-8-sig'))
def img(d, key):
    return Image.open(io.BytesIO(base64.b64decode(d[key])))
def save(im, name, size, alpha=False):
    im = im.convert('RGBA' if alpha else 'RGB')
    if im.width > size: im = im.resize((size, round(im.height * size / im.width)), Image.LANCZOS)
    im.save(os.path.join(out, name), 'WEBP', quality=78, method=6)
    return im.size
manifest = {}
for key, name, title in [('cave', 'snowy cave', 'Snowy cave'), ('swamp', 'swamp', 'Swamp'), ('desert', 'sandstorm', 'Sandstorm'), ('road', 'roadside waterfall', 'Roadside waterfall')]:
    d = load(name)
    save(img(d, 'foregroundBase64'), f'{key}.webp', 1600)
    entry = {'title': title, 'image': f'/maps/{key}.webp'}
    world = d.get('bg_width') or 1400
    walls = []
    for s in d.get('segments') or []:
        pts = [s['a']['x'], s['a']['y'], s['b']['x'], s['b']['y']]
        if all(-60 <= p <= world + 60 for p in pts):
            walls.append([round(min(1, max(0, p / world)), 4) for p in pts])
    if len(walls) > 20: entry['walls'] = walls
    manifest[key] = entry
d = load('ship at sea')
save(img(d, 'backgroundBase64'), 'sea.webp', 1400)
save(img(d, 'foregroundBase64'), 'ship.webp', 1600, alpha=True)
W = d['layer2_width']; t = d['foregroundTranslate']; w = d['bg_width']; h = w * d['bg_height_width_ratio']
manifest['ship'] = {'title': 'Ship at sea', 'image': '/maps/sea.webp', 'slide': True,
                    'overlay': {'image': '/maps/ship.webp', 'x': round(t['x'] / W, 4), 'y': round(t['y'] / W, 4), 'w': round(w / W, 4), 'h': round(h / W, 4), 'bob': True}}
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), separators=(',', ':'))
open(os.path.join(out, 'README.md'), 'w', encoding='utf-8').write(
"# Maps from Dungeoneer\n\nThese maps (images, wall lines and animation settings) are converted from the\ndefault map library of [Dungeoneer](https://github.com/Durtur/Dungeoneer) by Durtur,\ncommit `dca8a177bcf237e95a3eb8e6a080b7d0e07fdf98`, `data/default_library/`, licensed AGPL-3.0.\nImages were resized and re-encoded; wall coordinates were normalized to 0..1.\n")
for k, v in manifest.items(): print(k, v['title'], 'walls', len(v.get('walls', [])), 'slide' if v.get('slide') else '')
