// beta：團隊協調的 PVP 機器人（pvp/DESIGN.md）。每個階段由這一隊第一個行動的人替整隊做一個計畫（存在 g 上、以 g.turn 當鍵），
// 每個人再照計畫行動：
//   - 威脅模型換成真的職業武器（對方的替身在 ASH 裡都是「破口突擊兵」的卡片：射程 5、傷害 21，比真的步槍、輕機槍弱很多）。
//   - 集火：整隊挑同一個目標（打得死、血少、威脅大的優先）。
//   - 隊形：不擠在手榴彈範圍裡、不排成一直線；推進時等落後的人（不一個一個送進對方的火線）。
//   - 守點：剛交火、對方知道我們在哪時，待在好的格子 wait（防守加成），讓對方走進整隊的火力裡。
import {PvpBot} from '../match.mjs';
import {teamPlan, patchView} from './beta-team.mjs';
import {dist, key} from '../../clear-bot/util.mjs';
import {route, exploreRoute} from '../../clear-bot/nav.mjs';

export default class Beta extends PvpBot {
  decide(view) {
    patchView(view);
    this.team = teamPlan(this.g, view, this);
    return super.decide(view);
  }
  // combatOptions 的結果在這裡（pickBest 之前）照團隊計畫調分數
  stance(view, opts) {
    const plan = this.team, me = view.me, g = this.g;
    const mates = plan ? plan.members.filter(m => m !== me.ref) : [];
    for (const o of opts) {
      // 集火
      if (plan?.focus && (o.type === 'fire' || o.then?.type === 'fire') && (o.target ?? o.then?.target) === plan.focus) o.score += plan.focusBonus;
      if (plan?.focus && o.type === 'move' && o.target === plan.focus) o.score += plan.focusBonus * .7;
      // 隊形：移動到隊友手榴彈範圍內（2 格）扣分，跟隊友同一行／列扣一點
      if (o.type === 'move' && !o.target && o.arg) {
        const t = {x: me.x + o.arg[0], y: me.y + o.arg[1]};
        o.score -= spacingCost(t, mates, plan);
      }
    }
    return super.stance(view, opts);
  }
  // 沒看到敵人：照團隊的推進計畫走
  chooseGoal(view) {
    const plan = this.team, me = view.me;
    const intent = super.chooseGoal(view);
    if (!plan || !intent || intent.type !== 'move') return intent;
    // 推進時跑太前面就等（落後的人跟上）
    if (plan.hold && plan.hold.has(me.ref)) return {type: 'wait', why: 'team: wait for squad'};
    const t = {x: me.x + intent.arg[0], y: me.y + intent.arg[1]};
    const mates = plan.members.filter(m => m !== me.ref);
    if (mates.some(m => m.x === t.x && m.y === t.y)) return intent;
    return intent;
  }
}
function spacingCost(t, mates, plan) {
  let c = 0;
  for (const m of mates) {
    const d = dist(t, m);
    if (d <= 2) c += (3 - d) * (plan?.threat ? 4 : 1.5);
  }
  return c;
}
