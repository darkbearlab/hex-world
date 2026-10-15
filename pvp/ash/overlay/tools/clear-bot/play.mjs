// Clear bot: one full run (docs/CLEAR_BOT.md). The run starts from Game.restore of a fresh game's save, exactly as a
// replay log does, so a run with --log and one without play the same.
import './lang-default.mjs';   // English by default (docs/CLEAR_BOT.md)
import {Game} from '../../src/game.js';
import {createReplay,recordReplay,startReplay} from '../../src/replay.js';
import {ClearBot} from './bot.mjs';
import {language} from '../../src/i18n.js';
import {exposureNow,summarize} from './measure.mjs';
import {roles,ownedCards,actionDamage} from './loadout.mjs';
import {isBossClass} from '../../src/enemy-data.js';
import {ENEMY_TYPES} from '../../src/data.js';

// Round 2 yardstick: the pack's roles on arriving at floors 3 and 6, and every boss fight — could the pack hurt the boss
// (a weapon doing 18+ an action against its armour) and did the bot shoot it with its best weapon for it.
function loadoutStats(){return {roles:{},bosses:{}};}
function bestOn(g,e){const c=ENEMY_TYPES[e.type]||{},t={armor:c.armor||0,mech:Boolean(c.mechanical),hp:e.maxHp||c.hp};let best=0,slot=null;for(const k of ownedCards(g)){const v=Math.max(...[1,2,4,6].map(d=>actionDamage(k.w,t,d,k.bonus)));if(v>best){best=v;slot=k.slot;}}return {best,slot,t};}
function trackLoadout(stats,g,bot,floorChanged){
 if(floorChanged&&(g.floor===3||g.floor===6))stats.roles[g.floor]=roles(g,ownedCards(g));
 for(const e of g.enemies){
  if(e.hp<=0||!isBossClass(e)||!g.teamVisible(e))continue;
  let b=stats.bosses[e.id];
  if(!b){const {best}=bestOn(g,e);b=stats.bosses[e.id]={type:e.type,armor:ENEMY_TYPES[e.type]?.armor||0,floor:g.floor,canHurt:best>=18,best:Math.round(best),shots:0,bestShots:0};}
 }
 const i=bot.lastIntent,target=i&&(i.type==='fire'||i.type==='launch')?g.target:null,b=target&&stats.bosses[target];
 if(b){b.shots++;const e=g.enemies.find(x=>x.id===target);if(e){const {best,t}=bestOn(g,e);const k=ownedCards(g).find(c=>c.slot===g.player.weapon);const held=k?Math.max(...[1,2,4,6].map(d=>actionDamage(k.w,t,d,k.bonus))):0;if(held>=best*.8)b.bestShots++;}}
}

export function newRun({seed,character,faction,difficulty='standard',mission='extraction'}){
 return new Game(seed,[],0,character,'onyx',mission,{facilityFaction:faction,difficulty,realMode:false});
}
// What hurt us this action: enemy shots and blows reaching our tile, blasts covering it, else the environment.
function hurtSources(g,at,before){
 const out=[];
 for(const fx of g.effects||[]){
  if(fx.type==='enemyShot'&&fx.damage>0&&fx.to&&fx.to.x===at.x&&fx.to.y===at.y)out.push(fx.attackerType||'enemy');
  else if(fx.type==='blast'&&fx.from&&Math.abs(fx.from.x-at.x)+Math.abs(fx.from.y-at.y)<=(fx.radius??1))out.push('blast');
 }
 if(!out.length&&g.player.hp<before){
  const text=g.logs.filter(l=>l.turn===g.turn&&l.danger).map(l=>l.text).join(' ').toLowerCase();
  out.push(/中毒傷害|poison/.test(text)?'poison':/酸|acid/.test(text)?'acid':/燃燒|火焰|fire|burn/.test(text)?'fire':/蒸氣|steam/.test(text)?'steam':/毒霧|toxic/.test(text)?'toxic':/爆炸|blast/.test(text)?'blast':'other');
 }
 return out;
}
export function playRun({seed,character='soldier',faction='loyalist',difficulty='standard',mission='extraction',maxActions=8000,log=false,options={},trace=null,measure=true}={}){
 const fresh=newRun({seed,character,faction,difficulty,mission});
 let game,replay=null,recorder=null;
 if(log){const r=createReplay(fresh,{seed,character,mission,facilityFaction:faction,difficulty,tool:'clear-bot',language:language()});game=r.game;replay=r.log;recorder=recordReplay(game,replay);}
 else game=startReplay(fresh.serialize());
 const bot=new ClearBot(game,{seed,options,trace});
 let lowest=game.player.hp,lowestFloor=1,lastHurt=[],steps=0;const track=[],loadout=loadoutStats();
 const floorEntry={1:game.turn};
 while(game.status==='playing'&&bot.actions<maxActions&&steps<maxActions*2){
  const hp=game.player.hp,floor=game.floor,before=measure?exposureNow(game):null,acted=bot.actions;
  bot.step();steps++;
  if(measure&&bot.actions>acted&&game.status==='playing')track.push({type:bot.lastIntent?.type||'wait',b:before,a:exposureNow(game)});
  if(game.floor!==floor)floorEntry[game.floor]=game.turn;
  if(measure&&game.status!=='won')trackLoadout(loadout,game,bot,game.floor!==floor);
  if(game.player.hp<hp&&game.floor===floor){const src=hurtSources(game,{x:game.player.x,y:game.player.y},hp);if(src.length)lastHurt=src;}
  if(game.player.hp<lowest&&game.status==='playing'){lowest=game.player.hp;lowestFloor=game.floor;}
 }
 recorder?.flush();
 const p=game.player;
 const cause=game.status==='dead'?(lastHurt.length?[...new Set(lastHurt)].join('+'):'unknown'):game.status==='playing'?'stalled':null;
 return {seed,character,faction,difficulty,status:game.status,floor:game.floor,turn:game.turn,kills:p.kills,hp:Math.max(0,p.hp),lowest:Math.max(0,lowest),lowestFloor,
  actions:bot.actions,refusals:bot.refusals,cause,level:p.level,meds:p.meds,scrap:p.scrap,ropes:bot.stats.ropes||0,retreats:bot.stats.retreats||0,intents:bot.stats.intents,refused:bot.stats.refused,fallbacks:bot.stats.fallbacks||0,clear:{shots:bot.stats.clearShots||0,bumps:bot.stats.clearBumps||0},bounces:bot.stats.bounces||0,
  exposure:measure?summarize(track):null,loadout:measure?loadout:null,weapons:{take:bot.stats.intents.takeWeapon||0,replace:bot.stats.intents.replaceWeapon||0,scrapGround:bot.stats.intents.salvageGround||0},floorTurns:Object.fromEntries(Object.entries(floorEntry).map(([f,t])=>[f,(floorEntry[+f+1]??game.turn)-t])),
  ...(game.status==='playing'?{stall:{x:p.x,y:p.y,why:bot.lastIntent?.why||''}}:{}),log:replay};
}
