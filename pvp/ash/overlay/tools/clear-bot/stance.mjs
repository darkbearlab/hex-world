// Clear bot stance (docs/CLEAR_BOT.md): committed multi-turn plans in a fight, the way the player fights — fall back
// out of a crossfire to a tile where at most one enemy can see us or cover faces them, then hold it and shoot what comes
// through; or walk to a firing tile when nothing is in reach. A plan is kept until it is done or a break condition
// fires, as the game's own enemy orders are (docs/ORDERS.md: what, how long, when to give up), so the bot does not flip
// between two greedy choices every turn.
import {dist,key} from './util.mjs';
import {cachedLine,seesTile,incoming,shotAt} from './tactics.mjs';
import {lineReason} from '../../src/lines.js';
import {route,walkable} from './nav.mjs';
import {hazardAt} from './perception.mjs';
import {coverEffects} from '../../src/cover.js';

export const STANCE_TUNING={bonus:9,holdPatience:4,fallbackCost:10,planTurns:8,margin:6};

// Who could hurt us on tile `t`: `see` counts the enemies that can shoot it (ranged, in range, with a line) or are next
// to it (melee); `open` those of them we have no cover from (melee next to us is always open).
export function exposureAt(view,t){
 const g=view.g,out={see:0,open:0,melee:0};
 for(const e of view.enemies){
  if(e.civilian||e.disabled)continue;
  if(e.melee||e.bomber){if(dist(e,t)<=1){out.see++;out.open++;out.melee++;}continue;}
  if(e.sniper&&!(e.charge&&e.aim))continue;   // a sniper only threatens the tile it aims at (its telegraph)
  if(dist(e,t)>e.range||!seesTile(view,e,t))continue;
  out.see++;
  const cover=g.protectingCover({x:t.x,y:t.y,traits:view.me.ref.traits},e.ref);
  if(coverEffects(cover,t,e).efficiency<.5)out.open++;
 }
 return out;
}
// How good a tile is to fight from: few enemies on it, none of them uncovered, and one we can shoot.
export function tileQuality(view,t,ex=exposureAt(view,t),ourLine,{hide=false}={}){
 const w=view.me.held;let engage=0;
 for(const e of view.enemies){if(e.civilian)continue;const d=dist(e,t);
  if(w?.melee){if(d===1)engage++;continue;}
  if(w&&d<=w.range&&ourLine(view,t,e))engage++;}
 const danger=view.danger.get(key(t));
 // Hiding (retreat): out of every line is what counts; a tile that still lets us shoot is no longer worth anything extra.
 if(hide)return -30*ex.see-10*ex.open-(danger?60:0)-hazardAt(view.g,t.x,t.y)*2;
 return -14*ex.open-5*(ex.see-ex.open)+(engage===1?6:engage>1?3:0)-(danger?60:0)-hazardAt(view.g,t.x,t.y)*2;
}
// Where to fall back to: the best tile within a few steps by tileQuality, paying for each step and for steps taken in
// an uncovered line. Null when nothing beats staying by the margin.
export function fallbackTile(view,ourLine,{maxCost=STANCE_TUNING.fallbackCost,hide=false}={}){
 const me=view.me,here=tileQuality(view,me,undefined,ourLine,{hide});
 const openCost=q=>{const ex=exposureAt(view,q);return ex.open*3+(view.danger.get(key(q))?40:0)+hazardAt(view.g,q.x,q.y);};
 let best=null,count=0;
 route(view,q=>{
  if(++count>(hide?220:120))return true;
  const s=tileQuality(view,q,undefined,ourLine,{hide})-1.2*dist(q,me);
  if(!best||s>best.s)best={s,q:{x:q.x,y:q.y}};
  return false;
 },{cost:openCost,maxCost});
 if(!best||best.s<here+STANCE_TUNING.margin)return null;
 return {to:best.q,score:best.s,here};
}
// The next step of a plan. The path is chosen once and then followed while its next tile stays free and safe, so a
// route that would change with every enemy stepping in and out of sight does not change the plan.
export function planStep(view,plan){
 if(!plan?.to)return null;
 const g=view.g,me=view.me;
 if(plan.path){
  const i=plan.path.findIndex(q=>q.x===me.x&&q.y===me.y),next=i>=0?plan.path[i+1]:plan.path[0]&&dist(plan.path[0],me)===1?plan.path[0]:null;
  if(next&&walkable(view,next.x,next.y)&&!view.occupied.has(key(next))&&!(view.danger.get(key(next))?.t<=0))return {first:[next.x-me.x,next.y-me.y],path:plan.path};
 }
 const openCost=q=>{const ex=exposureAt(view,q);return ex.open*3+(view.danger.get(key(q))?40:0)+hazardAt(g,q.x,q.y);};
 const r=route(view,q=>q.x===plan.to.x&&q.y===plan.to.y,{cost:openCost,maxCost:40});
 if(r)plan.path=[{x:me.x,y:me.y},...r.path];
 return r;
}
// Should we leave this tile? Two or more uncovered lines on us, three enemies on us at all, or one uncovered line while
// hurt; unless an attack right now very likely kills the one uncovered enemy.
// 2026-09-30 yardstick: the player stands with no uncovered line on it 61% of its combat actions; so any uncovered line
// is a reason to look for cover nearby (fallbackTile only moves when a clearly better tile is close).
// Retreat: badly hurt with enemies on us — break every line of sight, not just find cover.
export const shouldHide=(view,ex)=>view.me.hp<view.me.maxHp*.35&&ex.see>=1&&ex.see+ex.open>=2;
export function shouldFallBack(view,ex,bestAttack){
 const me=view.me,hurt=me.hp/me.maxHp;
 if(ex.open>=1||ex.see>=3){
  if(ex.open<=1&&ex.see<=2&&bestAttack&&bestAttack.kill>=.75&&hurt>=.45)return false;
  return true;
 }
 return false;
}

// Can we win the fight in front of us? Every enemy engaging us deals its round's damage until it dies; we kill them one
// at a time, the most dangerous per turn of killing first, at our best expected damage per round from here. If what we
// would take before the last one falls is most of what we have (health, half the plates, most of our medkits), the
// fight is lost at any health: leave now, while we still can (the user: runs die to a threat that had to be removed and
// survived a few misses). A threat we cannot hurt from here (armour our gun does not get through, a boss) counts as a
// long fight.
export function fightOutlook(view){
 const me=view.me,g=view.g,here={x:me.x,y:me.y},list=[];
 for(const e of view.enemies){
  if(e.civilian||e.disabled||e.hp<=0)continue;
  const d=dist(e,me);if(e.melee?d>4:(d>e.range+2||!seesTile(view,e,here)))continue;
  const r=incoming(view,e,here);const rate=Math.max(r.now,r.soon);if(rate<=0)continue;
  let dps=0;for(const w of me.weapons){const sh=shotAt(view,e,w.slot);if(sh)dps=Math.max(dps,sh.expected);}
  if(!dps&&d>1)dps=me.weapons.some(w=>!w.melee&&w.range>=d)?4:0;   // out of line from here: assume a slow fight
  list.push({e,rate,ttk:e.hp/Math.max(3,dps)});
 }
 list.sort((a,b)=>b.rate/b.ttk-a.rate/a.ttk);
 let time=0,projected=0;for(const x of list){time+=x.ttk;projected+=x.rate*time;}
 const hpEff=me.hp+me.plates/2+Math.min(me.meds,3)*30;
 return {engaged:list.length,projected,hpEff,losing:list.length>0&&projected>hpEff*.75,worst:list[0]?.e||null};
}
// An escape by line (docs/ITEMS.md: a straight pull up to 6 tiles to a floor tile we can see): the free escape line
// first, the redeploy line (one turn) when it is all we have. To the tile out of every line that is best by tileQuality.
export function ropeEscape(view,ourLine){
 const g=view.g,me=view.me,item=me.escapeLines>0?'escape_line':me.redeployLines>0?'redeploy_line':null;if(!item)return null;
 let best=null;
 for(let y=me.y-6;y<=me.y+6;y++)for(let x=me.x-6;x<=me.x+6;x++){
  const q={x,y};if(dist(q,me)<2||dist(q,me)>6||lineReason(g,{x,y,item}))continue;
  const ex=exposureAt(view,q);if(ex.see>0)continue;
  const s=tileQuality(view,q,ex,ourLine,{hide:true})+dist(q,me)*.5;
  if(!best||s>best.s)best={s,q};
 }
 return best?{type:'rope',arg:{x:best.q.x,y:best.q.y,item},why:`${item} to ${best.q.x},${best.q.y}`}:null;
}
