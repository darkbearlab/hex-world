// 奇美拉：完整玩家角色小隊的大腦（src/chimera-squad.js 的 brains）。每位隊員一個機器人，各有自己的記憶；
// 被操作的那位（g.controlled）照通關機器人的方式玩（探索、撤離），其他人沒有敵人時跟著他。
import {ClearBot} from '../clear-bot/bot.mjs';
import {route} from '../clear-bot/nav.mjs';
import {dist} from '../clear-bot/util.mjs';

export const FULL_SQUAD_TUNING={follow:2};
export class MemberBot extends ClearBot{
 quiet(view){
  const g=this.g,lead=g.controlled;
  if(!lead||lead===g.player||lead.hp<=0)return super.quiet(view);
  if(dist(view.me,lead)<=FULL_SQUAD_TUNING.follow)return {type:'wait',why:'with leader'};
  const r=route(view,q=>dist(q,lead)<=FULL_SQUAD_TUNING.follow,{allyCost:0});
  return r?{type:'move',arg:r.first,walk:true,why:`follow ${lead.squadId}`}:{type:'wait',why:'no way to leader'};
 }
}
// 每位隊員一個機器人（第一次輪到他時才建，建的時候 g.player 已經是他）
export function installFullSquad(g,{onError=null}={}){
 const bots=new Map();
 const botFor=m=>{let b=bots.get(m);if(!b){b=new MemberBot(g,{seed:(Number(g.seed)||1)+bots.size*7919});bots.set(m,b);}return b;};
 for(const m of g.members)g.brains.set(m,(game,member)=>{try{botFor(member).step();}catch(error){(onError||console.warn)(`member ${member.squadId}: ${error.stack||error}`);game.soloDone=true;}});
 return {bots,botFor};
}
