// Clear bot: the recon (docs/CHARACTERS.md, docs/SKILLS.md). SMG with free reloads, sidestep, night vision and infrared.
// Two answers to a crossfire: 訊號斷層 signal break (free, 3 turns in which enemies cannot see it) and a smoke grenade
// thrown between itself and the shooters — its infrared sees through the cloud, most enemies do not.
import {ready,skillIntent,hostiles,dist,exposureAt,throwIntent,throwSpot,stayCost} from './common.mjs';
import {inSmoke} from '../../../src/melee-classes.js';
export default {
 perks:{recon_unseen:62,recon_sidestep:58,recon_blackout:55,steady:40},
 prepare(view,bot){
  const me=view.me,ex=exposureAt(view,me),hurt=me.hp/me.maxHp;
  const losing=bot.outlook?.losing||bot.plan?.kind==='retreat';
  if(ready(me,'signal_break')&&(ex.open>=2||ex.see>=2&&hurt<.6||ex.see>=1&&hurt<.35||losing&&ex.see>=1))return skillIntent('signal_break','break contact');
  return null;
 },
 combat(view){
  const me=view.me,g=view.g,out=[];
  if(me.grenades.smoke>0&&!inSmoke(g,me)&&!me.signalBreak){
   const ex=exposureAt(view,me);
   const shooters=hostiles(view).filter(e=>!e.melee&&dist(e,me)<=e.range+1);
   if(ex.open>=2||ex.open>=1&&me.hp<me.maxHp*.5&&shooters.length){
    // Between us and them: two tiles along the average direction, or our own tile when they are close.
    const cx=shooters.reduce((a,e)=>a+e.x,0)/shooters.length,cy=shooters.reduce((a,e)=>a+e.y,0)/shooters.length;
    const len=Math.max(1,Math.hypot(cx-me.x,cy-me.y)),goal={x:Math.round(me.x+(cx-me.x)/len*1.5),y:Math.round(me.y+(cy-me.y)/len*1.5)};
    const at=throwSpot(view,goal)||me;
    out.push(throwIntent(view,'smoke',at,'smoke screen',12+ex.open*8-stayCost(view)*.5));
   }
  }
  return out;
 },
};
