# 奇美拉戶外戰鬥圖集 v1（2026-10-09）

用 `c:\claude_project\_gptImageCaller\generate.py`（gpt-image-2，`--quality low`，1024×1024）產生，提示詞照 ASH 專案 `art/terrain-v1/prompt.txt` 的格式。
處理：`python chimera/art/outdoor-v1/pixelize.py` → `chimera/public/ash-outdoor/`。

- `source-ground.png`：地面，16 格不透明（沙地、沙紋、碎石沙、沙土車轍；乾裂黏土×2、碎石、土路；乾草×2、火山岩、破柏油；戰壕泥地與踏板、泥地、城郊瓦礫、油污地）。
- `source-props.png`：物件，16 格，洋紅 #FF00FF 背景去掉（gpt-image-2 不支援透明背景；gpt-image-1.5 試過，畫成手繪風格、背景也不透明，不用）。沙包、沙包轉角、巨石、碎石；廢料路障、輪胎堆、枯樹、燒毀車殼；鐵絲網、木箱、紐澤西護欄、營火；木柵、鐵皮圍牆、帳棚、機槍座（沙包圈）。

完整提示詞見 git 歷史中這次提交的說明，或下方。

## ground
Use case: stylized-concept. Asset type: a single production sprite atlas for an original top-down military science-fiction tactical game set on an abandoned desert planet, CHIMERA. Create ONE square 1024x1024 image arranged in an EXACT edge-to-edge 4x4 regular grid of sixteen 256x256 cells ... ALL SIXTEEN cells are fully opaque full-cell square OUTDOOR GROUND tiles that tile seamlessly ... (rows as listed above)

## props
... Isolated OUTDOOR battlefield props ... The ENTIRE background of every cell is ONE flat pure magenta color #FF00FF ... Never use magenta or pink inside the sprites ... (rows as listed above)

## truck（公路戰，2026-10-09）
- `source-truck.png`：16 格不透明。第 1 排車斗（橄欖綠花紋鋼板、磨損的花紋鋼板、木板貨台、鏽蝕拼補的掠奪者車斗）；第 2 排車頭（橄欖綠車頂、車側、鏽鐵車頂、車側）；第 3 排車欄（橄欖綠車欄正面、上緣、鏽鐵車欄正面、上緣）；第 4 排公路（龜裂柏油、黃色虛線、輪胎、路邊積沙）。

Create a production sprite texture atlas for an original dark military sci-fi tactical game set on an abandoned desert planet, authentic chunky SNES 16-bit pixel art designed at 32x32 pixels per tile, enlarged exactly 8x with strict nearest neighbor. EXACT 4 columns by 4 rows, 16 equally sized square tiles ... for a battle fought on the beds of moving cargo trucks on a desert highway ... Row 1 truck BED FLOORS seen from above ... Row 2 truck CABS ... Row 3 truck side RAILS ... Row 4 HIGHWAY surface from above ...（完整提示詞見 hex-world 這次提交的說明）

## cab（公路戰的車頭，2026-10-09）
- `source-cab-roof.png`：左半一整個橄欖綠軍卡車頭頂、右半一整個鏽鐵改裝車頭頂（從上面看，車頭朝左）；第 4 排的車側沒用到（比例不對）。
- `source-cab-side.png`：四條 1024×256 的車頭側面（橄欖綠 ×2、鏽鐵 ×2），比例剛好是 2 格寬、半格高。
- 處理：pixelize.py 的 cab()，背景只去掉和邊緣連在一起的近黑色，輸出 cab.png（128×160）。提示詞見 hex-world 這次提交的說明。
