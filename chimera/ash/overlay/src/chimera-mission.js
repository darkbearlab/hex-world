// 奇美拉的任務戰鬥（hex-world chimera/ash/overlay；不屬於 ASH 本體）。照 KillhouseGame 的做法：一場戰鬥＝第一層，
// 敵人照任務票擺（simulation.kind='chimera' 讓 ASH 不另外加徵召兵、巡邏小隊、詭雷箱），撤離＝勝。不存檔。
// 小隊（四位完整的玩家角色）在子類別 SquadGame（chimera-squad.js）。
import {Game} from './game.js';
import {generate,makeEnemy} from './world.js';
import {isNoncombatant} from './enemy-data.js';
import {CHARACTERS} from './characters.js';
import {pickPortrait,validPortrait} from './portraits.js';
import {t} from './i18n.js';
import {outdoorMap} from './chimera-outdoor.js';
import {applySuppression} from './suppression.js';
import {bestCover} from './cover.js';

// 奇美拉的敵人 → ASH 的兵種卡（暫定，見 warband/DESIGN.md「接上 ASH 的做法定案」）
// 服務單上的敵人 → ASH 的兵種。複製兵用執法者（比士兵耐打、有護甲），不再借掠奪者的外型（Alan 2026-10-09：接上服務單上的敵人）
export const ENEMY_MAP={raider:'raider',raider_heavy:'gunner',native:'raider_infected',native_hunter:'sniper',
 trooper:'rifleman',trooper_heavy:'rifleman_armored',clone_trooper:'enforcer'};
export const VEHICLE_MAP={rush:'bomber_bot',armor:'turret',gt:'gunner'};
export const BOSS_TYPE='squad_leader',BOSS_HP=3;   // 頭目：小隊長的三倍血量，帶著服務單上的遺產級武器名
// 戰場上的名字照服務單（public/app.js 的 UNIT、sim.js 的車輛名）
export const UNIT_NAME={raider:'掠奪者',raider_heavy:'重武裝掠奪者',native:'原住民戰士',native_hunter:'原住民獵手',trooper:'士兵',trooper_heavy:'重裝士兵',clone_trooper:'複製兵'};
export const VEHICLE_NAME={rush:'衝鋒車',armor:'武裝車',gt:'戰鬥卡車'};
// 奇美拉的職業 → ASH 的職業（同名）；沒有的退回士兵
export const character=cls=>CHARACTERS[cls]?cls:'soldier';

// 任務票展開成敵人清單（固定順序，同一張票每次一樣）：{type：ASH 兵種, name：服務單上的名字, boss}
export function ticketRoster(ticket){
 const out=[],e=ticket.enemy||{};
 for(const [k,n]of Object.entries(e.units||{}).sort())for(let i=0;i<n;i++)out.push({type:ENEMY_MAP[k]||'raider',name:UNIT_NAME[k]||null});
 for(const [k,n]of Object.entries(e.veh||{}).sort())for(let i=0;i<n;i++)if(VEHICLE_MAP[k])out.push({type:VEHICLE_MAP[k],name:VEHICLE_NAME[k]||null});
 if(e.boss)out.unshift({type:BOSS_TYPE,name:e.boss.weapon?`頭目・${e.boss.weapon}`:'頭目',boss:true});
 return out;
}
export const ticketUnits=ticket=>ticketRoster(ticket).map(u=>u.type);
// 照服務單放一個敵人：名字（ASH 的 courseName 會直接顯示在目標卡與紀錄上）、頭目加血
function rosterEnemy(u,x,y,id,spec,faction){
 const e=makeEnemy(u.type,x,y,id,1,spec,faction);
 if(u.name)e.courseName=u.name;
 if(u.boss){e.maxHp=Math.round((e.maxHp||e.hp)*BOSS_HP);e.hp=e.maxHp;}
 return e;
}
const lcg=seed=>{let s=(Number(seed)>>>0)||1;return ()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296);};
const near=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));

let building=null,outdoorBuilt=null;   // generateFloor 在 Game 的建構子裡就被叫到，這時 this.ticket 還沒設
export class MissionGame extends Game{
 // ticket：{seed, faction:'loyalist'|'rebel', enemy:{units,veh,boss}, squad:[{id,cls,portrait?,st:{hp,acc,eva,mel}}]}
 constructor(ticket){
  const lead=ticket.squad[0],portrait=validPortrait(lead.portrait)?lead.portrait:pickPortrait();
  building=ticket;
  try{super(ticket.seed,[],0,character(lead.cls),portrait,'extraction',{facilityFaction:ticket.faction||'rebel',simulation:{kind:'chimera'}});}finally{building=null;}
  this.ticket=ticket;this.chimera={members:ticket.squad.map(c=>c.id),units:{}};
  if(outdoorBuilt){this.chimeraOutdoor=outdoorBuilt;this.mapStyle=outdoorBuilt.style;outdoorBuilt=null;const g=this.chimeraOutdoor.goal;this.log(g==='exit'?'突圍：走到地圖另一頭的撤離點。':g==='hold'?`守住陣地：撐過 ${this.chimeraOutdoor.holdTurns} 回合，或把敵人清光。`:'把敵人清光。');}
  this.chimera.units[lead.id]='player';applyStats(this.player,lead,CHARACTERS[this.player.character]);
  this.logs=[];this.log(t('game.arrived'));
 }
 generateFloor(){
  const tk=building||this.ticket;
  // 戶外戰鬥（Alan 2026-10-09）：照服務單的類型與那一格的生態產生開闊地；ticket.facility 為真才用 ASH 的設施地圖
  if(!tk.facility){
   const {map,spots,outdoor,style}=outdoorMap({...tk,seed:this.seed},1),want=ticketRoster(tk),rnd=lcg(tk.seed^0xe1e);
   for(let i=spots.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[spots[i],spots[j]]=[spots[j],spots[i]];}
   const used=new Set(),cells=[];for(const p of spots){const k=`${p.x},${p.y}`;if(used.has(k))continue;used.add(k);cells.push(p);if(cells.length>=want.length)break;}
   map.enemies=want.slice(0,cells.length).map((u,i)=>rosterEnemy(u,cells[i].x,cells[i].y,`c${i+1}`,this.difficultySpec,this.facilityFaction));
   // 對方來打的（守點、車隊遇襲、原住民、行軍遇襲）：開場就警戒，朝我方的位置摸過來；攻陣地、戰壕、據點的敵人守著自己的位置
   if(outdoor.layout==='ring'||outdoor.layout==='road')for(const e of map.enemies){e.alert=true;e.lastKnown={x:map.start.x,y:map.start.y};}
   outdoorBuilt={...outdoor,style};return map;
  }
  const map=generate(this.seed,1,[],this.difficultySpec,this.facilityFaction);
  const want=ticketRoster(tk);if(!want.length)return map;
  // 位置：先用原本的敵人站位（合法的巡邏點），不夠再從離起點遠的地板格補
  const posts=map.enemies.filter(e=>!isNoncombatant(e)).map(e=>({x:e.x,y:e.y}));
  const taken=new Set([...map.props,...map.items,...(map.hazards||[]),map.start,map.end].map(p=>`${p.x},${p.y}`));
  const rnd=lcg(tk.seed);
  const spare=[];for(let y=0;y<map.grid.length;y++)for(let x=0;x<map.grid[y].length;x++){const k=`${x},${y}`;if(map.grid[y][x]===1&&!taken.has(k)&&near({x,y},map.start)>=7)spare.push({x,y});}
  for(let i=spare.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[spare[i],spare[j]]=[spare[j],spare[i]];}
  const used=new Set(),cells=[];
  for(const p of [...posts,...spare]){const k=`${p.x},${p.y}`;if(used.has(k))continue;used.add(k);cells.push(p);if(cells.length>=want.length)break;}
  map.enemies=[...want.slice(0,cells.length).map((u,i)=>rosterEnemy(u,cells[i].x,cells[i].y,`c${i+1}`,this.difficultySpec,this.facilityFaction))];
  map.swarmWaves=undefined;
  return map;
 }
 awardProtocol(){}
 // 戰壕（Alan 2026-10-09，像煙霧那樣的特殊地形）：全身格（2）與半身格（1）。
 // - 移動：全身↔半身、半身↔平地照常；平地直接跳進全身格或從全身格直接爬出來（差兩級），吃翻越的破綻（至下次自己行動前被射擊命中 +20）與 3 層壓制。
 // - 掩護：人在戰壕裡、射擊的人在戰壕外時，全身格當成牆那種掩護（擋 42、傷害 −45%），半身格當成一般掩體（擋 35）；和原本的掩護取比較好的。
 trenchAt(x,y){return this.chimeraOutdoor?.trench?.[y]?.[x]||0;}
 trenchStep(u,from){
  if(!this.chimeraOutdoor?.trench||!u||u.hp<=0)return;
  const a=this.trenchAt(from.x,from.y),b=this.trenchAt(u.x,u.y);if(Math.abs(a-b)<2)return;
  u.vaultExposed=true;u.chimeraTrenchExposed=true;applySuppression(u,3);
  if(u===this.player||this.members?.includes(u))this.log(b>a?'直接跳進壕溝：至下次行動前被射擊命中 +20，壓制 +3。':'從壕溝直接爬出來：至下次行動前被射擊命中 +20，壓制 +3。',true);
 }
 executePlayer(type,arg){
  const p=this.player,from={x:p.x,y:p.y};if(p.chimeraTrenchExposed){p.chimeraTrenchExposed=false;p.vaultExposed=false;}   // 破綻到自己下次行動為止
  const ok=super.executePlayer(type,arg);if(ok&&(p.x!==from.x||p.y!==from.y))this.trenchStep(p,from);return ok;
 }
 enemyAct(e){
  if(e.chimeraTrenchExposed){e.vaultExposed=false;e.chimeraTrenchExposed=false;}   // 敵人的破綻到它下次行動為止
  const from={x:e.x,y:e.y},r=super.enemyAct(e);if(e.x!==from.x||e.y!==from.y)this.trenchStep(e,from);return r;
 }
 protectingCover(target,attacker){
  const base=super.protectingCover(target,attacker),lv=target&&this.trenchAt(target.x,target.y);
  if(!lv||!attacker||this.trenchAt(attacker.x,attacker.y))return base;
  const sx=Math.sign(attacker.x-target.x),sy=Math.sign(attacker.y-target.y);if(!sx&&!sy)return base;
  const ditch={type:lv===2?'wall':'cover',x:target.x+sx,y:target.y+sy,hp:Infinity,maxHp:Infinity,trench:true};
  return bestCover([base,ditch].filter(Boolean),target,attacker)||base;
 }
 // 戶外戰鬥的勝利：清光敵人（goal kill）；行軍遇襲是走到另一頭撤離（goal exit，descend）
 action(type,arg){
  const ok=super.action(type,arg);
  const o=this.chimeraOutdoor;
  if(o&&o.goal!=='exit'&&this.status==='playing'){
   if(!this.enemies.some(e=>e.hp>0&&!isNoncombatant(e))){this.status='won';this.log('敵人清光了。');}
   else if(o.goal==='hold'&&this.turn>=o.holdTurns){this.status='won';this.log(`撐過 ${o.holdTurns} 回合，陣地守住了。`);}
   else if(o.goal==='hold'&&ok&&this.turn%10===0)this.log(`守住陣地：還要撐 ${o.holdTurns-this.turn} 回合。`);
  }
  return ok;
 }
 // 撤離＝勝：走到電梯旁按撤離就結束，不下樓
 descend(){
  if(this.status!=='playing'||this.player.hp<=0)return false;
  if(this.chimeraOutdoor&&this.chimeraOutdoor.goal!=='exit')return this.fail('這一場要把敵人清掉，不能撤離');
  if(!this.canTouch(this.exitPoint))return this.fail(t('game.needElevator'));
  if(this.exitBlocked)return this.fail(this.exitBlocked);
  this.status='won';this.log('撤離完成。');return true;
 }
 serialize(){throw Error('奇美拉的任務戰鬥不存檔');}
}
// 奇美拉的數值：生命直接用；命中、閃避、近戰是總值，扣掉職業本身的部分當作個體修正
export function applyStats(unit,c,charDef){
 const st=c.st||{},base=charDef?.combat||{};
 if(st.hp){unit.maxHp=unit.hp=Math.round(st.hp);}
 unit.combatModifiers={rangedAccuracy:(st.acc||0)-(base.rangedAccuracy||0),rangedEvasion:(st.eva||0)-(base.rangedEvasion||0),meleeAccuracy:(st.mel||0)-(base.meleeAccuracy||0)};
}
