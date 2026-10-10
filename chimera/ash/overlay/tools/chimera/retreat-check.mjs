// 撤出戰場（Alan 2026-10-10）：chimeraRetreat 行動——狀態變 retreated、算敗北、追擊照亂數；伺服器重播（同種子、同紀錄）得到一樣的結果
// node tools/chimera/retreat-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {record, applyEntry, fingerprint} from '../../src/chimera-log.js';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: cls === 'berserker' ? 160 : 100}, lv: 1}));
const tk = seed => ({seed, faction: 'rebel', type: 'probe', biome: '旱原', night: false, enemy: {units: {raider: 8}, veh: {}, boss: null}, squad});
let bad = 0;
for (const seed of [3, 7, 11]) {
  const g = new SquadGame(tk(seed)), log = []; record(g, e => log.push(e));
  // 讓敵人都靠近一點，追擊才打得到
  for (const [i, e] of g.enemies.entries()) { e.x = g.player.x + 2 + (i % 3); e.y = g.player.y + (i % 2); }
  g.action('wait'); const ok = g.action('chimeraRetreat'), r = g.missionResult;
  const h = new SquadGame(tk(seed)); for (const e of h.enemies.entries ? [...h.enemies.entries()] : []) { const [i, x] = e; x.x = h.player.x + 2 + (i % 3); x.y = h.player.y + (i % 2); }
  for (const e of log) applyEntry(h, e);
  const same = fingerprint(g) === fingerprint(h);
  if (!ok || g.status !== 'retreated' || r.win || !same) bad++;
  console.log(`種子 ${seed}：撤退 ${ok}・狀態 ${g.status}・算贏 ${r.win}・倒下 ${r.dead.join(',') || '沒有'}・紀錄 ${log.map(e => e.a).join('>')}・重播一致 ${same}・戰報 ${g.logs.slice(0, 3).map(l => l.text || l).filter(t => /撤/.test(t)).join(' / ')}`);
  console.log(`  撤退之後還能行動嗎 ${g.action('wait')}`);
}
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
