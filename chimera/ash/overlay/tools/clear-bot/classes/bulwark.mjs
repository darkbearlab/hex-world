// Clear bot: the bulwark (docs/BULWARK.md). 200 health, armour 6, heavy armour, a 100-round light machine gun and the
// power fist (bumps swing it; switching to it is free). 下錨 anchor (a turn to set, a turn to lift) doubles every attack
// but pins it in place: the bot sets it when it holds a tile with targets in reach and nothing forcing it to move, and
// lifts it for a telegraph on its tile, a crossfire, or when the fight is over.
import {hostiles,exposureAt,dist,stayCost} from './common.mjs';
const fightOn=(view)=>hostiles(view).some(e=>dist(e,view.me)<=8);
export default {
 perks:{bulwark_anchor:62,bulwark_plating:60,plate_rack:58,bulwark_recovery:52,health:55,steady:40},
 prepare(view,bot){
  const me=view.me;if(!me.anchored)return null;
  const danger=view.danger.get(`${me.x},${me.y}`);
  const ex=exposureAt(view,me);
  if(!fightOn(view)){bot.calm=(bot.calm||0)+1;}else bot.calm=0;
  if(danger||ex.open>=2&&ex.see>=3||bot.calm>=2||me.hp<me.maxHp*.3)return {type:'skill',arg:'anchor',why:'lift anchor'};
  return null;
 },
 combat(view,bot){
  const me=view.me,out=[];
  if(me.anchored||!me.skills.anchor||me.prepared.skill!=='anchor')return out;
  const ex=exposureAt(view,me);if(ex.open>=2||view.danger.has(`${me.x},${me.y}`))return out;
  const targets=hostiles(view).filter(e=>!e.melee&&dist(e,me)<=(me.held?.range||7));
  const hp=targets.reduce((a,e)=>a+e.hp,0);
  if(targets.length&&hp>=60&&(bot.plan?.kind==='hold'||ex.see<=1))out.push({type:'skill',arg:'anchor',score:Math.min(30,hp/6)-stayCost(view),why:'set anchor'});
  return out;
 },
 quiet(view){if(view.me.anchored)return {type:'skill',arg:'anchor',why:'lift anchor (quiet)'};return null;},
};
