# 六角世界

一個自己運轉的六角格世界，跑在 Cloudflare Workers 免費方案上。

開服前先推演 400 年歷史（勢力、戰爭、商路、盜匪、資源枯竭）。開服後世界照四層時鐘繼續推進，25 名 NPC 旅人照各自的作息上線，打獵、伐木、採礦、跑商、清剿盜匪。

- 網址：https://hex-world.darkbearlab.workers.dev

## 時間怎麼走

| 層級 | 多久一次 | 做什麼 |
| --- | --- | --- |
| 年 | 4 季 | 宣戰議和、遷都滅亡、拓殖、築城、英雄生死 |
| 季 | 28 個時段（7 天） | 收成、運輸、貿易、消耗、每場戰爭打一仗 |
| 時段 | 現實 `TICK_SECONDS` 秒（預設 5 分鐘） | 晝夜、盜匪擴散、旅人吃喝與遭遇、旅人行動 |
| 即時 | 每個動作 | 旅人花 AP 移動、採集、交易，直接改動那一格的存量 |

沒人去的格子用「惰性補算」：記下上次結算時間，等有人經過或換季時才一次補算。

## 檔案

| 路徑 | 內容 |
| --- | --- |
| `src/sim.js` | 模擬核心：地形生成、年／季／時段結算、NPC 行為、存檔讀檔 |
| `src/worker.js` | Worker 入口與世界本體（Durable Object，用鬧鐘自己推進時間） |
| `src/codec.js` | 存檔格式轉換 |
| `scripts/genesis.mjs` | 創世：部署前在 GitHub 上跑完 400 年歷史，產生 `src/genesis.json` |
| `public/` | 觀看網頁 |
| `wrangler.toml` | Cloudflare 設定與世界參數 |

## 改版流程

推送到 `main` 就會自動部署（GitHub Actions → Cloudflare）。世界的進度存在 Cloudflare 上，一般改版不會讓世界重來。

想讓世界從頭開始（例如模擬規則大改、換種子），把 `wrangler.toml` 裡的 `WORLD_VERSION` 加 1 再推送。

| 參數 | 意思 |
| --- | --- |
| `WORLD_VERSION` | 改了就重新開始 |
| `SEED` | 世界種子 |
| `NPC_COUNT` | NPC 數量（重新開始時生效） |
| `TICK_SECONDS` | 現實幾秒推進一個時段 |

## API

| 路徑 | 內容 |
| --- | --- |
| `/api/state` | 目前的世界狀態、旅人、最近 160 條紀錄 |
| `/api/static` | 不會變的地形資料 |
| `/api/history` | 每年的勢力範圍 |
| `/api/archive` | 開服前 400 年的完整編年史 |

## 本機測試

```
npm install
npm run dev
```

然後打開 http://localhost:8787 。

## 實驗室（feudal 分支）

`npm run lab` 會產生 `dist/lab.html`：把模擬核心整個塞進一個網頁，雙擊就能在瀏覽器裡跑，可以調速度、換種子，看市鎮、運糧車、商隊和各鎮物價。改模擬規則時先在這裡看效果，再決定要不要合併到 `main`。

## 免費方案的限制

Cloudflare 免費方案每次觸發限 10 毫秒 CPU。目前地圖是 30×24，一般時段約 0.5 毫秒，換季、換年約 1 毫秒。地圖若要加大到 60×48，建議先升級每月 5 美元的付費方案，或把年結算拆成多次執行。
