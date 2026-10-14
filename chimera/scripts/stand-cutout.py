# 主選單的站姿立繪（Alan 2026-10-14：像艦娘、少女前線那樣，立繪貼齊畫面下緣站在畫面裡）。
# donors/<原主>/full.png 是調色盤圖、底是幾個灰色（有的帶一點雜訊）：
#   1. 底色＝上、左、右三邊上常出現、而且接近最常見那個顏色的幾個顏色（下緣有腳，不算）；
#   2. 從四邊往裡填，是底色、連在一起的格子變透明（角色身上剛好同色、但沒連到邊的不會被去掉）；
#   3. 緊貼透明區、顏色接近底色的那一圈（頭髮邊緣的毛邊）也去掉，做兩次。
# 存成同一個資料夾的 stand.png，原本的 full.png 不動。python chimera/scripts/stand-cutout.py [--sheet 輸出.png]
import glob, os, sys
from collections import Counter, deque
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
near = lambda a, b, t: abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) <= t
outs = []
HOLES = {'io/combat'}   # 要挖手臂和身體之間封閉底色的立繪
for f in sorted(glob.glob(os.path.join(here, '..', 'public', 'donors', '*', 'full.png')) + glob.glob(os.path.join(here, '..', 'public', 'donors', '*', '*', 'full.png'))):   # 第二層是換裝的衣服（donors/<原主>/<衣服>/）
    im = Image.open(f).convert('RGBA'); W, H = im.size; px = im.load()
    edge = [px[x, 0] for x in range(W)] + [px[0, y] for y in range(H)] + [px[W - 1, y] for y in range(H)]
    cnt = Counter(edge); ref = cnt.most_common(1)[0][0]
    bg = {c for c, k in cnt.items() if k >= len(edge) * .005 and near(c, ref, 45)}   # 只算接近最常見那個底色的（深色的頭髮、斗篷碰到邊也不會被當成底）
    seen = bytearray(W * H); q = deque([(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]); n = 0
    while q:
        x, y = q.popleft(); i = y * W + x
        if seen[i] or px[x, y] not in bg: continue
        seen[i] = 1; px[x, y] = (0, 0, 0, 0); n += 1
        for a, b in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= a < W and 0 <= b < H: q.append((a, b))
    # 被手臂圍起來、碰不到邊的底色（伊歐的戰鬥服，2026-10-14）：連成一大塊（至少 HOLE 格）的才去掉，角色身上零星同色的不動
    # 只對 HOLES 裡的開（2026-10-14 試過全部都開：膚色淺的人臉會被挖洞）
    HOLE = 1500; key = os.path.relpath(os.path.dirname(f), os.path.join(here, '..', 'public', 'donors')).replace(os.sep, '/')
    for y0 in (range(H) if key in HOLES else ()):
        for x0 in range(W):
            if seen[y0 * W + x0] or px[x0, y0] not in bg: continue
            blob, q2 = [], deque([(x0, y0)]); seen[y0 * W + x0] = 1
            while q2:
                x, y = q2.popleft(); blob.append((x, y))
                for a, b in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= a < W and 0 <= b < H and not seen[b * W + a] and px[a, b] in bg: seen[b * W + a] = 1; q2.append((a, b))
            if len(blob) >= HOLE:
                for x, y in blob: px[x, y] = (0, 0, 0, 0)
                n += len(blob)
    for _ in range(2):   # 毛邊
        kill = [(x, y) for y in range(H) for x in range(W) if px[x, y][3] and near(px[x, y], ref, 60)
                and any(0 <= a < W and 0 <= b < H and px[a, b][3] == 0 for a, b in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))]
        for x, y in kill: px[x, y] = (0, 0, 0, 0)
        n += len(kill)
    out = os.path.join(os.path.dirname(f), 'stand.png'); im.save(out, optimize=True); outs.append(im)
    print(os.path.relpath(out, here), f'去掉 {n * 100 // (W * H)}%')
if '--sheet' in sys.argv:   # 檢查用：16 張貼在暗紫色底上排成一張
    w, h = 148, 205; S = Image.new('RGB', (w * 8, h * ((len(outs) + 7) // 8)), (40, 30, 60))
    for i, im in enumerate(outs): S.paste(im.resize((w, h)), ((i % 8) * w, (i // 8) * h), im.resize((w, h)))
    S.save(sys.argv[sys.argv.index('--sheet') + 1])
