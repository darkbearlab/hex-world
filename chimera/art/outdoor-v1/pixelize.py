# 奇美拉戶外戰鬥的點陣素材（2026-10-09）：照 ASH 的製程（docs/PIXEL_ART.md、tools/pixelize_terrain.py）。
# 來源：gpt-image-2（--quality low）生成的 1024×1024、4×4 圖集，提示詞在 PROMPT.md。
# 處理：依四等分切格 → BOX 縮成 32×32 → 地面整組共用 32 色、物件整組共用 31 色＋透明 → RGB555 取整 → 128×128 圖集。
# 地面亮度 ×0.78，讓人物站在上面看得清楚（同 ASH 的地板）。物件：洋紅 #FF00FF 背景去掉，alpha 二值化，最外一圈清透明。
# 重建：python chimera/art/outdoor-v1/pixelize.py → chimera/public/ash-outdoor/{ground,props,walls,trench,truck}.png 與 manifest.json
import hashlib, json, os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'ash-outdoor')
CELL = 32

def cells(img):
    w, h = img.size
    for r in range(4):
        for c in range(4):
            yield img.crop((round(c * w / 4), round(r * h / 4), round((c + 1) * w / 4), round((r + 1) * h / 4)))

def rgb555(v): return round(round(v / 255 * 31) / 31 * 255)

def ground(name='ground', k=.78):
    src = Image.open(os.path.join(HERE, f'source-{name}.png')).convert('RGB')
    tiles = [t.resize((CELL, CELL), Image.BOX) for t in cells(src)]
    atlas = Image.new('RGB', (CELL * 4, CELL * 4))
    for i, t in enumerate(tiles): atlas.paste(t, ((i % 4) * CELL, (i // 4) * CELL))
    atlas = atlas.point(lambda v: int(v * k))
    q = atlas.quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette()[:96]; q.putpalette([rgb555(v) for v in pal])
    q.save(os.path.join(OUT, f'{name}.png'), optimize=True)
    return src

def is_key(p): r, g, b = p[:3]; return r > 150 and b > 150 and g < 110 and abs(r - b) < 90

def props():
    src = Image.open(os.path.join(HERE, 'source-props.png')).convert('RGBA')
    px = src.load(); w, h = src.size
    for y in range(h):
        for x in range(w):
            if is_key(px[x, y]): px[x, y] = (0, 0, 0, 0)
    atlas = Image.new('RGBA', (CELL * 4, CELL * 4), (0, 0, 0, 0))
    for i, t in enumerate(cells(src)):
        s = t.resize((CELL, CELL), Image.BOX)
        d = s.load()
        for y in range(CELL):
            for x in range(CELL):
                r, g, b, a = d[x, y]
                edge = x == 0 or y == 0 or x == CELL - 1 or y == CELL - 1
                # 去掉洋紅混進邊緣的像素（偏紫紅的半透明邊）
                d[x, y] = (0, 0, 0, 0) if a < 128 or edge or (r > 120 and b > 120 and g < r * .6) else (r, g, b, 255)
        atlas.paste(s, ((i % 4) * CELL, (i // 4) * CELL))
    rgb = atlas.convert('RGB'); alpha = atlas.getchannel('A')
    q = rgb.quantize(colors=31, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
    q = Image.eval(q, rgb555)
    out = Image.merge('RGBA', (*q.split(), alpha))
    out.save(os.path.join(OUT, 'props.png'), optimize=True)
    return src

# 車頭（公路戰，2026-10-09）：source-cab-roof.png 的兩個車頂（從上面看，各 2×3 格）、source-cab-side.png 的四條車側（各 2 格寬、半格高）。
# 背景的近黑色去掉（車頭斜角、尖刺之間透出下面的路面）。輸出 cab.png（128×160）：車頂 (0,0) 橄欖綠、(64,0) 鏽鐵，各 64×96；
# 車側 x 0、y 96／112／128／144，各 64×16（橄欖綠 ×2、鏽鐵 ×2）
def cab():
    roof = Image.open(os.path.join(HERE, 'source-cab-roof.png')).convert('RGB')
    side = Image.open(os.path.join(HERE, 'source-cab-side.png')).convert('RGB')
    out = Image.new('RGBA', (128, 160), (0, 0, 0, 0))
    def put(img, box, size, at):
        # 背景：從裁切框四邊往內灌，只去掉和邊緣連在一起的近黑色（輪廓線是暗的，不能一律去掉）
        t = img.crop(box); w, h = t.size; d = t.load(); bg = Image.new('L', (w, h), 0); m = bg.load()
        stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
        while stack:
            x, y = stack.pop()
            if x < 0 or y < 0 or x >= w or y >= h or m[x, y] or max(d[x, y]) >= 26: continue
            m[x, y] = 255; stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        small = t.resize(size, Image.BOX).convert('RGBA'); cover = bg.resize(size, Image.BOX); sd, cd = small.load(), cover.load()
        for y in range(size[1]):
            for x in range(size[0]):
                r, g, b, a = sd[x, y]; sd[x, y] = (0, 0, 0, 0) if cd[x, y] > 128 else (r, g, b, 255)
        out.paste(small, at)
    put(roof, (14, 22, 509, 670), (64, 96), (0, 0)); put(roof, (515, 22, 1018, 670), (64, 96), (64, 0))
    for i, (y0, y1) in enumerate([(11, 270), (281, 531), (542, 775), (786, 1016)]): put(side, (0, y0, 1024, y1), (64, 16), (0, 96 + 16 * i))
    rgb = out.convert('RGB'); alpha = out.getchannel('A')
    q = Image.eval(rgb.quantize(colors=31, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB'), rgb555)
    Image.merge('RGBA', (*q.split(), alpha)).save(os.path.join(OUT, 'cab.png'), optimize=True)

def sha(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    ground(); props(); ground('walls', .9); ground('trench', .8); ground('truck', .85); cab()   # 牆材（牆面、牆頂、矮牆、邊緣）、戰壕斷面與溝底：和地面一樣的處理
    man = {'source': {k: sha(os.path.join(HERE, f'source-{k}.png')) for k in ('ground', 'props', 'walls', 'trench', 'truck', 'cab-roof', 'cab-side')},
           'out': {k: sha(os.path.join(OUT, f'{k}.png')) for k in ('ground', 'props', 'walls', 'trench', 'truck', 'cab')}, 'cell': CELL, 'grid': [4, 4]}
    json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print(json.dumps(man, indent=1))
