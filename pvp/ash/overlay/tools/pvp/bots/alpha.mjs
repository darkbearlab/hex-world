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
      if (T.nvReal) { e.nv = activeTrait(m, 'night_vision'); e.ir = activeTrait(m, 'infrared'); } else if (T.nv) { e.nv = true; e.ir = true; }
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
      }
      view.ghosts = [...gh.values()];
    }
    if (!T.light) view.me.black = false;   // 手電筒只會暴露自己：不開
    if (T.threat) this.patchThreat(view);
    const hostile = view.enemies.filter(e => !e.civilian);
    if (T.smoke && hostile.length) { const sm = this.smokeOption(view); if (sm && !this.isRefused(sm)) return sm; }
    // 破片：看得到的，加上隊友這個階段看到的（位置是準的：對方在我方的階段不會動）
    const fresh = T.intel && T.qfrag ? [...this.intel().values()].filter(v => v.turn === this.g.turn && !hostile.some(e => e.id === v.id)).map(v => ({...v, hp: this.g.enemies.find(e => e.id === v.id)?.hp ?? v.hp})) : [];
    if (T.frag && (hostile.length || fresh.length)) {
      const fr = this.fragOption(view, [...hostile, ...fresh]);
      if (fr && !this.isRefused(fr) && !fr.soft && (fr.kills || fr.score >= T.fnow)) return fr;
      if (fr && !this.isRefused(fr)) this.pendingFrag = fr; else this.pendingFrag = null;
    } else this.pendingFrag = null;
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
  // 沒有敵情時：照 PvpBot（剛看過的 → 對方開場），但探索、巡邏限制在地圖中央或隊伍附近；也不要一個人跑太前面
  chooseGoal(view) {
    const g = this.g, me = view.me, side = this.side(), N = g.grid.length, c = (N - 1) / 2;
    const foes = T.intel ? this.knownFoes(view) : view.ghosts;
    const mates = this.mates(), home = g.pvpGoal?.[side];
    if (home && distance(me, home) <= 2) this.pvpReached = true;
    if (!foes.length && T.leash && mates.length) {
      const cx = mates.reduce((a, m) => a + m.x, 0) / mates.length, cy = mates.reduce((a, m) => a + m.y, 0) / mates.length, cen = {x: Math.round(cx), y: Math.round(cy)};
      if (distance(me, cen) > T.leash) {
        const target = this.pvpReached ? {x: c, y: c} : home;
        const ahead = target && distance(me, target) < mates.reduce((a, m) => a + distance(m, target), 0) / mates.length - 2;
        if (ahead && (this.leashWaits || 0) < 3 && !this.isRefused({type: 'wait'})) { this.leashWaits = (this.leashWaits || 0) + 1; return {type: 'wait', why: 'alpha leash'}; }
        if (!ahead) { const r = route(view, q => distance(q, cen) <= 2, {allyCost: 2, maxCost: 60}); if (r) { this.leashWaits = 0; return {type: 'move', arg: r.first, walk: true, why: 'alpha regroup'}; } }
      }
    }
    this.leashWaits = 0;
    if (foes.length || !this.pvpReached || !T.zone) return super.chooseGoal(view);
    // 探索：只找中央（zone 格內）或隊伍附近沒看過的格子
    const team = g.alive(side), inZone = q => Math.max(Math.abs(q.x - c), Math.abs(q.y - c)) <= T.zone || team.some(m => distance(m, q) <= 4);
    const ex = route(view, q => !g.seen[q.y]?.[q.x] && g.grid[q.y]?.[q.x] === 1 && inZone(q), {allyCost: 2, maxCost: 120, unknownGoal: true});
    if (ex) return {type: 'move', arg: ex.first, walk: true, why: 'alpha explore (zone)'};
    if (!this.patrol || distance(me, this.patrol) <= 1) {
      this.patrol = null; const R = Math.max(2, Math.round(T.zone * .6));
      for (let k = 0; k < 50; k++) { const x = Math.round(c - R + this.rng() * 2 * R), y = Math.round(c - R + this.rng() * 2 * R); if (g.grid[y]?.[x] === 1 && g.seen[y]?.[x]) { this.patrol = {x, y}; break; } }
    }
    if (!this.patrol) return super.chooseGoal(view);
    const r = route(view, q => distance(q, this.patrol) <= 1, {allyCost: 2, maxCost: 120});
    return r ? {type: 'move', arg: r.first, walk: true, why: 'alpha patrol'} : {type: 'wait', why: 'alpha no way'};
  }
}

// ClearBot 的 combatOptions 在 decide 裡呼叫：用 pickBest 前的過濾太深，改成包一層 stance（opts 會傳進來）
const baseStance = Object.getPrototypeOf(Alpha.prototype).stance;
Alpha.prototype.stance = function (view, opts) {
  if (this.remote?.size) for (let i = opts.length - 1; i >= 0; i--) { const o = opts[i]; if (this.remote.has(o.enemy) || this.remote.has(o.target) || this.remote.has(o.then?.target)) opts.splice(i, 1); }
  // 拿掉原本不看隊友的手榴彈，換成自己的
  for (let i = opts.length - 1; i >= 0; i--) if (opts[i].type === 'grenade' && T.frag) opts.splice(i, 1);
  if (this.pendingFrag) opts.push(this.pendingFrag);
  if (T.focus) for (const o of opts) {
    if (!o.attack || !o.enemy) continue;
    const e = view.enemies.find(x => x.id === o.enemy); if (!e) continue;
    const hurt = 1 - e.hp / Math.max(1, e.maxHp);
    o.score += 12 * hurt + 25 * (o.kill || 0);
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
  return baseStance.call(this, view, opts);
};
