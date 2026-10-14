# 原主的戰場 sprite v2：產生流程

Alan（2026-10-14）：這套流程留著；**正式手繪的立繪下來之後，用同一套做法重產**全部原主的戰場 sprite（給 Alan 當重繪的基底）。

## 一、遊戲怎麼讀

- 每位原主一張 `chimera/public/donors/<原主>/sprite2.png`：64×32、透明底、彩色。左半（0,0）站著，右半（32,0）倒地（畫成被左邊打倒；從右邊打倒時 ASH 會左右翻）。
- `chimera/ash/overlay/src/chimera-donor-art.js`：`DONOR_SPRITES = true`、讀 `sprite2.png`；沒有這張的原主照舊畫職業圖。舊的 `sprite.png`（v1，評價不好）不再用。
- 有沒有這張圖，看部署時產生的 `asset-manifest.json`（CI 自動產，本機測試前跑 `node chimera/scripts/asset-manifest.mjs`）。

## 二、產生（付費）

1. **輸入**
   - 立繪：`chimera/public/donors/<原主>/full.png`。正式手繪的立繪換上來之後，直接蓋掉這個檔案。
   - 風格參考（只讀，不改 ASH 原本的 repo）：`C:\codex_projects\shooter_roguelike\art\classes-v1\source-berserker-v3.png`（站姿、鏡頭）和 `source-melee-dead-v3.png`（倒地）。
     當初的提示詞在同一個資料夾的 `PROMPT.md`、`PROMPT-melee-v3.md`，重點是：overhead three-quarter front/down-facing camera、SNES 粗點陣、粗外框、為 32×32 設計。
2. **改長相描述**：`chimera/scripts/donor-sprite-batch.py` 的 `LOOK`，每位一句英文，寫髮型、髮色、主要服裝和配色。立繪換了，這裡要照新的立繪重寫。職業對應的武器方向在 `ROLE`（模型自己挑姿勢和武器，Alan：動作和武器不用保留）。
3. **清掉舊的**：要重產的人，刪掉 `art/donor-sprites-v2/<原主>/sprite-B.png`，或整個資料夾刪掉。批次會略過已經有 `sprite-B.png` 的人。
4. **跑**：`python chimera/scripts/donor-sprite-batch.py [原主 ...]`，不給名字就是全部。
   - gpt-image-2、edit 模式三張參考圖、`--quality low`、1536×768、一次 2 張（A、B）。
   - 規定：付費 gpt-image 一律 low、每分鐘最多 5 張。批次每 31 秒才送一次（一次 2 張，等於每分鐘最多 4 張）。不要拿掉這個等待。
   - gpt-image-2 不給透明底，所以提示詞要它畫在純綠底（#00FF00）上。
   - 費用參考（2026-10）：一位約 $0.06，16 位約 $1。
5. **縮成 32×32**：批次會自動呼叫 `chimera/scripts/donor-sprite-v2.py`。也可以單獨跑：`python chimera/scripts/donor-sprite-v2.py source-A.png sprite-A.png`。
   - 去綠底、清小碎塊 → 照重心分左右（倒地的靴子、掉在地上的武器跨過中線也不會被切錯）。
   - 先限 48 色，再讓每一格取「出現最多的顏色」縮小（不取平均，顏色不糊）。
   - 最後 14 色，補一圈近黑的外框。

## 三、選用

1. `python chimera/scripts/donor-sprite-pick.py sheet` → `art/donor-sprites-v2/all-AB.png`，每位 A／B 兩版、4 倍，編號照固定順序。把這張給 Alan 看。
2. Alan 照總覽圖從左到右、從上到下給一串 A／B，例如 2026-10-14 是 `BAABBBABBBBBBABB`。
3. `python chimera/scripts/donor-sprite-pick.py BAABBBABBBBBBABB` → 複製成各自的 `public/donors/<原主>/sprite2.png`，寫 `chosen.json`。
4. 本機看效果：`chimera/public/ash/battle-test.html#<任務票 JSON>`，任務票的 squad 裡放 `donor`。2026-10-14 用的那張票：兩人，娜迪亞（cedar，狂戰士）＋凱拉（ember，士兵），probe、礫丘。
5. 提交並推上 chimera 分支（CI 部署）。

## 四、同一批立繪的其他產物

- 主選單的站姿立繪（去背）：`python chimera/scripts/stand-cutout.py --sheet 檢查.png`，從 `full.png` 產生 `stand.png`。立繪換了也要重跑；跑完看檢查圖，深色頭髮或斗篷有沒有被誤挖。
- 頭像 `portrait.png`、裁切規則見記憶「Chimera avatar crop」與 `chimera/scripts/donor-art.py`。

## 五、已知的問題（2026-10-14 這批）

- 鏡頭比 ASH 原本的更偏正面、更 Q 版，看不太到頭頂。
- 重裝兵（莎菈、艾琳、瑟琳）沒有畫出最寬、最厚重的裝甲輪廓，跟一般人差不多大。
- 第一輪如果沒要求「32×32 放大 24 倍、每格一個方塊」，模型會畫得太細，縮小後糊成一團。這句一定要留著。
