// 機會統計：node opps.mjs <種子數>：每局在第 100、120、150 年各有幾個機會（依種類、程度），以及有沒有全擠在同一區
const SEEDS=+(process.argv[2]||10);const m=await import('../sim.js');
const KN={exp:'遠征',short:'缺貨',tense:'快開戰',front:'前線',route:'危險商路',lair:'據點'},YS=[100,120,150];
const acc={};for(const y of YS)acc[y]={};
for(let sd=1;sd<=SEEDS;sd++){const w=m.generate('奇美拉-'+sd,{history:false});const sim=w.sim;sim.begin();
  for(let y=1;y<=150;y++){sim.stepYear();if(!YS.includes(y))continue;const O=sim.opportunities(),A=acc[y];
    for(const o of O){const a=A[o.kind]||(A[o.kind]={n:0,l3:0,l2:0});a.n++;if(o.lv===3)a.l3++;if(o.lv===2)a.l2++}
    const q=new Set(O.filter(o=>o.lv>=2).map(o=>{const c=o.tile%m.W,r=Math.floor(o.tile/m.W);return (c<m.W/2?'W':'E')+(r<m.H/2?'N':'S')}));A._quad=(A._quad||0)+q.size;A._tot=(A._tot||0)+O.filter(o=>o.lv>=2).length}}
for(const y of YS){const A=acc[y];console.log(`第 ${y} 年（${SEEDS} 局平均）：程度 2 以上共 ${(A._tot/SEEDS).toFixed(1)} 個，分布在 ${(A._quad/SEEDS).toFixed(1)}／4 個象限`);
  console.log('  '+Object.keys(KN).map(k=>{const a=A[k]||{n:0,l3:0,l2:0};return `${KN[k]} ${(a.n/SEEDS).toFixed(1)}（高 ${(a.l3/SEEDS).toFixed(1)}・中 ${(a.l2/SEEDS).toFixed(1)}）`}).join('｜'))}
