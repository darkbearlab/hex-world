// 用法：node stellar/lorecheck.mjs [種子數]
import {generate,W,H} from './sim.js';
import {loreCheck} from './lore.js';
const n=+(process.argv[2]||8),seeds=Array.from({length:n},(_,k)=>'已知-'+(k+1));
const tally={},texts={},soft={};
for(const sd of seeds){const t=Date.now();const w=generate(sd);const v=w.sim.view();v.land=w.land;
  const R=loreCheck(v,W,H);let line=sd.padEnd(6)+' ';for(const r of R){tally[r.id]=(tally[r.id]||0)+(r.ok?1:0);texts[r.id]=r.text;soft[r.id]=r.soft;line+=r.ok?'✓':r.soft?'△':'·'}
  console.log(line,`${Date.now()-t}ms 皇帝:${v.econ[v.emperor].n}`);
  if(process.env.DETAIL)for(const r of R)console.log('   ',r.ok?'✓':'✗',r.text,'—',r.detail)}
console.log('\n各條成立的比例：');for(const k in tally)console.log(`${String(tally[k]).padStart(2)}/${n}  ${texts[k]}${soft[k]?'（不成立也可接受）':''}`);
