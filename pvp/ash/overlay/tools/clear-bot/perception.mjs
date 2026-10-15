// Clear bot perception (docs/CLEAR_BOT.md): builds the `view` the policy decides from. It holds only what the side the
// bot plays for could know from the screen: units in sight (the team's sight, as the game draws them), the target card's
// public numbers, the map explored so far, what lies on seen tiles, the telegraphs the screen draws, and the bot's own
// status. Rules queries (line of sight, cover, passability of a seen tile, hit chance of our own shot) go through the
// game's own functions, because a player reads the same answers off the screen.
//
// Every place that could read hidden state is marked `// knowledge:` and listed in docs/CLEAR_BOT.md. With the default
// options there is exactly one: none. `mapKnown` (off by default) lets navigation see the whole floor plan, as
// tools/balance.mjs does.
import {ENEMY_TYPES,WEAPONS,SIZE} from '../../src/data.js';
import {isNoncombatant,isBossClass,hasEnemyTag,enemyDef} from '../../src/enemy-data.js';
import {grenadeTelegraphs} from '../../src/enemy-intents.js';
import {AFFIX_TUNING} from '../../src/enemy-affixes.js';
import {flameCells,liveFlameIntent,burningAt} from '../../src/fire.js';
import {gunCells,liveGun,liveMarkIntent} from '../../src/loyalist-bosses.js';
import {tongueTelegraphs} from '../../src/swarm.js';
import {chargeLanes,eggSacs} from '../../src/swarm-bosses.js';
import {liveFireIntent,liveBurn,burnCells} from '../../src/rebel-bosses.js';
import {smokeTelegraphs} from '../../src/delisted-operatives.js';
import {areaCells} from '../../src/throwables.js';
import {FIELD_TUNING} from '../../src/swarm-fields.js';
import {pinned,suppressionStacks} from '../../src/suppression.js';
import {isBlack,isDark,lightAt,LIGHT,newLighting} from '../../src/lighting.js';
import {scaleEnemy,floorDamageBonus} from '../../src/endless.js';
import {isContainer} from '../../src/containers.js';
import {shownItems} from '../../src/blind-fire.js';
import {activeTrait} from '../../src/traits.js';
import {unitTree} from '../../src/behavior-tree.js';
import {enemyBand} from '../../src/range-band.js';
import {skillActive} from '../../src/skills.js';
import {key,dist,cheb} from './util.mjs';

export const DEFAULT_OPTIONS=Object.freeze({mapKnown:false});

// ---- enemies -------------------------------------------------------------------------------------------------------
// The card (ENEMY_TYPES) is the enemy database the game keeps open in the journal; its numbers are public.
export function enemyCard(e){return ENEMY_TYPES[e.type]||{};}
export function enemyDamage(g,e){
 const def=enemyCard(e);if(!def.damage)return 0;
 return def.expendable?def.damage:scaleEnemy(def.damage+floorDamageBonus(g.floor,g.difficultySpec),g.floor,'damage',g.difficultySpec);
}
// An enemy's traits as its target card lists them (src/traits.js traitLabels): everything but the traits of affixes it
// has not shown yet. The bot reads traits only through this.
export const shownTraits=e=>(e?.traits||[]).filter(t=>!t.source.startsWith('affix:')||e.affixes?.some(a=>a.revealed&&t.source===`affix:${a.id}`));
export const shownTrait=(e,id)=>activeTrait({traits:shownTraits(e)},id);
// What an enemy sees in the dark: its shown traits, and the rule that swarm eyes see in the dark on the new lighting.
function senses(g,e){
 return {nv:shownTrait(e,'night_vision')||newLighting(g)&&e.faction==='swarm',ir:shownTrait(e,'infrared'),mech:Boolean(enemyCard(e).mechanical)};
}
function enemyView(g,e){
 const def=enemyCard(e),tree=unitTree(e);
 return {id:e.id,type:e.type,x:e.x,y:e.y,hp:e.hp,maxHp:e.maxHp??e.hp,armor:def.armor||0,range:def.range||0,damage:enemyDamage(g,e),
  rounds:def.rounds||1,rapid:Boolean(def.rapid),melee:(def.range||0)<=1,boss:isBossClass(e),civilian:isNoncombatant(e),
  flying:hasEnemyTag(e,'flying'),large:shownTrait(e,'large'),fast:shownTrait(e,'fast'),slow:shownTrait(e,'slow'),mechanical:Boolean(def.mechanical),
  bomber:tree===unitTree({type:'bomber'})||def.behavior==='bomber',sniper:Boolean(tree.fixedTile),band:enemyBand(e.type),
  // Shown on the target card: alert or not, winding up (with the sniper's countdown), moved, disabled.
  alert:Boolean(e.alert),charge:Boolean(e.charge),windup:e.windup||0,aim:e.aim?{...e.aim}:null,moved:Boolean(e.moved),
  disabled:Boolean(e.control?.disabled),elite:Boolean(e.elite),expendable:Boolean(def.expendable),xp:def.xp||0,...senses(g,e),ref:e};
}

// ---- telegraphs ----------------------------------------------------------------------------------------------------
// Danger by tile: `t` is how many of our actions remain before it resolves (0 = it resolves in the round our next action
// starts, so ending that action on the tile is what hurts), `dmg` a rough size, `kind` for the log. Cells are filtered
// to tiles the player can see, as the renderer draws them (src/renderer-telegraphs.js).
function addDanger(map,g,cells,t,dmg,kind,{always=false}={}){
 for(const c of cells){
  if(!always&&!g.visible(c)&&!(c.x===g.player.x&&c.y===g.player.y))continue;
  const k=key(c),old=map.get(k);
  if(!old||t<old.t||t===old.t&&dmg>old.dmg)map.set(k,{t,dmg:Math.max(dmg,old&&old.t===t?old.dmg:0),kind,x:c.x,y:c.y});
  else if(old&&old.t===t)old.dmg+=0;
 }
}
const disc=(c,r,metric=dist)=>{const out=[];for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const q={x:c.x+dx,y:c.y+dy};if(metric(q,c)<=r)out.push(q);}return out;};
export function dangerMap(g){
 const map=new Map(),now=g.turn;
 // Bombardments and thrown grenades in flight (g.marks, due at the end of the round `due`).
 for(const m of g.marks||[]){
  const t=Math.max(0,m.due-(now+1)),cells=m.stun?disc(m,1,cheb):disc(m,m.radius??1);
  addDanger(map,g,cells,t,m.stun?25:m.damage??38,m.stun?'stun':m.kind==='grenade'?'grenade':'bombard',{always:true});
 }
 // A grenadier getting ready: thrown next round, bursts the round after (src/enemy-behavior.js grenade).
 for(const m of grenadeTelegraphs(g).filter(m=>m.phase==='prepare'))
  addDanger(map,g,m.stun?disc(m,1,cheb):disc(m,AFFIX_TUNING.grenadeRadius),1,m.stun?25:AFFIX_TUNING.grenadeDamage,m.stun?'stun-prep':'grenade-prep',{always:true});
 for(const e of g.enemies){
  if(e.hp<=0)continue;
  if(liveFlameIntent(e))addDanger(map,g,flameCells(g,e.flameIntent.origin,e.flameIntent.aim),0,30,'flame');
  if(liveGun(e))addDanger(map,g,gunCells(g,e.gun.origin,e.gun.aim),e.gun.stage==='sweep'?0:0,45,'gun');
  if(liveFireIntent(e))addDanger(map,g,e.fireIntent.cells,0,20,e.fireIntent.kind==='ring'?'ring':'wall');
  if(liveBurn(e))addDanger(map,g,burnCells(g,e.burn.origin,e.burn.aim),0,35,'burn');
  if(e.pounceIntent)addDanger(map,g,[e.pounceIntent.target],0,25,'pounce');
  if(e.lobIntent)addDanger(map,g,areaCells(g.grid,e.lobIntent.point,FIELD_TUNING.radius,g.barriers,g).filter(q=>g.grid[q.y]?.[q.x]===1),0,10,'lob');
 }
 for(const tg of tongueTelegraphs(g))addDanger(map,g,tg.lane,0,35,'tongue');
 for(const l of chargeLanes(g))addDanger(map,g,l.cells,0,40,'charge');
 for(const s of smokeTelegraphs(g))addDanger(map,g,s.cells,0,0,'smoke');
 return map;
}

// Standing hazards: what hurts a unit that ends the round on the tile (acid/heat patches, burning floor, steam, mist).
export function hazardAt(g,x,y){
 if(!g.seen[y]?.[x])return 0;
 let h=0;
 const patch=g.hazards.find(z=>z.x===x&&z.y===y);if(patch)h+=patch.type==='acid'?14:12;
 if(burningAt(g,{x,y}))h+=14;
 for(const s of g.smoke||[])if(s.cells.some(c=>c.x===x&&c.y===y)){if(s.kind==='toxic')h+=8;else if(s.kind==='steam')h+=10;}
 return h;
}

// ---- self ----------------------------------------------------------------------------------------------------------
function selfView(g){
 const p=g.player,w=g.weapon;
 const weapons=p.owned.map(slot=>{const s=g.weaponAt(slot);return {slot,id:s.id,cls:s.weaponClass,melee:Boolean(s.melee),range:s.range,mag:s.mag,ammo:p.ammo[slot]??0,
  reserve:s.melee||s.tank?Infinity:(p[g.reserveKey(s)]??0),shotCost:s.shotCost||1,pointTarget:Boolean(s.pointTarget),cone:Boolean(s.cone),flame:Boolean(s.flame),tank:Boolean(s.tank),
  explosive:Boolean(s.explosive),burst:s.burst||1,band:s.band??null,locked:Boolean(s.locked),aimPenalty:s.aimPenalty||0,stats:s};});
 const skills=Object.fromEntries((p.skills||[]).map(id=>[id,{remaining:p.skillState?.[id]?.remaining||0,cooldown:p.skillState?.[id]?.cooldown||0}]));
 // Its own light makes its tile dim, so the tile is judged as it would be with the flashlight off: on a read-only view
 // of the game whose player carries no light (the game itself is never touched; the screen shows the same shading).
 let black,dark;
 if(p.flashlight||p.lightLingers){const dim=Object.create(g);dim.player={...p,flashlight:false,lightLingers:false};black=isBlack(dim,p);dark=isDark(dim,p);}
 else{black=isBlack(g,p);dark=isDark(g,p);}
 return {x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,plates:p.plates||0,plateCap:g.plateCapacity,armor:p.armor||0,character:p.character,level:p.level,
  weapon:p.weapon,weapons,held:weapons.find(x=>x.slot===p.weapon)||null,meds:p.meds||0,grenades:{frag:p.grenades||0,smoke:p.smoke||0,emp:p.emp||0,stun:p.stun||0},
  prepared:{...p.prepared},sprays:p.sprays||0,adrenaline:p.adrenaline||0,barricades:p.barricades||0,decoys:p.decoys||0,mines:p.mines||0,flares:p.flares||0,
  glowsticks:p.glowsticks||0,escapeLines:p.escapeLines||0,redeployLines:p.redeployLines||0,scrap:p.scrap||0,skills,
  pinned:pinned(p),suppression:suppressionStacks(p),disabled:Boolean(p.control?.disabled),recovery:Boolean(p.recovery),poison:p.poison||0,
  focus:Boolean(p.focus),guard:Boolean(p.guard),moved:Boolean(p.moved),pursuit:Boolean(g.pursuit),shadowSteps:g.shadowSteps||0,
  flashlight:Boolean(p.flashlight),black,dark,keycard:Boolean(p.keycards?.includes(g.floor)),signalBreak:skillActive(p,'signal_break'),
  anchored:skillActive(p,'anchor'),camo:(p.skillState?.camouflage?.remaining||0)>0,nightVision:activeTrait(p,'night_vision'),slow:activeTrait(p,'slow'),ref:p};
}

// ---- the whole view ------------------------------------------------------------------------------------------------
export function buildView(g,memory,options=DEFAULT_OPTIONS){
 const me=selfView(g);
 const seenEnemies=g.enemies.filter(e=>e.hp>0&&g.teamVisible(e)).map(e=>enemyView(g,e));
 memory.observe(g,seenEnemies);
 const known=options.mapKnown?()=>true:(x,y)=>Boolean(g.seen[y]?.[x]);   // knowledge: the floor plan, only with mapKnown
 // Light on a tile as the floor shading shows it, judged with our own lantern off (one read-only copy per turn, so the
 // light cache is built once): what an enemy without night vision would see of us there.
 const dim=Object.create(g);dim.player={...g.player,flashlight:false,lightLingers:false};
 const lightCache=new Map(),light=t=>{const k=t.y*64+t.x;let v=lightCache.get(k);if(v===undefined){v=lightAt(dim,t);lightCache.set(k,v);}return v;};
 const seenAt=o=>Boolean(g.seen[o.y]?.[o.x]);
 const exit=g.exitPoint;
 const view={
  g,options,light,LIGHT,turn:g.turn,floor:g.floor,faction:g.facilityFaction,difficulty:g.difficulty,character:g.player.character,me,
  // Enemies the bot decided to leave alone (a standoff that went nowhere) drop out of the fight until they come close.
  enemies:seenEnemies.filter(e=>!e.civilian&&!(memory.ignored.get(e.id)>=g.turn&&dist(e,me)>3)),civilians:seenEnemies.filter(e=>e.civilian),
  ignored:seenEnemies.filter(e=>!e.civilian&&memory.ignored.get(e.id)>=g.turn&&dist(e,me)>3),
  // Tiles held by a unit we can see (enemies and civilians): the only occupied tiles the bot knows about.
  occupied:new Set(seenEnemies.map(e=>key(e))),
  ghosts:memory.ghosts(g).filter(x=>!seenEnemies.some(e=>e.id===x.id)),
  allies:(g.localAllies||[]).filter(a=>a.hp>0&&a.status==='active'),
  danger:dangerMap(g),
  known,
  exit:known(exit.x,exit.y)?{x:exit.x,y:exit.y,blocked:g.exitBlocked||''}:null,
  // A rigged case (rebel floors) is the one case a tap locks on (src/containers.js: its hp is the only tell); opening or
  // shooting it destroys what it holds and it blows up, so the bot leaves it alone. `hp` present = "a tap would lock on".
  containers:g.props.filter(o=>isContainer(o)&&!o.opened&&seenAt(o)&&o.hp===undefined),
  terminals:g.props.filter(o=>o.type==='terminal'&&!o.used&&seenAt(o)),
  barrels:g.props.filter(o=>o.type==='barrel'&&o.hp>0&&seenAt(o)),
  items:shownItems(g).filter(i=>seenAt(i)),
  doors:g.barriers.filter(b=>b.type==='door'&&b.hp>0),
  // The matriarch's egg sacs (drawn on the floor): one whose tile is occupied when it hatches is crushed.
  eggs:eggSacs(g).filter(s=>g.visible(s)),
 };
 return view;
}
