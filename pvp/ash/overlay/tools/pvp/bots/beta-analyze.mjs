// beta 的實驗用統計（不參與比賽）：node tools/pvp/bots/beta-analyze.mjs [地圖數] [起始種子]
import '../../../src/game.js';
import {playMatch, PvpBot} from '../match.mjs';
import {PVP_CLASSES} from '../../../src/pvp-game.js';
import Beta, {BETA_STATS} from './beta.mjs';
const Opp = process.env.BETA_OPP ? (await import(new URL(process.env.BETA_OPP, import.meta.url).href)).default : PvpBot;   // BETA_OPP=./alpha.mjs
const n = +(process.argv[2] || 10), s0 = +(process.argv[3] || 1);
const lcg = s => () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296);
const pick4 = r => { const L = PVP_CLASSES.slice(); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } return L.slice(0, 4); };
const T = {}; const add = (k, v = 1) => T[k] = (T[k] || 0) + v;
for (let s = s0; s < s0 + n; s++) {
  const comp = pick4(lcg(s * 13 + 5));
  for (const me of (process.env.BETA_SIDE ? [process.env.BETA_SIDE] : ['A', 'B'])) {
    const m = playMatch(s, {trace: !!process.env.BETA_TRACE, A: comp, B: comp, bots: {[me]: Beta, [me === 'A' ? 'B' : 'A']: Opp}});
    const win = m.winner === me;
    add(win ? 'win' : 'loss');
    for (const l of m.log) { const r = l.match(/(A|B)\d（(\w+)）倒下/); if (r) add(`${r[1] === me ? 'betaDead' : 'baseDead'}:${r[2]}`); }
    // 傷害來源
    for (const side of ['A','B']) for (const u of m.left[side].split(' ')) {}
    if (!win) console.log(`loss #${s} beta=${me} ${comp.join(',')} r${m.rounds} | ${m.log.join(' ; ')}`);
  }
}
console.log(Object.entries(T).sort().map(([k, v]) => `${k}=${v}`).join(' '));
console.log(Object.entries(BETA_STATS).sort().map(([k, v]) => `${k}=${v}`).join(' '));
