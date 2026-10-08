// Clear bot class helpers (docs/CLEAR_BOT.md).
import {dist,key,neighbours} from '../util.mjs';
import {threatAt,enemyValue,cachedLine} from '../tactics.mjs';
import {hpWeight,damageCost} from '../combat.mjs';
import {exposureAt} from '../stance.mjs';

export const hostiles=view=>view.enemies.filter(e=>!e.civilian&&!e.disabled);
export const ready=(me,id)=>Boolean(me.skills[id])&&me.prepared.skill===id&&!me.skills[id].remaining&&!me.skills[id].cooldown;
export const skillIntent=(id,why,extra={})=>({type:'skill',arg:id,why,...extra});
// A thrown grenade of `kind` at `at`: prepare it first (free) when another is in the slot.
export function throwIntent(view,kind,at,why,score){
 return {type:'grenade',arg:{x:at.x,y:at.y},pre:view.me.prepared.grenade!==kind?{type:'prepare',arg:{category:'grenade',id:kind}}:null,score,why};
}
// The cost of standing where we are for the round, in the combat scorer's units.
export function stayCost(view){
 const me=view.me,t=threatAt(view,me,{moved:false});
 return damageCost(me,t);
}
// Enemies within `r` of a tile.
export const near=(view,t,r)=>hostiles(view).filter(e=>dist(e,t)<=r);
// A floor tile within `range` of us we can see, nearest to `goal`, for a throw.
export function throwSpot(view,goal,range=5){
 const g=view.g,me=view.me;let best=null;
 for(let y=goal.y-2;y<=goal.y+2;y++)for(let x=goal.x-2;x<=goal.x+2;x++){
  const q={x,y};if(g.grid[y]?.[x]!==1||dist(q,me)>range||!g.visible(q))continue;
  const s=dist(q,goal);if(!best||s<best.s)best={s,q};
 }
 return best?.q||null;
}
export {dist,key,neighbours,threatAt,enemyValue,cachedLine,hpWeight,exposureAt};
