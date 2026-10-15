// 奇美拉的任務戰鬥（hex-world chimera/ash/overlay；不屬於 ASH 本體）。照 KillhouseGame 的做法：一場戰鬥＝第一層，
// 敵人照任務票擺（simulation.kind='chimera' 讓 ASH 不另外加徵召兵、巡邏小隊、詭雷箱），撤離＝勝。不存檔。
// 小隊（四位完整的玩家角色）在子類別 SquadGame（chimera-squad.js）。
import {Game} from './game.js';
import {generate,makeEnemy,distance} from './world.js';
import {isNoncombatant} from './enemy-data.js';
import {CHARACTERS} from './characters.js';
import {pickPortrait,validPortrait} from './portraits.js';
import {t} from './i18n.js';
import {outdoorMap,LAYOUT} from './chimera-outdoor.js';
import {planConvoy,vehicleStep,convoyDone} from './chimera-highway.js';
import {skillActive} from './skills.js';
import {applySuppression} from './suppression.js';
import {bestCover} from './cover.js';
import {ENEMY_TYPES,SIZE,setSize} from './data.js';
import {rollEnemyAffixes} from './enemy-affixes.js';
import {rollEnemyElite} from './elite-enemies.js';

// 奇美拉的敵人 → ASH 的兵種卡（暫定，見 warband/DESIGN.md「接上 ASH 的做法定案」）
// 服務單上的敵人 → ASH 的兵種（Alan 2026-10-09，warband/DESIGN.md「敵人單位重新配置」）。
// 新的服務單帶著 enemy.roster（chimera/cases.js enemyRoster：每一個敵人的 ASH 兵種、服務單上的名字、頭目資料）；
// 舊的服務單（只有 units／veh／boss）照下面的舊對照表。
export const ENEMY_MAP={raider:'raider',raider_heavy:'gunner',native:'raider_infected',native_hunter:'sniper',
 trooper:'rifleman',trooper_heavy:'rifleman_armored',clone_trooper:'chimera_clone'};
export const VEHICLE_MAP={rush:'chimera_rush',armor:'chimera_armor'};
export const BOSS_TYPE='squad_leader';
export const UNIT_NAME={raider:'掠奪者',raider_heavy:'重武裝掠奪者',native:'原住民戰士',native_hunter:'原住民獵手',trooper:'士兵',trooper_heavy:'重裝士兵',clone_trooper:'複製兵'};
export const VEHICLE_NAME={rush:'衝鋒車',armor:'武裝車'};
// 車輛（ASH 沒有的兵種，照 ASH 自己加砲塔的做法在這裡加進兵種表；圖先借 ASH 的）：
// - 衝鋒車：自爆機器人的邏輯（衝過來撞上引爆），耐打得多，爆炸範圍兩格（MissionGame.explode）
// - 武裝車：加裝甲的房車，車頂機槍連發；兩回合才走一格（MissionGame.enemyAct）；車身先畫一塊裝甲板底（chimera-outdoor-render.js）
ENEMY_TYPES.chimera_rush={...ENEMY_TYPES.bomber_bot,sprite:{key:'bomber_bot',corpse:'bomber_bot',size:1.7},name:'衝鋒車',hp:120,armor:4,damage:45,xp:3,color:'#b0793f'};
ENEMY_TYPES.chimera_armor={...ENEMY_TYPES.turret,fixed:false,behavior:undefined,sprite:{key:'turret',corpse:'turret',scale:1.3},tags:['breaker'],name:'武裝車',hp:220,armor:6,damage:20,rounds:4,range:7,xp:6,color:'#6f7a64',chimeraVehicle:true};
// 複製兵：比士兵耐打的步槍兵（照重裝士兵的規則）。原本借 ASH 的執法者，但執法者是叛軍處決逃兵的軍官，會一直躲在掩體後面拖戰局（2026-10-09 NPC 實測發現）
ENEMY_TYPES.chimera_clone={...ENEMY_TYPES.rifleman_armored,name:'複製兵',hp:34,xp:2,color:'#8a9a8a'};
export const RUSH_BLAST={radius:2,damage:50};
export const HIGHWAY_SHAKE=30;
export const ON_MAP=18,WAVE_MAX=4,WAVE_BELOW=12;
// 戰場比 27 大時，場上人數上限、補增援的門檻照面積加（最多 60）
const area=()=>(SIZE/27)**2,onMap=()=>Math.min(60,Math.round(ON_MAP*area())),waveBelow=()=>Math.min(45,Math.round(WAVE_BELOW*area()));   // 增援：場上活著的少於 WAVE_BELOW 就補，每回合最多 WAVE_MAX 個   // 公路戰的命中懲罰
// 奇美拉的職業 → ASH 的職業（同名）；沒有的退回士兵
export const character=cls=>CHARACTERS[cls]?cls:'soldier';

// 任務票展開成敵人清單（固定順序，同一張票每次一樣）：{type：ASH 兵種, name：服務單上的名字, boss?}
export function ticketRoster(ticket){
 const e=ticket.enemy||{};
 if(Array.isArray(e.roster))return e.roster.filter(u=>ENEMY_TYPES[u.type]).map(u=>({...u}));
 const out=[];
 for(const [k,n]of Object.entries(e.units||{}).sort())for(let i=0;i<n;i++)out.push({type:ENEMY_MAP[k]||'raider',name:UNIT_NAME[k]||null});
 for(const [k,n]of Object.entries(e.veh||{}).sort())for(let i=0;i<n;i++)if(VEHICLE_MAP[k])out.push({type:VEHICLE_MAP[k],name:VEHICLE_NAME[k]||null});
 if(e.boss)out.unshift({type:BOSS_TYPE,name:e.boss.weapon?`頭目（${e.boss.weapon}）`:'頭目',boss:{...e.boss,hp:e.boss.hp||3}});
 return out;
}
export const ticketUnits=ticket=>ticketRoster(ticket).map(u=>u.type);
// 照服務單放一個敵人：名字（ASH 的 courseName 直接顯示在目標卡與紀錄上）、頭目
// 頭目：拿遺產級的血量多 (1+bonus) 倍、傷害 1.4＋2×bonus 倍（明顯較強的武器），記下會不會戰死（服務單開出來時沙盒骰好）；
// 沒有遺產級的幫派頭目是小隊長乘上 boss.hp 倍血量；勢力軍官、巢母照 ASH 原本的
function rosterEnemy(u,x,y,id,spec,faction,depth=1,seed=1){
 let e=makeEnemy(u.type,x,y,id,depth,spec,faction);
 if(!u.boss)e=rollEnemyElite(rollEnemyAffixes(e,seed,depth,spec),seed,depth,spec);   // Alan 2026-10-11：越強的服務單，菁英與詞條越多（照 ASH 樓層的機率）
 if(u.name)e.courseName=u.name;
 const b=u.boss;
 if(b){
  const k=b.legacy?1+(b.bonus||.1):b.hp||1;e.maxHp=Math.round((e.maxHp||e.hp)*k);e.hp=e.maxHp;
  if(b.legacy){e.damageScale=+(1.4+2*(b.bonus||.1)).toFixed(2);e.chimeraBoss={legacy:b.legacy,weapon:b.weapon,kind:b.kind,bonus:b.bonus,dies:!!b.dies,chief:b.chief};}
 }
 return e;
}
// 公路戰的亂數：狀態存在 chimeraOutdoor.rs，車輛移動、乘員上車照它走（重播一樣）
const convoyRng=o=>()=>((o.rs=Math.imul(o.rs,1664525)+1013904223>>>0)/4294967296);
// 據點（Alan 2026-10-09：參考 ASH 生存模式的佔點）：突擊陣地、夜襲戰壕是「奪點」——敵人守著據點（一人站在點上、其餘在旁邊護著），
// 我方的人站上去、旁邊沒有敵人站在點上，每回合推進一格，推完就拿下；全部拿下就贏。守點是「守點」——敵人分兩種，
// 一種衝著據點來（站上去每回合扣一格，扣完就失守），一種來找你；全部失守就輸。借 ASH 的 game.survival（敵人的佔點行為、繞過別的點、
// 畫面上的點），但不是生存任務：不排波次、不鎖撤離，回合結束的計分在 MissionGame.chimeraPoints。
export const POINT_TAKE=3,POINT_KEEP=10,POINT_PLANT=2;
function objectivePoints(o,map,enemies){
 const mode=o.goal==='plant'?'plant':o.layout==='fort'||o.layout==='trench'?'take':o.layout==='ring'?'keep':null;if(!mode)return;
 const N=map.grid.length,mid=Math.floor(N/2),k=N/27,Y=v=>Math.round(v*k),busy=new Set([...map.props,...map.items,map.start].map(q=>`${q.x},${q.y}`));
 const want=mode==='plant'?(o.plantAt||[[mid,Y(4)],[mid-Y(7),Y(9)],[mid+Y(7),Y(9)]]).slice(0,o.plantN||1):o.layout==='fort'?[[mid,Y(7)],[mid-2,Y(7)],[mid+2,Y(7)]]:o.layout==='trench'?[[mid-Y(6),Y(5)],[mid,Y(5)],[mid+Y(6),Y(5)]]:[[mid,mid-1],[mid-2,mid],[mid+2,mid]];
 const pts=[];
 for(const [x0,y0] of want){let best=null,bd=99;for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){const d=Math.abs(x-x0)+Math.abs(y-y0);if(d<bd&&map.grid[y][x]===1&&!busy.has(`${x},${y}`)&&!pts.some(q=>q.x===x&&q.y===y)){bd=d;best={x,y}}}if(best)pts.push(best);}
 if(!pts.length)return;
 o.points=pts;o.mode=mode;if(mode==='plant')return;   // 目標點＋撤離：敵人照平常巡邏、警戒，不去搶點
 // 敵人的角色：奪點時全部守點（照順序分到三個點）；守點時三分之二衝據點、三分之一來找你
 enemies.forEach((e,i)=>{if(isNoncombatant(e))return;e.survival=mode==='take'||i%3!==2?{role:'point',target:`point-${i%pts.length}`}:{role:'hunter'};});
}
const lcg=seed=>{let s=(Number(seed)>>>0)||1;return ()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296);};
const near=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));

let building=null,outdoorBuilt=null;   // generateFloor 在 Game 的建構子裡就被叫到，這時 this.ticket 還沒設
export class MissionGame extends Game{
 // ticket：{seed, faction:'loyalist'|'rebel', enemy:{units,veh,boss}, squad:[{id,cls,portrait?,st:{hp,acc,eva,mel}}]}
 constructor(ticket){
  const lead=ticket.squad[0],portrait=validPortrait(lead.portrait)?lead.portrait:pickPortrait();
  building=ticket;setSize(ticket.facility||(ticket.layout||LAYOUT[ticket.type])==='highway'?27:Math.max(27,Math.min(100,ticket.size|0||27)));   // 戰場大小：每場開打前設定（室內設施、公路戰維持 27）
  try{super(ticket.seed,[],0,character(lead.cls),portrait,'extraction',{facilityFaction:ticket.faction||'rebel',simulation:{kind:'chimera'}});}finally{building=null;}
  this.ticket=ticket;this.chimera={members:ticket.squad.map(c=>c.id),units:{}};
  if(outdoorBuilt){this.chimeraOutdoor=outdoorBuilt;this.mapStyle=outdoorBuilt.style;outdoorBuilt=null;const o=this.chimeraOutdoor;if(o.points){if(o.mode==='take')o.goal='take';const P0=o.mode==='take'?POINT_TAKE:o.mode==='plant'?POINT_PLANT:POINT_KEEP;this.survival={integrity:o.points.length*P0,points:o.points.map((q,i)=>({id:`point-${i}`,x:q.x,y:q.y,hp:P0,pressed:false})),wave:0,nextWave:1e9,open:false,turns:o.mode==='keep'?o.holdTurns:999,incoming:[]};}
  const g=this.chimeraOutdoor.goal;this.log(g==='plant'&&o.clear?`${o.clear.verb}${o.clear.what}：站上 ${o.points.length} 個點（點上沒有敵人，每回合推進一格，${POINT_PLANT} 格完成），全部${o.clear.verb}就贏，不用撤離。`:g==='plant'?`破壞：摸到 ${o.points.length} 個目標點裝好炸藥（站上去、點上沒有敵人，每回合推進一格，${POINT_PLANT} 格裝好），全部裝好之後回到出發的地方撤離。清光敵人不算完成。`:g==='take'?`奪點：拿下敵人守著的 ${o.points.length} 個據點（站上去、點上沒有敵人，每回合推進一格，${POINT_TAKE} 格拿下），或把敵人清光。`:o.mode==='keep'?`守點：守住 ${o.points.length} 個據點撐過 ${o.holdTurns} 回合，或把敵人清光。敵人站上據點每回合扣一格，${POINT_KEEP} 格扣完就失守，全部失守就輸。`:g==='exit'?'突圍：走到地圖另一頭的撤離點。':g==='drive'?`公路戰：敵人的車靠上來了。撐過 ${this.chimeraOutdoor.holdTurns} 回合開到目的地，或把敵人清光。掉下車就沒命。`:g==='hold'?`守住陣地：撐過 ${this.chimeraOutdoor.holdTurns} 回合，或把敵人清光。`:'把敵人清光。');}
  this.chimera.units[lead.id]='player';applyStats(this.player,lead,CHARACTERS[this.player.character]);
  this.logs=[];this.log(t('game.arrived'));if(ticket.intro)this.log(ticket.intro,true);   // 開場的情境（Alan 2026-10-11）
 }
 generateFloor(){
  const tk=building||this.ticket;
  // 戶外戰鬥（Alan 2026-10-09）：照服務單的類型與那一格的生態產生開闊地；ticket.facility 為真才用 ASH 的設施地圖
  if(!tk.facility){
   const {map,spots,outdoor,style}=outdoorMap({...tk,seed:this.seed},1),rnd=lcg(tk.seed^0xe1e);
   // 公路戰（接舷）：衝鋒車還沒有地方開（之後做四面八方湧上來的那種），先換成跳上車的乘員；武裝車換成敵方車上的車載機槍
   const want=ticketRoster(tk).map(u=>outdoor.layout!=='highway'?u:u.type==='chimera_rush'?{type:'raider',name:'衝鋒車乘員'}:u.type==='chimera_armor'?{type:'turret',name:'車載機槍'}:u);
   // 公路戰：敵人全部先做好，照時刻表分給一台台車（chimera-highway.js）；開場只有第一台卡車上的人在場上
   if(outdoor.layout==='highway'){
    outdoor.rs=(tk.seed^0x4a11)>>>0||1;const R=convoyRng(outdoor);
    planConvoy(outdoor,want.map((u,i)=>rosterEnemy(u,0,0,`c${i+1}`,this.difficultySpec,this.facilityFaction,tk.depth||1,this.seed)),R);
    const pre={chimeraOutdoor:outdoor,floor:1,turn:0,player:{x:map.start.x,y:map.start.y},members:[],enemies:[],props:map.props,items:map.items,grid:map.grid};
    vehicleStep(pre,R);map.enemies=pre.enemies;map.props=pre.props;map.barriers=pre.barriers;outdoor.stepTurn=0;
    outdoorBuilt={...outdoor,style};return map;
   }
   // 據點群（Alan 2026-10-11）：一隊 4～6 人照區塊放；有隊長（標定官、小隊長這類）的先一隊分一個；放不下的變成增援，整隊從集結點進來
   if(outdoor.groups){
    const G=outdoor.groups.filter(gr=>gr.cells.length),per=Math.max(4,Math.min(6,Math.floor(Math.min(want.length,onMap())/Math.max(1,G.length))));
    const pool=want.map((u,i)=>({u,i}));for(let i=pool.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    const lead=u=>u.type==='squad_leader'||u.boss,take=()=>pool.shift(),placed=[];let n=0;
    G.forEach((gr,gi)=>{const cells=gr.cells.slice();for(let i=cells.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
     const li=pool.findIndex(x=>lead(x.u)),mine=[];if(li>=0)mine.push(...pool.splice(li,1));while(mine.length<per&&pool.length)mine.push(take());
     mine.forEach((x,k)=>{const c=cells[k%cells.length];if(k>=cells.length)return;const e=rosterEnemy(x.u,c.x,c.y,`c${++n}`,this.difficultySpec,this.facilityFaction,tk.depth||1,this.seed);e.chimeraG=gi;placed.push(e);});
     gr.id=gi;});
    outdoor.groups=G;map.enemies=placed;outdoor.waves=pool.map(x=>rosterEnemy(x.u,0,0,`c${++n}`,this.difficultySpec,this.facilityFaction,tk.depth||1,this.seed));outdoor.wavePer=per;
    if(outdoor.waves.length){outdoor.rs=(tk.seed^0x7a11)>>>0||1;outdoor.waveTurn=0;}
    objectivePoints(outdoor,map,[...map.enemies,...outdoor.waves]);
    outdoorBuilt={...outdoor,style};return map;
   }
   for(let i=spots.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[spots[i],spots[j]]=[spots[j],spots[i]];}
   const used=new Set(),cells=[];for(const p of spots){const k=`${p.x},${p.y}`;if(used.has(k))continue;used.add(k);cells.push(p);if(cells.length>=want.length)break;}
   // 增援波次（Alan 2026-10-09，大戰役：服務單規模沒有上限）：場上最多 ON_MAP 個，其餘排隊，從敵方那一側的地圖邊緣一波波湧進來（chimeraWaves）
   const first=Math.min(cells.length,onMap());
   map.enemies=want.slice(0,first).map((u,i)=>rosterEnemy(u,cells[i].x,cells[i].y,`c${i+1}`,this.difficultySpec,this.facilityFaction,tk.depth||1,this.seed));
   outdoor.waves=want.slice(first).map((u,i)=>rosterEnemy(u,0,0,`c${first+i+1}`,this.difficultySpec,this.facilityFaction,tk.depth||1,this.seed));
   if(outdoor.waves.length){outdoor.rs=(tk.seed^0x7a11)>>>0||1;outdoor.waveTurn=0;}
   objectivePoints(outdoor,map,[...map.enemies,...outdoor.waves]);
   // 守點：敵人越多撐越久（30 回合，超過 12 人的部分每人多 1 回合；NPC 實測：大單的守點撐 30 回合太輕鬆）
   if(outdoor.layout==='ring')outdoor.holdTurns=30+Math.max(0,want.length-12);
   // 對方來打的（守點、車隊遇襲、原住民、行軍遇襲）：開場就警戒，朝我方的位置摸過來；攻陣地、戰壕、據點的敵人守著自己的位置
   if(outdoor.layout==='ring'||outdoor.layout==='road'||outdoor.layout==='highway')for(const e of map.enemies){e.alert=true;e.lastKnown={x:map.start.x,y:map.start.y};}
   outdoorBuilt={...outdoor,style};return map;
  }
  const fl=this.floor||1,map=generate(this.seed,fl,[],this.difficultySpec,this.facilityFaction),base=ticketRoster(tk);if(!base.length)return map;
  const want=fl>1?Array.from({length:Math.round(base.length*(1+.35*(fl-1)))},(_,i)=>base[i%base.length]).filter(u=>!u.boss||fl>=(tk.floors||1)):base.filter(u=>!u.boss||fl>=(tk.floors||1));   // 頭目（巢母）只在最下面一層
  const depth=(tk.depth||1)+2*(fl-1);
  // 位置：先用原本的敵人站位（合法的巡邏點），不夠再從離起點遠的地板格補
  const posts=map.enemies.filter(e=>!isNoncombatant(e)).map(e=>({x:e.x,y:e.y}));
  const taken=new Set([...map.props,...map.items,...(map.hazards||[]),map.start,map.end].map(p=>`${p.x},${p.y}`));
  const rnd=lcg(tk.seed);
  const spare=[];for(let y=0;y<map.grid.length;y++)for(let x=0;x<map.grid[y].length;x++){const k=`${x},${y}`;if(map.grid[y][x]===1&&!taken.has(k)&&near({x,y},map.start)>=7)spare.push({x,y});}
  for(let i=spare.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[spare[i],spare[j]]=[spare[j],spare[i]];}
  const used=new Set(),cells=[];
  for(const p of [...posts,...spare]){const k=`${p.x},${p.y}`;if(used.has(k))continue;used.add(k);cells.push(p);if(cells.length>=want.length)break;}
  map.enemies=[...want.slice(0,cells.length).map((u,i)=>rosterEnemy(u,cells[i].x,cells[i].y,`c${fl}-${i+1}`,this.difficultySpec,this.facilityFaction,depth,this.seed+fl))];
  map.swarmWaves=undefined;
  return map;
 }
 awardProtocol(){}
 // 戰壕（Alan 2026-10-09，像煙霧那樣的特殊地形）：全身格（2）與半身格（1）。
 // - 移動：全身↔半身、半身↔平地照常；平地直接跳進全身格或從全身格直接爬出來（差兩級），吃翻越的破綻（至下次自己行動前被射擊命中 +20）與 3 層壓制。
 // - 掩護：人在戰壕裡、射擊的人在戰壕外時，全身格當成牆那種掩護（擋 42、傷害 −45%），半身格當成一般掩體（擋 35）；和原本的掩護取比較好的。
 trenchAt(x,y){return this.chimeraOutdoor?.trench?.[y]?.[x]||0;}
 // 公路戰（Alan 2026-10-09）：路面不能走；翻過車欄跳到另一台車上吃翻越破綻＋3 層壓制；被推、被炸到路面上就是摔下車（死）
 deckAt(x,y){return this.chimeraOutdoor?.deck?.[y]?.[x]||0;}
 passable(x,y,actor){if(this.chimeraOutdoor?.deck&&!this.deckAt(x,y))return false;return super.passable(x,y,actor);}
 deckStep(u,from){
  const o=this.chimeraOutdoor;if(!o?.deck||!u||u.hp<=0)return;const a=this.deckAt(from.x,from.y),b=this.deckAt(u.x,u.y);if(!a||!b||a===b)return;
  u.vaultExposed=true;u.chimeraTrenchExposed=true;applySuppression(u,3);
  if(u===this.player||this.members?.includes(u))this.log(b===1?'跳回自己的車上：至下次行動前被射擊命中 +20，壓制 +3。':'跳上敵人的車：至下次行動前被射擊命中 +20，壓制 +3。',true);
 }
 // 公路戰：車在晃，命中大幅下降（Alan 2026-10-09）；下錨的重裝兵不受影響，固定在車上的機槍也不受影響。只算射擊，近戰不算
 defensiveEvasion(a,b){
  const base=super.defensiveEvasion(a,b);
  if(this.chimeraOutdoor?.layout!=='highway'||this.chimeraMelee||!a)return base;
  if(skillActive(a,'anchor')||a.type==='turret')return base;
  return base+HIGHWAY_SHAKE;
 }
 meleeAccuracy(...args){this.chimeraMelee=true;try{return super.meleeAccuracy(...args);}finally{this.chimeraMelee=false;}}
 // 增援波次：場上活著的敵人少於 WAVE_BELOW 時，從敵方那一側（守點是四周，其他是北邊）的邊緣補進來，一回合最多 WAVE_MAX 個
 chimeraWaves(o){
  const live=this.enemies.filter(e=>e.hp>0&&!isNoncombatant(e)).length,below=waveBelow();if(!o.groups&&live>=below)return;
  const R=convoyRng(o),N=this.grid.length,busy=new Set([...this.enemies.filter(e=>e.hp>0),...(this.members||[this.player]).filter(m=>m.hp>0),...this.props].map(u=>`${u.x},${u.y}`));
  const edge=[];for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){const ring=o.layout==='ring'?(x<=2||y<=2||x>=N-3||y>=N-3):o.waveFrom==='south'?y>=N-3:y<=2;if(ring&&this.grid[y][x]===1&&!busy.has(`${x},${y}`)&&!this.trenchAt(x,y))edge.push({x,y});}
  if(o.groups){if(live<Math.max(6,Math.round(onMap()*.5))&&this.turn-(o.waveAt??-9)>=3){o.waveAt=this.turn;this.chimeraWaveGroup(o);}return;}   // 隊與隊之間至少隔 3 回合   // 據點群：場上剩一半以下才整隊補
  let n=Math.min(WAVE_MAX,below-live,o.waves.length);if(!n||!edge.length)return;
  for(let i=edge.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[edge[i],edge[j]]=[edge[j],edge[i]];}
  const p=this.player;for(let i=0;i<n&&i<edge.length;i++){const e=o.waves.shift();Object.assign(e,{x:edge[i].x,y:edge[i].y,alert:true,lastKnown:{x:p.x,y:p.y}});this.enemies.push(e);}
  this.log(`敵方增援湧上來了（還有 ${o.waves.length} 名在後面）。`,true);
 }
 // 據點群的增援：整隊（wavePer 人）從北邊其中一個集結點進來，一進場就朝你壓上來
 chimeraWaveGroup(o){
  const R=convoyRng(o),N=this.grid.length,st=o.staging[(o.waveN=(o.waveN||0)+1)%o.staging.length],busy=new Set([...this.enemies.filter(e=>e.hp>0),...(this.members||[this.player]).filter(m=>m.hp>0),...this.props].map(u=>`${u.x},${u.y}`));
  const cells=[];for(let r=0;r<5&&cells.length<o.wavePer;r++)for(let y=Math.max(1,st.y-r);y<=Math.min(N-2,st.y+r);y++)for(let x=Math.max(1,st.x-r);x<=Math.min(N-2,st.x+r);x++)if(this.grid[y][x]===1&&!busy.has(`${x},${y}`)&&!cells.some(c=>c.x===x&&c.y===y))cells.push({x,y});
  const gi=o.groups.length;o.groups.push({id:gi,role:'wave',name:'增援',anchor:st,cells:[],active:true});
  const p=this.player,k=Math.min(o.wavePer,o.waves.length,cells.length);for(let i=0;i<k;i++){const e=o.waves.shift();Object.assign(e,{x:cells[i].x,y:cells[i].y,chimeraG:gi});this.enemies.push(e);}
  if(k)this.log(`一支 ${k} 人的增援從${st.x<N/3?'西北':st.x>N*2/3?'東北':'北邊'}進場了（後面還有 ${o.waves.length} 名）。`,true);
 }
 // 據點群每回合（Alan 2026-10-11）：巡邏隊沿路線走；有一隊發現你，預備隊和側襲隊就動起來；遠處動起來的隊伍（ASH 的敵人 16 格外不動）這裡帶著走，進到 16 格內交還 ASH
 chimeraGroups(o){
  const p=this.player;if(!p||p.hp<=0)return;
  const busy=()=>new Set([...this.enemies.filter(e=>e.hp>0),...(this.members||[this.player]).filter(m=>m.hp>0)].map(u=>`${u.x},${u.y}`));
  const step=(e,t,B)=>{const s=this.nextStep(e,t);if(!s||B.has(`${s.x},${s.y}`))return;B.delete(`${e.x},${e.y}`);e.x=s.x;e.y=s.y;e.moved=true;B.add(`${s.x},${s.y}`);};
  const alarm=o.groups.some(gr=>this.enemies.some(e=>e.hp>0&&e.chimeraG===gr.id&&e.alert));
  if(alarm&&!o.alarmed){o.alarmed=true;for(const gr of o.groups)if(gr.role==='reserve'||gr.role==='flank'){gr.active=true;this.log(`敵方的${gr.name}動起來了。`,true);}}
  const B=busy();
  for(const gr of o.groups){const mine=this.enemies.filter(e=>e.hp>0&&e.chimeraG===gr.id);if(!mine.length)continue;
   if(gr.role==='patrol'&&!mine.some(e=>e.alert)){const wp=gr.route[gr.leg=gr.leg||0];if(distance(mine[0],wp)<=1)gr.leg=(gr.leg+1)%gr.route.length;
    mine.forEach((e,i)=>step(e,{x:gr.route[gr.leg].x+(i%3)-1,y:gr.route[gr.leg].y+Math.floor(i/3)},B));continue;}
   if(!gr.active)continue;
   // 側襲隊先繞到你的一側（離你 8 格），預備隊、增援直接朝你來
   const side=gr.anchor.x<p.x?-1:1,t=gr.role==='flank'?{x:Math.max(1,Math.min(this.grid.length-2,p.x+side*8)),y:p.y}:{x:p.x,y:p.y};
   for(const e of mine){if(distance(e,p)<=16||(gr.role==='flank'&&distance(e,t)<=2)){if(!e.alert){e.alert=true;e.lastKnown={x:p.x,y:p.y};}continue;}step(e,t,B);}
  }
 }
 // 殘敵反撲（Alan 2026-10-14：找最後幾個人太花時間，夜戰更嚴重）：剩下的不到四分之一（至少 2 個）、也沒有增援要來時，剩下的敵人全部警覺，
 // 知道最近的隊員在哪；離得遠的（ASH 的敵人 16 格外不動）這裡帶著走，進到 12 格內交還 ASH
 chimeraLastStand(o){
  const foes=this.enemies.filter(e=>e.hp>0&&!isNoncombatant(e)),squad=(this.members||[this.player]).filter(m=>m.hp>0);if(!foes.length||!squad.length||o.waves?.length)return;
  o.total??=foes.length;if(foes.length>Math.max(2,Math.ceil(o.total*.25)))return;
  if(!o.lastStand){o.lastStand=true;this.log(`剩下的 ${foes.length} 個敵人朝你們摸過來了。`,true);}
  const B=new Set([...foes,...squad].map(u=>`${u.x},${u.y}`));
  for(const e of foes){const m=squad.reduce((a,b)=>distance(e,b)<distance(e,a)?b:a);e.alert=true;e.lastKnown={x:m.x,y:m.y};if(e.concealed||distance(e,m)<=12)continue;
   const s=this.nextStep(e,m);if(!s||B.has(`${s.x},${s.y}`))continue;B.delete(`${e.x},${e.y}`);e.x=s.x;e.y=s.y;e.moved=true;B.add(`${s.x},${s.y}`);}
 }
 // 據點的計分（每回合一次）
 chimeraPoints(o){
  const S=this.survival,ours=u=>u.hp>0&&u.x!==undefined,squad=(this.members||[this.player]).filter(ours),foe=pt=>this.enemies.some(e=>e.hp>0&&!e.concealed&&!isNoncombatant(e)&&e.x===pt.x&&e.y===pt.y);
  for(const pt of S.points){if(pt.hp<=0)continue;
   if(o.mode==='plant'){const on=squad.some(m=>m.x===pt.x&&m.y===pt.y)&&!foe(pt);pt.pressed=on;if(!on)continue;pt.hp--;S.integrity--;if(pt.hp<=0){pt.pressed=false;this.log(o.clear?`${o.clear.what} ${String.fromCharCode(65+Number(pt.id.slice(6)))} ${o.clear.verb}了。`:`目標 ${String.fromCharCode(65+Number(pt.id.slice(6)))} 的炸藥裝好了。`,true);}}
   else if(o.mode==='take'){const on=squad.some(m=>m.x===pt.x&&m.y===pt.y)&&!foe(pt);pt.pressed=on;if(!on)continue;pt.hp--;S.integrity--;if(pt.hp<=0){pt.pressed=false;this.log(`拿下據點 ${String.fromCharCode(65+Number(pt.id.slice(6)))}。`,true);}}
   else{const was=pt.pressed;pt.pressed=foe(pt);if(!pt.pressed)continue;if(!was)this.log(`敵人站上據點 ${String.fromCharCode(65+Number(pt.id.slice(6)))}！`,true);pt.hp--;S.integrity--;if(pt.hp<=0){pt.pressed=false;this.log(`據點 ${String.fromCharCode(65+Number(pt.id.slice(6)))} 失守。`,true);}}
  }
  S.integrity=Math.max(0,S.integrity);
  if(o.mode==='plant'&&o.clear){if(S.points.every(pt=>pt.hp<=0)){this.status='won';this.log(`${o.clear.what}全部${o.clear.verb}了，車隊可以過了。`,true);}return;}   // 拆路障、排炸彈：推完就贏，不用撤離
  if(o.mode==='plant'){if(!o.armed&&S.points.every(pt=>pt.hp<=0)){o.armed=true;this.log('炸藥全部裝好了，回到出發的地方撤離！',true);for(const e of this.enemies)if(e.hp>0&&!isNoncombatant(e)){e.alert=true;e.lastKnown={x:this.player.x,y:this.player.y};}}return;}
  if(S.points.every(pt=>pt.hp<=0)){if(o.mode==='take'){this.status='won';this.log('據點全部拿下。');}else{this.status='failed';this.log('據點全部失守，陣地丟了。');}}
 }
 chimeraFalls(){
  if(!this.chimeraOutdoor?.deck)return;
  for(const u of [...(this.members||[this.player]),...this.enemies])if(u.hp>0&&!this.deckAt(u.x,u.y)){u.hp=0;this.log(`${u.callName||u.squadId||u.courseName||'有人'}摔下車。`,true);}
 }
 trenchStep(u,from){
  if(!this.chimeraOutdoor?.trench||!u||u.hp<=0)return;
  const a=this.trenchAt(from.x,from.y),b=this.trenchAt(u.x,u.y);if(Math.abs(a-b)<2)return;
  u.vaultExposed=true;u.chimeraTrenchExposed=true;applySuppression(u,3);
  if(u===this.player||this.members?.includes(u))this.log(b>a?'直接跳進壕溝：至下次行動前被射擊命中 +20，壓制 +3。':'從壕溝直接爬出來：至下次行動前被射擊命中 +20，壓制 +3。',true);
 }
 executePlayer(type,arg){
  const p=this.player,from={x:p.x,y:p.y};if(p.chimeraTrenchExposed){p.chimeraTrenchExposed=false;p.vaultExposed=false;}   // 破綻到自己下次行動為止
  const ok=super.executePlayer(type,arg);if(ok&&(p.x!==from.x||p.y!==from.y)){this.trenchStep(p,from);this.deckStep(p,from);}return ok;
 }
 enemyAct(e){
  if(e.chimeraTrenchExposed){e.vaultExposed=false;e.chimeraTrenchExposed=false;}   // 敵人的破綻到它下次行動為止
  const from={x:e.x,y:e.y},r=super.enemyAct(e);
  // 武裝車兩回合才走一格：上一回合走過，這回合就退回原位（開火照常）
  if(ENEMY_TYPES[e.type]?.chimeraVehicle&&(e.x!==from.x||e.y!==from.y)){if(e.chimeraMovedTurn===this.turn-1){e.x=from.x;e.y=from.y;e.moveDelta=[0,0];}else e.chimeraMovedTurn=this.turn;}
  if(e.x!==from.x||e.y!==from.y){this.trenchStep(e,from);this.deckStep(e,from);}return r;
 }
 // 衝鋒車的爆炸比自爆機器人大
 explode(center,radius,damage,...rest){if(center?.type==='chimera_rush'){radius=Math.max(radius,RUSH_BLAST.radius);damage=Math.max(damage,RUSH_BLAST.damage);}return super.explode(center,radius,damage,...rest);}
 // 遺產級頭目被打倒（Alan 2026-10-09）：前幾次負傷撤退（離開戰場，「擊倒頭目」照樣算），之後照服務單骰好的戰死：
 // 遺產級掉在他倒下的那一格，要有人撿起來、活著帶出戰場（missionResult.legacy）
 chimeraBossCheck(){
  for(const e of this.enemies){const b=e.chimeraBoss;if(!b||b.out||e.hp>0)continue;
   if(!b.dies){b.out='retreat';this.chimeraBossOut='retreat';this.enemies=this.enemies.filter(x=>x!==e);this.log(`${b.chief||'頭目'}負傷，帶著遺產級「${b.weapon}」撤出戰場。`,true);continue;}
   b.out='dead';this.chimeraBossOut='dead';this.items.push({x:e.x,y:e.y,type:'chimera_legacy',amount:1,floor:this.floor,legacy:{id:b.legacy,name:b.weapon,kind:b.kind,bonus:b.bonus}});
   this.log(`${b.chief||'頭目'}戰死，遺產級「${b.weapon}」掉在地上。撿起來帶出去才算數。`,true);}
 }
 // 撿遺產級：誰踩上去誰拿（一個人只拿一件）；拿著的人倒下就掉在原地
 pickup(){
  const p=this.player;
  this.items=this.items.filter(it=>{if(it.type!=='chimera_legacy'||it.x!==p.x||it.y!==p.y)return true;if(p.chimeraLegacy)return true;p.chimeraLegacy=it.legacy;this.log(`撿起遺產級「${it.legacy.name}」。`,true);return false;});
  // ASH 的撿東西不認得這種，會當成撿走：先收起來再放回去
  const keep=this.items.filter(it=>it.type==='chimera_legacy');this.items=this.items.filter(it=>it.type!=='chimera_legacy');
  try{return super.pickup();}finally{this.items.push(...keep);}
 }
 chimeraLegacyDrop(){for(const m of this.members||[this.player])if(m.hp<=0&&m.chimeraLegacy){this.items.push({x:m.x,y:m.y,type:'chimera_legacy',amount:1,floor:this.floor,legacy:m.chimeraLegacy});this.log(`遺產級「${m.chimeraLegacy.name}」掉在地上。`,true);m.chimeraLegacy=null;}}
 protectingCover(target,attacker){
  const base=super.protectingCover(target,attacker),lv=target&&this.trenchAt(target.x,target.y);
  if(!lv||!attacker||this.trenchAt(attacker.x,attacker.y))return base;
  const sx=Math.sign(attacker.x-target.x),sy=Math.sign(attacker.y-target.y);if(!sx&&!sy)return base;
  const ditch={type:lv===2?'wall':'cover',x:target.x+sx,y:target.y+sy,hp:Infinity,maxHp:Infinity,trench:true};
  return bestCover([base,ditch].filter(Boolean),target,attacker)||base;
 }
 // 戶外戰鬥的勝利：清光敵人（goal kill）；行軍遇襲是走到另一頭撤離（goal exit，descend）
 action(type,arg){
  const ok=super.action(type,arg),o0=this.chimeraOutdoor;
  if(o0&&o0.layout==='highway'&&this.status==='playing'&&this.turn!==o0.stepTurn){o0.stepTurn=this.turn;for(const [text,danger] of vehicleStep(this,convoyRng(o0)))this.log(text,danger);this.reveal?.();}
  if(o0?.waves?.length&&this.status==='playing'&&this.turn!==o0.waveTurn){o0.waveTurn=this.turn;this.chimeraWaves(o0);}
  if(o0?.groups&&this.status==='playing'&&this.turn!==o0.groupTurn){o0.groupTurn=this.turn;this.chimeraGroups(o0);}
  if(o0&&!o0.deck&&this.status==='playing'&&this.turn!==o0.lastTurn){o0.lastTurn=this.turn;this.chimeraLastStand(o0);}
  if(this.survival&&o0?.mode&&this.status==='playing'&&this.turn!==o0.pointTurn){o0.pointTurn=this.turn;this.chimeraPoints(o0);}
  this.chimeraFalls();this.chimeraBossCheck();this.chimeraLegacyDrop();
  const o=this.chimeraOutdoor;
  if(o&&o.goal!=='exit'&&o.goal!=='plant'&&this.status==='playing'){
   if(!this.enemies.some(e=>e.hp>0&&!isNoncombatant(e))&&!o.waves?.length&&(o.goal!=='drive'||convoyDone(o))){this.status='won';this.log(o.goal==='drive'?'追上來的車都打退了。':'敵人清光了。');}
   else if(o.goal==='hold'&&this.turn>=o.holdTurns){this.status='won';this.log(`撐過 ${o.holdTurns} 回合，陣地守住了。`);}
   else if(o.goal==='hold'&&ok&&this.turn%10===0)this.log(`守住陣地：還要撐 ${o.holdTurns-this.turn} 回合。`);
   else if(o.goal==='drive'&&this.turn>=o.holdTurns){this.status='won';this.log('開到目的地，甩掉了追兵。');}
   else if(o.goal==='drive'&&ok&&this.turn%5===0)this.log(`離目的地還有 ${o.holdTurns-this.turn} 回合。`);
  }
  return ok;
 }
 // 撤離＝勝：走到電梯旁按撤離就結束，不下樓
 descend(){
  if(this.status!=='playing'||this.player.hp<=0)return false;
  const og=this.chimeraOutdoor?.goal;if(og==='plant'&&!this.chimeraOutdoor.armed)return this.fail('炸藥還沒裝完，不能撤離');
  if(this.chimeraOutdoor&&og!=='exit'&&og!=='plant')return this.fail('這一場要把敵人清掉，不能撤離');
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
