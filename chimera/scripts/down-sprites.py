# 原主的倒地 sprite（Alan 2026-10-12）：GPT 生的倒地參考圖 → 去背 → 幾輪小幅度的縮小＋減色 → 對到這位原主自己的 16 色色票 → GBA 15-bit → 加 1 格深色描邊
# 放進 donors/<原主>/sprite.png 的右半（32,0）；左半（站著）有就留著，沒有就空著（空著的那半，遊戲照舊用職業圖）
# 在 hex-world 根目錄跑：python chimera/scripts/down-sprites.py
import glob, os
from collections import deque
from PIL import Image
OUT = 'chimera/public/donors/'
SRC = 'C:/claude_project/_gptImageCaller/outputs/'
PAL = 'C:/claude_project/asset_generator/outputs/'
# 原主 → 採用的原圖（色票照它）
PICK = {'ember': 'gptfb_06', 'onyx': 'r3gpt_14', 'silver': 'gptfb_10', 'cedar': 'gptfb_01', 'portrait-05': 'gptfb_09', 'portrait-06': 'gptfb_03',
        'portrait-07': 'gptfb_07', 'portrait-08': 'r3gpt_22', 'portrait-09': 'r3gpt_19', 'portrait-10': 'r3gpt_20', 'portrait-11': 'r3gpt_15',
        'portrait-12': 'gptfb_11', 'portrait-13': 'r3gpt_16', 'portrait-14': 'r3gpt_23', 'portrait-15': 'gptfb_05', 'portrait-16': 'gptfb_08'}
def palette(src):
  f = glob.glob(PAL + f'chimera_{src}_*_q16.gpl') or glob.glob(PAL + f'chimera_r3_q16/chimera_{src}_*_q16.gpl')
  return [tuple(map(int, l.split()[:3])) for l in open(f[0]).read().splitlines() if l.strip()[:1].isdigit()][1:]
def dist(a, b):
  r = (a[0] + b[0]) / 2; dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
  return (2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db
def cutout(im):
  # 背景：四邊的中位色；跟它差夠多的才算人；只留最大的一塊（地上的灰塵、碎屑不要）
  sm = im.resize((im.width // 4, im.height // 4), Image.BOX); W, H = sm.size; px = sm.load()
  border = sorted([px[x, 0] for x in range(W)] + [px[x, H - 1] for x in range(W)] + [px[0, y] for y in range(H)] + [px[W - 1, y] for y in range(H)])
  bg = border[len(border) // 2]; on = [[max(abs(px[x, y][i] - bg[i]) for i in range(3)) > 38 for x in range(W)] for y in range(H)]
  seen = [[False] * W for _ in range(H)]; best = []
  for y in range(H):
    for x in range(W):
      if not on[y][x] or seen[y][x]: continue
      comp, q = [], deque([(x, y)]); seen[y][x] = True
      while q:
        cx, cy = q.popleft(); comp.append((cx, cy))
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
          if 0 <= nx < W and 0 <= ny < H and on[ny][nx] and not seen[ny][nx]: seen[ny][nx] = True; q.append((nx, ny))
      if len(comp) > len(best): best = comp
  m = Image.new('L', (W, H), 0); mp = m.load()
  for x, y in best: mp[x, y] = 255
  # 人身上被當成背景的小洞（淺色衣服）補起來：最大那塊的外框裡，四面都被包住的格子
  for y in range(H):
    row = [mp[x, y] for x in range(W)]
    if 255 in row: a, b = row.index(255), W - 1 - row[::-1].index(255)
    else: continue
    for x in range(a, b):
      if mp[x, y] == 0 and any(mp[x, yy] for yy in range(max(0, y - 30), y)) and any(mp[x, yy] for yy in range(y + 1, min(H, y + 30))): mp[x, y] = 255
  out = im.convert('RGBA'); out.putalpha(m.resize(im.size, Image.NEAREST)); return out
def shrink(im, size, colors):
  im = im.resize(size, Image.LANCZOS); a = im.getchannel('A'); rgb = im.convert('RGB').quantize(colors=colors, method=Image.MEDIANCUT).convert('RGB')
  out = rgb.convert('RGBA'); out.putalpha(a); return out
gba = lambda c: tuple((v >> 3) * 8 + ((v >> 3) >> 2) for v in c)
os.makedirs('C:/Users/user/AppData/Local/Temp/claude/C--claude-project/ada69efc-a353-4798-9ab5-85e1d01e6a17/scratchpad/down_out', exist_ok=True)
for key, src in PICK.items():
  f = sorted(glob.glob(SRC + f'chimera_down_{key}_v2_*.png'))[-1]; pal = palette(src)
  im = cutout(Image.open(f).convert('RGB')); bb = im.getchannel('A').getbbox(); im = im.crop(bb)
  # 躺著的人：放進正方形，身長約 30 格（左右各留 1 格）
  side = max(im.width, im.height); sq = Image.new('RGBA', (side, side), (0, 0, 0, 0)); sq.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2 + side // 14))
  for size, colors in ((256, 48), (128, 32), (64, 22), (30, 16)): sq = shrink(sq, (size, size), colors)   # 幾輪小幅度的縮小＋減色
  cell = Image.new('RGBA', (32, 32), (0, 0, 0, 0)); cell.alpha_composite(sq, (1, 1)); px = cell.load()
  dark = min(pal, key=lambda c: sum(c))
  for y in range(32):
    for x in range(32):
      r, g, b, a = px[x, y]; px[x, y] = gba(min(pal, key=lambda c: dist((r, g, b), c))) + (255,) if a >= 128 else (0, 0, 0, 0)
  edge = [(x, y) for y in range(32) for x in range(32) if px[x, y][3] == 0 and any(0 <= x + dx < 32 and 0 <= y + dy < 32 and px[x + dx, y + dy][3] == 255 and px[x + dx, y + dy][:3] != gba(dark) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
  for x, y in edge: px[x, y] = gba(dark) + (255,)   # 1 格深色描邊，戰場上才看得清楚
  path = OUT + key + '/sprite.png'; sheet = Image.open(path).convert('RGBA') if os.path.exists(path) else Image.new('RGBA', (64, 32), (0, 0, 0, 0))
  sheet.paste(Image.new('RGBA', (32, 32), (0, 0, 0, 0)), (32, 0)); sheet.alpha_composite(cell, (32, 0)); os.makedirs(OUT + key, exist_ok=True); sheet.save(path, optimize=True)
  print(key, os.path.basename(f)[:40], 'colors', len(set(px[x, y] for y in range(32) for x in range(32) if px[x, y][3])))
