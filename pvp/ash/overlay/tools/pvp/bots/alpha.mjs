// alpha：比 PvpBot 強一點的 PVP 機器人（pvp/DESIGN.md）。在 ClearBot 的決策前後加上 PVP 的判斷：
// - 威脅模型：替身是 ASH 的 raider，傷害、射程跟真的職業武器差很多；改成對方本人手上的武器（職業是公開的）。
//   黑暗不當掩護（對方可能有夜視、我方開著手電筒）。
// - 威脅全部算「這一回合」（對方整個階段都會打），移動、待機不打折，整體再保守一點（riskAll）。
//   替身現在帶本人的防禦（移動閃避、待機減傷都真的有），但在第二版地圖上量過：照實打折（ALPHA_DEF=0）反而輸得多，保守估計留著。
// - 破片手榴彈：自己算（含隊友、自己、爆炸視線），用 ClearBot 的 enemyValue 單位放進選項跟開槍比（必中 55，常常比開槍好）；
//   ClearBot 原本的手榴彈不看隊友，拿掉。
// - 煙霧：有紅外線的（偵察兵、忍者）把煙丟在對方看得到我方的地方（模擬擋掉的射線）。
// - 集火：血少的、能打死的加分。散開：交戰中的移動避開緊貼隊友的格子。
// - 看不到但剛看過的對方（ghost）照他的武器算威脅。
// 第二版（地圖第二版重練，2026-10-15）：
// - 全隊共享敵情（正式規則）：隊上任何人看得到的對方記在一隊一份的情報裡；這個階段看到的（位置準）放進 view.enemies，
//   威脅、走位、ClearBot 的接近都算他，但開火選項拿掉（只能打自己看得到的）；舊的情報當 ghost（intelAge 個 turn）。
// - 破片：隊友這個階段看到的人也算進落點（beta 也這樣做）；自己看不到人時，夠好的軟性破片也丟（qfrag）。
// - 不離開戰場：沒有敵情時跑太前面的人等隊友、落後的人歸隊（leash）；到過對方開場之後只探索、巡邏地圖中央或隊伍附近（zone）。
// - 地形：矮隔板、戰壕的掩護 ClearBot 本來就從 protectingCover 算；在對方射手面前翻隔板、直接跳進／爬出全身深戰壕扣分（vault）；
//   打碎照亮我方、沒照到對方的鹵素燈（對方有人沒夜視時）；出煙口快噴煙時，接近途中先等（engage，預設關：量過反而輸）。
// 第三版（搶奪點，2026-10-16；alpha-loot.mjs）：箱子先派人往兩側看、看到就派最近的人去開（忍者用免費的脫離繩一回合就到），撿到電漿／精準步槍就換上、當主武器；
//   中央的三倍傷害只派 8 步內的人去撿；拿著的人攻擊選項加分；對方拿著的話威脅三倍。附近 12 格內有已知的對方就不去搶（先打）。
//   陣容固定重裝兵、忍者、狂戰士、工程師（pick）：新規則（壓制會消退）下量過最好。
// 第四版（職業加強 PVP_BUFFS＋光線三等分的地圖，2026-10-16）：
// - 偵察兵的消焰精準步槍（alpha-dark.mjs）：全黑的狙擊點、先待機瞄準再開火（不暴露）、優先打重裝兵、必要時打燈製造黑暗。
// - 自己有夜視、替身沒帶手電筒的人（偵察兵、忍者、加強後的狂戰士）：威脅照對方真的夜視／紅外線算，全黑當掩護摸近（nvSelf）。
// - 工兵（alpha-eng.mjs）：對下錨的重裝兵做自殺無人機、交戰中架定點砲台、其他跟隨無人機。
// - 陣容改成重裝兵、偵察兵、狂戰士、工兵。
// 第五版（打法手冊，Alan 2026-10-16；alpha-manual.mjs）：士兵預警抓偵察兵、重裝兵只在戰壕／掩體後下錨、忍者迷彩＋天誅、
//   偵察兵看穿黑暗煙霧、狂戰士鉤爪拉偵察兵、偵察兵位置不明時迂迴、不拿三倍傷害、自殺無人機只當伏擊。
// 參數在 T（ALPHA_* 環境變數只給實驗用；預設值是測過的最好組合）。
import {PvpBot} from '../match.mjs';
import {WEAPONS, ENEMY_TYPES} from '../../../src/data.js';
import {lineOfSight, distance} from '../../../src/world.js';
import {objectSightGrid} from '../../../src/scenery.js';
import {skillActive} from '../../../src/skills.js';
import {activeTrait} from '../../../src/traits.js';
import {areaCells} from '../../../src/throwables.js';
import {threatAt, enemyValue} from '../../clear-bot/tactics.mjs';
import {damageCost} from '../../clear-bot/combat.mjs';
import {route} from '../../clear-bot/nav.mjs';
import {barrierBetween, vaultable} from '../../../src/barriers.js';
import {ventStage, ventSpraying} from '../../../src/vents.js';
import {ventCells, VENT_TUNING} from '../../../src/vent-map.js';
import {coverEffects} from '../../../src/cover.js';
import {lootIntent, isLootGun, LT} from './alpha-loot.mjs';
import {DarkSniper, isSniper, selfLit} from './alpha-dark.mjs';
import {engineerIntent, ET, trackMunition} from './alpha-eng.mjs';
import {MT, tick, foeRecon, reconSpot, reconUnknown, soldierIntent, afterWarning, marked, anchorSpot, ninjaIntent, ninjaApproach, exposedCost, detourCost, anchorOK, soldierHunt, ninjaHunt, bulwarkTrench, powerRisky, reconLast, overwatch, exposureFn} from './alpha-manual.mjs';
import {exploreRoute} from '../../clear-bot/nav.mjs';
import {captureOn, myPoint, onPoint, CP} from './alpha-capture.mjs';
import {dist} from '../../clear-bot/util.mjs';

const T = {
  threat: process.env.ALPHA_THREAT !== '0',
  frag: process.env.ALPHA_FRAG !== '0',
  focus: process.env.ALPHA_FOCUS !== '0',
  spread: process.env.ALPHA_SPREAD !== '0',
  hold: +(process.env.ALPHA_HOLD ?? 0),
  nv: process.env.ALPHA_NV !== '0',
  fk: +(process.env.ALPHA_FK ?? 999), f2: +(process.env.ALPHA_F2 ?? 999), f1: +(process.env.ALPHA_F1 ?? 999), fnow: +(process.env.ALPHA_FNOW ?? 999),
  light: process.env.ALPHA_LIGHT !== '0',
  def: process.env.ALPHA_DEF !== '0', fast: process.env.ALPHA_FAST === '1',
  smoke: process.env.ALPHA_SMOKE !== '0', smokeMin: +(process.env.ALPHA_SMIN ?? 60), smokeGain: +(process.env.ALPHA_SGAIN ?? 50),
  riskAll: +(process.env.ALPHA_RK ?? 0.3), riskOur: +(process.env.ALPHA_RO ?? 0), riskTheir: +(process.env.ALPHA_RT ?? 0),
  space: +(process.env.ALPHA_SPACE ?? 0),
  planDef: process.env.ALPHA_PLANDEF === '1',
  fragEv: process.env.ALPHA_FEV !== '0', reserve: +(process.env.ALPHA_RES ?? 12),
  ghost: +(process.env.ALPHA_GHOST ?? 0.5),
  ghostAge: +(process.env.ALPHA_GAGE ?? 4),
  cohesion: +(process.env.ALPHA_COH ?? 0),
  // 第二版（新地圖）
  intel: process.env.ALPHA_INTEL !== '0', intelAge: +(process.env.ALPHA_IAGE ?? 6),
  engage: process.env.ALPHA_ENGAGE === '1', engageCost: +(process.env.ALPHA_ECOST ?? 40),
  leash: +(process.env.ALPHA_LEASH ?? 5), zone: +(process.env.ALPHA_ZONE ?? 8),
  vault: +(process.env.ALPHA_VAULT ?? 10), vent: process.env.ALPHA_VENT !== '0',
  lootCalm: +(process.env.ALPHA_LCALM ?? 12),
  powerUse: +(process.env.ALPHA_PUSE ?? 30),
  nvSelf: process.env.ALPHA_NVSELF !== '0',   // 有夜視的（加強後的狂戰士、忍者）也摸黑接近：量過對 beta 從 63% 到 71%
  lamp: process.env.ALPHA_LAMP !== '0', remote: process.env.ALPHA_REMOTE !== '0', qfrag: +(process.env.ALPHA_QFRAG ?? 10), lampMin: +(process.env.ALPHA_LAMPMIN ?? 14), nvReal: process.env.ALPHA_NVREAL === '1',
};

const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TEAM = new WeakMap();
// 隊友看到、我看不到的對方：照 perception 的 enemyView 格式（卡片的數字之後由 patchThreat 換成本人的武器）
function remoteView(e) {
  const def = ENEMY_TYPES[e.type] || {};
  return {id: e.id, type: e.type, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp ?? e.hp, armor: def.armor || 0, range: def.range || 0, damage: def.damage || 0, rounds: def.rounds || 1, rapid: false,
    melee: (def.range || 0) <= 1, boss: false, civilian: false, flying: false, large: false, fast: false, slow: false, mechanical: false, bomber: false, sniper: false, band: null,
    alert: true, charge: false, windup: 0, aim: null, moved: false, disabled: Boolean(e.control?.disabled), elite: false, expendable: false, xp: 0, nv: false, ir: false, mech: false, remote: true, ref: e};
}

export default class Alpha extends PvpBot {
  side() { return this.g.pvp.side; }
  mates() { const g = this.g, me = g.player; return g.alive(this.side()).filter(m => m !== me); }
  // 對方本人（替身 → 本人）
  realOf(e) { const id = e.ref?.pvpOf ?? e.pvpOf; return id ? this.g.unit(id) : null; }

  patchThreat(view) {
    const g = this.g;
    for (const e of view.enemies) {
      const m = this.realOf(e); if (!m) continue;
      const w = WEAPONS[m.weaponBases?.[m.weapon]] || g.weaponAt?.(m.weapon); if (!w) continue;
      e.real = m;
      const anchored = skillActive(m, 'anchor');
      if (w.melee) { e.melee = true; e.range = 1; e.damage = (w.min + w.max) / 2; e.rounds = 1; }
      else if (w.pellets) { e.melee = false; e.range = w.range; e.damage = Math.round((w.min + w.max) / 2 * .8); e.rounds = 1; }
      else { e.melee = false; e.range = w.range; e.rounds = w.burst || 1; e.damage = (w.min + w.max) / 2 * e.rounds * (anchored ? 2 : 1); }
      // 近戰職業手上拿近戰武器時，一回合能走一格再砍：當成「快」
      if (w.melee && T.fast) e.fast = true;
      if (T.def && !w.melee) e.charge = true;   // PVP：我動完，對方整個階段都會打，全部算「這一回合」
      if (m.pvpPower) e.damage *= 3;   // 拿著三倍傷害：下一發必中、三倍
      if (T.nvReal || this.nvSelf) { e.nv = activeTrait(m, 'night_vision'); e.ir = activeTrait(m, 'infrared'); } else if (T.nv) { e.nv = true; e.ir = true; }
    }
  }

  // 一格中心 c 丟破片：對每個人的傷害（照 PvpGame.explode：距離每 1 少 10、要爆炸視線）
  fragAt(view, c, list = view.enemies) {
    const g = this.g, me = g.player, dmg0 = 55 + (me.blastBonus || 0);
    const hit = u => { const d = distance(c, u); if (d > 2) return 0; if (d > 0 && !lineOfSight(objectSightGrid(g, c, u), c, u, g.barriers, 'blast')) return 0; return Math.max(1, dmg0 - d * 10); };
    let value = 0, kills = 0, hits = 0, friendly = 0;
    let ev = 0;
    for (const e of list) { const d = hit(e); if (!d) continue; hits++; value += Math.min(d, e.hp); const v = enemyValue(view, e); if (d >= e.hp) { kills++; value += 70; ev += v * 1.3; } else ev += v * .8 * d / Math.max(1, e.hp); }
    for (const m of [me, ...this.mates()]) { const d = hit(m); if (!d) continue; const hp = m.hp + (m.plates || 0); friendly += Math.min(d, hp) * 1.6 + (d >= hp ? 150 : 0); }
    return {value, kills, hits, friendly, score: value - friendly, ev: ev - friendly};
  }
  fragOption(view, list = view.enemies) {
    const g = this.g, me = view.me;
    if (!(me.grenades.frag > 0)) return null;
    let best = null; const tried = new Set();
    for (const e of list) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 2) continue;
      const c = {x: e.x + dx, y: e.y + dy}, k = c.x + ',' + c.y; if (tried.has(k)) continue; tried.add(k);
      if (distance(c, me) > 5 || g.grid[c.y]?.[c.x] !== 1 || !g.visible(c)) continue;
      const f = this.fragAt(view, c, list); if (!best || f.score > best.f.score) best = {c, f};
    }
    if (!best) return null;
    const {f} = best;
    // 值不值得：炸死一人，或同時打到兩人以上、總傷害夠
    const worth = f.kills >= 1 && f.score > T.fk || f.hits >= 2 && f.score > T.f2 || f.score > T.f1 && me.grenades.frag >= 2;
    if (!worth) {
      if (!T.fragEv) return null;
      // 不夠好到直接丟：用 ClearBot 的單位（enemyValue）放進選項裡，跟開槍比
      let soft = null;
      for (const k of tried) { const [x, y] = k.split(',').map(Number), c = {x, y}; if (distance(c, me) > 5 || g.grid[y]?.[x] !== 1 || !g.visible(c)) continue; const f2 = this.fragAt(view, c, list); if (!soft || f2.ev > soft.f.ev) soft = {c, f: f2}; }
      if (!soft) return null;
      const sc = soft.f.ev - T.reserve * (me.grenades.frag <= 1 ? 1.6 : 1);
      if (sc <= 0) return null;
      return {type: 'grenade', arg: {x: soft.c.x, y: soft.c.y, grenade: 'frag'}, pre: me.prepared.grenade !== 'frag' ? {type: 'prepare', arg: {category: 'grenade', id: 'frag'}} : null, soft: true, score: sc, kills: 0, why: `alpha soft frag ev${sc.toFixed(0)}`};
    }
    return {type: 'grenade', arg: {x: best.c.x, y: best.c.y, grenade: 'frag'}, pre: me.prepared.grenade !== 'frag' ? {type: 'prepare', arg: {category: 'grenade', id: 'frag'}} : null,
      score: f.score, kills: f.kills, why: `alpha frag ${f.kills}k ${f.hits}h v${f.score.toFixed(0)}`};
  }

  // 看不到但最近看過的對方（ghost）：照他本人的武器，從他最後的位置打得到這一格的話算進威脅
  ghostThreat(view, t) {
    const g = this.g; let sum = 0;
    for (const gh of view.ghosts) {
      const age = view.turn - gh.turn; if (age > T.ghostAge) continue;
      const id = String(gh.id).startsWith('px-') ? gh.id.slice(3) : null; const m = id && g.unit(id); if (!m || m.hp <= 0) continue;
      const w = WEAPONS[m.weaponBases?.[m.weapon]]; if (!w) continue;
      const d = distance(gh, t);
      if (w.melee) { if (d <= 2) sum += (w.min + w.max) / 2 * .5; continue; }
      if (d > w.range) continue;
      const k = `${gh.x},${gh.y}>${t.x},${t.y}`; this.lineMemo ||= new Map(); if (this.lineMemo.size > 20000) this.lineMemo.clear();
      let open = this.lineMemo.get(k); if (open === undefined) { const from = {x: gh.x, y: gh.y}, to = {x: t.x, y: t.y}; open = g.sight(from, to) && g.shotClear(from, to); this.lineMemo.set(k, open); }
      if (!open) continue;
      const per = w.pellets ? (w.min + w.max) / 2 * .8 : (w.min + w.max) / 2 * (w.burst || 1) * (skillActive(m, 'anchor') ? 2 : 1);
      sum += per * .7;
    }
    return sum;
  }
  // 煙霧（偵察兵、忍者有紅外線、看得穿）：丟在對方看得到我方的地方，擋掉沒紅外線的對方的射線
  smokeOption(view) {
    const g = this.g, me = view.me, p = g.player;
    if (!(me.grenades.smoke > 0) || !activeTrait(p, 'infrared')) return null;
    const ours = [p, ...this.mates()];
    const shooters = view.enemies.filter(e => e.real && !e.melee && !activeTrait(e.real, 'infrared'));
    if (!shooters.length) return null;
    const lines = () => { let t = 0; for (const e of shooters) for (const u of ours) if (distance(e, u) <= e.range && g.sight(e.ref, u) && g.shotClear(e.ref, u)) t += e.damage * (u === p ? 1.2 : 1); return t; };
    const mine = () => { let t = 0; for (const u of ours) { if (u === p || activeTrait(u, 'infrared')) continue; for (const e of view.enemies) if (g.sight(u, e.ref) && g.shotClear(u, e.ref)) t += 15; } return t; };
    const before = lines(); if (before < T.smokeMin) return null;
    const mine0 = mine(), keep = g.smoke; let best = null; const tried = new Set();
    const cands = [];
    for (const e of shooters) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { if (Math.abs(dx) + Math.abs(dy) > 2) continue; cands.push({x: e.x + dx, y: e.y + dy}); }
    try {
      for (const c of cands) {
        const k = c.x + ',' + c.y; if (tried.has(k)) continue; tried.add(k);
        if (distance(c, me) > 5 || g.grid[c.y]?.[c.x] !== 1 || !g.visible(c)) continue;
        const cells = areaCells(g.grid, c, 2, g.barriers, g).filter(q => g.grid[q.y]?.[q.x] === 1);
        g.smoke = [...keep, {cells, expires: g.turn + 4}];
        const v = before - lines() - (mine0 - mine());
        if (!best || v > best.v) best = {c, v};
      }
    } finally { g.smoke = keep; }
    if (!best || best.v < T.smokeGain) return null;
    return {type: 'grenade', arg: {x: best.c.x, y: best.c.y, grenade: 'smoke'}, pre: me.prepared.grenade !== 'smoke' ? {type: 'prepare', arg: {category: 'grenade', id: 'smoke'}} : null, score: best.v, why: `alpha smoke v${best.v.toFixed(0)}`};
  }
  // ---- 全隊共享敵情（正式規則：隊上任何一個人看得到的，全隊都知道）----
  // 一隊一份（掛在 game 上、照邊分）：每次決策前，隊上每個活人看得到的對方（含暴露中的）記下位置；
  // 記錄過了 intelAge 個 turn（一回合 2 個 turn）或那一格現在全隊看得到但人不在了，就刪掉。
  intel() { let t = TEAM.get(this.g); if (!t) { t = {A: new Map(), B: new Map()}; TEAM.set(this.g, t); } return t[this.side()]; }
  updateIntel() {
    const g = this.g, I = this.intel(), team = g.alive(this.side());
    for (const e of g.enemies) {
      if (e.hp <= 0 || e.pvpOf == null) continue;
      const seen = e.pvpExposed || team.some(u => { const w = WEAPONS[u.weaponBases?.[u.weapon]]; return distance(u, e) <= Math.max(10, w?.range || 0) && g.sight(u, e); });
      if (!seen) continue;
      const m = this.realOf(e), w = m && WEAPONS[m.weaponBases?.[m.weapon]];
      I.set(e.id, {id: e.id, type: e.type, x: e.x, y: e.y, turn: g.turn, hp: e.hp, range: w?.melee ? 1 : (w?.range || 6), melee: !!w?.melee, damage: w ? (w.min + w.max) / 2 * (w.burst || 1) : 20});
    }
    for (const [id, v] of I) {
      const e = g.enemies.find(x => x.id === id);
      if (!e || e.hp <= 0 || g.turn - v.turn > T.intelAge) { I.delete(id); continue; }
      if (v.turn < g.turn && g.visibleTiles?.has(`${v.x},${v.y}`) && !(e.x === v.x && e.y === v.y)) I.delete(id);
    }
  }
  // 知道位置、但不在我自己的視野裡的對方（隊友看到的、剛看過的）
  knownFoes(view) {
    const out = [], have = new Set(view.enemies.map(e => e.id));
    for (const v of this.intel().values()) if (!have.has(v.id)) out.push(v);
    for (const gh of view.ghosts) if (!have.has(gh.id) && !out.some(o => o.id === gh.id) && view.turn - gh.turn <= T.intelAge) out.push(gh);
    return out;
  }
  // 看得到但打不到（或只有隊友看得到）的敵人也當目標：找一格打得到他、最好有掩護、路上少被看到的位置，走過去。
  // 也照出煙口的週期：下一步會被看到，而附近的出煙口一兩個 turn 內就要噴煙，就先等。
  engage(view, foes) {
    const g = this.g, me = view.me, w = me.held; if (!w || !foes.length || me.pinned || me.anchored) return null;
    const melee = w.melee || view.meleeMode;
    const lines = new Map(), lineFrom = (f, q) => { const k = `${f.id}>${q.x},${q.y}`; let v = lines.get(k); if (v === undefined) { const a = {x: f.x, y: f.y}, b = {x: q.x, y: q.y}; v = distance(a, b) <= Math.max(f.range, 3) && g.sight(a, b) && g.shotClear(a, b); lines.set(k, v); } return v; };
    const exposed = q => foes.reduce((n, f) => n + (!f.melee && lineFrom(f, q) ? 1 : 0), 0);
    const ref = f => g.enemies.find(e => e.id === f.id) || f;
    let best = null, count = 0;
    const cost = q => exposed(q) * 3 + (view.danger.get(q.x + ',' + q.y) ? 30 : 0);
    route(view, q => {
      if (++count > 260) return true;
      let s = -Infinity;
      for (const f of foes) {
        const d = distance(q, f);
        if (melee) { if (d === 1) s = Math.max(s, 10); continue; }
        if (d > w.range || !lineFrom({...f, range: 99}, q)) continue;
        const cover = g.protectingCover({x: q.x, y: q.y, traits: me.ref.traits}, ref(f)), fx = coverEffects(cover, q, f);
        s = Math.max(s, 6 + fx.efficiency * 10);
      }
      if (s === -Infinity) return false;
      s -= 0.8 * distance(q, me) + 4 * exposed(q) - (g.trenchAt?.(q.x, q.y) ? 2 : 0);
      if (!best || s > best.s) best = {s, q: {x: q.x, y: q.y}};
      return false;
    }, {cost, maxCost: T.engageCost});
    if (!best) return null;
    if (best.q.x === me.x && best.q.y === me.y) return null;
    const r = route(view, q => q.x === best.q.x && q.y === best.q.y, {cost, maxCost: T.engageCost + 10});
    if (!r) return null;
    const step = {x: me.x + r.first[0], y: me.y + r.first[1]};
    if (T.vent && exposed(step) && !this.isRefused({type: 'wait'}) && (this.ventWaits || 0) < 3) {
      const soon = (g.vents || []).some(v => v.kind !== 'steam' && distance(v, step) <= 5 && !ventSpraying(v, g.turn) && [1, 2].some(k => ventSpraying(v, g.turn + k)));
      if (soon) { this.ventWaits = (this.ventWaits || 0) + 1; return {type: 'wait', why: 'alpha wait for vent'}; }
    }
    this.ventWaits = 0;
    return {type: 'move', arg: r.first, walk: true, why: `alpha engage ${best.q.x},${best.q.y}`};
  }
  // 打碎鹵素燈：燈照亮我方站的地方、卻沒照到對方（對方打亮處沒有 −40），而對方有人沒夜視；黑暗只會讓對方打我方變難。
  // 沒有更好的事做時（自己看不到人）才打；開槍會暴露位置，所以附近有對方射得到我時不打
  lampOption(view, foes) {
    const g = this.g, me = view.me, w = me.held; if (!w || w.melee || w.ammo < (w.shotCost || 1)) return null;
    const side = this.side(), blind = g.alive(g.other(side)).filter(m => !activeTrait(m, 'night_vision')).length; if (!blind) return null;
    const team = g.alive(side);
    let best = null;
    for (const l of g.lamps || []) {
      if (!(l.hp > 0) || distance(l, me) > Math.min(w.range, 8) || !g.visible(l)) continue;
      const lit = team.filter(m => distance(m, l) <= 2).length; if (!lit) continue;
      if (foes.some(f => distance(f, l) <= 3)) continue;
      const s = lit * 8 + blind * 3;
      if (!best || s > best.s) best = {s, l};
    }
    return best && best.s >= T.lampMin && {type: 'fire', target: best.l.id, score: best.s, why: `alpha lamp ${best.l.x},${best.l.y}`};
  }
  decide(view) {
    if (T.intel) {
      this.updateIntel();
      const have = new Set(view.enemies.map(e => e.id)), gh = new Map(view.ghosts.map(x => [x.id, x]));
      for (const v of this.intel().values()) if (!have.has(v.id) && (!gh.has(v.id) || gh.get(v.id).turn < v.turn)) gh.set(v.id, v);
      if (T.remote) {
        // 隊友這個階段看得到的（位置是準的）放進 view.enemies：威脅、走位、接近都算他；開火選項在 stance 拿掉（只能打自己看得到的）
        this.remote = new Set();
        for (const v of this.intel().values()) {
          if (v.turn !== this.g.turn || have.has(v.id)) continue;
          const e = this.g.enemies.find(x => x.id === v.id); if (!e || e.hp <= 0) continue;
          view.enemies.push(remoteView(e)); this.remote.add(e.id); gh.delete(e.id);
        }
        // 自保（ClearBot 的 exposureAt）：交戰中，上一個對方階段之前看到的人（2 turn 內）也當成會打這裡的人算
        if (MT.stale && view.enemies.length) for (const v of this.intel().values()) {
          if (v.turn === this.g.turn || this.g.turn - v.turn > 2 || have.has(v.id) || this.remote.has(v.id)) continue;
          const e = this.g.enemies.find(x => x.id === v.id); if (!e || e.hp <= 0) continue;
          const rv = remoteView(e); rv.x = v.x; rv.y = v.y; rv.stale = true; view.enemies.push(rv); this.remote.add(e.id); gh.delete(e.id); tick('self.staleFoe');
        }
      }
      view.ghosts = [...gh.values()];
    }
    if (!T.light) view.me.black = false;   // 手電筒只會暴露自己：不開
    this.sniper = isSniper(this.g, this.g.player);
    // 自己有夜視（偵察兵、忍者、加強後的狂戰士）、替身不帶手電筒：全黑真的藏得住，威脅照對方真的夜視／紅外線算（摸黑接近）
    const hid = activeTrait(this.g.player, 'night_vision') && !selfLit(this.g, this.g.player);
    this.nvSelf = hid && (this.sniper || T.nvSelf);
    if (T.threat) this.patchThreat(view);
    const hostile = view.enemies.filter(e => !e.civilian);
    this.manualClass();
    // 打法手冊 1：士兵預警（免費）；3：忍者迷彩＋天誅
    { const sw = soldierIntent(this, view, hostile, T.intel ? this.knownFoes(view) : view.ghosts); if (sw && !this.isRefused(sw)) return sw; }
    // 佔領模式（alpha-capture.mjs）：守自己分到的點、往點走；一般的搶箱子、摸近、交互前進都不做
    this.capMode = captureOn(this.g); this.holdPoint = false; this.capPt = null;
    if (this.capMode) { const ci = this.captureDecide(view, hostile); if (ci !== undefined) return ci; return super.decide(view); }
    { const ni = ninjaIntent(this, view, hostile.filter(e => !this.remote?.has(e.id))); if (ni && !this.isRefused(ni)) return ni; }
    // 第二輪：士兵摸近偵察兵、忍者摸到 4 格內、重裝兵找全深戰壕
    {
      const kn = T.intel ? this.knownFoes(view) : view.ghosts; reconLast(this, view);
      this.anchorMeter(view, [...hostile, ...kn]);
      for (const f of [soldierHunt, ninjaHunt, bulwarkTrench]) { const it = f(this, view, hostile, kn); if (it && !this.isRefused(it)) return it; }
    }
    // 工兵帶著自殺無人機：俯衝、摸近比搶箱子優先
    if (ET.on && MT.ambush && this.g.player.character === 'engineer' && this.g.player.productionLines?.some(l => l.blueprint === 'drone_munition')) {
      const ei = engineerIntent(this, view, hostile, T.intel ? this.knownFoes(view) : view.ghosts); if (ei && !this.isRefused(ei)) return ei;
    }
    // 交互掩護前進（小隊長的打法）
    { const ow = overwatch(this, view, hostile, T.intel ? this.knownFoes(view) : view.ghosts); if (ow && !this.isRefused(ow)) return ow; }
    // 搶奪點（alpha-loot.mjs）：自己看不到人時去搶箱子、三倍傷害；撿到的槍換上
    {
      const foes = [...hostile, ...(T.intel ? this.knownFoes(view) : [])];
      const threatened = q => foes.some(f => !f.melee && distance(f, q) <= (f.range || 8) && this.g.sight({x: f.x, y: f.y}, q));
      const noPower = powerRisky(this, view); if (noPower && this.g.items.some(i => i.type === 'pvp_power')) tick('power.skipDecisions');
      const li = lootIntent(this, view, {threatened, fighting: hostile.length > 0, noPower});
      if (li && (li.type === 'weapon' || !hostile.length && !(T.lootCalm && foes.some(f => distance(f, view.me) <= T.lootCalm))) && !this.isRefused(li)) return li;
    }
    if (T.smoke && hostile.length) { const sm = this.smokeOption(view); if (sm && !this.isRefused(sm)) return sm; }
    // 破片：看得到的，加上隊友這個階段看到的（位置是準的：對方在我方的階段不會動）
    const fresh = T.intel && T.qfrag ? [...this.intel().values()].filter(v => v.turn === this.g.turn && !hostile.some(e => e.id === v.id)).map(v => ({...v, hp: this.g.enemies.find(e => e.id === v.id)?.hp ?? v.hp})) : [];
    if (T.frag && (hostile.length || fresh.length)) {
      const fr = this.fragOption(view, [...hostile, ...fresh]);
      if (fr && !this.isRefused(fr) && !fr.soft && (fr.kills || fr.score >= T.fnow)) return fr;
      if (fr && !this.isRefused(fr)) this.pendingFrag = fr; else this.pendingFrag = null;
    } else this.pendingFrag = null;
    // 工兵（alpha-eng.mjs）：照局面做自殺無人機／定點砲台／跟隨無人機；ClearBot 原本的「有廢料就做跟隨無人機」關掉
    if (ET.on && this.g.player.character === 'engineer') {
      if (!this.engCls && this.cls) { const c = this.cls; this.engCls = true; this.cls = {...c, quiet: (v, b) => { const r = c.quiet?.(v, b); if (MT.ambush && r?.type === 'deployUnit' && this.g.player.productionLines?.[r.arg?.line ?? 0]?.blueprint === 'drone_munition') return null; return r?.type === 'buildUnit' ? null : r; }}; }
      const ei = engineerIntent(this, view, hostile, T.intel ? this.knownFoes(view) : view.ghosts); if (ei && !this.isRefused(ei)) return ei;
    }
    // 偵察兵的消焰精準步槍（alpha-dark.mjs）：全黑的狙擊點、瞄準、打燈
    if (this.sniper) { const dk = (this.dark ||= new DarkSniper(this)).decide(view, hostile, T.intel ? this.knownFoes(view) : view.ghosts); if (dk && !this.isRefused(dk)) return dk; }
    // 我自己看不到人，但知道對方在哪（隊友看到、剛看過）：補彈、打燈、去打得到他的位置
    if (!hostile.length && T.intel) {
      const foes = this.knownFoes(view), me = view.me, w = me.held;
      if (foes.length) {
        if (w && !w.melee && !w.tank && w.ammo < w.mag * .5 && w.reserve > 0 && !this.isRefused({type: 'reload'})) return {type: 'reload', why: 'alpha reload (contact)'};
        if (me.meds > 0 && me.hp < me.maxHp * .5 && !this.isRefused({type: 'heal'})) return {type: 'heal', why: 'alpha heal (contact)'};
        if (this.pendingFrag && this.pendingFrag.score >= T.qfrag) return this.pendingFrag;
        if (T.lamp) { const l = this.lampOption(view, foes); if (l && !this.isRefused(l)) return l; }
        if (T.engage) { const en = this.engage(view, foes); if (en && !this.isRefused(en)) return en; }
      }
    }
    return super.decide(view);
  }
  // PvpBot.chooseGoal（match.mjs）照抄，找路加上迂迴的成本（cost）
  baseGoal(view, cost) {
    if (!cost) return super.chooseGoal(view);
    const g = this.g, me = view.me, side = g.pvp.side;
    const ghost = [...(view.ghosts || [])].sort((a, b) => b.turn - a.turn)[0];
    if (ghost && dist(me, ghost) <= 1) this.pvpGhostDone = ghost.turn;
    const fresh = ghost && ghost.turn !== this.pvpGhostDone ? ghost : null;
    let goal = fresh ? {x: fresh.x, y: fresh.y} : null;
    const home = g.pvpGoal?.[side]; if (home && dist(me, home) <= 2) this.pvpReached = true;
    if (!goal && !this.pvpReached) goal = home;
    if (!goal) { const ex = exploreRoute(view, {allyCost: 2, cost}); if (ex) return {type: 'move', arg: ex.first, walk: true, why: 'explore (detour)'}; }
    if (!goal) { const N = g.grid.length; if (!this.patrol || dist(me, this.patrol) <= 1) { for (let k = 0; k < 50; k++) { const x = Math.floor(this.rng() * N), y = Math.floor(this.rng() * N); if (g.grid[y]?.[x] === 1) { this.patrol = {x, y}; break; } } } goal = this.patrol; }
    if (!goal || dist(me, goal) <= 1) return {type: 'wait', why: 'at goal'};
    let r = g.seen[goal.y]?.[goal.x] ? route(view, q => dist(q, goal) <= 1, {allyCost: 2, cost}) : null;
    if (!r) {
      let best = Infinity; const N = g.grid.length;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g.seen[y][x] && g.grid[y][x] === 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.seen[y + dy]?.[x + dx])) best = Math.min(best, dist({x, y}, goal));
      for (const slack of [1, 4, 10]) { if (r || best === Infinity) break; r = route(view, q => !g.seen[q.y]?.[q.x] && g.grid[q.y]?.[q.x] === 1 && dist(q, goal) <= best + slack, {allyCost: 2, unknownGoal: true, cost}); }
      r ||= exploreRoute(view, {allyCost: 2, cost});
    }
    return r ? {type: 'move', arg: r.first, walk: true, why: 'advance (detour)'} : {type: 'wait', why: 'no way'};
  }
  // 打法手冊：包 ClearBot 的職業（忍者的迷彩、黑暗；第一次決策時包一次）
  manualClass() {
    if (this.manualWrapped || !this.cls) return; this.manualWrapped = true;
    const c = this.cls, g = this.g, bot = this;
    if (g.player.character === 'engineer' && ET.on) {
      // ClearBot 的工兵：不自己做跟隨無人機（alpha-eng 決定），自殺無人機不准它隨手部署
      const munDeploy = r => MT.ambush && r?.type === 'deployUnit' && g.player.productionLines?.[r.arg?.line ?? 0]?.blueprint === 'drone_munition';
      this.engCls = true;
      this.cls = {...c, quiet: (v, b) => { const r = c.quiet?.(v, b); if (munDeploy(r)) return null; return r?.type === 'buildUnit' ? null : r; },
        combat: (v, b) => (c.combat?.(v, b) || []).filter(o => !munDeploy(o))};
    }
    if (g.player.character === 'bulwark') this.cls = {...c,
      prepare: (v, b) => { const r = c.prepare?.(v, b); if (r?.arg === 'anchor' && bot.holdPoint && v.me.hp >= v.me.maxHp * .3) return null; return r; },
      quiet: (v, b) => { const r = c.quiet?.(v, b); if (r?.arg === 'anchor' && bot.holdPoint) return null; return r; }};
    if (g.player.character === 'ninja') this.cls = {...c,
      // 3：迷彩留給天誅（ninjaIntent）；ClearBot 原本 6 格內有射手就開，只留貼身時
      prepare: (v, b) => { const r = c.prepare?.(v, b); if (MT.ninja && r?.arg === 'camouflage' && !v.enemies.some(e => !e.civilian && distance(e, v.me) <= 1)) return null; return r; },
      // 4：對方偵察兵活著，黑暗不是近戰的理由
      meleeMode: (v, b) => { if (MT.ir && foeRecon(bot) && v.me.dark && !v.me.camo && !c.meleeMode?.({...v, me: {...v.me, dark: false}}, b)) { tick('ir.ninjaDarkDenied'); return false; } return c.meleeMode?.(v, b); },
      // 4：腳下的煙擋不住偵察兵（紅外線）：偵察兵在射程內就不丟
      combat: (v, b) => { const out = c.combat?.(v, b) || []; if (!MT.ir) return out; const r = v.enemies.find(e => realOf2(g, e)?.character === 'recon' && distance(e, v.me) <= (e.range || 8)); if (!r) return out; return out.filter(o => { const drop = o.type === 'grenade' && /smoke at own feet/.test(o.why || ''); if (drop) tick('ir.smokeDenied'); return !drop; }); }};
  }
  // 重裝兵下錨時每個階段受的傷（自己兩次決策之間＝對方一整個階段），照下錨的位置分
  anchorMeter(view, foes) {
    const g = this.g, p = g.player; if (p.character !== 'bulwark' || this.meterTurn === g.turn) return; this.meterTurn = g.turn;
    const hp = p.hp + (p.plates || 0);
    if (this.anchRec) { tick('anchPh.' + this.anchRec.spot); tick('anchDmg.' + this.anchRec.spot, Math.max(0, this.anchRec.hp - hp)); }
    this.anchRec = skillActive(p, 'anchor') ? {hp, spot: anchorSpot(this, view, foes)} : null;
  }
  // 佔領模式：回傳意圖（或 null＝待機），undefined＝交給一般的戰鬥（super.decide）
  captureDecide(view, hostile) {
    const g = this.g, p = g.player, me = view.me, pt = myPoint(this); this.capPt = pt;
    this.holdPoint = CP.hold && onPoint(this, pt);
    const mine = hostile.filter(e => !this.remote?.has(e.id) && !e.civilian);
    const canHit = !p.pvpSafe && mine.some(e => { const w = me.held; return w && (w.melee ? distance(e, me) <= 1 : distance(e, me) <= w.range && g.shotClear(me, e.ref || e)); });
    if (this.holdPoint) {
      tick('cap.holdDecisions');
      if (canHit) return undefined;
      const w = me.held;
      if (w && !w.melee && !w.tank && w.ammo < w.mag && w.reserve > 0 && !this.isRefused({type: 'reload'})) return {type: 'reload', why: 'alpha hold point: reload'};
      if (me.meds > 0 && me.hp < me.maxHp * .6 && !this.isRefused({type: 'heal'})) return {type: 'heal', why: 'alpha hold point: heal'};
      if (!this.isRefused({type: 'wait'})) return {type: 'wait', why: `alpha hold point ${pt.id}`};
      return undefined;
    }
    if (!pt) return undefined;
    // 忍者：天誅會把自己拉離點；還沒到點、打得到人的時候照用
    if (!p.pvpSafe) { const ni = ninjaIntent(this, view, mine); if (ni && !this.isRefused(ni)) return ni; }
    if (canHit && mine.some(e => distance(e, me) <= 6)) return undefined;   // 近的打得到：先打
    const go = this.goTo(view, pt); if (go && !this.isRefused(go)) { tick('cap.walk'); return go; }
    return undefined;
  }
  // 走向一格（迷霧裡：往離它最近的未探索格），路上少被看到
  goTo(view, goal) {
    const g = this.g, me = view.me; if (me.x === goal.x && me.y === goal.y) return null;
    const foes = [...view.enemies, ...(T.intel ? this.knownFoes(view) : [])], ex = foes.length ? exposureFn(this, foes) : null;
    const cost = ex ? q => ex(q) * 2 : null;
    const occ = g.enemies.some(e => e.hp > 0 && e.x === goal.x && e.y === goal.y);
    const at = q => occ ? dist(q, goal) <= 1 : q.x === goal.x && q.y === goal.y;
    let r = g.seen[goal.y]?.[goal.x] ? route(view, at, {allyCost: 2, cost, maxCost: 200}) : null;
    if (!r) {
      let best = Infinity; const N = g.grid.length;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g.seen[y][x] && g.grid[y][x] === 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.seen[y + dy]?.[x + dx])) best = Math.min(best, dist({x, y}, goal));
      for (const slack of [1, 4, 10]) { if (r || best === Infinity) break; r = route(view, q => !g.seen[q.y]?.[q.x] && g.grid[q.y]?.[q.x] === 1 && dist(q, goal) <= best + slack, {allyCost: 2, unknownGoal: true, cost}); }
      r ||= route(view, q => dist(q, goal) <= 1, {allyCost: 2, maxCost: 200});
    }
    return r ? {type: 'move', arg: r.first, walk: true, why: `alpha to point ${goal.x},${goal.y}`} : null;
  }
  // 統計（打法手冊各條觸發幾次、效果）
  act(intent) {
    const g = this.g, p = g.player, view = this.view;
    const tgt = intent.target !== undefined ? g.enemies.find(e => e.id === intent.target) : null, hp0 = tgt ? tgt.hp : 0;
    let anch = null;
    if (intent.type === 'skill' && intent.arg === 'anchor' && !skillActive(p, 'anchor') && view) anch = anchorSpot(this, view, [...view.enemies, ...(T.intel ? this.knownFoes(view) : [])]);
    const pw0 = !!p.pvpPower, recUnk = view ? reconUnknown(this, view) : false;
    const ok = super.act(intent);
    if (!ok) return ok;
    const vic = tgt ? realOf2(g, tgt)?.character : null, dmg = tgt ? Math.max(0, hp0 - Math.max(0, tgt.hp)) : 0;
    if (anch) tick('anchor.' + anch);
    if (intent.type === 'skill' && intent.arg === 'early_warning') afterWarning(this);
    if (intent.type === 'skill' && intent.arg === 'camouflage') tick('camo.on');
    if (intent.type === 'hookBlade') { tick('tenchu.n'); tick('tenchu.dmg', dmg); if (tgt && tgt.hp <= 0) tick('tenchu.kill'); if (vic === 'recon') { tick('tenchu.recon'); tick('tenchu.reconDmg', dmg); } }
    if (intent.type === 'skill' && intent.arg === 'grapple') { tick('grapple.n'); tick('grapple.dmg', dmg); if (tgt && tgt.hp <= 0) tick('grapple.kill'); if (vic === 'recon') { tick('grapple.recon'); tick('grapple.reconDmg', dmg); } }
    if (tgt && intent.type !== 'hookBlade' && marked(tgt) && dmg > 0) { tick('ew.focusHits'); tick('ew.focusDmg', dmg); if (tgt.hp <= 0) tick('ew.focusKills'); }
    if (/^(fallback|retreat)/.test(intent.why || '')) tick('self.' + intent.why.split(' ')[0]);
    if (/^continue (fallback|retreat)/.test(intent.why || '')) tick('self.continue');
    if (/^away from/.test(intent.why || '')) tick('self.kite');
    if (!pw0 && p.pvpPower) { tick('power.picked'); if (recUnk) tick('power.pickedReconUnknown'); }
    if (intent.type === 'move' && foeRecon(this) && view) { tick('move.reconAlive'); if (recUnk) { tick('move.reconUnknown'); if (exposedCost(this, p, true) >= MT.detourW * .7) tick('move.openLit'); } }
    if (p.character === 'engineer') trackMunition(this, intent);
    return ok;
  }
  mainWeapon(view) { const g = this.g, p = g.player, s = (p.owned || []).find(x => isLootGun(g.weaponAt(x)?.id)); return s !== undefined ? s : super.mainWeapon(view); }
  // 沒有敵情時：照 PvpBot（剛看過的 → 對方開場），但探索、巡邏限制在地圖中央或隊伍附近；也不要一個人跑太前面
  chooseGoal(view) {
    if (this.capMode && this.capPt) { if (this.holdPoint) return {type: 'wait', why: 'alpha hold point (quiet)'}; const go = this.goTo(view, this.capPt); if (go) return go; }
    const g = this.g, me = view.me, side = this.side(), N = g.grid.length, c = (N - 1) / 2;
    const foes = T.intel ? this.knownFoes(view) : view.ghosts;
    const mates = this.mates(), home = g.pvpGoal?.[side];
    const cost = detourCost(this, view);   // 打法手冊 6：偵察兵位置不明，迂迴
    if (home && distance(me, home) <= 2) this.pvpReached = true;
    if (!foes.length && T.leash && mates.length) {
      const cx = mates.reduce((a, m) => a + m.x, 0) / mates.length, cy = mates.reduce((a, m) => a + m.y, 0) / mates.length, cen = {x: Math.round(cx), y: Math.round(cy)};
      if (distance(me, cen) > T.leash) {
        const target = this.pvpReached ? {x: c, y: c} : home;
        const ahead = target && distance(me, target) < mates.reduce((a, m) => a + distance(m, target), 0) / mates.length - 2;
        if (ahead && (this.leashWaits || 0) < 3 && !this.isRefused({type: 'wait'})) { this.leashWaits = (this.leashWaits || 0) + 1; return {type: 'wait', why: 'alpha leash'}; }
        if (!ahead) { const r = route(view, q => distance(q, cen) <= 2, {allyCost: 2, maxCost: 60, cost}); if (r) { this.leashWaits = 0; return {type: 'move', arg: r.first, walk: true, why: 'alpha regroup'}; } }
      }
    }
    this.leashWaits = 0;
    if (foes.length || !this.pvpReached || !T.zone) return this.baseGoal(view, cost);
    // 探索：只找中央（zone 格內）或隊伍附近沒看過的格子
    const team = g.alive(side), inZone = q => Math.max(Math.abs(q.x - c), Math.abs(q.y - c)) <= T.zone || team.some(m => distance(m, q) <= 4);
    const ex = route(view, q => !g.seen[q.y]?.[q.x] && g.grid[q.y]?.[q.x] === 1 && inZone(q), {allyCost: 2, maxCost: 120, unknownGoal: true, cost});
    if (ex) return {type: 'move', arg: ex.first, walk: true, why: 'alpha explore (zone)'};
    if (!this.patrol || distance(me, this.patrol) <= 1) {
      this.patrol = null; const R = Math.max(2, Math.round(T.zone * .6));
      for (let k = 0; k < 50; k++) { const x = Math.round(c - R + this.rng() * 2 * R), y = Math.round(c - R + this.rng() * 2 * R); if (g.grid[y]?.[x] === 1 && g.seen[y]?.[x]) { this.patrol = {x, y}; break; } }
    }
    if (!this.patrol) return this.baseGoal(view, cost);
    const r = route(view, q => distance(q, this.patrol) <= 1, {allyCost: 2, maxCost: 120, cost});
    return r ? {type: 'move', arg: r.first, walk: true, why: 'alpha patrol'} : {type: 'wait', why: 'alpha no way'};
  }
}

// ClearBot 的 combatOptions 在 decide 裡呼叫：用 pickBest 前的過濾太深，改成包一層 stance（opts 會傳進來）
const baseStance = Object.getPrototypeOf(Alpha.prototype).stance;
Alpha.prototype.stance = function (view, opts) {
  if (this.remote?.size) for (let i = opts.length - 1; i >= 0; i--) { const o = opts[i]; if (this.remote.has(o.enemy) || this.remote.has(o.target) || this.remote.has(o.then?.target)) opts.splice(i, 1); }
  // 佔領模式：站在點上不移動（只打、待機、下錨）；還沒到點的移動加上「離點更近」
  if (this.capMode && this.capPt) {
    const me = view.me, pt = this.capPt;
    if (this.holdPoint) { for (let i = opts.length - 1; i >= 0; i--) { const o = opts[i]; if (o.type === 'move' && !o.target || o.plan || o.type === 'rope' || o.type === 'skill' && o.arg === 'grapple') opts.splice(i, 1); } }
    else for (const o of opts) if (o.type === 'move' && !o.target && Array.isArray(o.arg)) { const to = {x: me.x + o.arg[0], y: me.y + o.arg[1]}; o.score += CP.pull * (distance(me, pt) - distance(to, pt)); }
  }
  // 拿掉原本不看隊友的手榴彈，換成自己的
  for (let i = opts.length - 1; i >= 0; i--) if (opts[i].type === 'grenade' && T.frag) opts.splice(i, 1);
  if (this.pendingFrag) opts.push(this.pendingFrag);
  // 拿著三倍傷害：攻擊必中、三倍，攻擊選項加分（挑血多、能打死的）
  if (this.g.player.pvpPower && T.powerUse) for (const o of opts) if (o.attack && o.enemy) o.score += T.powerUse;
  if (T.focus) for (const o of opts) {
    if (!o.attack || !o.enemy) continue;
    const e = view.enemies.find(x => x.id === o.enemy); if (!e) continue;
    const hurt = 1 - e.hp / Math.max(1, e.maxHp);
    o.score += 12 * hurt + 25 * (o.kill || 0);
    if (MT.ew && marked(e)) o.score += MT.focusMark;   // 打法手冊 1：集火被預警標到的人
  }
  {
    const g = this.g, me = view.me, p = g.player;
    // 打法手冊 2：重裝兵只在戰壕裡、或面前的射手都隔著掩體時下錨
    if (MT.anchor && p.character === 'bulwark' && !me.anchored && !this.holdPoint) {
      const foes = [...view.enemies, ...(T.intel ? this.knownFoes(view) : [])];
      for (let i = opts.length - 1; i >= 0; i--) if (opts[i].type === 'skill' && opts[i].arg === 'anchor') {
        const spot = anchorSpot(this, view, foes);
        if (!anchorOK(spot)) { opts.splice(i, 1); tick('anchor.refused.' + spot); }
      }
    }
    // 打法手冊 5：狂戰士的鉤爪優先拉偵察兵；偵察兵看得到、還拉不到的格子扣分
    if (MT.grab && p.character === 'berserker') {
      for (const o of opts) if (o.type === 'skill' && o.arg === 'grapple' && realOf2(g, view.enemies.find(e => e.id === o.target))?.character === 'recon') o.score += MT.grabBonus;
      const r = reconSpot(this, view);
      if (r) for (const o of opts) if (o.type === 'move' && !o.target && Array.isArray(o.arg)) {
        const to = {x: me.x + o.arg[0], y: me.y + o.arg[1]}, d = distance(to, r);
        if (d > 5 && d <= 12 && g.sight({x: r.x, y: r.y}, to)) o.score -= 10;
      }
    }
    // 打法手冊 3：忍者往偵察兵 4 格內、它看不到的地方靠
    ninjaApproach(this, view, opts);
    // 打法手冊 6：偵察兵位置不明時，交戰中的移動也避開開闊、亮的格子
    if (MT.detour && reconUnknown(this, view)) for (const o of opts) if (o.type === 'move' && !o.target && Array.isArray(o.arg)) o.score -= 2 * exposedCost(this, {x: me.x + o.arg[0], y: me.y + o.arg[1]}, true);
  }
  if (T.spread) {
    const mates = this.mates();
    for (const o of opts) if (o.type === 'move' && !o.target && Array.isArray(o.arg)) {
      const to = {x: view.me.x + o.arg[0], y: view.me.y + o.arg[1]};
      const near = mates.filter(m => distance(m, to) <= 1).length;
      o.score -= near * 6;
    }
  }
  // 翻矮隔板、直接跳進／爬出全身深戰壕：到下次行動前容易被打中。附近有對方的射手時扣分（走台階、繞過去）
  if (T.vault) {
    const g = this.g, me = view.me, foes = [...view.enemies, ...(T.intel ? this.knownFoes(view) : [])];
    for (const o of opts) if (o.type === 'move' && !o.target && Array.isArray(o.arg)) {
      const to = {x: me.x + o.arg[0], y: me.y + o.arg[1]}, b = barrierBetween(g.barriers, me, to);
      const jump = (b && vaultable(b)) || Math.abs((g.trenchAt?.(me.x, me.y) || 0) - (g.trenchAt?.(to.x, to.y) || 0)) >= 2;
      if (jump && foes.some(f => !f.melee && distance(f, to) <= (f.range || 8) + 1)) o.score -= T.vault;
    }
  }
  // PVP 的替身每階段重建：移動不會閃避、待機也不減傷（替身沒有 moved、guard）。把 ClearBot 對移動、待機的減傷估計拿掉
  if (T.def) {
    const g = this.g, me = view.me, cache = new Map();
    const real = t => { const k = t.x + ',' + t.y; let v = cache.get(k); if (v === undefined) { v = damageCost(me, threatAt(view, t, {})); cache.set(k, v); } return v; };
    for (const o of opts) {
      if (o.plan) { if (T.planDef && Array.isArray(o.arg)) { const to = {x: me.x + o.arg[0], y: me.y + o.arg[1]}; o.score += damageCost(me, threatAt(view, to, {moved: true}), {soonWeight: .2}) - real(to); } continue; }
      if (o.type === 'move' && !o.target && Array.isArray(o.arg)) { const to = {x: me.x + o.arg[0], y: me.y + o.arg[1]}; o.score += damageCost(me, threatAt(view, to, {moved: true})) - real(to); }
      else if (o.type === 'wait') o.score += damageCost(me, threatAt(view, me, {guard: true})) - real(me);
    }
    const side = this.side(), ourDead = g.sides[side].filter(m => m.hp <= 0).length, theirDead = g.sides[g.other(side)].filter(m => m.hp <= 0).length;
    const k = T.riskAll + T.riskOur * ourDead - T.riskTheir * theirDead;
    if (k) for (const o of opts) {
      if (o.plan) continue;
      const to = o.type === 'move' && !o.target && Array.isArray(o.arg) ? {x: me.x + o.arg[0], y: me.y + o.arg[1]} : me;
      o.score -= k * real(to);
    }
  }
  if (T.ghost) {
    const me = view.me, here = this.ghostThreat(view, me);
    for (const o of opts) {
      const to = o.type === 'move' && !o.target && Array.isArray(o.arg) ? {x: me.x + o.arg[0], y: me.y + o.arg[1]} : me;
      const gt = to === me ? here : this.ghostThreat(view, to);
      o.score -= T.ghost * gt;
    }
  }
  // 佔領模式：往點走的人，血還夠就不照 ClearBot 退後（倒下只是回開場，退後一樣在浪費回合）
  if (this.capMode && this.capPt && !this.holdPoint && CP.brave && view.me.hp >= view.me.maxHp * CP.brave) { this.plan = null; for (let i = opts.length - 1; i >= 0; i--) if (opts[i].plan) opts.splice(i, 1); tick('cap.noRetreat'); return null; }
  const tac = baseStance.call(this, view, opts);
  if (this.holdPoint && tac?.type === 'move' && !tac.target) return null;
  return tac;
};

// 陣容（duel.mjs：export pick(seed, defaultComp) 回傳 4 個不重複的職業；回傳 null 就用預設那一組）
// ALPHA_PICK=職業,職業,…（固定一組）或 ALPHA_PICK=keep（照預設）只給實驗用
export function pick(seed, comp) {
  const env = process.env.ALPHA_PICK;
  if (env === 'keep') return null;
  if (env) return env.split(',');
  return PICK ? PICK(seed, comp) : null;
}
const realOf2 = (g, e) => { const id = e?.ref?.pvpOf ?? e?.pvpOf; return id != null ? g.unit(id) : null; };
const PICK = () => ['bulwark', 'recon', 'berserker', 'engineer'];   // 加強版規則（PVP_BUFFS）、第三版光線地圖上量過最好：忍者沒了免費脫離繩，換偵察兵（消焰精準步槍）
