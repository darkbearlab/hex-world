// beta 的實驗用統計（不參與比賽）：node tools/pvp/bots/beta-analyze.mjs [地圖數] [起始種子]
//   BETA_BOT=./beta.mjs（要量的機器人）、BETA_OPP=./alpha.mjs（對手，預設 base）、PVP_BUFFS=1（職業加強）
//   量偵察兵的消焰精準步槍：開火次數、在全黑的地方開火的比例、因此沒有暴露的次數、命中、打誰
import '../../../src/game.js';
import {pathToFileURL} from 'node:url';
import {playMatch, PvpBot} from '../match.mjs';
import {PvpGame, PVP_CLASSES, PVP_TUNING, BUFFS_PROPOSAL} from '../../../src/pvp-game.js';
import {isBlack} from '../../../src/lighting.js';
if (process.env.PVP_BUFFS) PVP_TUNING.buffs = BUFFS_PROPOSAL;
const load = async f => f === 'base' ? {default: PvpBot} : import(new URL(f, import.meta.url).href);
const M = await load(process.env.BETA_BOT || './beta.mjs'), Bot = M.default, BETA_STATS = M.BETA_STATS || {};
const Opp = (await load(process.env.BETA_OPP || 'base')).default;
const n = +(process.argv[2] || 10), s0 = +(process.argv[3] || 1);
const lcg = s => () => ((s = Math.imul(s, 1664525) + 1013904223 >>> 0) / 4294967296);
const pick4 = r => { const L = PVP_CLASSES.slice(); for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; } return L.slice(0, 4); };
const T = {}; const add = (k, v = 1) => T[k] = (T[k] || 0) + v;
let betaSide = null;
// 每一次開火：誰、什麼槍、站的地方黑不黑、開完有沒有暴露、打掉多少
const orig = PvpGame.prototype.soloPaid;
PvpGame.prototype.soloPaid = function (type, arg) {
  const p = this.player, mine = p?.pvpSide === betaSide;
  if (type !== 'fire' || !p || p.character !== 'recon' || !this.targeted) return orig.call(this, type, arg);
  const quietGun = !!this.weapon?.noFlash, black = isBlack(this, p), focus = !!p.focus, tgt = this.targeted, hp0 = tgt.hp;
  const ok = orig.call(this, type, arg);
  if (ok) {
    const who = mine ? 'beta' : 'opp', gun = quietGun ? 'qsr' : 'other';
    add(`${who}:${gun}:fire`); if (black) add(`${who}:${gun}:black`); if (!p.pvpExposed) add(`${who}:${gun}:hidden`);
    if (quietGun && black && !p.pvpExposed) add(`${who}:qsr:savedExposure`);
    if (focus) add(`${who}:${gun}:aimed`);
    if (tgt.hp < hp0) add(`${who}:${gun}:hit`), add(`${who}:${gun}:dmg`, hp0 - Math.max(0, tgt.hp));
    if (tgt.hp <= 0) add(`${who}:${gun}:kill`);
    add(`${who}:${gun}:at:${tgt.pvpOf != null ? (this.unit(String(tgt.id).slice(3))?.character || '?') : tgt.pvpAlly != null ? 'drone' : 'lamp'}`);
  }
  return ok;
};
// 自殺無人機爆炸：打到對方幾個、多少血；有沒有炸到自己人
const origT = PvpGame.prototype.applyThrowable;
PvpGame.prototype.applyThrowable = function (id, point, dmg, src, ...rest) {
  if (src?.sourceId !== 'drone_munition') return origT.call(this, id, point, dmg, src, ...rest);
  const all = [...this.sides.A, ...this.sides.B], hp0 = new Map(all.map(m => [m, m.hp + (m.plates || 0)])), side = src.pvpSide;
  const r = origT.call(this, id, point, dmg, src, ...rest);
  const who = side === betaSide ? 'beta' : 'opp'; add(`${who}:munition:blast`);
  for (const m of all) { const d = hp0.get(m) - (m.hp + (m.plates || 0)); if (d > 0) { add(`${who}:munition:${m.pvpSide === side ? 'friendlyDmg' : 'dmg'}`, d); add(`${who}:munition:${m.pvpSide === side ? 'friendlyHit' : 'hit'}`); if (m.hp <= 0) add(`${who}:munition:kill`); } }
  return r;
};
for (let s = s0; s < s0 + n; s++) {
  const comp = pick4(lcg(s * 13 + 5)), c = process.env.BETA_RECON ? (comp.includes(process.env.BETA_RECON === '1' ? 'recon' : process.env.BETA_RECON) ? comp : [...comp.slice(0, 3), process.env.BETA_RECON === '1' ? 'recon' : process.env.BETA_RECON]) : comp;
  for (const me of (process.env.BETA_SIDE ? [process.env.BETA_SIDE] : ['A', 'B'])) {
    betaSide = me;
    const m = playMatch(s, {trace: !!process.env.BETA_TRACE, A: c, B: c, bots: {[me]: Bot, [me === 'A' ? 'B' : 'A']: Opp}});
    const win = m.winner === me;
    add(m.status !== 'won' ? 'draw' : win ? 'win' : 'loss'); if (m.errors.length) add('errors');
    for (const l of m.log) { const r = l.match(/(A|B)\d（(\w+)）倒下/); if (r) add(`${r[1] === me ? 'betaDead' : 'oppDead'}:${r[2]}`); }
    if (process.env.BETA_LOSSES && !win) console.log(`loss #${s} beta=${me} ${c.join(',')} r${m.rounds} | ${m.log.join(' ; ')}`);
    if (m.errors.length) console.log('ERR', m.errors[0].split('\n').slice(0, 4).join(' / '));
  }
}
console.log(Object.entries(T).sort().map(([k, v]) => `${k}=${v}`).join(' '));
if (M.PB_STATS && Object.keys(M.PB_STATS).length) console.log('PB ' + Object.entries(M.PB_STATS).sort().map(([k, v]) => `${k}=${typeof v === 'number' && v % 1 ? v.toFixed(0) : v}`).join(' '));
if (Object.keys(BETA_STATS).length) console.log(Object.entries(BETA_STATS).sort().map(([k, v]) => `${k}=${v}`).join(' '));
