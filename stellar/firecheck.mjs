// 引導的年代：200 年到「現在」→ 蛇紋之夜 → 30 年後滅世大火 → 再跑 n 年
// 用法：node stellar/firecheck.mjs [種子數] [大火後年數]
import {generate,W,H} from './sim.js';
import {loreCheck} from './lore.js';
const n=+(process.argv[2]||6),yrs=+(process.argv[3]||50),tally={},texts={},soft={};
for(let k=1;k<=n;k++){const sd='已知-'+k,t=Date.now();const w=generate(sd);w.sim.serpentNight(201);w.sim.runMore(30);w.sim.worldFire();w.sim.runMore(yrs);
  const v=w.sim.view();v.land=w.land;const R=loreCheck(v,W,H).filter(r=>r.id.startsWith('g-'));let line=sd.padEnd(6)+' ';
  for(const r of R){tally[r.id]=(tally[r.id]||0)+(r.ok?1:0);texts[r.id]=r.text;soft[r.id]=r.soft;line+=r.ok?'✓':r.soft?'△':'·'}
  const hb=v.fire.hist.map(h=>h.b);console.log(line,`${Date.now()-t}ms 塔亮度 ${Math.min(...hb).toFixed(2)}~${Math.max(...hb).toFixed(2)} 莊園 ${v.fire.manorsAlive} 魁儡 ${v.fire.auto}`);
  if(process.env.DETAIL){for(const r of R)console.log('   ',r.ok?'✓':r.soft?'△':'✗',r.text,'—',r.detail);
    console.log(w.events.filter(e=>e.y>231&&/指引塔|新秩序|魁儡|列羅多斯|雅蘭追爾的商人|索辣拉|莊園/.test(e.text)).slice(0,30).map(e=>'   '+e.y+' '+e.text).join('\n'))}}
console.log('\n引導的年代：設定對照');for(const k in tally)console.log(`${tally[k]}/${n}  ${texts[k]}${soft[k]?'（不成立也可接受）':''}`);
