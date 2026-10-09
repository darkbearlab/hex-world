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
