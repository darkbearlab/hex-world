// beta：團隊協調的 PVP 機器人（pvp/DESIGN.md）。每次決策替整隊做一個計畫（beta-team.mjs），每個人再照計畫調整 ClearBot 的選項分數：
//   - 威脅模型換成真的職業武器（對方的替身在 ASH 裡都是「破口突擊兵」的卡片：射程 5、一輪 21，比真的步槍、輕機槍、下錨雙射弱很多）。
//   - 全隊共享視野（正式規則）：隊上任何人看得到的敵人全隊都知道，算進威脅、走位、接近、手榴彈；開火只打自己看得到的（看不到的不給開火選項）。
//   - 整隊共用的敵人記憶：最後看到的位置（貼牆、下錨、煙裡看不到的人也記得），沒看到人時整隊往那裡去（不探索角落、不亂巡邏）。
//   - 破片手榴彈：整隊的記憶裡挑最好的落點，包括看不到但剛剛還在那裡的人（落點看得到就能丟），避開自己人。
//   - 集火：整隊挑同一個目標（打得到的人多、血少、威脅大）。
//   - 隊形：交火時不擠進隊友的手榴彈範圍；推進時跑太前面的人等後面的人（出煙口在噴煙時不等，趁煙推進）。
//   - 遠距離接近：看得到的敵人在 ClearBot 找開火位置的範圍外（14 步）也往那裡走，不在原地亂晃。
//   - 地形（地圖第二版）：矮隔板、戰壕當掩護；不在敵人面前翻隔板、直接跳進跳出全身深的戰壕；噴煙時往前；打碎照著自己人的鹵素燈；領先時守戰壕。
//   - 快死：往看不到敵人的格子撤、在看不到的地方補血。
import {PvpBot} from '../match.mjs';
import {teamPlan, patchView, fragChoice, teamSight, threatOf} from './beta-team.mjs';
import {stepFlaw, trenchAt, cloudAt, sprayingVents, hasNV, lampLights} from './beta-terrain.mjs';
import {lineOpen, threatAt} from '../../clear-bot/tactics.mjs';
import {route, exploreRoute} from '../../clear-bot/nav.mjs';
import {TUNING as CB} from '../../clear-bot/combat.mjs';
import {dist, key} from '../../clear-bot/util.mjs';
import {ENEMY_TYPES} from '../../../src/data.js';
import {activeTrait} from '../../../src/traits.js';
import {coverEffects} from '../../../src/cover.js';
import {objectives, markOpened, markDone, ropeToward, hasLoot, isLoot, OBJ_TUNING} from './beta-objective.mjs';
import {WEAPONS} from '../../../src/data.js';
import {weaponStats} from '../../../src/weapons.js';
import {isBlack} from '../../../src/lighting.js';
import {incoming} from '../../clear-bot/tactics.mjs';
import {engCombat, engQuiet} from './beta-engineer.mjs';
import {quietSlot, findNest, lampShootable, seesBlack, approachTiles, SNIPE_TUNING} from './beta-sniper.mjs';
const ambushStates = new WeakMap();
const ambushState = (g, side) => { let a = ambushStates.get(g); if (!a) { a = {A: {}, B: {}}; ambushStates.set(g, a); } return a[side]; };

export const TUNING = {quietFrag: 10, fragReserve: 12, spacing: 4, spacingCalm: 1.5, hurt: 15,
  cover: 5, flaw: 10, cloud: 5, far: 6, lamp: 14, trenchHold: 10, ghostTurns: 8, ambushRounds: +(globalThis.process?.env?.BETA_AMBUSH || 0), fox: +(globalThis.process?.env?.BETA_FOX || 4), soonWeight: +(globalThis.process?.env?.BETA_SW || 1)};
export const BETA_STATS = {};
const OFF = new Set((globalThis.process?.env?.BETA_OFF || '').split(','));   // 實驗用：關掉某些改動比較   // 實驗用（beta-analyze.mjs，BETA_STATS=1）
const unitOf = (g, id) => String(id).startsWith('px-') ? g.unit(String(id).slice(3)) : null;
// 隊友看得到、我自己看不到的敵人：照 perception 的 enemyView 格式（只用公開的卡片和位置）
function remoteView(g, e) {
  const def = ENEMY_TYPES[e.type] || {};
  return {id: e.id, type: e.type, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp ?? e.hp, armor: def.armor || 0, range: def.range || 0, damage: def.damage || 0, rounds: def.rounds || 1, rapid: false,
    melee: (def.range || 0) <= 1, boss: false, civilian: false, flying: false, large: false, fast: false, slow: activeTrait(e, 'slow'), mechanical: !!def.mechanical, bomber: false, sniper: false, band: null,
    alert: true, charge: false, windup: 0, aim: null, moved: !!e.moved, disabled: !!e.control?.disabled, elite: false, expendable: false, xp: 0,
    nv: activeTrait(e, 'night_vision'), ir: activeTrait(e, 'infrared'), mech: !!def.mechanical, ref: e, remote: true};
}
export default class Beta extends PvpBot {
  act(intent) {
    if (process.env.BETA_STATS) { const k = `${this.g.player.character}:${intent.type}${intent.type === 'skill' ? ':' + intent.arg : intent.type === 'grenade' ? ':' + (intent.pre?.arg?.id || this.g.player.prepared?.grenade) : ''}:${(intent.why || '').split(' ')[0]}`; BETA_STATS[k] = (BETA_STATS[k] || 0) + 1; }
    if (process.env.BETA_TRACE) { const p = this.g.player; console.log(`   r${this.g.pvp.round} ${p.squadId}${p.character.slice(0, 4)}(${p.x},${p.y}) hp${p.hp}+${p.plates || 0} ${intent.type} ${JSON.stringify(intent.arg ?? intent.target ?? '')} ${intent.why || ''} ${intent.score?.toFixed?.(1) ?? ''}`); }
    if (process.env.BETA_STATS && this.team?.memory?.size) {   // 量測用（只在實驗時讀真實位置）：交火後離最近的敵人多遠
      const p = this.g.player, foes = this.g.alive(this.g.other(this.g.pvp.side)), d = Math.min(...foes.map(f => dist(f, p)));
      const k = d > 16 ? 'Z:far>16' : d > 10 ? 'Z:mid11-16' : 'Z:near<=10'; BETA_STATS[k] = (BETA_STATS[k] || 0) + 1;
    }
    const g = this.g, p = g.player, at = intent.type === 'move' && Array.isArray(intent.arg) ? {x: p.x + intent.arg[0], y: p.y + intent.arg[1]} : null;
    const line = intent.type === 'deployUnit' ? p.productionLines?.[intent.arg?.line]?.blueprint : null;
    const ok = super.act(intent);
    if (ok !== false && process.env.BETA_STATS && (line || intent.type === 'buildUnit')) { const k = `ENG:${intent.type}:${line || intent.arg?.blueprint}`; BETA_STATS[k] = (BETA_STATS[k] || 0) + 1; }
    if (ok !== false && intent.type === 'openContainer') markOpened(g, intent.arg);
    if (ok !== false && process.env.BETA_STATS && (intent.type === 'openContainer' || intent.type === 'rope' || intent.type === 'takeWeapon')) BETA_STATS[`OBJ:${intent.type}:${p.character}`] = (BETA_STATS[`OBJ:${intent.type}:${p.character}`] || 0) + 1;
    // 走進看不到的敵人（貼牆的）：ASH 回「被敵人擋住」——那裡有人，記進整隊的記憶
    if (ok === false && at && this.team) { const e = g.enemies.find(x => x.hp > 0 && x.x === at.x && x.y === at.y && x.pvpOf != null); if (e) { const r = this.team.memory.get(e.id); if (r) Object.assign(r, {x: at.x, y: at.y, turn: g.turn, checked: false}); } }
    if (ok === false && process.env.BETA_STATS) { const k = `REFUSED:${intent.type}:${(intent.why || '').split(' ')[0]}:${g.refusal?.text || g.logs?.[0]?.text || '?'}`; BETA_STATS[k] = (BETA_STATS[k] || 0) + 1; }
    return ok;
  }
  // ClearBot 的「下一回合才挨打」打了 .55 折；PVP 裡我做完動作，對方整個階段都會開火，接近全額（只在 beta 決策的時候換，另一隊不受影響）
  decide(view) {
    const keep = CB.soonWeight; CB.soonWeight = TUNING.soonWeight;
    try { return this.decideTeam(view); } finally { CB.soonWeight = keep; }
  }
  decideTeam(view) {
    const g = this.g;
    // 全隊共享視野：隊友看得到的敵人也算「看得到」（威脅、走位）；整隊的記憶取代自己的殘影
    const sight = teamSight(g), mine = new Set(view.enemies.map(e => e.id));
    if (!OFF.has('remote')) for (const e of sight.values()) if (!mine.has(e.id)) { const r = remoteView(g, e); view.enemies.push(r); view.occupied.add(key(r)); }
    patchView(view);
    this.team = teamPlan(g, view, this);
    // 偵察兵的消焰精準步槍：找全黑的狙擊點（beta-sniper.mjs）
    this.qslot = OFF.has('snipe') ? null : quietSlot(view.me.ref);
    // 埋伏（隊上有消焰槍、還沒碰到人、前 ambushRounds 回合）：整隊在自己開場附近等，偵察兵在看得到來路的黑暗裡（不去搶東西）
    const amb = this.ambush(view);
    if (amb) { this.team.goal = amb; this.team.hold.clear(); }
    if (!OFF.has('snipe')) this.team.noJob = new Set(this.team.members.filter(m => quietSlot(m) != null));   // 狙擊手不去搶東西（三倍傷害在中央）
    this.team.obj = objectives(g, this.team);
    this.job = this.team.obj.get(view.me.ref) || null;
    if (this.job) for (const m of this.team.obj.keys()) this.team.hold.delete(m);
    if (!OFF.has('ghosts')) view.ghosts = [...this.team.memory.values()].filter(r => !r.seen && !r.ally && g.turn - r.turn <= TUNING.ghostTurns).map(r => ({...r, type: 'pvp-proxy-0', boss: false}));
    this.frag = null;
    // 工兵：三種單位照整隊計畫挑（beta-engineer.mjs），取代 ClearBot 的工兵類別
    if (view.me.character === 'engineer' && !OFF.has('eng') && !this.engWrapped) {
      this.engWrapped = true; const base = this.cls;
      this.cls = {...base, combat: v => engCombat(this, v), quiet: v => engQuiet(this, v, !!this.amb, approachTiles(this.g, this.g.pvp.side))};
    }
    this.amb = amb;
    this.nest = this.qslot != null && !this.job ? (amb ? this.ambushNest(view) : findNest(g, view, this.team)) : null;
    if (this.nest) { this.team.nests ||= new Map(); this.team.nests.set(view.me.ref, this.nest); }
    if (process.env.BETA_STATS && this.qslot != null) { const k = `N:${this.nest ? (this.nest.x === view.me.x && this.nest.y === view.me.y ? 'at' : this.nest.lamp ? 'lamp' : 'go') : 'none'}:${view.me.black ? 'black' : view.me.dark ? 'dim' : 'lit'}:${view.enemies.length ? 'fight' : 'quiet'}`; BETA_STATS[k] = (BETA_STATS[k] || 0) + 1; }
    const f = fragChoice(g, view, this.team, {reserve: TUNING.fragReserve * fragMult(view.me.grenades?.frag || 0)});
    if (f && f.score > 0) {
      this.frag = {type: 'grenade', arg: {x: f.x, y: f.y}, pre: view.me.prepared.grenade !== 'frag' ? {type: 'prepare', arg: {category: 'grenade', id: 'frag'}} : null, score: f.score, why: `team frag h${f.hits} k${f.kills.toFixed(1)} v${f.value.toFixed(0)}`};
      if (this.isRefused(this.frag)) this.frag = null;
    }
    return super.decide(view);
  }
  // 沒看到人：先看能不能把手榴彈丟到剛剛還在那裡的人身上；再看要不要打燈
  quiet(view) {
    if (this.frag && this.frag.score >= TUNING.quietFrag) return this.frag;
    const snipe = this.nestQuiet(view); if (snipe) return snipe;
    // 醫療包多（士兵加強後 4 個）：沒人看到的時候早一點補
    const me = view.me; if (me.meds >= 3 && me.hp < me.maxHp * .75 && !this.isRefused({type: 'heal'})) return {type: 'heal', why: 'quiet heal (spare meds)'};
    const lamp = this.lampShot(view, false); if (lamp) return lamp;
    // 剛看到對方（快接觸了）：附近有散兵坑就先跳進去（取代 ClearBot 的「原地等一下」）
    if (!this.job && this.team?.goal && !view.me.pinned) { const fox = this.foxhole(view, this.team.goal); if (fox && !this.isRefused(fox)) return fox; }
    return super.quiet(view);
  }
  // 交火中：combatOptions 的結果在這裡（pickBest 之前）照團隊計畫調分數
  stance(view, opts) {
    const plan = this.team, me = view.me, g = this.g;
    if (process.env.BETA_STATS) { const k = 'T:combat:trench' + trenchAt(g, me); BETA_STATS[k] = (BETA_STATS[k] || 0) + 1; }
    const mates = plan ? plan.members.filter(m => m !== me.ref) : [];
    // 看不到的人（隊友看得到）不能開火：拿掉那些選項
    // 暴露中、但我沒有原本的視線（只知道位置）的也不能打
    const remote = new Set(view.enemies.filter(e => e.remote || e.ref?.pvpExposed && !g.nativeSight(me.ref, e.ref)).map(e => e.id));
    if (remote.size) for (let i = opts.length - 1; i >= 0; i--) { const o = opts[i], t = o.type === 'fire' ? o.target : o.then?.type === 'fire' ? o.then.target : null; if (t != null && remote.has(t)) opts.splice(i, 1); }
    // 手榴彈用團隊的算法（看得到和剛剛看到的人一起算），ASH 原本的只算看得到的
    if (this.frag) { for (const o of opts) if (o.type === 'grenade' && (o.pre?.arg?.id || 'frag') === 'frag') o.score -= 1000; opts.push(this.frag); }
    // 快死：往看不到敵人的格子撤，看不到了再補血
    const hurt = me.hp / me.maxHp < .5 && me.plates < 10;
    const shooters = view.enemies.filter(e => !e.civilian && !e.disabled);
    if (hurt && shooters.length) {
      const seenBy = t => shooters.filter(e => !e.melee && dist(e, t) <= (e.range || 5) + 1 && lineOpen(g, e.ref || e, t)).length + shooters.filter(e => e.melee && dist(e, t) <= 2).length;
      const now = seenBy(me);
      for (const o of opts) {
        if (o.type === 'move' && !o.target && o.arg) { const k = seenBy({x: me.x + o.arg[0], y: me.y + o.arg[1]}); if (k < now) o.score += TUNING.hurt * (now - k) / Math.max(1, now) + (k === 0 ? TUNING.hurt * .5 : 0); }
        if (o.type === 'heal' && now === 0) o.score += TUNING.hurt;
      }
    }
    const near = shooters.length ? shooters.reduce((a, b) => dist(a, me) <= dist(b, me) ? a : b) : null;
    const focusE = plan?.focus ? view.enemies.find(e => e.id === plan.focus) : null, aim = focusE || near;
    for (const o of opts) {
      // 集火
      if (plan?.focus && (o.type === 'fire' || o.then?.type === 'fire') && (o.target ?? o.then?.target) === plan.focus) o.score += plan.focusBonus;
      if (plan?.focus && o.type === 'move' && o.target === plan.focus) o.score += plan.focusBonus * .7;
      if (o.type === 'move' && !o.target && o.arg) {
        const t = {x: me.x + o.arg[0], y: me.y + o.arg[1]};
        // 隊形：不走進隊友的手榴彈範圍（2 格）
        o.score -= spacingCost(t, mates, plan);
        if (!OFF.has('terrain')) o.score += this.terrainScore(view, me, t, shooters, aim);
      }
    }
    // 遠距離接近：沒有打得到的、也沒有接近的計畫（ClearBot 只找 14 步內的開火位置）→ 往集火目標（或最近的人）走
    if (!OFF.has('far') && aim && !hurt && !me.anchored && !me.pinned && !opts.some(o => o.attack || o.type === 'grenade' || o.type === 'launch' || o.plan?.kind === 'approach')) {
      const step = this.farStep(view, aim);
      if (step) {
        const same = opts.find(o => o.type === 'move' && !o.target && o.arg[0] === step[0] && o.arg[1] === step[1]);
        const base = same ? same.score : Math.max(...opts.filter(o => o.type === 'move').map(o => o.score), -50);
        opts.push({type: 'move', arg: step, score: base + TUNING.far, why: `far approach ${aim.id}@${aim.x},${aim.y}`});
      }
    }
    const lamp = this.lampShot(view, true); if (lamp) opts.push(lamp);
    if (!OFF.has('dark')) this.darkScores(view, opts, hurt);
    if (me.meds >= 3) for (const o of opts) if (o.type === 'heal' && me.hp < me.maxHp * .7) o.score += 6;
    if (!OFF.has('powershot') && me.ref.pvpPower) this.powerScores(view, opts);
    // 搶奪點的工作：在交火中也做（箱子就在旁邊、槍和三倍傷害 2 步內），打得到我的人少才去
    if (this.job && !hurt) {
      const it = this.jobIntent(view, true), open = shooters.filter(e => !e.melee && dist(e, me) <= (e.range || 5) + 1 && lineOpen(g, e.ref || e, me)).length;
      if (it && it.type !== 'wait' && (dist(me, this.job) <= (this.job.kind === 'power' ? 3 : 2) || open === 0)) {
        const best = Math.max(-50, ...opts.filter(o => o.type === 'move').map(o => o.score));
        const bonus = it.type === 'openContainer' ? 14 : this.job.kind === 'power' ? 12 : 10;
        opts.push({...it, score: (it.type === 'move' ? best : Math.max(best, 0)) + bonus - open * 4, why: 'combat ' + it.why});
      }
    }
    return super.stance(view, opts);
  }
  // 黑暗：站在全黑的格子開普通的槍會暴露（對方整個階段都看得到、打得到）；消焰槍不會。
  // 偵察兵的狙擊點：在點上就瞄準（待機）、瞄準了開火、不離開；不在點上就往點走；點要靠打燈造出來就先打燈。
  darkScores(view, opts, hurt) {
    const g = this.g, me = view.me, black = me.black;
    const qs = this.qslot, nest = this.nest, atNest = nest && nest.x === me.x && nest.y === me.y;
    const fireSlot = o => o.type === 'fire' ? me.weapon : o.type === 'weapon' && o.then?.type === 'fire' ? o.arg : null;
    // 暴露的代價：看不到黑暗的敵人在暴露之後打得到我（view.light 換成「亮」算一次）
    let exposeCost = 0;
    if (black) {
      const keep = view.light; view.light = () => view.LIGHT.lit;
      try { for (const e of view.enemies) if (!e.civilian && !(e.nv || e.ir || e.mech)) exposeCost += incoming(view, e, me).soon; } finally { view.light = keep; }
      exposeCost *= .8;
    }
    for (const o of opts) {
      const slot = fireSlot(o); if (slot == null) continue;
      const tgt = view.enemies.find(e => e.id === (o.target ?? o.then?.target));
      if (slot === qs) {
        if (black) o.score += SNIPE_TUNING.quietFire, o.why += ' +quiet';
        const u = tgt && unitOf(g, tgt.id); if (u?.character === 'bulwark') o.score += SNIPE_TUNING.bulwark, o.why += ' +ap';
        if (!me.focus && me.weapon === qs && black && !(o.kill > .5)) o.score -= SNIPE_TUNING.unaimed, o.why += ' -unaimed';   // 黑暗裡沒人看得到我：先待機瞄準（−40 → +15）
      } else if (black && exposeCost && tgt) o.score -= exposeCost, o.why += ` -expose${exposeCost.toFixed(0)}`;
    }
    if (qs == null) return;
    const aimable = view.enemies.filter(e => !e.remote && !e.civilian && dist(e, me) <= SNIPE_TUNING.range && g.nativeSight(me.ref, e.ref) && g.shotClear(me.ref, e.ref));
    if (black && me.weapon === qs && !me.focus && aimable.length) {
      // ClearBot 在「一直掉血」時不給待機；黑暗裡沒人看得到我，待機（瞄準）還是值得
      let w = opts.find(o => o.type === 'wait'); if (!w) { w = {type: 'wait', score: -5, why: 'aim'}; opts.push(w); }
      // 待機的代價（ClearBot 算的「多拖一回合」）在黑暗裡不成立：至少比沒瞄準的一槍好
      const shot = Math.max(-50, ...opts.filter(o => fireSlot(o) === qs && !(o.kill > .5)).map(o => o.score));
      w.score = Math.max(w.score + SNIPE_TUNING.aim, shot + 3); w.why += ' +aim';
    }
    if (hurt) return;
    if (atNest || black && !nest) {
      // 在狙擊點（或黑暗中）：手上不是消焰槍就換；不離開
      if (me.weapon !== qs && !opts.some(o => o.type === 'weapon' && o.arg === qs)) opts.push({type: 'weapon', arg: qs, score: Math.max(0, ...opts.map(o => o.score)) + 2, why: 'nest: quiet rifle'});
      // 不離開黑暗：走出全黑的格子要扣分（還是全黑的格子可以走）
      for (const o of opts) if (o.type === 'move' && !o.target && o.arg) { const t = {x: me.x + o.arg[0], y: me.y + o.arg[1]}; if (atNest || !isBlack(g, t)) o.score -= SNIPE_TUNING.leave; }
    }
    if (nest?.lamp && lampShootable(g, me, nest.lamp)) {
      const it = {type: 'fire', target: nest.lamp.id, score: Math.max(0, ...opts.map(o => o.score)) + 3, why: `nest lamp ${nest.lamp.x},${nest.lamp.y}`};
      if (!this.isRefused(it)) opts.push(it);
    }
    if (nest && !atNest && !me.anchored && !me.pinned) {
      const r = route(view, q => q.x === nest.x && q.y === nest.y, {maxCost: SNIPE_TUNING.steps + 10, allyCost: 2});
      if (r) {
        const same = opts.find(o => o.type === 'move' && !o.target && o.arg[0] === r.first[0] && o.arg[1] === r.first[1]);
        const base = same ? same.score : Math.max(-50, ...opts.filter(o => o.type === 'move').map(o => o.score));
        opts.push({type: 'move', arg: r.first, score: Math.max(base + SNIPE_TUNING.nestStay - r.cost * 1.5, base), why: `to nest ${nest.x},${nest.y} v${nest.v.toFixed(0)}`});
      }
    }
  }
  ambush(view) {
    const g = this.g, side = g.pvp.side; if (OFF.has('ambush') || g.pvp.round > TUNING.ambushRounds) return null;
    const st = ambushState(g, side); if (st.over) return null;
    if ([...this.team.memory.values()].some(r => !r.ally) || g.pvp.kills[side] + g.pvp.kills[g.other(side)] > 0) { st.over = true; return null; }
    if (!this.team.members.some(m => quietSlot(m) != null)) { st.over = true; return null; }
    const home = g.pvpGoal?.[g.other(side)]; if (!home) return null;
    return {x: home.x, y: home.y, why: 'ambush: hold home'};
  }
  ambushNest(view) {
    const g = this.g, st = ambushState(g, g.pvp.side), lamps = (g.lamps || []).filter(l => l.hp > 0).length;
    if (st.nest && st.lamps === lamps && st.who === view.me.ref) return st.nest;
    st.nest = findNest(g, view, this.team, approachTiles(g, g.pvp.side)); st.lamps = lamps; st.who = view.me.ref;
    return st.nest;
  }
  // 沒看到人：狙擊點（剛剛還看到人）——走過去、打燈、換消焰槍、待機瞄準
  nestQuiet(view) {
    const nest = this.nest, me = view.me, g = this.g; if (!nest || this.qslot == null) return null;
    if (nest.lamp && lampShootable(g, me, nest.lamp)) { const it = {type: 'fire', target: nest.lamp.id, why: `nest lamp ${nest.lamp.x},${nest.lamp.y}`}; if (!this.isRefused(it)) return it; }
    if (nest.x !== me.x || nest.y !== me.y) {
      const r = route(view, q => q.x === nest.x && q.y === nest.y, {maxCost: SNIPE_TUNING.steps + 10, allyCost: 2});
      if (r) return {type: 'move', arg: r.first, walk: true, why: `to nest ${nest.x},${nest.y}`};
      return null;
    }
    if (me.weapon !== this.qslot && !this.isRefused({type: 'weapon', arg: this.qslot})) return {type: 'weapon', arg: this.qslot, why: 'nest: quiet rifle'};
    const w = me.held; if (w && w.ammo < w.mag && w.reserve > 0 && w.ammo < 2 && !this.isRefused({type: 'reload'})) return {type: 'reload', why: 'nest reload'};
    if (!this.isRefused({type: 'wait'})) return {type: 'wait', why: 'nest: aim'};
    return null;
  }
  // 拿著三倍傷害：下一次攻擊必定命中、傷害三倍。打得死的、最值錢的人優先；不浪費在無人機上
  powerScores(view, opts) {
    const g = this.g, me = view.me, p = me.ref;
    const value = e => { const u = unitOf(g, e.id); return u ? ({bulwark: 1.5, soldier: 1.2, recon: 1.1, engineer: 1, ninja: 1, berserker: 1.2}[u.character] || 1) : .1; };
    for (const o of opts) {
      if (!o.attack && o.type !== 'fire' && o.then?.type !== 'fire') continue;
      const tid = o.target ?? o.then?.target; const e = view.enemies.find(x => x.id === tid); if (!e) continue;
      if (e.pvpAlly != null || !unitOf(g, e.id)) { o.score -= 40; continue; }
      const slot = o.type === 'weapon' ? o.arg : o.attack && o.type === 'move' ? g.bumpMeleeSlot() : p.weapon;
      const base = p.weaponBases[slot]; if (base == null || !WEAPONS[base]) continue;
      const w = weaponStats(base, p.affixes[slot], p), per = Math.max(1, (w.min + w.max) / 2 - (e.armor || 0) * (1 - (w.pierce || 0)));
      const dmg = 3 * per * (w.pellets ? 1 : (w.burst || 1)), hp = Math.max(1, e.hp);
      o.score += value(e) * (dmg >= hp ? 40 : 30 * dmg / hp);
      o.why = (o.why || '') + ` +power ${dmg.toFixed(0)}/${hp}`;
    }
  }
  // 地上的好槍：有空位就撿（ClearBot 的 groundChoice 用設施的敵人算，可能把電漿步槍拆掉）
  weaponPickup(view) {
    const g = this.g, me = view.me;
    const loot = g.items.find(i => i.type === 'weapon' && isLoot(WEAPONS[i.weapon]?.id) && dist(i, me) <= 1 && g.canCross(me, i));
    if (loot) { if (me.ref.owned.length < (me.ref.weaponCapacity || 3) && !hasLoot(me.ref)) { const it = {type: 'takeWeapon', arg: loot.slot, why: 'take loot'}; if (!this.isRefused(it)) return it; } return null; }
    return super.weaponPickup(view);
  }
  // 一格的地形分數（交火中的移動選項）
  terrainScore(view, me, t, shooters, aim) {
    const g = this.g; let s = 0;
    const threats = shooters.filter(e => !e.melee && dist(e, t) <= (e.range || 5) + 2);
    // 掩護：矮隔板、戰壕（溝外打溝裡＝掩體、全身深＝牆），對每個打得到這一格的人平均
    if (threats.length) {
      let eff = 0;
      for (const e of threats) { const c = g.protectingCover({x: t.x, y: t.y, traits: me.ref.traits}, e.ref || e); eff += coverEffects(c, t, e.ref || e).efficiency || 0; }
      s += TUNING.cover * eff / threats.length;
    }
    // 破綻：翻隔板、直接跳進／爬出全身深的戰壕（到下次行動前命中 +20）——有人打得到才算
    const flaw = stepFlaw(g, me, t);
    if (flaw && threats.some(e => lineOpen(g, e.ref || e, t))) s -= TUNING.flaw;
    // 散兵坑、戰壕的半身深：溝外打溝裡算掩體，再加一點（推進途中搶進去）
    if (!OFF.has('fox') && threats.length && trenchAt(g, t) === 1 && !flaw) s += TUNING.fox;
    // 煙：往目標靠近而且走進煙裡（濃煙擋視線、淡煙命中減半）
    if (aim && dist(t, aim) < dist(me, aim) && cloudAt(g, t)) s += TUNING.cloud;
    return s;
  }
  // 往很遠的目標走一步：避開敵人火線、偏好煙
  farStep(view, aim) {
    const g = this.g, shooters = view.enemies.filter(e => !e.civilian && !e.melee && !e.disabled);
    const cost = q => shooters.reduce((n, e) => n + (dist(e, q) <= (e.range || 5) && lineOpen(g, e.ref || e, q) ? 3 : 0), 0) - (cloudAt(g, q) ? 1 : 0);
    const reach = Math.max(1, (view.me.held?.melee ? 1 : Math.min(view.me.held?.range || 5, 7)) - 1);
    const r = route(view, q => dist(q, aim) <= reach, {cost: q => Math.max(0, cost(q)), maxCost: 120, allyCost: 2});
    return r?.first || null;
  }
  // 鹵素燈：照著我（或隊友）、而對方沒有夜視——打碎它，我們就在黑暗裡；或我有夜視、對方站在燈下而且看不到我
  lampShot(view, combat) {
    if (OFF.has('lamp')) return null;
    const g = this.g, me = view.me, w = me.held; if (!w || w.melee || w.ammo < (w.shotCost || 1)) return null;
    const lamps = (g.lamps || []).filter(l => l.hp > 0 && dist(l, me) <= Math.min(w.range, 8) && g.teamVisible(l) && g.shotClear(me.ref, l));
    if (!lamps.length) return null;
    const known = [...this.team.memory.values()].filter(r => !r.ally && g.turn - r.turn <= 10);
    if (!known.length) return null;
    // 停電的地方才靠燈（有電的地方本來就亮）；對方沒有夜視的人看不到黑暗裡的我們，我沒有夜視就看不到黑暗裡的他們
    const dark = p => (g.lighting?.[p.y]?.[p.x] ?? 1) === 0;
    const nv = r => { const u = unitOf(g, r.id); return !!(u && hasNV(u)); };
    let best = null;
    for (const l of lamps) {
      let v = 0;
      for (const m of this.team.members) if (lampLights(l, m) && dark(m)) v += 3 * known.filter(r => !nv(r) && dist(r, m) <= 10).length;
      for (const r of known) if (lampLights(l, r) && dark(r)) v += hasNV(me.ref) && !nv(r) ? 4 : -4;
      if (v > 0 && (!best || v > best.v)) best = {v, l};
    }
    if (!best || best.v < 8) return null;
    // 開火會暴露：沒在交火就只有在對方本來就快到了才打
    const it = {type: 'fire', target: best.l.id, score: best.v + TUNING.lamp * (combat ? .5 : 1) - (combat ? 10 : 0), why: `shoot lamp ${best.l.x},${best.l.y} v${best.v}`};
    if (this.isRefused(it) || this.lampTried === `${g.turn}:${best.l.id}`) return null;
    this.lampTried = `${g.turn}:${best.l.id}`;
    return it;
  }
  // 沒看到敵人：整隊的目標（記得的敵人 → 對方開場 → 自己開場……），跑太前面的等後面的人；領先時守戰壕
  chooseGoal(view) {
    const plan = this.team, me = view.me, g = this.g;
    if (me.pinned) return {type: 'wait', why: 'pinned'};   // 壓制中不能移動
    const job = this.jobIntent(view, false); if (job) return job;
    const goal = plan?.goal; if (!goal || OFF.has('goal')) return OFF.has('goal') && plan.hold.has(me.ref) ? {type: 'wait', why: 'team: wait for squad'} : super.chooseGoal(view);
    const spray = sprayingVents(g).some(v => dist(v, me) <= 8);
    if (plan.hold.has(me.ref) && !spray) return {type: 'wait', why: 'team: wait for squad'};
    const hold = this.trenchHold(view, goal); if (hold) return hold;
    if (dist(me, goal) <= 1) return {type: 'wait', why: 'at goal'};
    return this.walkTo(view, goal, goal.why);
  }
  // 領先（拿下的比較多）而且知道對方在哪：附近有戰壕就跳進去守（溝外打溝裡算掩護），等對方過來
  trenchHold(view, goal) {
    if (OFF.has('trench')) return null;
    const g = this.g, me = view.me, side = g.pvp.side, k = g.pvp.kills;
    if (!g.pvpTrench || !goal.enemy || k[side] < k[g.other(side)] || me.held?.melee || dist(me, goal) > 12) { this.trenchSince = null; return null; }
    if (this.trenchSince != null && g.turn - this.trenchSince > TUNING.trenchHold) return null;
    if (trenchAt(g, me) === 1) { this.trenchSince ??= g.turn; return {type: 'wait', why: 'hold trench'}; }
    const r = route(view, q => trenchAt(g, q) === 1 && dist(q, goal) <= (me.held?.range || 6) + 2, {maxCost: 6, cost: q => trenchAt(g, q) === 2 ? 3 : 0});
    return r ? {type: 'move', arg: r.first, walk: true, why: 'to trench'} : null;
  }
  // 搶奪點的工作（beta-objective.mjs）：走到箱子旁邊打開、踩上掉出來的槍、踩上三倍傷害；忍者先用脫離繩拉近
  jobIntent(view, combat) {
    const job = this.job, g = this.g, me = view.me; if (!job) return null;
    if (job.kind === 'crate' && dist(me, job) === 1 && g.canCross(me, job)) {
      const it = {type: 'openContainer', arg: job.id, why: `job open ${job.id}`};
      if (!this.isRefused(it)) return it;
      markOpened(g, job.id); return null;
    }
    if (job.kind !== 'crate' && me.x === job.x && me.y === job.y) { markDone(g, job.id); return null; }
    if (job.kind === 'weapon' && hasLoot(me.ref)) { markDone(g, job.id); return null; }
    if (me.anchored) return null;
    const rope = ropeToward(g, me.ref, job); if (rope && !this.isRefused(rope)) return {...rope, free: true};
    if (!job.adj && g.seen[job.y]?.[job.x]) {
      const mates = new Set((this.team?.members || []).filter(m => m !== me.ref).map(key));
      const r = route(view, q => q.x === job.x && q.y === job.y, {allyCost: 2, cost: q => mates.has(key(q)) ? 4 : 0});
      if (r) return {type: 'move', arg: r.first, walk: true, why: `job ${job.kind} ${job.x},${job.y}`};
    }
    return this.walkTo(view, job, `job ${job.kind} ${job.x},${job.y}`);
  }
  // 散兵坑、戰壕的半身深（溝外打溝裡＝掩體）：剛看到對方、快接觸了，路上 2 步內有一格不比現在離目標遠，就先跳進去；在裡面就等一下
  foxhole(view, goal) {
    if (OFF.has('fox')) return null;
    const g = this.g, me = view.me; if (!g.pvpTrench || me.held?.melee) return null;
    const recent = [...this.team.memory.values()].filter(r => !r.ally && g.turn - r.turn <= 3 && dist(r, me) <= 12);
    if (!recent.length) return null;
    if (trenchAt(g, me) === 1) {
      if ((this.foxWait || 0) < 2 && recent.some(r => g.turn - r.turn <= 1)) { this.foxWait = (this.foxWait || 0) + 1; return {type: 'wait', why: 'hold foxhole'}; }
      return null;
    }
    this.foxWait = 0;
    const r = route(view, q => trenchAt(g, q) === 1 && dist(q, goal) <= dist(me, goal) + 1, {maxCost: 2, cost: q => trenchAt(g, q) === 2 ? 5 : 0});
    return r && r.path.length <= 2 ? {type: 'move', arg: r.first, walk: true, why: 'to foxhole'} : null;
  }
  // 好槍在身上就拿好槍（電漿步槍無視護甲；精準步槍要瞄準，近戰職業不換）
  mainWeapon(view) {
    const me = view.me, p = me.ref, loot = p.owned.find(s => isLoot(WEAPONS[p.weaponBases[s]]?.id));
    if (loot != null && !OFF.has('main')) return loot;
    return super.mainWeapon(view);
  }
  walkTo(view, goal, why) {
    const g = this.g, me = view.me;
    // 這一回合被拒絕的那一步（隊友站在那裡、或貼牆看不到的敵人擋路）不再走；隊友站的格子多算一點
    const mates = new Set((this.team?.members || []).filter(m => m !== me.ref).map(key));
    const cost = q => dist(q, me) === 1 && this.isRefused({type: 'move', arg: [q.x - me.x, q.y - me.y]}) ? Infinity : mates.has(key(q)) ? 4 : 0;
    let r = g.seen[goal.y]?.[goal.x] ? route(view, q => dist(q, goal) <= 1, {allyCost: 2, cost}) : null;
    if (!r) {
      let best = Infinity; const N = g.grid.length;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!g.seen[y][x] && g.grid[y][x] === 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.seen[y + dy]?.[x + dx])) best = Math.min(best, dist({x, y}, goal));
      for (const slack of [1, 4, 10]) { if (r || best === Infinity) break; r = route(view, q => !g.seen[q.y]?.[q.x] && g.grid[q.y]?.[q.x] === 1 && dist(q, goal) <= best + slack, {allyCost: 2, unknownGoal: true}); }
      r ||= route(view, q => dist(q, goal) <= 3, {allyCost: 2});
      r ||= exploreRoute(view, {allyCost: 2});
    }
    return r ? {type: 'move', arg: r.first, walk: true, why} : {type: 'wait', why: 'no way'};
  }
}
// 手榴彈多（士兵加強後 4 顆）就不用那麼省
const fragMult = n => n >= 3 ? .55 : n === 2 ? .9 : 1;
function spacingCost(t, mates, plan) {
  let c = 0;
  for (const m of mates) { const d = dist(t, m); if (d <= 2) c += (3 - d) * (plan?.threat ? TUNING.spacing : TUNING.spacingCalm); }
  return c;
}
// 陣容研究（duel.mjs 用；線上練習的陣容是伺服器抽的，不會叫這個）：BETA_PICK=soldier,recon,bulwark,engineer 指定；
// BETA_PICK=swap:<職業>：預設陣容裡沒有這個職業就換掉最後一個；沒設就照預設（兩邊同一組）
export function pick(seed, defaultComp) {
  const env = globalThis.process?.env?.BETA_PICK; if (!env) return null;
  if (env.startsWith('swap:')) { const c = env.slice(5); if (defaultComp.includes(c)) return defaultComp; return [...defaultComp.slice(0, 3), c]; }
  if (env.startsWith('drop:')) { const c = env.slice(5); if (!defaultComp.includes(c)) return defaultComp; const pool = ['soldier', 'recon', 'bulwark', 'berserker', 'ninja', 'engineer'].filter(x => !defaultComp.includes(x)); return defaultComp.map(x => x === c ? pool[seed % pool.length] : x); }
  return env.split(',');
}
