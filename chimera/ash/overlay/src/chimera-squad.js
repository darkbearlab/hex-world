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
import {AFFIXES,weaponStats} from './weapons.js';
import {WEAPONS,PERKS} from './data.js';
import {perkDef} from './perks.js';
import {initialSkillState,SKILLS} from './skills.js';
import {initializeAllies} from './allies.js';

// 土製（DESIGN.md「本輪規劃」B）：ASH 的詞條都是一好一壞，土製只取壞的那一面。出生配發的槍都帶著；到終端改裝換掉詞條，
// 就是把土製槍升級成正規槍。職業天生的近戰武器（動力拳、斧頭）不套。dropOnly:[] 讓它不會隨機出現在掉落與商店裡。
AFFIXES.homemade??={name:'土製',text:'土法拼裝：傷害 −10%、彈匣 −25%、命中 −8。到終端改裝可以換掉。',damage:.9,mag:.75,accuracy:-8,dropOnly:[]};
// 技能跟著人走（C）：出生沒有技能；職業技能在 SKILL_LEVEL 級學會（跨戰役的等級）。技能可插拔：學會的放在 skills，預備欄放一個。
export const CLASS_SKILL={soldier:'early_warning',recon:'signal_break',bulwark:'anchor',berserker:'grapple',engineer:'workshop'};
export const SKILL_LEVEL=3;
// 升級三選一跨戰役保留（Alan 2026-10-08：暫時保留，待檢討）：進戰鬥時重新套用永久的效果，一次性的（補給、醫療包、廢料、護甲板）不重複給
const PERMANENT={weapon:(p,o)=>{p.perkWeaponBonus+=o.amount;},health:(p,o)=>{p.maxHp+=o.amount;p.hp+=o.amount;},stat:(p,o)=>{p[o.stat]+=o.amount;},
 scavenger:(p,o)=>{p.scavenger+=o.amount;},medic:(p,o)=>{p.healBonus+=o.amount;},hazmat:(p,o)=>{p.hazmat+=o.amount;},
 combat:(p,o)=>{p.combatModifiers={...p.combatModifiers};for(const k of o.stats)p.combatModifiers[k]=Math.min(100,(p.combatModifiers[k]||0)+o.amount);}};
const COUNTERS=['perkPicks','classPerkMisses','legacyPerkPicks'];

const PERSONAL=['target','shadowSteps','pursuit','pursuitPending','pursuitBlocked','pendingPerks','perkDraft','perkPicks','classPerkMisses','legacyPerkPicks','sensorContacts','refusal'];

export class SquadGame extends MissionGame{
 static fullSquad=true;
 constructor(ticket){
  super(ticket);
  const lead=this.player;lead.squadId=ticket.squad[0].id;lead.id=`squad-${lead.squadId}`;
  this.equip(lead,ticket.squad[0]);for(const k of COUNTERS)this[k]=ticket.squad[0][k]||0;
  // brains（函式）與 stash 不可列舉：ASH 每一步動畫前用 structuredClone 複製遊戲（presentation.js snapshot）
  for(const [k,v]of [['stash',new Map([[lead,{}]])],['brains',new Map()]])Object.defineProperty(this,k,{configurable:true,writable:true,enumerable:false,value:v});
  this.members=[lead];this.controlled=lead;
  for(const c of ticket.squad.slice(1)){
   // 一位完整的玩家角色：借一個同種子的新遊戲建出來，只拿它的 player
   const cls=character(c.cls),spare=new Game(this.seed,[],0,cls,validPortrait(c.portrait)?c.portrait:pickPortrait(),'extraction',{facilityFaction:this.facilityFaction,simulation:{kind:'chimera'}});
   const m=spare.player;m.squadId=c.id;m.id=`squad-${c.id}`;applyStats(m,c,CHARACTERS[cls]);
   this.shareArmory(m,lead);this.equip(m,c);
   const cell=this.freeCellNear(lead);if(!cell)continue;Object.assign(m,{x:cell.x,y:cell.y});
   this.members.push(m);this.stash.set(m,{target:null,shadowSteps:0,pursuit:0,pendingPerks:0,perkDraft:null,perkPicks:c.perkPicks||0,classPerkMisses:c.classPerkMisses||0,legacyPerkPicks:c.legacyPerkPicks||0,sensorContacts:[],refusal:null});
   this.chimera.units[c.id]=m;
  }
  this.chimera.units[ticket.squad[0].id]=lead;
  this.reveal();
 }
 // 複製人的成長帶進戰鬥（ticket 的 c：lv、xp、picks、skills、prep）；槍套上土製
 equip(m,c){
  if(!this.applyGear(m,c))for(const slot of m.owned)if(!WEAPONS[m.weaponBases[slot]]?.melee){m.affixes[slot]='homemade';m.ammo[slot]=Math.min(m.ammo[slot],weaponStats(m.weaponBases[slot],'homemade',m).mag);}
  m.level=Math.max(1,c.lv||1);m.xp=Math.max(0,c.xp||0);m.chimeraPicks=[...(c.picks||[])];
  for(const id of m.chimeraPicks){const o=perkDef(this,PERKS.find(x=>x.id===id));if(!o)continue;PERMANENT[o.effect]?.(m,o);m.perks[o.id]=(m.perks[o.id]||0)+1;}
  m.skills=(c.skills||[]).filter(id=>SKILLS[id]);m.skillState=initialSkillState(m.skills);
  m.prepared={...m.prepared,skill:m.skills.includes(c.prep)?c.prep:m.skills[0]||null};
  if(!m.skills.includes('workshop'))m.productionLines=[];
  this.learnClassSkill(m);
 }
 // 奇美拉的裝備（c.gear，chimera/company.js）帶進戰鬥：槍照身上的三格（種類＋詞條，彈匣裝滿）、隨身近戰、護甲（裝甲板）、預備品（醫療包、破片彈⋯）。
 // 天生的近戰（狂戰斧、忍刀、動力拳套）留著。沒有 c.gear（舊的任務資料）回傳 false，照舊配土製
 applyGear(m,c){
  const g=c.gear;if(!g)return false;
  const at=id=>WEAPONS.findIndex(w=>w.id===id),add=(b,affix)=>{const s=m.weaponBases.length;m.weaponBases.push(b);m.affixes.push(affix);m.ammo.push(WEAPONS[b].melee?0:weaponStats(b,affix,m).mag);m.upgrades.push(0);return s;};
  const innate=m.owned.filter(s=>{const w=WEAPONS[m.weaponBases[s]];return w?.melee&&(w.locked||w.integrated);});
  const guns=[];for(const it of g.guns||[]){if(!it)continue;const b=at(it.base);if(b<0||WEAPONS[b].melee)continue;guns.push(add(b,it.affix||null));}
  m.owned=[...guns,...innate];
  if(g.melee){const b=at(g.melee.base);if(b>=0&&WEAPONS[b].melee){const s=add(b,null);m.owned.push(s);m.meleeSlot=s;}}
  m.weapon=m.owned[0]??m.weapon;
  const kits={meds:0,grenades:0,smoke:0,stun:0,emp:0};for(const it of g.kits||[])if(it&&it.base in kits)kits[it.base]+=it.n||0;Object.assign(m,kits);
  const P={light:10,medium:20,heavy:30}[g.armor?.base]||0;if(P)m.plates=Math.max(m.plates||0,P);
  return true;
 }
 // 戰後身上剩下的（撿到的槍也算）：寫回奇美拉的裝備（company.js gearAfterBattle）
 gearOf(m){
  const w=s=>WEAPONS[m.weaponBases[s]],innate=s=>w(s)?.melee&&(w(s).locked||w(s).integrated);
  return {guns:m.owned.filter(s=>w(s)&&!w(s).melee).slice(0,3).map(s=>({base:w(s).id,affix:m.affixes[s]||null})),
   melee:(m.owned.find(s=>w(s)?.melee&&!innate(s))!=null?w(m.owned.find(s=>w(s)?.melee&&!innate(s))).id:null),
   kits:{meds:m.meds||0,grenades:m.grenades||0,smoke:m.smoke||0,stun:m.stun||0,emp:m.emp||0}};
 }
 // 到了 SKILL_LEVEL 級學會職業技能（升級當下也會檢查，見 settleLevels）
 learnClassSkill(m){
  const id=CLASS_SKILL[m.character];if(!id||m.level<SKILL_LEVEL||m.skills.includes(id))return false;
  m.skills=[...m.skills,id];m.skillState={...m.skillState,[id]:{remaining:0,cooldown:0}};if(!m.prepared.skill)m.prepared={...m.prepared,skill:id};
  if(this.members&&id==='workshop'){const keep=this.player;this.swap(m);try{initializeAllies(this);}finally{this.swap(keep);}}
  return true;
 }
 settleLevels(){
  const p=this.player,before=p.level;super.settleLevels();
  if(p.level>before&&this.learnClassSkill(p))this.log(`${p.squadId||''} 升到 ${p.level} 級，學會了「${SKILLS[CLASS_SKILL[p.character]]?.name||CLASS_SKILL[p.character]}」。`,true);
 }
 choosePerk(id){const ok=super.choosePerk(id);if(ok)(this.player.chimeraPicks||=[]).push(id);return ok;}
 // 戰後寫回名冊的成長
 progressOf(m){const own=m===this.player,st=this.stash?.get(m)||{};return {gear:this.gearOf(m),lv:m.level,xp:m.xp,picks:[...(m.chimeraPicks||[])],skills:[...m.skills],prep:m.prepared?.skill||null,...Object.fromEntries(COUNTERS.map(k=>[k,own?this[k]:st[k]||0]))};}
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
 // 只有操作中的隊員能和隊友換位；機器人隊員互相換位會在走廊裡來回換、誰都走不動（2026-10-08 Alan 回報），所以當牆
 passable(x,y,actor){if(!super.passable(x,y,actor))return false;if(!this.members||!actor&&!this.soloTurn)return true;const m=this.memberAt({x,y},this.player);return !m||m===actor;}
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
 // 視野：每位隊員都揭露、都會被看到。reveal 會記下「玩家看得到的格子」（visibleTiles，畫面的視野與光線用它），
 // 所以其他隊員先揭露，操作中的那位最後揭露
 reveal(opts){
  if(!this.members||this.revealing)return super.reveal(opts);
  this.revealing=true;const keep=this.player;
  try{for(const m of this.living)if(m!==keep){this.swap(m);super.reveal({warnings:false});}}finally{this.swap(keep);this.revealing=false;}
  return super.reveal(opts);
 }
 // 交棒：還有人活著就不算結束（ASH 在「玩家」倒下時會判死，這位玩家可能是被敵人借去的其他隊員）
 // 每個行動之後檢查交棒（隊員在 soloTurn 裡的行動不算，那時「玩家」是他自己）
 action(type,arg){
  const r=super.action(type,arg);
  if(!this.soloTurn&&this.members)this.handOver();
  return r;
 }
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
  const progress=Object.fromEntries(Object.entries(this.chimera.units).map(([id,m])=>[id,this.progressOf(m)]));
  return {win:this.status==='won',dead,kills,total,turns:this.turn,progress};
 }
}
