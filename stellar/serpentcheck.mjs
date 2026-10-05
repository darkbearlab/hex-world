// 蛇紋者劇本：先跑 200 年到「現在」，再降下蛇紋之夜，往後跑 n 年
// 用法：node stellar/serpentcheck.mjs [種子數] [年數]
import {generate,W,H,N} from './sim.js';
import {loreCheck} from './lore.js';
const tally={},texts={};
const n=+(process.argv[2]||6),yrs=+(process.argv[3]||40);
const res=[];
for(let k=1;k<=n;k++){const sd='已知-'+k,t=Date.now();const w=generate(sd);w.sim.serpentNight(201);w.sim.runMore(yrs);const v=w.sim.view(),S=v.serp;
  const drop=S.popAt.map((p,i)=>1-S.popNow[i]/Math.max(1,p));
  const r={sd,queen:S.queenDead>=0?S.queenDead:'-',elves:v.econ[12].alive?v.econ[12].tiles+'格':'亡',burned:S.burned,razed:S.razed,maxWars:S.maxWars,
    hawks:S.hawks.map(h=>v.econ[h].n).join('、'),南方人口:Math.round(-drop[2]*100)+'%',中部:Math.round(-drop[1]*100)+'%',北方:Math.round(-drop[0]*100)+'%',
    蛇紋者:S.marked.length+'名/存活'+S.marked.filter(m=>m.alive).length,ms:Date.now()-t};
  res.push(r);v.land=w.land;for(const q of loreCheck(v,W,H).filter(q=>q.id.startsWith('s-'))){tally[q.id]=(tally[q.id]||0)+(q.ok?1:0);texts[q.id]=q.text}
  const top=S.marked.slice().sort((a,b)=>b.kills-a.kills)[0];
  console.log(sd,JSON.stringify(r),top?`｜最兇：${v.econ[top.f].n}的${top.name}（殺 ${top.kills}，${top.alive?'在世':top.end}）`:'');
  if(process.env.DETAIL)console.log(w.events.filter(e=>e.y>200&&/蛇紋|女王|精靈森林|挖了|主戰/.test(e.text)).slice(0,40).map(e=>'   '+e.y+' '+e.text).join('\n'))}
console.log('\n蛇紋者之亂的設定對照：');for(const k in tally)console.log(`${tally[k]}/${n}  ${texts[k]}`);
