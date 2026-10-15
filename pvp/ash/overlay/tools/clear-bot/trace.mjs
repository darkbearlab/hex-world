#!/usr/bin/env node
// Clear bot trace (docs/CLEAR_BOT.md): replays one seed with the bot and prints its decisions, to see why it died or
// stalled. Deterministic: the same seed prints the same lines.
//   node tools/clear-bot/trace.mjs --class soldier --faction loyalist --seed 1 [--difficulty standard]
//        [--from TURN] [--to TURN] [--last N] [--options] [--map]
// --options also lists the scored combat options of each decision in range; --map draws the 15×15 around the bot.
import './lang-default.mjs';   // English by default (docs/CLEAR_BOT.md)
import {playRun} from './play.mjs';
import {combatOptions} from './combat.mjs';
import {SIZE} from '../../src/data.js';

const o={class:'soldier',faction:'loyalist',seed:1,difficulty:'standard',from:0,to:Infinity,last:0,options:false,map:false,max:8000};
const argv=process.argv.slice(2);
for(let i=0;i<argv.length;i++){const a=argv[i],v=()=>argv[++i];
 if(a==='--class')o.class=v();else if(a==='--faction')o.faction=v();else if(a==='--seed')o.seed=Number(v());
 else if(a==='--difficulty')o.difficulty=v();else if(a==='--from')o.from=Number(v());else if(a==='--to')o.to=Number(v());
 else if(a==='--last')o.last=Number(v());else if(a==='--options')o.options=true;else if(a==='--map')o.map=true;else if(a==='--max')o.max=Number(v());}
const lines=[];
const out=text=>{if(o.last){lines.push(text);if(lines.length>o.last*(o.options||o.map?12:1))lines.shift();}else console.log(text);};
function mapLines(bot){
 const g=bot.g,p=g.player,rows=[];
 for(let y=Math.max(0,p.y-7);y<=Math.min(SIZE-1,p.y+7);y++){let r='';for(let x=Math.max(0,p.x-7);x<=Math.min(SIZE-1,p.x+7);x++){
  const e=bot.view.enemies.find(e=>e.x===x&&e.y===y),c=bot.view.civilians.find(e=>e.x===x&&e.y===y),d=bot.view.danger.get(`${x},${y}`);
  r+=p.x===x&&p.y===y?'@':e?(e.boss?'B':e.charge?'!':'e'):c?'c':bot.view.allies.some(a=>a.x===x&&a.y===y)?'&':d?'x':!g.seen[y][x]?' ':g.grid[y][x]!==1?'#':'.';}
  rows.push('   '+r);}
 return rows;
}
const r=playRun({seed:o.seed,character:o.class,faction:o.faction,difficulty:o.difficulty,maxActions:o.max,trace:(bot,intent)=>{
 const g=bot.g,v=bot.view;if(!v||g.turn<o.from||g.turn>o.to)return;
 const en=v.enemies.map(e=>`${e.type}@${e.x},${e.y}h${e.hp}${e.charge?'!':''}${e.disabled?'z':''}`).join(' ');
 out(`T${g.turn} F${g.floor} @${g.player.x},${g.player.y} hp${g.player.hp}+${g.player.plates||0} ${intent.type}${intent.arg!==undefined?' '+JSON.stringify(intent.arg):''} · ${intent.why||''}${bot.plan?` [${bot.plan.kind}→${bot.plan.to?.x},${bot.plan.to?.y}]`:''} | ${en}${v.ghosts.length?` | ghosts ${v.ghosts.map(e=>`${e.type}@${e.x},${e.y}`).join(' ')}`:''}${v.danger.size?` | danger ${[...v.danger.values()].slice(0,6).map(d=>`${d.kind}${d.x},${d.y}t${d.t}`).join(' ')}`:''}`);
 if(o.options&&v.enemies.length){for(const x of combatOptions(v,bot).sort((a,b)=>b.score-a.score).slice(0,6))out(`     ${x.score.toFixed(1).padStart(7)} ${x.type} ${JSON.stringify(x.arg??'')} ${x.why}`);}
 if(o.map)for(const l of mapLines(bot))out(l);
}});
if(o.last)console.log(lines.join('\n'));
delete r.log;delete r.exposure;console.log(JSON.stringify(r));
