# 戰場地面 v2（Alan 2026-10-14：照 Claude 的建議換掉六種地形；鹼灘／鹼海保留原本的龜裂乾泥）。
# 素材庫 D:\_遊戲素材\地圖材質 的無縫材質（CC0，ambientCG／Poly Haven）→ 點陣：縮成 8×8 格（256 像素）連續鋪 → 限 10 色 → 平均亮度調成跟原本的地面一樣。
# 輸出 chimera/public/ash-outdoor/ground2/<種類>.png；戰場畫地面時（chimera-outdoor-render.js）照格子位置從這張切，相鄰的格子接得起來，看不出棋盤格。
# 比較圖：chimera/scripts/ground-compare.py。python chimera/scripts/ground-v2.py
import glob, os, random
from PIL import Image, ImageStat
here = os.path.dirname(os.path.abspath(__file__)); LIB = r'D:\_遊戲素材\地圖材質'; OUT = os.path.join(here, '..', 'public', 'ash-outdoor', 'ground2')
TILES = 8
G = {'sand': 0, 'ripple': 1, 'pebble': 2, 'clay': 4, 'clay2': 5, 'gravel': 6, 'scrub': 8, 'scrub2': 9, 'rock': 10, 'asphalt': 11, 'mud': 13, 'rubble': 14}
PICK = {   # 種類：素材、亮度對照用的原本那幾格
    'sand': ('Poly Haven', 'sand_01', ['sand', 'ripple', 'pebble']),
    'gravel': ('ambientCG', 'Ground108', ['gravel', 'pebble', 'clay']),
    'rock': ('Poly Haven', 'aerial_rocks_01', ['rock', 'gravel', 'pebble']),
    'scrub': ('ambientCG', 'Ground106', ['scrub2', 'scrub', 'clay']),
    'mud': ('Poly Haven', 'brown_mud_leaves_01', ['mud', 'clay']),
    'city': ('Poly Haven', 'aerial_asphalt_01', ['rubble', 'asphalt'])}
atlas = Image.open(os.path.join(here, '..', 'public', 'ash-outdoor', 'ground.png')).convert('RGB')
cell = lambda i: atlas.crop(((i % 4) * 32, (i // 4) * 32, (i % 4) * 32 + 32, (i // 4) * 32 + 32))
os.makedirs(OUT, exist_ok=True)
for key, (lib, name, ref) in PICK.items():
    d = os.path.join(LIB, lib, name)
    f = [x for x in glob.glob(d + r'\*') if x.lower().endswith(('.png', '.jpg')) and (('_Color' in x) if lib == 'ambientCG' else ('_diff' in x or '_col' in x))][0]
    mean = sum(ImageStat.Stat(cell(G[k]).convert('L')).mean[0] for k in ref) / len(ref)
    s = TILES * 32; q = Image.open(f).convert('RGB').resize((s, s), Image.BOX).quantize(colors=10, method=Image.MEDIANCUT).convert('RGB')
    k = mean / max(1, ImageStat.Stat(q.convert('L')).mean[0]); q = q.point(lambda v: max(0, min(255, round(v * k))))
    q.quantize(colors=10, method=Image.MEDIANCUT).save(os.path.join(OUT, f'{key}.png'), optimize=True)
    print(key, name, f'亮度 {mean:.0f}')
open(os.path.join(OUT, 'SOURCES.md'), 'w', encoding='utf-8').write('# 戰場地面 v2 的來源（CC0）\n\n' + '\n'.join(f'- `{k}.png`：{lib} `{n}`（D:\\_遊戲素材\\地圖材質），縮成 {TILES}×{TILES} 格、限 10 色、亮度對齊原本的地面' for k, (lib, n, _) in PICK.items()) + '\n\n產生：`python chimera/scripts/ground-v2.py`。\n')
