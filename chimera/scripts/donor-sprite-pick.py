# 原主戰場 sprite v2 的總覽與選用（流程見 chimera/art/donor-sprites-v2/README.md）。
#   python chimera/scripts/donor-sprite-pick.py sheet            產生 art/donor-sprites-v2/all-AB.png（每位 A／B 兩版，4 倍）
#   python chimera/scripts/donor-sprite-pick.py BAABBBABBBBBBABB  照總覽圖的順序（左到右、上到下）選，複製成 public/donors/<原主>/sprite2.png、寫 chosen.json
import json, os, shutil, sys
from PIL import Image, ImageDraw, ImageFont
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.abspath(os.path.join(here, '..')); D = os.path.join(root, 'art', 'donor-sprites-v2')
# 總覽圖的順序（Alan 用這個順序給選擇的字串）
KEYS = ['cedar', 'ember', 'onyx', 'silver'] + ['portrait-%02d' % i for i in range(5, 17)]
NAME = {'ember': '凱拉', 'onyx': '伊薇', 'silver': '莎菈', 'cedar': '娜迪亞', 'portrait-05': '蕾雅', 'portrait-06': '米菈', 'portrait-07': '塔莉亞', 'portrait-08': '艾琳', 'portrait-09': '薇拉', 'portrait-10': '諾娃',
        'portrait-11': '茵格', 'portrait-12': '菲歐', 'portrait-13': '瑟琳', 'portrait-14': '朵拉', 'portrait-15': '雅絲', 'portrait-16': '露恩'}
arg = sys.argv[1] if len(sys.argv) > 1 else 'sheet'
if arg == 'sheet':
    f = ImageFont.truetype(r'C:\Windows\Fonts\msjh.ttc', 16); k = 4; cw = 64 * k * 2 + 40; ch = 32 * k + 30
    C = Image.new('RGB', (cw * 2 + 20, (len(KEYS) + 1) // 2 * ch + 10), (30, 27, 22)); d = ImageDraw.Draw(C)
    for i, key in enumerate(KEYS):
        x = 10 + (i % 2) * cw; y = 10 + (i // 2) * ch; d.text((x, y), f'{i + 1}. {NAME[key]} ({key})', font=f, fill=(230, 194, 129))
        for j, t in enumerate('AB'):
            p = os.path.join(D, key, f'sprite-{t}.png')
            if not os.path.exists(p): continue
            s = Image.open(p).convert('RGBA'); bg = Image.new('RGBA', (64 * k, 32 * k), (58, 52, 42, 255)); bg.alpha_composite(s.resize((64 * k, 32 * k), Image.NEAREST))
            C.paste(bg.convert('RGB'), (x + j * (64 * k + 20), y + 22)); d.text((x + j * (64 * k + 20) + 4, y + 24), t, font=f, fill=(255, 255, 255))
    out = os.path.join(D, 'all-AB.png'); C.save(out); print('寫出', out)
else:
    sel = arg.upper()
    if len(sel) != len(KEYS) or set(sel) - set('AB'): sys.exit(f'要 {len(KEYS)} 個 A／B（照總覽圖的順序），收到 {arg}')
    chosen = {}
    for key, t in zip(KEYS, sel):
        shutil.copyfile(os.path.join(D, key, f'sprite-{t}.png'), os.path.join(root, 'public', 'donors', key, 'sprite2.png')); chosen[key] = t
    json.dump(chosen, open(os.path.join(D, 'chosen.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2); print('選用', ' '.join(f'{NAME[k]}{t}' for k, t in chosen.items()))
