// 奇美拉：性格技能（Alan 2026-10-13，DESIGN.md「強化（perk）整組重做」：模仿 XCOM，4、6、8、10 級各從三種性格選一個）。
// 名字與說明在策略層 chimera/company.js TALENTS（照 id）；這裡是戰場上的規則。ticket.squad[i].tal 是選好的 id。
// - 跟 ASH 現成的職業強化一樣的（✓）：直接給那個強化的階數（PERK_RANKS），規則照 ASH。
// - 新的：包在 SquadGame 的方法外面（命中 accuracy、打中 hitTarget、受傷 damagePlayer、擊倒 hurt、敵人行動 enemyAct、一個行動 action），
//   每回合結束（世界推進之後）跑 talentRound。ASH 本體只改兩個地方（補丁 0011）：著彈修正多一層、定點砲台射程。
// 存檔：伺服器每個行動後把整場 JSON 存起來再接回，所以這裡記在隊員身上的東西都是陣列與數字（m.chimeraTal、m.tX＝上次用的回合）。
// 亂數一律用 this.rng()，伺服器重播的結果才會一樣。
import {skillValues,skillActive} from './skills.js';
import {markValues} from './class-perks.js';
import {grantTrait,activeTrait} from './traits.js';
import {applySuppression} from './suppression.js';
import {distance} from './world.js';
import {currentAllies,allyAct} from './allies.js';
import {isBossClass} from './enemy-data.js';
import {presentStep} from './presentation.js';
import {plateCapacityOf} from './game-save.js';
import {PERK_D} from './data.js';

// ✓：ASH 現成的職業強化
const PERK_RANKS={sol_wide:{soldier_overwatch:2},rec_unseen:{recon_unseen:2},rec_side:{recon_sidestep:2},rec_break:{recon_blackout:1},
 bul_anchor:{bulwark_anchor:3},bul_plate:{bulwark_plating:2},ber_thirst:{berserker_thirst:2},ber_fury:{berserker_fury:2},ber_endure:{berserker_endure:2},
 eng_frame:{engineer_frame:2},eng_lines:{engineer_lines:1},eng_fire:{engineer_firecontrol:2},eng_deploy:{engineer_deploy:1}};
// 機體的強化 ASH 讀的是「當下的玩家」（小隊裡常常不是工兵本人），所以全隊都掛上
const SHARED_PERKS=['engineer_frame','engineer_firecontrol'];
const AMMO_KEY={rifle:'reserve',pistol:'pistol',shell:'shell',energy:'energy',ordnance:'ordnance'};
export const has=(m,id)=>Boolean(m?.chimeraTal?.includes(id));
const clamp=v=>Math.max(10,Math.min(99,v));
const isFist=w=>w?.id==='powerfist';
// 觸發次數（測試看技能有沒有真的生效；g.chimeraFired，跟著存檔）
const fired=(g,id)=>{(g.chimeraFired||={})[id]=(g.chimeraFired[id]||0)+1;};

// 進場：一位隊員（applyStats、裝備之後）
export function setupMember(g,m,c){
 m.chimeraTal=[...(c.tal||[])].filter(x=>typeof x==='string');
 for(const id of m.chimeraTal)for(const [perk,n] of Object.entries(PERK_RANKS[id]||{}))m.perks[perk]=Math.max(m.perks[perk]||0,n);
 const gr=c.grow||{};
 if(gr.hp){m.maxHp+=gr.hp;m.hp+=gr.hp;}
 if(gr.acc||gr.eva||gr.mel){const cm={...m.combatModifiers};cm.rangedAccuracy=(cm.rangedAccuracy||0)+(gr.acc||0);cm.rangedEvasion=(cm.rangedEvasion||0)+(gr.eva||0);cm.meleeAccuracy=(cm.meleeAccuracy||0)+(gr.mel||0);m.combatModifiers=cm;}
 // 護甲板上限：ASH 照職業＋加掛板架的階數算（plateCapacityOf），成長就是多幾階加掛板架
 if(gr.plates){const n=Math.round(gr.plates/PERK_D.rack);m.perks.plate_rack=(m.perks.plate_rack||0)+n;m.plates=Math.min(plateCapacityOf(m),(m.plates||0)+n*PERK_D.rack);}
 m.chimeraDrone=gr.drone||0;
 // 工兵的廢料（Alan 2026-10-13）：進場照等級補滿；ASH 的廢料來源全部關掉（SquadGame.action 每個行動後扣回去）
 m.scrap=Math.max(0,c.scrap|0);
 if(has(m,'sol_track'))m.chimeraTrack=true;
 if(has(m,'rec_smoke')){m.smoke=(m.smoke||0)+2;m.stun=(m.stun||0)+2;}
 if(has(m,'bul_belt'))for(const s of m.owned){const w=g.weaponAtOf(m,s);if(w?.id==='lmg')m.ammo[s]=Math.floor(w.mag*1.5);}
}
// 進場：全隊都到齊之後
export function setupSquad(g){
 const M=g.members||[g.player];
 for(const id of SHARED_PERKS){const n=Math.max(0,...M.map(m=>m.perks?.[id]||0));if(n)for(const m of M)m.perks[id]=Math.max(m.perks[id]||0,n);}
 const sr=M.some(m=>has(m,'eng_sentry'))?2:0;for(const m of M)m.chimeraSentryRange=sr;
 g.chimeraScrapGain={};
}

export function installTalents(Cls){
 const P=Cls.prototype,base={};
 for(const k of ['accuracy','hitTarget','hurt','damagePlayer','damageAlly','enemyAct','action','reload','activateSkill','soloPaid','executePlayer'])base[k]=P[k];
 const isM=(g,a)=>Boolean(a&&g.members?.includes(a));
 const anyM=(g,id)=>g.living.some(m=>has(m,id));
 const who=m=>m.callName||m.squadId||'隊員';

 // 武器（隊員自己的那一格；武器登錄表全隊共用）
 P.weaponAtOf=function(m,slot){const keep=this.player;if(!this.members||m===keep)return this.weaponAt(slot);this.player=m;try{return this.weaponAt(slot);}finally{this.player=keep;}};

 // ===== 命中 =====
 P.accuracy=function(attacker,target){
  const r=base.accuracy.call(this,attacker,target);if(!this.members)return r;
  let d=0;
  if(isM(this,attacker)&&this.enemies.includes(target)){
   if(has(attacker,'sol_brace')&&r.bracedBonus>0){d+=8;fired(this,'sol_brace');}
   if(has(attacker,'sol_finish')&&target.chimeraFinish?.by===attacker.id&&target.chimeraFinish.until>=this.turn){d+=15;fired(this,'sol_finish');}
   if(this.living.some(o=>o!==attacker&&has(o,'rec_spot')&&this.sight(o,target))){d+=8;fired(this,'rec_spot');}
   if(this.chimeraReaction===attacker)d-=15;
  }
  if(isM(this,target)&&this.enemies.includes(attacker)){
   if(activeTrait(attacker,'exposed')&&anyM(this,'sol_weaken')){d-=10;fired(this,'sol_weaken');}
   if(this.living.some(o=>o!==target&&has(o,'rec_cover')&&distance(o,target)<=3)){d-=10;fired(this,'rec_cover');}
  }
  let chance=clamp(r.chance+d);
  if(isM(this,target)&&has(target,'rec_blur')&&target.moved&&chance>30){chance=30;fired(this,'rec_blur');}
  return d||chance!==r.chance?{...r,chance,talentBonus:chance-r.chance}:r;
 };

 // ===== 打中 =====
 P.hitTarget=function(target,raw,attacker,pierce=0,weapon=this.weapon,pellets=null){
  if(!this.members||!isM(this,attacker)||!this.enemies.includes(target)||target.hp<=0)return base.hitTarget.call(this,target,raw,attacker,pierce,weapon,pellets);
  let k=1;const melee=Boolean(weapon?.melee);
  if(has(attacker,'sol_close')&&weapon?.pellets&&distance(attacker,target)<=3){k*=1.2;fired(this,'sol_close');}
  if(activeTrait(target,'exposed')&&anyM(this,'sol_press')){k*=1.2/1.1;fired(this,'sol_press');}   // ASH 的標定本來就 +10%（全隊），標定壓制補到 +20%
  if(has(attacker,'sol_finish')&&target.chimeraFinish?.by===attacker.id&&target.chimeraFinish.until>=this.turn)k*=1.15;   // 命中那邊記過觸發
  if(has(attacker,'rec_first')&&!melee&&(attacker.tFirst==null||attacker.tFirst===this.turn||!target.alert)){if(attacker.tFirst==null)attacker.tFirst=this.turn;k*=1.5;fired(this,'rec_first');}
  if(has(attacker,'ber_pounce')&&this.chimeraGrapple===attacker)fired(this,'ber_pounce');if(has(attacker,'ber_pounce')&&this.chimeraGrapple===attacker)k*=1.5*(activeTrait(target,'large')||isBossClass(target)?1.5:1);
  if(k!==1){raw=Math.round(raw*k);if(pellets)pellets=pellets.map(d=>Math.round(d*k));}
  if(has(attacker,'ber_execute')&&melee&&!isBossClass(target)&&target.hp<(target.maxHp||target.hp)*.3){raw=9999;pellets=null;fired(this,'ber_execute');this.log(`${who(attacker)} 處決了重傷的敵人。`);}
  const tBefore=target.hp,aBefore=attacker.hp;
  this.chimeraMelee=melee?attacker:null;this.chimeraMeleeW=melee?weapon:null;
  try{base.hitTarget.call(this,target,raw,attacker,pierce,weapon,pellets);}finally{this.chimeraMelee=null;this.chimeraMeleeW=null;}
  const dealt=Math.max(0,tBefore-Math.max(0,target.hp));
  if(dealt>0&&target.hp>0&&has(attacker,'sol_finish'))target.chimeraFinish={by:attacker.id,until:this.turn+1};
  if(dealt>0&&target.hp>0&&has(attacker,'bul_deep')&&weapon?.id==='lmg'){applySuppression(target,1);fired(this,'bul_deep');}
  if(dealt>0&&isFist(weapon)){
   if(has(attacker,'bul_wall'))for(const o of this.props)if(o.type==='cover'&&o.hp>0&&distance(o,target)<=1){this.damageProp(o,9999,attacker);fired(this,'bul_wall');this.log(`${who(attacker)} 一拳把掩體打爛了。`);}
   if(has(attacker,'bul_knock')&&target.hp>0){const dx=Math.sign(target.x-attacker.x),dy=Math.sign(target.y-attacker.y),q={x:target.x+dx,y:target.y+dy};
    if((dx||dy)&&this.passable(q.x,q.y,target)&&this.canCross(target,q)&&!this.enemies.some(e=>e.hp>0&&e.x===q.x&&e.y===q.y)&&!this.memberAt(q)){target.x=q.x;target.y=q.y;fired(this,'bul_knock');this.log(`${who(attacker)} 把敵人打退一格。`);}}
  }
  if(melee&&has(attacker,'ber_whirl')&&!this.chimeraWhirl){this.chimeraWhirl=true;
   try{for(const e of this.enemies)if(e!==target&&e.hp>0&&distance(e,attacker)<=1&&(fired(this,'ber_whirl'),true))base.hitTarget.call(this,e,Math.round(raw*.5),attacker,pierce,weapon,null);}finally{this.chimeraWhirl=false;}}
  if(!melee&&weapon?.id==='lmg'&&has(attacker,'bul_sweep')&&attacker.tSweep!==this.turn){attacker.tSweep=this.turn;
   for(const e of this.enemies){if(e===target||e.hp<=0||distance(e,target)>1||!this.sight(attacker,e))continue;
    const hit=this.rng()*100<this.accuracy(attacker,e).chance,dm=this.weaponDamage(attacker.weapon,e),dmg=dm.min+Math.floor(this.rng()*(dm.max-dm.min+1));
    this.effects.push({type:'shot',weaponId:weapon.id,style:'bullet',from:{x:attacker.x,y:attacker.y},to:{x:e.x,y:e.y},damage:0,miss:!hit});
    fired(this,'bul_sweep');if(hit)base.hitTarget.call(this,e,dmg,attacker,pierce,weapon,null);}}
  if(melee&&has(attacker,'ber_bloodplate')&&activeTrait(attacker,'bloodlust')&&dealt>0){
   const rate=.2+.08*(attacker.perks?.berserker_thirst||0),over=Math.round(dealt*rate)-Math.max(0,attacker.hp-aBefore);
   if(over>0){fired(this,'ber_bloodplate');const cap=Math.max(30,plateCapacityOf(attacker));attacker.plates=Math.min(cap,(attacker.plates||0)+over);}}
 };

 // ===== 擊倒 =====
 P.hurt=function(e,damage,attacker=null,cause=null){
  const before=e.hp;base.hurt.call(this,e,damage,attacker,cause);
  if(!this.members||!(before>0&&e.hp<=0)||!this.enemies.includes(e))return;
  for(const m of this.living)if(has(m,'eng_salvage')&&(fired(this,'eng_salvage'),true))(this.chimeraScrapGain||={})[m.id]=(this.chimeraScrapGain[m.id]||0)+3;
  if(!isM(this,attacker))return;
  const k=attacker;
  if(has(k,'rec_ghost')&&k.skillState?.signal_break){k.skillState.signal_break.cooldown=0;fired(this,'rec_ghost');}
  if(has(k,'ber_rehook')&&this.chimeraGrapple===k&&k.skillState?.grapple){k.skillState.grapple.cooldown=0;fired(this,'ber_rehook');this.log(`${who(k)} 收回鉤鎖，馬上又能再甩。`);}
  if(has(k,'ber_roar')&&this.chimeraMelee===k){let n=0;for(const x of this.enemies)if(x.hp>0&&distance(x,k)<=3){applySuppression(x,1);n++;}if(n){fired(this,'ber_roar');}if(n)this.log(`${who(k)} 一聲怒吼，${n} 個敵人被壓得抬不起頭。`);}
  if(has(k,'bul_hammer')&&this.chimeraMelee===k&&isFist(this.chimeraMeleeW)&&!this.chimeraHammer){this.chimeraHammer=true;try{for(const x of this.enemies)if(x.hp>0&&distance(x,e)<=1){fired(this,'bul_hammer');this.hurt(x,15,k);}}finally{this.chimeraHammer=false;}}
  if(has(k,'ber_slaughter')&&k.tSlaughter!==this.turn){k.tSlaughter=this.turn;fired(this,'ber_slaughter');
   if(this.soloTurn)this.chimeraExtra=true;else if(k===this.player)this.pursuitPending=true;
   this.log(`${who(k)} 殺紅了眼，還能再砍一次。`);}
 };

 // ===== 受傷 =====
 P.damagePlayer=function(raw,label,attacker=null,blast=false,projectile=undefined){
  if(!this.members)return base.damagePlayer.call(this,raw,label,attacker,blast,projectile);
  const p=this.player;
  if(has(p,'rec_dodge')&&p.tDodge!==this.turn){p.tDodge=this.turn;raw*=.5;fired(this,'rec_dodge');this.log(`${who(p)} 閃身，只被擦到。`);}
  if(anyM(this,'eng_line')&&(this.props.some(o=>o.type==='cover'&&o.hp>0&&distance(o,p)<=1)||currentAllies(this).some(a=>a.sourceId==='drone_sentry'&&distance(a,p)<=1))){raw*=.8;fired(this,'eng_line');}
  const B=this.living.find(o=>o!==p&&has(o,'bul_guard')&&(o.plates||0)>0&&distance(o,p)<=1);
  if(B){const share=Math.min(B.plates,Math.round(raw*.3));if(share>0){fired(this,'bul_guard');B.plates-=share;raw-=share;this.log(`${who(B)} 替 ${who(p)} 擋下 ${share} 點。`);}}
  base.damagePlayer.call(this,raw,label,attacker,blast,projectile);
  if(p.hp<=0){
   if(has(p,'ber_undying')&&(p.battleSpirit?.stacks||0)>0){p.battleSpirit.stacks--;p.hp=1;fired(this,'ber_undying');this.log(`${who(p)} 不肯倒下（戰意剩 ${p.battleSpirit.stacks} 層）。`,true);}
   else if(has(p,'sol_stand')&&!p.tStand){p.tStand=1;p.hp=1;fired(this,'sol_stand');this.log(`${who(p)} 咬著牙撐住了。`,true);}
  }
 };
 P.damageAlly=function(a,raw,attacker=null,blast=false,environment=false){
  const before=a.hp,r=base.damageAlly.call(this,a,raw,attacker,blast,environment);
  if(this.members&&before>0&&a.hp<=0&&a.kind==='drone'&&anyM(this,'eng_boom')){let n=0;fired(this,'eng_boom');for(const e of this.enemies)if(e.hp>0&&distance(e,a)<=1){this.hurt(e,30,null);n++;}this.log(`機體爆開${n?`，炸到 ${n} 個敵人`:''}。`);}
  return r;
 };

 // ===== 敵人行動：火線（敵人在射程內移動就開一槍）=====
 P.enemyAct=function(e){
  const from={x:e.x,y:e.y},r=base.enemyAct.call(this,e);
  if(this.members&&!this.soloTurn&&e.hp>0&&(e.x!==from.x||e.y!==from.y)&&this.status==='playing')
   for(const m of this.living)if(has(m,'sol_line')&&m.tLine!==this.turn)this.reactShot(m,e);
  return r;
 };
 P.reactShot=function(m,e){
  const keep=this.player;this.swap(m);
  try{const w=this.weapon;if(w.melee||(m.ammo[m.weapon]||0)<(w.shotCost||1)||distance(m,e)>w.range||!this.sight(m,e)||!this.shotClear(m,e))return false;
   m.tLine=this.turn;fired(this,'sol_line');this.target=e.id;this.chimeraReaction=m;this.log(`${who(m)} 對移動的敵人開火。`);return this.fire({id:e.id,x:e.x,y:e.y});}
  finally{this.chimeraReaction=null;this.swap(keep);}
 };

 // ===== 一個行動 =====
 P.executePlayer=function(type,arg){
  if(type!=='grapple'||!this.members)return base.executePlayer.call(this,type,arg);
  this.chimeraGrapple=this.player;try{return base.executePlayer.call(this,type,arg);}finally{this.chimeraGrapple=null;}
 };
 P.soloPaid=function(type,arg){
  this.chimeraExtra=false;const ok=base.soloPaid.call(this,type,arg),p=this.player;
  if(ok&&this.chimeraExtra){fired(this,'extra_solo');this.soloDone=false;this.chimeraExtra=false;}   // 屠戮：機器人隊員多做一個動作
  if(ok&&type==='fire'&&has(p,'rec_hitrun')&&p.tHit!==this.turn){p.tHit=this.turn;fired(this,'rec_hitrun');this.shadowSteps=1;this.chimeraMoveOnly=p.id;this.soloDone=false;}
  return ok;
 };
 P.action=function(type,arg){
  if(!this.members)return base.action.call(this,type,arg);
  const solo=this.soloTurn,p=this.player,turn0=this.turn;
  // 打帶跑給的那一步只能拿來走
  if(solo&&this.chimeraMoveOnly===p.id){this.chimeraMoveOnly=null;if(type!=='move'){this.shadowSteps=0;this.soloDone=true;return false;}}
  // 衝鋒：每場第一次移動不花回合（借 ASH 的影步）
  if(type==='move'&&Array.isArray(arg)&&has(p,'sol_charge')&&!p.tCharge&&!this.shadowSteps&&!this.enemies.some(e=>e.hp>0&&e.x===p.x+arg[0]&&e.y===p.y+arg[1])){p.tCharge=1;this.shadowSteps=1;fired(this,'sol_charge');this.log(`${who(p)} 衝鋒！`);}
  const scrap0=solo?null:this.members.map(m=>m.scrap||0),hook0=this.members.map(m=>m.skillState?.grapple?.cooldown||0);
  const r=base.action.call(this,type,arg);
  if(r&&type==='move'&&has(p,'bul_ram')&&p.hp>0&&p.tRam!==turn0&&this.status==='playing')this.ramPunch(p,turn0);
  // 快鉤：剛甩出去的鉤鎖冷卻 −2
  this.members.forEach((m,i)=>{const s=m.skillState?.grapple;if(has(m,'ber_hook')&&s&&s.cooldown>hook0[i]&&(fired(this,'ber_hook'),true))s.cooldown=Math.max(0,s.cooldown-2);});
  // 打帶跑（操作中的隊員）：開槍之後下一步免費走一格
  if(!solo&&r&&(type==='fire'||type==='usePrepared'&&arg?.category==='fire')&&has(p,'rec_hitrun')&&p.hp>0&&p.tHit!==turn0){p.tHit=turn0;if(p===this.player&&!this.shadowSteps){fired(this,'rec_hitrun');this.shadowSteps=1;this.log(`${who(p)} 打完就走。`);}}
  if(solo)return r;
  // 廢料：ASH 給的都不算（擊殺、拆武器、撿到的）；只有戰場回收給的
  this.members.forEach((m,i)=>{if((m.scrap||0)>scrap0[i])m.scrap=scrap0[i];const add=this.chimeraScrapGain?.[m.id];if(add){m.scrap=(m.scrap||0)+add;}});
  this.chimeraScrapGain={};
  if(this.turn!==turn0&&this.status==='playing')this.talentRound();
  return r;
 };
 // 衝撞：動力拳傷害的一半，打身邊一個敵人（每回合一次）
 P.ramPunch=function(p,turn){
  const slot=p.owned.find(s=>isFist(this.weaponAtOf(p,s)));if(slot==null)return false;
  const e=this.enemies.filter(x=>x.hp>0&&distance(x,p)<=1&&this.canCross(p,x)).sort((a,b)=>a.hp-b.hp)[0];if(!e)return false;
  const keep=this.player;this.swap(p);
  try{p.tRam=turn;const w=this.weaponAt(slot),d=this.weaponDamage(slot),dmg=Math.round((d.min+Math.floor(this.rng()*(d.max-d.min+1)))*.5);fired(this,'bul_ram');
   this.effects.push({type:'shot',weaponId:w.id,style:'slash',from:{x:p.x,y:p.y},to:{x:e.x,y:e.y},damage:0,miss:false});this.log(`${who(p)} 撞上去順手一拳。`);
   this.chimeraMelee=p;try{this.hitTarget(e,dmg,p,w.pierce||0,w);}finally{this.chimeraMelee=null;}return true;}
  finally{this.swap(keep);}
 };
 // 彈鏈：輕機槍裝到一倍半
 P.reload=function(){
  const r=base.reload.call(this),p=this.player,w=this.weapon;
  if(this.members&&has(p,'bul_belt')&&w?.id==='lmg'){const cap=Math.floor(w.mag*1.5),key=AMMO_KEY[w.ammoType],take=Math.max(0,Math.min(cap-(p.ammo[p.weapon]||0),p[key]||0));if(take){p.ammo[p.weapon]+=take;p[key]-=take;fired(this,'bul_belt');}}
  return r;
 };
 // 標定弱化、標定壓制：預警的標定多 1 回合
 P.activateSkill=function(id){
  const r=base.activateSkill.call(this,id),p=this.player;
  if(r&&id==='early_warning'&&this.members){const add=(has(p,'sol_weaken')?1:0)+(has(p,'sol_press')?1:0);if(add)fired(this,'mark_turns');if(add)for(const e of this.enemies)for(const t of e.traits||[])if(t.id==='exposed'&&t.source==='skill:early_warning'&&t.turns!=null)t.turns+=add;}
  return r;
 };

 // ===== 每回合結束（世界推進之後）=====
 P.talentRound=function(){
  const foes=this.enemies.filter(e=>e.hp>0),nearFoe=m=>foes.filter(e=>this.sight(m,e)).sort((a,b)=>distance(m,a)-distance(m,b))[0];
  const free=q=>this.passable(q.x,q.y)&&!this.memberAt(q)&&!foes.some(e=>e.x===q.x&&e.y===q.y)&&!this.props.some(o=>o.hp>0&&o.x===q.x&&o.y===q.y)&&!(this.mines||[]).some(o=>o.x===q.x&&o.y===q.y)&&!currentAllies(this).some(a=>a.x===q.x&&a.y===q.y);
  const nextTo=(m,toward)=>{const c=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q={x:m.x+dx,y:m.y+dy};if((dx||dy)&&free(q)&&this.canCross(m,q))c.push(q);}return c.sort((a,b)=>toward?distance(a,toward)-distance(b,toward):0)[0]||null;};
  for(const m of this.living){
   if(has(m,'sol_net')){const R=skillValues(m,'early_warning').radius,dur=markValues(m).duration+(has(m,'sol_weaken')?1:0)+(has(m,'sol_press')?1:0);for(const e of foes)if(distance(m,e)<=R){grantTrait(e,'exposed','skill:early_warning',dur);fired(this,'sol_net');}}
   const anchored=skillActive(m,'anchor');
   if(has(m,'bul_rock')&&anchored){fired(this,'bul_rock');m.suppression=0;m.plates=Math.min(plateCapacityOf(m),(m.plates||0)+10);}
   if(has(m,'bul_net')&&anchored){const w=this.weaponAtOf(m,m.weapon),T=foes.filter(e=>distance(m,e)<=(w?.range||7)&&this.sight(m,e)).sort((a,b)=>distance(m,a)-distance(m,b)).slice(0,2);for(const e of T){applySuppression(e,1);fired(this,'bul_net');}}
   if(has(m,'rec_nv'))for(const o of this.living)if(o!==m&&distance(o,m)<=3){grantTrait(o,'night_vision','chimera-talent',2);fired(this,'rec_nv');}
   if(m.chimeraDrone)for(const a of currentAllies(this))if(a.kind==='drone'&&!a.chimeraGrown){fired(this,'drone_grow');a.chimeraGrown=1;a.maxHp+=m.chimeraDrone;a.hp+=m.chimeraDrone;}
   if(has(m,'eng_repair')){const a=currentAllies(this).filter(x=>x.kind==='drone'&&x.hp<x.maxHp).sort((x,y)=>x.hp/x.maxHp-y.hp/y.maxHp)[0];if(a){fired(this,'eng_repair');a.hp=Math.min(a.maxHp,a.hp+Math.ceil(a.maxHp*.25));}}
   if(!m.moved){
    if(has(m,'eng_remote'))for(const a of currentAllies(this))if(a.kind==='drone'&&distance(a,m)<=3&&this.status==='playing')presentStep(this,()=>{fired(this,'eng_remote');allyAct(this,a);this.settleAttackNotes();this.reveal();},a);
    const f=nearFoe(m);
    if(has(m,'eng_cover')&&(m.scrap||0)>=10&&!this.props.some(o=>o.type==='cover'&&o.hp>0&&distance(o,m)<=1)&&f){const q=nextTo(m,f);if(q){this.props.push({id:`${this.floor}-tc-${this.turn}-${m.squadId}`,x:q.x,y:q.y,type:'cover',hp:90,maxHp:90});m.scrap-=10;fired(this,'eng_cover');this.log(`${who(m)} 立起一塊掩體（廢料 −10）。`);}}
    if(has(m,'eng_mine')&&(m.scrap||0)>=15&&(this.mines||[]).length<3){const q=nextTo(m,f);if(q){this.mineSerial=(this.mineSerial||0)+1;this.mines=[...(this.mines||[]),{id:`mine-${this.floor}-${this.mineSerial}`,x:q.x,y:q.y,seen:foes.filter(e=>this.sight(e,q)).map(e=>e.id)}];m.scrap-=15;fired(this,'eng_mine');this.log(`${who(m)} 埋下一顆絆雷（廢料 −15）。`);}}
   }
  }
 };
}
