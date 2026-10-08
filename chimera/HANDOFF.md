# 奇美拉專案交接（2026-10-08）

給接手的 Claude Code。設計決策的完整來龍去脈在 hex-world **main** 分支的 `warband/DESIGN.md`（奇美拉相關的討論都附在檔案後半）；系統怎麼運作在本資料夾的 `README.md`。這份只講現況、檔案位置、工作規則和下一步。

## 1. 跟 Alan 合作的規則

- 一律用繁體中文回覆。
- 討論中的想法先寫進 `warband/DESIGN.md`（main 分支），Alan 確認後才實作；實作完在同一份檔案記一行「已實作」。
- Alan 喜歡你直接動手（跑指令、部署、測試），不要只給他步驟。
- 舊的 warband 已停用（`warband/wrangler.toml` 的 `PAUSED="1"`）；warband 若有改動，要同時更新它的 changelog 與 README。
- 立繪是 Alan 親手畫的。AI 產的參考圖只放在本機 `C:\claude_project\chimera-art-ref\`（日後搬到 `chimera/art-ref/`，已在 `.gitignore`），**絕不提交、不部署**。

## 2. 儲存庫與分支

| 位置 | 內容 |
| --- | --- |
| `darkbearlab/hex-world` 分支 `main` | warband（已停用）、`warband/DESIGN.md`（討論紀錄） |
| `darkbearlab/hex-world` 分支 `chimera` | `chimera/` 整個專案 |
| `darkbearlab/ash_protocol` 分支 `main` | ASH PROTOCOL（v3.223），要接進來的戰鬥引擎 |
| 本機 `C:\codex_projects\shooter_roguelike` | ash_protocol 的本機複本；`.claude/worktrees/clear-bot` 是分支 `claude/clear-bot`（**只在本機，沒推上 GitHub**），裡面有通關機器人 `tools/clear-bot/`，說明在 `docs/CLEAR_BOT.md` |

## 3. `chimera/` 的檔案

| 檔案 | 做什麼 |
| --- | --- |
| `sim.js` | 沙盒：荒漠星球 150 年的歷史推演、勢力、經濟、戰爭、載具、戰壕、培養槽與複製兵、遺產級、機會層 `sim.opportunities()`；`sim.pmc` 是給案件用的回寫介面 |
| `cases.js` | 案件與事件管線：開案、事件骰、任務票、指派、自動結算、寫回沙盒、契約變更、行軍遇襲、召回（毀約）、採購車隊（`own` 案件） |
| `company.js` | 玩家公司：培養槽（四種素材、配方決定職業、數值浮動與金銀冠、模板）、接案、補員、採購路線、召回、報表資料、地圖上的人馬位置 |
| `public/` | 觀看頁（三頁：戰略地圖／公司／報表）。`worker.js` 在背景跑沙盒與公司；`app.js` 是畫面 |
| `public/sim.js`、`cases.js`、`company.js` | **不進 git**，部署時從上一層複製（本機測試前要自己 `cp`） |
| `public/portraits/` | 暫用 ASH 的 16 張 64×64 頭像 |
| `stats/` | 統計腳本：`cases.mjs`（案件管線，`SPEED=1`、`REINF=none|base|post`）、`clone-*.mjs`、`terrain.mjs`、`opps.mjs` |
| `run.mjs` | 在終端機印編年史 |
| `ash/` | 插進來的 ASH PROTOCOL（不動 ash_protocol 本身）：`ASH_COMMIT` 固定版本、`patches/` 補丁、`overlay/` 新增的檔案（含從本機複製的通關機器人 `tools/clear-bot/`）。`node chimera/ash/build.mjs` 抓原始碼、套補丁、蓋 overlay、建置到 `public/ash/`（不進 git；`.work/` 是工作區）。改補丁：在 `.work/` 改完 `git diff > ../patches/000N-名字.patch`。本機可設 `ASH_REPO=C:/codex_projects/shooter_roguelike` 省下載 |

部署：推到 hex-world 的 `chimera` 分支、動到 `chimera/**` 就會跑 `.github/workflows/chimera.yml`，部署到 https://chimera.darkbearlab.workers.dev 。

本機測試：

```bash
cd chimera && cp sim.js cases.js company.js public/
cd public && python3 -m http.server 8765    # 開 http://localhost:8765/?seed=奇美拉-1
node chimera/stats/cases.mjs 6 90          # 案件管線統計（約一分鐘）
```

畫面測試用 Playwright（無頭 Chromium）：先等歷史推演約 15 秒，按「公司」→「開在這裡」，再操作。

## 4. 目前做到哪裡（MVP，沒有戰鬥層）

- 沙盒可以觀賞；開公司後改用小時推進，每 N 天（預設 30）沙盒推一年。
- 培養槽、名冊（供在家裡）、接案、任務票（只能自動結算，顯示估計勝算）、補員、行軍遇襲、雇主拒絕、召回（毀約付違約金）、採購路線、地圖上的人馬與路線、點選格子拉出從總部出發的虛線、右上角信封通知、報表頁。
- **沒有存檔**：重新整理就沒了。

## 5. 下一步：接上 ASH 手動戰鬥

Alan 2026-10-08 的決定：

- 隊友沿用 **ASH 的友軍系統（方案 A）**：倖存者（`survivor`）就是另外三名複製人。
- 開發階段，隊友的預設 AI 用**通關機器人**（`tools/clear-bot/`），參數要另外調整。
- 機器人目前只透過 `game.action` 操作玩家角色，要改兩端：
  - 感知（`perception.mjs` 的 `buildView`）：改成以那名隊友為中心。
  - 執行：把意圖轉成隊友的行動。
  - `docs/CLEAR_BOT.md` 第 5 節已經為「除名幹員」分析過同樣的改法。

ASH 研究重點（檔案在 ash_protocol）：

- 照 `src/killhouse.js` 的 `KillhouseGame` 做一個 `MissionGame extends Game`：
  - 改寫 `generateFloor()`：照任務票擺敵人。在地圖物件上改寫 `enemies`，用 `makeEnemy(type,x,y,id,floor,offset,faction)`（`src/world.js:61`），合法位置用 `map-population.js` 的 `contourPosts`／`reservationPosts`。
  - 改寫 `descend()`：撤離＝勝；`awardProtocol(){}`；仿 `simulationResult` 做一個 `missionResult`。
- 小隊：`addAlly(g,'survivor',type,{point})`（`src/allies.js:81`），開局後叫三次，找空格用 `routeCells(g,g.player,{limit:2})`。
  - 隊友的武器現在來自兵種卡（`allyWeapon`，命中 −22）。
  - 要帶職業武器、數值的話，`allyWeapon` 和存檔驗證 `validAllies` 都要改。
- 職業與數值：`CHARACTERS`（`src/characters.js`）；`actorStat` 讀 `combatModifiers`（−100～100）。
  - 奇美拉的生命、命中、閃避、近戰直接對得上。
- 敵人對應：
  - 奇美拉的 `raider`／`raider_heavy`／`native`／`native_hunter`／`trooper`／`trooper_heavy`／`clone_trooper` 要對到 ASH 的兵種卡（`ENEMY_TYPES`，例如 raider、raider_armored、rifleman、rifleman_armored、gunner……）。
  - 樓層號碼會影響頭目（第 3、6 層）和危險，要選好或改寫。
- 嵌入：ASH 的控制器（`src/controller.js`）是整頁單例，一載入就建立遊戲。
  - 先用 iframe 開一個精簡入口（新的 mission.html＋入口模組，建立 `MissionGame` 而不是讀存檔）。
  - 用 URL 參數或 `postMessage` 傳任務票，打完用 `postMessage` 把結果傳回；`cases.js` 的 `submit(book,w,ticketId,{win,done,dead},now)` 已經接得住。
- 驗證：`src/replay.js` 的 `stateHash` 可以在 Node 重播驗證，但 `Game.restore` 不接受子類別，要另開路徑（階段 3）。

2026-10-08 Alan 定案（DESIGN.md「接上 ASH 的做法定案」）：不動 ash_protocol，全部插拔進 `chimera/ash/`；交棒＝換下一個活著的人、可循環切換（階段 2；階段 1 隊長陣亡判敗）；用第一層；隊友武器先用兵種卡、數值帶奇美拉的。階段 0 已完成（插拔結構、關掉 service worker 的補丁、部署流程；機器人在 3.223.0 上 6 局贏 5）。階段 1 已完成：任務票可以「親自打」，細節在 README 的「親自打」一節。之後 Alan 要求隊友是完整的玩家角色：已完成（README「親自打」的小隊一節），交棒與循環切換也做好了。再之後（Alan 2026-10-08）：不用 iframe，ASH 直接跑在奇美拉的頁面裡，戰鬥畫面照 ASH 橫向提案做成寬螢幕（README「親自打」）。下一步：寬螢幕的 P2 滑鼠／P3 鍵盤、隊友命令、依事件類型給目標、各自的先手順序、調機器人的跟隨與參數。

建議的階段（原提案；階段 0 的分支做法已被上面取代）：

- **階段 0**：在 ash_protocol 開 `chimera` 分支（從標籤分出），部署時把建置結果複製進奇美拉。
  - 先問 Alan：clear-bot 分支要不要推上 GitHub。
- **階段 1**：隊長＋三名機器人隊友，打室內設施地圖。「親自打」開 iframe，結果接回結算。
- **階段 2**：
  - 隊長陣亡時交棒給下一個活著的人（改 `game-actions.js` 第 224、293 行一帶）。
  - 隊友命令。
  - 依事件類型給目標：護送、炸工事；守點用 ASH 的生存任務；清剿要擊倒頭目。
- **階段 3**：中途存檔與回放驗證、戰利品帶回、戶外地圖。

還沒有答案的問題：

1. ash_protocol 開分支的做法可以嗎？
2. 交棒機制做出來之前，隊長陣亡怎麼算？提案：戰鬥結束算敗，活著的隊友存活。
3. 前期先接受室內設施地圖嗎？

## 6. 其他已知事項

- 沙盒裡的零件幾乎被消耗光，所以植入物改成「有廠區或培養槽的城直接賣」（`company.js` 的 `offerAt`）。
- 戰鬥公式（`cases.js` 的 `fight`）是暫用的火力模型；敵人戰力公式在 `enemyOf`。
  - 這些數字都只是為了 MVP 的手感，接上 ASH 後自動結算可以考慮改用機器人模擬。
- 延後的事：
  - warband 的側翼與反疲勞討論。
  - 衝突類機會偏少。
  - 掠奪者和原住民還沒有載具。
  - 沙盒裡的 NPC 傭兵公司（搶票）。
  - 存檔。
