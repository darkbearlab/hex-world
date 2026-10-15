// Clear bot: the berserker (docs/MELEE_CLASSES.md), played the way the user plays it (qa/run-logs README on
// claude/bot-yardstick): the grapple on cooldown at 3-7 tiles as the main attack — it pulls a shooter out of its cover
// into axe reach (or dashes the berserker to something large) and strikes at once, cancelling whatever it was winding up
// — axe bumps between grapples, the shotgun only to open, lifesteal (嗜血) doing most of the healing, a medkit near 40%.
import {hostiles,ready,stayCost,dist,enemyValue,hpWeight,exposureAt} from './common.mjs';
import {incoming,killChance} from '../tactics.mjs';
import {MELEE_TUNING} from '../../../src/melee-classes.js';
const lifesteal=(view,dmg)=>Math.floor(dmg*(MELEE_TUNING.bloodlust+.08*(view.me.ref.perks?.berserker_thirst||0)));
export default {
 perks:{berserker_thirst:85,berserker_fury:58,berserker_endure:56,health:62,melee:55,plate_rack:40},
 stance:{shouldFallBack:(view,ex)=>view.me.hp<view.me.maxHp*.3&&ex.open>=2},
 meleeBonus(view,e,sh){return lifesteal(view,sh.expected)*hpWeight(view.me,0)*.8;},
 combat(view,bot){
  const g=view.g,me=view.me,out=[];
  if(!ready(me,'grapple'))return out;
  const slot=g.bumpMeleeSlot(),w=g.weaponAt(slot),cost=stayCost(view);
  for(const e of hostiles(view)){
   const d=dist(e,me);if(d<2||d>5)continue;
   const plan=g.grapplePlan(e.id);if(plan.reason)continue;
   const chance=g.meleeAccuracy(me.ref,e.ref,w.hitChance)/100,dmg=g.weaponDamage(slot,e.ref),pierce=w.pierce||0;
   const a=Math.max(1,Math.round(dmg.min-e.armor*(1-pierce))),b=Math.max(1,Math.round(dmg.max-e.armor*(1-pierce))),exp=chance*(a+b)/2;
   const kill=killChance(w.hits||1,chance,a,b,e.hp),value=enemyValue(view,e);
   const gain=kill*value*1.3+(1-kill)*value*.8*Math.min(1,exp/Math.max(1,e.hp))+lifesteal(view,exp)*hpWeight(me,0)*.8;
   const prevented=plan.dash?0:incoming(view,e,me).now*hpWeight(me,0);   // pulled off its tile: its wound-up attack is dropped
   const after=(1-kill)*(e.melee?e.damage*.5:e.damage*.3);
   out.push({type:'skill',arg:'grapple',target:e.id,score:gain+prevented-cost-after+4,attack:true,kill,enemy:e.id,why:`grapple ${e.type}@${e.x},${e.y} k${kill.toFixed(2)}${plan.dash?' dash':''}`});
  }
  return out;
 },
};
