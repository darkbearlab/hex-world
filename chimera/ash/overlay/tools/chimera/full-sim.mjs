// 可行性驗證：隊友是完整的玩家角色。每位隊員都由機器人操作（被操作的那位當隊長）。
// node tools/chimera/full-sim.mjs [--seeds 6] [--units raider:6,raider_heavy:4,native_hunter:2] [--boss] [--size 4]
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';

const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(`--${k}`);return i<0?d:args[i+1];},flag=k=>args.includes(`--${k}`);
const seeds=Number(opt('seeds',6)),from=Number(opt('seed-from',1)),size=Number(opt('size',4));
const units=Object.fromEntries(opt('units','raider:6,raider_heavy:4,native_hunter:2').split(',').map(x=>{const [k,n]=x.split(':');return [k,Number(n)];}));
const squad=[['A','soldier'],['B','recon'],['C','berserker'],['D','engineer']].slice(0,size).map(([id,cls])=>({id,cls,st:{hp:cls==='berserker'?160:id==='A'&&flag('frail')?20:100,acc:cls==='soldier'?8:cls==='berserker'?-10:0,eva:cls==='recon'?10:0,mel:cls==='berserker'?10:0}}));
const rows=[];let errors=0;const intents={};
for(let s=from;s<from+seeds;s++){
 const g=new SquadGame({seed:s,faction:opt('faction','rebel'),enemy:{units,veh:{},boss:flag('boss')?{weapon:'x'}:null},squad});
 const {bots,botFor}=installFullSquad(g,{onError:m=>{errors++;if(errors<5)console.log(m);}});
 let n=0,handovers=0,last=g.player;
 while(g.status==='playing'&&n++<4000){botFor(g.player).step();if(g.player!==last){handovers++;last=g.player;}}
 for(const b of bots.values())for(const [k,v]of Object.entries(b.stats.intents))intents[k]=(intents[k]||0)+v;
 // 防回歸：還有隊員活著卻判敗，就是交棒壞了（2026-10-08 改視野時不小心刪掉交棒，模擬沒抓到）
 if(g.status==='dead'&&g.living.length){errors++;console.log(`交棒失敗：種子 ${s}，還有 ${g.living.length} 人活著卻判敗`);}
 const r=g.missionResult,byMember=g.members.map(m=>`${m.squadId}:${m.hp}/${m.maxHp} k${m.kills||0}`).join(' ');
 rows.push({seed:s,status:g.status,turns:g.turn,kills:`${r.kills}/${r.total}`,dead:r.dead.join('')||'-',handovers,members:byMember});
}
console.table(rows);
const won=rows.filter(r=>r.status==='won').length,dead=rows.reduce((x,r)=>x+(r.dead==='-'?0:r.dead.length),0);
console.log(`完整玩家角色小隊：勝 ${won}/${rows.length}，陣亡 ${dead}（每場 ${(dead/rows.length).toFixed(2)}），交棒 ${rows.reduce((x,r)=>x+r.handovers,0)}，錯誤 ${errors}`);
console.log('意圖',intents);
