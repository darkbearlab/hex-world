// Clear bot loadout (docs/CLEAR_BOT.md §3.6, round 2): what a weapon is for, and how well a pack of them covers what this
// run will face. Everything comes from what the player can read: the weapon's card (Game.weaponAt: damage, rounds, range
// band, pierce, ammunition, affix, the upgrades bought for it), the ammunition-against-armour table the rules publish
// (src/ammunition.js), the facility's faction from the deploy briefing, and the hostile database (ENEMY_TYPES: each
// card's health and armour; the faction's roster and its floor-3 and floor-6 bosses, as the codex lists them).
import {ENEMY_TYPES,WEAPONS} from '../../src/data.js';
import {factionDef} from '../../src/faction-catalog.js';
import {ammoMultiplier} from '../../src/ammunition.js';
import {bandPenalty} from '../../src/range-band.js';
import {volleyAt} from '../../src/weapons.js';
import {pelletsAt,pelletChance} from '../../src/shotgun.js';

// How easily each kind of ammunition is found again (drops, supply rooms, terminals): rifle and pistol rounds are
// everywhere, shells less, batteries and ordnance rarely; a flamethrower's tank never refills.
export const AMMO_SUPPLY=Object.freeze({rifle:1,pistol:1,shell:.85,energy:.65,ordnance:.45,fuel:.35});
export const DISTANCES=Object.freeze([[1,.12],[2,.25],[4,.4],[6,.23]]);   // how far fights happen, and how often

// Expected damage of one action with weapon `w` (a Game.weaponAt card) on a target with `armor` at distance `d`.
// `bonus`: the damage the player adds to every trigger (upgrades × 5, perks), split over the burst as the rules do.
export function actionDamage(w,{armor=0,mech=false,hp=40},d,bonus=0){
 if(!w||d>w.range)return 0;
 if(w.melee){if(d>(w.range||1))return 0;const hits=w.hits||1,per=(w.min+w.max)/2+bonus/hits;return hits*(w.hitChance||95)/100*Math.max(1,per-armor*(1-(w.pierce||0)));}
 if(w.flame)return Math.max(1,(w.min+w.max)/2-armor)*1.3;   // a cone that never misses, often two targets
 if(w.pointTarget)return ((w.min+w.max)/2+bonus)*1.4;       // a blast: no hit roll, no armour, usually more than one
 if(w.pellets){const n=pelletsAt(w,d),per=(w.pelletMin+w.pelletMax)/2+Math.ceil(bonus/Math.max(1,n)),m=ammoMultiplier('shell',armor,w.pierce||0)??1;return n*pelletChance(w)/100*Math.max(1,per*m);}
 const rounds=volleyAt(w,d),per=(w.min+w.max)/2+Math.ceil(bonus/(w.burst||1));
 const m=w.explosive?null:ammoMultiplier(w.ammoType,armor,w.pierce||0);
 let hit=Math.max(1,m===null?per-armor*(1-(w.pierce||0)):per*m);if(w.ammoType==='energy'&&mech)hit*=1.2;
 let chance=Math.min(.97,Math.max(.1,(92+(w.accuracyBonus||0)-bandPenalty(w.band,d))/100));
 if(w.aimPenalty)chance*=.6;   // a precision rifle wants a turn of aiming: about every other action
 return rounds*chance*hit*(w.explosive?1.25:1);
}
// The weapon card of a slot, with the damage the player adds to it.
export function slotCard(g,slot){
 const p=g.player,w=g.weaponAt(slot);if(!w)return null;
 return {slot,w,bonus:(p.bonus||0)+(p.perkWeaponBonus||0)+(p.upgrades[slot]||0)*5,upgrades:p.upgrades[slot]||0};
}
// How long a weapon keeps firing: how many actions of fire its magazine and reserve hold (against 30), how easy its rounds
// are to find again, and the turn each reload costs (a two-round launcher reloads every other action).
export function sustain(g,card,{magazine=null}={}){
 const w=card.w;if(w.melee)return 1;
 const p=g.player,mag=magazine??p.ammo[card.slot]??0;
 if(w.tank)return AMMO_SUPPLY.fuel*Math.min(1,mag/w.mag);
 const key=g.reserveKey(w),reserve=p[key]||0,supply=AMMO_SUPPLY[w.ammoType]??.5;
 const perAction=Math.max(1,(w.burst||1)*(w.shotCost||1)),actions=(mag+reserve)/perAction,perMag=Math.max(1,w.mag/perAction);
 return supply*(.4+.6*Math.min(1,actions/30))*(perMag/(perMag+1));
}

// ---- what this run faces ----------------------------------------------------------------------------------------
// Cards of the facility's roster for the floors still to come, weighted by how often they appear; each boss counts as
// several (it is the fight a weapon is needed for most).
export function threats(faction,floor){
 const def=factionDef(faction),out=new Map();if(!def)return [];
 const add=(type,w)=>{const c=ENEMY_TYPES[type];if(!c||!c.damage)return;const k=type;const cur=out.get(k)||{type,armor:c.armor||0,hp:c.hp,mech:Boolean(c.mechanical),boss:Boolean(c.tags?.includes('boss')),w:0};cur.w+=w;out.set(k,cur);};
 for(let f=Math.max(1,floor);f<=6;f++){
  const list=f<=3?def.roster.early:def.roster.late;
  for(const [type,n] of list)add(type,n*.5);
  for(const type of (f<=3?def.squads?.early:def.squads?.late)||[])add(type,.5);
  if(f===3||f===6)add(def.bosses[f],f===6?5:4);
 }
 return [...out.values()];
}
export const tier=a=>a<=0?'flesh':a<=2?'light':a<=5?'medium':'heavy';

// ---- scoring a pack ---------------------------------------------------------------------------------------------
// For each threat and each fight distance, the best weapon in the pack (its damage × how long it keeps firing); the
// pack's score is the weighted sum. The max, not the sum, is what makes a second gun worth only what the first cannot do.
export function packScore(g,cards,profile,{magazines=null,distances=DISTANCES}={}){
 let total=0,weight=0;
 for(const t of profile){
  for(const [d,pd] of distances){
   let best=0;
   for(const c of cards){const v=actionDamage(c.w,t,d,c.bonus)*sustain(g,c,{magazine:magazines?.get(c.slot)});if(v>best)best=v;}
   total+=t.w*pd*Math.min(best,t.hp*1.2);weight+=t.w*pd;
  }
 }
 return weight?total/weight:0;
}
// Role coverage, for the report: anti-armour (armour 7 at 4 tiles), anti-flesh (armour 0 at 2-4), long (armour 0 at 7).
export function roles(g,cards){
 const best=(t,d)=>Math.max(0,...cards.map(c=>actionDamage(c.w,t,d,c.bonus)*(sustain(g,c)>0.2?1:0)));
 return {antiArmor:best({armor:7},4)>=18,antiFlesh:Math.max(best({armor:0},2),best({armor:0},4))>=30,long:best({armor:0},7)>=15};
}
export const ownedCards=g=>g.player.owned.map(slot=>slotCard(g,slot)).filter(Boolean);
