// Clear bot arsenal (docs/CLEAR_BOT.md §3.6, round 2): building the pack. Every weapon decision — take a gun from the
// floor, swap one for it, scrap it, which weapon a terminal upgrades, which ammunition to buy, which gun to hold between
// fights — compares the pack's score (loadout.mjs packScore: the best weapon for each threat of this facility at each
// fight distance, times how long it keeps firing) before and after, with a margin so the pack does not churn.
import {threats,packScore,ownedCards,slotCard,sustain,actionDamage} from './loadout.mjs';
import {salvageValue} from '../../src/weapons.js';
import {upgradeCost,TERMINAL_TUNING} from '../../src/terminal.js';

export const ARSENAL_TUNING=Object.freeze({margin:.06,minGain:1.5,scrapValue:.06});
const profiles=new Map();
export function profileFor(view){
 const k=`${view.faction}|${view.floor}`;let p=profiles.get(k);
 if(!p){p=threats(view.faction,view.floor);profiles.set(k,p);}
 return p;
}
// Memoised per turn: the same pack is scored many times in one decision (terminals, ground guns, contributions).
const memo={turn:-1,floor:-1,map:new Map()};
export function packValue(view,cards){
 if(memo.turn!==view.turn||memo.floor!==view.floor||memo.g!==view.g){memo.turn=view.turn;memo.floor=view.floor;memo.g=view.g;memo.map.clear();}
 const k=cards.map(c=>`${c.slot}:${c.bonus}`).join('|');let v=memo.map.get(k);
 if(v===undefined){v=packScore(view.g,cards,profileFor(view));memo.map.set(k,v);}
 return v;
}
// What each gun of the pack adds: the score lost without it.
export function contributions(view){
 const cards=ownedCards(view.g),all=packValue(view,cards);
 return new Map(cards.map(c=>[c.slot,all-packValue(view,cards.filter(x=>x!==c))]));
}
// A weapon on the floor next to us: take it (a free slot), swap one of ours for it, or scrap it — whichever raises the
// pack most; scrap counts for a little (a terminal buys with it; the engineer builds with it).
export function groundChoice(view,item){
 const g=view.g,p=g.player,cards=ownedCards(g),base=packValue(view,cards),ground=slotCard(g,item.slot);
 if(!ground)return null;
 const need=Math.max(ARSENAL_TUNING.minGain,base*ARSENAL_TUNING.margin);
 const scrap=ground.w.locked?0:salvageValue(p,item.slot)*ARSENAL_TUNING.scrapValue;
 let best={type:ground.w.locked?null:'salvageGround',arg:item.slot,gain:scrap,why:`scrap ${ground.w.id}`};
 if(p.owned.length<g.weaponCapacity){
  const gain=packValue(view,[...cards,ground])-base;
  if(gain>=need&&gain>best.gain)best={type:'takeWeapon',arg:item.slot,gain,why:`take ${ground.w.id} (+${gain.toFixed(1)})`};
 }
 for(const c of cards){
  if(c.w.locked)continue;
  // Swapping leaves the old gun (and its upgrades) on the floor: its value is what the pack loses.
  const gain=packValue(view,[...cards.filter(x=>x!==c),ground])-base;
  if(gain>=need&&gain>best.gain)best={type:'replaceWeapon',arg:{take:item.slot,leave:c.slot},gain,why:`swap ${c.w.id}${c.upgrades?`+${c.upgrades}`:''} for ${ground.w.id} (+${gain.toFixed(1)})`};
 }
 return best.type?best:null;
}
// Worth walking to? Only a take or a swap (scrapping a gun is not worth a detour, unless we are the engineer).
export function groundWorth(view,item){
 const c=groundChoice(view,item);if(!c)return 0;
 if(c.type==='salvageGround')return view.character==='engineer'?c.gain:0;
 return c.gain;
}
// A terminal's upgrade: the gun whose +5 raises the pack most for its price.
// `rich`: with scrap to spare (the runs of round 2 ended with 400-900 unspent) any upgrade that helps at all is worth it.
export function bestUpgrade(view,{rich=view.me.scrap>=100}={}){
 const g=view.g,p=g.player,cards=ownedCards(g),base=packValue(view,cards);let best=null;
 for(const c of cards){
  if(c.w.melee||c.w.tank||(p.upgrades[c.slot]||0)>=TERMINAL_TUNING.upgradeMax)continue;
  const up={...c,bonus:c.bonus+5},gain=packValue(view,cards.map(x=>x===c?up:x))-base;
  const per=gain/upgradeCost(p.upgrades[c.slot]||0);
  if(gain>(rich?0.02:0.4)&&(!best||per>best.per))best={slot:c.slot,gain,per};
 }
 return best;
}
// The gun to hold between fights: the one that alone scores best against this floor's ordinary enemies at the distance
// fights usually start at (contact is seldom point-blank: the first shots are traded at 4-6 tiles).
export const CONTACT=Object.freeze([[2,.15],[4,.45],[6,.4]]);
export function mainWeapon(view){
 const g=view.g,cards=ownedCards(g).filter(c=>!c.w.melee&&!c.w.pointTarget&&!c.w.flame&&sustain(g,c)>0.15);
 if(!cards.length)return null;
 const common=profileFor(view).filter(t=>!t.boss);
 let best=null,score=-1;for(const c of cards){const s=packScore(g,[c],common,{distances:CONTACT});if(s>score){score=s;best=c.slot;}}
 return best;
}
// Can anything in the pack hurt `e` from somewhere (not just from here)? Best expected damage of one action.
export function packDamageOn(view,e){
 const g=view.g;let best=0;
 for(const c of ownedCards(g)){if(sustain(g,c)<=0.05&&!c.w.melee)continue;for(const d of [1,2,4,6])best=Math.max(best,actionDamage(c.w,{armor:e.armor,mech:e.mechanical,hp:e.hp},d,c.bonus));}
 return best;
}
