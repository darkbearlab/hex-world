// Clear bot: the engineer (docs/ENGINEER.md). Its drones do much of the fighting: deploy the finished drone at once,
// keep a spare building whenever scrap allows, repair a hurt drone standing beside it (10 scrap for half its health
// beats a 30-scrap rebuild), scrap every spare gun on the ground (30 each for the engineer), and gather the drones before
// the elevator, since only units within three steps travel.
import {buildReason,deployReason,deployedUnits,repairTargets,UNIT_BLUEPRINTS} from '../../../src/workshop.js';
import {deployLimit,carryCandidates,currentAllies} from '../../../src/allies.js';
import {hostiles,stayCost,dist} from './common.mjs';

function buildChoice(g){
 const p=g.player;
 // Enemy blueprints first when owned (sturdier chassis), then the follow drone; boss blueprints when rich.
 for(const id of ['unit_boss','unit_warden'])if(!buildReason(g,id))return {blueprint:id};
 if(deployedUnits(g).length+p.productionLines.length<deployLimit(p)+1){
  if(!buildReason(g,'drone_follow'))return {blueprint:'drone_follow'};
  if(!buildReason(g,'unit_drone'))return {blueprint:'unit_drone'};
 }
 return null;
}
function deployNow(g){
 const p=g.player;
 for(let line=0;line<p.productionLines.length;line++)if(!deployReason(g,line))return {type:'deployUnit',arg:{line},why:`deploy ${p.productionLines[line].blueprint}`};
 return null;
}
export default {
 perks:{engineer_deploy:80,engineer_frame:72,engineer_firecontrol:66,engineer_lines:60,engineer_salvage:50,scavenger:40},
 combat(view,bot){
  const g=view.g,out=[];
  const d=deployNow(g);if(d)out.push({...d,score:25-stayCost(view)});
  return out;
 },
 quiet(view,bot){
  const g=view.g,me=view.me;
  const d=deployNow(g);if(d)return d;
  const hurt=repairTargets(g).filter(a=>a.hp<=a.maxHp-35&&me.scrap>=10).sort((a,b)=>a.hp-b.hp)[0];
  if(hurt)return {type:'repairUnit',arg:hurt.id,why:'repair drone'};
  const b=buildChoice(g);if(b)return {type:'buildUnit',arg:b,why:`build ${b.blueprint}`};
  return null;
 },
 beforeExit(view,bot){
  const g=view.g,near=carryCandidates(g).length,all=currentAllies(g).filter(a=>a.sourceId!=='drone_munition'&&a.sourceId!=='unit_bomber').length;
  if(near>=all||bot.exitGathered===view.floor)return null;
  if(bot.exitFloor!==view.floor){bot.exitFloor=view.floor;bot.exitWaits=0;}
  if(++bot.exitWaits<=4)return {type:'wait',why:'gather drones'};
  bot.exitGathered=view.floor;return null;
 },
};
