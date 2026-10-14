# 娜迪亞（cedar，狂戰士）戰場 sprite v2：重繪用的基底（2026-10-14）

Alan：參考 ASH 當初產職業 sprite 的提示詞（`C:\codex_projects\shooter_roguelike\art\classes-v1\PROMPT.md`、`PROMPT-melee-v3.md`：俯角四分之三朝下、SNES 粗點陣、粗外框、為 32×32 設計），試做被選上的角色（主選單的封面：娜迪亞）。細節被吃掉沒關係，「看起來」要對；動作和武器不用保留，之後要大規模重繪，只需要基底。

- 工具：`C:\claude_project\_gptImageCaller\generate.py`，gpt-image-2，`--quality low`，1536×768，edit 模式三張參考圖：
  1. ASH `art/classes-v1/source-berserker-v3.png`（風格、鏡頭）
  2. ASH `art/classes-v1/source-melee-dead-v3.png`（倒地的樣子）
  3. `chimera/public/donors/cedar/full.png`（角色長相、服裝）
- gpt-image-2 不給透明底：畫在純綠底上，處理時去掉。
- 縮成 32×32：`python chimera/scripts/donor-sprite-v2.py source-A.png sprite-A.png`（去綠底、清小碎塊、照重心分左右、先限色再「每一塊取最多的顏色」縮小、14 色、近黑外框）。輸出 64×32，左站、右倒（被左邊打倒），和 `chimera-donor-art.js` 讀的 `donors/<原主>/sprite.png` 同格式。
- 檔案：`source-A/B.png` 是生成原圖；`sprite-A/B.png` 是 32×32 成品；`sprite-A-x10.png` 是 A 放大十倍；`compare.png` 由上到下是 ASH 原本的狂戰士（灰階）、之前退掉的娜迪亞、A、B。
- 還沒裝進遊戲（`DONOR_SPRITES` 還是 false）。

## 第二輪提示詞（A、B 用這組）

Use the three reference images: the first two are the game's existing sprites and define the STYLE and CAMERA only (overhead three-quarter front/down-facing camera, chunky SNES pixel-art proportions, strong dark outline, high-contrast shading). The third image is the CHARACTER to draw: a young woman with short messy blonde hair, aviator goggles pushed up on her head, a long beige hooded field cloak with orange trim over a dark tactical vest, khaki trousers, sturdy boots. She is a melee berserker; choose any pose and any melee weapon that suits her and reads well at tiny size. Create a TWO-SPRITE sheet, two figures side by side in two equal cells with a wide empty gap between them so they never overlap. LEFT: this woman STANDING, full body. RIGHT: the SAME woman DEAD, collapsed on the floor, clearly horizontal, knocked down from the left, weapon lying beside her; a genuinely different fallen pose, no gore, no blood. CRUCIAL: draw each figure as a real 32 by 32 pixel sprite enlarged exactly 24 times: every sprite pixel is one clean solid square block, about 24 by 24 screen pixels, all blocks aligned to one grid, no in-between colors, no smaller detail than one block. Use about 12 flat colors with 3 shades per material (dark, mid, light), a 1-block near-black outline around the whole silhouette, distinct value separation between blonde hair, beige cloak, dark vest and boots so each reads at 32 pixels. No text, no grid lines drawn, no environment, no floor, no shadow, no extra characters. The whole background is one flat solid pure green color (#00FF00), nothing else on it; do not use that green on the characters.

第一輪（指定斧頭扛在右肩、沒要求「32×32 放大 24 倍」）畫得比較細，縮小後糊成一團，沒留。
