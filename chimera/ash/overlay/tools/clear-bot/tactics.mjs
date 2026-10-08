// Clear bot tactics (docs/CLEAR_BOT.md): estimates the policy scores options with. Everything is computed from the
// view: the enemies' public cards and positions, the map, and the rules' own geometry (sight, shot lines, cover).
// Numbers are expectations for one round; they only have to rank options, not predict the dice.
import {coverEffects} from '../../src/cover.js';
import {ammoMultiplier,PROJECTILE_AMMO} from '../../src/ammunition.js';
import {bandPenalty} from '../../src/range-band.js';
import {volleyShots} from '../../src/weapons.js';
import {pelletsAt,pelletChance} from '../../src/shotgun.js';
import {actorStat} from '../../src/actor-stats.js';
import {sizeModifier,movementModifier,activeTrait} from '../../src/traits.js';
import {ENEMY_TYPES} from '../../src/data.js';
import {dist,clamp,key} from './util.mjs';
import {hazardAt} from './perception.mjs';

// ---- geometry ------------------------------------------------------------------------------------------------------
// Can `e` shoot the tile `t`? Sight plus a clear shot line, with the tile standing in for us (not an actor, so the rules
// treat any lean as open: a slightly pessimistic answer at corners).
export function lineOpen(g,from,t){
 const tile={x:t.x,y:t.y};
 return g.sight(from,tile)&&g.shotClear(from,tile);
}
// Can `e` actually see us on `t`? A line, and not the black: someone standing in the black is hidden, even next to it,
// from an enemy without night vision, unless it has infrared or is a machine (both find anything warm).
export function seesTile(view,e,t){
 if(!cachedLine(view,e,t))return false;
 if(view.light&&view.light(t)===view.LIGHT.black&&!e.nv&&!e.ir&&!e.mech)return false;
 return true;
}
const lineCache=new WeakMap();
export function cachedLine(view,e,t){
 let c=lineCache.get(view);if(!c){c=new Map();lineCache.set(view,c);}
 const k=`${e.id}|${t.x},${t.y}`;if(c.has(k))return c.get(k);
 const v=lineOpen(view.g,e.ref||e,t);c.set(k,v);return v;
}

// ---- incoming ------------------------------------------------------------------------------------------------------
// Expected hit points lost at tile `t` from enemy `e`, split into `now` (the round after our next action) and `soon`
// (the round after that, if we stay in its line). `moved`: we stepped this action; `guard`: we waited.
export function incoming(view,e,t,{moved=false,guard=false}={}){
 const g=view.g,me=view.me,p=me.ref,out={now:0,soon:0};
 if(e.civilian||e.disabled||e.hp<=0)return out;
 const d=dist(e,t);
 if(e.bomber){if(d<=1)out.now=30*(guard?.5:1);else if(d<=3)out.soon=15;return out;}
 // A swarm boss's (or a delisted berserker's) reach beyond its bite: the tongue (a lane up to 5, drags and bites) and
 // the charge (its row or column, 2-8 tiles, knocks aside); both telegraphed a round ahead, so they count as `soon`.
 const card=ENEMY_TYPES[e.type]||{};
 if(card.tongue&&d>=2&&d<=5&&seesTile(view,e,t))out.soon+=28;
 if(card.specials?.includes('charge')&&(!card.chargeBelow||e.hp<e.maxHp/2)&&(e.x===t.x||e.y===t.y)&&d>=2&&d<=8&&seesTile(view,e,t))out.soon+=22;
 if(e.melee){
  const reach=1+(e.fast?1:0);
  const blow=Math.max(1,e.damage-me.armor)*(guard?.5:1)*.9;
  if(d<=1&&g.canCross(e,t)){out.now=e.charge?blow:blow*.35;out.soon=blow;}
  else if(d<=reach+1)out.soon=blow*(d<=reach?.8:.4);
  return out;
 }
 if(e.sniper){
  if(e.charge&&e.aim){if(e.aim.x===t.x&&e.aim.y===t.y)(e.windup<=1?out:out).now+=e.windup<=1?e.damage*.9:0;if(e.windup>1&&e.aim.x===t.x&&e.aim.y===t.y)out.soon=e.damage*.9;}
  else if(d<=e.range&&seesTile(view,e,t))out.soon=e.damage*.5;
  return out;
 }
 if(d>e.range)return out;
 if(!seesTile(view,e,t))return out;
 // In the dark (dim, or black for an enemy that still finds us there) a shooter without night vision is at −40.
 const darkPenalty=view.light&&view.light(t)<view.LIGHT.lit&&!e.nv?40:0;
 const cover=g.protectingCover({x:t.x,y:t.y,traits:p.traits},e.ref||e),fx=coverEffects(cover,t,e);
 const movePenalty=moved?Math.max(0,22+movementModifier(p)):0;
 // A boss's designator paint on us (the `designated` trait, shown on our status): +15 to hit, +20% damage for everyone.
 const painted=activeTrait(p,'designated');
 const chance=clamp(97+(ENEMY_TYPES[e.type]?.combat?.rangedAccuracy||0)-fx.penalty-movePenalty-(guard?15:0)-bandPenalty(e.band,d)+sizeModifier(p)-actorStat(p,'rangedEvasion')+(painted?15:0)-darkPenalty,10,99)/100;
 const ammo=PROJECTILE_AMMO[ENEMY_TYPES[e.type]?.projectile],mult=ammo?ammoMultiplier(ammo,me.armor):null;
 const perRound=e.damage/Math.max(1,e.rounds);
 let hit=Math.max(1,mult===null?perRound-me.armor:perRound*mult)*(1-fx.reduction)*(painted?1.2:1);
 if(guard)hit*=.5;
 const total=hit*chance*e.rounds;
 if(e.charge)out.now=total;else out.soon=total;
 out.soon=Math.max(out.soon,total);
 return out;
}
// Everything that threatens tile `t`: enemies in sight, remembered ones (half weight), telegraphs and standing hazards.
export function threatAt(view,t,opts={}){
 let now=0,soon=0;
 for(const e of view.enemies){const r=incoming(view,e,t,opts);now+=r.now;soon+=r.soon;}
 for(const e of view.ghosts){if(e.melee||dist(e,t)>e.range+1)continue;soon+=Math.min(12,e.damage*.3);
  // A sniper we lost sight of aims at a tile: standing still in its reach is what it waits for.
  if(e.type==='sniper'&&!opts.moved)soon+=e.damage*.4;}
 const danger=view.danger.get(key(t));
 if(danger){if(danger.t<=0)now+=Math.max(20,danger.dmg);else soon+=Math.max(15,danger.dmg);}
 now+=hazardAt(view.g,t.x,t.y);
 return {now,soon};
}

// ---- outgoing ------------------------------------------------------------------------------------------------------
// Probability that `n` rounds with hit chance `p`, each dealing a uniform [a,b], total at least `hp`.
export function killChance(n,p,a,b,hp){
 if(hp<=0)return 1;if(n<=0||p<=0)return 0;
 let total=0,comb=1;
 for(let k=0;k<=n;k++){
  if(k>0)comb=comb*(n-k+1)/k;
  const pk=comb*p**k*(1-p)**(n-k);
  const lo=k*a,hi=k*b;const pass=k===0?0:lo>=hp?1:hi<hp?0:(hi-hp+1)/(hi-lo+1);
  total+=pk*pass;
 }
 return clamp(total,0,1);
}
// What our weapon in `slot` does to `e` from our current tile this round: {chance, rounds, a, b, expected, kill}.
// Our own hit chance is the target card's number (Game.accuracy) for the gun in hand; another gun is estimated from it.
// `loaded`: judge the gun as if its magazine were full (a gun in the pack we would switch to and reload first).
export function shotAt(view,e,slot,{loaded=false}={}){
 const g=view.g,me=view.me,p=me.ref,w=g.weaponAt(slot),d=dist(me,e);
 if(!w||d>w.range)return null;
 const target=e.ref;
 if(w.melee){
  if(d>(w.range||1)||!g.canCross(p,target)&&!w.thrust)return null;
  const chance=g.meleeAccuracy(p,target,w.hitChance)/100,dmg=g.weaponDamage(slot,target);
  const a=Math.max(1,dmg.min-e.armor*(1-(w.pierce||0))),b=Math.max(1,dmg.max-e.armor*(1-(w.pierce||0)));
  const hits=w.hits||1;
  return {chance,rounds:hits,a,b,expected:hits*chance*(a+b)/2,kill:killChance(hits,chance,a,b,e.hp),melee:true};
 }
 if(!g.shotClear(p,target))return null;
 if(w.pointTarget)return null;   // launchers and flamers are scored as area attacks
 const ammo=p.ammo[slot]??0;
 if(w.pellets){
  const count=pelletsAt(w,d),chance=pelletChance(w)/100,dmg=g.pelletDamage(slot,target);
  const cover=g.protectingCover(target,p),eff=coverEffects(cover,target,p).efficiency;
  const mult=ammoMultiplier('shell',e.armor,w.pierce||0)??1,cut=1-(w.pelletCover||0)*eff;
  const a=Math.max(1,Math.round(dmg.min*cut*mult)),b=Math.max(1,Math.round(dmg.max*cut*mult));
  if(ammo<1)return null;
  return {chance,rounds:count,a,b,expected:count*chance*(a+b)/2,kill:killChance(count,chance,a,b,e.hp),cone:true};
 }
 const rounds=volleyShots(w,d,loaded?Math.max(ammo,w.mag):ammo);if(!rounds)return null;
 let chance;
 if(slot===p.weapon)chance=g.accuracy(p,target).chance;
 else{const held=g.accuracy(p,target),hw=g.weapon;chance=held.chance-(hw.accuracyBonus||0)-(held.closeBonus||0)+(held.rangePenalty||0)+(held.aimPenalty||0)+(w.accuracyBonus||0)-bandPenalty(w.band,d)-(w.aimPenalty&&!p.focus?w.aimPenalty:0);chance=clamp(chance,10,99);}
 chance/=100;
 const dmg=g.weaponDamage(slot,target),cover=g.protectingCover(target,p),fx=coverEffects(cover,target,p),pierce=w.pierce||0;
 const mult=w.explosive?null:ammoMultiplier(w.ammoType,e.armor,pierce);
 const cut=(1-fx.reduction*(1-pierce))*(w.ammoType==='energy'&&e.mechanical?1.2:1)*(activeTrait(target,'exposed')?1.1:1);
 const one=v=>Math.max(1,Math.round(mult===null?v*cut-e.armor*(1-pierce):v*cut*mult));
 const a=one(dmg.min),b=one(dmg.max);
 return {chance,rounds,a,b,expected:rounds*chance*(a+b)/2,kill:killChance(rounds,chance,a,b,e.hp)};
}
// How much an enemy matters: what it would deal us over the next few rounds if left alone.
export function enemyValue(view,e){
 if(e.civilian)return 0;
 if(e.expendable)return e.damage*2;   // fodder and brood: 6 health, bites of 2-4
 const perRound=e.bomber?30:e.damage*(e.melee?.8:.6);
 // Force multipliers first (docs/SQUAD.md, docs/REBELS.md): the squad leader keeps its squad 已就緒 (+15 to hit, half
 // damage taken); the enforcer's rally fires every aiming rebel at once.
 const lead=e.type==='squad_leader'?1.6:e.type==='enforcer'?1.3:1;
 return (perRound*(e.boss?4:3)+(e.charge?perRound:0)+(e.sniper?10:0))*lead;
}
// Blast (frag, launcher) on `center`: expected damage and kills, and whether it would catch us, allies or civilians.
export function blastValue(view,center,{radius,damage,falloff=10,chebyshev=false}){
 const g=view.g,me=view.me;let value=0,kills=0,self=0,friendly=0,civ=0;
 const within=o=>chebyshev?Math.max(Math.abs(o.x-center.x),Math.abs(o.y-center.y))<=radius:dist(o,center)<=radius;
 for(const e of view.enemies){if(!within(e))continue;const dmg=Math.max(1,damage-dist(center,e)*falloff);value+=Math.min(dmg,e.hp)/Math.max(1,e.hp)*enemyValue(view,e);if(dmg>=e.hp){kills++;value+=enemyValue(view,e)*.5;}}
 for(const e of view.civilians)if(within(e))civ++;
 for(const a of view.allies)if(within(a))friendly+=Math.max(1,damage-dist(center,a)*falloff);
 if(within(me))self=Math.max(1,damage-dist(center,me)*falloff);
 return {value,kills,self,friendly,civ};
}
