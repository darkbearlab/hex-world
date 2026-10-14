# 原主的戰場 sprite v2，一次產很多位（Alan 2026-10-14：娜迪亞的 B 接進遊戲效果不錯，繼續做剩下的人）。
# 每位：gpt-image-2 edit（ASH 的狂戰士站姿、ASH 的倒地圖、原主的立繪）、--quality low、一次 2 張 → donor-sprite-v2.py 縮成 32×32。
# 付費：一次一位，每次送出隔 31 秒以上（一次 2 張 → 每分鐘最多 4 張，規定最多 5 張）。結果放 chimera/art/donor-sprites-v2/<原主>/。
# python chimera/scripts/donor-sprite-batch.py [原主 ...]
import json, os, subprocess, sys, time
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.abspath(os.path.join(here, '..'))
GEN = r'C:\claude_project\_gptImageCaller'
ASH = r'C:\codex_projects\shooter_roguelike\art\classes-v1'
LOOK = {   # 照立繪寫的長相（細節縮小會被吃掉，抓得到輪廓和配色就好）
    'ember': 'long straight black hair with blunt bangs, a black business suit with a white shirt and a black tie',
    'onyx': 'a long olive-blonde braid, a tan visor cap, a beige utility shirt with many pockets, khaki cargo pants',
    'portrait-05': 'a long bright red ponytail, a black sports top, a navy work jacket tied around her waist, a tool belt',
    'portrait-06': 'short orange bob hair, a black tank top, an orange jacket tied around her waist, dark cargo pants',
    'portrait-07': 'a long silver ponytail, a dark camouflage hooded cloak, a black bodysuit',
    'portrait-08': 'slicked-back short black hair, a long black coat, all-black clothes',
    'portrait-09': 'short white hair, a red hooded jacket, black pants with straps',
    'portrait-10': 'dark skin, long black braids, a silver reflective jumpsuit, a respirator mask hanging at her neck',
    'portrait-11': 'short white hair with sunglasses pushed up on her head, a white jacket with red panels, black pants',
    'portrait-12': 'a wide-brimmed sand-colored hat, a beige poncho, a scarf over her mouth, a dark tactical vest',
    'portrait-13': 'dark skin, curly black hair, an orange padded jacket over a gray vest, a coiled climbing rope',
    'portrait-14': 'pink hair in two buns, a black and pink bodysuit, a pink tank backpack',
    'portrait-15': 'pale green short hair, a yellow raincoat with reflective stripes, a gas mask hanging on her chest',
    'portrait-16': 'long white hair with a blue streak, a white hooded fur parka, a black bodysuit',
    'silver': 'long brown braids, a dark knit beanie, an olive parka',
    'io': 'short dark gray-green hair, goggles on her forehead and a headset, a long torn sand-beige work coat over a rust-orange jumpsuit, a tool pouch',   # 守密者伊歐（2026-10-14）
    'io/combat': 'short dark gray-green hair, goggles on her forehead and a headset, a sleek form-fitting slate-gray and black armored combat bodysuit with rust-orange stripes',   # 伊歐的戰鬥服（換裝）
}
ROLE = {   # 職業：武器讓模型自己挑（Alan：動作和武器不用保留，之後要重繪）
    'soldier': 'She is a rifle soldier; give her an assault rifle in a pose that reads well at tiny size',
    'recon': 'She is a light scout; give her a compact submachine gun and light gear in a pose that reads well at tiny size',
    'engineer': 'She is a combat engineer; give her a compact submachine gun and a bulky tool backpack in a pose that reads well at tiny size',
    'bulwark': 'She is a heavy armored trooper: chunky layered armor plates and huge armored mechanical gauntlet arms worn over her outfit, a light machine gun, the broadest heaviest silhouette',
    'berserker': 'She is a melee berserker; choose any pose and any big melee weapon that suits her and reads well at tiny size',
}
CLS = {'ember': 'soldier', 'onyx': 'recon', 'silver': 'bulwark', 'cedar': 'berserker', 'portrait-05': 'engineer', 'portrait-06': 'soldier', 'portrait-07': 'recon', 'portrait-08': 'bulwark',
       'portrait-09': 'berserker', 'portrait-10': 'engineer', 'portrait-11': 'soldier', 'portrait-12': 'recon', 'portrait-13': 'bulwark', 'portrait-14': 'berserker', 'portrait-15': 'engineer', 'portrait-16': 'soldier', 'io': 'engineer', 'io/combat': 'engineer'}
def prompt(k):
    return ("Use the three reference images: the first two are the game's existing sprites and define the STYLE and CAMERA only (overhead three-quarter front/down-facing camera, chunky SNES pixel-art proportions, strong dark outline, high-contrast shading). "
            f"The third image is the CHARACTER to draw: a young woman with {LOOK[k]}. {ROLE[CLS[k]]}. "
            "Create a TWO-SPRITE sheet, two figures side by side in two equal cells with a wide empty gap between them so they never overlap. LEFT: this woman STANDING, full body. "
            "RIGHT: the SAME woman DEAD, collapsed on the floor, clearly horizontal, knocked down from the left, weapon lying beside her; a genuinely different fallen pose, no gore, no blood. "
            "CRUCIAL: draw each figure as a real 32 by 32 pixel sprite enlarged exactly 24 times: every sprite pixel is one clean solid square block, about 24 by 24 screen pixels, all blocks aligned to one grid, no in-between colors, no smaller detail than one block. "
            "Use about 12 flat colors with 3 shades per material (dark, mid, light), a 1-block near-black outline around the whole silhouette, distinct value separation between hair, skin, main outfit and boots so each reads at 32 pixels. "
            "No text, no grid lines drawn, no environment, no floor, no shadow, no extra characters. The whole background is one flat solid pure green color (#00FF00), nothing else on it; do not use that green on the characters.")
keys = sys.argv[1:] or [k for k in LOOK]
for k in keys:
    out = os.path.join(root, 'art', 'donor-sprites-v2', k); os.makedirs(out, exist_ok=True)
    if os.path.exists(os.path.join(out, 'sprite-B.png')): print(k, '已經有了，略過'); continue
    t0 = time.time()
    r = subprocess.run([sys.executable, 'generate.py', prompt(k), '--edit', os.path.join(ASH, 'source-berserker-v3.png'), os.path.join(ASH, 'source-melee-dead-v3.png'), os.path.join(root, 'public', 'donors', k, 'full.png'),
                        '--size', '1536x768', '--quality', 'low', '--n', '2', '--prefix', f'donor-{k.replace("/", "-")}', '--json'], cwd=GEN, capture_output=True, text=True, encoding='utf-8')
    try: files = [f['path'] for f in json.loads(r.stdout[r.stdout.index('{'):])['files']]
    except Exception: print(k, '生成失敗：', (r.stdout + r.stderr)[-400:]); break
    for tag, f in zip('AB', files):
        dst = os.path.join(out, f'source-{tag}.png'); open(dst, 'wb').write(open(f, 'rb').read())
        subprocess.run([sys.executable, os.path.join(here, 'donor-sprite-v2.py'), dst, os.path.join(out, f'sprite-{tag}.png')], check=True, capture_output=True)
    with open(os.path.join(out, 'PROMPT.md'), 'w', encoding='utf-8') as fh: fh.write(f'# {k}（{CLS[k]}）戰場 sprite v2\n\n工具與流程同 ../cedar/PROMPT.md（chimera/scripts/donor-sprite-batch.py 產的）。\n\n## 提示詞\n\n{prompt(k)}\n')
    print(k, f'完成（{time.time() - t0:.0f} 秒）', flush=True)
    time.sleep(max(0, 31 - (time.time() - t0)))   # 一次 2 張、每 31 秒最多送一次：每分鐘不超過 4 張（規定最多 5 張）
