#!/usr/bin/env node
// Clear bot: compare two `run.mjs --json` result files seed by seed (docs/CLEAR_BOT.md). The runs pair up by class,
// faction, difficulty and seed; the table shows wins and average floor per class × faction for both, and how many
// seeds turned from a loss into a win and back — a paired view that is less noisy than two win rates.
//   node tools/clear-bot/compare.mjs before.json after.json [--classes a,b] [--factions a,b]
import {readFileSync} from 'node:fs';
const [a,b,...rest]=process.argv.slice(2);
if(!a||!b){console.log('usage: node tools/clear-bot/compare.mjs before.json after.json [--classes a,b] [--factions a,b]');process.exit(1);}
const opt={};for(let i=0;i<rest.length;i+=2)opt[rest[i].slice(2)]=rest[i+1].split(',');
const load=f=>new Map(JSON.parse(readFileSync(f,'utf8')).results.filter(r=>r.bot&&!r.bot.error).map(r=>[`${r.job.character}|${r.job.faction}|${r.job.difficulty}|${r.job.seed}`,r.bot]));
const A=load(a),B=load(b),rows=new Map();
for(const [k,x] of A){const y=B.get(k);if(!y)continue;const [c,f]=k.split('|');if(opt.classes&&!opt.classes.includes(c)||opt.factions&&!opt.factions.includes(f))continue;
 const r=rows.get(`${c}|${f}`)||{class:c,faction:f,n:0,winA:0,winB:0,floorA:0,floorB:0,gained:0,lost:0};
 r.n++;r.winA+=x.status==='won';r.winB+=y.status==='won';r.floorA+=x.floor;r.floorB+=y.floor;
 if(x.status!=='won'&&y.status==='won')r.gained++;if(x.status==='won'&&y.status!=='won')r.lost++;rows.set(`${c}|${f}`,r);}
const out=[...rows.values()].map(r=>({class:r.class,faction:r.faction,before:`${r.winA}/${r.n}`,after:`${r.winB}/${r.n}`,'floor before':+(r.floorA/r.n).toFixed(1),'floor after':+(r.floorB/r.n).toFixed(1),'loss→win':r.gained,'win→loss':r.lost}));
console.table(out);
const t=[...rows.values()].reduce((s,r)=>({n:s.n+r.n,a:s.a+r.winA,b:s.b+r.winB,g:s.g+r.gained,l:s.l+r.lost,fa:s.fa+r.floorA,fb:s.fb+r.floorB}),{n:0,a:0,b:0,g:0,l:0,fa:0,fb:0});
const causes=m=>{const c={};for(const b of m.values())if(b.status==='dead'){const k=b.cause;c[k]=(c[k]||0)+1;}return Object.entries(c).sort((x,y)=>y[1]-x[1]).slice(0,10).map(([k,v])=>`${k} ${v}`).join(', ');};
const floors=m=>{const c={};for(const b of m.values())if(b.status==='dead')c[b.floor]=(c[b.floor]||0)+1;return JSON.stringify(c);};
const {formatLoadout}=await import('./run.mjs');
for(const [name,m] of [['before',A],['after',B]]){console.log(`${name}: deaths by floor ${floors(m)}; causes ${causes(m)}`);if([...m.values()].some(b=>b.loadout))console.log(`${name}: loadout ${formatLoadout([...m.values()])}`);}
console.log(`total: before ${t.a}/${t.n} (floor ${(t.fa/t.n).toFixed(2)}), after ${t.b}/${t.n} (floor ${(t.fb/t.n).toFixed(2)}), loss→win ${t.g}, win→loss ${t.l}`);
