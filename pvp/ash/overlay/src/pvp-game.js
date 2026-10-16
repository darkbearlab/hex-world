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
// 黑暗：地圖的房間有亮有全黑（mapgen 的 L）。ASH 本來就有：黑暗裡的人看不到（夜視例外）、開槍的槍口火光照亮開火那一格（現形、可以被直接瞄準）。
//   PVP：火光累積一整個階段、留到對方的階段結束；消焰器（ASH 的 flashhider 詞條）在全黑的地方開火不算暴露。
// 無人機、砲台（工兵）：在自己那一隊的階段裡行動（隊員都動完之後）；對方的階段裡變成替身，可以被打，不算人頭。
// 爆炸：ASH 原本只會傷到「目前操作的那個人」，同隊其他人站在範圍裡也沒事；PVP 補上同一套傷害。
import {SquadGame} from './chimera-squad.js';
import {makeEnemy, distance} from './world.js';
import {setSize, WEAPONS, ENEMY_TYPES} from './data.js';
import {actorStat} from './actor-stats.js';
import {weaponStats} from './weapons.js';
import {tickSkills, skillActive} from './skills.js';
import {expireExposure} from './corner.js';
import {tickTraits, grantTrait} from './traits.js';
import {tickVents} from './vents.js';
import {tickFires} from './fire.js';
import {dryAcid} from './swarm-fields.js';
import {recordGunFlashes} from './lighting.js';
import {tickDecoy} from './field-gear.js';
import {CHARACTERS} from './characters.js';
import {initialSkillState} from './skills.js';
import {anchors} from './combat.js';
import {objectSightGrid} from './scenery.js';
import {makeBarrier} from './barriers.js';
import {applySuppression, tickSuppression} from './suppression.js';
import {grenadeTotal} from './throwables.js';
import {lineOfSight} from './world.js';
import {isBlack} from './lighting.js';
import {allyAct, currentAllies} from './allies.js';
import {isMunition, munitionAct, isBomber, bomberAct} from './workshop.js';

export const PVP = {KILLS: 2, ROUNDS: 300, PROXY: 'raider'};
// PVP 的數值調整（ASH 的數值是一隊精英打一群雜兵；對等互打要調）。統計見 pvp/DESIGN.md
export const PVP_TUNING = {bulwark: {plates: 60, plateCapacity: 60},
  // 規則數值（平衡提案用，2026-10-16）：ropePerPhase＝每人每個階段最多用幾次繩索（null＝不限）；powerMult＝三倍傷害的倍率；powerExpire＝撿到後幾個自己的階段沒用就失效（0＝不失效）
  rules: {ropePerPhase: null, powerMult: 3, powerExpire: 0, powerRound: 0, anchorDouble: true, crates: true,
  // 團隊死鬥（Alan 2026-10-16 要測）：{target: 100, points: {職業: 分數}}；擊倒一個人得那個職業的分數，先到 target 的贏；倒下的人在自己那一隊下個階段開始時回開場復活。null＝原本的「拿下兩人」
  tdm: null},
  // 弱勢職業的加強（Alan 2026-10-16 要測）：recon＝開場多一把裝了消焰器的精準步槍；soldier＝手榴彈帶滿、醫療包多幾個；ninja＝拿掉不推進回合的脫離繩（只留重新部署繩）。null＝不加強
  buffs: null};
export const BUFFS_PROPOSAL = {recon: {weapon: 'sniper', affix: 'flashhider'}, soldier: {fullGrenades: true, meds: 2}, ninja: {escapeLines: 0},
  berserker: {traits: ['night_vision']}, engineer: {scrap: 60}};   // 第二批（Alan 2026-10-16）：狂戰士夜視、工兵開場 60 廢料（兩台跟隨無人機或砲台）
// 團隊死鬥的預設分數＝之前統計的各職業存活率（%；2026-10-16，alpha 對打 11 組 60 場的平均）
export const TDM_POINTS = {soldier: 65, recon: 68, bulwark: 74, berserker: 75, ninja: 60, engineer: 79};   // powerRound＝三倍傷害第幾回合才出現（0＝開場就在）；anchorDouble＝下錨打兩輪
const RULE = k => PVP_TUNING.rules?.[k];
// 替身的敵人種類：ASH 打敵人時的護甲看種類（enemy-affixes.js 的 enemyArmor＝ENEMY_TYPES[type].armor），每種護甲值一個替身種類
// （外觀和原本的替身一樣；送給瀏覽器的快照換回 PVP.PROXY，pvp-room.js）
export const proxyType = armor => { const k = `pvp-proxy-${armor | 0}`; if (!ENEMY_TYPES[k]) ENEMY_TYPES[k] = {...ENEMY_TYPES[PVP.PROXY], armor: armor | 0}; return k; };
// 替身帶著本人的防禦（代理回報 2026-10-15：原本每個階段重建的替身沒有本人的護甲、閃避、待機、下錨、失能）
const DEFENSE = m => ({traits: structuredClone(m.traits || []), combatModifiers: Object.fromEntries(['rangedEvasion', 'meleeEvasion', 'rangedAccuracy', 'meleeAccuracy'].map(k => [k, actorStat(m, k)])),
  perks: {...(m.perks || {})}, moved: !!m.moved, evasive: !!m.evasive, pvpGuard: !!m.guard, vaultExposed: !!m.vaultExposed, skillState: structuredClone(m.skillState || {}),
  control: {...(m.control || {disabled: 0, immune: 0})}, poison: m.poison || 0, plates: m.plates || 0, facing: m.facing, suppression: m.suppression || 0,
  // 手電筒照本人（2026-10-16 alpha 回報：替身是破口突擊兵，三分之一會「帶手電筒」，被借到的人在對方眼裡永遠是亮的、躲不進黑暗）
  chimeraFlashlight: !!(m.flashlight || m.lightLingers)});
export const PVP_CLASSES = ['soldier', 'recon', 'bulwark', 'berserker', 'ninja', 'engineer'];   // 德魯伊、死靈法師還在調整
let building = null;   // generateFloor 在建構子裡就被叫到，那時 this 還沒有自己的欄位

// pvp/tools/mapgen.mjs 的地圖（字元格子）→ ASH 的地圖：# 牆、= 窗（看得到不能過＝ASH 的坑 VOID）、+ 門口、. 地板、c 掩體（props 的 cover）
function ashMap(M) {
  const N = M.T.length, grid = M.T.map(row => row.map(t => t === '#' ? 0 : t === '=' ? 2 : 1));
  const props = [], footprint = [];
  M.T.forEach((row, y) => row.forEach((t, x) => { if (t === 'c') props.push({id: `cover-${x}-${y}`, x, y, type: 'cover', hp: 40, maxHp: 40}); if (grid[y][x] === 1) footprint.push({x, y}); }));
  const mid = N >> 1, start = {x: M.A[0], y: M.A[1]}, end = {x: M.B[0], y: M.B[1]};
  const room = {x: 1, y: 1, w: N - 2, h: N - 2, cx: mid, cy: mid, id: 0, cellIds: [0], footprint};
  // 光：ASH 的 lighting 是電力圖（1 有電＝亮、0 停電）；停電的地方靠鹵素燈（第二版地圖的 lamps）
  const lighting = M.L ? M.L.map(r => r.map(v => v > 0 ? 1 : 0)) : grid.map(r => r.map(() => 1));
  // 第二版地圖：矮隔板（ASH 的 low_partition，在兩格之間）、鹵素燈、出煙口（smoke／haze，週期錯開）
  const barriers = (M.P || []).map(([a, b], i) => makeBarrier('low_partition', {x: a[0], y: a[1]}, {x: b[0], y: b[1]}, `edge-pvp-${i}`));
  const lamps = (M.lamps || []).map(([x, y], i) => ({id: `lamp-1-${i}`, x, y, hp: 1}));
  const vents = (M.vents || []).map(([x, y], i) => ({id: `vent-1-${i}`, x, y, kind: i % 2 ? 'haze' : 'smoke', phase: (i * 3) % 7}));
  // 搶奪點（Alan 2026-10-16）：兩側的高階武器箱＝ASH 的補給箱（相鄰格打開＝一個動作，武器掉在腳邊再撿；一人最多三把）；中央的三倍傷害走上去就撿到。都不會重生
  const W = id => WEAPONS.findIndex(w => w.id === id);
  if (RULE('crates') !== false) for (const [i, [x, y, w]] of (M.crates || []).entries()) props.push({id: `pvp-crate-${i}`, type: 'container', kind: 'field', x, y, opened: false, indestructible: true, contents: [{type: 'weapon', weapon: W(w)}]});
  const items = M.power && !(RULE('powerRound') > 1) ? [{x: M.power[0], y: M.power[1], type: 'pvp_power', amount: 1}] : [];
  return {grid, rooms: [room], start, end, startRoom: 0, endRoom: 0, links: [], mainRoute: [0], rewardRooms: [], enemies: [], items, props, hazards: [], marks: [], barriers,
    cells: [{id: 0, row: 0, col: 0, roomId: 0}], openings: [], annexes: [], generation: {version: 2, recipeId: 'pvp-v1'}, lighting, slots: [], lamps, vents, lightModel: 2, pvpTrench: M.D ? M.D.map(r => r.slice()) : null, pvpPowerAt: M.power || null};
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
    this.applyBuffs([...sides.A, ...sides.B]);
    for (const m of [...sides.A, ...sides.B]) { m.pvpHome = {x: m.x, y: m.y}; m.pvpStartPlates = m.plates || 0; }   // 團隊死鬥復活用
    for (const m of [...sides.A, ...sides.B]) { m.pvpSide = m.squadId[0]; m.callName = m.squadId; }
    Object.defineProperty(this, 'sides', {configurable: true, writable: true, enumerable: false, value: sides});
    const blank = () => this.seen.map(r => r.map(() => false));
    this.pvpSeen = {A: blank(), B: blank()};
    this.enemies = []; this.status = 'playing';
  }
  generateFloor() { const M = building || this.match; return M ? ashMap(M.map) : super.generateFloor(); }
  // 職業配置照 ASH 原版：不套奇美拉的土製
  equip(m, c) {
    const keep = m.owned.map(s => [s, m.affixes[s]]), lines = m.productionLines;   // 工兵的生產線（原版開場就有一台跟隨無人機）
    super.equip(m, c);
    const sk = CHARACTERS[m.character]?.skills || []; m.skills = [...sk]; m.skillState = initialSkillState(m.skills); m.prepared = {...m.prepared, skill: sk[0] || null};   // 職業技能照原版
    if (m.skills.includes('workshop') && lines?.length) m.productionLines = lines;
    Object.assign(m, PVP_TUNING[m.character] || {});
    for (const [s, a] of keep) { m.affixes[s] = a; const w = WEAPONS[m.weaponBases[s]]; if (w && !w.melee) m.ammo[s] = weaponStats(m.weaponBases[s], a, m).mag; }
  }
  other(side) { return side === 'A' ? 'B' : 'A'; }
  alive(side) { return this.sides[side].filter(m => m.hp > 0); }
  // 對方的每個活人 → 替身敵人（id 固定，機器人的記憶接得上）
  proxies(side) {
    const allies = this.allAllies.filter(a => a.pvpSide === side && a.status === 'active' && a.hp > 0 && a.floor === this.floor).map(a => Object.assign(makeEnemy(PVP.PROXY, a.x, a.y, `pa-${a.id}`, 1, this.difficultySpec, this.facilityFaction), {hp: a.hp, maxHp: a.maxHp || a.hp, alert: true, courseName: a.name || a.kind, pvpAlly: a.id, chimeraFlashlight: false}));
    return [...allies, ...this.alive(side).map(m => {
      const e = makeEnemy(proxyType(m.armor), m.x, m.y, `px-${m.squadId}`, 1, this.difficultySpec, this.facilityFaction); Object.assign(e, DEFENSE(m));
      // 名字（目標卡、紀錄）：「B2 重裝兵」——Alan 2026-10-15：對方的職業先不隱藏
      return Object.assign(e, {hp: m.hp + (m.plates || 0), maxHp: m.maxHp + (m.plates || 0), alert: true, courseName: `${m.squadId} ${CHARACTERS[m.character]?.label || m.character}`, pvpCls: m.character, pvpOf: m.squadId, pvpExposed: !!m.pvpExposed});
    })];
  }
  // 替身受的傷同步回本人：先扣護甲板、再扣生命
  syncProxies() {
    for (const e of this.enemies) if (e.pvpAlly != null) {   // 無人機、砲台：照 ASH 的 damageAlly 扣（壞掉、掉武器都照原本的）
      const a = this.allAllies.find(x => x.id === e.pvpAlly); if (!a || a.hp <= 0) continue;
      const lost = a.hp - Math.max(0, e.hp); if (lost > 0) { this.damageAlly(a, lost, null, false, true); e.hp = Math.max(0, a.hp); }
    }
    for (const e of this.enemies) {
      if (e.pvpOf == null) continue;
      const m = this.members.length ? this.unit(e.pvpOf) : null; if (!m || m.hp <= 0) continue;
      // 狀態同步回本人（失能、標記、燃燒、中毒…都是打在替身上的）
      m.traits = structuredClone(e.traits || []); m.control = {...(e.control || m.control)}; m.poison = e.poison || 0; m.suppression = e.suppression || 0;   // 壓制也是打在替身上的
      const total = m.hp + (m.plates || 0), now = Math.max(0, e.hp); if (now >= total) continue;
      let lost = total - now; const by = this.pvpActor || null;
      (this.pvp.events ||= []).push({round: this.pvp.round, target: m.squadId, dmg: lost, by: by?.id || null, byVisible: !!by?.exposed, how: this.pvpHow || null, killed: now <= 0, left: now});
      // 護甲板：重裝兵（plate_life）全部吃，其他人吃一半（同 ASH 的 damagePlayer）
      const p = Math.min(m.plates || 0, m.traits?.some(t => t.id === 'plate_life') ? lost : Math.floor(lost / 2)); m.plates = (m.plates || 0) - p; lost -= p; m.hp -= lost; e.hp = Math.max(0, m.hp) + (m.plates || 0);
      if (m.hp <= 0 || e.hp <= 0) {
        m.hp = 0; e.hp = 0; this.pvp.kills[this.other(m.pvpSide)]++;
        this.pvp.log.push(`第 ${this.pvp.round} 回合：${m.squadId}（${m.character}）倒下${by?.id ? `，${by.id} 擊倒` : ''}`);
        // 團隊死鬥：擊倒得分（那個職業的分數）
        if (RULE('tdm')) { const pts = RULE('tdm').points?.[m.character] ?? TDM_POINTS[m.character] ?? 50, k = this.other(m.pvpSide); (this.pvp.score ||= {A: 0, B: 0})[k] += pts; this.pvp.log.push(`${k} 隊 +${pts} 分（${this.pvp.score.A}：${this.pvp.score.B}）`); }
      }
    }
  }
  unit(id) { return [...this.sides.A, ...this.sides.B].find(m => m.squadId === id); }
  // 弱勢職業的加強（PVP_TUNING.buffs）
  applyBuffs(all) {
    const B = PVP_TUNING.buffs; if (!B) return;
    const keep = this.player;
    for (const m of all) {
      const b = B[m.character]; if (!b) continue;
      if (b.weapon) {   // 多一把武器（照奇美拉 applyGear 的加法：武器格、詞條、彈匣裝滿）
        const base = WEAPONS.findIndex(w => w.id === b.weapon), slot = m.weaponBases.length;
        if (base >= 0) { m.weaponBases.push(base); m.affixes.push(b.affix || null); m.ammo.push(weaponStats(base, b.affix || null, m).mag); m.upgrades.push(0); m.owned.push(slot); }
      }
      if (b.fullGrenades) { this.swap(m); try { m.grenades = (m.grenades || 0) + Math.max(0, this.ammoCapacity('grenade') - grenadeTotal(m)); } finally { this.swap(keep); } }
      if (b.meds) m.meds = (m.meds || 0) + b.meds;
      if (b.escapeLines !== undefined) m.escapeLines = b.escapeLines;
      for (const id of b.traits || []) grantTrait(m, id, 'pvp:buff');
      if (b.scrap) m.scrap = (m.scrap || 0) + b.scrap;
    }
  }
  // 團隊死鬥的復活：回開場（被佔就找最近的空地板），生命、護甲板、彈匣補滿，暫時狀態、壓制、三倍傷害都清掉
  respawn(m) {
    const busy = (x, y) => [...this.sides.A, ...this.sides.B].some(u => u !== m && u.hp > 0 && u.x === x && u.y === y) || this.props.some(o => o.x === x && o.y === y && o.hp > 0);
    const h = m.pvpHome || {x: m.x, y: m.y}; let at = null;
    for (let r = 0; r <= 6 && !at; r++) for (let dy = -r; dy <= r && !at; dy++) for (let dx = -r; dx <= r; dx++) { const x = h.x + dx, y = h.y + dy; if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.grid[y]?.[x] === 1 && !busy(x, y)) { at = {x, y}; break; } }
    Object.assign(m, at || h, {hp: m.maxHp, plates: m.pvpStartPlates || 0, suppression: 0, poison: 0, pvpExposed: false, pvpPower: false, guard: false, moved: false, evasive: false, vaultExposed: false, chimeraTrenchExposed: false});
    m.control = {disabled: 0, immune: 0}; m.traits = (m.traits || []).filter(t => t.turns === undefined);
    for (const s of m.owned || []) { const w = WEAPONS[m.weaponBases[s]]; if (w && !w.melee) m.ammo[s] = weaponStats(m.weaponBases[s], m.affixes[s], m).mag; }
    this.pvp.log.push(`第 ${this.pvp.round} 回合：${m.squadId}（${m.character}）在開場復活`);
  }
  // 從 side 的角度看一眼（對方的階段裡播「看得到的」給 side，pvp-room.js）：暫時換成 side 的隊員、對方的替身、side 的迷霧，
  // 交給 shoot(this) 拍快照，拍完全部換回來（連 side 的迷霧記憶也還原：重播紀錄時不會拍這些，局面要一模一樣）
  viewAs(side, shoot) {
    const keep = {members: this.members, enemies: this.enemies, seen: this.seen, allies: this.allies, parked: this.pvpParked, player: this.player, controlled: this.controlled,
      visibleTiles: this.visibleTiles, target: this.target, effects: this.effects, logs: this.logs.slice(), refusal: this.refusal, fog: this.pvpSeen[side].map(r => r.slice())};
    const lead = this.alive(side)[0] || this.sides[side][0], o = this.other(side), all = this.allAllies;
    try {
      this.members = this.sides[side]; this.enemies = this.proxies(o); this.seen = this.pvpSeen[side];
      this.allies = all.filter(a => a.pvpSide !== o); this.pvpParked = all.filter(a => a.pvpSide === o);
      this.swap(lead); this.controlled = lead; this.effects = []; this.reveal({warnings: false});
      return shoot(this);
    } finally {
      this.swap(keep.player);
      Object.assign(this, {members: keep.members, enemies: keep.enemies, seen: keep.seen, allies: keep.allies, pvpParked: keep.parked, controlled: keep.controlled,
        visibleTiles: keep.visibleTiles, target: keep.target, effects: keep.effects, logs: keep.logs, refusal: keep.refusal});
      this.pvpSeen[side] = keep.fog;
    }
  }
  // 對方的無人機、砲台在這一隊的階段裡先收起來（ASH 的部署上限、跟隨、修理都看 g.allies；對方的只以替身存在）
  get allAllies() { return [...this.allies, ...(this.pvpParked || [])]; }
  park(side) {
    const all = this.allAllies, o = side && this.other(side);
    this.pvpParked = o ? all.filter(a => a.pvpSide === o) : []; this.allies = o ? all.filter(a => a.pvpSide !== o) : all;
  }
  // 換邊：我方＝這一隊，敵人＝對方的替身，迷霧換成這一隊的
  enter(side) {
    if (this.pvp.side) this.pvpSeen[this.pvp.side] = this.seen;
    this.pvp.side = side; this.seen = this.pvpSeen[side]; this.park(side);
    if (RULE('tdm')) for (const m of this.sides[side]) if (m.hp <= 0) this.respawn(m);
    for (const m of this.sides[side]) { if (m.pvpPower && RULE('powerExpire') && ++m.pvpPowerPhases > RULE('powerExpire')) { m.pvpPower = false; this.pvp.log.push(`第 ${this.pvp.round} 回合：${m.squadId} 的三倍傷害沒用就失效了`); } m.pvpExposed = !!m.pvpPower; }   // 自己的階段開始：上一階段開火的暴露結束（拿著三倍傷害的一直暴露）
    this.members = this.sides[side]; const lead = this.alive(side)[0]; if (!lead) return false;
    this.swap(lead); this.controlled = lead;
    this.enemies = this.proxies(this.other(side)); this.target = null;
    this.reveal(); return true;
  }
  // 一個階段：這一隊每個活人各做一個動作（brain 決定），然後推進世界。人類／AI 介面用下面三個一步一步來：
  //   beginPhase(side) → actAs(單位, 動作, 參數) 每人一次（免費動作不算：換武器、開手電筒⋯）→ endPhase()（沒動的人待機）
  phase(side) {
    if (!this.beginPhase(side)) return false;
    for (const m of this.alive(side)) {
      if (this.status !== 'playing' || m.hp <= 0) continue;
      const brain = this.brains.get(m); if (!brain) continue;
      this.focusUnit(m); this.pvpActor = {id: m.squadId, get exposed() { return !!m.pvpExposed; }};
      try { for (let i = 0; i < 6 && !this.soloDone && m.hp > 0 && this.status === 'playing'; i++) brain(this, m); }
      finally { this.unitDone(m); }
    }
    return this.endPhase();
  }
  beginPhase(side) {
    if (this.status !== 'playing' || !this.enter(side)) return false;
    this.pvp.left = this.alive(side).map(m => m.squadId); return true;
  }
  focusUnit(m) { this.pvpActor = null; this.swap(m); this.controlled = m; this.soloTurn = true; this.soloDone = false; this.refusal = null; this.reveal(); }   // reveal：ASH 的視野快取跟著「目前的玩家」，換人要重算
  unitDone(m) {
    // 壓制：ASH 在每個單位自己行動完減半（game-actions.js 的行動佇列 tickSuppression）；PVP 的一人一動作不經過佇列，這裡補上
    // （2026-10-16 Alan 回報：忍者、偵察兵一直被壓制——跨過戰壕的 +3 永遠不會消退）
    tickSuppression(m);
    this.soloTurn = false; tickSkills(m); expireExposure([m], this.turn); m.lightLingers = false;
    this.pvp.left = (this.pvp.left || []).filter(id => id !== m.squadId);
    this.syncProxies(); this.judge();
  }
  // 一個單位做一個動作：{ok, done（這個單位這一階段的動作用掉了）, msg（失敗原因或這一步的紀錄）}
  actAs(id, type, arg, {target, pre} = {}) {
    const m = this.sides[this.pvp.side]?.find(x => x.squadId === id);
    if (this.status !== 'playing') return {ok: false, msg: '對戰已經結束'};
    if (!m || m.hp <= 0) return {ok: false, msg: `${id} 不是這一隊活著的單位`};
    if (!this.pvp.left.includes(id) && !(this.actionCost(type, arg) === 0 && !(pre || []).length)) return {ok: false, msg: `${id} 這一階段已經動過了（免費動作例外：換武器、手電筒）`};
    this.focusUnit(m); const top = this.logs[0], fresh = () => { const i = this.logs.indexOf(top); return this.logs.slice(0, i < 0 ? this.logs.length : i).reverse().map(l => l.text).join(' '); };
    if (target !== undefined) this.target = target;
    let ok = false, err = null;
    try {
      for (const f of pre || []) if (this.action(f.type, f.arg) === false) { ok = false; throw Object.assign(new Error('pre'), {pre: true}); }
      this.pvpActor = {id, get exposed() { return !!m.pvpExposed; }};
      ok = this.action(type, arg) !== false;
    } catch (e) { if (!e.pre) err = e; }
    const free = !this.pvp.left.includes(id), done = !free && (this.soloDone || m.hp <= 0), msg = err ? `錯誤：${err.message}` : !ok ? (this.refusal?.text || fresh() || '做不到') : fresh();
    if (done) this.unitDone(m); else this.soloTurn = false;
    if (err) throw Object.assign(err, {pvpMsg: msg});
    return {ok, done, msg};
  }
  endPhase() {
    const side = this.pvp.side;
    for (const id of [...(this.pvp.left || [])]) { const m = this.unit(id); if (m?.hp > 0 && this.status === 'playing') { this.focusUnit(m); try { this.action('wait'); } finally { this.unitDone(m); } } }
    for (const a of this.activeAllies) {
      if (this.status !== 'playing' || a.hp <= 0 || a.pvpSide !== side) continue;
      this.pvpActor = {id: `${side} 的無人機 ${a.id}`, exposed: true}; this.pvpHow = {type: 'drone'};
      if (isMunition(a)) munitionAct(this, a); else if (isBomber(a)) bomberAct(this, a); else allyAct(this, a);
      this.pvpFlashes = [...(this.pvpFlashes || []), ...this.flashesNow()];
      this.syncProxies(); this.judge();
    }
    this.pvpActor = {id: '火、酸液等環境', exposed: true}; this.pvpHow = null; this.worldTick(); this.syncProxies(); this.judge(); this.pvpActor = null;
    if (side === 'B') this.pvp.round++;
    if (this.status === 'playing' && this.pvp.round > PVP.ROUNDS) { this.status = 'draw'; this.pvp.log.push('打到回合上限'); }
    this.pvp.left = []; return true;
  }
  // 世界推進（ASH 的 action() 在敵人行動前後做的事，扣掉敵人）
  worldTick() {
    this.turn++; tickVents(this); tickFires(this); dryAcid(this);
    if (this.player.hp > 0) this.environmentTurn();
    this.smoke = this.smoke.filter(s => s.expires > this.turn); this.flares = (this.flares || []).filter(f => f.expires > this.turn);
    const seen = new Set(); this.gunFlashes = (this.pvpFlashes || []).filter(f => { const k = f.x + ',' + f.y; if (seen.has(k)) return false; seen.add(k); return true; }); this.pvpFlashes = [];
    tickDecoy(this);
    // 三倍傷害晚一點才出現（平衡提案：不讓先動的一方一定先搶到中央）
    if (RULE('powerRound') > 1 && !this.pvpPowerSpawned && this.pvp.round >= RULE('powerRound') && this.pvpPowerAt) { this.pvpPowerSpawned = true; const [x, y] = this.pvpPowerAt; this.items.push({x, y, type: 'pvp_power', amount: 1}); this.pvp.log.push(`第 ${this.pvp.round} 回合：三倍傷害出現在地圖中央`); }
    expireExposure([...this.members, ...this.enemies, ...this.allies], this.turn);
    for (const a of [...this.members, ...this.activeAllies, ...this.enemies.filter(e => e.pvpOf == null)]) tickTraits(a);   // 替身不跑：本人的狀態在自己那一隊的階段跑（不然一回合跑兩次）
    this.settleAttackNotes(); this.reveal();
  }
  judge() {
    if (this.pvp.winner) return;
    const tdm = RULE('tdm');
    if (tdm) { const sc = this.pvp.score || {A: 0, B: 0}; for (const s of ['A', 'B']) if (sc[s] >= (tdm.target || 100)) { this.pvp.winner = s; this.status = 'won'; this.pvp.log.push(`${s} 隊獲勝（${sc[s]} 分）`); return; } return; }
    for (const s of ['A', 'B']) {
      const dead = this.sides[s].filter(m => m.hp <= 0).length;
      if (dead >= PVP.KILLS || !this.alive(s).length) { this.pvp.winner = this.other(s); this.status = 'won'; this.pvp.log.push(`${this.other(s)} 隊獲勝（拿下 ${dead} 人）`); return; }
    }
  }
  get activeAllies() { const s = this.pvp?.side; return currentAllies(this).filter(a => !s || !a.pvpSide || a.pvpSide === s); }
  // 爆炸：ASH 只傷到操作中的那個人；同隊其他人（不在 enemies、也不是 player）照同一套算
  explode(center, radius, damage, ...rest) {
    const r = super.explode(center, radius, damage, ...rest);
    if (!this.pvp?.side) return r;
    const origin = {x: center.x, y: center.y}, keep = this.player;
    for (const m of this.alive(this.pvp.side)) {
      if (m === keep || distance(origin, m) > radius || !lineOfSight(objectSightGrid(this, origin, m), origin, m, this.barriers, 'blast')) continue;
      this.swap(m); try { this.damagePlayer(Math.max(1, damage - distance(origin, m) * 10), '爆炸', null, true); } finally { this.swap(keep); }
    }
    return r;
  }
  // 戰壕（地圖第二版第二步）：規則就是奇美拉戶外的（chimera-mission.js 的 MissionGame：protectingCover 溝外打溝裡算掩護／牆、
  // executePlayer 走完呼叫 trenchStep、破綻到下次行動為止），只是戰壕在 PVP 地圖的 pvpTrench，不在戶外地圖的 chimeraOutdoor
  trenchAt(x, y) { return this.pvpTrench?.[y]?.[x] || 0; }
  trenchStep(u, from) {
    if (!this.pvpTrench || !u || u.hp <= 0) return;
    const a = this.trenchAt(from.x, from.y), b = this.trenchAt(u.x, u.y); if (Math.abs(a - b) < 2) return;
    u.vaultExposed = true; u.chimeraTrenchExposed = true; applySuppression(u, 3);
    this.log(b > a ? '直接跳進壕溝：至下次行動前被射擊命中 +20，壓制 +3。' : '從壕溝直接爬出來：至下次行動前被射擊命中 +20，壓制 +3。', true);
  }
  // 三倍傷害（像 Quake 的四倍傷害；Alan 2026-10-16）：走上中央那一格撿到；下一次攻擊必定命中、傷害三倍（只算那一個動作；下錨的第二輪不算）。
  // 撿到的人一直到用掉都是暴露的（全場都看得到他在哪）
  pickup() {
    const p = this.player, i = (this.items || []).findIndex(o => o.type === 'pvp_power' && o.x === p.x && o.y === p.y);
    if (i >= 0) { this.items.splice(i, 1); p.pvpPower = true; p.pvpPowerPhases = 0; p.pvpExposed = true; this.log('撿到三倍傷害：下一次攻擊必定命中、傷害三倍（拿著的時候全場都看得到你）。', true); this.pvp.log.push(`第 ${this.pvp.round} 回合：${p.squadId} 撿到三倍傷害`); }
    return super.pickup();
  }
  accuracy(attacker, target) { const r = super.accuracy(attacker, target); return attacker?.pvpPowerActive ? {...r, chance: 100} : r; }
  meleeAccuracy(attacker, target, base) { return attacker?.pvpPowerActive ? 100 : super.meleeAccuracy(attacker, target, base); }
  // 繩索的次數限制（平衡提案）：脫離繩在 ASH 是免費動作，PVP 可以限每人每個階段幾次
  action(type, arg) {
    const lim = RULE('ropePerPhase'), p = this.player;
    if (type !== 'rope' || !lim || !this.pvp?.side) return super.action(type, arg);
    const key = `${this.pvp.round}:${this.pvp.side}`;
    if (p.pvpRopeKey === key && p.pvpRopeN >= lim) return this.fail(`這個階段的繩索用完了（每人每階段 ${lim} 次）`);
    const ok = super.action(type, arg);
    if (ok) { p.pvpRopeN = p.pvpRopeKey === key ? p.pvpRopeN + 1 : 1; p.pvpRopeKey = key; }
    return ok;
  }
  // 待機（防禦姿態）：ASH 給玩家的「直接傷害減半」，替身也照算
  hurt(e, damage, ...rest) { if (rest[0]?.pvpPowerActive && damage > 0) damage *= RULE('powerMult') ?? 3; if (e?.pvpOf != null && e.pvpGuard && damage > 0) damage = Math.max(1, Math.ceil(damage * .5)); return super.hurt(e, damage, ...rest); }
  // 看得到對方嗎：暴露中的到處都看得到；不然要從我（可以探頭）看得到他那一格的中心——他貼著牆探頭不算
  sight(a, b) {
    if (!b?.pvpOf) return super.sight(a, b);
    if (b.pvpExposed) return true;
    if (!super.sight(a, b)) return false;
    const grid = objectSightGrid(this, a, b), bars = this.barriers || [];
    return anchors(grid, a, bars, 'sight').some(o => lineOfSight(grid, o, b, bars, 'sight'));
  }
  // 轉角：開過火（暴露）的人如果打得到你，你也打得到他（代理回報：轉角的人可以單方面一直開火；ASH 原本轉角後「看得到打不到」）
  shotClear(a, b) { return super.shotClear(a, b) || !!(b?.pvpOf && b.pvpExposed && super.shotClear(b, a)); }
  attackStatus(a, b) { const s = super.attackStatus(a, b); return b?.pvpOf && b.pvpExposed && s?.reason === 'target_corner_hidden' && super.shotClear(b, a) ? {...s, reason: null, clear: true} : s; }
  // 暴露只讓對方知道位置；要開火還是要 ASH 原本的視線（含煙霧、黑暗；轉角兩邊都能探頭＝對稱）
  nativeSight(a, b) { return super.sight(a, b); }
  visible(e) { return e?.pvpOf && e.pvpExposed ? true : super.visible(e); }   // 暴露中的不受距離限制
  // 動作做完：開火的暴露；近戰砍了沒死也暴露
  soloPaid(type, arg) {
    const hp0 = new Map(this.enemies.map(e => [e, e.hp])), meleeShot = type === 'fire' && this.weapon?.melee, p = this.player;
    if (type === 'fire' && this.targeted?.pvpExposed && !this.nativeSight(p, this.targeted)) return this.fail('他暴露中，只知道位置；你沒有視線（牆、轉角或煙霧）');
    const quiet = this.weapon?.noFlash && isBlack(this, p);   // 消焰器、站在全黑的地方：開火不暴露
    this.pvpHow = type === 'grenade' ? {grenade: arg?.grenade || p.prepared?.grenade, x: arg?.x, y: arg?.y} : {type, weapon: this.weapon?.name};   // 受傷的人看得到「被什麼打」（看不到是誰）
    const attack = ['fire', 'blindFire', 'bumpMelee', 'hookBlade', 'suppressiveFire', 'grapple'].includes(type), power = attack && p.pvpPower;
    if (power) p.pvpPowerActive = true;
    let ok; try { ok = super.soloPaid(type, arg); } finally { p.pvpPowerActive = false; }
    if (power && ok) { p.pvpPower = false; this.log('三倍傷害用掉了。'); }
    // 下錨：ASH 在一般和慢速階段各打一次（action() 的行動佇列）；soloTurn 不經過佇列，這裡補第二次
    if (ok && RULE('anchorDouble') !== false && skillActive(p, 'anchor') && ['fire', 'blindFire', 'bumpMelee', 'suppressiveFire'].includes(type) && p.hp > 0 && this.status === 'playing' && (type !== 'fire' || this.targeted?.hp > 0)) super.soloPaid(type, arg);
    for (const a of this.allies) a.pvpSide ||= this.pvp.side;   // 這個動作部署出來的無人機、砲台是這一隊的
    this.pvpFlashes = [...(this.pvpFlashes || []), ...this.flashesNow()];
    if (ok) {
      const melee = meleeShot || ['bumpMelee', 'hookBlade', 'grapple'].includes(type);
      if (melee) { if ([...hp0].some(([e, h]) => e.hp < h && e.hp > 0)) p.pvpExposed = true; }
      else if (['fire', 'blindFire', 'launch', 'suppressiveFire'].includes(type) && !quiet) p.pvpExposed = true;
      if (p.pvpExposed) this.pvp.exposures = (this.pvp.exposures || 0) + 1;
    }
    return ok;
  }
  // 這個動作的槍口火光（ASH 的 recordGunFlashes 只看這一步的動畫；PVP 累積整個階段）
  flashesNow() { const keep = this.gunFlashes; recordGunFlashes(this); const now = this.gunFlashes || []; this.gunFlashes = keep; return now; }
  // 撤離、電梯、投降以外的收尾不適用
  descend() { return this.fail('PVP 沒有撤離'); }
  handOver() { return false; }
}
