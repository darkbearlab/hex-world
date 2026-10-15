// PVP（pvp/DESIGN.md，Alan 2026-10-15）：兩隊真人（或機器人）在同一個 ASH 戰場對打，XCOM 式整隊輪流。
// 做法：每個階段整個換視角——
// - 輪到 A 隊：遊戲裡的「我方隊員」（members）就是 A 隊；B 隊每個人變成一個替身敵人（proxy，ASH 的敵人物件，放在 B 本人的位置），
//   血量＝B 本人的生命＋護甲板。ASH 原本的選目標、命中、扣血、爆炸、機器人找目標都直接用在替身上；替身受的傷每個動作後同步回本人。
//   對方在自己的階段裡本來就不動，替身不用移動。
// - A 隊每個人各做一個動作（soloTurn：只做自己那一格，敵人不行動），全部做完推進一次世界（火、煙、技能冷卻、特性），換 B 隊。
// - 迷霧兩邊各一份（seen），換邊時一起換。
// - 勝負：拿下對方兩人就贏；倒地就是死；用 Ally 邏輯控制的單位（無人機、砲台）不算人頭。300 回合上限。
// 轉角：ASH 原本看的人和被看的人都能探頭（隔著轉角互相看得到、但打不到）；PVP 改成被看的那一方不算探頭——貼著牆的人看不到，除非他開過火。
// 開火暴露：開火的人到自己這一方下一個階段開始前都暴露，對方任何地方都看得到他的位置（要打還是要有射線）。近戰一刀砍死不暴露，砍了沒死就暴露。
// 還沒做（之後）：黑暗與消焰、工兵的無人機和砲台當作對方可以打的目標、爆炸波及自己的隊友。
import {SquadGame} from './chimera-squad.js';
import {makeEnemy, distance} from './world.js';
import {setSize, WEAPONS} from './data.js';
import {weaponStats} from './weapons.js';
import {tickSkills} from './skills.js';
import {expireExposure} from './corner.js';
import {tickTraits} from './traits.js';
import {tickVents} from './vents.js';
import {tickFires} from './fire.js';
import {dryAcid} from './swarm-fields.js';
import {recordGunFlashes} from './lighting.js';
import {tickDecoy} from './field-gear.js';
import {CHARACTERS} from './characters.js';
import {initialSkillState} from './skills.js';
import {anchors} from './combat.js';
import {objectSightGrid} from './scenery.js';
import {lineOfSight} from './world.js';

export const PVP = {KILLS: 2, ROUNDS: 300, PROXY: 'raider'};
export const PVP_CLASSES = ['soldier', 'recon', 'bulwark', 'berserker', 'ninja', 'engineer'];   // 德魯伊、死靈法師還在調整
let building = null;   // generateFloor 在建構子裡就被叫到，那時 this 還沒有自己的欄位

// pvp/tools/mapgen.mjs 的地圖（字元格子）→ ASH 的地圖：# 牆、= 窗（看得到不能過＝ASH 的坑 VOID）、+ 門口、. 地板、c 掩體（props 的 cover）
function ashMap(M) {
  const N = M.T.length, grid = M.T.map(row => row.map(t => t === '#' ? 0 : t === '=' ? 2 : 1));
  const props = [], footprint = [];
  M.T.forEach((row, y) => row.forEach((t, x) => { if (t === 'c') props.push({id: `cover-${x}-${y}`, x, y, type: 'cover', hp: 40, maxHp: 40}); if (grid[y][x] === 1) footprint.push({x, y}); }));
  const mid = N >> 1, start = {x: M.A[0], y: M.A[1]}, end = {x: M.B[0], y: M.B[1]};
  const room = {x: 1, y: 1, w: N - 2, h: N - 2, cx: mid, cy: mid, id: 0, cellIds: [0], footprint};
  return {grid, rooms: [room], start, end, startRoom: 0, endRoom: 0, links: [], mainRoute: [0], rewardRooms: [], enemies: [], items: [], props, hazards: [], marks: [], barriers: [],
    cells: [{id: 0, row: 0, col: 0, roomId: 0}], openings: [], annexes: [], generation: {version: 2, recipeId: 'pvp-v1'}, lighting: grid.map(r => r.map(() => 1)), slots: [], lamps: [], lightModel: 2};
}

export class PvpGame extends SquadGame {
  // match：{seed, map（mapgen 的結果）, A: ['soldier', ...], B: [...]}
  constructor(match) {
    // st：職業原版的命中、迴避、近戰（奇美拉的 applyStats 會用 st 蓋掉職業的數值，不給就等於歸零）
    const one = (side, cls, i) => { const b = CHARACTERS[cls]?.combat || {}; return {id: `${side}${i + 1}`, cls, lv: 3, st: {acc: b.rangedAccuracy || 0, eva: b.rangedEvasion || 0, mel: b.meleeAccuracy || 0}}; };
    const squad = [...match.A.map((cls, i) => one('A', cls, i)), ...match.B.map((cls, i) => one('B', cls, i))];
    building = match; setSize(match.map.T.length);
    try { super({seed: match.seed, faction: 'rebel', facility: true, enemy: {units: {}, veh: {}, boss: null}, squad}); } finally { building = null; }
    this.pvp = {round: 1, side: null, kills: {A: 0, B: 0}, winner: null, log: []};
    // 兩隊各放到自己的開場（對角），彼此不重疊
    const sides = {A: this.members.filter(m => m.squadId[0] === 'A'), B: this.members.filter(m => m.squadId[0] === 'B')};
    const used = new Set(), place = (m, at) => { for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = at[0] + dx, y = at[1] + dy, k = `${x},${y}`;
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r && !used.has(k) && this.grid[y]?.[x] === 1 && !this.props.some(o => o.x === x && o.y === y)) { used.add(k); Object.assign(m, {x, y}); return; } } };
    for (const m of sides.A) place(m, match.map.A); for (const m of sides.B) place(m, match.map.B);
    for (const m of [...sides.A, ...sides.B]) { m.pvpSide = m.squadId[0]; m.callName = m.squadId; }
    Object.defineProperty(this, 'sides', {configurable: true, writable: true, enumerable: false, value: sides});
    const blank = () => this.seen.map(r => r.map(() => false));
    this.pvpSeen = {A: blank(), B: blank()};
    this.enemies = []; this.status = 'playing';
  }
  generateFloor() { const M = building || this.match; return M ? ashMap(M.map) : super.generateFloor(); }
  // 職業配置照 ASH 原版：不套奇美拉的土製
  equip(m, c) {
    const keep = m.owned.map(s => [s, m.affixes[s]]);
    super.equip(m, c);
    const sk = CHARACTERS[m.character]?.skills || []; m.skills = [...sk]; m.skillState = initialSkillState(m.skills); m.prepared = {...m.prepared, skill: sk[0] || null};   // 職業技能照原版
    for (const [s, a] of keep) { m.affixes[s] = a; const w = WEAPONS[m.weaponBases[s]]; if (w && !w.melee) m.ammo[s] = weaponStats(m.weaponBases[s], a, m).mag; }
  }
  other(side) { return side === 'A' ? 'B' : 'A'; }
  alive(side) { return this.sides[side].filter(m => m.hp > 0); }
  // 對方的每個活人 → 替身敵人（id 固定，機器人的記憶接得上）
  proxies(side) {
    return this.alive(side).map(m => {
      const e = makeEnemy(PVP.PROXY, m.x, m.y, `px-${m.squadId}`, 1, this.difficultySpec, this.facilityFaction);
      return Object.assign(e, {hp: m.hp + (m.plates || 0), maxHp: m.maxHp + (m.plates || 0), alert: true, courseName: m.squadId, pvpOf: m.squadId, pvpExposed: !!m.pvpExposed});
    });
  }
  // 替身受的傷同步回本人：先扣護甲板、再扣生命
  syncProxies() {
    for (const e of this.enemies) {
      const m = this.members.length ? this.unit(e.pvpOf) : null; if (!m || m.hp <= 0) continue;
      const total = m.hp + (m.plates || 0), now = Math.max(0, e.hp); if (now >= total) continue;
      let lost = total - now; const p = Math.min(m.plates || 0, lost); m.plates = (m.plates || 0) - p; lost -= p; m.hp -= lost;
      if (m.hp <= 0 || e.hp <= 0) { m.hp = 0; e.hp = 0; this.pvp.kills[this.other(m.pvpSide)]++; this.pvp.log.push(`第 ${this.pvp.round} 回合：${m.squadId} 倒下`); }
    }
  }
  unit(id) { return [...this.sides.A, ...this.sides.B].find(m => m.squadId === id); }
  // 換邊：我方＝這一隊，敵人＝對方的替身，迷霧換成這一隊的
  enter(side) {
    if (this.pvp.side) this.pvpSeen[this.pvp.side] = this.seen;
    this.pvp.side = side; this.seen = this.pvpSeen[side];
    for (const m of this.sides[side]) m.pvpExposed = false;   // 自己的階段開始：上一階段開火的暴露結束
    this.members = this.sides[side]; const lead = this.alive(side)[0]; if (!lead) return false;
    this.swap(lead); this.controlled = lead;
    this.enemies = this.proxies(this.other(side)); this.target = null;
    this.reveal(); return true;
  }
  // 一個階段：這一隊每個活人各做一個動作（brain 決定；人類玩家之後接成 UI 輸入），然後推進世界
  phase(side) {
    if (this.status !== 'playing' || !this.enter(side)) return false;
    for (const m of this.alive(side)) {
      if (this.status !== 'playing' || m.hp <= 0) continue;
      const brain = this.brains.get(m); if (!brain) continue;
      this.swap(m); this.controlled = m; this.soloTurn = true; this.soloDone = false;
      try { for (let i = 0; i < 6 && !this.soloDone && m.hp > 0 && this.status === 'playing'; i++) brain(this, m); }
      finally { this.soloTurn = false; tickSkills(m); expireExposure([m], this.turn); m.lightLingers = false; }
      this.syncProxies(); this.judge();
    }
    this.worldTick(); this.syncProxies(); this.judge();
    if (side === 'B') this.pvp.round++;
    if (this.status === 'playing' && this.pvp.round > PVP.ROUNDS) { this.status = 'draw'; this.pvp.log.push('打到回合上限'); }
    return true;
  }
  // 世界推進（ASH 的 action() 在敵人行動前後做的事，扣掉敵人）
  worldTick() {
    this.turn++; tickVents(this); tickFires(this); dryAcid(this);
    if (this.player.hp > 0) this.environmentTurn();
    this.smoke = this.smoke.filter(s => s.expires > this.turn); this.flares = (this.flares || []).filter(f => f.expires > this.turn);
    recordGunFlashes(this); tickDecoy(this);
    expireExposure([...this.members, ...this.enemies, ...this.allies], this.turn);
    for (const a of [...this.members, ...this.enemies, ...this.activeAllies]) tickTraits(a);
    this.settleAttackNotes(); this.reveal();
  }
  judge() {
    if (this.pvp.winner) return;
    for (const s of ['A', 'B']) {
      const dead = this.sides[s].filter(m => m.hp <= 0).length;
      if (dead >= PVP.KILLS || !this.alive(s).length) { this.pvp.winner = this.other(s); this.status = 'won'; this.pvp.log.push(`${this.other(s)} 隊獲勝（拿下 ${dead} 人）`); return; }
    }
  }
  // 看得到對方嗎：暴露中的到處都看得到；不然要從我（可以探頭）看得到他那一格的中心——他貼著牆探頭不算
  sight(a, b) {
    if (!b?.pvpOf) return super.sight(a, b);
    if (b.pvpExposed) return true;
    if (!super.sight(a, b)) return false;
    const grid = objectSightGrid(this, a, b), bars = this.barriers || [];
    return anchors(grid, a, bars, 'sight').some(o => lineOfSight(grid, o, b, bars, 'sight'));
  }
  visible(e) { return e?.pvpOf && e.pvpExposed ? true : super.visible(e); }   // 暴露中的不受距離限制
  // 動作做完：開火的暴露；近戰砍了沒死也暴露
  soloPaid(type, arg) {
    const hp0 = new Map(this.enemies.map(e => [e, e.hp])), meleeShot = type === 'fire' && this.weapon?.melee, p = this.player;
    const ok = super.soloPaid(type, arg);
    if (ok) {
      const melee = meleeShot || ['bumpMelee', 'hookBlade', 'grapple'].includes(type);
      if (melee) { if ([...hp0].some(([e, h]) => e.hp < h && e.hp > 0)) p.pvpExposed = true; }
      else if (['fire', 'blindFire', 'launch', 'suppressiveFire'].includes(type)) p.pvpExposed = true;
      if (p.pvpExposed) this.pvp.exposures = (this.pvp.exposures || 0) + 1;
    }
    return ok;
  }
  // 撤離、電梯、投降以外的收尾不適用
  descend() { return this.fail('PVP 沒有撤離'); }
  handOver() { return false; }
}
