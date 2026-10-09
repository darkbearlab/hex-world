// 敵人重新配置的檢查（Alan 2026-10-09，warband/DESIGN.md「敵人單位重新配置」）：
// 1. 每一方的兵種表都能開戰、機器人打得完，戰場上的名字照服務單
// 2. 遺產級頭目：沒骰到戰死就負傷撤退（離開戰場、回報 retreat）；骰到就戰死、遺產級掉地上，撿起來的人活著打完回報 legacy
// 3. 武裝車兩回合才走一格；衝鋒車爆炸兩格
// node tools/chimera/roster-check.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {enemyDisplayName} from '../../src/enemy-affixes.js';
import {isNoncombatant} from '../../src/enemy-data.js';
import {enemyRoster, ASH_FACTION} from '../../../../cases.js';
const squad = [['A', 'soldier'], ['B', 'recon'], ['C', 'bulwark'], ['D', 'berserker']].map(([id, cls]) => ({id, cls, st: {hp: cls === 'berserker' ? 160 : 100}, lv: 3}));
const SIDES = {raider: {scav: 3, shotgun: 1, thug: 1, sniper: 1}, hive: {infected: 2, infected_rifle: 1, hound: 1, larva: 2, spitter: 1, bug: 1}, native: {warrior: 3, hunter: 1, dog: 2},
  army: {trooper: 3, trooper_heavy: 1, shotgunner: 1, marksman: 1, drone: 1, flamer: 1, leader: 1, clone_trooper: 1}, works: {drone: 2, bomb_bot: 2, turret: 1, guard_elite: 1, flamer: 1},
  warlord: {elite: 2, scav: 2, enforcer: 1, drone: 1}, free: {merc: 3, merc_shotgun: 1, marksman: 1}};
const BOSS = {hive: {ash: 'hive_beast', name: '巢母'}, army: {ash: 'designator', name: '標定官'}, works: {ash: 'burnline', name: '焚線官'},
  raider: {weapon: '測試光束步槍', kind: '光束步槍', bonus: .2, legacy: 1, chief: '老狗', ash: 'delisted_soldier', dies: false}};
const ticket = (side, seed, o = {}) => { const enemy = {side, units: SIDES[side], veh: o.veh || {}, boss: o.boss ?? BOSS[side] ?? null}; return {seed, faction: ASH_FACTION[side], type: o.type || 'probe', biome: '旱原', night: false, enemy: {...enemy, roster: enemyRoster(enemy)}, squad}; };
let bad = 0; const fail = m => { bad++; console.log('✗', m); };
const run = g => { const {botFor} = installFullSquad(g); let n = 0, err = ''; try { while (g.status === 'playing' && n++ < 2500) botFor(g.player).step(); } catch (e) { err = String(e.stack || e).slice(0, 300); } return err; };
const rows = [];
for (const side of Object.keys(SIDES)) for (const seed of [3, 11]) {
  const tk = ticket(side, seed, {veh: side === 'army' ? {armor: 1} : side === 'raider' ? {rush: 1} : {}}), g = new SquadGame(tk);
  const want = tk.enemy.roster.length, names = g.enemies.map(e => enemyDisplayName(e)), expect = tk.enemy.roster.map(u => u.name);
  if (g.enemies.length !== want) fail(`${side} 敵人數 ${g.enemies.length}≠${want}`);
  if (names.join() !== expect.join()) fail(`${side} 名字 ${names.join('、')} ≠ ${expect.join('、')}`);
  const err = run(g); if (err) fail(`${side} 出錯 ${err}`);
  rows.push({side, seed, enemies: want, status: g.status, turns: g.turn, left: g.enemies.filter(e => e.hp > 0 && !isNoncombatant(e)).length, boss: g.missionResult.boss || '', err: err.slice(0, 40)});
}
console.table(rows);
// 遺產級頭目：撤退
{
  const g = new SquadGame(ticket('raider', 5, {boss: {...BOSS.raider, dies: false}})), b = g.enemies.find(e => e.chimeraBoss);
  if (!b || b.type !== 'delisted_soldier' || !(b.damageScale > 1.4)) fail('頭目沒有照遺產級設定');
  b.hp = 0; g.action('wait');
  if (g.enemies.includes(b) || g.missionResult.boss !== 'retreat') fail('頭目沒有撤退'); else console.log('✓ 頭目負傷撤退：', g.logs.slice(-3).map(l => l.text || l).join(' / '));
}
// 遺產級頭目：戰死、撿起來、帶出去
{
  const g = new SquadGame(ticket('raider', 6, {boss: {...BOSS.raider, dies: true}})), b = g.enemies.find(e => e.chimeraBoss);
  b.hp = 0; g.action('wait');
  const it = g.items.find(i => i.type === 'chimera_legacy');
  if (!it) fail('戰死沒有掉遺產級');
  else { const p = g.player; p.x = it.x; p.y = it.y; g.pickup(); if (!p.chimeraLegacy) fail('撿不起來'); else console.log('✓ 撿起遺產級：', p.squadId, p.chimeraLegacy.name); }
  for (const e of g.enemies) e.hp = 0; g.action('wait');
  const r = g.missionResult; if (r.boss !== 'dead' || r.legacy !== g.player.squadId) fail(`戰死回報不對 ${JSON.stringify({boss: r.boss, legacy: r.legacy, status: g.status})}`); else console.log('✓ 回報：', r.boss, '遺產級在', r.legacy);
  // 拿著的人倒下就掉在原地
  const g2 = new SquadGame(ticket('raider', 6, {boss: {...BOSS.raider, dies: true}})); g2.enemies.find(e => e.chimeraBoss).hp = 0; g2.action('wait');
  const it2 = g2.items.find(i => i.type === 'chimera_legacy'), m = g2.members.find(x => x !== g2.player); m.chimeraLegacy = it2.legacy; g2.items = g2.items.filter(i => i !== it2); m.hp = 0; g2.action('wait');
  if (!g2.items.some(i => i.type === 'chimera_legacy' && i.x === m.x && i.y === m.y)) fail('拿著的人倒下沒有掉'); else console.log('✓ 拿著的人倒下，遺產級掉在原地');
}
// 武裝車兩回合一格、衝鋒車爆炸兩格：把 ASH 本身的 enemyAct／explode 換成記錄用的，只看奇美拉加的那一層
{
  const g = new SquadGame(ticket('army', 8, {veh: {armor: 1}})), car = g.enemies.find(e => e.type === 'chimera_armor');
  const Base = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(g)));   // Game（SquadGame → MissionGame → Game）
  const act = Base.enemyAct, boom = Base.explode; let seen = null;
  Base.enemyAct = function (e) { if (e === car) e.x += 1; return true; };
  Base.explode = function (c, radius, damage) { seen = {radius, damage}; return true; };
  const moves = []; try { for (let i = 0; i < 6; i++) { g.turn++; const x = car.x; g.enemyAct(car); moves.push(car.x !== x ? 1 : 0); }
    const r = new SquadGame(ticket('raider', 9, {veh: {rush: 1}})), rush = r.enemies.find(e => e.type === 'chimera_rush'); r.explode(rush, 1, 30);
    if (rush.maxHp !== 120) fail('衝鋒車血量不對');
    if (seen?.radius !== 2 || seen?.damage !== 50) fail(`衝鋒車爆炸 ${JSON.stringify(seen)}`); else console.log('✓ 衝鋒車血量', rush.maxHp, '爆炸', seen);
  } finally { Base.enemyAct = act; Base.explode = boom; }
  if (moves.join('') !== '101010') fail(`武裝車移動 ${moves.join('')}`); else console.log('✓ 武裝車兩回合走一格', moves.join(''), '血量', car.maxHp);
}
console.log(bad ? `有 ${bad} 項不對` : '全部正常');
process.exit(bad ? 1 : 0);
