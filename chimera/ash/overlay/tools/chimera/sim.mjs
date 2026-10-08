// 奇美拉任務戰鬥的無頭模擬：機器人當隊長，三名隊友用 SquadBot（--plain 改用 ASH 原本的友軍 AI）。
// node tools/chimera/sim.mjs [--seeds 8] [--plain] [--units raider:5,raider_heavy:2] [--boss] [--faction rebel] [--trace]
import '../clear-bot/lang-default.mjs';
import {MissionGame} from '../../src/chimera-mission.js';
import {ClearBot} from '../clear-bot/bot.mjs';
import {installSquadBrain} from './squad.mjs';

const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(`--${k}`);return i<0?d:args[i+1];},flag=k=>args.includes(`--${k}`);
const seeds=Number(opt('seeds',8)),from=Number(opt('seed-from',1)),plain=flag('plain'),maxActions=Number(opt('max-actions',3000));
const units=Object.fromEntries(opt('units','raider:5,raider_heavy:2').split(',').map(x=>{const [k,n]=x.split(':');return [k,Number(n)];}));
const squad=[['A','soldier'],['B','recon'],['C','berserker'],['D','engineer']].map(([id,cls])=>({id,cls,st:{hp:cls==='berserker'?160:100,acc:cls==='soldier'?8:cls==='berserker'?-10:0,eva:cls==='recon'?10:0,mel:cls==='berserker'?10:0}}));
const rows=[],intents={};let errors=0;
for(let s=from;s<from+seeds;s++){
 const g=new MissionGame({seed:s,faction:opt('faction','rebel'),enemy:{units,veh:{},boss:flag('boss')?{weapon:'x'}:null},squad});
 const bots=plain?null:installSquadBrain(g,{trace:m=>{errors++;if(flag('trace'))console.log(m);}});
 const lead=new ClearBot(g,{seed:s});let n=0;
 while(g.status==='playing'&&n++<maxActions)lead.step();
 for(const b of bots?.values()||[])for(const [k,v]of Object.entries(b.stats.intents))intents[k]=(intents[k]||0)+v;
 const r=g.missionResult,allyShots=g.allies.reduce((x,a)=>x+(a.hp>0?1:0),0);
 rows.push({seed:s,status:g.status,turns:g.turn,kills:`${r.kills}/${r.total}`,dead:r.dead.join('')||'-',alliesAlive:allyShots,leaderHp:g.player.hp});
}
console.table(rows);
const won=rows.filter(r=>r.status==='won').length,dead=rows.reduce((x,r)=>x+(r.dead==='-'?0:r.dead.length),0),kills=rows.reduce((x,r)=>x+Number(r.kills.split('/')[0]),0);
console.log(`${plain?'ASH 友軍 AI':'SquadBot'}：勝 ${won}/${rows.length}，陣亡 ${dead}（每場 ${(dead/rows.length).toFixed(2)}），擊殺 ${kills}（每場 ${(kills/rows.length).toFixed(1)}）`);
if(!plain)console.log('隊友意圖',intents,'錯誤',errors);
