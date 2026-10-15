// Clear bot (docs/CLEAR_BOT.md): perception → policy → execution, one game action at a time.
//   perception.mjs builds the view (only what the player could know), memory.mjs keeps what the bot remembers,
//   policy (this file's decide + combat.mjs + classes/*.mjs) turns the view into an intent, and act() below turns the
//   intent into the public calls a player makes: game.action(type,arg), game.target=id, game.choosePerk(id).
import {buildView,DEFAULT_OPTIONS} from './perception.mjs';
import {Memory} from './memory.mjs';
import {combatOptions,ourLine} from './combat.mjs';
import {exposureAt,fallbackTile,planStep,shouldFallBack,shouldHide,fightOutlook,ropeEscape,STANCE_TUNING} from './stance.mjs';
import {threatAt,shotAt} from './tactics.mjs';
import {route,safeCost,exploreRoute} from './nav.mjs';
import {CLASS_MODULES} from './classes/index.mjs';
import {key,dist,seededRng,maxBy} from './util.mjs';
import {AMMUNITION,itemAmmo} from '../../src/ammunition.js';
import {terminalReason,terminalRemaining,TERMINAL_TUNING} from '../../src/terminal.js';
import {groundChoice,groundWorth,bestUpgrade,contributions,packDamageOn,mainWeapon as arsenalMain} from './arsenal.mjs';

// civilianCost: the walking cost of a civilian's tile on the way to a goal (chooseGoal), the detour worth taking rather
// than clearing it; a civilian on a cheaper way is shot or walked into (clearWay).
// bounceMoves, avoidTurns, avoidCost: bouncing between at most three tiles for that many steps with no progress makes
// routes to goals avoid those tiles for a while (bounce).
export const BOT_TUNING={floorTurns:260,exploreSlack:40,refuseRetries:4,containerReach:40,civilianCost:10,bounceMoves:8,avoidTurns:30,avoidCost:25};

export class ClearBot{
 constructor(game,{seed=game.seed,options={},trace=null}={}){
  this.g=game;this.options={...DEFAULT_OPTIONS,...options};this.memory=new Memory();this.rng=seededRng(seed);
  this.cls=CLASS_MODULES[game.player.character]||CLASS_MODULES.default;
  this.actions=0;this.refusals=0;this.refused=new Set();this.turnSeen=-1;this.trace=trace;
  this.recentTiles=new Map();this.floorStart=new Map();this.waits=0;this.stats={intents:{},refused:{},weapons:{}};
  this.lastIntent=null;
 }
 // One decision and its execution. Returns false once the run is over.
 step(){
  const g=this.g;if(g.status!=='playing')return false;
  if(g.pendingPerks){this.pickPerk();return true;}
  if(this.turnSeen!==g.turn){this.turnSeen=g.turn;this.refused.clear();}
  if(!this.floorStart.has(g.floor))this.floorStart.set(g.floor,g.turn);
  const view=buildView(g,this.memory,this.options);
  this.view=view;this.watchdog(view);
  const k=key(view.me);this.recentTiles.set(k,(this.recentTiles.get(k)||0)+1);
  if(this.recentTiles.size>40){const first=this.recentTiles.keys().next().value;this.recentTiles.delete(first);}
  this.bounce(view);
  let intent=this.decide(view);
  for(let tries=0;tries<=BOT_TUNING.refuseRetries;tries++){
   if(!intent){intent={type:'wait',why:'fallback'};}
   const ok=this.act(intent);
   if(ok!==false)return true;
   this.refused.add(sig(intent));this.refusals++;this.stats.refused[intent.type]=(this.stats.refused[intent.type]||0)+1;
   if(g.status!=='playing'||g.pendingPerks)return true;
   intent=tries<BOT_TUNING.refuseRetries-1?this.decide(buildView(g,this.memory,this.options)):{type:'wait',why:'refused too often'};
  }
  return true;
 }
 isRefused(intent){return this.refused.has(sig(intent));}
 // Bouncing: the last bounceMoves changes of tile went back and forth over at most three tiles while nothing progressed
 // (watchdog idle). Routes to goals then avoid those tiles for a while (chooseGoal), so the bot tries another way. Seen
 // with an engineer's warden drone, which keeps taking the tile across a low partition from us (no swap across a
 // partition): each step chose the nearest crossing, the drone took it, and the bot stepped back to the other one.
 // Only steps of walks to goals count (chooseGoal's moves): stepping out and back in a fight is peeking, not bouncing.
 bounce(view){
  const m=this.memory,k=key(view.me),t=m.trail;
  if(t[t.length-1]===k)return;
  if(!this.lastIntent?.walk){t.length=0;t.push(k);return;}
  t.push(k);if(t.length>BOT_TUNING.bounceMoves)t.shift();
  if(t.length<BOT_TUNING.bounceMoves||(this.idle||0)<BOT_TUNING.bounceMoves||new Set(t).size>3)return;
  for(const x of t)m.avoid.set(x,view.turn+BOT_TUNING.avoidTurns);
  t.length=0;this.stats.bounces=(this.stats.bounces||0)+1;m.bounces++;
  // Bouncing again and again on this floor: what we keep walking to cannot be reached this way (on 3.209.0 a follower
  // drone can hold the tile across a partition for good). Give up the detours (terminals, cases, items, the unexplored
  // tile we were heading for) and make for the exit.
  if(m.bounces%3===0){
   if(this.exploreGoal)m.skipExplore.add(key(this.exploreGoal));
   for(const x of view.terminals)m.skipTerminals.add(x.id);for(const c of view.containers)m.skipTargets.add(c.id);
   for(const i of view.items){m.skipItems.add(`${i.x},${i.y},${i.type}`);if(i.type==='weapon')m.skipItems.add(`walk${i.slot}`);}m.late=true;
  }
 }
 // Progress watchdog: new tiles seen, kills, floors, pickups. Without any for a while the bot gives up on what it is
 // walking to (a tile it cannot see into, an enemy it cannot reach) and, later, on the rest of the floor.
 watchdog(view){
  const g=this.g,p=g.player;let seen=0;for(const row of g.seen)for(const v of row)if(v)seen++;
  const mark=`${g.floor}|${seen}|${p.kills}|${p.xp}|${p.scrap}|${p.meds}|${p.hp>=p.maxHp}|${g.props.filter(o=>o.opened).length}|${p.stats.damage}`;
  // Hurt: whatever we were ignoring is back in the fight.
  if(this.lastHp!==undefined&&p.hp+(p.plates||0)<this.lastHp)this.memory.ignored.clear();
  this.lastHp=p.hp+(p.plates||0);
  if(mark!==this.progressMark){this.progressMark=mark;this.idle=0;return;}
  this.idle=(this.idle||0)+1;
  // A fight that goes nowhere (nobody hurt on either side for 20 decisions): stop looking at those enemies for a while.
  if(this.idle%20===0)for(const e of view.enemies)this.memory.ignored.set(e.id,view.turn+40);
  if(this.idle%30===0){const m=this.memory;if(this.exploreGoal)m.skipExplore.add(key(this.exploreGoal));m.lastSeen.clear();this.plan=null;
   for(const c of view.containers)if(dist(c,view.me)>6)m.skipTargets.add(c.id);for(const i of view.items)if(dist(i,view.me)>3)m.skipItems.add(`${i.x},${i.y},${i.type}`);}
  if(this.idle>=90)this.memory.late=true;
 }
 // Execution: the lock first (a player taps the enemy), then any free preparation, then the action.
 act(intent){
  const g=this.g;
  this.lastIntent=intent;this.stats.intents[intent.type]=(this.stats.intents[intent.type]||0)+1;
  if(this.trace)this.trace(this,intent);
  if(intent.type==='perk'){return g.choosePerk(intent.arg);}
  if(intent.target!==undefined&&g.target!==intent.target)g.target=intent.target;
  if(intent.pre){const ok=g.action(intent.pre.type,intent.pre.arg);if(!ok)return false;}
  this.actions++;
  const cost=g.actionCost(intent.type,intent.arg);
  const ok=g.action(intent.type,intent.arg);
  if(intent.plan&&ok)this.plan={...intent.plan,floor:g.floor,since:g.turn,until:g.turn+STANCE_TUNING.planTurns};
  if(ok&&intent.then&&g.status==='playing'&&!g.pendingPerks&&cost===0){if(intent.then.target!==undefined)g.target=intent.then.target;this.actions++;return g.action(intent.then.type,intent.then.arg);}
  if(ok&&intent.type==='weapon'&&cost>0)this.lastSwitch=g.turn;
  if(ok){if(intent.type==='wait'){if(!this.waits)this.waitHp=g.player.hp+(g.player.plates||0);this.waits++;}else if(cost>0)this.waits=0;}
  return ok;
 }
 pickPerk(){
  const g=this.g,choices=g.perkChoices;if(!choices.length){return;}
  const weights=this.cls.perks||{};const p=g.player;
  const base={health:p.hp<p.maxHp*.6?90:55,med:p.meds<2?70:35,plate_rack:45,plating:35,steady:40,skirmish:35,medic:40,hazmat:20,blast:25,scavenger:15,melee:10,mod_mastery:30,ammo_recovery:30};
  const score=o=>(weights[o.id]??base[o.id]??30);
  const pick=maxBy(choices,score);this.act({type:'perk',arg:pick.id,why:'perk'});
 }

 // ---- policy --------------------------------------------------------------------------------------------------------
 decide(view){
  const g=this.g,me=view.me;
  // Free, instant: the flashlight in the black (a lamp off everywhere else so it does not give us away).
  // Hysteresis: off only after two decisions out of the black (a muzzle flash lights our tile for a round).
  // With night vision (recon, ninja, goggles) the lantern only gives us away: keep it off, the dark is our cover.
  this.litRun=me.black?0:(this.litRun||0)+1;
  const wantLight=!me.nightVision&&(me.black||me.flashlight&&this.litRun<2);
  if(wantLight!==me.flashlight&&!this.isRefused({type:'flashlight'}))return {type:'flashlight',why:wantLight?'black':me.nightVision?'night vision':'lit'};
  const pre=this.cls.prepare?.(view,this);if(pre&&!this.isRefused(pre))return pre;
  view.meleeMode=Boolean(this.cls.meleeMode?.(view,this));
  const hostile=view.enemies.filter(e=>!e.civilian);
  const underFire=threatAt(view,me,{moved:false});
  if(this.plan&&(this.plan.floor!==view.floor||view.turn>this.plan.until))this.plan=null;
  if(hostile.length||underFire.now>0){
   let opts=combatOptions(view,this).filter(o=>!this.isRefused(o));
   if(this.plan&&['approach','fallback','retreat'].includes(this.plan.kind))opts=opts.filter(o=>!o.plan);   // no re-planning mid-plan
   for(const o of this.cls.combat?.(view,this)||[])if(!this.isRefused(o))opts.push(o);
   const tactic=this.stance(view,opts);if(tactic&&!this.isRefused(tactic))return tactic;
   const best=pickBest(opts);
   // A standoff (nothing reaches us, we reach nothing): after three waits that cost us nothing, walk to a firing spot
   // if there is one, else get on with the floor.
   const standoff=best?.type==='wait'&&this.waits>=3&&(underFire.now===0||this.waitHp===me.hp+me.plates);
   if(best&&!standoff)return best;
   if(standoff){const go=opts.find(o=>o.plan?.kind==='approach');if(go)return go;}
  }
  return this.quiet(view);
 }
 // Committed fight plans (stance.mjs): fall back out of a crossfire and hold the new tile; keep walking an approach.
 // The plan's own step competes with the greedy options with a bonus, so only a clearly better option (a likely kill of
 // an enemy about to fire, a telegraph on the way) breaks it.
 stance(view,opts){
  const me=view.me,cfg=this.cls.stance||{};if(cfg.off||me.pinned||me.anchored)return null;
  const ex=exposureAt(view,me),bestAttack=pickBest(opts.filter(o=>o.attack));
  const danger=view.danger.get(key(me));
  let plan=this.plan;
  if(plan?.kind==='hold'&&!(me.x===plan.to.x&&me.y===plan.to.y))plan=this.plan=null;
  if(plan&&plan.to&&view.danger.get(key(plan.to))?.t<=1)plan=this.plan=null;
  // Leave early when the fight is lost on paper (fightOutlook), not only when health is low.
  const outlook=fightOutlook(view);this.outlook=outlook;
  // Round 2: a threat close to us that nothing in the pack can really hurt (an armour our guns do not get through) is
  // not a fight to take: get away from it (arsenal.mjs packDamageOn, from the weapon cards and the codex).
  const unhurtable=view.enemies.find(e=>!e.civilian&&!e.disabled&&dist(e,me)<=Math.max(3,e.melee?3:e.range)&&e.hp>60&&packDamageOn(view,e)<Math.min(12,e.hp/12));
  const hide=!cfg.noHide&&(shouldHide(view,ex)||outlook.losing&&ex.see>=1||Boolean(unhurtable));
  if(!danger&&(!plan||plan.kind==='hold'||plan.kind==='approach'||hide&&plan.kind!=='retreat')&&(hide||(cfg.shouldFallBack||shouldFallBack)(view,ex,bestAttack))){
   const f=fallbackTile(view,ourLine,hide?{hide:true,maxCost:18}:{});
   if(f){plan=this.plan={kind:hide?'retreat':'fallback',to:f.to,floor:view.floor,since:view.turn,until:view.turn+STANCE_TUNING.planTurns+(hide?6:0)};this.stats.fallbacks=(this.stats.fallbacks||0)+1;}
   // No way out on foot, or a lot of fire on the way: pull out on a line (the ninja carries five of each).
   if(hide&&(!f||exposureAt(view,me).open>=2)){const rope=ropeEscape(view,ourLine);if(rope&&!this.isRefused(rope)){this.plan=null;this.stats.ropes=(this.stats.ropes||0)+1;return rope;}}
   if(hide&&plan?.kind==='retreat')this.stats.retreats=(this.stats.retreats||0)+1;
   // Nowhere to hide and no line: at least step away from what we cannot fight (the best move that opens distance).
   if(hide&&!f&&unhurtable){
    const away=opts.filter(o=>o.type==='move'&&!o.target).map(o=>({o,gain:dist({x:me.x+o.arg[0],y:me.y+o.arg[1]},unhurtable)-dist(me,unhurtable)})).filter(x=>x.gain>0).sort((a,b)=>b.o.score-a.o.score)[0];
    if(away){this.stats.kites=(this.stats.kites||0)+1;return {...away.o,score:away.o.score+20,why:`away from ${unhurtable.type} (cannot hurt it)`};}
   }
  }
  if(!plan)return null;
  if(plan.kind==='fallback'||plan.kind==='approach'||plan.kind==='retreat'){
   if(me.x===plan.to.x&&me.y===plan.to.y){plan=this.plan={kind:'hold',to:plan.to,floor:view.floor,since:view.turn,until:view.turn+STANCE_TUNING.holdPatience+2};}
   else{
    const r=planStep(view,plan);if(!r){this.plan=null;return null;}
    const step=opts.find(o=>o.type==='move'&&!o.target&&o.arg[0]===r.first[0]&&o.arg[1]===r.first[1]);
    const base=step?step.score:pickBest(opts.filter(o=>o.type==='move'&&!o.target))?.score??0;
    const best=pickBest(opts);
    const mine={type:'move',arg:r.first,score:base+STANCE_TUNING.bonus+(plan.kind==='fallback'?6:plan.kind==='retreat'?20:0),why:`${plan.kind} ${plan.to.x},${plan.to.y}`};
    return !best||mine.score>=best.score||danger?.t<=0&&best.type!=='move'?mine:best;
   }
  }
  if(plan.kind==='hold'){
   // Holding: attack what comes into the funnel, else wait (guarded, steadier next shot); leave only for a telegraph.
   if(danger)return null;
   const hold=opts.filter(o=>o.type!=='move'||o.target);
   const best=pickBest(hold);
   if(!hostile(view).some(e=>ourLine(view,me,e))&&view.turn-plan.since>STANCE_TUNING.holdPatience){this.plan=null;return null;}
   return best;
  }
  return null;
 }
 // No enemy in sight: recover, loot, spend, explore, leave.
 quiet(view){
  const g=this.g,me=view.me,mem=this.memory;
  const hurt=me.hp/me.maxHp;
  const cls=this.cls.quiet?.(view,this);if(cls&&!this.isRefused(cls))return cls;
  if(me.meds>0&&(hurt<.55||me.poison>2&&hurt<.8)&&!this.isRefused({type:'heal'}))return {type:'heal',why:'quiet heal'};
  if(me.sprays>0&&me.plates<=me.plateCap-20&&!this.isRefused({type:'plate'}))return {type:'plate',why:'spray plates'};
  const w=me.held;
  if(w&&!w.melee&&!w.tank&&w.ammo<w.mag&&w.reserve>0&&(w.ammo<w.mag*.7||view.ghosts.length===0)&&!this.isRefused({type:'reload'}))return {type:'reload',why:'quiet reload'};
  // Other guns: switch back to the best gun for general use when quiet.
  // Back to the main gun only once the fight is well over (not between two enemies of the same fight).
  const main=this.mainWeapon(view),calm=!view.ghosts.some(e=>view.turn-e.turn<=8);
  if(calm&&main!==null&&main!==me.weapon&&!this.isRefused({type:'weapon',arg:main}))return {type:'weapon',arg:main,why:'main gun'};
  // An approach under way (the enemy slipped out of sight on the way): keep going to the firing spot.
  // A plan under way (an approach, a fall-back, a retreat) is finished even when the enemy slipped out of sight.
  if(this.plan&&['approach','fallback','retreat'].includes(this.plan.kind)&&view.turn<=this.plan.until&&!(me.x===this.plan.to.x&&me.y===this.plan.to.y)){
   const r=planStep(view,this.plan);
   if(r)return {type:'move',arg:r.first,why:`continue ${this.plan.kind} ${this.plan.to.x},${this.plan.to.y}`};
   this.plan=null;
  }
  if(this.plan&&this.plan.kind!=='hold'&&me.x===this.plan.to?.x&&me.y===this.plan.to?.y)this.plan={kind:'hold',to:this.plan.to,floor:view.floor,since:view.turn,until:view.turn+STANCE_TUNING.holdPatience+2,after:this.plan.kind};
  // Holding a tile after a fall-back: give whoever chased us a few turns to come through.
  if(this.plan?.kind==='hold'&&me.x===this.plan.to.x&&me.y===this.plan.to.y&&view.turn-this.plan.since<=STANCE_TUNING.holdPatience&&!this.isRefused({type:'wait'}))return {type:'wait',why:'hold'};
  // A remembered enemy that just went out of sight: hold the corner a turn or two (it is usually coming to us).
  const fresh=view.ghosts.filter(e=>view.turn-e.turn<=2&&!e.boss);
  if(fresh.length&&this.waits<2&&!this.isRefused({type:'wait'}))return {type:'wait',why:'hold for ghost'};
  // Adjacent interactions.
  const touch=o=>dist(o,me)<=1&&g.canCross(me,o);
  const box=view.containers.find(c=>touch(c)&&!mem.skipTargets.has(c.id));
  if(box){const it={type:'openContainer',arg:box.id,why:'open case'};if(!this.isRefused(it))return it;mem.skipTargets.add(box.id);}
  const term=g.nearbyTerminal;if(term){const buy=this.shop(view,term);if(buy)return buy;mem.skipTerminals.add(term.id);}
  const weapon=this.weaponPickup(view);if(weapon)return weapon;
  // Goals, nearest first by walking cost.
  const goal=this.chooseGoal(view);
  if(goal)return this.clearWay(view,goal)||goal;
  return {type:'wait',why:'nothing to do'};
 }
 // A civilian on the way we walk (the routes of chooseGoal pay civilianCost for its tile rather than stop at it) is
 // cleared: shot with the gun in hand when it can be, else walked into, which is a bump attack. Without this a
 // researcher cornered in a one-tile passage (nowhere to flee) sealed the rest of the floor: the bot never targets
 // civilians, and its routes stopped at every unit it could see, then went through again once it was out of sight.
 // The rules do not punish it, and the training course teaches it (course.s5.civilian).
 clearWay(view,intent){
  const first=intent.type==='move'&&intent.through?.[0];if(!first)return null;
  const c=view.civilians.find(x=>x.id===first.id),me=view.me,count=k=>{this.stats[k]=(this.stats[k]||0)+1;};
  if(!c)return null;
  // Beside it, the step itself is the bump.
  if(dist(c,me)<=1){if(me.x+intent.arg[0]===c.x&&me.y+intent.arg[1]===c.y)count('clearBumps');return null;}
  const sh=me.held&&!me.held.melee?shotAt(view,c,me.weapon):null;
  const it={type:'fire',target:c.id,why:`clear ${c.type}@${c.x},${c.y} off the way`};
  if(!sh||sh.expected<=0||this.isRefused(it))return null;
  count('clearShots');return it;
 }
 mainWeapon(view){return arsenalMain(view);}   // round 2: the gun that alone covers this floor's enemies best
 // What a supply terminal is worth to us right now (docs/ITEMS.md economy; one item a turn).
 shop(view,term){
  const g=this.g,me=view.me,p=me.ref,try_=arg=>!terminalReason(g,arg)&&!this.isRefused({type:'terminal',arg})?{type:'terminal',arg,why:`buy ${arg}`}:null;
  if(me.hp<=me.maxHp-40){const b=try_('heal');if(b)return b;}
  if(me.meds<3){const b=try_('med');if(b)return b;}
  if(me.sprays<1&&me.plates<me.plateCap-15){const b=try_('spray');if(b)return b;}
  // Round 2: the upgrade that raises the pack's coverage most for its price (arsenal.mjs), and ammunition for the guns
  // that matter to the pack (what it would lose without them), not for every gun.
  const up=bestUpgrade(view);
  if(up){const b=try_(`upgrade:${up.slot}`);if(b)return b;}
  const worth=contributions(view);
  for(const w of [...me.weapons].sort((a,b)=>(worth.get(b.slot)||0)-(worth.get(a.slot)||0))){if(w.melee||w.tank||(worth.get(w.slot)||0)<1)continue;const type=g.weaponAt(w.slot).ammoType;if(!AMMUNITION[type])continue;if(w.reserve<w.mag*2){const b=try_(type);if(b)return b;}}
  if(me.grenades.frag<2){const b=try_('grenade');if(b)return b;}
  // Round 2: scrap left over (a terminal's credit is capped at 60, the scrap is not) goes into what keeps us alive and
  // what cracks armour: a full medkit stock, healing past small wounds, frags to the cap.
  if(me.scrap>=100){
   if(me.meds<5){const b=try_('med');if(b)return b;}
   if(me.hp<=me.maxHp-20){const b=try_('heal');if(b)return b;}
   if(me.plates<me.plateCap-10&&me.sprays<2){const b=try_('spray');if(b)return b;}
   if(me.grenades.frag<4){const b=try_('grenade');if(b)return b;}
  }
  return null;
 }
 // Round 2 (arsenal.mjs): a gun on the floor beside us is taken, swapped for one of ours, or scrapped by what it does to
 // the pack's coverage of this facility's enemies; each ground gun is judged once per floor.
 weaponPickup(view){
  const g=this.g,me=view.me;
  const ground=g.items.filter(i=>i.type==='weapon'&&dist(i,me)<=1&&g.canCross(me,i));
  for(const i of ground){
   if(this.memory.skipItems.has(`w${i.slot}`))continue;
   this.memory.skipItems.add(`w${i.slot}`);
   const c=groundChoice(view,i);if(!c)continue;
   this.stats.weapons[c.type]=(this.stats.weapons[c.type]||0)+1;
   return {type:c.type,arg:c.arg,why:c.why};
  }
  return null;
 }
 // A terminal is worth the walk when its kind (shown on the map) sells something we need and can pay for.
 terminalWorth(view,t){
  const me=view.me,kind=t.kind;if(me.scrap<5)return false;
  const hurt=me.hp<=me.maxHp-35;
  if(!kind)return true;
  const rich=me.scrap>=100;
  if(kind==='medical')return (hurt&&me.scrap>=15)||(me.meds<3&&me.scrap>=20)||rich&&(me.meds<5||me.hp<=me.maxHp-20);
  if(kind==='arms')return me.scrap>=25&&Boolean(bestUpgrade(view))||me.weapons.some(w=>!w.melee&&!w.tank&&w.reserve<w.mag*2)&&me.scrap>=10;
  if(kind==='gear')return me.scrap>=12&&me.grenades.frag<2||rich&&me.grenades.frag<4;
  return true;
 }
 wants(view,item){
  const g=this.g,me=view.me,p=me.ref;
  if(item.type==='weapon')return false;
  // What stepping on it would not take (a full pouch, item cap or plate carrier; the map dims it): not worth the walk.
  // Without this the bot walked onto a medkit it could not carry, found no goal from its own tile, stepped off, and
  // walked back on, for thousands of turns.
  if(!g.canTake(item))return false;
  const ammo=itemAmmo(item.type);
  if(ammo){const cap=g.ammoCapacity(ammo),have=p[AMMUNITION[ammo].key]||0;return have<cap&&me.weapons.some(w=>g.weaponAt(w.slot).ammoType===ammo)||ammo==='grenade'&&have<cap;}
  return true;   // medkits, plates, throwables, gear, keycards, scrap, learning data: take them
 }
 chooseGoal(view){
  const g=this.g,me=view.me,mem=this.memory,safe=safeCost(view);
  const cost=q=>safe(q)+(mem.avoid.get(key(q))>=view.turn?BOT_TUNING.avoidCost:0);   // tiles we bounced between (bounce)
  // Walking to goals, a civilian in the way is a cost, not a wall (clearWay deals with it), and an ally we can swap with
  // costs nothing; in a fight a civilian stays a wall and an ally costs a little (keep the pet in front).
  view.civilianCost=BOT_TUNING.civilianCost;view.allyCost=0;
  const go=(r,why)=>({type:'move',arg:r.first,through:r.through,walk:true,why});
  const floorTurns=view.turn-(this.floorStart.get(view.floor)??view.turn);
  // Tired: hurt with no medkit left — no more detours for loot, straight for the exit once it is known and open.
  const tired=me.hp<me.maxHp*.45&&me.meds===0;
  const late=floorTurns>BOT_TUNING.floorTurns||mem.late||tired&&view.exit&&!view.exit.blocked;
  const bossFloor=view.exit?.blocked||(!view.exit&&view.floor%3===0);
  const targets=[];
  // Cases (adjacent to open), items to step on, terminals worth a visit.
  for(const c of view.containers)if(!mem.skipTargets.has(c.id))targets.push({kind:'case',o:c,adj:true});
  for(const i of view.items)if(!mem.skipItems.has(`${i.x},${i.y},${i.type}`)&&this.wants(view,i))targets.push({kind:'item',o:i,adj:false});
  // Round 2: a gun lying on a seen tile that would improve the pack (judged from its card) is worth the walk.
  for(const i of view.items)if(i.type==='weapon'&&!mem.skipItems.has(`w${i.slot}`)&&!mem.skipItems.has(`walk${i.slot}`)){if(groundWorth(view,i)>0)targets.push({kind:'weapon',o:i,adj:true});else mem.skipItems.add(`walk${i.slot}`);}
  for(const t of view.terminals)if(!mem.skipTerminals.has(t.id)&&terminalRemaining(t)>=10&&this.terminalWorth(view,t))targets.push({kind:'terminal',o:t,adj:true});
  if(!late){
   const r=route(view,q=>targets.some(t=>t.adj?dist(q,t.o)===1&&g.canCross(q,t.o):dist(q,t.o)===0),{cost,maxCost:BOT_TUNING.containerReach});
   if(r){const at=r.end;const hit=targets.find(t=>t.adj?dist(at,t.o)===1:dist(at,t.o)===0);
    if(hit&&hit.kind==='item'&&r.path.length===1)mem.skipItems.add(`${hit.o.x},${hit.o.y},${hit.o.type}`);   // stepping on it now
    return go(r,`to ${hit?.kind} ${at.x},${at.y}`);}
  }
  // A remembered enemy we lost: go and look where it was, carefully (the route avoids telegraphs and hazards).
  const lost=view.ghosts.filter(e=>view.turn-e.turn<=10&&!mem.skipTargets.has(`ghost:${e.id}`)).sort((a,b)=>dist(a,me)-dist(b,me))[0];
  if(lost&&!late){const r=route(view,q=>dist(q,lost)<=1,{cost,maxCost:30});if(r&&r.path.length>0)return go(r,`investigate ${lost.type}@${lost.x},${lost.y}`);mem.skipTargets.add(`ghost:${lost.id}`);}
  // The exit: take it when the floor's work is done (explored, or out of time), and it is open.
  // Keep walking to the unexplored tile chosen before, while it is still unexplored (no flip-flop between two).
  const eg=this.exploreGoal;let frontier=null;
  if(eg&&eg.floor===view.floor&&!g.seen[eg.y]?.[eg.x]&&!mem.skipExplore.has(key(eg)))frontier=route(view,q=>q.x===eg.x&&q.y===eg.y,{cost,maxCost:200,unknownGoal:true});
  if(!frontier)frontier=exploreRoute(view,{cost,maxCost:200,skip:mem.skipExplore});
  // Round 2: the floor explored, walk to any terminal worth it before the exit (they stand in side rooms, off the way
  // to the exit, and round 1 left 400-900 scrap unspent by the end of a run).
  if((!frontier||late)&&!tired&&!view.exit?.blocked){
   const desks=view.terminals.filter(t=>!mem.skipTerminals.has(t.id)&&terminalRemaining(t)>=10&&this.terminalWorth(view,t));
   if(desks.length){const r=route(view,q=>desks.some(t=>dist(q,t)===1&&g.canCross(q,t)),{cost,maxCost:late&&frontier?60:200});if(r)return go(r,'to terminal before the exit');}
  }
  // The exit is locked by a boss we have seen: go and find it (and stop ignoring it), rather than wait by the door.
  if(view.exit?.blocked&&mem.bossSeen&&!frontier){
   mem.ignored.delete(mem.bossSeen.id);
   const r=route(view,q=>dist(q,mem.bossSeen)<=1,{cost,maxCost:600});
   if(r&&dist(me,mem.bossSeen)>1)return go(r,'hunt boss (exit locked)');
  }
  if(view.exit){
   const ready=!view.exit.blocked&&(late||!frontier||floorTurns>BOT_TUNING.floorTurns-BOT_TUNING.exploreSlack);
   if(ready||view.exit.blocked&&!frontier){
    if(dist(me,view.exit)<=1&&g.canCross(me,view.exit)){
     const before=this.cls.beforeExit?.(view,this);if(before&&!this.isRefused(before))return before;
     if(!view.exit.blocked&&!this.isRefused({type:'interact'}))return {type:'interact',why:'exit'};
    }
    // Beside a locked exit (its boss alive) there is nothing more to walk to there: hunt the boss instead (below).
    const beside=dist(me,view.exit)<=1&&g.canCross(me,view.exit);
    const r=beside?null:route(view,q=>dist(q,view.exit)<=1&&g.canCross(q,view.exit),{cost,maxCost:400});
    if(r)return go(r,'to exit');
   }
  }
  if(frontier){this.exploreGoal={...frontier.end,floor:view.floor};return go(frontier,`explore ${frontier.end.x},${frontier.end.y}`);}
  // Nothing left to explore and the exit is not usable: hunt the boss by its last known spot.
  if(mem.bossSeen){const r=route(view,q=>dist(q,mem.bossSeen)<=1,{cost});if(r)return go(r,'hunt boss');}
  if(targets.length){const r=route(view,q=>targets.some(t=>t.adj?dist(q,t.o)===1&&g.canCross(q,t.o):dist(q,t.o)===0),{cost,maxCost:400});if(r)return go(r,'far loot');}
  // Stuck: walk through hazards to anything unexplored.
  const any=exploreRoute(view,{maxCost:400,skip:mem.skipExplore});if(any)return go(any,'explore (any)');
  if(view.exit&&!view.exit.blocked){const r=route(view,q=>dist(q,view.exit)<=1&&g.canCross(q,view.exit),{maxCost:600});if(r)return go(r,'to exit (any)');}
  // Nothing left but the enemies we chose to ignore (one of them in the way): take them on, boldly.
  if(view.ignored?.length){mem.ignored.clear();this.idle=Math.max(this.idle||0,40);return {type:'wait',why:'re-engage'};}
  // Through whatever stands in the way (walking into an enemy attacks it), to the exit or, while it is still unseen, to
  // anything unexplored (units used to stop this route too, so a held doorway to the unseen exit was never pushed).
  const push=view.exit?route(view,q=>dist(q,view.exit)<=1,{maxCost:600,ignoreUnits:true}):exploreRoute(view,{maxCost:600,ignoreUnits:true});
  if(push)return go(push,'push through');   // an ally on the first step swaps (route keeps out those that cannot)
  return null;
 }
}
const hostile=view=>view.enemies.filter(e=>!e.civilian&&!e.disabled);
const sig=i=>`${i.type}:${JSON.stringify(i.arg??null)}:${i.target??''}`;
export function pickBest(opts){let best=null;for(const o of opts)if(!best||o.score>best.score)best=o;return best;}
