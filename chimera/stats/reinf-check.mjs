// 據點的增援在 ASH 裡真的會進場（OPMAP.md 第十四節）：拿核心發出來的清剿任務，讓機器人打一場，看增援有沒有照回合從入口跟進來、每層打完有沒有停在出口
import fs from 'fs';
import {Core} from '../core.js';
import {NEAR, gangInfo} from '../near.js';
import {TRIP} from '../cases.js';
import {SquadGame} from '../ash/.work/src/chimera-squad.js';
import {installFullSquad} from '../ash/.work/tools/chimera/full-squad.mjs';
NEAR.on = true; TRIP.dice = false;
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let mission = null; const c = new Core(e => { if (e.type === 'mission') mission = e.data; }); c.load(raw.seed, raw.save);
const K = c.sim.peek(), w = c.w, N = '增援'; c.found(1398, N); const G = c.game.cos[N], cmd = m => c.command(m, N), B = c.game.book;
let bad = 0; const ok = (x, m) => { console.log(`${x ? '✓' : '✗'} ${m}`); if (!x) bad++; };
const quiet = () => { NEAR.BANDIT = 0; NEAR.NATIVE = 0; NEAR.PATROL = 0; NEAR.CARAVAN = 0; NEAR.SPOT = 0; if (G.hq) G.hq.near = []; };
c.advanceTo(c.hour + 1); quiet();
const g = K.gangs.filter(x => !x.gone && !x.native && w.land[x.lair] && isFinite(c.sim.pmc.dist(G.base, x.lair))).sort((a, b) => b.str - a.str)[0], x = gangInfo(G, w, g);
for (const s of x.sites) s.found = c.hour;
const O = x.sites.find(s => !s.head && x.sites.some(o => o !== s && o.tile === s.tile)) || x.sites.find(s => !s.head);
ok(cmd({type: 'sortie', tile: O.tile, mode: 'fight', uids: G.roster.filter(q => q.alive && q.status === 'home').slice(0, 4).map(q => q.uid), lair: g.id, site: O.sid}) === null, `派四個人打${g.name}的一處小據點`);
const cs = B.cases.filter(q => G.cases.includes(q.id) && q.sortie?.lair === g.id).pop(); let tk = null;
for (let i = 0; i < 96 && !tk; i++) { c.advanceTo(c.hour + 1); quiet(); tk = B.tickets.find(t => t.caseId === cs.id && !t.done); }
ok(!!tk?.reinf?.length, `清剿單帶著增援：${(tk?.reinf || []).map(r => `第 ${r.turn} 回合 ${Object.values(r.units).reduce((a, b) => a + b, 0)} 名`).join('、')}`);
cmd({type: 'fight', ticket: tk.id});
ok(mission && mission.facility && mission.floors === tk.floors && mission.reinf?.length === tk.reinf.length, `發出去的任務：設施 ${mission?.floors} 層、增援 ${mission?.reinf?.length} 批`);
// 機器人打：記下每回合的敵人數，看增援進場
const game = new SquadGame(mission), lead = installFullSquad(game).botFor; let n = 0, exits = 0, logs = new Set();
const first = Math.min(...mission.reinf.map(r => r.turn)); let before = null, after = null;
while (game.status === 'playing' && n++ < 2500) {
  if (game.turn === first - 1) before = game.enemies.length; if (game.turn === first && after == null) after = game.enemies.length;
  if (game.chimeraAtExit) { exits++; game.action('chimeraDeeper'); continue; }
  lead(game.player).step();
  for (const e of game.enemies) if (String(e.id).startsWith('r')) logs.add(`${game.floor}:${e.id}`);
}
ok(logs.size >= 3, `增援的人進了場：${logs.size} 名（${[...logs].slice(0, 4).join('、')}…）`);
ok(after != null && before != null && after > before, `第 ${first} 回合敵人從 ${before} 名變 ${after} 名`);
const r = game.missionResult; console.log(`  打完：${game.status}，第 ${game.floor} 層，回合 ${game.turn}，打穿 ${r.floors} 層，打倒 ${r.kills}`);
ok(r.floors != null, `結果帶著打穿的層數（${r.floors}）`);
console.log(bad ? `${bad} 項不對` : '全部正常');
