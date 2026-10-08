#!/usr/bin/env node
// Clear bot CLI (docs/CLEAR_BOT.md). A dev tool: not part of `npm test` or any baseline.
//   node tools/clear-bot/run.mjs [--classes a,b] [--factions loyalist,rebel,swarm] [--difficulty easy|standard|hard]
//        [--mission extraction] [--seeds N] [--seed-from K] [--parallel P] [--log dir] [--no-compare]
//        [--max-actions N] [--json file] [--map-known]
// Plays full runs per class × faction × seed with the clear bot, and the same seeds with tools/balance.mjs `play`, and
// prints win rate, floor reached, turns, kills, lowest HP and what killed it, plus the bot's exposure profile.
// --log dir writes each clear-bot run as a replay log (src/replay.js), playable in the game's test-mode replayer.
import './lang-default.mjs';   // English by default (docs/CLEAR_BOT.md)
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {addSummary,formatProfile} from './measure.mjs';

export const ALL_CLASSES=['soldier','recon','engineer','druid','necromancer','bulwark','berserker','ninja'];
export const REAL_FACTIONS=['loyalist','rebel','swarm'];

function parse(argv){
 const o={classes:ALL_CLASSES,factions:REAL_FACTIONS,difficulty:'standard',mission:'extraction',seeds:8,seedFrom:1,parallel:Math.max(1,Math.min(availableParallelism()-1,12)),log:null,compare:true,maxActions:8000,json:null,mapKnown:false,balanceActions:4000};
 for(let i=0;i<argv.length;i++){
  const a=argv[i],v=()=>argv[++i];
  if(a==='--classes')o.classes=v().split(',');else if(a==='--factions')o.factions=v().split(',');
  else if(a==='--difficulty')o.difficulty=v();else if(a==='--mission')o.mission=v();
  else if(a==='--seeds')o.seeds=Number(v());else if(a==='--seed-from')o.seedFrom=Number(v());
  else if(a==='--parallel')o.parallel=Number(v());else if(a==='--log')o.log=v();
  else if(a==='--no-compare')o.compare=false;else if(a==='--max-actions')o.maxActions=Number(v());
  else if(a==='--balance-actions')o.balanceActions=Number(v());
  else if(a==='--json')o.json=v();else if(a==='--map-known')o.mapKnown=true;
  else if(a==='--help'||a==='-h'){console.log(fileURLToPath(import.meta.url));process.exit(0);}
  else throw new Error(`unknown option ${a}`);
 }
 return o;
}

// ---- worker: plays the jobs it is handed ----------------------------------------------------------------------------
async function workerMain(){
 const {playRun}=await import('./play.mjs');
 const {play}=await import('../balance.mjs');
 const {Game}=await import('../../src/game.js');
 parentPort.on('message',job=>{
  if(!job){process.exit(0);}
  const out={job};
  try{
   const r=playRun({seed:job.seed,character:job.character,faction:job.faction,difficulty:job.difficulty,mission:job.mission,maxActions:job.maxActions,log:Boolean(job.log),options:{mapKnown:job.mapKnown}});
   if(job.log&&r.log){mkdirSync(job.log,{recursive:true});writeFileSync(join(job.log,`clear-bot-${job.character}-${job.faction}-${job.difficulty}-${job.seed}-${r.status}.json`),JSON.stringify(r.log));}
   delete r.log;out.bot=r;
  }catch(error){out.bot={error:String(error?.stack||error)};}
  if(job.compare){
   try{
    const {seed,character,faction,difficulty,mission}=job;
    class Wrapped{constructor(){return new Game(seed,[],0,character,'onyx',mission,{facilityFaction:faction,difficulty,realMode:false});}}
    const r=play(seed,job.balanceActions,character,Wrapped);
    out.balance={status:r.status,floor:r.floor,turn:r.turn,kills:r.kills,hp:r.hp};
   }catch(error){out.balance={error:String(error?.message||error)};}
  }
  parentPort.postMessage(out);
 });
}

// ---- main: hands out jobs and prints the tables ----------------------------------------------------------------------
async function main(){
 const o=parse(process.argv.slice(2));
 const jobs=[];
 for(const character of o.classes)for(const faction of o.factions)for(let s=0;s<o.seeds;s++)
  jobs.push({seed:o.seedFrom+s,character,faction,difficulty:o.difficulty,mission:o.mission,maxActions:o.maxActions,log:o.log,compare:o.compare,mapKnown:o.mapKnown,balanceActions:o.balanceActions});
 const results=[],started=Date.now();let next=0,done=0;
 const workers=Array.from({length:Math.min(o.parallel,jobs.length)},()=>new Worker(fileURLToPath(import.meta.url),{workerData:{worker:true}}));
 await new Promise((resolve,reject)=>{
  const feed=w=>{if(next<jobs.length)w.postMessage(jobs[next++]);else w.postMessage(null);};
  for(const w of workers){
   w.on('message',m=>{results.push(m);done++;if(process.stderr.isTTY)process.stderr.write(`\r${done}/${jobs.length} `);feed(w);if(done===jobs.length)resolve();});
   w.on('error',reject);feed(w);
  }
 });
 if(process.stderr.isTTY)process.stderr.write('\n');
 report(o,results,Date.now()-started);
 if(o.json)writeFileSync(o.json,JSON.stringify({options:o,results},null,1));
}

const mean=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
export function report(o,results,ms){
 const rows=[],causes=new Map(),profile={},bad=results.filter(r=>r.bot?.error);
 for(const r of bad)console.log('ERROR',JSON.stringify(r.job),r.bot.error.split('\n').slice(0,4).join(' | '));
 for(const character of o.classes)for(const faction of o.factions){
  const set=results.filter(r=>r.job.character===character&&r.job.faction===faction&&r.bot&&!r.bot.error);
  if(!set.length)continue;
  const b=set.map(r=>r.bot),wins=b.filter(r=>r.status==='won');
  const deaths=b.filter(r=>r.status==='dead').map(r=>`${r.cause}@F${r.floor}`);
  for(const r of b.filter(r=>r.status==='dead'))causes.set(`${r.cause}`,(causes.get(`${r.cause}`)||0)+1);
  for(const r of b)addSummary(profile,r.exposure);
  const top=Object.entries(deaths.reduce((m,d)=>(m[d]=(m[d]||0)+1,m),{})).sort((x,y)=>y[1]-x[1]).slice(0,3).map(([d,n])=>`${d}${n>1?`×${n}`:''}`).join(', ');
  const bal=set.map(r=>r.balance).filter(x=>x&&!x.error);
  rows.push({class:character,faction,win:`${wins.length}/${b.length}`,floor:+mean(b.map(r=>r.floor)).toFixed(1),turns:Math.round(mean((wins.length?wins:b).map(r=>r.turn))),
   kills:Math.round(mean(b.map(r=>r.kills))),lowestHp:Math.round(mean(b.map(r=>r.lowest))),stalled:b.filter(r=>r.status==='playing').length,deaths:top||'-',
   ...(o.compare?{'balance win':`${bal.filter(x=>x.status==='won').length}/${bal.length}`,'balance floor':+mean(bal.map(x=>x.floor)).toFixed(1)}:{})});
 }
 console.log(`clear bot · ${o.difficulty} · ${o.mission} · seeds ${o.seedFrom}-${o.seedFrom+o.seeds-1} · ${results.length} runs · ${(ms/1000).toFixed(0)} s`);
 console.table(rows);
 const all=results.filter(r=>r.bot&&!r.bot.error).map(r=>r.bot),balAll=results.map(r=>r.balance).filter(x=>x&&!x.error);
 console.log(`total: clear bot ${all.filter(r=>r.status==='won').length}/${all.length} won, avg floor ${mean(all.map(r=>r.floor)).toFixed(2)}${o.compare?` · balance.mjs ${balAll.filter(x=>x.status==='won').length}/${balAll.length} won, avg floor ${mean(balAll.map(x=>x.floor)).toFixed(2)}`:''}`);
 console.log('death causes:',[...causes].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([c,n])=>`${c} ${n}`).join(', ')||'-');
 const byFloor={};for(const r of all.filter(r=>r.status==='dead'))byFloor[r.floor]=(byFloor[r.floor]||0)+1;
 console.log('deaths by floor:',JSON.stringify(byFloor));
 console.log('exposure profile:',formatProfile(profile));
 console.log('loadout:',formatLoadout(all));
}
// Round 2: the pack's roles on arriving at floors 3 and 6, weapon pickups per run, and the boss fights (could the pack
// hurt the boss; share of shots at it taken with the best weapon for it).
export function formatLoadout(runs){
 const pct=(n,d)=>d?`${Math.round(100*n/d)}%`:'-';
 const at=f=>{const r=runs.filter(x=>x.loadout?.roles?.[f]);return `F${f} (${r.length} runs) anti-armour ${pct(r.filter(x=>x.loadout.roles[f].antiArmor).length,r.length)}, anti-flesh ${pct(r.filter(x=>x.loadout.roles[f].antiFlesh).length,r.length)}, long ${pct(r.filter(x=>x.loadout.roles[f].long).length,r.length)}`;};
 const w=k=>(runs.reduce((a,x)=>a+(x.weapons?.[k]||0),0)/Math.max(1,runs.length)).toFixed(2);
 const bosses=runs.flatMap(x=>Object.values(x.loadout?.bosses||{}));const armored=bosses.filter(b=>b.armor>=5);
 const shots=bosses.reduce((a,b)=>a+b.shots,0),best=bosses.reduce((a,b)=>a+b.bestShots,0),aShots=armored.reduce((a,b)=>a+b.shots,0),aBest=armored.reduce((a,b)=>a+b.bestShots,0);
 return `${at(3)} | ${at(6)} | per run: take ${w('take')}, swap ${w('replace')}, scrap ${w('scrapGround')} | boss fights ${bosses.length}: pack can hurt ${pct(bosses.filter(b=>b.canHurt).length,bosses.length)}, shots with the best weapon ${pct(best,shots)}; armour 5+: ${armored.length} fights, can hurt ${pct(armored.filter(b=>b.canHurt).length,armored.length)}, best-weapon shots ${pct(aBest,aShots)}`;
}

const direct=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(!isMainThread)workerMain();else if(direct)main().catch(e=>{console.error(e);process.exit(1);});
