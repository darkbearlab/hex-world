// Clear bot: the ninja (docs/MELEE_CLASSES.md, docs/CLASS_PERKS.md). The katana hits ×1.5 from ambush — the target
// stunned, either of them in smoke, the target unaware, or the ninja in the dark — so the ninja makes its own ambush:
// smoke at its own feet (enemies outside cannot see in, its infrared sees out), a stun grenade at its own feet when
// several are close (close_throw: its own stun and EMP spare it), camouflage (free, −30 to be hit) on engaging, and the
// SMG inside 3 tiles where point_blank ignores cover.
import {hostiles,ready,skillIntent,dist,throwIntent,stayCost,enemyValue,hpWeight} from './common.mjs';
import {ambushReady,ambushMultiplier,inSmoke} from '../../../src/melee-classes.js';
export default {
 perks:{ninja_ambush:66,ninja_shadowstep:64,ninja_overload:60,melee:50,health:55},
 prepare(view){
  const me=view.me;
  if(ready(me,'camouflage')&&hostiles(view).some(e=>dist(e,me)<=6&&!e.melee||dist(e,me)<=2))return skillIntent('camouflage','camouflage');
  return null;
 },
 // Close in with the blade while the ninja is hard to hit: camouflage on (or ready), or standing in the dark (its night
 // vision sees, most enemies do not; and the dark makes every cut an ambush), and not badly hurt.
 meleeMode(view){const me=view.me;return me.hp>=me.maxHp*.5&&(me.camo||ready(me,'camouflage')||me.dark);},
 meleeBonus(view,e,sh){return ambushReady(view.g,e.ref)?sh.expected*(ambushMultiplier(view.me.ref)-1)/Math.max(1,e.hp)*enemyValue(view,e)*.6:0;},
 combat(view){
  const g=view.g,me=view.me,out=[],close=hostiles(view).filter(e=>dist(e,me)<=2),bio=close.filter(e=>!e.mechanical&&!e.boss);
  if(me.grenades.stun>0&&bio.length>=2)out.push(throwIntent(view,'stun',me,'stun at own feet',12*bio.length-stayCost(view)*.3));
  if(me.grenades.smoke>0&&!inSmoke(g,me)&&hostiles(view).some(e=>dist(e,me)<=3)){
   const shooters=hostiles(view).filter(e=>!e.melee&&dist(e,me)<=e.range).length;
   out.push(throwIntent(view,'smoke',me,'smoke at own feet',6+shooters*5-stayCost(view)*.3));
  }
  return out;
 },
};
