// beta：團隊協調的 PVP 機器人（pvp/DESIGN.md）。每個階段由這一隊第一個行動的人替整隊做一個計畫（beta-team.mjs，
// 存在 g 上、以 g.turn 當鍵），每個人再照計畫調整 ClearBot 的選項分數：
//   - 威脅模型換成真的職業武器（對方的替身在 ASH 裡都是「破口突擊兵」的卡片：射程 5、一輪 21，比真的步槍、輕機槍、下錨雙射弱很多）。
//   - 整隊共用的敵人記憶：最後看到的位置（貼牆、下錨、煙裡看不到的人也記得）。
//   - 破片手榴彈：整隊的記憶裡挑最好的落點，包括看不到但剛剛還在那裡的人（落點看得到就能丟），避開自己人。
//   - 集火：整隊挑同一個目標（打得到的人多、血少、威脅大）。
//   - 隊形：交火時不擠進隊友的手榴彈範圍；推進時跑太前面的人等後面的人（不一個一個送進對方的火線）。
//   - 快死：往看不到敵人的格子撤、在看不到的地方補血。
import {PvpBot} from '../match.mjs';
import {teamPlan, patchView, fragChoice} from './beta-team.mjs';
import {lineOpen} from '../../clear-bot/tactics.mjs';
import {dist} from '../../clear-bot/util.mjs';

const TUNING = {quietFrag: 10, fragReserve: 12, spacing: 4, spacingCalm: 1.5, hurt: 15};
export const BETA_STATS = {};   // 實驗用（beta-analyze.mjs，BETA_STATS=1）
export default class Beta extends PvpBot {
  act(intent) {
    if (process.env.BETA_STATS) { const k = `${this.g.player.character}:${intent.type}${intent.type === 'skill' ? ':' + intent.arg : intent.type === 'grenade' ? ':' + (intent.pre?.arg?.id || this.g.player.prepared?.grenade) : ''}`; BETA_STATS[k] = (BETA_STATS[k] || 0) + 1; }
    if (process.env.BETA_TRACE) { const p = this.g.player; console.log(`   r${this.g.pvp.round} ${p.squadId}${p.character.slice(0, 4)}(${p.x},${p.y}) hp${p.hp}+${p.plates || 0} ${intent.type} ${JSON.stringify(intent.arg ?? intent.target ?? '')} ${intent.why || ''} ${intent.score?.toFixed?.(1) ?? ''}`); }
    return super.act(intent);
  }
  decide(view) {
    patchView(view);
    this.team = teamPlan(this.g, view, this);
    this.frag = null;
    const f = fragChoice(this.g, view, this.team, {reserve: TUNING.fragReserve});
    if (f && f.score > 0) {
      this.frag = {type: 'grenade', arg: {x: f.x, y: f.y}, pre: view.me.prepared.grenade !== 'frag' ? {type: 'prepare', arg: {category: 'grenade', id: 'frag'}} : null, score: f.score, why: `team frag h${f.hits} k${f.kills.toFixed(1)} v${f.value.toFixed(0)}`};
      if (this.isRefused(this.frag)) this.frag = null;
    }
    return super.decide(view);
  }
  // 沒看到人：先看能不能把手榴彈丟到剛剛還在那裡的人身上
  quiet(view) {
    if (this.frag && this.frag.score >= TUNING.quietFrag) return this.frag;
    return super.quiet(view);
  }
  // 交火中：combatOptions 的結果在這裡（pickBest 之前）照團隊計畫調分數
  stance(view, opts) {
    const plan = this.team, me = view.me, g = this.g;
    const mates = plan ? plan.members.filter(m => m !== me.ref) : [];
    // 手榴彈用團隊的算法（看得到和剛剛看到的人一起算），ASH 原本的只算看得到的
    if (this.frag) { for (const o of opts) if (o.type === 'grenade' && (o.pre?.arg?.id || 'frag') === 'frag') o.score -= 1000; opts.push(this.frag); }
    // 快死：往看不到敵人的格子撤，看不到了再補血
    const hurt = me.hp / me.maxHp < .5 && me.plates < 10;
    if (hurt && view.enemies.length) {
      const seenBy = t => view.enemies.filter(e => !e.melee && dist(e, t) <= (e.range || 5) + 1 && lineOpen(g, e.ref || e, t)).length + view.enemies.filter(e => e.melee && dist(e, t) <= 2).length;
      const now = seenBy(me);
      for (const o of opts) {
        if (o.type === 'move' && !o.target && o.arg) { const k = seenBy({x: me.x + o.arg[0], y: me.y + o.arg[1]}); if (k < now) o.score += TUNING.hurt * (now - k) / Math.max(1, now) + (k === 0 ? TUNING.hurt * .5 : 0); }
        if (o.type === 'heal' && now === 0) o.score += TUNING.hurt;
      }
    }
    for (const o of opts) {
      // 集火
      if (plan?.focus && (o.type === 'fire' || o.then?.type === 'fire') && (o.target ?? o.then?.target) === plan.focus) o.score += plan.focusBonus;
      if (plan?.focus && o.type === 'move' && o.target === plan.focus) o.score += plan.focusBonus * .7;
      // 隊形：不走進隊友的手榴彈範圍（2 格）
      if (o.type === 'move' && !o.target && o.arg) o.score -= spacingCost({x: me.x + o.arg[0], y: me.y + o.arg[1]}, mates, plan);
    }
    return super.stance(view, opts);
  }
  // 沒看到敵人：推進時跑太前面的人等後面的人
  chooseGoal(view) {
    const plan = this.team, me = view.me;
    const intent = super.chooseGoal(view);
    if (!plan || !intent || intent.type !== 'move') return intent;
    if (plan.hold.has(me.ref)) return {type: 'wait', why: 'team: wait for squad'};
    return intent;
  }
}
function spacingCost(t, mates, plan) {
  let c = 0;
  for (const m of mates) { const d = dist(t, m); if (d <= 2) c += (3 - d) * (plan?.threat ? TUNING.spacing : TUNING.spacingCalm); }
  return c;
}
