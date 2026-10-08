// 快速對照：node clone-quick.mjs <每槽每季產量> <每槽上限> <顧忌倍率> <每名零件>（10 個種子）
const [rate,cap,tb,cp]=process.argv.slice(2).map(Number);globalThis.VAT_RATE=rate;globalThis.VAT_CAP=cap;globalThis.TABOO=tb;if(!isNaN(cp))globalThis.CLONE_PARTS=cp;
const m=await import('../sim.js');
const cls={},gov={rank:0,share:0},tot={food:0,pop:0,fac:0,starv:0};const SEEDS=10;
for(let sd=1;sd<=SEEDS;sd++){globalThis.CSTAT={};const w=m.generate('奇美拉-'+sd);const L=w.sim.legendData(),S=globalThis.CSTAT,K=w.sim.peek();const ack=L.ARC.ackY;
  const c=f=>{const F=L.fac[f];return f===0?'gov':F.free?'free':F.works?'works':F.native?'native':/幫|軍$|團$/.test(F.n)?'warlord':/軍政府|安全委員會|臨時政府|執法委員會/.test(F.n)&&F.born===ack?'radical':'other'};
  for(const f in S){const k=c(+f),o=cls[k]||(cls[k]={st:0,tot:0,b:0,w:0,starv:0});for(const y in S[f]){if(+y<ack)continue;const d=S[f][y];o.st+=d.strClone||0;o.tot+=d.strTot||0;o.b+=d.battles||0;o.w+=d.wins||0;o.starv+=d.starved||0}}
  const P={};let tp=0;for(let i=0;i<K.owner.length;i++)if(K.owner[i]>=0){P[K.owner[i]]=(P[K.owner[i]]||0)+K.pop[i];tp+=K.pop[i]}const al=K.fac.filter(f=>f.alive).sort((a,b)=>(P[b.id]||0)-(P[a.id]||0));
  gov.rank+=(al.findIndex(f=>f.id===0)+1||al.length+1)/SEEDS;gov.share+=(P[0]||0)/tp*100/SEEDS;tot.pop+=tp/SEEDS;tot.fac+=al.length/SEEDS;
  const e=w.snaps[120].econ.filter(e=>e.pop>0);tot.food+=e.reduce((a,b)=>a+b.ratio.food*b.pop,0)/e.reduce((a,b)=>a+b.pop,0)/SEEDS;
  tot.battles=(tot.battles||0)+w.events.filter(e=>/之戰：/.test(e.text)).length/SEEDS;}
console.log(`槽產量 ${rate} 上限 ${cap} 顧忌 ${tb} 零件 ${cp}｜人口 ${Math.round(tot.pop)} 勢力 ${tot.fac.toFixed(1)} 戰鬥 ${Math.round(tot.battles)} 糧滿足 ${tot.food.toFixed(2)}｜總督府 第 ${gov.rank.toFixed(1)} 名 ${gov.share.toFixed(0)}%`);
for(const k of ['gov','radical','other','works','warlord'])if(cls[k])console.log(`   ${k}: 複製兵佔兵力 ${(cls[k].st/Math.max(1,cls[k].tot)*100).toFixed(0)}% 勝率 ${(cls[k].w/Math.max(1,cls[k].b)*100).toFixed(0)}% 餓散 ${Math.round(cls[k].starv/SEEDS)}`);
