# 戰場地面：現有的點陣圖集 vs 素材庫的無縫材質（Alan 2026-10-14 問：有沒有比現在好的）。
# 每種地形一列：最左是現在的（ground.png，每格隨機一張 32×32），右邊是候選材質處理成點陣：
#   一張材質跨 TILES×TILES 格連續鋪（看不出格線）→ 縮到遊戲比例 → 限 10 色 → 平均亮度調成跟現在的一樣（角色才不會被地面吃掉）。
# python chimera/scripts/ground-compare.py 輸出.png
import glob, os, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageStat
here = os.path.dirname(os.path.abspath(__file__)); LIB = r'D:\_遊戲素材\地圖材質'
TILES, COLS, ROWS, K = 4, 10, 5, 2   # 材質跨 4×4 格；每塊預覽 10×5 格；放大 2 倍
G = {'sand': 0, 'ripple': 1, 'pebble': 2, 'clay': 4, 'clay2': 5, 'gravel': 6, 'scrub': 8, 'scrub2': 9, 'rock': 10, 'asphalt': 11, 'mud': 13, 'rubble': 14, 'oil': 15}
ROWS_DEF = [   # 地形（照 chimera-outdoor.js 的 BIOME）、現在用的格、候選材質
    ('沙海', ['sand', 'ripple', 'pebble'], ['P sand_01', 'A Ground080', 'P aerial_beach_01']),
    ('礫丘／寒漠', ['gravel', 'pebble', 'clay'], ['A Gravel041', 'P sandy_gravel_02', 'A Ground108']),
    ('岩山／斷崖', ['rock', 'gravel', 'pebble'], ['P aerial_rocks_01', 'A Ground110', 'P rocks_ground_02']),
    ('旱原／油棘林', ['scrub2', 'scrub', 'clay'], ['A Ground106', 'A Ground112', 'P forest_ground_04']),
    ('鹼灘／鹼海', ['clay', 'clay2', 'sand'], ['A Ground054', 'P gravelly_sand', 'P coast_sand_01']),
    ('鹽沼', ['mud', 'clay'], ['P brown_mud_leaves_01', 'A Ground111', 'P rocky_terrain_02']),
    ('總督府（城市廢墟）', ['rubble', 'asphalt'], ['P aerial_asphalt_01', 'A Asphalt033', 'P asphalt_02'])]
def tex(name):
    src, n = name.split(' ', 1)
    d = os.path.join(LIB, 'ambientCG' if src == 'A' else 'Poly Haven', n)
    f = [x for x in glob.glob(d + r'\*') if x.lower().endswith(('.png', '.jpg')) and (('_Color' in x) if src == 'A' else ('_diff' in x or '_col' in x))]
    return Image.open(f[0]).convert('RGB')
atlas = Image.open(os.path.join(here, '..', 'public', 'ash-outdoor', 'ground.png')).convert('RGB')
cell = lambda i: atlas.crop(((i % 4) * 32, (i // 4) * 32, (i % 4) * 32 + 32, (i // 4) * 32 + 32))
def current(keys, seed):
    r = random.Random(seed); im = Image.new('RGB', (COLS * 32, ROWS * 32))
    for y in range(ROWS):
        for x in range(COLS): im.paste(cell(G[r.choice(keys)]), (x * 32, y * 32))
    return im
def pixelize(t, mean):
    s = TILES * 32; small = t.resize((s, s), Image.BOX)
    q = small.quantize(colors=10, method=Image.MEDIANCUT).convert('RGB')
    k = mean / max(1, ImageStat.Stat(q.convert('L')).mean[0]); q = q.point(lambda v: max(0, min(255, round(v * k))))
    im = Image.new('RGB', (COLS * 32, ROWS * 32))
    for y in range(0, ROWS * 32, s):
        for x in range(0, COLS * 32, s): im.paste(q, (x, y))
    return im
font = ImageFont.truetype(r'C:\Windows\Fonts\msjh.ttc', 15); pw, ph = COLS * 32 * K, ROWS * 32 * K
C = Image.new('RGB', (4 * (pw + 10) + 10, len(ROWS_DEF) * (ph + 28) + 10), (20, 18, 15)); d = ImageDraw.Draw(C)
for i, (nm, keys, cands) in enumerate(ROWS_DEF):
    y = 10 + i * (ph + 28); now = current(keys, i); mean = ImageStat.Stat(now.convert('L')).mean[0]
    for j, (lab, im) in enumerate([('現在：' + nm, now)] + [(c, pixelize(tex(c), mean)) for c in cands]):
        x = 10 + j * (pw + 10); C.paste(im.resize((pw, ph), Image.NEAREST), (x, y + 22)); d.text((x, y + 2), lab, font=font, fill=(230, 194, 129))
C.save(sys.argv[1]); print('寫出', sys.argv[1])
