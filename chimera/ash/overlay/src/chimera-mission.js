// 奇美拉的任務戰鬥（hex-world chimera/ash/overlay；不屬於 ASH 本體）。照 KillhouseGame 的做法：一場戰鬥＝第一層，
// 敵人照任務票擺（simulation.kind='chimera' 讓 ASH 不另外加徵召兵、巡邏小隊、詭雷箱），撤離＝勝；隊長是玩家角色，其餘三人是倖存友軍（survivor）。不存檔。
import {Game} from './game.js';
import {generate,makeEnemy} from './world.js';
import {addAlly,routeCells} from './allies.js';
import {isNoncombatant} from './enemy-data.js';
import {CHARACTERS} from './characters.js';
import {pickPortrait,validPortrait} from './portraits.js';
import {t} from './i18n.js';

// 奇美拉的敵人 → ASH 的兵種卡（暫定，見 warband/DESIGN.md「接上 ASH 的做法定案」）
export const ENEMY_MAP={raider:'raider',raider_heavy:'gunner',native:'raider_infected',native_hunter:'sniper',
 trooper:'rifleman',trooper_heavy:'rifleman_armored',clone_trooper:'raider_armored'};
export const VEHICLE_MAP={rush:'bomber_bot',armor:'turret',gt:'gunner'};
export const BOSS_TYPE='squad_leader';
// 隊友用哪張兵種卡（決定武器：階段 1 沿用 allyWeapon）
export const ALLY_TYPE={soldier:'rifleman',recon:'rifleman',bulwark:'gunner',berserker:'brute',engineer:'raider'};
// 奇美拉的職業 → ASH 的職業（同名）；沒有的退回士兵
export const character=cls=>CHARACTERS[cls]?cls:'soldier';

// 任務票展開成兵種清單（固定順序，同一張票每次一樣）
export function ticketUnits(ticket){
 const out=[],e=ticket.enemy||{};
 for(const [k,n]of Object.entries(e.units||{}).sort())for(let i=0;i<n;i++)out.push(ENEMY_MAP[k]||'raider');
 for(const [k,n]of Object.entries(e.veh||{}).sort())for(let i=0;i<n;i++)if(VEHICLE_MAP[k])out.push(VEHICLE_MAP[k]);
 if(e.boss)out.unshift(BOSS_TYPE);
 return out;
}
const lcg=seed=>{let s=(Number(seed)>>>0)||1;return ()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296);};
const near=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));

let building=null;   // generateFloor 在 Game 的建構子裡就被叫到，這時 this.ticket 還沒設
export class MissionGame extends Game{
 // ticket：{seed, faction:'loyalist'|'rebel', enemy:{units,veh,boss}, squad:[{id,cls,portrait?,st:{hp,acc,eva,mel}}]}
 constructor(ticket){
  const lead=ticket.squad[0],portrait=validPortrait(lead.portrait)?lead.portrait:pickPortrait();
  building=ticket;
  try{super(ticket.seed,[],0,character(lead.cls),portrait,'extraction',{facilityFaction:ticket.faction||'rebel',simulation:{kind:'chimera'}});}finally{building=null;}
  this.ticket=ticket;this.chimera={members:ticket.squad.map(c=>c.id),units:{}};
  this.chimera.units[lead.id]='player';applyStats(this.player,lead,CHARACTERS[this.player.character]);
  // 三名隊友排在隊長身邊（兩步內的空格，不穿門）；SquadGame（隊友是完整的玩家角色）自己排
  if(!new.target.fullSquad)for(const c of ticket.squad.slice(1)){
   const cell=routeCells(this,this.player,{limit:3,openDoors:false}).find(q=>q.d>0);if(!cell)continue;
   const a=addAlly(this,'survivor',ALLY_TYPE[c.cls]||'rifleman',{sourceId:`chimera:${c.id}`,point:cell});if(!a)continue;
   applyStats(a,c,null);a.chimera={id:c.id,cls:c.cls,name:c.name||c.id};this.chimera.units[c.id]=a.id;
  }
  this.logs=[];this.log(t('game.arrived'));
 }
 generateFloor(){
  const tk=building||this.ticket,map=generate(this.seed,1,[],this.difficultySpec,this.facilityFaction);
  const want=ticketUnits(tk);if(!want.length)return map;
  // 位置：先用原本的敵人站位（合法的巡邏點），不夠再從離起點遠的地板格補
  const posts=map.enemies.filter(e=>!isNoncombatant(e)).map(e=>({x:e.x,y:e.y}));
  const taken=new Set([...map.props,...map.items,...(map.hazards||[]),map.start,map.end].map(p=>`${p.x},${p.y}`));
  const rnd=lcg(tk.seed);
  const spare=[];for(let y=0;y<map.grid.length;y++)for(let x=0;x<map.grid[y].length;x++){const k=`${x},${y}`;if(map.grid[y][x]===1&&!taken.has(k)&&near({x,y},map.start)>=7)spare.push({x,y});}
  for(let i=spare.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[spare[i],spare[j]]=[spare[j],spare[i]];}
  const used=new Set(),cells=[];
  for(const p of [...posts,...spare]){const k=`${p.x},${p.y}`;if(used.has(k))continue;used.add(k);cells.push(p);if(cells.length>=want.length)break;}
  map.enemies=[...want.slice(0,cells.length).map((type,i)=>makeEnemy(type,cells[i].x,cells[i].y,`c${i+1}`,1,this.difficultySpec,this.facilityFaction))];
  map.swarmWaves=undefined;
  return map;
 }
 awardProtocol(){}
 // 撤離＝勝：走到電梯旁按撤離就結束，不下樓
 descend(){
  if(this.status!=='playing'||this.player.hp<=0)return false;
  if(!this.canTouch(this.exitPoint))return this.fail(t('game.needElevator'));
  if(this.exitBlocked)return this.fail(this.exitBlocked);
  this.status='won';this.log('撤離完成。');return true;
 }
 // 戰果：誰陣亡（隊長陣亡＝敗，階段 2 才有交棒）
 get missionResult(){
  const dead=[];
  for(const [id,unit]of Object.entries(this.chimera.units)){
   if(unit==='player'){if(this.player.hp<=0)dead.push(id);continue;}
   const a=this.allies.find(x=>x.id===unit);if(!a||a.hp<=0||a.status==='destroyed')dead.push(id);
  }
  const kills=this.enemies.filter(e=>e.hp<=0&&!isNoncombatant(e)).length,total=this.enemies.filter(e=>!isNoncombatant(e)).length;
  return {win:this.status==='won',dead,kills,total,turns:this.turn};
 }
 serialize(){throw Error('奇美拉的任務戰鬥不存檔');}
}
// 奇美拉的數值：生命直接用；命中、閃避、近戰是總值，扣掉職業本身的部分當作個體修正
export function applyStats(unit,c,charDef){
 const st=c.st||{},base=charDef?.combat||{};
 if(st.hp){unit.maxHp=unit.hp=Math.round(st.hp);}
 unit.combatModifiers={rangedAccuracy:(st.acc||0)-(base.rangedAccuracy||0),rangedEvasion:(st.eva||0)-(base.rangedEvasion||0),meleeAccuracy:(st.mel||0)-(base.meleeAccuracy||0)};
}
