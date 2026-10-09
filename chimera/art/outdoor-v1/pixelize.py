# 奇美拉戶外戰鬥的點陣素材（2026-10-09）：照 ASH 的製程（docs/PIXEL_ART.md、tools/pixelize_terrain.py）。
# 來源：gpt-image-2（--quality low）生成的 1024×1024、4×4 圖集，提示詞在 PROMPT.md。
# 處理：依四等分切格 → BOX 縮成 32×32 → 地面整組共用 32 色、物件整組共用 31 色＋透明 → RGB555 取整 → 128×128 圖集。
# 地面亮度 ×0.78，讓人物站在上面看得清楚（同 ASH 的地板）。物件：洋紅 #FF00FF 背景去掉，alpha 二值化，最外一圈清透明。
# 重建：python chimera/art/outdoor-v1/pixelize.py → chimera/public/ash-outdoor/{ground,props,walls}.png 與 manifest.json
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

def sha(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    ground(); props(); ground('walls', .9)   # 牆材（牆面、牆頂、矮牆、邊緣）：和地面一樣的處理，亮度 ×0.9
    man = {'source': {k: sha(os.path.join(HERE, f'source-{k}.png')) for k in ('ground', 'props', 'walls')},
           'out': {k: sha(os.path.join(OUT, f'{k}.png')) for k in ('ground', 'props', 'walls')}, 'cell': CELL, 'grid': [4, 4]}
    json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print(json.dumps(man, indent=1))
