// Clear bot: the necromancer (docs/ALLIES.md). Summons rise on their own every few paid turns from the non-mechanical
// dead of this floor and chase what they see; the bot lets them tank. Before the elevator it rallies them (free) and
// gives them a few turns to gather, because only units within three steps change floors — the rest are lost.
import {carryCandidates,currentAllies} from '../../../src/allies.js';
export default {
 perks:{necro_horde:70,necro_haste:66,necro_blades:60,health:50},
 beforeExit(view,bot){
  const g=view.g,all=currentAllies(g).length,near=carryCandidates(g).length;
  if(near>=all||bot.exitGathered===view.floor)return null;
  if(bot.exitFloor!==view.floor){bot.exitFloor=view.floor;bot.exitWaits=0;}
  bot.exitWaits++;
  if(bot.exitWaits===1)return {type:'skill',arg:'raise_dead',why:'rally before the exit'};
  if(bot.exitWaits<=5)return {type:'wait',why:'gather summons'};
  bot.exitGathered=view.floor;return null;
 },
};
