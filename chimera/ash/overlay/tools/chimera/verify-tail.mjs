// 伺服器驗證：打完之後才到的輸入要照樣收下（Alan 2026-10-11：打完卡在戰場）。本機 wrangler dev（DEV=1）上開一場戰鬥測試場，
// 這裡用同一個任務讓機器人打完、全部輸入記下來，再多記兩筆打完之後的操作，照瀏覽器的方式送給伺服器，看伺服器收到的筆數是不是到底
// node tools/chimera/verify-tail.mjs [伺服器網址] [服務單類型]
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {record, fingerprint} from '../../src/chimera-log.js';
const [base = 'http://127.0.0.1:8787', type = 'probe'] = process.argv.slice(2), H = {'content-type': 'application/json', 'x-chimera-token': 'verify-tail-token-0000001'};
const a = await (await fetch(base + '/api/arena', {method: 'POST', headers: H, body: JSON.stringify({type, size: 4})})).json();
if (!a.mission) { console.log('開戰失敗', a); process.exit(1); }
const g = new SquadGame(a.mission), entries = []; installFullSquad(g); const lead = installFullSquad(g).botFor; record(g, e => entries.push(e));
let k = 0; while (g.status === 'playing' && k++ < 4000) lead(g.player).step();
const ended = entries.length; g.action('descend'); g.action('wait');   // 打完之後畫面又記了兩筆（例如按了變成「結果」的按鈕）
console.log(`本機：${g.status}・${g.turn} 回合・輸入 ${entries.length} 筆（打完時 ${ended} 筆）`);
let from = 0, last = null;
for (let i = 0; i < 20 && from < entries.length; i++) {
  const batch = entries.slice(from, from + 300), fin = from + batch.length === entries.length;
  last = await (await fetch(`${base}/api/battle/${encodeURIComponent(a.mission.id)}/log`, {method: 'POST', headers: H, body: JSON.stringify({from, entries: batch, fp: fin ? fingerprint(g) : null})})).json();
  if (last.next === from) { console.log(`伺服器停在第 ${from} 筆不再收（舊的錯誤：瀏覽器會一直重送、結果畫面一直等）`); break; }
  from = last.next;
}
console.log(`伺服器收到 ${last?.next} 筆／${entries.length}・狀態 ${last?.status}・不同步 ${last?.desync}`);
process.exit(last?.next === entries.length ? 0 : 1);
