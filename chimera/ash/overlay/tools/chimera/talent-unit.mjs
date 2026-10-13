// 性格技能（chimera-talents.js）裡機器人不太會碰到的情況，直接擺出來測：致命傷（不倒、不死）、機體被打爆（自爆）、
// 動力拳（破陣拳、拆牆、重錘、衝撞）、下錨（不動如山、火力網）、護衛、廢料不會被 ASH 加。
// node tools/chimera/talent-unit.mjs
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {distance} from '../../src/world.js';
let bad = 0; const ok = (c, msg) => { console.log(`${c ? '✓' : '✗'} ${msg}`); if (!c) bad++; };
const mk = (id, cls, tal, extra = {}) => ({id, cls, st: {hp: cls === 'berserker' ? 160 : 100, acc: 8, eva: 0, mel: 0}, lv: 11, skills: [], tal, grow: {}, scrap: 0, ...extra});
const game = (squad, seed = 7) => new SquadGame({seed, faction: 'loyalist', type: 'probe', biome: '旱原', night: false, enemy: {units: {trooper: 6}, veh: {}, boss: null}, squad});
const near = (g, p, e) => { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = {x: p.x + dx, y: p.y + dy}; if (g.passable(q.x, q.y) && !g.memberAt(q)) { e.x = q.x; e.y = q.y; e.alert = true; return true; } } return false; };
// 1. 不倒、不死
{ const g = game([mk('S', 'soldier', ['sol_stand']), mk('B', 'berserker', ['ber_undying'])]), [s, b] = g.members, e = g.enemies[0];
  g.swap(s); g.damagePlayer(999, '測試', e); ok(s.hp === 1, `不倒：致命傷剩 ${s.hp}`); g.damagePlayer(999, '測試', e); ok(s.hp <= 0, '不倒只有一次');
  g.swap(b); b.battleSpirit = {stacks: 2, lastKill: g.turn}; g.damagePlayer(9999, '測試', e); ok(b.hp === 1 && b.battleSpirit.stacks === 1, `不死：剩 ${b.hp}、戰意 ${b.battleSpirit.stacks}`);
  b.battleSpirit.stacks = 0; g.damagePlayer(9999, '測試', e); ok(b.hp <= 0, '沒有戰意就倒下'); }
// 2. 護衛：身邊的重裝兵吃三成
{ const g = game([mk('S', 'soldier', []), mk('W', 'bulwark', ['bul_guard'])]), [s, w] = g.members; w.x = s.x + 1; w.y = s.y; if (!g.passable(w.x, w.y)) { w.x = s.x; w.y = s.y + 1; }
  const p0 = w.plates, h0 = s.hp; g.swap(s); g.damagePlayer(40, '測試', g.enemies[0]); ok(w.plates < p0 && h0 - s.hp < 40, `護衛：重裝兵護甲板 ${p0}→${w.plates}，士兵 −${h0 - s.hp}`); }
// 3. 動力拳：破陣拳、拆牆、重錘、衝撞
{ const g = game([mk('W', 'bulwark', ['bul_knock', 'bul_wall', 'bul_hammer', 'bul_ram'])]), w = g.members[0], [e, f] = g.enemies;
  near(g, w, e); const fist = w.owned.find(s => g.weaponAt(s).id === 'powerfist'); ok(fist != null, '重裝兵有動力拳');
  e.hp = 500; e.maxHp = 500; const at = {x: e.x, y: e.y}; g.hitTarget(e, 30, w, 0, g.weaponAt(fist)); ok(e.x !== at.x || e.y !== at.y || (g.chimeraFired?.bul_knock || 0) === 0 && !g.passable(2 * e.x - w.x, 2 * e.y - w.y), `破陣拳：敵人 (${at.x},${at.y})→(${e.x},${e.y})`);
  near(g, w, e); g.props.push({id: 't-cover', x: e.x + (e.x - w.x) || e.x, y: e.y + (e.y - w.y) || e.y + 1, type: 'cover', hp: 90, maxHp: 90}); const cv = g.props.at(-1); if (distance(cv, e) > 1) { cv.x = e.x; cv.y = e.y + 1; }
  g.hitTarget(e, 30, w, 0, g.weaponAt(fist)); ok(cv.hp <= 0, `拆牆：掩體剩 ${cv.hp}`);
  near(g, w, e); f.x = e.x; f.y = e.y; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.passable(e.x + dx, e.y + dy) && !(e.x + dx === w.x && e.y + dy === w.y)) { f.x = e.x + dx; f.y = e.y + dy; break; }
  f.hp = 100; e.hp = 5; g.chimeraMelee = w; g.hitTarget(e, 30, w, 0, g.weaponAt(fist)); g.chimeraMelee = null; ok(e.hp <= 0 && f.hp <= 85, `重錘：旁邊的敵人剩 ${f.hp}`);
  const g2 = game([mk('W', 'bulwark', ['bul_ram'])]), w2 = g2.members[0], e2 = g2.enemies[0]; near(g2, w2, e2); e2.hp = 500; e2.maxHp = 500; ok(g2.ramPunch(w2, g2.turn) && e2.hp < 500, `衝撞：敵人剩 ${e2.hp}`); }
// 4. 下錨：不動如山、火力網
{ const g = game([mk('W', 'bulwark', ['bul_rock', 'bul_net'])]), w = g.members[0];
  w.skillState.anchor = {remaining: 1, cooldown: 0}; w.plates = 50; w.suppression = 3; for (const e of g.enemies) { e.x = w.x; e.y = Math.max(1, w.y - 3); break; }
  const seen = g.enemies.filter(e => e.hp > 0 && g.sight(w, e)).length; g.talentRound();
  ok(w.plates === 60 && w.suppression === 0, `不動如山：護甲板 50→${w.plates}、壓制 ${w.suppression}`); ok(!seen || g.enemies.some(e => (e.suppression || 0) > 0), `火力網：看得到 ${seen} 個，被壓制 ${g.enemies.filter(e => (e.suppression || 0) > 0).length} 個`); }
// 5. 自爆：機體被打爆
{ const g = game([mk('E', 'engineer', ['eng_boom'])]), m = g.members[0];
  const a = {id: 'a1', kind: 'drone', sourceId: 'drone_follow', x: m.x, y: m.y, hp: 10, maxHp: 90, status: 'active', floor: g.floor, armor: 0}; g.allies = [...(g.allies || []), a];
  const e = g.enemies[0]; near(g, a, e); e.hp = 100; g.damageAlly(a, 50, e); ok(a.hp <= 0 && e.hp <= 70, `自爆：機體 ${a.hp}，旁邊的敵人剩 ${e.hp}`); }
// 6. 廢料：ASH 給的不算
{ const g = game([mk('E', 'engineer', [], {scrap: 100})]), m = g.members[0]; ok(m.scrap === 100, `進場廢料 ${m.scrap}`);
  const { botFor } = (await import('./full-squad.mjs')).installFullSquad(g); let mx = m.scrap; for (let i = 0; i < 400 && g.status === 'playing'; i++) { botFor(g.player).step(); mx = Math.max(mx, m.scrap); }
  ok(mx <= 100, `打完一場，廢料最多 ${mx}（不會多過進場給的）`); }
// 7. 多層設施沒有交易終端
{ const g = new SquadGame({seed: 3, faction: 'rebel', type: 'hunting', facility: true, floors: 3, biome: '旱原', night: false, enemy: {units: {raider: 4}, veh: {}, boss: null}, squad: [mk('S', 'soldier', [])]});
  ok(!g.props.some(o => o.type === 'terminal'), `設施裡的終端 ${g.props.filter(o => o.type === 'terminal').length} 台`); }
console.log(bad ? `有 ${bad} 項不對` : '全部正常'); process.exit(bad ? 1 : 0);
