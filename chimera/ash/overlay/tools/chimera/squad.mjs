// 奇美拉的隊友大腦（hex-world chimera/ash/overlay；docs/CLEAR_BOT.md 第 5 節的做法，用在倖存友軍上）。
// 通關機器人的決策層不變，只換兩端：
//   感知：每回合做一個「以這名隊友為中心」的遊戲外殼（Object.create(g)），外殼的 player 是隊友的代理物件，
//         武器換成隊友的兵種卡武器；真正的隊長在外殼裡變成一名友軍。外殼只讀不寫，寫到它身上的東西不會碰到真的遊戲。
//   執行：外殼的 action 只接受 move／fire／wait，轉成 allies.js 補丁給的 step／attack；其餘一律拒絕（機器人會改選）。
// 沒有敵人時不探索、不撿東西，跟著隊長走。
import {ClearBot} from '../clear-bot/bot.mjs';
import {route} from '../clear-bot/nav.mjs';
import {dist} from '../clear-bot/util.mjs';
import {isNoncombatant} from '../../src/enemy-data.js';
import {distance} from '../../src/world.js';

export const SQUAD_TUNING={follow:2,leash:6};
const LEADER_ID='chimera-leader';

// 隊友的武器，排成玩家武器的樣子：彈匣當作打不完（倖存友軍本來就不用彈藥）
function weaponCard(w){
 return {...w,id:w.id||'rifle',weaponClass:w.melee?'melee':'rifle',melee:Boolean(w.melee),range:w.range,min:w.min,max:w.max,
  mag:99,burst:1,shots:w.shots||1,hitChance:w.hitChance??90,accuracyBonus:w.accuracyBonus||0,ammoType:null,builtIn:true};
}
function facade(g,a,api){
 const f=Object.create(g),w=weaponCard(api.weapon);
 const me=Object.create(a);
 Object.assign(me,{character:undefined,level:1,weapon:0,owned:[0],ammo:[99],meds:0,grenades:0,smoke:0,emp:0,stun:0,prepared:{},
  sprays:0,adrenaline:0,barricades:0,decoys:0,mines:0,flares:0,glowsticks:0,escapeLines:0,redeployLines:0,scrap:0,skills:[],skillState:{},
  control:a.control||{},keycards:[],kills:a.kills||0,xp:0,stats:{damage:a.damageDealt||0},bonus:0,perkWeaponBonus:0,upgrades:{},
  plates:0,flashlight:false,lightLingers:false,facing:a.facing||[0,-1],
  // 不開手電筒：隊友不會開燈（判斷亮暗時當作看得見）
  traits:[...(a.traits||[]),{id:'night_vision',source:'chimera:bot'}]});
 const leader=g.player,proxyLeader={id:LEADER_ID,kind:'survivor',status:'active',floor:g.floor,x:leader.x,y:leader.y,hp:leader.hp,maxHp:leader.maxHp,traits:[]};
 Object.assign(f,{player:me,target:null,pendingPerks:0,
  allies:[...g.allies.filter(x=>x!==a),proxyLeader]});
 f.weaponAt=()=>w;
 Object.defineProperty(f,'weapon',{get:()=>w});
 Object.defineProperty(f,'perkChoices',{get:()=>[]});
 let acted=false;
 f.actionCost=()=>1;
 f.choosePerk=()=>false;
 f.action=(type,arg)=>{
  if(acted||g.status!=='playing')return false;
  if(type==='wait'){acted=true;return true;}
  if(type==='move'&&Array.isArray(arg)){
   const next={x:a.x+arg[0],y:a.y+arg[1]},foe=g.enemies.find(e=>e.hp>0&&e.x===next.x&&e.y===next.y&&!isNoncombatant(e));
   // 走進敵人＝攻擊它（近戰；拿槍的就近距離開火）
   if(foe){if(!g.canCross(a,foe))return false;acted=true;api.attack(foe);return true;}
   if(api.step(next)){acted=true;return true;}
   return false;
  }
  if(type==='fire'){
   const e=g.enemies.find(x=>x.id===f.target&&x.hp>0);
   if(!e||distance(a,e)>w.range||!g.sight(a,e)||!g.shotClear(a,e)||w.melee&&!g.canCross(a,e))return false;
   acted=true;api.attack(e);return true;
  }
  return false;
 };
 return {f,acted:()=>acted};
}

// 跟著隊長：沒有敵人時，離隊長超過 follow 步就走回去，否則原地等
export class SquadBot extends ClearBot{
 quiet(view){
  const leader=view.g.allies.find(x=>x.id===LEADER_ID);
  if(!leader||dist(view.me,leader)<=SQUAD_TUNING.follow)return {type:'wait',why:'with leader'};
  const r=route(view,q=>dist(q,leader)<=SQUAD_TUNING.follow,{allyCost:0});
  return r?{type:'move',arg:r.first,walk:true,why:`follow leader ${leader.x},${leader.y}`}:{type:'wait',why:'no way to leader'};
 }
 pickPerk(){}
}

// 裝到遊戲上：每名倖存友軍一個 SquadBot（各有自己的記憶），每次輪到它時決定一步
export function installSquadBrain(g,{trace=null}={}){
 const bots=new Map();
 // 不可列舉：ASH 每一步動畫前用 structuredClone 複製遊戲（presentation.js snapshot），函式複製不了
 Object.defineProperty(g,'allyBrain',{configurable:true,writable:true,enumerable:false,value:(game,a,api)=>{
  const {f,acted}=facade(game,a,api);
  let bot=bots.get(a.id);
  if(!bot){bot=new SquadBot(f,{seed:(Number(game.seed)||1)+a.id.length*7919});bots.set(a.id,bot);}
  bot.g=f;
  try{bot.step();}catch(error){(trace||console.warn)(`squad brain ${a.id}: ${error.stack||error}`);return false;}
  return acted();
 }});
 return bots;
}
