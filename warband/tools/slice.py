# 把 gpt-image 產的 4x4 sprite sheet 切成 64px 透明 sprite，輸出一張 256x256 atlas
import sys, json
from PIL import Image
from collections import deque

def cut(src, out, names):
    im = Image.open(src).convert('RGBA'); W, H = im.size; cw, ch = W // 4, H // 4
    atlas = Image.new('RGBA', (256, 256), (0, 0, 0, 0)); meta = {}
    for idx, name in enumerate(names):
        cx, cy = idx % 4, idx // 4
        cell = im.crop((cx * cw, cy * ch, (cx + 1) * cw, (cy + 1) * ch)); px = cell.load(); w, h = cell.size
        # 背景：從格子邊緣灌水，顏色接近邊緣平均灰色的都清成透明
        edge = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)]
        med = lambda k: sorted(c[k] for c in edge)[len(edge) // 2]
        br, bg, bb = med(0), med(1), med(2)
        near = lambda c: abs(c[0] - br) + abs(c[1] - bg) + abs(c[2] - bb) < 36
        seen = [[False] * h for _ in range(w)]; q = deque()
        for x in range(w): q.append((x, 0)); q.append((x, h - 1))
        for y in range(h): q.append((0, y)); q.append((w - 1, y))
        while q:
            x, y = q.popleft()
            if x < 0 or y < 0 or x >= w or y >= h or seen[x][y]: continue
            seen[x][y] = True
            if not near(px[x, y]): continue
            px[x, y] = (0, 0, 0, 0)
            q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
        small = cell.resize((64, 64), Image.BOX)
        sp = small.load()
        for y in range(64):
            for x in range(64):
                r, g, b, a = sp[x, y]
                sp[x, y] = (r, g, b, 255) if a >= 140 else (0, 0, 0, 0)
        atlas.paste(small, (cx * 64, cy * 64))
        if name: meta[name] = [cx * 64, cy * 64]
    atlas.save(out)
    return meta

U = '/mnt/user-data/uploads/claude_project/_gptImageCaller/outputs/'
D = '/home/claude/hex-world/warband/public/art/'
m = {}
m['people'] = cut(U + 'medieval_people_20261006_133826_01.png', D + 'people.png',
  ['knight', 'archer', 'peasant', 'monk', 'merchant', 'king', 'queen', 'smith', 'priest', 'crossbow', 'spearman', 'bard', 'herbalist', 'thief', 'nun', 'squire'])
m['foes'] = cut(U + 'medieval_foes_20261006_133843_01.png', D + 'foes.png',
  ['bandit', 'skeleton', 'goblin', 'wolf', 'rat', 'orc', 'troll', 'ghost', 'bat', 'spider', 'boar', 'bear', 'necro', 'cultist', 'dragon', 'wraith'])
m['props'] = cut(U + 'medieval_props_20261006_133914_01.png', D + 'props.png',
  ['wall', 'door', 'tower', 'cottage', 'well', 'stall', 'haystack', 'barrel', 'crate', 'campfire', 'tree', 'bush', 'sign', 'banner', 'cart', 'anvil'])
json.dump(m, open(D + 'atlas.json', 'w'), ensure_ascii=False)
print('ok')
