# 原主的戰場 sprite v2（Alan 2026-10-14：參考 ASH 當初產職業 sprite 的提示詞，重新試做；細節被吃掉沒關係，「看起來」要對）。
# 來源：gpt-image-2 產的雙人圖（左＝站著、右＝倒地），畫在純綠底上（gpt-image-2 不給透明底）。
# 縮成 32×32：去綠底、清掉小碎塊 → 左右各取一個角色 → 先限色，再「每一塊取出現最多的顏色」縮小（不平均，顏色才不會糊在一起）
# → 加強對比與飽和 → 補一圈近黑的外框。
# 輸出 64×32（左站、右倒），和 chimera-donor-art.js 讀的 donors/<原主>/sprite.png 同格式。
# python chimera/scripts/donor-sprite-v2.py 來源.png 輸出.png [--colors 14]
import sys
from collections import Counter, deque
from PIL import Image, ImageEnhance
src, out = sys.argv[1], sys.argv[2]
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
COLORS = int(arg('--colors', 14)); OUTLINE = (16, 12, 10, 255)
im = Image.open(src).convert('RGBA'); W, H = im.size; px = im.load()
for y in range(H):   # 綠底（含邊緣帶綠的那一圈）變透明
    for x in range(W):
        r, g, b, a = px[x, y]
        if g > 120 and g - max(r, b) > 40: px[x, y] = (0, 0, 0, 0)
# 清掉小碎塊（綠邊殘留的點）：連在一起不到 400 格的不透明區塊
seen = bytearray(W * H); side = []   # 每一塊照重心分到左（站）或右（倒）
for y0 in range(H):
    for x0 in range(W):
        if seen[y0 * W + x0] or not px[x0, y0][3]: continue
        comp, q = [], deque([(x0, y0)]); seen[y0 * W + x0] = 1
        while q:
            x, y = q.popleft(); comp.append((x, y))
            for a, b in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= a < W and 0 <= b < H and not seen[b * W + a] and px[a, b][3]: seen[b * W + a] = 1; q.append((a, b))
        if len(comp) < 400:
            for x, y in comp: px[x, y] = (0, 0, 0, 0)
        else: side.append((sum(x for x, _ in comp) / len(comp) < W / 2, comp))
def figure(left, fit, bottom):
    # 只留這一邊的塊（倒地的靴子或掉在地上的武器跨過中線也不會被切進另一邊）
    one = Image.new('RGBA', im.size, (0, 0, 0, 0)); op = one.load()
    for l, comp in side:
        if l == left:
            for x, y in comp: op[x, y] = px[x, y]
    part = one.crop(one.getbbox())
    rgb = Image.new('RGB', part.size); rgb.paste(part, mask=part.split()[3])
    rgb = ImageEnhance.Color(ImageEnhance.Contrast(rgb).enhance(1.12)).enhance(1.05)
    pal = rgb.quantize(colors=48, method=Image.MEDIANCUT).convert('RGB'); pp = pal.load(); ap = part.split()[3].load()
    w, h = part.size; k = min(fit[0] / w, fit[1] / h); nw, nh = max(1, round(w * k)), max(1, round(h * k))
    cell = Image.new('RGBA', (32, 32), (0, 0, 0, 0)); cp = cell.load(); ox = (32 - nw) // 2; oy = 31 - nh if bottom else (32 - nh) // 2 + 2
    for ty in range(nh):
        for tx in range(nw):
            x0, x1, y0, y1 = int(tx * w / nw), max(int(tx * w / nw) + 1, int((tx + 1) * w / nw)), int(ty * h / nh), max(int(ty * h / nh) + 1, int((ty + 1) * h / nh))
            cs = Counter(); n = 0
            for y in range(y0, y1):
                for x in range(x0, x1):
                    n += 1
                    if ap[x, y] >= 128: cs[pp[x, y]] += 1
            if sum(cs.values()) * 2 >= n: cp[ox + tx, oy + ty] = cs.most_common(1)[0][0] + (255,)
    return cell
stand = figure(True, (28, 29), True)
dead = figure(False, (31, 22), False)
sheet = Image.new('RGBA', (64, 32), (0, 0, 0, 0)); sheet.paste(stand, (0, 0)); sheet.paste(dead, (32, 0))
rgb = Image.new('RGB', sheet.size, (0, 0, 0)); rgb.paste(sheet, mask=sheet.split()[3])
q = rgb.quantize(colors=COLORS, method=Image.MEDIANCUT).convert('RGB'); qp = q.load(); sp = sheet.load()
for y in range(32):
    for x in range(64):
        if sp[x, y][3]: sp[x, y] = qp[x, y] + (255,)
edge = [(x, y) for y in range(32) for x in range(64) if not sp[x, y][3] and any(0 <= a < 64 and 0 <= b < 32 and a // 32 == x // 32 and sp[a, b][3] and sp[a, b] != OUTLINE for a, b in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))]
for x, y in edge: sp[x, y] = OUTLINE
sheet.save(out, optimize=True); print('寫出', out, f'{COLORS} 色＋外框')
