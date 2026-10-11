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
def figure_box(im):
  # 人物的範圍：跟左上角的背景色差得夠多的地方
  rgb = im.convert('RGB'); bg = Image.new('RGB', rgb.size, rgb.getpixel((2, 2)))
  diff = ImageChops.difference(rgb, bg).convert('L').point(lambda v: 255 if v > 40 else 0)
  return diff, diff.getbbox()
os.makedirs(OUT, exist_ok=True)
for key, (src, hip, head, dy, dx) in PICK.items():
  im = Image.open(src).convert('RGB'); mask, (x0, y0, x1, y1) = figure_box(im); h = y1 - y0
  # full.png：頭頂到胯部，左右照人物寬度留一點邊，下緣就是胯部（貼底）
  yb = y0 + int(h * hip); top = max(0, y0 - 24)
  full = im.crop((max(0, x0 - 24), top, min(im.width, x1 + 24), yb))
  s = 820 / full.height; full = full.resize((round(full.width * s), 820), Image.NEAREST)   # 減色圖：不要混出中間色
  d = os.path.join(OUT, key); os.makedirs(d, exist_ok=True); full.quantize(colors=16, method=Image.MEDIANCUT).save(os.path.join(d, 'full.png'), optimize=True)
  # portrait.png：頭的正方形，中心照頭那一段人物像素的平均位置
  hh = int(h * head); band = mask.crop((0, y0, im.width, y0 + hh)); px = band.load()
  cols = [x for x in range(band.width) if any(px[x, y] for y in range(0, hh, 4))]
  cx = (sum(cols) / len(cols) if cols else (x0 + x1) / 2); side = int(hh * 1.2); cx += dx * side
  ty = max(0, y0 - int(side * .06) + int(side * dy)); lx = min(max(0, int(cx - side / 2)), im.width - side)   # 不要切出圖外
  sq = im.crop((lx, ty, lx + side, ty + side))
  sq.resize((64, 64), Image.LANCZOS).quantize(colors=16, method=Image.MEDIANCUT).save(os.path.join(d, 'portrait.png'), optimize=True)
  print(key, os.path.basename(src)[:28], 'full', full.size, 'head', side)
