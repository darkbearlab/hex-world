// 複製兵統計：node clone-stat.mjs <顧忌倍率> <種子數> > s<倍率>.json（每年、每個勢力記下造兵、養兵、戰死、兵力組成）
const TB=+process.argv[2],SEEDS=+(process.argv[3]||12);globalThis.TABOO=TB;
const m=await import('../sim.js');
const out=[];
for(let sd=1;sd<=SEEDS;sd++){globalThis.CSTAT={};const w=m.generate('奇美拉-'+sd);const L=w.sim.legendData(),S=globalThis.CSTAT;
  const ack=L.ARC.ackY,bloc=L.ARC.blocY,cls=f=>{const F=L.fac[f];return f===0?'gov':F.free?'free':F.works?'works':F.native?'native':/幫|軍$|團$/.test(F.n)?'warlord':/軍政府|安全委員會|臨時政府|執法委員會/.test(F.n)&&F.born===ack?'radical':'other'};
  out.push({sd,ack,bloc,S,cls,fac:L.fac.map(f=>({n:f.n,alive:f.alive}))});}
process.stdout.write(JSON.stringify(out.map(o=>({sd:o.sd,ack:o.ack,bloc:o.bloc,S:o.S,cls:Object.fromEntries(Object.keys(o.S).map(f=>[f,o.cls(+f)])),alive:o.fac.map(f=>f.alive)}))));
