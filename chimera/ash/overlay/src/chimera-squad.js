// 奇美拉：隊友是完整的玩家角色（DESIGN.md「隊友＝另一個玩家角色」，可行性驗證）。
// 「輪值主角」：members 是四個完整的玩家物件，g.player 永遠指向現在輪到的那一位。
//   - 回合：被操作的隊員（controlled）照常 action()；輪到他那一格做完後（game-actions.js 補丁的 squadAfterPlayer），
//     其他活著的隊員依序把 g.player 換成自己，由大腦（brains）各做一個動作（soloTurn：只做自己的那一格，不推進世界）。
//   - 敵人：每個敵人行動前挑一位看得到的隊員當「玩家」（最近的），整個行動期間 g.player 指向他，傷害照玩家的規則算。
//   - 視野：每位隊員都揭露地圖、驚動敵人。
//   - 交棒：被操作的隊員倒下、還有人活著，就換下一位接手（不判敗）；全員倒下才結束。
// 跟著遊戲走、其實屬於個人的狀態（鎖定的目標、影步、追擊、待選升級……）換人時一起換（PERSONAL）。
import {Game} from './game.js';
import {MissionGame,applyStats,character} from './chimera-mission.js';
import {CHARACTERS} from './characters.js';
import {validPortrait,pickPortrait} from './portraits.js';
import {distance} from './world.js';
import {ENEMY_TYPES} from './data.js';
import {isNoncombatant} from './enemy-data.js';
import {presentStep} from './presentation.js';
import {checkMines} from './field-gear.js';
import {tickSkills} from './skills.js';
import {expireExposure} from './corner.js';
import {t} from './i18n.js';
import {addPoison,tickPoison} from './poison.js';
import {SWARM_TUNING} from './swarm.js';
import {toxicPlayerTurn} from './swarm-fields.js';
import {scalding} from './vents.js';
import {VENT_TUNING} from './vent-map.js';
import {FIRE_TUNING,burningAt} from './fire.js';

const PERSONAL=['target','shadowSteps','pursuit','pursuitPending','pursuitBlocked','pendingPerks','perkDraft','perkPicks','classPerkMisses','legacyPerkPicks','sensorContacts','refusal'];

export class SquadGame extends MissionGame{
 static fullSquad=true;
 constructor(ticket){
  super(ticket);
  const lead=this.player;lead.squadId=ticket.squad[0].id;lead.id=`squad-${lead.squadId}`;
  // brains（函式）與 stash 不可列舉：ASH 每一步動畫前用 structuredClone 複製遊戲（presentation.js snapshot）
  for(const [k,v]of [['stash',new Map([[lead,{}]])],['brains',new Map()]])Object.defineProperty(this,k,{configurable:true,writable:true,enumerable:false,value:v});
  this.members=[lead];this.controlled=lead;
  for(const c of ticket.squad.slice(1)){
   // 一位完整的玩家角色：借一個同種子的新遊戲建出來，只拿它的 player
   const cls=character(c.cls),spare=new Game(this.seed,[],0,cls,validPortrait(c.portrait)?c.portrait:pickPortrait(),'extraction',{facilityFaction:this.facilityFaction,simulation:{kind:'chimera'}});
   const m=spare.player;m.squadId=c.id;m.id=`squad-${c.id}`;applyStats(m,c,CHARACTERS[cls]);
   this.shareArmory(m,lead);
   const cell=this.freeCellNear(lead);if(!cell)continue;Object.assign(m,{x:cell.x,y:cell.y});
   this.members.push(m);this.stash.set(m,{target:null,shadowSteps:0,pursuit:0,pendingPerks:0,perkDraft:null,perkPicks:0,classPerkMisses:0,legacyPerkPicks:0,sensorContacts:[],refusal:null});
   this.chimera.units[c.id]=m;
  }
  this.chimera.units[ticket.squad[0].id]=lead;
  this.reveal();
 }
 // 武器登錄表（weaponBases／affixes／ammo／upgrades，地上的武器用它的編號）全隊共用同一份；
 // 隊員的初始武器各自登錄成新的一把，同職業才不會共用彈匣
 shareArmory(m,lead){
  const remap=new Map();
  for(const slot of m.owned){const n=lead.weaponBases.length;lead.weaponBases.push(m.weaponBases[slot]);lead.affixes.push(m.affixes[slot]);lead.ammo.push(m.ammo[slot]);lead.upgrades.push(m.upgrades[slot]||0);remap.set(slot,n);}
  m.owned=m.owned.map(s=>remap.get(s));m.weapon=remap.get(m.weapon)??m.owned[0];if(Number.isInteger(m.meleeSlot))m.meleeSlot=remap.get(m.meleeSlot)??null;
  for(const k of ['weaponBases','affixes','ammo','upgrades'])m[k]=lead[k];
 }
 get living(){return this.members.filter(m=>m.hp>0);}
 freeCellNear(p){
  for(let r=1;r<=3;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const q={x:p.x+dx,y:p.y+dy};
   if(Math.max(Math.abs(dx),Math.abs(dy))===r&&super.passable(q.x,q.y)&&!this.memberAt(q)&&!this.enemies.some(e=>e.hp>0&&e.x===q.x&&e.y===q.y))return q;}
  return null;
 }
 memberAt(q,except=null){return (this.members||[]).find(m=>m!==except&&m.hp>0&&m.x===q.x&&m.y===q.y)||null;}
 // 其他隊員站的格子：敵人和友軍走不過去；玩家角色（沒有帶 actor 的查詢）可以走，走進去就互換位置（executePlayer）
 passable(x,y,actor){if(!super.passable(x,y,actor))return false;if(!actor||!this.members)return true;const m=this.memberAt({x,y},this.player);return !m||m===actor;}
 executePlayer(type,arg){
  const p=this.player,from={x:p.x,y:p.y},other=type==='move'&&Array.isArray(arg)&&this.members?this.memberAt({x:p.x+arg[0],y:p.y+arg[1]},p):null;
  // 自己行動時隊員不算友軍（ASH 的友軍換位要查兵種卡）；換位用下面這行
  this.membersHidden=true;let ok;try{ok=super.executePlayer(type,arg);}finally{this.membersHidden=false;}
  if(ok&&other&&p.x===other.x&&p.y===other.y)Object.assign(other,from);
  return ok;
 }
 // 換人：個人狀態跟著換
 swap(m){
  if(!this.members||m===this.player)return;
  const out={};for(const k of PERSONAL)out[k]=this[k];this.stash.set(this.player,out);
  this.player=m;const inn=this.stash.get(m)||{};for(const k of PERSONAL)this[k]=inn[k]??(k==='sensorContacts'?[]:k==='target'||k==='perkDraft'||k==='refusal'?null:0);
 }
 // 被操作的隊員那一格做完：其他活著的隊員各做一個動作
 squadAfterPlayer(){
  if(this.soloTurn)return;
  const keep=this.player;
  for(const m of this.members){
   if(m===keep||m.hp<=0||this.status!=='playing')continue;
   const brain=this.brains.get(m);if(!brain)continue;
   // action() 一開頭會清掉 effects（這一步的動畫）；隊員的動作接在後面，不能把前面的清掉
   const fx=this.effects;
   this.swap(m);this.soloTurn=true;this.soloDone=false;
   try{for(let i=0;i<6&&!this.soloDone&&this.status==='playing'&&m.hp>0;i++)brain(this,m);}
   finally{this.effects=[...fx,...this.effects.filter(e=>!fx.includes(e))];this.soloTurn=false;tickSkills(m);expireExposure([m],this.turn);m.lightLingers=false;this.swap(keep);}
  }
 }
 // soloTurn 裡的付費動作：只做這位隊員自己那一格（照 action() 裡 actor===p 的處理）
 soloPaid(type,arg){
  const p=this.player,target=type==='fire'?this.targeted:null,intent=type==='fire'?{id:this.target,x:target?.x,y:target?.y}:arg;
  const success=type==='move'?presentStep(this,()=>this.executePlayer(type,arg)):this.executePlayer(type,intent);
  p.guard=success&&type==='wait';p.moved=success&&(type==='move'||['grapple','hookBlade','fire'].includes(type)&&p.moved);p.focus=success&&type==='wait';p.evasive=success&&type==='wait';
  this.settleAttackNotes();this.reveal();checkMines(this);this.settleAttackNotes();
  if(success)this.soloDone=true;return success;
 }
 // 敵人：挑一位看得到的隊員（最近的）當這次行動的「玩家」
 enemyAct(e){
  if(!this.members||this.soloTurn)return super.enemyAct(e);
  const reach=Math.max(10,ENEMY_TYPES[e.type]?.range||0),seen=this.living.filter(m=>distance(e,m)<=reach&&this.sight(e,m)).sort((a,b)=>distance(e,a)-distance(e,b));
  const m=seen[0];if(!m||m===this.player)return super.enemyAct(e);
  const keep=this.player;this.swap(m);try{return super.enemyAct(e);}finally{this.swap(keep);}
 }
 // 視野：每位隊員都揭露、都會被看到
 reveal(opts){
  const r=super.reveal(opts);
  if(!this.members||this.revealing)return r;
  this.revealing=true;const keep=this.player;
  try{for(const m of this.living)if(m!==keep){this.swap(m);super.reveal({warnings:false});}}finally{this.swap(keep);this.revealing=false;}
  return r;
 }
 // 交棒：被操作的隊員倒下，換下一位活著的接手
 action(type,arg){
  const r=super.action(type,arg);
  if(!this.soloTurn&&this.members)this.handOver();
  return r;
 }
 // 其他活著的隊員也算在友軍名單裡（ASH 的直線攻擊、爆炸、敵人選目標、團隊視野都看這份名單）；
 // 他們受到的友軍傷害改用玩家的規則算（damageAlly → damagePlayer）。地面傷害另外算，所以那時先拿掉（membersHidden）。
 get activeAllies(){const a=super.activeAllies;if(!this.members||this.membersHidden)return a;return [...a,...this.living.filter(m=>m!==this.player)];}
 damageAlly(u,damage,attacker=null,blast=false,...rest){
  if(!this.members?.includes(u))return super.damageAlly(u,damage,attacker,blast,...rest);
  let r;this.forMembers([u],()=>{r=this.damagePlayer(damage,attacker?t('enemy-behavior.attackSource',{enemy:attacker.name||attacker.type||''}):t('game.blastSource'),attacker,blast);});if(u.hp<0)u.hp=0;return r;
 }
 // ASH 在「玩家」倒下時判死；其他人還活著就繼續（被操作的隊員倒下時，action() 結束後交棒）
 damagePlayer(...args){const r=super.damagePlayer(...args);if(this.members&&this.status==='dead'&&this.living.length)this.status='playing';return r;}
 // 地面（酸液、高熱、蒸汽、火、毒霧、中毒）：environmentTurn 只算 g.player，其他隊員照同一段規則各算一次
 environmentTurn(){
  this.membersHidden=true;let r;try{r=super.environmentTurn();}finally{this.membersHidden=false;}
  this.forMembers(this.living.filter(m=>m!==this.player),p=>{
   const hazard=this.hazards.find(h=>h.x===p.x&&h.y===p.y);
   if(hazard){this.floorDamage(Math.max(0,(hazard.type==='acid'?8:12)-p.hazmat));if(hazard.type==='acid'&&p.hazmat<8)addPoison(p,SWARM_TUNING.acidStacks);}
   toxicPlayerTurn(this,addPoison);
   if(p.hp>0&&scalding(this,p))this.floorDamage(Math.max(0,VENT_TUNING.damage-p.hazmat));
   if(p.hp>0&&burningAt(this,p))this.floorDamage(Math.max(0,FIRE_TUNING.damage-p.hazmat));
   tickPoison(this);
  });
  return r;
 }
 forMembers(list,fn){if(!list.length)return;const keep=this.player;try{for(const m of list){this.swap(m);fn(m);}}finally{this.swap(keep);}}
 // 交棒：還有人活著就不算結束（ASH 在「玩家」倒下時會判死，這位玩家可能是被敵人借去的其他隊員）
 handOver(){
  const next=this.living[0];if(!next)return false;
  if(this.status==='dead')this.status='playing';
  if(this.player.hp>0)return false;
  this.player.hp=0;this.swap(next);this.controlled=next;this.log(`${next.squadId} 接手指揮。`,true);return true;
 }
 // 動畫快照（presentation.js 補丁）：隊員行動那幾步的快照裡，「玩家」換回操作中的隊員，鏡頭和狀態列才不會跳
 presentView(v){const c=v.members?.find(m=>m.id===this.controlled?.id);if(c&&v.player!==c)v.player=c;return v;}
 setControlled(m){if(!this.members.includes(m)||m.hp<=0||this.soloTurn)return false;this.swap(m);this.controlled=m;return true;}
 cycleControlled(){const L=this.living;if(L.length<2)return false;return this.setControlled(L[(L.indexOf(this.player)+1)%L.length]);}
 descend(){if(this.status!=='playing'||this.player.hp<=0)return false;if(!this.canTouch(this.exitPoint))return this.fail(t('game.needElevator'));if(this.exitBlocked)return this.fail(this.exitBlocked);this.status='won';this.log('撤離完成。');return true;}
 get missionResult(){
  const dead=Object.entries(this.chimera.units).filter(([,m])=>m.hp<=0).map(([id])=>id);
  const foes=this.enemies.filter(e=>!isNoncombatant(e)),kills=foes.filter(e=>e.hp<=0).length,total=foes.length;
  return {win:this.status==='won',dead,kills,total,turns:this.turn};
 }
}
