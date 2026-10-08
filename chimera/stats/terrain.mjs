// 地形與戰壕對照：node terrain.mjs <戰壕 0|1> <種子數> [炸藥車 0|1，預設 1]
const TR=+process.argv[2],SEEDS=+(process.argv[3]||10),BM=process.argv[4]===undefined?1:+process.argv[4];globalThis.TRENCH=TR?1:0;globalThis.BOMB=BM;
const m=await import('../sim.js');
const all=[];const ev={stale:0,lost:0,cede:0,wars:0};
for(let sd=1;sd<=SEEDS;sd++){globalThis.BSTAT=[];const w=m.generate('奇美拉-'+sd);all.push(...globalThis.BSTAT);
  for(const e of w.events){if(/開戰。/.test(e.text))ev.wars++;if(/各自收兵|撤兵求和|得不償失/.test(e.text))ev.stale++;if(/承認失去|割地求和|讓出/.test(e.text))ev.cede++;}}
const cls=r=>r.town?'城鎮':[5,7,8].includes(r.b)?'開闊地':r.b===4?'礫丘':'崎嶇地';
const g={};for(const r of all){const k=cls(r);(g[k]||(g[k]=[])).push(r)}
const avg=(a,f)=>a.reduce((x,r)=>x+f(r),0)/Math.max(1,a.length);
console.log(`戰壕 ${TR?'開':'關'} 炸藥車 ${BM?'開':'關'}｜${SEEDS} 個種子共 ${all.length} 場戰鬥（每局 ${Math.round(all.length/SEEDS)}）｜開戰 ${Math.round(ev.wars/SEEDS)}、打不下來收兵 ${Math.round(ev.stale/SEEDS)}、割地 ${Math.round(ev.cede/SEEDS)}（每局）`);
for(const k of ['開闊地','礫丘','崎嶇地','城鎮']){const a=g[k];if(!a)continue;
  console.log(`  ${k}：${a.length} 場（${Math.round(a.length/all.length*100)}%）｜攻方勝 ${Math.round(avg(a,r=>r.aw)*100)}%｜奪下 ${Math.round(avg(a,r=>r.took)*100)}%｜攻方載具佔 ${Math.round(avg(a,r=>r.vA)*100)}% 守方 ${Math.round(avg(a,r=>r.vD)*100)}%｜複製兵 攻 ${Math.round(avg(a,r=>r.cA)*100)}% 守 ${Math.round(avg(a,r=>r.cD)*100)}%｜陣亡 ${Math.round(avg(a,r=>r.dead))}｜戰壕 ${avg(a,r=>r.tr).toFixed(2)}→${avg(a,r=>r.tr2??r.tr).toFixed(2)}｜炸藥車 ${avg(a,r=>r.bombs||0).toFixed(1)} 成功 ${avg(a,r=>r.boomOk||0).toFixed(1)}`)}
