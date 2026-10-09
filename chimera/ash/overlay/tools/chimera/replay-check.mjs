// 方案 A 的前提驗證：同一個任務、同一串輸入，重播出來的戰鬥必須和原本一模一樣（每一步的指紋都對得上）。
// 原本那場由一個獨立的機器人當玩家（不放進隊員的機器人表，免得改到隊員機器人的種子），輸入全部記下來；
// 再開一場全新的，照紀錄重播；中途也模擬伺服器重開（從頭重播到一半再接著播）。
// node tools/chimera/replay-check.mjs [--seeds 6] [--boss] [--type ambush] [--big]（--type：服務單類型，例如 ambush 是公路戰；--big：36 名敵人，測增援波次）
import '../clear-bot/lang-default.mjs';
import {SquadGame} from '../../src/chimera-squad.js';
import {installFullSquad} from './full-squad.mjs';
import {ClearBot} from '../clear-bot/bot.mjs';
import {applyEntry,record,fingerprint} from '../../src/chimera-log.js';
const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf(`--${k}`);return i<0?d:args[i+1];},flag=k=>args.includes(`--${k}`);
const seeds=Number(opt('seeds',6)),from=Number(opt('seed-from',1));
const squad=[['A','soldier'],['B','recon'],['C','bulwark'],['D','berserker']].map(([id,cls],i)=>({id,cls,portrait:['ember','onyx','silver','cedar'][i],st:{hp:cls==='berserker'?160:100},lv:3,xp:0,picks:[],skills:[],prep:null}));
const fresh=s=>{const g=new SquadGame({seed:s,faction:s%2?'rebel':'loyalist',...(opt('type','')?{type:opt('type',''),biome:'旱原'}:{}),enemy:{units:flag('big')?{raider:20,raider_heavy:8,trooper:8}:{raider:4,raider_heavy:2,trooper:2},veh:{},boss:flag('boss')?{weapon:'x'}:null},squad});installFullSquad(g);return g;};
let bad=0;const rows=[];
for(let s=from;s<from+seeds;s++){
 const g=fresh(s),log=[],prints=[];
 record(g,(e)=>{log.push(JSON.parse(JSON.stringify(e)));prints.push(fingerprint(g));});   // 經過 JSON（和送到伺服器一樣）
 const leads=new Map(),lead=()=>{let b=leads.get(g.player);if(!b){b=new ClearBot(g,{seed:9000+leads.size});leads.set(g.player,b);}return b;};
 let n=0;while(g.status==='playing'&&n++<3000)lead().step();
 // 重播
 const t0=performance.now(),r=fresh(s);let diverged=-1;
 for(let i=0;i<log.length;i++){applyEntry(r,log[i]);if(fingerprint(r)!==prints[i]){diverged=i;break;}}
 const ms=performance.now()-t0;
 // 伺服器重開：從頭重播到一半，接著播完
 const half=Math.floor(log.length/2),q=fresh(s);for(let i=0;i<half;i++)applyEntry(q,log[i]);let resumed=-1;for(let i=half;i<log.length;i++){applyEntry(q,log[i]);if(fingerprint(q)!==prints[i]){resumed=i;break;}}
 if(diverged>=0||resumed>=0||r.status!==g.status)bad++;
 rows.push({seed:s,status:g.status,turns:g.turn,inputs:log.length,replay:diverged<0?'一致':`第 ${diverged} 筆分岔`,resume:resumed<0?'一致':`第 ${resumed} 筆分岔`,replayMs:Math.round(ms)});
}
console.table(rows);
console.log(bad?`有 ${bad} 場重播對不上`:'全部一致');
process.exit(bad?1:0);
