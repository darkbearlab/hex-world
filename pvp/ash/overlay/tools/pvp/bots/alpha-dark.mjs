// alpha 的黑暗狙擊（職業加強提案 BUFFS_PROPOSAL，2026-10-16）：偵察兵開場多一把消焰精準步槍（DMR＋flashhider）。
// 消焰武器站在全黑的格子開火不暴露（PvpGame.soloPaid）；偵察兵有夜視（黑暗裡看得到人、打黑暗裡的人沒有 −40）和紅外線（看穿煙霧）。
// 全黑格子裡的人，沒有夜視／紅外線、不是機器的對方看不到（lighting.js 的 hiddenInDark）：士兵、重裝兵、狂戰士、工兵本人都看不到；
// 偵察兵、忍者、工兵的無人機／砲台看得到。
// - 狙擊點：全黑、射程內有對方、從「看得到我的」對方那裡受的威脅低的格子。站在那裡：瞄準過（上一個動作是待機）就開火，
//   沒瞄準、而且瞄準後命中率明顯變高、目前沒有危險就先待機。不在全黑的地方就往附近的狙擊點走。
// - 目標：精準步槍穿透 70% 護甲，優先打重裝兵（bul 倍率）；能打死的再加分。
// - 打燈：附近沒有可用的全黑格子時，找一盞打碎後會讓附近出現狙擊點的鹵素燈，從全黑的地方（不暴露）或沒有危險時打。
// - 替身的手電筒：ASH 的替身是 raider，三分之一帶手電筒、在對方的階段照亮自己那一格（lighting.js 的 carriesFlashlight，
//   照種子雜湊決定）。帶手電筒的偵察兵在對方的階段不是全黑：開火照樣不暴露，但躲不掉（selfLit），威脅照一般算。
// 參數在 DK（ALPHA_D* 環境變數只給實驗用）。
import {isBlack, carriesFlashlight} from '../../../src/lighting.js';
import {activeTrait} from '../../../src/traits.js';
import {WEAPONS} from '../../../src/data.js';
import {distance} from '../../../src/world.js';
import {shotAt} from '../../clear-bot/tactics.mjs';
import {route} from '../../clear-bot/nav.mjs';

export const DK = {
  on: process.env.ALPHA_DARK !== '0',
  bul: +(process.env.ALPHA_DBUL ?? 1.6),     // 打重裝兵的倍率
  reach: +(process.env.ALPHA_DREACH ?? 8),   // 找狙擊點的走路成本上限
  danger: +(process.env.ALPHA_DDANGER ?? 30),   // 狙擊點能接受的威脅（看得到我的對方一個階段的傷害）
  aim: +(process.env.ALPHA_DAIM ?? .12),     // 瞄準後命中率至少高這麼多才先待機
  hold: +(process.env.ALPHA_DHOLD ?? 4),     // 沒人可打時在狙擊點最多等幾次
  lamp: process.env.ALPHA_DLAMP !== '0', nest: process.env.ALPHA_DNEST !== '0',
  close: +(process.env.ALPHA_DCLOSE ?? 2),
  lampRisk: +(process.env.ALPHA_DLRISK ?? 30),   // 在亮處打燈（會暴露）能接受的威脅   // 對方近到這個距離就交給一般的戰鬥（散彈槍）
};
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DK_STATS = {};   // 診斷用：各分支走了幾次
const tick = k => { DK_STATS[k] = (DK_STATS[k] || 0) + 1; };

export const quietSlot = (g, p) => (p.owned || []).find(s => { const w = g.weaponAt?.(s); return w?.noFlash && !w.melee; });
export const isSniper = (g, p) => DK.on && activeTrait(p, 'night_vision') && quietSlot(g, p) !== undefined;
// 這個人的替身在對方的階段會不會開著手電筒（照亮自己那一格）
export function selfLit(g, p) {
  try { return carriesFlashlight(g, {id: `px-${p.squadId}`, type: `pvp-proxy-${p.armor | 0}`, hp: 1}); } catch { return false; }
}
// 對方本人（替身或情報）：看得到全黑裡的人嗎
function seer(g, f) {
  const id = f.ref?.pvpOf ?? f.pvpOf ?? (String(f.id).startsWith('px-') ? String(f.id).slice(3) : null);
  if (!id) return true;   // 無人機、砲台（機器：找得到溫熱的目標）
  const m = g.unit(id); if (!m) return true;
  return activeTrait(m, 'night_vision') || activeTrait(m, 'infrared');
}
const realOf = (g, f) => { const id = f.ref?.pvpOf ?? f.pvpOf ?? (String(f.id).startsWith('px-') ? String(f.id).slice(3) : null); return id ? g.unit(id) : null; };

export class DarkSniper {
  constructor(bot) { this.bot = bot; this.holds = 0; }
  get g() { return this.bot.g; }
  black(q) { return isBlack(this.g, q); }
  // q 這一格下一個對方階段受的威脅：看得到 q 的對方（全黑就只算有夜視／紅外線的、或我的替身帶手電筒）
  danger(q, foes, lit) {
    const g = this.g, blk = !lit && this.black(q); let sum = 0;
    for (const f of foes) {
      const m = realOf(g, f), w = m ? WEAPONS[m.weaponBases?.[m.weapon]] : null, d = distance(f, q);
      if (w?.melee) { if (d <= 2 && (!blk || seer(g, f))) sum += (w.min + w.max) / 2 * .7; continue; }
      const range = w?.range ?? 7; if (d > range) continue;
      if (blk && !seer(g, f)) continue;
      const k = `${f.x},${f.y}>${q.x},${q.y}`; let open = this.lines.get(k);
      if (open === undefined) { const a = {x: f.x, y: f.y}; open = g.sight(a, q) && g.shotClear(a, q); this.lines.set(k, open); }
      if (!open) continue;
      const dmg = w ? (w.min + w.max) / 2 * (w.burst || 1) * (w.pellets ? .5 : 1) : 20;
      sum += dmg * (m?.pvpPower ? 3 : 1) * (blk ? .6 : 1);
    }
    return sum;
  }
  // 從 q 打得到的人（照射程、視線；我自己看得到的才打得到）
  shotsFrom(q, enemies) {
    const g = this.g, slot = this.slot, w = g.weaponAt(slot), out = [];
    for (const e of enemies) {
      if (e.remote || distance(q, e) > w.range) continue;
      const a = {x: q.x, y: q.y}, b = {x: e.x, y: e.y};
      if (!g.sight(a, b) || !g.shotClear(a, b)) continue;
      out.push(e);
    }
    return out;
  }
  value(view, e, sh) {
    const m = realOf(this.g, e);
    return (sh.expected + 70 * sh.kill) * (m?.character === 'bulwark' ? DK.bul : 1) * (m?.pvpPower ? 1.5 : 1);
  }
  // 狙擊點：從我這裡走得到（成本 reach 以內）、全黑、打得到 targets 裡的人（或看得到 aims 的位置）、危險低
  findNest(view, foes, aims) {
    const g = this.g, me = view.me, lit = this.lit;
    let best = null, count = 0;
    const consider = (q, c) => {
      if (!this.black(q)) return;
      if (g.alive(this.bot.side()).some(u => u !== g.player && u.x === q.x && u.y === q.y)) return;
      let s = 0;
      for (const a of aims) {
        const d = distance(q, a); if (d > 10 || d < 3) continue;
        const k = `${q.x},${q.y}>${a.x},${a.y}`; let open = this.lines.get('s' + k);
        if (open === undefined) { const A = {x: q.x, y: q.y}, B = {x: a.x, y: a.y}; open = g.sight(A, B) && g.shotClear(A, B); this.lines.set('s' + k, open); }
        if (open) s += a.w || 1;
      }
      if (!s) return;
      const dg = this.danger(q, foes, lit); if (dg > DK.danger) return;
      const sc = s * 10 - dg * .5 - c * 1.5 + (q.x === me.x && q.y === me.y ? 3 : 0);
      if (!best || sc > best.s) best = {s: sc, q: {x: q.x, y: q.y}, c};
    };
    consider(me, 0);
    route(view, q => { if (++count > 300) return true; consider(q, distance(q, me)); return false; }, {maxCost: DK.reach, allyCost: 2});
    return best;
  }
  stepToward(view, q, foes) {
    const me = view.me; if (q.x === me.x && q.y === me.y) return null;
    const r = route(view, x => x.x === q.x && x.y === q.y, {maxCost: DK.reach + 6, allyCost: 2});
    if (!r) return null;
    const s = {x: me.x + r.first[0], y: me.y + r.first[1]};
    if (this.danger(s, foes, this.lit) > DK.danger * 1.5) return null;
    this.holds = 0;
    return {type: 'move', arg: r.first, walk: true, why: `alpha dark nest ${q.x},${q.y}`};
  }
  // 打一盞燈，讓附近多出狙擊點
  lampShot(view, foes, aims) {
    if (!DK.lamp) return null;
    const g = this.g, me = view.me, p = g.player, w = g.weapon;
    if (!w || w.melee || (p.ammo[p.weapon] ?? 0) < 1) return null;
    const hereBlack = this.black(me);
    if (!hereBlack && this.danger(me, foes, true) > DK.lampRisk) { tick('lamp-risky'); return null; }   // 在亮處開槍會暴露：附近沒有危險才打
    let best = null;
    for (const l of g.lamps || []) {
      if (!(l.hp > 0) || distance(l, me) > Math.min(w.range, 9) || !g.visible(l)) continue;
      if (distance(l, me) > 5 && !aims.some(a => distance(a, l) <= 10)) continue;
      const keep = l.hp; let gain = null;
      try { l.hp = 0; gain = this.findNest(view, foes, aims); } finally { l.hp = keep; }
      tick(gain ? 'lamp-gain' : 'lamp-nogain');
      if (!gain || gain.q.x === me.x && gain.q.y === me.y && hereBlack) continue;
      if (!best || gain.s > best.s) best = {s: gain.s, l};
    }
    return best && {type: 'fire', target: best.l.id, why: `alpha dark lamp ${best.l.x},${best.l.y}`};
  }
  // 回傳意圖或 null（交給一般的決策）
  decide(view, hostile, known) {
    const g = this.g, p = g.player, me = view.me, bot = this.bot;
    if (!isSniper(g, p) || p.pvpPower || me.pinned) return null;
    this.slot = quietSlot(g, p); this.lit = selfLit(g, p); this.lines = new Map();
    const foes = [...hostile, ...known];
    if (hostile.some(e => distance(e, me) <= DK.close)) return null;
    const qw = g.weaponAt(this.slot), loaded = (p.ammo[this.slot] ?? 0) >= 1;
    const held = p.weapon === this.slot;
    const sw = then => held ? then : {type: 'weapon', arg: this.slot, then, why: 'alpha dark sniper'};
    // 沒子彈：裝填（在全黑、沒危險的地方）
    if (!loaded) {
      if (!held) return null;
      const res = me.held?.reserve ?? 0; if (res <= 0) return null;
      if (this.danger(me, foes, this.lit) <= DK.danger && !bot.isRefused({type: 'reload'})) return {type: 'reload', why: 'alpha dark reload'};
      return null;
    }
    const here = {x: me.x, y: me.y}, hereBlack = this.black(here);
    if (hostile.length) {
      // 打得到的目標（用精準步槍算）
      let best = null;
      if (hereBlack) for (const e of this.shotsFrom(here, hostile)) {
        if (!e.ref) continue;
        const sh = shotAt(view, e, this.slot); if (!sh || sh.expected <= 0) continue;
        const v = this.value(view, e, sh);
        if (!best || v > best.v) best = {v, e, sh};
      }
      if (best) {
        const it = sw({type: 'fire', target: best.e.id, why: `alpha dark snipe ${realOf(g, best.e)?.character} k${best.sh.kill.toFixed(2)} c${best.sh.chance.toFixed(2)}`});
        if (!p.focus && held && qw.aimPenalty && this.holds < 2) {
          const better = Math.min(.99, best.sh.chance + qw.aimPenalty / 100 + .15);
          const gain = better - best.sh.chance, dg = this.danger(here, foes, this.lit);
          const killNow = best.sh.kill >= .5;
          if (gain >= DK.aim && !killNow && dg <= DK.danger * .5 && !bot.isRefused({type: 'wait'})) { this.holds++; return {type: 'wait', why: `alpha dark aim +${(gain * 100).toFixed(0)}`}; }
        }
        if (!bot.isRefused(it)) { this.holds = 0; return it; }
      }
      // 不在全黑、或從這裡打不到：往附近的狙擊點走
      const aims = hostile.map(e => ({x: e.x, y: e.y, w: realOf(g, e)?.character === 'bulwark' ? DK.bul : 1}));
      const nest = this.findNest(view, foes, aims);
      tick(hereBlack ? 'hostile-black-noshot' : 'hostile-lit'); tick(nest ? 'hostile-nest' : 'hostile-nonest'); if ((g.lamps || []).some(l => l.hp > 0 && distance(l, me) <= 9)) tick('hostile-lampnear');
      if (nest && !(nest.q.x === me.x && nest.q.y === me.y)) { const st = this.stepToward(view, nest.q, foes); if (st && !bot.isRefused(st)) return st; }
      if (!nest) { const l = this.lampShot(view, foes, aims); if (l && !bot.isRefused(sw(l))) return sw(l); }
      return null;
    }
    if (!DK.nest || !known.length) { this.holds = 0; return null; }
    // 自己看不到人、但知道對方在哪：去狙擊點、瞄準等他出來
    const aims = known.map(f => ({x: f.x, y: f.y, w: realOf(g, f)?.character === 'bulwark' ? DK.bul : 1}));
    const nest = this.findNest(view, foes, aims);
    if (nest) {
      if (nest.q.x === me.x && nest.q.y === me.y) {
        if (!held && !bot.isRefused({type: 'weapon', arg: this.slot})) return {type: 'weapon', arg: this.slot, why: 'alpha dark sniper'};
        if (this.holds < DK.hold && !bot.isRefused({type: 'wait'})) { this.holds++; return {type: 'wait', why: 'alpha dark hold'}; }
        return null;
      }
      const st = this.stepToward(view, nest.q, foes); if (st && !bot.isRefused(st)) return st;
    } else { const l = this.lampShot(view, foes, aims); if (l && held && !bot.isRefused(l)) return l; }
    return null;
  }
}
