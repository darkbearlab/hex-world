// Clear bot combat (docs/CLEAR_BOT.md): with enemies in sight, every option the bot could take this round is scored
// in one unit — hit points, ours lost and theirs prevented — and the best one becomes the intent. One-round lookahead:
// what the option deals, what it stops (a wound-up shot from an enemy we kill before it acts), and what we take for it
// standing where the option leaves us (moving is harder to hit, waiting halves damage, cover cuts both).
import {dist,key,neighbours,clamp} from './util.mjs';
import {incoming,threatAt,shotAt,enemyValue,blastValue,cachedLine,killChance} from './tactics.mjs';
import {walkable,crossable,route,safeCost} from './nav.mjs';
import {hazardAt} from './perception.mjs';
import {weaponSwitchTurns} from '../../src/prepared.js';
import {GRENADES} from '../../src/throwables.js';
import {launchReason} from '../../src/game-actions.js';
import {swapReason} from '../../src/allies.js';
import {bandPenalty} from '../../src/range-band.js';
import {coverEffects} from '../../src/cover.js';

// How much one hit point of ours is worth: more when we are low.
export function hpWeight(me,expected=0,hp=me.hp){return 1+2.5*(1-Math.min(me.maxHp,hp)/Math.max(1,me.maxHp))**2;}
// What standing somewhere costs for the round, in hit points: the expected damage (weighted by how low we are), plus a
// death term — the chance that a bad roll of this round's damage (and, at a third of the weight, the next round's too)
// takes all we have. `heal` is health gained before the enemies act (a medkit used this action).
export const DEATH=120;
export function damageCost(me,t,{heal=0,soonWeight=TUNING.soonWeight}={}){
 const hp=Math.min(me.maxHp,me.hp+heal),w=hpWeight(me,0,hp);
 const risk=d=>{if(d<=0)return 0;const eff=hp+Math.min(me.plates,d/2);return clamp((d*1.7-eff)/(d*1.4+1),0,1);};
 return t.now*w+soonWeight*t.soon*w+DEATH*risk(t.now)+DEATH*.35*risk(t.now+t.soon);
}
// Does `e` act after us this round? Fast → normal → slow, the player first at the same speed (docs/TRAITS.md). A slow
// player (the bulwark) acts after every normal-speed enemy, so killing one does not stop its shot.
const acts=(view,e)=>view.me.slow?Boolean(e.slow):!e.fast;
// partial: what damage short of a kill is worth, as a share of the enemy's value per share of its health taken — a fight
// is shortened by every point dealt, so most of it (a kite that never attacks is the failure it prevents).
export const TUNING={partial:.8,soonWeight:.55,moveFuture:.45,ammoPenalty:.4,grenadeReserve:12,healAt:.55,switchDiscount:.55};

const edge3=(gain,held,reload)=>(reload?1:2)*gain-3*held-6;
// The intents the combat options produce are plain objects the executor understands:
// {type, arg, target, why, score}. `type` is a game action; `target` is set as the lock first.
export function combatOptions(view,bot){
 const g=view.g,me=view.me,opts=[];
 const hostile=view.enemies.filter(e=>!e.civilian);
 const here={x:me.x,y:me.y};
 const stay=threatAt(view,here,{moved:false}),guard=threatAt(view,here,{guard:true});
 const free=me.pursuit;   // a pursuit attack does not advance the round
 const exposure=t=>damageCost(me,t);
 const stayCost=exposure(stay);

 // ---- attacks from here, with each weapon that can reach ----
 const gainBy=new Map();   // best gain per weapon slot this round, for the switch options below
 const perTarget=new Map();   // round 2: gain and expected damage per (target, slot), for long fights (bosses)
 for(const e of hostile){
  // Bump attacks: walking into an adjacent enemy swings the bump weapon (the chosen melee weapon, else the first in the
  // pack, else bare hands); another melee weapon in the pack can be chosen first, for free.
  if(dist(e,me)===1&&g.canCross(me,e.ref)){
   const bump=g.bumpMeleeSlot(),slots=[bump,...me.weapons.filter(w=>w.melee&&w.slot!==bump).map(w=>w.slot)];
   for(const slot of slots){
    const sh=shotAt(view,e,slot);if(!sh)continue;
    const value=enemyValue(view,e);
    const gain=sh.kill*value*(1+(e.boss?0:.3))+(1-sh.kill)*value*TUNING.partial*clamp(sh.expected/Math.max(1,e.hp),0,1)+(bot.cls.meleeBonus?.(view,e,sh)||0);
    const prevented=acts(view,e)?sh.kill*incoming(view,e,here).now*hpWeight(me,stay.now):0;
    opts.push({type:'move',arg:[e.x-me.x,e.y-me.y],target:e.id,pre:slot===bump?null:{type:'meleeChoice',arg:slot},score:gain+prevented-(free?0:stayCost),attack:true,kill:sh.kill,enemy:e.id,why:`bump ${e.type}@${e.x},${e.y} s${slot} k${sh.kill.toFixed(2)}`});
   }
  }
  for(const w of me.weapons){
   if(w.pointTarget||w.flame||w.melee)continue;
   const held=w.slot===me.weapon;
   // Round 2: a gun in the pack with an empty magazine but rounds in reserve still counts for a switch (then a reload).
   const empty=!held&&(w.ammo<w.shotCost)&&w.reserve>0&&!w.tank;
   const sh=shotAt(view,e,w.slot,{loaded:empty});if(!sh||sh.expected<=0)continue;
   const switchTurns=held?0:weaponSwitchTurns(g.weaponAt(w.slot),g.weapon);
   const value=enemyValue(view,e);
   let gain=sh.kill*value*(1+(e.boss?0:.3))+(1-sh.kill)*value*TUNING.partial*clamp(sh.expected/Math.max(1,e.hp),0,1);
   const prevented=acts(view,e)?sh.kill*incoming(view,e,here).now*hpWeight(me,stay.now):0;
   // Civilians in a shotgun cone: no penalty in the rules, but the bot avoids it where it can.
   const civ=sh.cone?view.civilians.filter(c=>dist(c,me)<=w.range&&dist(c,me)<=dist(e,me)+1).length:0;
   const ammoCost=w.melee?0:TUNING.ammoPenalty*(sh.rounds||1)*(w.reserve+w.ammo<w.mag?3:1)*(w.cls==='sniper'||w.cls==='plasma'?3:w.cls==='shotgun'?2:.3);
   gainBy.set(w.slot,Math.max(gainBy.get(w.slot)??-Infinity,gain+prevented-ammoCost-civ*6));
   let pt=perTarget.get(e.id);if(!pt){pt={e,by:new Map()};perTarget.set(e.id,pt);}pt.by.set(w.slot,{gain:gain-ammoCost,expected:sh.expected,empty});
   if(empty)continue;   // not fireable this round: only the switch below may use it
   if(held||switchTurns===0){
    const score=gain+prevented-(free?0:stayCost)-ammoCost-civ*6;
    const intent=held?{type:'fire',target:e.id}:{type:'weapon',arg:w.slot,then:{type:'fire',target:e.id}};
    opts.push({...intent,score,attack:true,kill:sh.kill,enemy:e.id,why:`attack ${e.type}@${e.x},${e.y} w${w.id} k${sh.kill.toFixed(2)} e${sh.expected.toFixed(0)}`});
   }
  }
 }
 // Switching guns costs this round's attack and pays over the next ones: over three rounds, keep firing the gun in hand
 // (3 × its best) or switch and fire the other twice (2 × its best).
 {
  const heldGain=Math.max(0,gainBy.get(me.weapon)??0);
  const bestHeld=Math.max(-stayCost,...opts.filter(o=>o.attack).map(o=>o.score));
  // Hysteresis: within five turns of the last paid switch only a gun in hand that does nothing is switched away from.
  const recent=view.turn-(bot.lastSwitch??-99)<5;
  for(const [slot,gain] of gainBy){
   if(slot===me.weapon||weaponSwitchTurns(g.weaponAt(slot),g.weapon)===0)continue;
   if(recent&&heldGain>2)continue;
   const reload=me.weapons.find(x=>x.slot===slot);const needsReload=reload&&reload.ammo<reload.shotCost;
   let edge=(needsReload?1:2)*gain-3*heldGain-6,why=`+${edge3(gain,heldGain,needsReload).toFixed(0)} over 3 rounds`;
   // Round 2: a long fight (a boss, anything with more health than a few rounds of our best) is judged over as many rounds
   // as it would last with the better gun: the switch costs one round of the gun in hand, the gun it switches to pays for
   // every round after. This is what makes an armour-piercing gun come out against an armoured boss.
   for(const {e,by} of perTarget.values()){
    const o=by.get(slot);if(!o||o.expected<=0)continue;
    const h=by.get(me.weapon)||{gain:0,expected:0},n=Math.min(8,Math.max(2,Math.ceil(e.hp/Math.max(1,o.expected))));
    if(n<=3)continue;
    const long=(n-1-(o.empty?1:0))*o.gain-n*Math.max(0,h.gain)-6;
    if(long>edge){edge=long;why=`+${long.toFixed(0)} over ${n} rounds on ${e.type}`;}
   }
   if(edge<=0)continue;
   opts.push({type:'weapon',arg:slot,score:bestHeld+edge*.5,why:`switch to ${g.weaponAt(slot).id} (${why})`});
  }
 }
 // ---- area attacks: grenade (prepared frag), launcher ----
 const frag=me.grenades.frag;
 if(frag>0&&!free){
  let best=null;
  for(const e of hostile){for(const c of [e,...neighbours(e)]){
   if(dist(c,me)>5||g.grid[c.y]?.[c.x]!==1||!g.visible(c))continue;
   const b=blastValue(view,c,{radius:2,damage:55+(me.ref.blastBonus||0)});
   const score=b.value-b.self*4*hpWeight(me)-b.friendly*1.5-b.civ*8-stayCost-TUNING.grenadeReserve*(frag<=1?1.6:1);
   if(!best||score>best.score)best={score,c,b};
  }}
  if(best&&best.b.value>0&&(best.b.kills>=1||best.b.value>40))opts.push({type:'grenade',arg:{x:best.c.x,y:best.c.y},pre:me.prepared.grenade!=='frag'?{type:'prepare',arg:{category:'grenade',id:'frag'}}:null,score:best.score,why:`frag ${best.b.kills}k v${best.b.value.toFixed(0)}`});
 }
 for(const w of me.weapons.filter(w=>w.pointTarget&&w.ammo>=1)){
  const held=w.slot===me.weapon;
  let best=null;const dmg=g.weaponDamage(w.slot);
  for(const e of hostile)for(const c of [e,...neighbours(e)]){
   if(dist(c,me)>w.range||g.grid[c.y]?.[c.x]!==1||!g.visible(c))continue;
   const b=w.flame?flameValue(view,w,c):blastValue(view,c,{radius:1,damage:(dmg.min+dmg.max)/2+(me.ref.blastBonus||0)});
   const score=b.value-b.self*4-b.friendly*1.5-b.civ*8-(free?0:stayCost)-(w.flame?3:6);
   if(!best||score>best.score)best={score,c,b};
  }
  if(!best||best.b.value<=0)continue;
  if(held&&!launchReason(g,best.c))opts.push({type:'launch',arg:{x:best.c.x,y:best.c.y},score:best.score,why:`${w.id} v${best.b.value.toFixed(0)}`});
  else if(!held)opts.push({type:'weapon',arg:w.slot,score:TUNING.switchDiscount*best.score-stayCost*.5,why:`switch to ${w.id}`});
 }
 // ---- reload ----
 const heldW=me.held;
 if(heldW&&!heldW.melee&&!heldW.tank&&heldW.ammo<heldW.mag&&heldW.reserve>0){
  const empty=heldW.ammo<heldW.shotCost;
  const reloadFree=g.actionCost('reload')===0;
  opts.push({type:'reload',score:(empty?25:5*(1-heldW.ammo/heldW.mag))-(reloadFree?0:stayCost),why:'reload'});
 }
 // ---- wait (guard + focus) ----
 {
  // Waiting steadies the next shot (+15, and it lifts the precision rifle's aiming penalty): worth the kill chance it adds.
  let focusGain=0;
  if(heldW&&!heldW.melee&&!heldW.cone)for(const e of hostile){const sh=shotAt(view,e,me.weapon);if(!sh)continue;const better=Math.min(.99,sh.chance+.15+(heldW.aimPenalty&&!me.focus?.4:0));
   const gainKill=killChance(sh.rounds,better,sh.a,sh.b,e.hp)-sh.kill;focusGain=Math.max(focusGain,gainKill*enemyValue(view,e)*.6);}
  // Waiting does not end the fight: every enemy already hitting us gets another round later. The guard halves this
  // round's damage, but the round is added to the fight, so it only pays when we cannot hurt them anyway.
  const delay=hostile.reduce((a,e)=>{const r=incoming(view,e,here);return a+(r.now>0||dist(e,me)<=1?Math.max(r.now,r.soon):0);},0)*hpWeight(me);
  const canHurt=opts.some(o=>o.attack||o.type==='grenade'||o.type==='launch');
  // A second guard in a row while we keep losing health and could hit back only postpones the same fight.
  const losing=bot.waits>0&&bot.waitHp!==undefined&&me.hp+me.plates<bot.waitHp;
  if(!(canHurt&&losing))opts.push({type:'wait',score:-exposure(guard)+focusGain-2-(canHurt?delay:0),why:`guard f${focusGain.toFixed(1)}${canHurt&&delay?` d${delay.toFixed(0)}`:''}`});
 }
 // ---- heal ----
 if(me.meds>0&&me.hp<me.maxHp){
  const heal=Math.min(me.maxHp-me.hp,me.character==='bulwark'||me.character==='necromancer'?22:45);
  const need=me.hp/me.maxHp;
  const score=heal*(need<.35?1.2:need<TUNING.healAt?.8:.25)-damageCost(me,stay,{heal})-6;
  opts.push({type:'heal',score,why:`heal +${heal}`});
 }
 // ---- approach: several steps to a tile we can fight from, when nothing is in reach from here ----
 const reach=opts.some(o=>o.type==='fire'||o.type==='launch'||o.type==='move'&&o.target);
 if(!reach&&!me.pinned&&!me.anchored&&me.hp>=me.maxHp*.4){   // badly hurt: no walking into a fight
  const bold=(bot.idle||0)>=40;
  const plan=firingPlan(view,bot,bold?{bold:true,maxCost:40}:{});
  if(plan)opts.push({type:'move',arg:plan.first,score:plan.score+(bold?40:0),plan:{kind:'approach',to:plan.end},why:`${bold?'assault':'approach'} ${plan.end.x},${plan.end.y} (${plan.cost})`});
 }
 // ---- moves ----
 for(const n of neighbours(here)){
  if(!walkable(view,n.x,n.y)||!crossable(view,here,n))continue;
  if(view.occupied.has(key(n)))continue;
  const ally=view.allies.find(a=>a.x===n.x&&a.y===n.y);if(ally&&swapReason(g,ally))continue;   // walking into our own unit swaps places
  if(me.pinned||me.anchored)continue;
  const t=threatAt(view,n,{moved:true});
  const pos=positional(view,n);
  const crush=view.eggs?.some(s=>s.x===n.x&&s.y===n.y)?25:0;   // standing on an egg sac when it hatches crushes it
  const score=-exposure(t)+TUNING.moveFuture*pos-hazardAt(g,n.x,n.y)*1.5-(bot.recentTiles.get(key(n))||0)*1.5+crush;
  opts.push({type:'move',arg:n.step,score,why:`move ${n.x},${n.y} t${t.now.toFixed(0)}/${t.soon.toFixed(0)} p${pos.toFixed(0)}`});
 }
 return opts;
}
// A few steps to the nearest tile we can fight from: tiles in an enemy's line on the way cost more, so the route prefers
// to stay covered; the end tile is judged like a move (can we shoot from it, in our band, from cover).
// `bold` (a standoff the watchdog caught: nothing has happened for a long while): any tile we can shoot from, the
// nearest, whatever it costs — waiting for an enemy that will not come costs more.
export function firingPlan(view,bot,{maxCost=14,bold=false}={}){
 const g=view.g,me=view.me,w=me.held;if(!w)return null;
 const hostile=view.enemies.filter(e=>!e.civilian);if(!hostile.length)return null;
 const exposed=t=>bold?0:hostile.reduce((n,e)=>n+(!e.melee&&!e.disabled&&dist(e,t)<=e.range&&cachedLine(view,e,t)?1:0),0);
 const tileView=bold?{...view,meleeMode:false}:view;
 let best=null,count=0;
 route(view,q=>{
  if(++count>(bold?400:160))return true;
  const pos=positional(tileView,q);
  // The end tile must be one we can stay on: what would hit us there counts against it (a boss's reach, a crossfire).
  if(pos>0){const t=bold?{now:0,soon:0}:threatAt(view,q,{moved:false});const s=pos*.45-0.9*(dist(q,me))-exposed(q)*2-.5*damageCost(me,t);if(!best||s>best.s)best={s,q:{x:q.x,y:q.y}};}
  return false;
 },{cost:q=>exposed(q)*2+(view.danger.get(key(q))?30:0)+hazardAt(g,q.x,q.y),maxCost});
 if(!best)return null;
 const r=route(view,q=>q.x===best.q.x&&q.y===best.q.y,{cost:q=>exposed(q)*2+(view.danger.get(key(q))?30:0)+hazardAt(g,q.x,q.y),maxCost:maxCost+10});
 if(!r)return null;
 const first={x:me.x+r.first[0],y:me.y+r.first[1]},t=threatAt(view,first,{moved:true});
 return {first:r.first,end:best.q,cost:r.cost,score:best.s-damageCost(me,t,{soonWeight:.2})};
}
function flameValue(view,w,aim){
 // A sprayed cone: every unit in 30° of the aim within 5; the rules' own cone geometry (src/fire.js flameCells).
 const g=view.g,me=view.me;let value=0,kills=0,self=0,friendly=0,civ=0;
 const cells=new Set(flameCellsFor(g,me,aim,w).map(key));
 const dmg=(w.stats.min+w.stats.max)/2;
 for(const e of view.enemies)if(cells.has(key(e))){value+=Math.min(dmg,e.hp)/Math.max(1,e.hp)*enemyValue(view,e);if(dmg>=e.hp)kills++;}
 for(const a of view.allies)if(cells.has(key(a)))friendly+=dmg;
 for(const c of view.civilians)if(cells.has(key(c)))civ++;
 return {value,kills,self,friendly,civ};
}
import {flameCells} from '../../src/fire.js';
const flameCellsFor=(g,me,aim,w)=>flameCells(g,{x:me.x,y:me.y},aim,w.stats);
const ourLines=new WeakMap();
export function ourLine(view,t,e){
 let c=ourLines.get(view);if(!c){c=new Map();ourLines.set(view,c);}
 const k=`${t.x},${t.y}>${e.id}`;if(c.has(k))return c.get(k);
 const g=view.g,from={x:t.x,y:t.y,traits:view.me.ref.traits},v=g.sight(from,e.ref)&&g.shotClear(from,e.ref);c.set(k,v);return v;
}
// How good a tile is to fight from next round: can we shoot something from it, in our band, with cover against it.
export function positional(view,t){
 const g=view.g,me=view.me,w=me.held;let best=0;
 if(!w)return 0;
 for(const e of view.enemies){
  if(e.civilian)continue;
  const d=dist(e,t);
  // A class fighting hand to hand for now (view.meleeMode, set by its module) wants the tile next to its target.
  if(w.melee||view.meleeMode){if(d===1)best=Math.max(best,enemyValue(view,e)*.5);else best=Math.max(best,enemyValue(view,e)*.25/Math.max(1,d));continue;}
  if(d>w.range)continue;
  // From the tile to the enemy itself (an actor: its unexposed lean points do not count, as for a real shot).
  if(!ourLine(view,t,e))continue;
  const cover=g.protectingCover({x:t.x,y:t.y,traits:me.ref.traits},e.ref),fx=coverEffects(cover,t,e);
  const v=enemyValue(view,e)*(.6-bandPenalty(w.band,d)/40)+fx.efficiency*6;
  best=Math.max(best,v);
 }
 return best;
}
