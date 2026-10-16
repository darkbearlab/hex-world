// 機器人陣容循環賽（Alan 2026-10-16：兩組機器人先後手、不同陣容排列組合打幾輪）：
// 兩個機器人各從 15 種陣容（6 選 4）挑一組，15×15 種配對，每一對各當一次先手（A）＝450 場；每場一張不同的地圖（種子跟著配對編號）。
// 可以分片平行跑：node tourney.mjs <bot1|base> <bot2|base> <分片編號> <分片數> [起始種子 1] > 結果.jsonl（一場一行 JSON）
// 彙整：node tourney.mjs --sum 結果1.jsonl 結果2.jsonl ...
import '../../src/game.js';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {playMatch, PvpBot} from './match.mjs';
import {PVP_CLASSES, PVP_TUNING} from '../../src/pvp-game.js';
if (process.env.PVP_TUNE) Object.assign(PVP_TUNING, JSON.parse(process.env.PVP_TUNE));

const COMPS = []; { const n = PVP_CLASSES.length; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) COMPS.push([a, b, c, d].map(i => PVP_CLASSES[i])); }
const NAME = {soldier: '士兵', recon: '偵察兵', bulwark: '重裝兵', berserker: '狂戰士', ninja: '忍者', engineer: '工兵'};
const label = c => c.map(x => NAME[x]).join('');

if (process.argv[2] === '--sum') {
  const rows = process.argv.slice(3).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const bots = [...new Set(rows.flatMap(r => [r.botA, r.botB]))];
  const W = {}, add = (k, won) => { const o = W[k] ||= {n: 0, w: 0}; o.n++; if (won) o.w++; };
  let first = 0, decided = 0, errs = 0;
  for (const r of rows) {
    if (r.errors) errs++;
    if (r.winner) { decided++; if (r.winner === 'A') first++; }
    for (const s of ['A', 'B']) {
      const won = r.winner === s, bot = s === 'A' ? r.botA : r.botB, comp = r[s];
      add('bot:' + bot, won); add('comp:' + label(comp), won); for (const c of comp) add('cls:' + c, won);
      add(`seat:${s}:${bot}`, won);
    }
  }
  const pct = o => `${(o.w / o.n * 100).toFixed(0)}%（${o.w}/${o.n}）`;
  console.log(`共 ${rows.length} 場，分出勝負 ${decided}，平手 ${rows.length - decided}，有錯誤 ${errs}`);
  console.log(`先手（A）勝率 ${(first / Math.max(1, decided) * 100).toFixed(0)}%`);
  for (const b of bots) console.log(`機器人 ${b}：總勝率 ${pct(W['bot:' + b])}；當先手 ${pct(W[`seat:A:${b}`] || {n: 1, w: 0})}、當後手 ${pct(W[`seat:B:${b}`] || {n: 1, w: 0})}`);
  console.log('職業（所在隊伍勝率）：' + PVP_CLASSES.map(c => `${NAME[c]} ${pct(W['cls:' + c])}`).join('、'));
  const comps = COMPS.map(c => [label(c), W['comp:' + label(c)]]).filter(([, o]) => o).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n);
  console.log('陣容（勝率由高到低）：'); for (const [l, o] of comps) console.log(`  ${l} ${pct(o)}`);
  process.exit(0);
}

const load = async f => f === 'base' ? PvpBot : (await import(pathToFileURL(path.resolve(f)).href)).default;
const [f1, f2] = process.argv.slice(2, 4), shard = +(process.argv[4] || 0), shards = +(process.argv[5] || 1), s0 = +(process.argv[6] || 1);
const X = await load(f1), Y = await load(f2), n1 = path.basename(f1, '.mjs'), n2 = path.basename(f2, '.mjs');
let k = 0;
for (let i = 0; i < COMPS.length; i++) for (let j = 0; j < COMPS.length; j++) {
  const pair = i * COMPS.length + j;
  for (const swap of [false, true]) {
    if (k++ % shards !== shard) continue;
    const seed = s0 + pair, [botA, botB, compA, compB, nA, nB] = swap ? [Y, X, COMPS[j], COMPS[i], n2, n1] : [X, Y, COMPS[i], COMPS[j], n1, n2];
    const m = playMatch(seed, {A: compA, B: compB, bots: {A: botA, B: botB}});
    process.stdout.write(JSON.stringify({seed, botA: nA, botB: nB, A: compA, B: compB, winner: m.status === 'won' ? m.winner : null, rounds: m.rounds, errors: m.errors.length || 0, score: m.score, power: (m.log || []).filter(l => /三倍傷害|陣亡|倒下|擊倒/.test(l))}) + '\n');
  }
}
