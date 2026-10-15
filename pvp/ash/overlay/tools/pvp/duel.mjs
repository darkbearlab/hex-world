// 兩個 PVP 機器人比賽：同一批地圖、同一組陣容，各坐 A、B 打一次（抵銷先後手），看誰贏得多。
// node pvp/ash/.work/tools/pvp/duel.mjs <機器人1.mjs> <機器人2.mjs> [地圖數 20] [起始種子 1]
//   機器人檔：export default class extends PvpBot {...}（從 './match.mjs' import PvpBot）；寫 base 表示原本的 PvpBot
//   選陣容（Alan 2026-10-16：允許機器人自己選）：機器人檔另外 export function pick(seed, opponent?) 回傳 4 個職業；沒有的話兩邊用同一組隨機陣容
import '../../src/game.js';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {playMatch, PvpBot} from './match.mjs';
import {PVP_CLASSES} from '../../src/pvp-game.js';
const mods = {}, load = async f => { if (f === 'base') return PvpBot; const m = await import(pathToFileURL(path.resolve(f)).href); mods[f] = m; return m.default; };
const [f1, f2] = process.argv.slice(2), n = +(process.argv[4] || 20), s0 = +(process.argv[5] || 1);
if (!f1 || !f2) { console.log('用法：duel.mjs <機器人1.mjs|base> <機器人2.mjs|base> [地圖數] [起始種子]'); process.exit(1); }
const X = await load(f1), Y = await load(f2);
const lcg = s => () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296);
const pick4 = r => { const L = PVP_CLASSES.slice(); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } return L.slice(0, 4); };
let w1 = 0, w2 = 0, draw = 0, err = 0, rounds = 0, kills1 = 0, kills2 = 0; const errs = [];
for (let s = s0; s < s0 + n; s++) {
  const comp = pick4(lcg(s * 13 + 5));   // 預設兩邊同一組陣容：只比機器人
  const c1 = mods[f1]?.pick?.(s, comp) || comp, c2 = mods[f2]?.pick?.(s, comp) || comp;
  for (const [botA, botB, one] of [[X, Y, 'A'], [Y, X, 'B']]) {
    const m = playMatch(s, {A: one === 'A' ? c1 : c2, B: one === 'A' ? c2 : c1, bots: {A: botA, B: botB}});
    rounds += m.rounds; if (m.errors.length) { err++; errs.push(m.errors[0].split('\n').slice(0, 3).join(' / ')); }
    const two = one === 'A' ? 'B' : 'A';
    kills1 += m.kills[one] || 0; kills2 += m.kills[two] || 0;
    if (m.status !== 'won') draw++; else if (m.winner === one) w1++; else w2++;
  }
}
const g = 2 * n;
console.log(`${path.basename(f1)} 對 ${path.basename(f2)}：${g} 場，${w1}：${w2}（平手 ${draw}）→ ${path.basename(f1)} 勝率 ${(w1 / Math.max(1, w1 + w2) * 100).toFixed(0)}%；擊殺 ${kills1}：${kills2}；平均 ${(rounds / g).toFixed(0)} 回合；有錯誤的 ${err} 場`);
for (const e of errs.slice(0, 3)) console.log('  錯誤：' + e);
