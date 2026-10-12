# 娜迪亞的戰場 sprite（Alan 2026-10-12；在 hex-world 根目錄跑：python chimera/scripts/cedar-sprite.py）：工作室畫的 32×32 站姿 → 對到她自己的 16 色色票（立繪、頭像同一套），最多 15 色＋透明，貼齊 GBA 15-bit
from PIL import Image
SRC = 'chimera/scripts/sprite-src/cedar-stand.png'   # 工作室畫的原圖（61 色）
GPL = 'C:/claude_project/asset_generator/outputs/chimera_gptfb_01_courier_20261011_231713_01_q16.gpl'
pal = [tuple(map(int, l.split()[:3])) for l in open(GPL).read().splitlines() if l.strip()[:1].isdigit()][1:]   # 去掉 00 透明
def dist(a, b):   # redmean：照人眼的感覺加權
  r = (a[0] + b[0]) / 2; dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
  return (2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db
im = Image.open(SRC).convert('RGBA'); px = im.load(); W, H = im.size
near = lambda c: min(range(len(pal)), key=lambda i: dist(c, pal[i]))
idx = {(x, y): near(px[x, y][:3]) for y in range(H) for x in range(W) if px[x, y][3] > 128}
# 超過 15 色：用得最少的併到最接近的另一色
while len(set(idx.values())) > 15:
  used = {}; [used.__setitem__(i, used.get(i, 0) + 1) for i in idx.values()]
  lo = min(used, key=used.get); to = min((i for i in used if i != lo), key=lambda i: dist(pal[lo], pal[i]))
  idx = {k: (to if v == lo else v) for k, v in idx.items()}
gba = lambda c: tuple((v >> 3) * 8 + ((v >> 3) >> 2) for v in c)   # 15-bit：每色 32 階
out = Image.new('RGBA', (64, 32), (0, 0, 0, 0)); op = out.load()
for (x, y), i in idx.items(): op[x, y] = gba(pal[i]) + (255,)   # 左半：站著；右半空著＝倒地照舊用職業圖
out.save('chimera/public/donors/cedar/sprite.png', optimize=True)
print('colors', len(set(idx.values())), 'pixels', len(idx))
