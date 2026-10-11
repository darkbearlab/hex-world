# 原主立繪（placeholder，Alan 2026-10-12）：減色版全身圖（不去背）→ 切成「胯部以上」的 full.png 和 64×64 的 portrait.png
# 來源在本機的 asset_generator（GPT 生的圖、16 色減色）；用法：python chimera/scripts/donor-art.py [輸出資料夾，預設 chimera/public/donors/]
import glob, os, sys
from PIL import Image, ImageChops
O = 'C:/claude_project/asset_generator/outputs/'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'chimera/public/donors/'
E = lambda n: glob.glob(O + f'chimera_gptfb_{n}_*_q16_preview.png')[0]
F = lambda n: glob.glob(O + f'chimera_r3_q16/chimera_r3gpt_{n}_*_q16_preview.png')[0]
# 原主 → (來源, 胯部在人物高度的比例, 頭在人物高度的比例, 頭像往下移（頭像邊長的比例，高馬尾、帽子要往下）, 往右移)
PICK = {
  'portrait-05': (E('09'), .5, .14, .22, 0), 'portrait-06': (E('03'), .5, .14, 0, 0), 'portrait-07': (E('07'), .5, .14, .2, -.14),
  'portrait-12': (E('11'), .5, .17, .06, 0), 'portrait-15': (E('05'), .5, .14, 0, 0), 'portrait-16': (E('08'), .5, .14, .1, 0),
  'portrait-08': (F('22'), .5, .14, 0, 0), 'portrait-09': (F('19'), .5, .13, 0, 0), 'portrait-10': (F('20'), .5, .13, .34, -.14),
  'ember': (E('06'), .5, .13, 0, 0), 'onyx': (F('14'), .5, .13, 0, 0), 'silver': (E('10'), .5, .14, 0, 0), 'cedar': (E('01'), .5, .14, 0, 0),   # 原本用 ASH 頭像的四位（Alan 2026-10-12 也接上）
  'portrait-11': (F('15'), .5, .14, 0, 0), 'portrait-13': (F('16'), .5, .13, .12, 0), 'portrait-14': (F('23'), .42, .14, .08, 0),
}
# 眼睛（Alan 2026-10-12：兩眼連線的中點在頭像正中間，兩眼外側佔頭像寬的二分之一到三分之二）：(兩眼中點 x, y, 兩眼外眼角的距離)，原圖座標，看圖量的
EYES = {"portrait-05": [497, 199, 100], "portrait-06": [507, 165, 82], "portrait-07": [436, 224, 99], "portrait-12": [508, 185, 98], "portrait-15": [494, 200, 96], "portrait-16": [496, 222, 100], "portrait-08": [497, 145, 89], "portrait-09": [485, 144, 81], "portrait-10": [473, 191, 87], "ember": [521, 188, 95], "onyx": [483, 179, 90], "silver": [527, 191, 104], "cedar": [514, 191, 100], "portrait-11": [503, 188, 98], "portrait-13": [524, 176, 95], "portrait-14": [500, 214, 100]}
EYE_SPAN = .58
FULL_RATIO = .72   # 立繪 full.png 的寬高比（全部一樣）
def figure_box(im):
  # 人物的範圍：跟左上角的背景色差得夠多的地方
  rgb = im.convert('RGB'); bg = Image.new('RGB', rgb.size, rgb.getpixel((2, 2)))
  diff = ImageChops.difference(rgb, bg).convert('L').point(lambda v: 255 if v > 40 else 0)
  return diff, diff.getbbox()
os.makedirs(OUT, exist_ok=True)
for key, (src, hip, head, dy, dx) in PICK.items():
  im = Image.open(src).convert('RGB'); mask, (x0, y0, x1, y1) = figure_box(im); h = y1 - y0
  # full.png：頭頂到胯部，左右照人物寬度留一點邊，下緣就是胯部（貼底）
  # 比例統一（Alan 2026-10-12：詳細資料裡的立繪比例不一）：寬 = 高 × FULL_RATIO，水平以兩眼中點置中；原圖不夠寬就用背景色補
  yb = y0 + int(h * hip); top = max(0, y0 - 24); Hs = yb - top; Ws = round(Hs * FULL_RATIO)
  cx = EYES[key][0] if key in EYES else (x0 + x1) // 2; lx = int(cx - Ws / 2)
  full = Image.new('RGB', (Ws, Hs), im.getpixel((2, 2))); full.paste(im.crop((max(0, lx), top, min(im.width, lx + Ws), yb)), (max(0, -lx), 0))
  full = full.resize((round(820 * FULL_RATIO), 820), Image.NEAREST)   # 減色圖：不要混出中間色
  d = os.path.join(OUT, key); os.makedirs(d, exist_ok=True); full.quantize(colors=16, method=Image.MEDIANCUT).save(os.path.join(d, 'full.png'), optimize=True)
  # portrait.png：頭的正方形，中心照頭那一段人物像素的平均位置
  hh = int(h * head); band = mask.crop((0, y0, im.width, y0 + hh)); px = band.load()
  cols = [x for x in range(band.width) if any(px[x, y] for y in range(0, hh, 4))]
  cx = (sum(cols) / len(cols) if cols else (x0 + x1) / 2); side = int(hh * 1.2); cx += dx * side
  ty = max(0, y0 - int(side * .06) + int(side * dy)); lx = min(max(0, int(cx - side / 2)), im.width - side)   # 不要切出圖外
  if key in EYES: ex, ey, span = EYES[key]; side = round(span / EYE_SPAN); lx, ty = ex - side // 2, ey - side // 2   # 有量過眼睛的照眼睛對
  sq = im.crop((lx, ty, lx + side, ty + side))
  sq.resize((64, 64), Image.LANCZOS).quantize(colors=16, method=Image.MEDIANCUT).save(os.path.join(d, 'portrait.png'), optimize=True)
  print(key, os.path.basename(src)[:28], 'full', full.size, 'head', side)
