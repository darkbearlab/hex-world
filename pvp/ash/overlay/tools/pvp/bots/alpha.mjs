// alpha：比 PvpBot 強一點的 PVP 機器人（pvp/DESIGN.md）。在 ClearBot 的決策前後加上 PVP 的判斷：
// - 威脅模型：替身是 ASH 的 raider，傷害、射程跟真的職業武器差很多；改成對方本人手上的武器（職業是公開的）。
// - 破片手榴彈：自己算（含隊友、自己、爆炸視線），對方擠在一起或能炸死人就丟；ClearBot 原本的手榴彈不看隊友，拿掉。
// - 集火：血少的、能打死的加分。
// - 散開：沒交戰時的移動避開緊貼隊友的格子（不被一顆手榴彈炸兩人）。
import {PvpBot} from '../match.mjs';
import {WEAPONS} from '../../../src/data.js';
import {lineOfSight, distance} from '../../../src/world.js';
import {objectSightGrid} from '../../../src/scenery.js';
import {skillActive} from '../../../src/skills.js';

const T = {
  threat: process.env.ALPHA_THREAT !== '0',
  frag: process.env.ALPHA_FRAG !== '0',
  focus: process.env.ALPHA_FOCUS !== '0',
  spread: process.env.ALPHA_SPREAD !== '0',
};

const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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
      if (w.melee) e.fast = true;
    }
  }

  // 一格中心 c 丟破片：對每個人的傷害（照 PvpGame.explode：距離每 1 少 10、要爆炸視線）
  fragAt(view, c) {
    const g = this.g, me = g.player, dmg0 = 55 + (me.blastBonus || 0);
    const hit = u => { const d = distance(c, u); if (d > 2) return 0; if (d > 0 && !lineOfSight(objectSightGrid(g, c, u), c, u, g.barriers, 'blast')) return 0; return Math.max(1, dmg0 - d * 10); };
    let value = 0, kills = 0, hits = 0, friendly = 0;
    for (const e of view.enemies) { const d = hit(e); if (!d) continue; hits++; value += Math.min(d, e.hp); if (d >= e.hp) { kills++; value += 70; } }
    for (const m of [me, ...this.mates()]) { const d = hit(m); if (!d) continue; const hp = m.hp + (m.plates || 0); friendly += Math.min(d, hp) * 1.6 + (d >= hp ? 150 : 0); }
    return {value, kills, hits, friendly, score: value - friendly};
  }
  fragOption(view) {
    const g = this.g, me = view.me;
    if (!(me.grenades.frag > 0)) return null;
    let best = null; const tried = new Set();
    for (const e of view.enemies) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 2) continue;
      const c = {x: e.x + dx, y: e.y + dy}, k = c.x + ',' + c.y; if (tried.has(k)) continue; tried.add(k);
      if (distance(c, me) > 5 || g.grid[c.y]?.[c.x] !== 1 || !g.visible(c)) continue;
      const f = this.fragAt(view, c); if (!best || f.score > best.f.score) best = {c, f};
    }
    if (!best) return null;
    const {f} = best;
    // 值不值得：炸死一人，或同時打到兩人以上、總傷害夠
    const worth = f.kills >= 1 && f.score > 40 || f.hits >= 2 && f.score > 60 || f.score > 75 && me.grenades.frag >= 2;
    if (!worth) return null;
    return {type: 'grenade', arg: {x: best.c.x, y: best.c.y, grenade: 'frag'}, pre: me.prepared.grenade !== 'frag' ? {type: 'prepare', arg: {category: 'grenade', id: 'frag'}} : null,
      score: f.score, why: `alpha frag ${f.kills}k ${f.hits}h v${f.score.toFixed(0)}`};
  }

  decide(view) {
    if (T.threat) this.patchThreat(view);
    const hostile = view.enemies.filter(e => !e.civilian);
    if (T.frag && hostile.length) {
      const fr = this.fragOption(view);
      if (fr && !this.isRefused(fr) && (fr.f?.kills || fr.score >= 60)) return fr;
      if (fr && !this.isRefused(fr)) this.pendingFrag = fr; else this.pendingFrag = null;
    } else this.pendingFrag = null;
    return super.decide(view);
  }
}

// ClearBot 的 combatOptions 在 decide 裡呼叫：用 pickBest 前的過濾太深，改成包一層 stance（opts 會傳進來）
const baseStance = Object.getPrototypeOf(Alpha.prototype).stance;
Alpha.prototype.stance = function (view, opts) {
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
  return baseStance.call(this, view, opts);
};
