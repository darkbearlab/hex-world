// PVP 機器人統計：每張地圖打兩場、交換陣容（A 一定先動），分開看「先手」和「陣容」；也看各職業的存活
// node pvp/ash/.work/tools/pvp/stats.mjs [地圖數 30] [起始種子 1]
import '../../src/game.js';
import {playMatch} from './match.mjs';
import {PVP_CLASSES, PVP_TUNING} from '../../src/pvp-game.js';
// 試數值：PVP_TUNE='{"bulwark":{"plates":80,"plateCapacity":80}}' node stats.mjs
if (process.env.PVP_TUNE) Object.assign(PVP_TUNING, JSON.parse(process.env.PVP_TUNE));
// 換機器人：PVP_BOT=tools/pvp/bots/alpha.mjs（兩隊都用它；預設是原本的 PvpBot）
const {pathToFileURL} = await import('node:url'), BOT = process.env.PVP_BOT ? (await import(pathToFileURL((await import('node:path')).resolve(process.env.PVP_BOT)).href)).default : null, bots = BOT ? {A: BOT, B: BOT} : {};
const n = +(process.argv[2] || 30), s0 = +(process.argv[3] || 1);
const lcg = s => () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296);
const pick4 = r => { const L = PVP_CLASSES.slice(); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } return L.slice(0, 4); };
let first = 0, games = 0, draws = 0, rounds = [], contact = [], fight = [], sameComp = 0, err = 0;
const cls = Object.fromEntries(PVP_CLASSES.map(c => [c, {played: 0, died: 0, won: 0}]));
for (let s = s0; s < s0 + n; s++) {
  const r = lcg(s * 31 + 7), X = pick4(r), Y = pick4(r), res = [playMatch(s, {A: X, B: Y, bots}), playMatch(s, {A: Y, B: X, bots})];
  for (const m of res) {
    games++; if (m.errors.length) err++;
    if (m.status !== 'won') { draws++; continue; }
    if (m.winner === 'A') first++;
    rounds.push(m.rounds); if (m.firstContact) { contact.push(m.firstContact); fight.push(m.rounds - m.firstContact); }
    for (const side of ['A', 'B']) for (const u of m.left[side].split(' ')) { const [, c, hp] = u.split(':'); cls[c].played++; if (parseInt(hp) <= 0) cls[c].died++; if (m.winner === side) cls[c].won++; }
  }
  // 同一組陣容兩場都贏（不管先後手）：陣容的差距
  if (res.every(m => m.status === 'won') && res[0].winner !== res[1].winner) sameComp++;
}
const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0) : '—', med = a => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : '—';
console.log(`${games} 場：先手（A）贏 ${first}／${games - draws}（${((first / Math.max(1, games - draws)) * 100).toFixed(0)}%）、平手 ${draws}、有錯誤的 ${err} 場`);
console.log(`同一張地圖交換陣容：同一組陣容兩場都贏的 ${sameComp}／${n} 張（陣容決定勝負），其餘是先後手或運氣`);
console.log(`回合數 平均 ${avg(rounds)}・中位數 ${med(rounds)}；第一次交火 平均第 ${avg(contact)} 回合；交火後到分出勝負 平均 ${avg(fight)} 回合・中位數 ${med(fight)}`);
console.log('職業（場數、陣亡率、所在隊伍勝率）：' + Object.entries(cls).map(([c, v]) => `${c} ${v.played}場 陣亡${(v.died / Math.max(1, v.played) * 100).toFixed(0)}% 勝${(v.won / Math.max(1, v.played) * 100).toFixed(0)}%`).join('、'));
