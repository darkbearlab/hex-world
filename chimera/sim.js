// 奇美拉：被企業遺棄的荒漠星球。六角世界模擬核心（從 continent 分支的大陸沙盒改寫）

// 地圖倍率 MK（1 = 舊的 30×24）、拓殖半徑 COLR（墾民只往離自家市鎮幾格內開墾；99 = 不限）
const MK=globalThis.MAPK??2,COLR=globalThis.COLR??3,W=Math.round(30*MK),H=Math.round(24*MK),N=W*H,YEARS=globalThis.YEARS??150;   // 開服前推演的年數：斷鏈、崩塌、陣營成形之後玩家進場

/* ---------- 亂數與雜訊 ---------- */
function mulberry32(a){const f=function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};f.state=()=>a;f.setState=v=>{a=v};return f}
function strSeed(s){let h=2166136261;for(const ch of s){h^=ch.codePointAt(0);h=Math.imul(h,16777619)}return h>>>0}
function h2(x,y,s){let n=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(s,982451653))|0;n=Math.imul(n^(n>>>13),1274126177);n^=n>>>16;return(n>>>0)/4294967296}
function vnoise(x,y,s){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=h2(xi,yi,s),b=h2(xi+1,yi,s),c=h2(xi,yi+1,s),d=h2(xi+1,yi+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
function fbm(x,y,s){let t=0,amp=1,f=1,nm=0;for(let o=0;o<5;o++){t+=vnoise(x*f,y*f,s+o*101)*amp;nm+=amp;amp*=.5;f*=2}return t/nm}

/* ---------- 六角格幾何（奇數列右移） ---------- */
const col=i=>i%W,row=i=>Math.floor(i/W),idx=(c,r)=>r*W+c;
const DEV=[[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]],DODD=[[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]];
const NBR=[];for(let i=0;i<N;i++){const c=col(i),r=row(i),d=(r&1)?DODD:DEV,l=[];for(const[dc,dr]of d){const cc=c+dc,rr=r+dr;if(cc>=0&&cc<W&&rr>=0&&rr<H)l.push(idx(cc,rr))}NBR.push(l)}
function cube(i){const c=col(i),r=row(i),x=c-(r-(r&1))/2;return[x,-x-r,r]}
function hdist(a,b){const A=cube(a),B=cube(b);return Math.max(Math.abs(A[0]-B[0]),Math.abs(A[1]-B[1]),Math.abs(A[2]-B[2]))}

/* ---------- 資料表 ---------- */
const BIOMES=[
 {n:'鹼海',c:'#34474c',f:0,res:99},{n:'鹼灘',c:'#56696a',f:0,res:99},
 {n:'斷崖',c:'#d9cdb8',f:0,res:4},{n:'岩山',c:'#7d6b5d',f:.12,res:3},
 {n:'礫丘',c:'#a78f68',f:.5,res:1.8},{n:'寒漠',c:'#a9a79c',f:.25,res:1.4},
 {n:'油棘林',c:'#6a7440',f:.7,res:1.6},{n:'旱原',c:'#b3a466',f:1,res:1},
 {n:'沙海',c:'#dcc28c',f:.15,res:1.3},{n:'鹽沼',c:'#76857a',f:.4,res:2}];
const SUF={2:['崖','壁'],3:['岩','礦','坑'],4:['丘','坡','礫'],5:['坪','原'],6:['棘林','林'],7:['原','站','集','井'],8:['沙','漠','磧'],9:['沼','灘','窪']};
const PRE='黑白赤灰鏽鐵銅沙鹼礫焦枯斷舊殘空孤長遠深荒乾裂暗燼骨鉛鈷碳'.split('');
const FDEF=[{n:'總督府',c:'#c9b458'}];   // 開局只有企業留下的總督府
// 人名：「名 姓」，家族看姓（hs）
const SUR=['Arlen','Brandt','Castell','Drago','Ekwe','Ferro','Galt','Hollis','Ione','Jaeger','Kovac','Lund','Mercer','Novak','Orsi','Pike','Quill','Rusk','Strand','Tamsin','Ueda','Voss','Weller','Yusuf','Zane'],
  GIV=['Rek','Dov','Nai','Cors','Fen','Gorm','Vat','Ilse','Mara','Tov','Kes','Ada','Bram','Lio','Sun','Rho','Juno','Ezra','Hal','Ines','Oto','Pell','Yara','Zek','Cato','Wren','Ivo','Mika','Sef','Teo','Ansa','Bek','Odo','Lena'];
const hs=h=>h&&h.name?(h.name.split(' ')[1]||h.name):'';
// 勢力欄位：前五個是開局的勢力，後面是預留給自立的新國家（顏色固定，名字到時再取）
const FMAX=24,RESERVE_C=['#d0503f','#5d9fd6','#a272cc','#35b3a1','#e0843a','#86b04f','#c86aa6','#4d8f9c','#b9a27c','#e06fa0','#7aa0ff','#c0c060','#60c0a0','#d08850','#9a7ad0','#e2c25a','#5fb0d8','#b05a5a','#8fd18f','#c79bd8','#d8a07a','#7ab8a8','#a8a8d8'],STATE_SUF=['軍政府','自治區','保安區','公社','管區'];
const FM=f=>Array.from({length:FMAX},f);
const GAMEK={3:10,4:30,5:25,6:60,7:40,8:6,9:30},TIMBK={3:6,4:25,5:10,6:100,7:8,9:40};

/* ---------- 世界生成 ---------- */
function generate(seedStr,{history=true}={}){
  const seed=strSeed(seedStr),rand=mulberry32(seed),s=seed%100000;
  const pick=a=>a[Math.floor(rand()*a.length)];
  const elev=new Float32Array(N),temp=new Float32Array(N),rain=new Float32Array(N),biome=new Uint8Array(N);
  const HH=H*.866;
  for(let i=0;i<N;i++){const px=col(i)+(row(i)&1)*.5,py=row(i)*.866;
    const dx=(px/W-.5)*2,dy=(py/HH-.5)*2;
    elev[i]=fbm(px*.17/MK,py*.17/MK,s)*1.1-(dx*dx+dy*dy)*.5;}
    {const ord=[...elev.keys()].sort((a,b)=>elev[a]-elev[b]);ord.forEach((i,k)=>elev[i]=k/(N-1))}
  const SEA=globalThis.SEA??.24,land=i=>elev[i]>=SEA;
  for(let i=0;i<N;i++){const py=row(i)*.866;
    temp[i]=.15+.8*(py/HH)-Math.max(0,elev[i]-.7)*.6+(fbm(col(i)*.3/MK,row(i)*.3/MK,s+7)-.5)*.2}
  // 由西向東的濕氣：越過山脈後變乾（雨影）
  for(let r=0;r<H;r++){let m=.9;for(let c=0;c<W;c++){const i=idx(c,r);
    if(!land(i)){m=Math.min(1,m+.12/MK);rain[i]=m;continue}
    rain[i]=m*(.55+.45*fbm(c*.25/MK,r*.25/MK,s+13))*(globalThis.DRY??.85);m*=Math.pow(elev[i]>.88?.5:.95,1/MK)}}
  for(let i=0;i<N;i++){const e=elev[i];let b;
    if(e<SEA-.07)b=0;else if(e<SEA)b=1;else if(e>.965)b=2;else if(e>.89)b=3;else if(e>.78)b=4;
    else if(temp[i]<.24)b=5;else if(e<.46&&rain[i]>.6)b=9;else if(rain[i]>.5)b=6;else if(rain[i]<.24&&temp[i]>.55)b=8;else b=7;
    biome[i]=b}
  // 河流：從高處沿最陡方向流向海
  const river=new Uint8Array(N),riverPaths=[];
  const springs=[];for(let i=0;i<N;i++)if(elev[i]>.82&&rain[i]>.3&&biome[i]!==2)springs.push(i);
  for(let k=0;k<Math.round(9*MK*MK)&&springs.length;k++){let cur=springs.splice(Math.floor(rand()*springs.length),1)[0];const path=[cur];
    for(let step=0;step<40*MK;step++){let best=-1,be=elev[cur];for(const n of NBR[cur])if(elev[n]<be){be=elev[n];best=n}
      if(best<0)break;path.push(best);cur=best;if(!land(cur))break}
    if(path.length>3){riverPaths.push(path);for(const p of path)if(land(p))river[p]=1}}
  const fert=new Float32Array(N),res=new Float32Array(N);
  for(let i=0;i<N;i++){fert[i]=Math.min(1.3,BIOMES[biome[i]].f+(river[i]?.35:0));res[i]=BIOMES[biome[i]].res}
  // 地名
  const names=new Array(N).fill(''),used=new Set();
  for(let i=0;i<N;i++){if(!land(i))continue;let nm,t=0;
    do{nm=pick(PRE)+pick(SUF[biome[i]]);t++}while(used.has(nm)&&t<12);
    for(let k=0;used.has(nm)&&k<30;k++){const a=pick(PRE);let b=pick(PRE);while(b===a)b=pick(PRE);nm=a+b+pick(SUF[biome[i]])}used.add(nm);names[i]=nm}
  // 天然資源：地下水、燃料林（油棘）、獵物、舊礦坑（拆零件的地方）
  const coast=new Uint8Array(N),water=new Float32Array(N),timberK=new Float32Array(N),gameK=new Float32Array(N),waterK=new Float32Array(N),vein0=new Float32Array(N);
  for(let i=0;i<N;i++){if(!land(i))continue;const b=biome[i];if(NBR[i].some(n=>!land(n)))coast[i]=1;
    water[i]=Math.min(1.2,rain[i]*.9+(river[i]?.4:0)+(coast[i]?.1:0));
    timberK[i]=(TIMBK[b]||0)*(.7+.6*rain[i]);gameK[i]=(GAMEK[b]||0)*(.8+.4*rand());waterK[i]=Math.min(1.3,.15+rain[i]*.7+(river[i]?.6:0)+(b===9?.3:0))}   // 深井到處都打得出一點水
  const vc=[];for(let i=0;i<N;i++)if(biome[i]===3||biome[i]===4)vc.push(i);
  const veins=[];for(let t=0;t<300&&veins.length<16&&vc.length;t++){const c=vc[Math.floor(rand()*vc.length)];if(veins.every(v=>hdist(v,c)>=2)){veins.push(c);vein0[c]=250+rand()*650}}
  const w={elev,temp,rain,biome,river,riverPaths,fert,res,names,coast,water,timberK,gameK,waterK,vein0,land:Array.from({length:N},(_,i)=>land(i))};
  const sim=createSim(w,rand,pick);w.sim=sim;if(history)sim.runHistory();return w;
}

/* ---------- 歷史模擬 ---------- */
// 貨物：糧、水、燃料（油棘榨的油）、廢料（拆舊時代的東西）、零件（舊礦坑與廢料加燃料做出來的）、彈藥（零件加燃料）
const GOODS=['food','water','fuel','scrap','parts','ammo'],GN={food:'糧',water:'水',fuel:'燃料',scrap:'廢料',parts:'零件',ammo:'彈藥'};
const WEIGHT={food:1,water:1.4,fuel:1.1,scrap:1.6,parts:.45,ammo:.6};      // 每格運輸損耗的倍率：重貨運不遠
const BASEP={food:1,water:1.2,fuel:1.5,scrap:2,parts:8,ammo:6};             // 基準價
const SEASON=['涼季','熱季','收季','寒季'];
const HARVEST=[.1,.35,.55,0],WATERS=[.3,.2,.25,.3];
// 零件：精煉一份零件要燒 CHAR 份燃料；平民用零件隨價格伸縮，舊零件有一部分拆了重用
// 載具：停在城裡的車庫（市集的 veh），城被攻下就被搶。卡車管物流；武裝車是主力；衝鋒車便宜、打一仗就耗掉一大半；戰鬥卡車儲油、送油、廣播，多合一
const VEH=['truck','armor','rush','gt','bomb'],VN={truck:'卡車',armor:'武裝車',rush:'衝鋒車',gt:'戰鬥卡車',bomb:'炸藥車'};   // 炸藥車＝綁了炸藥的衝鋒車
const VCOST={truck:1,armor:3,rush:.5,gt:2},VPOW={truck:0,armor:30,rush:3,gt:4,bomb:3},VFUEL={truck:.2,armor:3,rush:.2,gt:.5,bomb:.2},VKEEP={truck:.2,armor:1.5,rush:0,gt:.3,bomb:0};   // 武裝車像虎王：很能打，但出一趟門燒的油、平常要的零件都很兇
// 開闊地（旱原、沙海、寒漠、礫丘）載具好用；岩山、油棘林、鹽沼幾乎開不進去
const VTERR=[0,0,0,.25,.8,1,.3,1,1,.25];
// 培養槽：每座槽每季最多養 VAT_RATE 名複製兵，最多存 VAT_CAP 名；每名要糧、水、零件，之後每季還要吃喝
const VAT_RATE=globalThis.VAT_RATE??12,VAT_CAP=globalThis.VAT_CAP??120,CLONE_COST={food:1,water:1,parts:globalThis.CLONE_PARTS??.03},CLONE_KEEP=.25;
const CHAR=3,IRON_CIV=.0015,IRON_SUB=1.5,IRON_RECYCLE=.3,WOODRATE=.04,WILDCUT=.15,HARDY=.5,FIREWOOD=.006,WATER_NEED=.04,WATER_PROD=.09;
// 移動成本：鹼海、鹼灘、斷崖、岩山、礫丘、寒漠、油棘林、旱原、沙海、鹽沼
const MOVE=[1.1,.8,Infinity,5,2.5,2,2,1,2.5,3];
class Heap{constructor(n){this.k=new Float64Array(n);this.v=new Int32Array(n);this.size=0}
  push(key,val){let i=this.size++;const k=this.k,v=this.v;while(i>0){const p=(i-1)>>1;if(k[p]<=key)break;k[i]=k[p];v[i]=v[p];i=p}k[i]=key;v[i]=val}
  pop(){const k=this.k,v=this.v,rk=k[0],rv=v[0],n=--this.size,lk=k[n],lv=v[n];let i=0;
    for(;;){let c=2*i+1;if(c>=n)break;if(c+1<n&&k[c+1]<k[c])c++;if(k[c]>=lk)break;k[i]=k[c];v[i]=v[c];i=c}
    if(n>0){k[i]=lk;v[i]=lv}this.pk=rk;return rv}}
function createSim(w,rand,pick){
  const {land,res,names,temp,waterK,river}=w;
  const biome=w.biome.slice(),fert=w.fert.slice(),timberK=w.timberK.slice(),gameK=w.gameK.slice();
  const timber=Float32Array.from(timberK),game=Float32Array.from(gameK),vein=Float32Array.from(w.vein0);
  const known=new Uint8Array(N),deforest=new Uint16Array(N),wall=new Float32Array(N),trench=new Float32Array(N),vcap=Float32Array.from(w.vein0),vex=Uint8Array.from(w.vein0,v=>v>0?1:0);
  const owner=new Int8Array(N).fill(-1),pop=new Float32Array(N),bandit=new Float32Array(N),ruin=new Uint8Array(N),peak=new Float32Array(N);
  const zero=()=>({food:0,water:0,fuel:0,scrap:0,parts:0,ammo:0}),one=()=>({food:1,water:1,fuel:1,scrap:1,parts:1,ammo:1});
  const fac=FDEF.map((d,i)=>({...d,taboo:.85,id:i,alive:true,cap:-1,aggr:.8+rand()*.6,stock:{food:60,water:30,fuel:10,parts:4,scrap:10,ammo:6},
    ratio:one(),price:one(),prod:zero(),loss:0,pop:0,cold:0,fronts:0,frontsPrev:0,famineCD:0,woodCD:0,winterFood:1,merc:0,shock:0,crisis:-1,born:0,liege:-1,loyal:1,lsince:0,diedY:-99}));
  for(let k=FDEF.length;k<FMAX;k++)fac.push({n:'',c:RESERVE_C[k-FDEF.length],id:k,alive:false,cap:-1,aggr:1,stock:zero(),ratio:one(),price:one(),prod:zero(),loss:0,pop:0,cold:0,
    fronts:0,frontsPrev:0,famineCD:0,woodCD:0,winterFood:1,merc:0,shock:0,crisis:-1,born:-1,diedY:-99,liege:-1,loyal:1,lsince:0});
  const ev=[],graves=[],heroes=[],snaps=[],routeSeen={};
  const nm=i=>names[i]||'無名之地';
  let live=false,curY=0,T=0;
  const say=(y,type,text,tile=-1)=>{const e={y,type,text,tile};if(live)e.ts=stamp();ev.push(e);return e};
  const tileCost=(i,n)=>{let c=MOVE[biome[n]];if(land[n]&&river[n])c*=.6;if(land[i]!==land[n])c+=2;return c};
  const winterExtra=n=>{const b=biome[n];return b===3||b===5?1:b<2?.5:.2};  // 冬季額外成本倍率
  const HEAP=new Heap(N*7),CE=new Float32Array(N);
  function dijkstra(src,blocked,maxD=Infinity){const dist=new Float64Array(N).fill(Infinity),prev=new Int16Array(N).fill(-1),h=HEAP;h.size=0;
    dist[src]=0;h.push(0,src);
    while(h.size){const i=h.pop(),d=h.pk;if(d>dist[i])continue;const nb=NBR[i],li=land[i];
      for(let e=0;e<nb.length;e++){const n=nb[e];if(blocked&&blocked[n])continue;let c=CE[n];if(c===Infinity)continue;if(li!==land[n])c+=2;const nd=d+c;if(nd<dist[n]&&nd<=maxD){dist[n]=nd;prev[n]=i;h.push(nd,n)}}}
    return {dist,prev,wd:null}}
  const pathTo=(D,t)=>{const p=[];for(let c=t;c>=0;c=D.prev[c])p.push(c);return p.reverse()};
  // 首都：肥沃且彼此遠離
  const cands=[];for(let i=0;i<N;i++)if(land[i]&&fert[i]>=.7)cands.push(i);
  if(cands.length<FDEF.length)for(let i=0;i<N;i++)if(land[i]&&fert[i]>.1&&!cands.includes(i))cands.push(i);
  const chosen=[];
  for(const f of fac.slice(0,FDEF.length)){let best=-1,bd=-1;for(let k=0;k<160;k++){const c=cands[Math.floor(rand()*cands.length)];if(chosen.includes(c))continue;
      const d=chosen.length?Math.min(...chosen.map(x=>hdist(x,c))):99;if(d>bd){bd=d;best=c}}
    if(best<0){f.alive=false;continue}
    chosen.push(best);owner[best]=f.id;pop[best]=50;peak[best]=50;f.cap=best;
    say(0,'found',`${f.n}在${nm(best)}立城。`,best)}
  // ===== 聚落與市場 =====
  // town[i]=1 表示這格是市鎮（有市集）；其他有人住的格子是村莊，產出送到綁定的市鎮 mkt[i]
  const town=new Uint8Array(N),mkt=new Int16Array(N).fill(-1),mcost=new Float32Array(N).fill(Infinity),mrisk=new Float32Array(N);
  let markets={},carts=[],caravans=[],flows=[],townNet={},mDs={},routeTiles=new Set();
  // 商路熱度（每年衰減，約十幾年的記憶）、路段流量、饑荒熱度
  const traffic=new Float32Array(N),famineH=new Float32Array(N);let edgeT={};
  const trafNear=t=>traffic[t]+NBR[t].reduce((x,n)=>x+traffic[n],0);
  const newMarket=st=>({stock:st||{food:30,water:15,fuel:6,parts:2,scrap:6,ammo:2},price:one(),need:zero(),rsum:zero(),ratio:one(),store:2,pop:0,cold:0,walls:0,famineCD:0});
  for(const f of fac)if(f.alive){town[f.cap]=1;markets[f.cap]=newMarket({...f.stock})}
  const vz=()=>({truck:0,armor:0,rush:0,gt:0,bomb:0});
  const garage=m=>m.veh||(m.veh=vz());
  const vehOf=fid=>{const o=vz();for(const k in markets)if(owner[+k]===fid&&markets[k].veh)for(const v of VEH)o[v]+=markets[k].veh[v];return o};
  // 打仗時從各車庫按比例扣車（被打爆、被開走）
  const vehLose=(fid,frac,kinds=VEH)=>{const lost=vz();for(const k in markets){if(owner[+k]!==fid||!markets[k].veh)continue;const g=markets[k].veh;for(const v of kinds){const d=g[v]*frac[v];g[v]-=d;lost[v]+=d}}return lost};
  const vehGive=(fid,add)=>{const m=markets[fac[fid].cap];if(!m)return;const g=garage(m);for(const v of VEH)g[v]+=add[v]||0};
  const tension=FM(()=>FM(()=>0)),war=FM(()=>FM(()=>null));
  const atWar=(a,b)=>a!==b&&a>=0&&b>=0&&!!war[Math.min(a,b)][Math.max(a,b)];
  const enemyMaskOf=a=>{const m=new Uint8Array(N);for(let i=0;i<N;i++){const o=owner[i];if(atWar(a,o))m[i]=1}return m};
  // 勢力層的庫存＝旗下各市鎮加總；要取用時按比例從各鎮扣
  const facMarkets=fid=>{const a=[];for(const k in markets)if(owner[+k]===fid)a.push(markets[k]);return a};
  const facStock=(fid,g)=>facMarkets(fid).reduce((x,m)=>x+m.stock[g],0);
  const facTake=(fid,g,amt)=>{const ms=facMarkets(fid),tot=ms.reduce((x,m)=>x+m.stock[g],0);if(tot<=0)return 0;const k=Math.min(1,amt/tot);for(const m of ms)m.stock[g]-=m.stock[g]*k;return Math.min(amt,tot)};
  const facGive=(fid,g,amt)=>{const m=markets[fac[fid].cap]||facMarkets(fid)[0];if(m)m.stock[g]+=amt};
  const tileRatio=i=>{const m=markets[mkt[i]];return m&&owner[mkt[i]]===owner[i]?m.ratio:fac[owner[i]].ratio};
  const cargoName=gd=>{let b='food';for(const g of GOODS)if(gd[g]*BASEP[g]>gd[b]*BASEP[b])b=g;return GN[b]};
  let routes=[],netSig='',netYear=-99,robTold=-1,robSeen={};
  const stats={cart:0,cartLost:0,cv:0,cvLost:0};
  // 同一條路被劫，十年內只記一次，免得編年史被劫案洗版
  const robSay=(y,key,txt,t)=>{if(robSeen._y===y||(robSeen[key]!==undefined&&y-robSeen[key]<10)||rand()<.5)return;robSeen[key]=robSeen._y=y;say(y,'bandit',txt,t)};
  const u8=a=>{const o=new Uint8Array(a.length);for(let i=0;i<a.length;i++){const v=Math.round(a[i]);o[i]=v>255?255:v}return o};
  const makeSnap=()=>{const econ=fac.map(f=>({stock:Object.fromEntries(GOODS.map(g=>[g,f.alive?facStock(f.id,g):0])),ratio:{...f.ratio},price:{...f.price},winterFood:f.winterFood,store:f.store||0,tiles:0,pop:0,loss:f.loss}));
    for(let i=0;i<N;i++)if(owner[i]>=0){econ[owner[i]].tiles++;econ[owner[i]].pop+=pop[i]}
    return {fn:fac.map(f=>f.alive?f.n:''),owner:owner.slice(),pop:u8(pop),bandit:u8(bandit),ruin:ruin.slice(),caps:fac.map(f=>f.alive?f.cap:-1),
      biome:biome.slice(),timber:u8(timber),timberK:u8(timberK),game:u8(game),gameK:u8(gameK),vein:Uint16Array.from(vein),vcap:Uint16Array.from(vcap),vex:vex.slice(),
      known:known.slice(),wall:u8(wall),town:town.slice(),econ,routes,
      edges:Object.entries(edgeT).sort((a,b)=>b[1]-a[1]).slice(0,160).map(([k,v])=>{const [a,b]=k.split('-').map(Number);return [a,b,+v.toFixed(1)]}),
      famine:Array.from(famineH,v=>Math.round(v*10)/10)}};
  snaps.push(makeSnap());
  const givName=()=>pick(GIV);
  const heroName=()=>pick(GIV)+' '+pick(SUR);
  // 英雄與領主：有封地的英雄就是那座市鎮的領主；死了由子嗣繼承
  let nextHero=1,battles=[];
  const mkHero=(f,y,name)=>{const h={id:nextHero++,name:name||heroName(),f,born:y,alive:true,fief:-1,wins:0,battles:0,skill:+(.9+rand()*.4).toFixed(2),loyal:+(.4+rand()*.6).toFixed(2),diedY:-1,end:''};heroes.push(h);return h};
  const heroById=id=>heroes.find(h=>h.id===id);
  function heroDies(h,y,end,o={}){if(!h.alive)return;h.alive=false;h.captive=null;h.diedY=y;h.end=end;let heir=null;const F=fac[h.f];
    if(h.fief>=0&&markets[h.fief]&&owner[h.fief]===h.f&&F.alive&&!o.noHeir&&rand()<.92){const t=h.fief;heir=mkHero(h.f,y,givName()+' '+hs(h));
      heir.fief=t;heir.parent=h.id;heir.loyal=+Math.min(1,h.loyal*.6+rand()*.4).toFixed(2);markets[t].lord=heir.id;if(h.title&&h.role!=='gov'){heir.title=h.title;heir.role=h.role}
      if(markets[t].pop>=100&&rand()<.3||h.legend)say(y,'hero',`${nm(t)}的課長${h.name}死後，由${hs(h)}家的${heir.name}接手。`,t)}
    if(F.alive&&F.ruler===h.id){
      if(!o.noHeir&&rand()<.85){if(!heir){heir=mkHero(h.f,y,givName()+' '+hs(h));heir.parent=h.id}if(h.role==='gov'){heir.role='gov';heir.title='總督';heir.noCmd=1}
        if(heir.fief>=0&&markets[heir.fief])markets[heir.fief].lord=0;heir.fief=-1;heir.ruled=1;F.ruler=heir.id;F.house=hs(heir);
        if(h.ruled&&(h.legend||rand()<.35))say(y,'hero',`${F.n}的${rulerT(F)}${h.name}死後，${heir.name}接位。`,F.cap)}
      else{F.ruler=0;F.crisis=y;say(y,'war',`${F.n}的${rulerT(F)}${h.name}死後沒有指定接班人，各派爭權，人心浮動。`,F.cap)}}
    let given=0;for(const wp of weaponsOf(h)){
      if(o.conq>=0&&fac[o.conq]&&fac[o.conq].alive)toTreasury(wp,o.conq,y,`${h.name}${end}，遺產級「${wp.name}」落入${fac[o.conq].n}手中。`);
      else if(heir&&heir.alive&&!given++)giveW(wp,heir,y,`${h.name}${end}，遺產級「${wp.name}」傳給了${heir.name}。`);
      else if(F.alive)toTreasury(wp,F.id,y,`${h.name}${end}，遺產級「${wp.name}」被收進${F.n}的軍械庫。`);
      else loseW(wp,h.fief>=0?h.fief:F.cap,y,`${h.name}${end}，遺產級「${wp.name}」從此下落不明。`)}
    h.fief=-1}
  // ═══════════ 傳說層：有名有姓的人、遺產級裝備、家族 ═══════════
  const ARC={phase:0};
  const weapons=[],saga=[],aff={},houseAff={};
  const sagaSay=(y,text,tile=-1)=>{saga.push({y,text,tile});return say(y,'legend',text,tile)};
  const heroByRole=r=>heroes.find(h=>h.role===r&&h.alive)||heroes.find(h=>h.role===r);
  const akey=(a,b)=>a<b?a+'|'+b:b+'|'+a;
  const affV=(a,b)=>a&&b?(aff[akey(a.id,b.id)]||0):0;
  const affAdd=(a,b,d)=>{if(!a||!b)return;const k=akey(a.id,b.id);aff[k]=(aff[k]||0)+d};
  const hAff=(x,y)=>x&&y&&x!==y?(houseAff[akey(x,y)]||0):0;
  const hAffAdd=(x,y,d)=>{if(!x||!y||x===y)return;const k=akey(x,y);houseAff[k]=Math.max(-3,Math.min(3,(houseAff[k]||0)+d))};
  const weaponsOf=h=>weapons.filter(w=>w.holder===h.id);
  const wbon=h=>Math.min(.45,weaponsOf(h).reduce((s,w)=>s+w.bonus,0));
  const facName=f=>f>=0&&fac[f]?fac[f].n:'';
  function wlog(wp,y,text,tile=-1){wp.hist.push({y,t:text});sagaSay(y,text,tile)}
  function giveW(wp,h,y,text){wp.holder=h.id;wp.holderName=h.name;wp.fac=-1;wp.gang=0;wp.lost=false;wp.loc=-1;wp.owners=(wp.owners||0)+1;if(text)wlog(wp,y,text,h.fief>=0?h.fief:-1)}
  function toTreasury(wp,f,y,text){wp.holder=0;wp.fac=f;wp.gang=0;wp.lost=false;wp.loc=-1;if(text)wlog(wp,y,text,fac[f].cap)}
  function toGang(wp,g,y,text){wp.holder=0;wp.fac=-1;wp.gang=g.id;wp.gangName=g.name;wp.lost=false;wp.loc=g.lair;if(text)wlog(wp,y,text,g.lair)}
  function loseW(wp,t,y,text,o={}){if(!land[t]){const s2=NBR[t].find(n=>land[n]);if(s2!==undefined){wp.shore=s2}}wp.holder=0;wp.fac=-1;wp.gang=0;wp.lost=true;wp.loc=t;wp.lostY=y;wp.lake=!!o.lake;wp.sealed=!!o.sealed;if(text)wlog(wp,y,text,t)}
  // 國家滅亡或被併：寶庫與英雄跟著走
  function facFall(f,y,to){
    for(const wp of weapons)if(wp.fac===f.id){if(to>=0&&fac[to].alive)toTreasury(wp,to,y,`${f.n}的軍械庫落入${fac[to].n}手中，遺產級「${wp.name}」也在其中。`);else loseW(wp,f.cap,y,`${f.n}覆滅，軍械庫裡的遺產級「${wp.name}」在混亂中失落於${nm(f.cap)}。`)}
    if(to>=0&&fac[to].alive)for(const h of heroes)if(h.alive&&h.f===f.id){h.f=to;h.fief=-1}}
  // ═══════════ 奇美拉：總督府、斷鏈之後的崩塌 ═══════════
  // 遺產級：企業時代留下、再也造不出來的裝備。壞了就少一件；落到普通人手上，普通人就成了軍閥
  const LEG_KINDS=['光束步槍','磁軌狙擊槍','動力裝甲','外骨骼護甲','電漿切割刀','脈衝手槍','戰術目鏡','護盾產生器','單分子刀','重型霰彈槍'];
  const LEG_NAMES=['藍白','孤星','黑盒','第七序列','晨鐘','長夜','白鷺','殘響','零號','回聲','裁決','赤線','靜默','遠雷','銀翼','終端','天平','灰燼','北極','半衰'];
  const ORG_RAD=['軍政府','安全委員會','臨時政府','執法委員會'],ORG_WORKS=['工廠公社','製造區','廠區自治會'];
  const LEAGUE_A=['齒輪','鉚釘','熔爐','鏈條','螺栓','扳手'],LEAGUE_B=['議會','同盟','公約','聯合會'];
  const TRIBE_A=['灰手','沙語','乾根','無聲','白骨','鹽眼','焦風','長影','裂唇','赤沙','黑井','靜火'],TRIBE_B=['氏族','部眾','之民'];
  const leagues=[];
  function mkLegacy(){const used=new Set(weapons.map(w=>w.name));let n=pick(LEG_NAMES);for(let k=0;used.has(n)&&k<40;k++)n=pick(LEG_NAMES);if(used.has(n))n=n+'二型';
    const wp={id:weapons.length+1,name:n,kind:pick(LEG_KINDS),bonus:+(.1+rand()*.15).toFixed(2),hist:[],holder:0,fac:-1,gang:0,lost:false,loc:-1,wins:0,owners:0};weapons.push(wp);return wp}
  function tribeName(){const used=new Set(gangs.map(g=>g.name));let n='';for(let k=0;k<40;k++){n=pick(TRIBE_A)+pick(TRIBE_B);if(!used.has(n))break}return n}
  function spawnTribe(y,t){const g={id:nextGang++,name:tribeName(),chief:heroName(),native:1,lair:t,str:0,born:y};gangs.push(g);bandit[t]=Math.min(100,bandit[t]+40);for(const n of NBR[t])if(land[n])bandit[n]=Math.min(100,bandit[n]+15);return g}
  const gWho=g=>g.native?g.name:`掠奪者頭目${g.name}`;
  const rulerT=F=>F.id===0?'總督':F.free?'市長':F.native?'大族長':F.works?'廠長':'首領';
  function initLegends(){
    // 首府：軌道電梯腳下，大陸中央附近有水的平地
    const center=idx(Math.floor(W/2),Math.floor(H/2));let cap=fac[0].cap,bd=1e9;
    for(let i=0;i<N;i++)if(land[i]&&fert[i]>=.5&&biome[i]!==2&&biome[i]!==3){let wk=0;for(let j=0;j<N;j++)if(land[j]&&hdist(i,j)<=4)wk+=waterK[j];const d=hdist(i,center)*.6-wk*.25-(river[i]?2:0)-fert[i]*2;if(d<bd){bd=d;cap=i}}
    const old=fac[0].cap;if(old!==cap){owner[old]=-1;pop[old]=0;peak[old]=0;town[old]=0;delete markets[old];ev.length=0;fac[0].cap=cap;town[cap]=1;markets[cap]=newMarket()}
    fac[0].n=`${nm(cap)}總督府`;ARC.elevator=cap;
    for(let i=0;i<N;i++){if(!land[i]||biome[i]===2)continue;const d=hdist(i,cap);if(d>8)continue;owner[i]=0;pop[i]=Math.max(6,(fert[i]*100+5)*.42*(1-d/12));peak[i]=pop[i]}
    pop[cap]=Math.max(pop[cap],90);
    // 轄區：離首府 3～8 格、彼此分散的市鎮；靠近舊礦坑或燃料林的是廠鎮
    const cands=[];for(let i=0;i<N;i++)if(owner[i]===0&&i!==cap){const d=hdist(i,cap);if(d>=3&&d<=8)cands.push(i)}
    cands.sort((a,b)=>(fert[b]+(river[b]?.4:0)+rand()*.3)-(fert[a]+(river[a]?.4:0)+rand()*.3));
    const fiefs=[];for(const c of cands){if(fiefs.length>=9)break;if(fiefs.every(f=>hdist(f,c)>=3)){fiefs.push(c);town[c]=1;markets[c]=newMarket();pop[c]=Math.max(pop[c],60)}}
    const ind=t=>{let v=0;for(let i=0;i<N;i++)if(hdist(i,t)<=2)v+=(w.vein0[i]>0?3:0)+timberK[i]/60;return v};
    const works=fiefs.slice().sort((a,b)=>ind(b)-ind(a)).slice(0,3);for(const t of works)markets[t].works=1;
    // 培養槽：原本是替領導層備份身體用的，首府三座、每個轄區一座
    markets[cap].vat=3;for(const t of fiefs)markets[t].vat=1;
    // 維安部隊的車：首府幾輛武裝車和戰鬥卡車，各轄區幾輛卡車
    Object.assign(garage(markets[cap]),{truck:4,armor:6,gt:2,rush:0});for(const t of fiefs)garage(markets[t]).truck=2;
    const person=(role,title,age,skill,loyal,o={})=>{const h=mkHero(0,-age);Object.assign(h,{role,title,legend:1,skill,loyal},o);return h};
    const gov=person('gov','總督',52,1,1,{noCmd:1,ruled:1}),sec=person('sec','治安長',36,1.55,.45);
    const offs=[];let si=-1,bd2=-1;for(let k=0;k<fiefs.length;k++)if(!markets[fiefs[k]].works&&hdist(fiefs[k],cap)>bd2){bd2=hdist(fiefs[k],cap);si=k}
    for(const t of fiefs){let h;if(fiefs.indexOf(t)===si)h=sec;else if(markets[t].works)h=person('works','廠長',35+Math.floor(rand()*20),1+rand()*.2,+(.4+rand()*.5).toFixed(2));
      else{h=person('off','課長',30+Math.floor(rand()*25),1.05+rand()*.35,+(.3+rand()*.7).toFixed(2));offs.push(h)}
      h.fief=t;markets[t].lord=h.id}
    fac[0].ruler=gov.id;fac[0].house=hs(gov);
    // 遺產級：維安部隊手上幾件，總督府的倉庫一件，其餘封在各地被遺忘的舊倉庫
    for(const h of [sec,sec,...offs.sort((a,b)=>b.skill-a.skill).slice(0,2)]){const wp=mkLegacy();giveW(wp,h,0,null);wp.hist.push({y:0,t:`${h.title}${h.name}的配備`})}
    {const wp=mkLegacy();toTreasury(wp,0,0,null);wp.hist.push({y:0,t:`收在總督府的倉庫`})}
    for(let k=0;k<Math.round(3*MK);k++){const t=farWild(cap,6),wp=mkLegacy();wp.hist.push({y:0,t:`封在${nm(t)}一座被遺忘的舊倉庫裡`});loseW(wp,t,0,null,{sealed:true})}
    // 荒地裡的原住民
    for(let k=0;k<Math.round(1.5*MK);k++)spawnTribe(0,farWild(cap,9));
    ARC.ackY=35+Math.floor(rand()*20);ARC.rationY=8+Math.floor(rand()*8);ARC.strikeY=16+Math.floor(rand()*14);
    sagaSay(0,`最後一艘接駁船離開${nm(cap)}的軌道電梯。${gov.title}${gov.name}宣布：下一班船三年後到。`,cap);
    snaps[0]=makeSnap()}
  // 大陸上的自然地點：最近的湖或海
  function nearWater(t){let best=-1,bd=99;for(let i=0;i<N;i++)if(!land[i]&&NBR[i].some(n=>land[n])){const d=hdist(i,t);if(d<bd){bd=d;best=i}}return best}
  function farWild(from,minD){const c=[];for(let i=0;i<N;i++)if(land[i]&&owner[i]<0&&hdist(i,from)>=minD)c.push(i);return c.length?c[Math.floor(rand()*c.length)]:from}
  // 每年：注定的崩解、統治者、寶庫、尋回失物、家族恩怨
  function legendYear(y){
    arc(y);
    for(const f of fac)if(f.alive){let r=f.ruler&&heroById(f.ruler);
      if(!r||!r.alive||r.f!==f.id){const c=heroes.filter(h=>h.alive&&h.f===f.id&&!h.noCmd).sort((a,b)=>(b.fief<0)-(a.fief<0)||b.skill-a.skill)[0]||mkHero(f.id,y-30);
        if(c.fief>=0&&markets[c.fief]&&c.fief!==f.cap){markets[c.fief].lord=0}c.fief=-1;c.ruled=1;
        if(f.house&&f.house!==hs(c)&&(f.ruler||0))sagaSay(y,`${f.n}的${f.house}家後繼無人，${c.name}接掌${f.n}。`,f.cap);
        f.ruler=c.id;f.house=hs(c);if(f.id===0&&ARC.phase<4){c.title='總督';c.role='gov'}}}
    for(const h of heroes)if(h.alive&&fac[h.f]?.alive){const ws=weaponsOf(h);if(ws.length>1&&rand()<.4){const wp=ws[ws.length-1];toTreasury(wp,h.f,y,`${h.name}把遺產級「${wp.name}」交給了${fac[h.f].n}。`)}}
    for(const wp of weapons)if(wp.fac>=0&&fac[wp.fac].alive&&rand()<.5){const F=fac[wp.fac],r=heroById(F.ruler);
      const c=r&&r.alive&&!r.noCmd&&!weaponsOf(r).length?r:heroes.filter(h=>h.alive&&h.f===F.id&&!h.noCmd&&!weaponsOf(h).length).sort((a,b)=>b.skill-a.skill)[0];
      if(c)giveW(wp,c,y,`${F.n}把軍械庫裡的遺產級「${wp.name}」${c===r?`配給${rulerT(F)}${c.name}`:`配給${c.name}`}。`)}
    for(const wp of weapons){if(!wp.lost)continue;const p=wp.lake?.0015:wp.sealed?(globalThis.DEPOT??.007):.025;if(rand()>p)continue;const t=wp.loc,ago=y-wp.lostY;
      const ot=land[t]?owner[t]:owner[wp.shore??t];if(ot>=0&&fac[ot].alive){const F=fac[ot],c=heroes.filter(h=>h.alive&&h.f===F.id&&!h.noCmd).sort((a,b)=>weaponsOf(a).length-weaponsOf(b).length||rand()-.5)[0];
        if(c)giveW(wp,c,y,`${ago?`失落 ${ago} 年後，`:''}${F.n}的${c.name}在${nm(land[t]?t:wp.shore)}${wp.sealed?'挖開一座舊倉庫，找到':'的舊戰場上撿回'}遺產級「${wp.name}」${wp.kind}。`)}
      else{const g=gangs.find(g=>!g.gone&&hdist(g.lair,t)<=3),where=nm(land[t]?t:wp.shore);
        if(g)toGang(wp,g,y,`${ago?`失落 ${ago} 年後，`:''}${gWho(g)}在${where}${wp.sealed?'挖開一座舊倉庫':'的沙裡'}找到遺產級「${wp.name}」${wp.kind}，聲勢大振。`);
        else{// 沒有人的地方：撿到的人就此成了一方軍閥
          const ng={id:nextGang++,name:heroName(),lair:t,str:0,born:y,made:{y,legacy:wp.name}};gangs.push(ng);bandit[t]=Math.min(100,bandit[t]+35);
          toGang(wp,ng,y,`一個叫${ng.name}的拾荒者在${where}${wp.sealed?'挖開一座舊倉庫':'的沙裡'}，找到遺產級「${wp.name}」${wp.kind}。沒有拿去賣，而是拉起了一支人馬。`)}}}
    worldYear(y);
    for(const k in houseAff)houseAff[k]*=Math.abs(houseAff[k])>1?.9993:.997;
    for(const k in aff)aff[k]*=.995}
  function arc(y){
    if(ARC.phase===0){
      // 等待：每過一年，課長們就少信總督府一點
      for(const h of heroes)if(h.alive&&h.f===0&&h.role&&h.role!=='gov')h.loyal=Math.max(0,+(h.loyal-.003-rand()*.006).toFixed(3));
      if(y===3)sagaSay(y,`說好的那班船沒有來。${nm(ARC.elevator)}的電梯站裡，值班員每天照常打開通訊頻道。`,ARC.elevator);
      else if(y===ARC.rationY)sagaSay(y,`總督府開始配給零件與燃料，公告上寫的理由是「船期延誤」。`,fac[0].cap);
      else if(y===ARC.strikeY){const t=Object.keys(markets).map(Number).find(t=>markets[t].works&&owner[t]===0);
        if(t!==undefined){sagaSay(y,`${nm(t)}的工人罷工，要總督府拿出船期表。總督府拿不出來。`,t);pop[t]*=.9;const h=markets[t].lord&&heroById(markets[t].lord);if(h)h.loyal=Math.max(0,h.loyal-.15)}}
      if(y>=ARC.ackY)acknowledge(y)}
    else if(ARC.phase===1&&y>=ARC.collapseY)collapse(y)}
  const pr=(a,b,c)=>Math.max(b,Math.min(c,a));
  // 統計用（globalThis.CSTAT 給了才記）：CSTAT[勢力][年][項目]
  const rec=(f,y,k,v)=>{const S=globalThis.CSTAT;if(!S||!v)return;const a=(S[f]||(S[f]={})),b=(a[y]||(a[y]={}));b[k]=(b[k]||0)+v};
  const BIGLOOT=globalThis.BIGLOOT??120,LOOTSTR=globalThis.LOOTSTR??1,FAMEK=globalThis.FAMEK??1500,FAMET=globalThis.FAMET??8,RICH=globalThis.RICH??400;
  function acknowledge(y){
    ARC.phase=1;const cap=fac[0].cap;
    sagaSay(y,`第 ${y} 年，${nm(ARC.elevator)}電梯站的值班員關掉了那個從來沒有回應過的頻道。沒有人宣布什麼，但所有人都知道了：企業不會回來了。`,ARC.elevator);
    // 激進派：治安長帶兵出走；治安長不在了，就是最不忠的課長
    let R=heroByRole('sec');if(!R||!R.alive||R.f!==0||R.id===fac[0].ruler)R=heroes.filter(h=>h.alive&&h.f===0&&h.fief>=0&&!h.noCmd&&!markets[h.fief]?.works).filter(h=>h.id!==fac[0].ruler).sort((a,b)=>a.loyal-b.loyal)[0];
    const slot=freeSlot(y);
    if(R&&slot){if(R.fief<0||!markets[R.fief]){const ts=Object.keys(markets).map(Number).filter(t=>owner[t]===0&&t!==cap&&!markets[t].works);R.fief=ts.sort((a,b)=>hdist(b,cap)-hdist(a,cap))[0];if(R.fief!==undefined)markets[R.fief].lord=R.id}
      const home=R.fief;
      if(home!==undefined&&home>=0){const tiles=[];for(let i=0;i<N;i++)if(owner[i]===0&&mkt[i]===home&&i!==cap)tiles.push(i);
        newState(slot,y,nm(home)+pick(ORG_RAD),home,tiles,1.5);slot.taboo=.1;slot.ruler=R.id;slot.house=hs(R);R.f=slot.id;markets[home].lord=0;R.fief=-1;R.ruled=1;ARC.rad=slot.id;
        sagaSay(y,`${R.title||'課長'}${R.name}說，與其等一艘不會來的船，不如自己把秩序拿回來。帶著維安部隊離開首府，在${nm(home)}成立${slot.n}。`,home);
        for(const h of heroes){if(!h.alive||h.f!==0||h.role==='gov'||h.fief<0||h===R||markets[h.fief]?.works)continue;
          if(rand()<pr(.65-h.loyal*.7,.05,.8)){const t=h.fief;for(let i=0;i<N;i++)if(owner[i]===0&&(mkt[i]===t||i===t))owner[i]=slot.id;h.f=slot.id;sagaSay(y,`${nm(t)}的${h.title||'課長'}${h.name}跟著${R.name}走了。`,t)}}
        const a=Math.min(0,slot.id),b=Math.max(0,slot.id);war[a][b]={att:slot.id,def:0,goal:cap,start:y,end:y+8,gain:{},score:0,siege:null,taken:[]};
        sagaSay(y,`${slot.n}的部隊向${nm(cap)}進發，說要「接管」總督府。`,cap)}}
    else sagaSay(y,`總督府裡沒有人站出來。各地的課長開始各自打算。`,cap);
    // 廠鎮：廠長決定繼續替總督府開工，還是關起廠門自己做主
    const left=[];
    for(const t of Object.keys(markets).map(Number)){const m=markets[t];if(!m.works||owner[t]!==0)continue;const h=m.lord?heroById(m.lord):null;
      if(rand()<pr(.75-(h?h.loyal:.5)*.6+hdist(t,cap)*.03,.1,.85)){const s2=freeSlot(y);if(!s2)break;const tiles=[];for(let i=0;i<N;i++)if(owner[i]===0&&mkt[i]===t&&i!==cap)tiles.push(i);
        newState(s2,y,nm(t)+pick(ORG_WORKS),t,tiles,.7);s2.works=1;s2.taboo=.3;if(h&&h.alive){h.f=s2.id;h.fief=-1;m.lord=0;s2.ruler=h.id;s2.house=hs(h);h.ruled=1}
        left.push(s2);sagaSay(y,`${nm(t)}的廠區關上大門。${h?`${h.title||'廠長'}${h.name}`:'工人們'}說，從此只跟付得起錢的人做生意。`,t)}
      else sagaSay(y,`${nm(t)}的${h?(h.title||'廠長')+h.name:'工人們'}決定繼續替總督府開工。`,t)}
    if(left.length>=2){const L={id:leagues.length+1,n:pick(LEAGUE_A)+pick(LEAGUE_B),born:y};leagues.push(L);for(const f of left)f.league=L.id;
      sagaSay(y,`${left.map(f=>f.n).join('、')}簽下互不侵犯、互相供貨的協定，對外稱為${L.n}。`,left[0].cap)}
    for(const g of gangs)if(g.native&&!g.gone){bandit[g.lair]=Math.min(100,bandit[g.lair]+20)}
    ARC.collapseY=y+3+Math.floor(rand()*4)}
  function collapse(y){
    ARC.phase=4;ARC.fallY=y;const F0=fac[0],states=[];
    // 自由城市：商路最熱、又不是誰的首府的城，宣布中立
    const cands=Object.keys(markets).map(Number).filter(t=>owner[t]>=0&&fac[owner[t]].alive&&t!==fac[owner[t]].cap&&!markets[t].works).sort((a,b)=>trafNear(b)-trafNear(a));
    let nf=0;for(const t of cands){if(nf>=(globalThis.FREEC??(1+(rand()<.5?1:0))))break;const f=fac[owner[t]],slot=freeSlot(y);if(!slot)break;
      const tiles=[];for(let i=0;i<N;i++)if(owner[i]===f.id&&mkt[i]===t)tiles.push(i);newState(slot,y,nm(t)+'自由城',t,tiles,.3);slot.free=1;slot.taboo=.5;nf++;
      const lord=markets[t].lord?heroById(markets[t].lord):null;if(lord&&lord.alive){lord.f=slot.id;lord.fief=-1;markets[t].lord=0;slot.ruler=lord.id;slot.house=hs(lord);lord.ruled=1}
      sagaSay(y,`${nm(t)}的商人和傭兵頭子們宣布：誰都可以來做生意，誰都不准在這裡開火。${slot.n}就此成立。`,t)}
    // 課長們各自為王
    for(const h of heroes.slice())if(h.alive&&h.f===0&&h.fief>=0&&markets[h.fief]&&owner[h.fief]===0&&h.fief!==F0.cap&&rand()<pr(.85-h.loyal*.6,.15,.9)){const before=h.f;secede(F0,h.fief,y,'眼看總督府自身難保');if(h.f!==before)states.push(fac[h.f].n)}
    for(const t of Object.keys(markets).map(Number))if(owner[t]===0&&t!==F0.cap&&rand()<.35){const m=markets[t],lord=m.lord&&heroById(m.lord);if(lord&&lord.alive&&m.pop>=60){const before=lord.f;secede(F0,t,y,'不想再替總督府賣命');if(lord.f!==before)states.push(fac[lord.f].n)}}
    if(F0.alive)sagaSay(y,`總督府的命令再也出不了${nm(F0.cap)}。${states.length?states.join('、')+'各自為王。':''}`,F0.cap);
    const tr=gangs.filter(g=>g.native&&!g.gone).sort((a,b)=>b.str-a.str)[0];
    if(tr)sagaSay(y,`荒地裡的${tr.name}看準了時機，開始襲擊各地的聚落。`,tr.lair);
    ARC.blocY=y+40+Math.floor(rand()*15);ARC.protect=-1}
  // 陣營：到了某個時候，各方勢力收斂成兩三個互相衝突的同盟
  function blocYear(y){
    const alive=fac.filter(f=>f.alive&&!f.free);const P=new Float32Array(FMAX);for(let i=0;i<N;i++)if(owner[i]>=0)P[owner[i]]+=pop[i];
    const T_=(a,b)=>tension[Math.min(a,b)][Math.max(a,b)];
    if(!ARC.blocs){const cand=alive.filter(f=>f.liege<0).sort((a,b)=>P[b.id]-P[a.id]),lead=[];
      for(const f of cand){if(lead.length>=3)break;if(lead.some(l=>l.league&&l.league===f.league))continue;if(lead.length>=2&&P[f.id]<P[lead[0].id]*.35)break;lead.push(f)}
      if(lead.length<2)return;ARC.blocs=[];
      for(const L of lead){const B={id:ARC.blocs.length+1,lead:L.id,n:`${nm(L.cap)}同盟`,born:y};ARC.blocs.push(B);L.bloc=B.id}
      sagaSay(y,`各方勢力漸漸靠向${lead.map(L=>L.n).join('、')}，形成${ARC.blocs.map(B=>B.n).join('、')}${lead.length}個陣營。`,lead[0].cap)}
    for(const B of ARC.blocs){const L=fac[B.lead];if(L&&L.alive&&L.bloc===B.id)continue;const m=alive.filter(f=>f.bloc===B.id).sort((a,b)=>P[b.id]-P[a.id])[0];
      if(m){B.lead=m.id;say(y,'war',`${m.n}接下${B.n}的盟主。`,m.cap)}else B.gone=1}
    const live=ARC.blocs.filter(B=>!B.gone);if(!live.length)return;
    for(const f of alive){if(live.some(B=>B.lead===f.id))continue;
      let want=0;
      if(f.liege>=0&&fac[f.liege].alive)want=fac[f.liege].bloc||0;
      else if(f.league){const m=alive.find(x=>x!==f&&x.league===f.league&&x.bloc);if(m)want=m.bloc}
      if(!want){if(f.bloc&&rand()>.03)continue;let bs=1e9;
        const PT=alive.reduce((x,m)=>x+P[m.id],0)||1;
        for(const B of live){const L=fac[B.lead];let s=(atWar(f.id,L.id)?100:0)+T_(f.id,L.id)+hdist(f.cap,L.cap)*.4+alive.reduce((x,m)=>x+(m.bloc===B.id&&m!==f?P[m.id]:0),0)/PT*40;
          for(const m of alive)if(m!==f&&atWar(f.id,m.id))s+=m.bloc===B.id?40:-15;
          if(s<bs){bs=s;want=B.id}}}
      if(want&&want!==f.bloc){const B=live.find(x=>x.id===want);if(!B)continue;const before=f.bloc;f.bloc=want;
        for(const m of alive)if(m!==f&&m.bloc===want&&atWar(f.id,m.id)){const a=Math.min(f.id,m.id),b=Math.max(f.id,m.id);war[a][b]=null;tension[a][b]=-20;say(y,'war',`${f.n}與${m.n}同在${B.n}，握手言和。`,f.cap)}
        say(y,'war',before?`${f.n}倒向${B.n}。`:`${f.n}加入${B.n}。`,f.cap)}}}
  // ═══════════ 世界中的人：聯姻、武器的轉手、英雄的去留、俘虜 ═══════════
  const notable=h=>h&&(h.legend||h.famed||weaponsOf(h).length||h.ruled);
  const EPI=['狐','鷹','蛇','刃','鴉','蠍','禿鷲','鐵手','獨眼','白鬍子','焦土','沙狐','穿甲','長槍','無聲'];
  const rulerOf=f=>{const r=fac[f]&&fac[f].alive?heroById(fac[f].ruler):null;return r&&r.alive?r:null};
  const holderLoc=h=>h.fief>=0?h.fief:fac[h.f]?.cap??-1;
  function worldYear(y){
    if(ARC.phase<4)return;
    // 傳奇武器：被偷、典當、賜給封臣、殺人奪寶
    for(const wp of weapons){if(!wp.holder)continue;const h=heroById(wp.holder);if(!h||!h.alive||!fac[h.f]?.alive)continue;const F=fac[h.f],at=holderLoc(h);
      const r=rand();
      if(r<.003){const g=gangs.find(g=>!g.gone&&hdist(g.lair,at)<=5);if(g)toGang(wp,g,y,`遺產級「${wp.name}」在${nm(at)}被${gWho(g)}的人偷走。`);else loseW(wp,farWild(at,2),y,`遺產級「${wp.name}」被一個勤務兵偷走，從此下落不明。`)}
      else if(r<.006){const k=heroes.filter(x=>x.alive&&x!==h&&!x.noCmd&&!x.captive&&(x.f===h.f||(fac[x.f]&&hdist(fac[x.f].cap,at)<=6))).sort(()=>rand()-.5)[0];
        if(k){giveW(wp,k,y,`${fac[k.f].n}的${k.name}看上了遺產級「${wp.name}」，在${nm(at)}殺了${h.name}，把它搶走。`);hAffAdd(hs(h),hs(k),-2);heroDies(h,y,`被${k.name}刺殺`)}}
      else if(F.ratio&&F.ratio.food<.8&&r<.05){const buyer=fac.filter(x=>x.alive&&x.id!==F.id&&!war[Math.min(x.id,F.id)][Math.max(x.id,F.id)]).sort((p,q)=>facStock(q.id,'food')-facStock(p.id,'food'))[0];
        if(buyer&&facStock(buyer.id,'food')>60){facTake(buyer.id,'food',40);facGive(F.id,'food',40);toTreasury(wp,buyer.id,y,`${F.n}鬧饑荒，${h.name}把遺產級「${wp.name}」賣給了${buyer.n}，換回四十箱口糧。`)}}
      else if(F.ruler===h.id&&r<.04){const V=fac.find(x=>x.alive&&x.liege===F.id&&x.loyal<.5);const vr=V&&rulerOf(V.id);if(vr){V.loyal=Math.min(1,V.loyal+.3);giveW(wp,vr,y,`為了安撫心懷不滿的附庸，${h.name}把遺產級「${wp.name}」送給了${V.n}的${vr.name}。`)}}}
    // 名聲：事蹟跟著商隊傳開，夠響亮的人會得到綽號，從此被傳唱
    for(const h of heroes){if(!h.alive||h.legend||h.famed||(h.fame||0)<FAMET)continue;h.famed=1;const at=h.lastWin??holderLoc(h);
      {const e=pick(EPI);h.epithet=e.length>1?e:nm(at)[0]+e}sagaSay(y,`${fac[h.f]?.alive?fac[h.f].n+'的':''}${h.name}在${nm(at)}一帶連戰連勝，事蹟跟著往來的商隊傳遍各地市集，人稱「${h.epithet}」。`,at)}
    // 富裕的市集出錢買回遺產級：從掠奪者手上買，或向撿到的拾荒者收購
    for(const wp of weapons){const fromGang=wp.gang&&gangs.find(g=>g.id===wp.gang&&!g.gone),onField=wp.lost&&!wp.sealed&&!wp.lake&&wp.loc>=0;
      if(!fromGang&&!onField)continue;const at=fromGang?fromGang.lair:wp.loc;let best=-1,bw=0;
      for(const k in markets){const t=+k,o=owner[t];if(o<0||!fac[o].alive||hdist(t,at)>7)continue;const m=markets[k];
        const wv=m.pop*.5+GOODS.reduce((x,g)=>x+Math.max(0,m.stock[g])*BASEP[g],0)+trafNear(t)*.3;if(wv>bw){bw=wv;best=t}}
      if(best<0||bw<RICH||rand()>(fromGang?.04:.015))continue;const m=markets[best],o=owner[best];
      for(const g of ['parts','ammo'])m.stock[g]*=.5;
      toTreasury(wp,o,y,fromGang?`${nm(best)}的商人們湊出一大批零件和彈藥，從${gWho(fromGang)}手上買回遺產級「${wp.name}」，獻給了${fac[o].n}。`
        :`一個拾荒者在${nm(at)}的沙裡翻出一件舊裝備，賣給了${nm(best)}的商人；商人認出那是遺產級「${wp.name}」，轉手獻給了${fac[o].n}。`)}
    // 人的去留：投奔別的勢力、出走當掠奪者
    for(const h of heroes){if(!h.alive||h.plot&&ARC.phase<4||h.captive||h.ruled||h.noCmd||!fac[h.f]?.alive)continue;const F=fac[h.f];
      const p=.003+(F.shock>.5?.02:0)+(h.loyal<.3?.015:0)+(F.ratio&&F.ratio.food<.8?.01:0);if(rand()>p)continue;
      if(h.fief<0&&rand()<.35){let t=-1;for(let k=0;k<30&&t<0;k++){const c=Math.floor(rand()*N);if(land[c]&&owner[c]<0&&hdist(c,fac[h.f].cap)<=8)t=c}
        if(t>=0){const g={id:nextGang++,name:h.name,lair:t,str:0,born:y};gangs.push(g);bandit[t]=Math.min(100,bandit[t]+35);
          for(const wp of weaponsOf(h))toGang(wp,g,y,`${h.name}帶著遺產級「${wp.name}」出走，當了掠奪者。`);
          (notable(h)?sagaSay:(yy,tt,ti)=>say(yy,'bandit',tt,ti))(y,`${F.n}的${h.name}受夠了上頭，帶著手下到${nm(t)}當了掠奪者。`,t);h.alive=false;h.diedY=y;h.end=`在${nm(t)}當了掠奪者`;h.fief=-1;continue}}
      const targets=fac.filter(x=>x.alive&&x.id!==F.id&&bc&&bc[Math.min(x.id,F.id)][Math.max(x.id,F.id)]);if(!targets.length)continue;
      const T_=targets.sort((p_,q)=>hAff(hs(h),q.house)-hAff(hs(h),p_.house)+rand()-.5)[0];
      if(h.fief>=0&&markets[h.fief])markets[h.fief].lord=0;h.fief=-1;h.f=T_.id;h.loyal=+(.5+rand()*.4).toFixed(2);hAffAdd(hs(h),F.house,-.8);
      (notable(h)?sagaSay:(yy,tt,ti)=>say(yy,'hero',tt,ti))(y,`${F.n}的${h.name}${weaponsOf(h).length?`帶著遺產級「${weaponsOf(h)[0].name}」`:''}投奔了${T_.n}。`,T_.cap)}
    // 俘虜：贖回、招降或處決
    for(const h of heroes){if(!h.alive||!h.captive)continue;const by=fac[h.captive.by],own=fac[h.f];
      if(!by||!by.alive||!own||!own.alive){h.captive=null;continue}
      if(rand()<.45&&facStock(own.id,'food')>40){facTake(own.id,'food',30);facGive(by.id,'food',30);h.captive=null;(notable(h)?sagaSay:(yy,tt,ti)=>say(yy,'hero',tt,ti))(y,`${own.n}付了三十箱口糧，把被俘的${h.name}贖了回來。`,own.cap);continue}
      if(y-h.captive.y>=3){if(rand()<.5){h.f=by.id;h.captive=null;h.fief=-1;hAffAdd(hs(h),own.house,-.6);(notable(h)?sagaSay:(yy,tt,ti)=>say(yy,'hero',tt,ti))(y,`被關了三年的${h.name}投靠了${by.n}。`,by.cap)}
        else{for(const wp of weaponsOf(h))toTreasury(wp,by.id,y,`${by.n}處決了被俘的${h.name}，遺產級「${wp.name}」收進了軍械庫。`);hAffAdd(hs(h),by.house,-1.5);heroDies(h,y,`被${by.n}處決`)}}}}
  // 同一個體系內（宗主與附庸、同一個工廠協定、同一個陣營）不會互相開戰
  const sameRealm=(a,b)=>a===b||fac[a].liege===b||fac[b].liege===a||(fac[a].liege>=0&&fac[a].liege===fac[b].liege)||(!!fac[a].league&&fac[a].league===fac[b].league)||(!!fac[a].bloc&&fac[a].bloc===fac[b].bloc);
  function makeVassal(v,l,y){const V=fac[v];V.liege=l;V.loyal=.6;V.lsince=y;
    for(const x of fac)if(x.alive&&x.liege===v){x.liege=l;x.lsince=y}
    const a=Math.min(v,l),b=Math.max(v,l);war[a][b]=null;tension[a][b]=0}


  let bc,front,covet,gangs=[],nextGang=1;
  const effOf=(cost,g,risk)=>(1-.03*cost*WEIGHT[g])*(1-risk);
  // ===== 時鐘：1 年 = 4 季 = 112 時段（每季 7 天、每天 4 個時段）=====
  const PY=112,PS=28,PERIOD=['晨','午','暮','夜'];
  function stamp(){const p=T%PY,s=Math.floor(p/PS),d=Math.floor((p%PS)/4)+1;return `${curY} 年 ${SEASON[s]} 第${d}日 ${PERIOD[T%4]}`}
  // ===== 惰性補算：每格記下上次結算的時段，需要時才一次補算 =====
  const lastT=new Int32Array(N);let computed=0;
  const logi=(x,K,r,dt,imm)=>{if(K<=0)return 0;x=Math.max(x,.05);const v=K/(1+(K/x-1)*Math.exp(-r*dt/PY));return Math.min(K,v+imm*dt/PY)};
  function catchUp(i,to){const dt=to-lastT[i];if(dt<=0||!land[i])return;lastT[i]=to;computed++;
    if(gameK[i]>0)game[i]=logi(game[i],gameK[i],.3,dt,.4);
    if(timberK[i]>0)timber[i]=logi(timber[i],timberK[i],.15,dt,.5)}

  function buildNet(y){
    refreshCE();if(!live){bindMarkets();buildTownNet()}}   // 線上模式：市場在每季結算前重綁、鎮際路網在開年下一個時段重建   // 線上模式把鎮際路網挪到下一個時段算，分散單次的計算量
  function refreshCE(){for(let n=0;n<N;n++)CE[n]=MOVE[biome[n]]*(land[n]&&river[n]?.6:1)}
  // 市鎮之間的路網：每年開春算一次，只留下鎮到鎮的路程與路線（要存檔，讀檔時不重算）
  function buildTownNet(part=-1){const ts=Object.keys(markets).map(Number);
    if(part<0)townNet={};else for(const k of Object.keys(townNet))if(!markets[k])delete townNet[k];
    const maxD=.7/(.03*Math.min(...GOODS.map(g=>WEIGHT[g])));   // 再遠的話，最輕的貨也損耗超過七成，沒人會走
    for(const t of ts){if(part>=0&&t%2!==part)continue;const D=dijkstra(t,enemyMaskOf(owner[t]),maxD),dist={},path={};
      for(const u of ts)if(u!==t&&D.dist[u]<Infinity){dist[u]=D.dist[u];path[u]=pathTo(D,u)}
      townNet[t]={dist,path}}}
  // 多源最短路：每格記下最近的起點；acc 給了的話，順便把沿路的 acc 值累加起來（例如盜匪壓力）
  function dijkstraMulti(srcs,blocked,acc,maxD=Infinity){const dist=new Float64Array(N).fill(Infinity),prev=new Int16Array(N).fill(-1),src=new Int16Array(N).fill(-1),sum=new Float32Array(N),h=HEAP;h.size=0;
    for(const x of srcs){dist[x]=0;src[x]=x;h.push(0,x);if(acc)sum[x]=acc[x]}
    while(h.size){const i=h.pop(),d=h.pk;if(d>dist[i])continue;const nb=NBR[i],li=land[i];
      for(let e=0;e<nb.length;e++){const n=nb[e];if(blocked&&blocked[n])continue;let c=CE[n];if(c===Infinity)continue;if(li!==land[n])c+=2;const nd=d+c;
        if(nd<dist[n]&&nd<=maxD){dist[n]=nd;prev[n]=i;src[n]=src[i];if(acc)sum[n]=sum[i]+acc[n];h.push(nd,n)}}}
    return {dist,prev,src,sum}}
  // 每個村莊綁到路程最近的同國市鎮；記下路程成本與沿路累積的盜匪壓力
  function bindMarkets(){mkt.fill(-1);mcost.fill(Infinity);mrisk.fill(0);mDs={};
    for(const k of Object.keys(markets))if(owner[+k]<0||!town[+k])delete markets[k];
    for(const f of fac){if(!f.alive)continue;const ts=[];for(const k in markets)if(owner[+k]===f.id)ts.push(+k);if(!ts.length)continue;
      const D=dijkstraMulti(ts,enemyMaskOf(f.id),bandit,45);mDs[f.id]=D;
      for(let i=0;i<N;i++)if(owner[i]===f.id&&D.dist[i]<Infinity){mkt[i]=D.src[i];mcost[i]=D.dist[i];mrisk[i]=D.sum[i]}}}
  // 運貨隊的路：從村莊沿最短路走回市鎮
  const cartPath=i=>{const D=mDs[owner[i]];const p=[i];if(!D)return p;for(let c=D.prev[i];c>=0;c=D.prev[c])p.push(c);return p};
  function buildFronts(){
    bc=FM(()=>FM(()=>0));front=FM(()=>FM(()=>[]));covet=FM(()=>FM(()=>false));
    for(const F of fac){if(!F.alive)continue;const a=F.id,dist=new Int8Array(N).fill(99),src=new Int16Array(N).fill(-1),q=[];
      for(let i=0;i<N;i++)if(owner[i]===a){dist[i]=0;src[i]=i;q.push(i)}
      for(let h=0;h<q.length;h++){const i=q[h];if(dist[i]>=3)continue;for(const n of NBR[i]){if(!land[n]||dist[n]<=dist[i]+1)continue;
        dist[n]=dist[i]+1;src[n]=src[i];const b=owner[n];
        if(b>=0&&b!==a){bc[a][b]+=dist[n]===1?1:.4;front[a][b].push([src[n],n,dist[n]]);if(vein[n]>0&&known[n]&&F.ratio.parts<.7)covet[a][b]=true}
        else q.push(n)}}}
    for(let a=0;a<FMAX;a++)for(let b=a+1;b<FMAX;b++){bc[a][b]=Math.max(bc[a][b],bc[b][a])}
  }
  // 戰爭目標：攻方前線附近、對自己最有價值的一格（礦、市集、林地、鹽田、沃土）
  function pickGoal(att,def){const cand=new Map();
    for(const [,n,dd] of front[att][def]){if(owner[n]!==def)continue;cand.set(n,Math.min(cand.get(n)??9,dd));
      for(const m of NBR[n])if(owner[m]===def&&!cand.has(m))cand.set(m,dd+1)}
    let best=-1,bv=-1e9,why='';
    for(const [t,d] of cand){const v=(vein[t]>0&&known[t]?3:0)+(town[t]?2+pop[t]/150:0)+(t===fac[def].cap?1:0)+timberK[t]/80+fert[t]*.8+waterK[t]*.6-.35*d-(markets[t]?.works?4:0)+(markets[t]?.vat||0)*1.5+Math.min(3,((markets[t]?.veh?.armor||0)+(markets[t]?.veh?.gt||0))*.15);
      if(v>bv){bv=v;best=t}}
    if(best>=0)why=markets[best]?.vat?'培養槽':vein[best]>0&&known[best]?'舊礦坑':town[best]?'市集':waterK[best]>.8?'水源':timberK[best]>60?'燃料林':'田地';
    return [best,why]}
  // ===== 年層：開年 =====
  function yearStart(y){
    // 天災
    if(rand()<.07){say(y,'disaster','大沙暴之年，寒漠一帶的聚落多有凍死、餓死的人。');for(let i=0;i<N;i++)if(owner[i]>=0&&temp[i]<.5)pop[i]*=fac[owner[i]].hardy?.86:.72}
    if(rand()<.03){const al=fac.filter(f=>f.alive);if(al.length){const f=pick(al);say(y,'disaster',`疫病在${f.n}蔓延。`,f.cap);for(let i=0;i<N;i++)if(owner[i]===f.id)pop[i]*=.6}}

    buildNet(y);
    for(const f of fac){f.walls=0;f.prod=zero();f.loss=0;f.pop=0;f.cold=0;f.frontsPrev=f.fronts;f.fronts=0;f.rsum=zero()}
    for(const k in markets)markets[k].rsum=zero();
    for(let i=0;i<N;i++)if(owner[i]>=0){const f=fac[owner[i]];f.pop+=pop[i];f.walls+=wall[i];if(temp[i]<.4)f.cold+=pop[i]}
    // 耐寒：寒漠人口過半的勢力習慣了冷夜，取暖的燃料少燒一半
    for(const f of fac)if(f.alive){const h=f.pop>0&&f.cold/f.pop>.5;if(h&&!f.hardy&&y>1&&f.born<y-1)say(y,'econ',`${f.n}的人多半生在寒漠，早已習慣了冷夜。`,f.cap);f.hardy=h}
    // 前線、緊張與宣戰（每年判斷一次）
    buildFronts();
    for(let a=0;a<FMAX;a++)for(let b=a+1;b<FMAX;b++){
      if(!fac[a].alive||!fac[b].alive){war[a][b]=null;continue}
      if(!bc[a][b]){tension[a][b]*=.9;if(war[a][b]){war[a][b]=null;say(y,'war',`${fac[a].n}與${fac[b].n}之間已經沒有人煙，戰事不了了之。`)}continue}
      if(!war[a][b]&&(fac[a].free||fac[b].free||sameRealm(a,b)||(fac[a].house&&fac[a].house===fac[b].house))){tension[a][b]*=.8;continue}
      if(!war[a][b]){tension[a][b]+=.4+rand()*1.6+Math.min(bc[a][b],20)*.06+(covet[a][b]||covet[b][a]?2:0)+Math.max(-1.5,Math.min(3,-hAff(fac[a].house,fac[b].house)*1.2))+(fac[a].bloc&&fac[b].bloc&&fac[a].bloc!==fac[b].bloc?1.5:0);
        if(tension[a][b]>30+rand()*25){
          let att,def;if(covet[a][b]&&!covet[b][a])[att,def]=[a,b];else if(covet[b][a]&&!covet[a][b])[att,def]=[b,a];else [att,def]=rand()<.5?[a,b]:[b,a];
          const [goal,why]=pickGoal(att,def);if(goal<0){tension[a][b]*=.6;continue}
          war[a][b]={att,def,goal,start:y,end:y+4+Math.floor(rand()*8),gain:{},score:0,siege:null,taken:[]};
          say(y,'war',`${fac[att].n}為了${nm(goal)}的${why}，向${fac[def].n}開戰。`,goal);
          const L=fac[def].liege;if(L>=0&&fac[L].alive&&L!==att)say(y,'war',`${fac[L].n}出兵援助附庸${fac[def].n}。`,goal)}}
      else{war[a][b].told=0;war[a][b].snowTold=false}}
  }

  // ===== 季層：生產、運輸、貿易、消耗、本季戰事 =====
  function season(y,s){
    for(let i=0;i<N;i++)if(owner[i]>=0)catchUp(i,T);   // 領地內的格子要先補算，才能照實際存量生產
    // 每座市鎮服務的人口：自己加上綁定的村莊
    for(const k in markets){const m=markets[k];m.pop=0;m.cold=0;m.walls=0}
    for(let i=0;i<N;i++){if(owner[i]<0)continue;const m=markets[mkt[i]];if(!m)continue;m.pop+=pop[i];m.walls+=wall[i];if(temp[i]<.4)m.cold+=pop[i]}
    // 煉鐵的燃料：同一座市鎮範圍內的林子一起供木炭（燒炭人只砍超過一半林木的部分，林子不會燒光）
    // 礦石多、林子少的地方煉不了那麼多，鐵就受木炭所限
    const oreOf=i=>{const p=pop[i];return [p*.006*(biome[i]===9?1:river[i]?.35:0),vein[i]>0?Math.min(vein[i],p*.0625):0]};
    const cop=t=>Math.max(0,timber[t]-.5*timberK[t])*.12;
    const oreM=new Float32Array(N),fuelM=new Float32Array(N),fOre=new Float32Array(N),fFuel=new Float32Array(N);
    const wild=new Int16Array(N).fill(-1);   // 領地邊上的無主林子也有人去燒炭
    for(let i=0;i<N;i++){const m=mkt[i];if(owner[i]<0||m<0)continue;const [b,v]=oreOf(i);oreM[m]+=b+v;fuelM[m]+=cop(i);
      for(const n of NBR[i])if(land[n]&&owner[n]<0&&wild[n]<0&&timberK[n]>0){wild[n]=m;catchUp(n,T);fuelM[m]+=cop(n)}}
    for(const k in markets){const t=+k;if(oreM[t]<=0||fuelM[t]<=0)continue;const sm=Math.min(oreM[t],fuelM[t]/CHAR);fOre[t]=sm/oreM[t];fFuel[t]=sm*CHAR/fuelM[t]}
    for(let n=0;n<N;n++)if(wild[n]>=0)timber[n]-=cop(n)*fFuel[wild[n]];
    // 樵夫會進領地外第二圈的無主林子砍柴（第一圈留給燒炭的人；只砍超過三成林木的部分，林子不會砍光），柴挑回最近的市鎮，路上損耗兩成
    {const wild2=new Int16Array(N).fill(-1);
      for(let i=0;i<N;i++){const m=mkt[i];if(owner[i]<0||m<0)continue;for(const n of NBR[i])if(wild[n]>=0)for(const x of NBR[n])if(land[x]&&owner[x]<0&&wild[x]<0&&wild2[x]<0&&timberK[x]>0){wild2[x]=m;catchUp(x,T)}}
      for(let n=0;n<N;n++){const m=wild2[n];if(m<0||!markets[m])continue;const cut=Math.min(Math.max(0,timber[n]-.3*timberK[n])*WILDCUT,timberK[n]*.02);if(cut<=0)continue;
        timber[n]-=cut;markets[m].stock.fuel+=cut*.8;if(owner[m]>=0)fac[owner[m]].prod.fuel+=cut*.8}}
    let robbedTold=0;
    for(let i=0;i<N;i++){if(owner[i]<0)continue;const f=fac[owner[i]],p=pop[i];
      const hunt=Math.min(game[i]*.08,p*.08*(s===3?.5:1));game[i]-=hunt;
      const out={food:p*1.5*fert[i]*HARVEST[s]+hunt,fuel:Math.min(timber[i]*WOODRATE,p*.1),parts:0,
        scrap:p*(biome[i]===3?.03:biome[i]===4?.02:.001),water:waterK[i]*p*(globalThis.WATERX??1)*WATERS[s],ammo:0};
      timber[i]-=out.fuel;
      // 零件：鹽沼、河床撿得到舊時代的碎料，舊礦坑拆得到整批的，按這一區燃料夠精煉多少出零件
      {const mm=mkt[i];if(mm>=0){const [b,v]=oreOf(i),fe=(b+v)*fOre[mm];timber[i]-=cop(i)*fFuel[mm];
        if(fe>0){out.parts+=fe;if(v>0){vein[i]-=v*fOre[mm];
          if(vein[i]<=.5){vein[i]=0;say(y,'econ',`${nm(i)}的舊礦坑能拆的都拆光了，就此廢棄。`,i)}}}}}
      for(const g of GOODS)f.prod[g]+=out[g];
      const mt=mkt[i],m=markets[mt];
      if(!m||owner[mt]!==owner[i]){const cm=markets[f.cap];if(cm&&owner[f.cap]===f.id)for(const g of GOODS)cm.stock[g]+=out[g]*.5;continue}   // 還沒綁上市場的新墾地：只有一半送得到首都
      if(mt===i||mcost[i]<=1.01){for(const g of GOODS)m.stock[g]+=out[g];continue}   // 市鎮本身或緊鄰的村：直接挑進市集
      const tk=(m.veh?.truck||0)>=1&&m.stock.fuel>1,c=(s===3?mcost[i]*1.3:mcost[i])*(tk?.6:1),goods={};if(tk)m.stock.fuel-=.0015*pop[i];
      for(const g of GOODS)goods[g]=out[g]*Math.max(.1,1-.012*c*WEIGHT[g]);
      if(live){stats.cart++;carts.push({from:i,to:mt,path:cartPath(i),pos:0,goods,f:owner[i],wait:Math.floor(rand()*PS*.75)});continue}
      // 歷史模式：整季一次結算，依沿路累積的盜匪壓力判定這趟有沒有被劫
      stats.cart++;
      if(rand()<1-Math.exp(-mrisk[i]/1500)){stats.cartLost++;for(const t of [i,...NBR[i]])bandit[t]=Math.min(100,bandit[t]+.4);
        if(!robbedTold&&rand()<.25){robbedTold=1;robSay(y,'c'+mt,`運往${nm(mt)}的${cargoName(goods)}車隊在${nm(i)}附近被掠奪者劫走。`,i)}continue}
      for(const g of GOODS)m.stock[g]+=goods[g]}
    // 載具：廠鎮什麼都造得出來；人口 200 以上的城只造得出卡車和衝鋒車。打仗的勢力多造戰車，平時多造卡車
    {const atwF=new Uint8Array(FMAX);for(let a=0;a<FMAX;a++)for(let b=a+1;b<FMAX;b++)if(war[a][b]&&fac[a].alive&&fac[b].alive){atwF[a]=1;atwF[b]=1}
    for(const k in markets){const t=+k,m=markets[k],o=owner[t];if(o<0||!fac[o].alive)continue;
      // 衝鋒車：真正的廢料車，誰都造得起——廢料焊一焊、裝上一點零件和油就能開
      if(atwF[o]){const g=garage(m);g.bomb=g.bomb||0;const n=Math.min(m.pop*.003,m.pop/50-g.rush-g.bomb,m.stock.scrap/1.5,m.stock.fuel/.2,m.stock.parts/.1);if(n>0){m.stock.scrap-=n*1.5;m.stock.fuel-=n*.2;m.stock.parts-=n*.1;
        // 一半綁上炸藥：先拆彈藥（0.3），不夠就用燃料土製（0.6）
        let nb=n*.5;const ua=Math.min(m.stock.ammo,nb*.3);m.stock.ammo-=ua;let rest=nb-ua/.3;const uf=Math.min(m.stock.fuel,rest*.6);m.stock.fuel-=uf;rest-=uf/.6;nb-=rest;
        g.bomb+=nb;g.rush+=n-nb}}
      if(fac[o].native)continue;
      const W_=m.works,bud0=W_?m.pop*.003:m.pop>=200?m.pop*.0008:0;if(bud0<.05)continue;
      const tense=atwF[o]||(fac[o].bloc&&y>=ARC.blocY);
      const mix=W_?(tense?{armor:.55,gt:.25,truck:.2}:{truck:.5,armor:.35,gt:.15}):{truck:1};
      const g=garage(m),want={truck:m.pop/120,armor:W_?m.pop/(tense?60:150):m.pop/400,rush:m.pop/80,gt:m.pop/(tense?250:600)};   // 夠用就不再造
      for(const v in mix)if(g[v]>=want[v])delete mix[v];const ms_=Object.values(mix).reduce((x,y)=>x+y,0);if(!ms_)continue;
      let bud=Math.min(bud0*ms_,m.stock.parts/.8,m.stock.fuel*.5/.8,m.stock.scrap/2);if(bud<.05)continue;m.stock.parts-=bud*.8;m.stock.fuel-=bud*.8;m.stock.scrap-=bud*2;   // 每點：零件 0.8、燃料 0.8、廢料 2（裝甲就是焊上去的廢料）
      for(const v in mix)g[v]+=bud*mix[v]/ms_/VCOST[v];
      if(W_&&tense&&!fac[o].armorY&&g.armor>=1){fac[o].armorY=y;say(y,'war',`${nm(t)}的廠區開始替${fac[o].n}焊裝甲、裝砲塔，第一支武裝車隊從廠門開了出來。`,t)}}
    // 沒有廠鎮的勢力打仗時，向不跟它打仗的廠鎮買車；付糧和水
    for(const f of fac){if(!f.alive||!atwF[f.id]||f.native||f.free)continue;if(Object.keys(markets).some(k=>owner[+k]===f.id&&markets[k].works))continue;
      let sel=-1,bd=99;for(const k in markets){const t=+k,o=owner[t];if(o<0||o===f.id||!markets[k].works||atWar(o,f.id)||!fac[o].alive)continue;const d=hdist(t,f.cap);if(d<bd){bd=d;sel=t}}
      if(sel<0)continue;const pts=Math.min(2,facStock(f.id,'food')/40,facStock(f.id,'water')/40);if(pts<.3)continue;
      facTake(f.id,'food',pts*20);facTake(f.id,'water',pts*20);markets[sel].stock.food+=pts*20;markets[sel].stock.water+=pts*20;
      vehGive(f.id,{armor:pts*.7/VCOST.armor,gt:pts*.3/VCOST.gt});
      const S_=fac[owner[sel]];S_.buyers=S_.buyers||{};if(!S_.buyers[f.id]){S_.buyers[f.id]=y;say(y,'econ',`${S_.n}開始把武裝車賣給${f.n}，收的是糧和水。`,sel)}}}
    // 彈藥：各市鎮的工坊把零件和燃料做成彈藥；廠鎮做得多
    for(const k in markets){const t=+k,m=markets[k];if(owner[t]<0)continue;const amt=Math.max(0,Math.min(m.pop*.006*(m.works?3:1),m.stock.parts*.25,m.stock.fuel*.25));
      m.stock.parts-=amt*.5;m.stock.fuel-=amt*.5;m.stock.ammo+=amt;fac[owner[t]].prod.ammo+=amt}
    // 各市鎮的需求與物價：存貨能撐的季數越少越貴
    for(const k in markets){const t=+k,m=markets[k],o=owner[t];if(o<0)continue;const f=fac[o],share=f.pop>0?m.pop/f.pop:0;
      // 平民用零件：越貴用得越省（修了再修），省下的用量改成多燒燃料
      const civBase=m.pop*IRON_CIV;m.civIron=civBase*Math.min(1.15,Math.max(.35,1/m.price.parts));
      m.need={food:m.pop*.25,fuel:m.pop*FIREWOOD+m.cold*(s===3?.05:s===1?0:.012)*(f.hardy?HARDY:1)+(civBase-m.civIron)*IRON_SUB,parts:m.civIron+f.frontsPrev*.25*share,scrap:m.pop*.002+m.walls*.05+share,water:m.pop*WATER_NEED,ammo:m.pop*.0005+f.frontsPrev*.3*share};
      for(const g of GOODS){const cover=m.stock[g]/Math.max(.01,m.need[g]*4),pr=Math.min(3.5,Math.max(.3,1/(.35+cover)));m.price[g]=m.price[g]*.6+pr*.4}}
    tradeSeason(y,s);
    // 消耗與腐壞
    for(const k in markets){const t=+k,m=markets[k];if(owner[t]<0)continue;
      let civUsed=0;
      for(const g of GOODS){const r=m.need[g]>0?Math.min(1,m.stock[g]/m.need[g]):1;m.rsum[g]+=r/4;if(g==='parts')civUsed=(m.civIron||0)*r;m.stock[g]=Math.max(0,m.stock[g]-m.need[g])}
      m.stock.parts+=civUsed*IRON_RECYCLE;   // 壞掉的東西拆了重用
      m.stock.food=Math.min(m.stock.food*.92,m.need.food*3);
      m.stock.fuel*=.96;m.stock.water*=.97;m.stock.parts*=.998;m.stock.ammo*=.995;m.stock.scrap=Math.min(m.stock.scrap,m.need.scrap*16+40);   // 廢料堆不下了就不再拆
      if(s===2)m.store=m.stock.food/Math.max(.01,m.pop*.25)}
    // 複製兵：有培養槽的勢力打仗時（或正被威脅時）用糧、水、零件養兵；養著的兵每季要吃喝，養不起就散掉
    for(const f of fac){if(!f.alive)continue;let vats=0;for(const k in markets)if(owner[+k]===f.id)vats+=markets[k].vat||0;f.vats=vats;
      let atw=0;for(let k=0;k<FMAX;k++)if(atWar(f.id,k))atw++;
      if(f.clones>0){const need=f.clones*CLONE_KEEP,fd=facTake(f.id,'food',need),wt=facTake(f.id,'water',need),r=Math.min(fd,wt)/Math.max(.01,need);rec(f.id,y,'keepFood',fd);rec(f.id,y,'keepWater',wt);if(r<.9){rec(f.id,y,'starved',f.clones*(.4-.4*r));f.clones*=.6+.4*r;if(r<.5&&rand()<.2)say(y,'war',`${f.n}養不起培養槽裡出來的兵，一批複製兵被放走了。`,f.cap)}}
      if(s===0&&!f.native&&f.taboo>0&&ARC.phase>=1)f.taboo=Math.max(0,f.taboo-.005);   // 一代一代，顧忌慢慢淡掉
      if(!vats||!(atw||f.frontsPrev>0||(f.bloc&&y>=ARC.blocY))||ARC.phase<1||f.native)continue;
      // 顧忌：培養槽做出來的是長官們的身體。越講體面的勢力越不肯拿它當兵；首府被圍、快撐不住時才破例
      let desp=f.shock>.6;for(let k=0;k<FMAX&&!desp;k++){const W_=war[Math.min(f.id,k)][Math.max(f.id,k)];if(W_&&W_.def===f.id&&W_.siege&&W_.siege.t===f.cap)desp=true}
      const tb=(f.taboo||0)*(globalThis.TABOO??1),use=desp?1:tb>=.5?0:1-tb;if(use<.05)continue;   // TABOO：實驗用的顧忌倍率
      const room=Math.max(0,vats*VAT_CAP-(f.clones||0));let n=Math.min(room,vats*VAT_RATE*use);if(n<1)continue;
      for(const g in CLONE_COST)n=Math.min(n,facStock(f.id,g)*.3/CLONE_COST[g]);if(n<1)continue;
      for(const g in CLONE_COST)facTake(f.id,g,n*CLONE_COST[g]);f.clones=(f.clones||0)+n;rec(f.id,y,'made',n);rec(f.id,y,'makeFood',n*CLONE_COST.food);rec(f.id,y,'makeParts',n*CLONE_COST.parts);
      if(!f.clonesY){f.clonesY=y;if((f.taboo||0)>=.3||desp&&(f.taboo||0)>=.15)(f.id===0||desp?sagaSay:(yy,tt,ti)=>say(yy,'war',tt,ti))(y,desp?`${nm(f.cap)}被圍到第 ${war.flat().find(W_=>W_&&W_.def===f.id&&W_.siege)?.siege.prog||1} 季，${f.n}打開了培養槽。第一批走出來的兵，長著的是${rulerT(f)}和課長們的臉。`:`${f.n}終於也開始拿培養槽養兵。沒有人公開說什麼，但那些兵長著的是長官們的臉。`,f.cap);
        else say(y,'war',`${f.n}開始用培養槽養兵：糧和水進去，拿得動槍的人出來。`,f.cap)}}
    // 本季戰事：每場戰爭每季一場戰鬥。兵力＝全國徵召（人口、零件、彈藥、糧），分攤到同時打的每場戰爭，再加上收編的兵
    {const fp=new Float32Array(FMAX),nw=new Uint8Array(FMAX);for(let i=0;i<N;i++)if(owner[i]>=0)fp[owner[i]]+=pop[i];
    for(let a=0;a<FMAX;a++)for(let b=a+1;b<FMAX;b++)if(war[a][b]&&fac[a].alive&&fac[b].alive){nw[a]++;nw[b]++}
    const lev=f=>{const F=fac[f];return fp[f]*.08*(.45+.3*F.ratio.parts+.25*F.ratio.ammo)*(.7+.3*Math.min(1,F.ratio.food))/Math.max(1,nw[f])+F.merc+(F.clones||0)*(.6+.4*F.ratio.ammo)};
    // 援軍：封臣出兩成五兵力跟宗主打仗；封臣被打時，宗主派一半兵力來救
    const vas=FM(()=>[]);for(const F of fac)if(F.alive&&F.liege>=0&&fac[F.liege].alive)vas[F.liege].push(F.id);
    const ally=(f,foe,def)=>{let x=0;for(const v of vas[f])if(v!==foe)x+=lev(v)*.25;const L=fac[f].liege;if(def&&L>=0&&fac[L].alive&&L!==foe)x+=lev(L)*.5;return x};
    // 主將：封地離戰場最近的領主帶兵；沒有封地的英雄當作從首都出發
    const cmdr=(f,at)=>{let b=null,bd=1e9;for(const h of heroes)if(h.alive&&h.f===f&&!h.noCmd&&!h.captive){const d=hdist(h.fief>=0?h.fief:fac[f].cap,at)+rand()*3;if(d<bd){bd=d;b=h}}return b};
    const kill=(f,amt)=>{const F=fac[f];if(F.clones>0){const c=Math.min(F.clones,amt*.7);F.clones-=c;amt-=c;rec(f,y,'cloneDead',c)}rec(f,y,'popDead',Math.min(.06,amt/Math.max(1,fp[f]))*fp[f]);const r=Math.min(.06,amt/Math.max(1,fp[f]));if(r<=0)return;for(let t=0;t<N;t++)if(owner[t]===f)pop[t]*=1-r;fp[f]*=1-r};
    for(let a=0;a<FMAX;a++)for(let b=a+1;b<FMAX;b++){const W=war[a][b];if(!W||!fac[a].alive||!fac[b].alive||W.done)continue;
      if(owner[W.goal]===W.att){W.done=1;continue}if(owner[W.goal]!==W.def){W.done=2;continue}
      // 戰壕（預設開啟；globalThis.TRENCH=0 關掉）：雙方在前線上自己這一側挖壕，每季加深一點，要用廢料撐壕壁
      if(globalThis.TRENCH!==0){for(const [x,y_] of [[W.att,W.def],[W.def,W.att]]){let dug=0;for(const [,nn] of front[y_][x]){if(owner[nn]!==x||trench[nn]>=3||dug>=6)continue;if(facStock(x,'scrap')<1)break;facTake(x,'scrap',.5);trench[nn]=Math.min(3,trench[nn]+.25);trench[nn]>=1&&!W.tTold&&(W.tTold=1,say(y,'war',`${fac[a].n}與${fac[b].n}在${nm(nn)}一帶都挖了壕溝，戰線卡住了。`,nn));dug++}}}
      let A=W.att,D=W.def,counter=false,prs;
      // 守方兵多時會反攻，想把這場戰爭丟掉的地方拿回來
      if(lev(D)>lev(A)*1.3&&rand()<.5){const back=front[D][A].filter(([i,n])=>owner[i]===D&&owner[n]===A&&W.taken.includes(n));if(back.length){counter=true;[A,D]=[D,A];prs=back}}
      if(!counter)prs=front[A][D].filter(([i,n])=>owner[i]===A&&owner[n]===D);
      if(!prs.length)continue;
      let pr=prs[Math.floor(rand()*prs.length)];
      if(!counter){let bs=1e9;for(const q of prs){const sc=hdist(q[1],W.goal)+(q[2]-1)*1.5+rand()*.5;if(sc<bs){bs=sc;pr=q}}}
      const [i,n,dd]=pr;
      let wf=1-.18*(dd-1);if(s===3){const t=Math.min(temp[i],temp[n]);
        if(t<.35){if(!W.snowTold&&!W.snow){W.snowTold=true;W.snow=1;say(y,'war',`寒季的沙暴封住了路，${fac[a].n}與${fac[b].n}在${nm(n)}一帶的戰事每到寒季就停下來。`,n)}continue}
        if(t<.55){wf*=.65;pop[i]*=.93}}
      fac[A].fronts++;fac[D].fronts++;
      let dT=99;for(const k in markets)if(owner[+k]===A)dT=Math.min(dT,hdist(+k,n));
      const LA=lev(A),LD=lev(D),xA=ally(A,D,false),xD=ally(D,A,true),sup=1/(1+.08*dT);
      const hA=cmdr(A,n),hD=cmdr(D,n),kA=hA?hA.skill+wbon(hA):1,kD=hD?hD.skill+wbon(hD):1,rA=.6+rand(),rD=.6+rand();
      const tm=1+.15*(res[n]-1),wm=1+.3*wall[n],mil=pop[n]*.4;
      // 載具：要燒燃料；戰鬥卡車帶油、送油、廣播（省油、補給線拉得長、士氣）
      const VA=vehOf(A),VD=vehOf(D),vt=VTERR[biome[n]]??.5,nw2=f=>Math.max(1,nw[f]);
      const vpow=(f,V)=>{for(const v of VEH)V[v]/=nw2(f);const need=VEH.reduce((x,v)=>x+V[v]*VFUEL[v],0)*(1-Math.min(.5,V.gt*.05));let fr=1;
        if(need>.1){const got=facTake(f,'fuel',need);fr=Math.min(1,got/need);if(fr<.3&&V.armor+V.rush*.3>=3&&(!fac[f].dryY||y-fac[f].dryY>=10)){fac[f].dryY=y;say(y,'war',`燃料見底，${fac[f].n}的車隊停在${nm(n)}一帶動不了。`,n)}}
        return {fr,p:VEH.reduce((x,v)=>x+V[v]*VPOW[v],0)*vt*fr,mor:1+Math.min(.2,V.gt*.04),sup:Math.min(.6,V.gt*.1)}};
      const PA=vpow(A,VA),PD=vpow(D,VD),supA=1/(1+.08*dT*(1-PA.sup)),tr=globalThis.TRENCH!==0?trench[n]:0;
      // 炸藥車（造衝鋒車時一半綁上炸藥）：遇到壕溝全數衝上去引爆；衝成功的（三到七成）每輛填平 0.15 級壕溝、守方戰力 −5%（最多 −40%）、炸死 3 人
      let bombs=0,boomOk=0;
      if(tr&&globalThis.BOMB!==0&&VA.bomb>=.5){bombs=VA.bomb;vehLose(A,{truck:0,armor:0,rush:0,gt:0,bomb:1/nw2(A)});
          boomOk=bombs*(.3+rand()*.4);trench[n]=Math.max(0,trench[n]-boomOk*.15);
          if(!fac[A].bombY){fac[A].bombY=y;say(y,'war',`${fac[A].n}把炸藥綁在衝鋒車上，一輛接一輛衝進${nm(n)}的壕溝。`,n)}}
      const tr2=globalThis.TRENCH!==0?trench[n]:0;
      if(tr2){PA.p*=1-.25*tr2}   // 反戰車壕：攻方的車開不過去
      const sa=(LA+xA+PA.p)*fac[A].aggr*wf*supA*kA*rA*PA.mor,sd=((LD+xD)*.8+mil+PD.p*.9)*tm*wm*kD*rD*PD.mor*(1+.3*tr2)*(1-Math.min(.4,boomOk*.05));
      const siege=!counter&&(town[n]||wall[n]>=1);
      let win,lose,dead,took=false,note='';
      if(sa>sd){win=A;lose=D;dead=LD*.12;
        if(siege){if(!W.siege||W.siege.t!==n)W.siege={t:n,prog:0};W.siege.prog++;const m=markets[n];if(m)m.stock.food*=.6;
          const need=1+Math.round(wall[n])+(n===fac[D].cap?1:0),starving=m&&m.stock.food<m.pop*.2;
          if(W.siege.prog>=need||(starving&&W.siege.prog>=1)){took=true;note=starving?`，${nm(n)}斷糧開門`:`，${nm(n)}在圍城 ${W.siege.prog} 季後陷落`;W.siege=null}
          else note=`，${nm(n)}被圍`}
        else took=true}
      else{win=D;lose=A;dead=LA*.12*(1+.4*tr2);if(siege&&W.siege&&W.siege.t===n)W.siege.prog=Math.max(0,W.siege.prog-1)}
      W.score+=win===W.att?1:-1;
      if(globalThis.BSTAT){const cA=(fac[A].clones||0)*(.6+.4*fac[A].ratio.ammo),cD=(fac[D].clones||0)*(.6+.4*fac[D].ratio.ammo);globalThis.BSTAT.push({y,b:biome[n],siege:siege?1:0,town:town[n]?1:0,wall:wall[n],tr,tr2,bombs,boomOk,rushA:VA.rush,armA:VA.armor,aw:win===A?1:0,took:took?1:0,sa,sd,vA:PA.p/(LA+xA+PA.p||1),vD:PD.p/((LD+xD)*.8+mil+PD.p*.9||1),cA:cA/(LA+xA+PA.p||1),cD:cD/((LD+xD)*.8+mil+PD.p*.9||1),dead,ctr:counter?1:0})}
      if(globalThis.CSTAT)for(const [f,L,x,P] of [[A,LA,xA,PA],[D,LD,xD,PD]]){const F=fac[f],cl=(F.clones||0)*(.6+.4*F.ratio.ammo);rec(f,y,'battles',1);rec(f,y,'wins',f===win?1:0);rec(f,y,'strTot',L+x+P.p);rec(f,y,'strClone',cl);rec(f,y,'strVeh',P.p);rec(f,y,'strMerc',F.merc||0)}
      // 載具的損失：衝鋒車打一仗就耗掉一大半；敗方的武裝車被打爆或被勝方開走
      {const used=f=>({truck:0,armor:Math.min(1,1/nw2(f)),rush:Math.min(1,1/nw2(f)),gt:Math.min(1,1/nw2(f))});
        const uL=used(lose),uW=used(win),dryL=(lose===A?PA:PD).fr<.5;const lostL=vehLose(lose,{truck:0,armor:(dryL?.3:.15)*uL.armor,rush:.7*uL.rush,gt:.12*uL.gt,bomb:.7*uL.rush});vehLose(win,{truck:0,armor:.08*uW.armor,rush:.45*uW.rush,gt:.04*uW.gt,bomb:.45*uW.rush});
        // 沒油的武裝車只能丟在原地
        const took2={armor:lostL.armor*(dryL?.6:.3),gt:lostL.gt*.3};if(took2.armor>0){vehGive(win,took2);if(took2.armor>=.3&&!W.vtold){W.vtold=1;say(y,'war',dryL?`${fac[lose].n}的武裝車在${nm(n)}燒乾了油，被丟在原地，${fac[win].n}加滿油就開走了。`:`${nm(n)}之戰後，${fac[win].n}開走了${fac[lose].n}丟下的武裝車。`,n)}}}
      if(xD>0&&fac[D].liege>=0)fac[D].helped=1;
      const hw=win===A?hA:hD,hl2=win===A?hD:hA;if(hw){hw.battles++;hw.wins++;for(const wp of weaponsOf(hw))wp.wins++;hw.fame=(hw.fame||0)+.25+Math.min(1.75,trafNear(n)/FAMEK);hw.lastWin=n}if(hl2)hl2.battles++;
      kill(lose,dead);kill(win,dead*.4);if(boomOk)kill(D,boomOk*3);pop[i]*=.96;
      if(took&&n===ARC.protect){took=false;note=`，${nm(n)}久圍不下`}
      if(took&&markets[n]?.vat){const m=markets[n],dc=fac[D].cap;
        if(dc!==n&&owner[dc]===D&&markets[dc]&&rand()<.35){markets[dc].vat=(markets[dc].vat||0)+m.vat;say(y,'war',`城破之前，${fac[D].n}把${nm(n)}的 ${m.vat} 座培養槽拆下來，連夜運回${nm(dc)}。`,n);m.vat=0}
        else say(y,'war',`${nm(n)}的 ${m.vat} 座培養槽落入${fac[A].n}手中。`,n)}
      if(took&&markets[n]?.veh){const g=markets[n].veh;for(const v of VEH)g[v]*=v==='truck'?.6:.4}
      if(took){owner[n]=A;if(markets[n])for(const g of GOODS)markets[n].stock[g]*=.6;pop[n]*=.6;wall[n]=Math.max(0,wall[n]-1);W.gain[A]=(W.gain[A]||0)+1;
        if(counter)W.taken=W.taken.filter(x=>x!==n);else W.taken.push(n)}
      // 戰場繳獲：敗方陣亡者身上的零件與彈藥，勝方撿回六成；敗方得從庫存補發裝備
      const gear=dead*.03*(.3+.7*fac[lose].ratio.parts),loot=gear*.6;
      facGive(win,'parts',loot);facGive(win,'ammo',loot*.5);facTake(lose,'parts',gear*.5);
      if(!W.told||W.told<3&&(took||siege)){W.told=(W.told||0)+1;
        say(y,'war',`${SEASON[s]}，${nm(n)}之戰：${fac[win].n}擊敗${fac[lose].n}${counter&&win===A?`，收復${nm(n)}`:took?(note||(dd>1?`，遠征軍奪下${nm(n)}`:`，奪下${nm(n)}`)):note||(win===D&&wall[n]>=1?`，${nm(n)}的防壁擋住了攻勢`:'')}${loot>=.5?`，繳獲零件 ${loot.toFixed(1)} 箱`:''}。`,n)}
      let fell='';
      const LF=hl2?fac[hl2.f]:null,bk=LF&&(LF.taboo||0)>=.4&&markets[LF.cap]?.vat>0&&owner[LF.cap]===LF.id&&(hl2.backups||0)<2&&y-(hl2.backupY??-99)>=8;
      if(hl2&&bk&&!(hl2.plot&&ARC.phase<3)&&rand()<.22){hl2.backups=(hl2.backups||0)+1;hl2.backupY=y;facTake(LF.id,'parts',3);
        (notable(hl2)?sagaSay:(yy,tt,ti)=>say(yy,'hero',tt,ti))(y,`${LF.n}的${hl2.name}在${nm(n)}陣亡。三天後，${hl2.name}在${nm(LF.cap)}的培養槽裡醒來，記得的事停在上一次備份那天。`,LF.cap)}
      else if(hl2&&!(hl2.plot&&ARC.phase<3)&&rand()<.22){const h=hl2,wl=weaponsOf(h);fell=h.name;
        for(const wp of wl){const r=rand();if(r<.45&&hw&&hw.alive)giveW(wp,hw,y,`${h.name}戰死於${nm(n)}，「${wp.name}」被${fac[win].n}的${hw.name}奪走。`);else if(r<.75)loseW(wp,n,y,`${h.name}戰死於${nm(n)}，「${wp.name}」遺落在戰場上。`)}
        graves.push({tile:n,y,name:h.name});
        if(h.legend)sagaSay(y,`${h.title}${h.name}戰死於${nm(n)}。`,n);else if(!wl.length)say(y,'hero',`${fac[lose].n}的${h.name}戰死於${nm(n)}。`,n);
        if(hw)hAffAdd(hs(h),hs(hw),-.5);heroDies(h,y,`戰死於${nm(n)}`)}
      else if(hl2&&!hl2.plot&&!hl2.captive&&!hl2.noCmd&&rand()<.12){hl2.captive={by:win,y};for(const wp of weaponsOf(hl2))if(hw&&hw.alive&&rand()<.5)giveW(wp,hw,y,`${hl2.name}在${nm(n)}被俘，「${wp.name}」落入${hw.name}手中。`);say(y,'hero',`${fac[lose].n}的${hl2.name}在${nm(n)}兵敗被俘。`,n)}
      // 戰史：記下雙方兵力與各項加成，供統計頁查看
      battles.push({y,s,a:A,d:D,an:fac[A].n,dn:fac[D].n,t:n,b:biome[n],dd,ctr:counter?1:0,LA:Math.round(LA),LD:Math.round(LD),xA:Math.round(xA),xD:Math.round(xD),mil:Math.round(mil),
        ag:+fac[A].aggr.toFixed(2),wf:+wf.toFixed(2),sup:+sup.toFixed(2),tm:+tm.toFixed(2),wm:+wm.toFixed(2),kA:+kA.toFixed(2),kD:+kD.toFixed(2),rA:+rA.toFixed(2),rD:+rD.toFixed(2),
        sa:Math.round(sa),sd:Math.round(sd),win:win===A?'a':'d',took:took?1:0,siege:siege?1:0,note,dead:Math.round(dead),hA:hA?hA.name:'',hD:hD?hD.name:'',fell});
      if(battles.length>320){const big=battles.slice().sort((p,q)=>(q.LA+q.LD+q.xA+q.xD)-(p.LA+p.LD+p.xA+p.xD)).slice(0,40);battles=[...new Set([...big,...battles.slice(-200)])].sort((p,q)=>p.y-q.y||p.s-q.s)}}}
    if(s===3){
      for(const k in markets){const t=+k,m=markets[k];if(owner[t]<0)continue;m.ratio={...m.rsum};
        if(m.ratio.food<.8){const h_=(.8-m.ratio.food)*12;famineH[t]+=h_;for(const n of NBR[t])if(land[n])famineH[n]+=h_*.5}
        if(m.ratio.food<.8&&y>=m.famineCD){say(y,'econ',`${nm(t)}一帶糧食短缺，飢民四散。`,t);m.famineCD=y+8}
        if(m.ratio.water<.8&&y>=(m.thirstCD||0)){say(y,'econ',`${nm(t)}的井水不夠喝，有人開始往別處走。`,t);m.thirstCD=y+8}}
      for(const f of fac){if(!f.alive)continue;const ms=[];for(const k in markets)if(owner[+k]===f.id)ms.push(markets[k]);
        const tp=ms.reduce((x,m)=>x+m.pop,0)||1;f.ratio=zero();f.price=zero();f.store=0;
        for(const m of ms){const w=m.pop/tp;for(const g of GOODS){f.ratio[g]+=m.ratio[g]*w;f.price[g]+=m.price[g]*w}f.store+=m.store*w}
        if(!ms.length){f.ratio=one();f.price=one()}
        if(f.ratio.fuel<.6&&f.cold>20&&y>=f.woodCD&&rand()<.3){f.woodCD=y+12;say(y,'econ',`${f.n}燃料不足，寒季的夜裡凍死了人。`,f.cap)}}
      const agg={};routeTiles=new Set();
      for(const fl of flows){const key=fl.a+'-'+fl.b;(agg[key]=agg[key]||{a:fl.a,b:fl.b,path:fl.path,flow:zero(),sea:fl.sea}).flow[fl.g]+=fl.amt;for(const t of fl.path)routeTiles.add(t)}
      routes=Object.values(agg);flows=[]}
  }

  // ===== 被劫的商隊：附近的盜匪因此坐大；沒有盜匪的地方，劫商隊的人可能就此起家 =====
  // 回傳 true 表示已經寫了故事，呼叫端不必再寫一般的遭劫紀錄
  function cvRobbed(y,S,T,g,amt,path){
    let t=-1;for(const x of path)if(land[x]&&(t<0||bandit[x]>bandit[t]))t=x;if(t<0)return false;
    const v=amt*BASEP[g];let G=null,bd=4;for(const x of gangs)if(!x.gone){const d=hdist(x.lair,t);if(d<bd){bd=d;G=x}}
    if(G){G.loot=(G.loot||0)+v;bandit[G.lair]=Math.min(100,bandit[G.lair]+Math.min(12,v/4));
      if(!G.made&&G.loot>=BIGLOOT){G.made={y,from:S,to:T,g};say(y,'bandit',`${gWho(G)}在${nm(t)}劫下${nm(S)}往${nm(T)}的一整支${GN[g]}商隊，靠這批貨招兵買馬，從此坐大。`,t);return true}
      return false}
    if(bandit[t]<25||rand()>.02||gangs.filter(x=>!x.gone).length>=3+2*MK*MK)return false;
    let lair=owner[t]<0?t:-1;if(lair<0)for(const n of NBR[t])if(land[n]&&owner[n]<0){lair=n;break}if(lair<0)return false;
    const nG={id:nextGang++,name:heroName(),lair,str:0,born:y,loot:v,made:{y,from:S,to:T,g}};gangs.push(nG);bandit[lair]=Math.min(100,bandit[lair]+30);
    say(y,'bandit',`${nG.name}帶人在${nm(t)}劫了${nm(S)}往${nm(T)}的${GN[g]}商隊，拿這批貨在${nm(lair)}拉起了一支人馬。`,lair);return true}

  // ===== 商隊：每座市鎮每季找一筆最划算的買賣，沿實際道路運去別的市鎮 =====
  function tradeSeason(y,s){const ts=Object.keys(markets).map(Number).filter(t=>owner[t]>=0);
    for(const S of ts){const ms=markets[S],oS=owner[S],D=townNet[S];if(!D)continue;let best=null;const TK=(ms.veh?.truck||0)>=1&&ms.stock.fuel>(ms.veh.truck*.3)?ms.veh.truck:0;
      for(const T of ts){if(T===S||atWar(oS,owner[T]))continue;let cost=D.dist[T];if(cost===undefined)continue;if(s===3)cost*=1.3;if(TK)cost*=.6;const mt=markets[T];
        for(const g of GOODS){const eff=effOf(cost,g,0);if(eff<.3)continue;
          const gain=mt.price[g]*eff-ms.price[g]*1.15;if(gain<=0)continue;
          const amt=Math.min(3+ms.pop*.012+TK*3,ms.stock[g]-ms.need[g]*2,(mt.need[g]*4-mt.stock[g])/eff);if(amt<.3)continue;
          const v=gain*amt*BASEP[g];if(!best||v>best.v)best={T,g,amt,eff,v}}}
      if(!best)continue;
      const T=best.T,oT=owner[T],path=D.path[T],sea=path.some(t=>!land[t]);
      if(TK)ms.stock.fuel-=Math.min(TK,best.amt/3)*.3;ms.stock[best.g]-=best.amt;flows.push({a:S,b:T,g:best.g,amt:best.amt,path,sea});
      {const v=best.amt*BASEP[best.g];for(let k=0;k<path.length;k++){traffic[path[k]]+=v;if(k){const a=Math.min(path[k-1],path[k]),b=Math.max(path[k-1],path[k]);edgeT[a+'-'+b]=(edgeT[a+'-'+b]||0)+v}}}
      if(oS!==oT){const a=Math.min(oS,oT),b=Math.max(oS,oT);tension[a][b]=Math.max(0,tension[a][b]-best.amt*.08)}
      const key=S+'>'+T+best.g;
      if(routeSeen[key]===undefined||y-routeSeen[key]>15){const mid=path.filter(t=>land[t]&&t!==S&&t!==T);
        say(y,'trade',`${nm(S)}的商隊${sea?'經鹼海':mid.length?`經${nm(mid[Math.floor(mid.length/2)])}`:''}把${GN[best.g]}運往${oS!==oT?fac[oT].n+'的':''}${nm(T)}。`,S)}
      routeSeen[key]=y;
      const cv={from:S,to:T,g:best.g,amt:best.amt*best.eff,path,pos:0,f:oS,wait:live?Math.floor(rand()*PS*.5):0};
      if(live){stats.cv++;caravans.push(cv);continue}
      const risk=path.reduce((x,t)=>x+bandit[t]+(atWar(owner[t],oS)?40:0),0);
      stats.cv++;
      if(rand()<1-Math.exp(-risk/1500)){stats.cvLost++;if(!cvRobbed(y,S,T,best.g,best.amt,path))robSay(y,'v'+S+'>'+T,`${nm(S)}往${nm(T)}的${GN[best.g]}商隊在半路遭劫。`,S);continue}
      markets[T].stock[best.g]+=cv.amt}}

  // ===== 盜匪擴散：歷史模式一年算一步，線上模式每時段算 1/112 步 =====
  function banditStep(frac){
    const nb=new Float32Array(N);
    for(let i=0;i<N;i++){if(!land[i])continue;let b=bandit[i]*.76,k=0;
      for(const n of NBR[i]){if(land[n])b+=bandit[n]*.04/res[i]*1.2;if(owner[n]>=0)k++}
      if(owner[i]<0){b+=k*1.35+([4,6,8,9].includes(biome[i])?1.2:0);if(k===0)b*=.9}
      else{b-=pop[i]*.05+wall[i]*2;if(NBR[i].some(n=>land[n]&&owner[n]<0))b+=.6}
      nb[i]=Math.max(0,Math.min(100,b))}
    for(let i=0;i<N;i++)bandit[i]+=(nb[i]-bandit[i])*frac;
  }

  // ===== 年層：歲末 =====
  function yearEnd(y){
    for(let i=0;i<N;i++){traffic[i]*=.93;famineH[i]*=.97}
    for(const k in edgeT){edgeT[k]*=.93;if(edgeT[k]<.5)delete edgeT[k]}
    // 2. 生態：全部補算到年底，再做獵物遷徙與砍伐判定
    for(let i=0;i<N;i++)catchUp(i,T);
    for(let i=0;i<N;i++){if(!land[i]||gameK[i]<=0)continue;let s2=0,c=0;for(const n of NBR[i])if(gameK[n]>0){s2+=game[n]/gameK[n];c++}
      if(c)game[i]=Math.max(0,Math.min(gameK[i],game[i]+.1*(s2/c-game[i]/gameK[i])*gameK[i]))}
    for(let i=0;i<N;i++){if(biome[i]!==6)continue;
      if(timber[i]<timberK[i]*.2){if(++deforest[i]>15){biome[i]=7;fert[i]=Math.min(1.3,1+(river[i]?.35:0));
          timberK[i]=8;timber[i]=Math.min(timber[i],8);gameK[i]=gameK[i]*.6;game[i]=Math.min(game[i],gameK[i]);
          say(y,'econ',`${nm(i)}的油棘林被砍光，成了光禿的旱原。`,i)}}else deforest[i]=0}
    // 3. 人口
    for(let i=0;i<N;i++)if(owner[i]>=0){const f=fac[owner[i]],R=tileRatio(i),cap=fert[i]*100+5,fr=R.food;
      if(fr>=.95)pop[i]+=pop[i]*.2*(1-pop[i]/cap);else pop[i]*=.85+.15*fr;
      if(temp[i]<.4)pop[i]*=.97+.03*R.fuel;
      if(R.water<.9)pop[i]*=.9+.1*R.water;
      pop[i]-=bandit[i]*.06;if(pop[i]>peak[i])peak[i]=pop[i]}

    // 3b. 市鎮的興衰：首府永遠是市鎮；人口多、有水脈／靠海／在商路上、附近沒有同勢力市鎮的聚落會發展成市鎮
    for(const f of fac)if(f.alive&&owner[f.cap]===f.id&&!town[f.cap]){town[f.cap]=1;markets[f.cap]=markets[f.cap]||newMarket()}
    {const nT=FM(()=>0),nL=FM(()=>0);for(let i=0;i<N;i++)if(owner[i]>=0){nL[owner[i]]++;if(town[i])nT[owner[i]]++}
    for(let i=0;i<N;i++){const o=owner[i];if(o<0)continue;
      if(town[i]){if(markets[i]&&owner[i]!==o)continue;
        if(pop[i]<15&&i!==fac[o].cap){town[i]=0;const m=markets[i];delete markets[i];const cm=markets[fac[o].cap];if(m&&m.vat&&cm)cm.vat=(cm.vat||0)+m.vat;if(m&&cm)for(const g of GOODS)cm.stock[g]+=m.stock[g]*.5;nT[o]--;say(y,'found',`${nm(i)}的市集蕭條，退回小聚落。`,i)}
        continue}
      if(pop[i]<40||nT[o]>=1+Math.floor(nL[o]/7))continue;
      if(!(river[i]||w.coast[i]||routeTiles.has(i)))continue;
      const SP=globalThis.TSP??4;let near=false;for(const k in markets)if((SP>3||owner[+k]===o)&&hdist(i,+k)<=SP){near=true;break}if(near)continue;
      town[i]=1;markets[i]=newMarket();nT[o]++;say(y,'found',`${nm(i)}商旅往來漸多，發展成${fac[o].n}的市鎮。`,i)}}

    // 3e. 沒人打仗的壕溝會被沙埋掉
    for(let i=0;i<N;i++)if(trench[i]>0)trench[i]=trench[i]*.8<.05?0:trench[i]*.8;
    // 3d. 載具保養：每年要零件，沒有就壞掉一部分；本來就會慢慢折舊
    for(const k in markets){const m=markets[k];if(!m.veh||owner[+k]<0)continue;const g=m.veh,need=VEH.reduce((x,v)=>x+g[v]*VKEEP[v],0);const got=Math.min(need,m.stock.parts);m.stock.parts-=got;
      const r=need>0?got/need:1;for(const v of VEH)g[v]*=(v==='rush'||v==='bomb'?.75:.95)-(1-r)*.15}   // 衝鋒車是拼裝貨，放著也會爛
    // 3c. 培養槽好搬：人口多的城遲早會有人運一座過來
    for(const k in markets){const t=+k,m=markets[k],o=owner[t];if(o<0||m.vat||m.pop<(globalThis.VATPOP??250)||rand()>.08)continue;m.vat=1;say(y,'econ',`有人把一座培養槽運進${nm(t)}，${fac[o].n}多了一處能養兵的地方。`,t)}
    // 4. 防壁：廢料夠就加固首府與前線
    for(const f of fac){if(!f.alive)continue;
      if(f.ratio.scrap<.8)for(let i=0;i<N;i++)if(owner[i]===f.id&&wall[i]>0)wall[i]=Math.max(0,wall[i]-.05);
      for(let k=0;k<2&&facStock(f.id,'scrap')>25;k++){let best=-1,bs=0;
        for(let i=0;i<N;i++){if(owner[i]!==f.id||wall[i]>=3)continue;
          const front=NBR[i].some(n=>owner[n]>=0&&owner[n]!==f.id);const sc=(i===f.cap?3:0)+(front?2:0)+pop[i]/50-wall[i]*1.2;
          if((i===f.cap||front)&&sc>bs){bs=sc;best=i}}
        if(best<0)break;const before=Math.floor(wall[best]);wall[best]=Math.min(3,Math.floor(wall[best])+1);facTake(f.id,'scrap',25);
        if(before===0)say(y,'build',best===f.cap?`${f.n}在首府${nm(best)}用廢料築起防壁。`:`${f.n}在邊境的${nm(best)}用廢料築起防壁。`,best);
        else if(wall[best]>=3&&before<3)say(y,'build',`${nm(best)}的防壁加到三重，成了${f.n}的堡壘。`,best)}}

    // 5. 拓殖
    const order=[...Array(N).keys()];for(let k=N-1;k>0;k--){const j=Math.floor(rand()*(k+1));const t=order[k];order[k]=order[j];order[j]=t}
    for(const i of order){if(owner[i]<0)continue;const cap=fert[i]*100+5;
      if(pop[i]>Math.max(20,cap*.45)&&rand()<.3){let best=-1,bs=.3;
        for(const n of NBR[i]){if(!land[n]||owner[n]>=0||bandit[n]>=26)continue;if(COLR<99){let ok=false;for(const k in markets)if(owner[+k]===owner[i]&&hdist(n,+k)<=COLR){ok=true;break}if(!ok)continue}
          const sc=fert[n]+(vein[n]>0&&known[n]?.8:0)+timber[n]/250+game[n]/150+waterK[n]*.3+([3,4].includes(biome[n])?.15:0);if(sc>bs){bs=sc;best=n}}
        if(best>=0){owner[best]=owner[i];pop[best]=12;pop[i]-=10;
          if(ruin[best]){ruin[best]=0;say(y,'found',`${fac[owner[i]].n}的拓荒者回到${nm(best)}的廢墟。`,best)}}}}
    // 拓殖限制開啟時：偶爾有人遠行，在 4–7 格外有水的地方另立一座新市鎮（新的綠洲）
    if(COLR<99)for(const f of fac){if(!f.alive||f.pop<300||rand()>(globalThis.OPR??.06))continue;const own=Object.keys(markets).map(Number).filter(t=>owner[t]===f.id);if(!own.length)continue;
      let best=-1,bs=0;for(let i=0;i<N;i++){if(!land[i]||owner[i]>=0||bandit[i]>=30||!(river[i]||w.coast[i]))continue;let d=99;for(const t of own)d=Math.min(d,hdist(i,t));if(d<(globalThis.OPD??5)||d>(globalThis.OPD??5)+4)continue;let dm=99;for(const t in markets)dm=Math.min(dm,hdist(i,+t));if(dm<(globalThis.TSP??3))continue;
        const sc=fert[i]+(river[i]?.3:0)-d*.03+rand()*.2;if(sc>bs){bs=sc;best=i}}
      if(best>=0&&bs>.7){owner[best]=f.id;pop[best]=30;peak[best]=30;town[best]=1;markets[best]=newMarket();say(y,'found',`${f.n}的拓荒者走得很遠，在${nm(best)}打了井，立起新的聚落。`,best)}}
    for(let i=0;i<N;i++){if(owner[i]<0||vein[i]>0||(biome[i]!==3&&biome[i]!==4)||rand()>.0006)continue;
      vein[i]=vcap[i]=120+rand()*280;vex[i]=1;known[i]=1;say(y,'econ',`${fac[owner[i]].n}的人在${nm(i)}挖開一座被沙埋住的舊設施，裡面能拆的東西不少。`,i)}
    for(let i=0;i<N;i++){if(owner[i]<0)continue;for(const n of [i,...NBR[i]])if(vein[n]>0&&!known[n]){known[n]=1;say(y,'econ',`${fac[owner[i]].n}的探子在${nm(n)}找到一座舊礦坑。`,n)}}

    // 6. 掠奪者
    if(!live)banditStep(1);
    if(gangs.filter(g=>!g.gone).length<3+2*MK*MK&&rand()<.3){let bi=-1,bv=35;for(let i=0;i<N;i++)if(owner[i]<0&&bandit[i]>bv&&!gangs.some(g=>hdist(g.lair,i)<=2)){bv=bandit[i];bi=i}
      if(bi>=0&&!gangs.some(g=>hdist(g.lair,bi)<=2)){bandit[bi]=Math.min(100,bandit[bi]+25);const g={id:nextGang++,name:heroName(),lair:bi,str:0,born:y};gangs.push(g);say(y,'bandit',`掠奪者頭目${g.name}在${nm(bi)}聚眾。`,bi)}}
    let raids=0;
    for(let i=0;i<N;i++)if(owner[i]>=0&&bandit[i]>20&&rand()<.2/(1+wall[i])){pop[i]*=.62;if(markets[mkt[i]])markets[mkt[i]].stock.food*=.95;if(raids++<2)say(y,'bandit',`掠奪者洗劫了${nm(i)}。`,i)}
    for(let i=0;i<N;i++)if(owner[i]>=0&&pop[i]<3){owner[i]=-1;pop[i]=0;wall[i]=0;if(town[i]){town[i]=0;delete markets[i]}
      if(peak[i]>=20){ruin[i]=1;say(y,'ruin',`${nm(i)}人煙散盡，化為廢墟。`,i)}peak[i]=0}

    // 7. 戰爭結束
    for(let a=0;a<FMAX;a++)for(let b=a+1;b<FMAX;b++){const W=war[a][b];if(!W)continue;
        const A=W.att,D=W.def,G=W.goal;let msg=null;
        if(W.done===1||owner[G]===A){msg=`${fac[D].n}承認失去${nm(G)}，與${fac[A].n}停火。`;
          // 兵力懸殊的話，敗方還得成為附庸、按年進貢
          let pA=0,pD=0;for(let i=0;i<N;i++){if(owner[i]===A)pA+=pop[i];else if(owner[i]===D)pD+=pop[i]}
          if(fac[D].alive&&fac[A].liege<0&&fac[D].liege<0&&pA>pD*2.5&&rand()<.6){makeVassal(D,A,y);msg=`${fac[D].n}讓出${nm(G)}，並成為${fac[A].n}的附庸，按年進貢。`}}
        else if(W.done===2||owner[G]!==D)msg=`${nm(G)}已不在${fac[D].n}手中，${fac[A].n}與${fac[D].n}罷兵。`;
        else if(W.score<=-4){msg=`${fac[A].n}久攻${nm(G)}不下，撤兵求和。`;fac[A].shock+=.4}
        else if(y>=W.end){const ga=W.gain[A]||0,gd=W.gain[D]||0;msg=ga-gd>=2?`${fac[D].n}割地求和，${fac[A].n}收兵。`:gd-ga>=2?`${fac[A].n}得不償失，向${fac[D].n}求和。`:`${fac[A].n}與${fac[D].n}議和，各自收兵。`;
          if(gd>ga)fac[A].shock+=.3}
        if(msg){war[a][b]=null;tension[a][b]=-15;say(y,'war',msg,G);hAffAdd(fac[a].house,fac[b].house,-.25)}
    }
    for(const f of fac){if(!f.alive)continue;if(owner[f.cap]!==f.id){let best=-1,bp=-1;
        // 遷都先找自己還有的市鎮，沒有市鎮才找人最多的村子
        for(const t in markets)if(owner[+t]===f.id&&markets[t].pop>bp){bp=markets[t].pop;best=+t}
        if(best<0)for(let i=0;i<N;i++)if(owner[i]===f.id&&pop[i]>bp){bp=pop[i];best=i}
        if(best<0){const conq=owner[f.cap];facFall(f,y,conq);f.alive=false;f.diedY=y;say(y,'war',`${f.n}的最後一座城鎮失守，${f.n}就此覆滅。`,f.cap);for(const h of heroes)if(h.f===f.id&&h.alive){h.fief=-1;heroDies(h,y,'勢力覆滅後下落不明',{conq})}
          for(const x of fac)if(x.alive&&x.liege===f.id){x.liege=-1;say(y,'war',`宗主${f.n}覆滅，${x.n}重獲自主。`,x.cap)}}
        else{say(y,'war',`${f.n}的首府${nm(f.cap)}陷落，撤到${nm(best)}。`,best);f.cap=best;f.shock+=1;
          if(!town[best]){town[best]=1;markets[best]=markets[best]||newMarket()}}}}
    if(!live)politics(y)   // 線上模式挪到開年第二個時段，分散計算量
    for(const f of fac)if(f.alive&&rand()<.035){const h=mkHero(f.id,y);say(y,'hero',`${h.name}在${f.n}嶄露頭角。`,f.cap)}
    for(const h of heroes)if(h.alive&&!(h.plot&&ARC.phase<4)&&rand()<(h.legend?.006+Math.max(0,y-h.born-50)*.009:.01+Math.max(0,y-h.born-20)*.007)){const place=h.fief>=0?h.fief:fac[h.f].cap;if(h.legend)sagaSay(y,`${h.title}${h.name}在${nm(place)}過世，享年 ${y-h.born} 歲。`,place);else if(h.wins>=2||h.fief<0)say(y,'hero',`${fac[h.f].n}的老兵${h.name}在${nm(place)}過世。`,place);heroDies(h,y,`在${nm(place)}過世`)}
    // 只留下活著的英雄，和戰功或封地值得記一筆的死者
    if(heroes.length>260){const keep=heroes.filter(h=>h.legend).concat(heroes.filter(h=>!h.legend&&(h.alive||h.wins>=3||h.ruled||h.famed)).sort((p,q)=>(q.alive-p.alive)||(q.wins-p.wins)).slice(0,240));heroes.splice(0,heroes.length,...keep)}
  }

  // ===== 政局：離心自立、小國歸附、盜匪幫派 =====
  function politics(y){
    legendYear(y);
    // 7b. 轄區：首府以外的每座市鎮都有一位課長；沒有就從自己人裡挑，或提拔新人
    for(const k in markets){const t=+k,m=markets[k],o=owner[t];if(o<0||!fac[o].alive||t===fac[o].cap){if(m.lord){const h=heroById(m.lord);if(h&&h.fief===t)h.fief=-1;m.lord=0}continue}
      let h=m.lord?heroById(m.lord):null;if(h&&(!h.alive||h.f!==o||h.fief!==t)){if(h.fief===t)h.fief=-1;h=null;m.lord=0}
      if(!h){h=heroes.filter(x=>x.alive&&x.f===o&&x.fief<0).sort((p,q)=>q.skill-p.skill)[0]||mkHero(o,y);h.fief=t;m.lord=h.id;
        if(m.pop>=150&&rand()<.4)say(y,'hero',`${fac[o].n}任命${h.name}為${nm(t)}的課長。`,t)}}
    // 8. 離心：離首府遠、地盤太大、鬧饑荒、打敗仗、爭權，地方就會坐大，最後自立
    for(const f of fac){if(!f.alive||f.free)continue;if(f.id===0&&ARC.phase<4)continue;let tiles=0;for(let i=0;i<N;i++)if(owner[i]===f.id)tiles++;
      const ts=Object.keys(markets).map(Number).filter(t=>owner[t]===f.id&&t!==f.cap);
      if(ts.length>=2&&rand()<.004){f.crisis=y;say(y,'war',`${f.n}的${rulerT(f)}突然死了，幾個副手爭著接位，各地人心浮動。`,f.cap)}
      for(const t of ts){const m=markets[t],d=hdist(t,f.cap);
        const lord=m.lord?heroById(m.lord):null;
        const u=(d-5)*.04+tiles/100*.1+(m.ratio.food<.85?.2:0)+(f.crisis===y?.6:0)+f.shock*.4+(lord?(.5-lord.loyal)*.3:0);
        m.unrest=(m.unrest||0)*.7+Math.max(0,u);
        if(m.unrest>1.2+rand()*.8&&m.pop>=100&&y>=(m.revoltCD||0))secede(f,t,y,f.crisis===y?'趁上頭爭權':m.ratio.food<.85?'飢荒之下':f.shock>.5?'眼看上頭撐不住了':'離首府太遠')}
      f.shock*=.5;f.merc*=.8}
    // 7c. 附庸：每年向宗主進貢；宗主太弱、敗仗、貢賦太重會讓附庸離心，忠心夠久的小附庸則和平併入
    {const cnt=new Int16Array(FMAX);for(let i=0;i<N;i++)if(owner[i]>=0)cnt[owner[i]]++;
    for(const V of fac){if(!V.alive||V.liege<0)continue;const L=fac[V.liege];if(!L.alive){V.liege=-1;continue}
      const fd=facTake(V.id,'food',facStock(V.id,'food')*.12),fe=facTake(V.id,'parts',facStock(V.id,'parts')*.12);facGive(L.id,'food',fd);facGive(L.id,'parts',fe);
      V.loyal+=(rand()-.5)*.12-(cnt[V.id]>cnt[L.id]*.4?.05:0)-L.shock*.2+(V.helped?.1:0);   // 忠誠會隨世局起伏V.helped=0;V.loyal=Math.max(0,Math.min(1,V.loyal));
      if(V.loyal<.15&&rand()<.35){const l=L.id;V.liege=-1;V.loyal=1;
        say(y,'war',`${V.n}停止向${L.n}進貢，宣布獨立。`,V.cap);const a=Math.min(l,V.id),b=Math.max(l,V.id);
        war[a][b]={att:l,def:V.id,goal:V.cap,start:y,end:y+3+Math.floor(rand()*5),gain:{},score:0,siege:null,taken:[]};say(y,'war',`${L.n}派兵問罪。`,V.cap);continue}
      if(V.loyal>.85&&y-V.lsince>=40&&cnt[V.id]<=8&&rand()<.08){for(let i=0;i<N;i++)if(owner[i]===V.id)owner[i]=L.id;
        const ruler=heroes.find(h=>h.alive&&h.f===V.id);for(const h of heroes)if(h.alive&&h.f===V.id){h.f=L.id;h.fief=-1}
        if(ruler&&markets[V.cap]){ruler.fief=V.cap;markets[V.cap].lord=ruler.id}
        facFall(V,y,L.id);V.alive=false;V.diedY=y;V.liege=-1;for(let k=0;k<FMAX;k++){const a=Math.min(k,V.id),b=Math.max(k,V.id);if(a!==b)war[a][b]=null}
        say(y,'war',`${V.n}和平併入${L.n}${ruler?`，原${rulerT(V)}${ruler.name}改任${nm(V.cap)}的課長`:''}。`,V.cap)}}}
    // 小勢力歸附：只剩幾格的小勢力，被鄰近的大勢力吞併
    {const cnt=new Int16Array(FMAX);for(let i=0;i<N;i++)if(owner[i]>=0)cnt[owner[i]]++;
    for(const f of fac){if(!f.alive||f.free||cnt[f.id]>3||y-f.born<10||rand()>.1)continue;let g=-1,gv=0;
      for(let i=0;i<N;i++)if(owner[i]===f.id)for(const n of NBR[i]){const o=owner[n];if(o>=0&&o!==f.id&&!fac[o].free&&!atWar(o,f.id)&&cnt[o]>=cnt[f.id]*4&&cnt[o]>gv){gv=cnt[o];g=o}}
      if(g<0||f.liege>=0)continue;
      if(cnt[f.id]>=2&&fac[g].liege<0){makeVassal(f.id,g,y);say(y,'war',`${f.n}勢單力孤，成了${fac[g].n}的附庸。`,f.cap);continue}
      for(let i=0;i<N;i++)if(owner[i]===f.id)owner[i]=g;facFall(f,y,g);f.alive=false;f.diedY=y;cnt[g]+=cnt[f.id];cnt[f.id]=0;
      for(let k=0;k<FMAX;k++){const a=Math.min(k,f.id),b=Math.max(k,f.id);if(a!==b)war[a][b]=null}
      for(const x of fac)if(x.alive&&x.liege===f.id)x.liege=-1;
      say(y,'war',`${f.n}勢單力孤，整個併入${fac[g].n}。`,f.cap)}}
    // 9. 掠奪者與原住民：火併、收編、自立
    gangYear(y);
    if(ARC.blocY&&y>=ARC.blocY)blocYear(y)}
  // 地方自立：以市鎮為首，帶走綁在它市集上的聚落，佔用一個預留勢力欄位；舊主立刻出兵討伐
  function freeSlot(y){return fac.find(x=>!x.alive&&x.id>=FDEF.length&&y-x.diedY>20)}
  function newState(slot,y,name,cap,tiles,aggr){
    if(fac.some(x=>x.alive&&x.n===name)){const alt=STATE_SUF.map(x=>name.replace(/(軍政府|自治區|保安區|公社|管區|自由城)$/,'')+x).find(n=>!fac.some(z=>z.alive&&z.n===n));name=alt||'新'+name}
    Object.assign(slot,{taboo:0,clones:0,clonesY:0,league:0,bloc:0,free:0,works:0,native:0,n:name,alive:true,cap,aggr,ruler:0,house:'',liege:-1,loyal:1,lsince:y,helped:0,ratio:one(),price:one(),prod:zero(),born:y,fronts:0,frontsPrev:0,famineCD:0,woodCD:0,shock:0,merc:0,crisis:-1,pop:0,loss:0,cold:0});
    for(const t of tiles)owner[t]=slot.id;
    for(let k=0;k<FMAX;k++){const a=Math.min(k,slot.id),b=Math.max(k,slot.id);if(a!==b){tension[a][b]=0;war[a][b]=null}}
    if(!town[cap]){town[cap]=1;markets[cap]=markets[cap]||newMarket()}}
  function secede(f,t,y,why){const slot=freeSlot(y),m=markets[t];
    if(!slot){m.unrest=0;m.revoltCD=y+30;for(let i=0;i<N;i++)if(mkt[i]===t&&owner[i]===f.id)pop[i]*=.9;say(y,'war',`${nm(t)}一帶${why}，起兵反抗${f.n}，很快就被壓下去。`,t);return}
    const tiles=[];for(let i=0;i<N;i++)if(owner[i]===f.id&&mkt[i]===t&&i!==f.cap)tiles.push(i);
    const lord=m.lord?heroById(m.lord):null;
    newState(slot,y,nm(t)+pick(STATE_SUF),t,tiles,.8+rand()*.6);slot.taboo=(f.taboo||0)*.7;slot.ratio={...m.ratio};slot.price={...m.price};m.unrest=0;
    for(const x of fac)if(x.alive&&x.liege===slot.id)x.liege=-1;
    if(lord&&lord.alive){lord.f=slot.id;lord.fief=-1;m.lord=0;slot.ruler=lord.id;slot.house=hs(lord);lord.ruled=1;hAffAdd(hs(lord),f.house,-.6);say(y,'war',`${f.n}的${nm(t)}${lord.title||'課長'}${lord.name}${why}，據城自立，號${slot.n}。`,t)}
    else say(y,'war',`${nm(t)}一帶${why}，宣布脫離${f.n}自立，號${slot.n}。`,t);
    const a=Math.min(f.id,slot.id),b=Math.max(f.id,slot.id);
    war[a][b]={att:f.id,def:slot.id,goal:t,start:y,end:y+3+Math.floor(rand()*6),gain:{},score:0,siege:null,taken:[]};
    say(y,'war',`${f.n}出兵討伐${slot.n}。`,t)}
  // 盜匪幫派：每股有個山寨（盜匪最濃的那格），勢力＝山寨一帶的盜匪壓力
  function gangYear(y){
    const near=(t,r)=>{const o=[t];for(const n of NBR[t]){o.push(n);if(r>1)for(const m of NBR[n])if(!o.includes(m))o.push(m)}return o};
    for(const g of gangs){let b=g.lair;for(const n of NBR[g.lair])if(land[n]&&owner[n]<0&&bandit[n]>bandit[b])b=n;g.lair=b;
      if(owner[g.lair]>=0){g.str=0;continue}
      bandit[g.lair]=Math.min(100,bandit[g.lair]+6);for(const n of NBR[g.lair])if(land[n])bandit[n]=Math.min(100,bandit[n]+2);
      g.str=near(g.lair,1).reduce((x,t)=>x+bandit[t],0)+weapons.filter(w=>w.gang===g.id).length*80+Math.min(160,(g.loot||0)*LOOTSTR);g.loot=(g.loot||0)*.85}
    for(const g of gangs)if(g.str<60&&!g.gone&&!g.native){g.gone=1;if(rand()<.4)say(y,'bandit',`${gWho(g)}的據點人心散了，手下各奔東西。`,g.lair)}
    // 火併：兩股人馬的據點離得近，就會為地盤打起來
    for(const g of gangs)for(const h of gangs){if(g===h||g.gone||h.gone||g.id>h.id||hdist(g.lair,h.lair)>4||rand()>.25)continue;
      const [W,L]=g.str*(.6+rand())>h.str*(.6+rand())?[g,h]:[h,g];
      for(const t of near(L.lair,1))bandit[t]*=.55;L.str*=.5;bandit[W.lair]=Math.min(100,bandit[W.lair]+8);
      if(!L.native&&(L.str<70||rand()<.4)){L.gone=1;L.toGang=W.id;W.str+=L.str*.5;say(y,'bandit',`${gWho(W)}吞併了${gWho(L)}的人馬。`,W.lair)}
      else if(rand()<.3)say(y,'bandit',`${gWho(W)}和${gWho(L)}在${nm(L.lair)}一帶火併，${L.name}敗走。`,L.lair)}
    // 收編：附近的勢力打仗缺人、或被搶怕了，就拿糧和零件去換掠奪者歸順（原住民不吃這套）
    for(const g of gangs){if(g.gone||g.native)continue;let f=null,bd=4;
      for(const t of near(g.lair,2))if(owner[t]>=0&&fac[owner[t]].alive&&!fac[owner[t]].free){const d=hdist(t,g.lair);if(d<bd){bd=d;f=fac[owner[t]]}}
      if(!f)continue;let atWarN=0;for(let k=0;k<FMAX;k++)if(atWar(f.id,k))atWarN++;
      if(rand()>(atWarN?.35:.12))continue;
      const food=g.str*.25,iron=g.str*.015;
      if(g.str>260&&rand()<.5){if(rand()<.4)say(y,'bandit',`${f.n}派人去收編${g.name}，被一口回絕。`,g.lair);continue}
      if(facStock(f.id,'food')<food*2||facStock(f.id,'parts')<iron)continue;
      facTake(f.id,'food',food);facTake(f.id,'parts',iron);g.gone=1;g.to=f.id;f.merc+=g.str*.6;
      for(const t of near(g.lair,1))bandit[t]*=.25;
      if(land[g.lair]&&owner[g.lair]<0){owner[g.lair]=f.id;pop[g.lair]=15;peak[g.lair]=15;ruin[g.lair]=0}
      say(y,'bandit',`${f.n}收編了${gWho(g)}，${nm(g.lair)}的據點改成哨站。`,g.lair)}
    // 欠餉譁變：收編的人拿不到糧就跑回荒野
    for(const f of fac){if(!f.alive||f.merc<20||f.ratio.food>.75||rand()>.3)continue;
      let t=-1;for(let k=0;k<20&&t<0;k++){const c=Math.floor(rand()*N);if(land[c]&&owner[c]<0&&NBR[c].some(n=>owner[n]===f.id))t=c}
      if(t<0)continue;f.merc*=.3;bandit[t]=Math.min(100,bandit[t]+40);
      const g={id:nextGang++,name:heroName(),lair:t,str:0,born:y};gangs.push(g);say(y,'bandit',`${f.n}收編的人領不到糧，跟著${g.name}跑回${nm(t)}的荒野。`,t)}
    // 各自為王：勢大的掠奪者、手上有遺產級的人、趁亂起事的原住民，佔地成為一方勢力
    for(const g of gangs){if(g.gone)continue;const leg=weapons.some(w=>w.gang===g.id);
      const ok=g.native?(ARC.phase>=4&&g.str>=230&&rand()<.06):leg?(g.str>=180&&rand()<.08):(g.str>=330&&rand()<.02);if(!ok)continue;
      if(Object.keys(markets).some(t=>hdist(+t,g.lair)<=2))continue;/* 據點就在城邊，立不了 */const slot=freeSlot(y);if(!slot)break;
      const tiles=near(g.lair,1).filter(t=>land[t]&&owner[t]<0);for(const t of tiles){pop[t]=Math.max(pop[t],20);peak[t]=Math.max(peak[t],pop[t]);bandit[t]*=.2;ruin[t]=0}
      const boss=g.native?g.chief||heroName():g.name;
      newState(slot,y,g.native?g.name:hs(g)+pick(['幫','軍','團']),g.lair,tiles,1.5);if(g.native)slot.native=1;g.gone=1;g.to=slot.id;g.rose=1;
      {const k=mkHero(slot.id,y-30,boss);k.ruled=1;k.skill=+(k.skill+.2).toFixed(2);slot.ruler=k.id;slot.house=hs(k)}
      if(g.native)sagaSay(y,`${g.name}的${boss}在${nm(g.lair)}立起營地，宣告這片土地從來就不屬於企業。`,g.lair);
      else say(y,'bandit',`${gWho(g)}在${nm(g.lair)}佔地為王，號${slot.n}。${g.made?.legacy?`起家靠的就是那件遺產級「${g.made.legacy}」。`:g.made?`當年就是在${g.made.y}年劫了${nm(g.made.from)}往${nm(g.made.to)}的${GN[g.made.g]}商隊起家的。`:''}`,g.lair)}
    for(const g of gangs)if(g.gone)for(const wp of weapons)if(wp.gang===g.id){
      if(g.to>=0&&g.to!==undefined&&fac[g.to].alive)toTreasury(wp,g.to,y,g.rose?null:`${g.name}的據點散了，遺產級「${wp.name}」歸了${fac[g.to].n}。`);
      else if(g.toGang){const W2=gangs.find(x=>x.id===g.toGang);if(W2)toGang(wp,W2,y,`${W2.name}吞併了${g.name}，奪得遺產級「${wp.name}」。`);else loseW(wp,g.lair,y,`遺產級「${wp.name}」在據點的廢墟裡失落。`)}
      else loseW(wp,g.lair,y,`${g.name}的據點人去樓空，遺產級「${wp.name}」被埋在${nm(g.lair)}的沙裡。`)}
    gangs=gangs.filter(g=>!g.gone)}
  // 一年一年推演：觀看網頁用 begin() 開局，再每次呼叫 stepYear() 推進一年（runHistory 就是把它跑 YEARS 次）
  let histY=0;
  function begin(){initLegends();histY=0}
  function stepYear(){const y=++histY;yearStart(y);for(let s=0;s<4;s++){T+=PS;season(y,s)}yearEnd(y);snaps.push(makeSnap());
    if(globalThis.CSTAT){const P=new Float32Array(FMAX),Tl=new Int16Array(FMAX);for(let i=0;i<N;i++)if(owner[i]>=0){P[owner[i]]+=pop[i];Tl[owner[i]]++}for(const f of fac)if(f.alive){rec(f.id,y,'pop',P[f.id]);rec(f.id,y,'tiles',Tl[f.id]);rec(f.id,y,'clones',f.clones||0);rec(f.id,y,'food',f.ratio.food+1e-6);rec(f.id,y,'water',f.ratio.water+1e-6)}}}
  function runHistory(){begin();for(let y=1;y<=YEARS;y++)stepYear()}

  // ===== 線上模式：時段層與即時層（角色：NPC 與玩家走同一套行動介面）=====
  let actors=[],story=0,lastComputed=0,nextId=1,ownerHist=[];
  const night=()=>T%4===3,curSeason=()=>Math.floor((T%PY)/PS);
  const isTown=i=>owner[i]>=0&&town[i]===1&&!!markets[i];
  function moveCost(n){let c=Math.ceil(MOVE[biome[n]]*(river[n]?.6:1));if(night())c+=1;return c}
  const alog=(a,text,tile=a.tile,pub=false)=>{const e={ts:stamp(),text};a.log.push(e);if(a.log.length>20)a.log.shift();if(pub)say(curY,'npc',`${a.name}：${text}`,tile)};
  const ROLE={hunter:'獵人',woodcutter:'樵夫',miner:'礦工',trader:'行商',bounty:'賞金獵人'};
  function homeCap(a){const f=fac[a.home];if(f&&f.alive)return f.cap;const F=fac.filter(f=>f.alive).sort((p,q)=>q.pop-p.pop)[0];a.home=F.id;return F.cap}
  function spawnActor(role,human=false){
    const alive=fac.filter(f=>f.alive),F=alive[Math.floor(rand()*alive.length)];
    let mask=0;const st=Math.floor(rand()*4),len=rand()<.3?3:2;for(let k=0;k<len;k++)mask|=1<<((st+k)%4);
    const a={id:nextId++,name:pick(SUR)+givName(),role,human,home:F.id,tile:F.cap,ap:24,hp:100,food:5,fuel:2,parts:1,water:0,silver:15,
      camped:false,hungry:false,mask,skipDay:false,careful:.4+rand()*.6,target:-1,cargo:null,deaths:0,log:[]};
    for(const n of [a.tile,...NBR[a.tile]])catchUp(n,T);
    actors.push(a);alog(a,`以${ROLE[role]}身分在${F.n}的${nm(a.tile)}落腳。`);return a}
  function startLive(npcCount=25){live=true;curY=YEARS+1;yearStart(curY);
    const roles=['hunter','hunter','woodcutter','miner','trader','bounty'];
    for(let k=0;k<npcCount;k++)spawnActor(roles[k%roles.length]);
    if(npcCount>0)say(curY,'npc',`${npcCount} 名旅人陸續來到這片土地。`)}
  function respawn(a){const cap=homeCap(a);a.deaths++;
    alog(a,`倒在${nm(a.tile)}。醒來時已被人抬進${nm(cap)}城裡，身上值錢的東西都沒了。`,a.tile,true);
    Object.assign(a,{tile:cap,hp:60,food:2,fuel:0,silver:0,water:0,ap:0,camped:false,target:-1,cargo:null})}
  function encounter(a){const i=a.tile,nightMul=night()?1.8:1,camp=a.camped?.35:1,town=isTown(i)?.25:1,asleep=!a.human&&!online(a)&&!a.camped?1.6:1;
    const pb=bandit[i]/160*nightMul*camp*town*asleep*(1+story);
    const pw=owner[i]<0&&gameK[i]>0?game[i]/(gameK[i]+30)*.12*nightMul*camp*(1+story):0;
    const r=rand();
    if(r<pb){story=Math.min(story,-.2);const mine=(.5+a.parts*.12+a.hp/250+(a.role==='bounty'?.4:0))*(.6+rand())*(online(a)?1:.6),foe=(.35+bandit[i]/90)*(.6+rand());
      if(mine>foe){const g=Math.round(3+rand()*8);a.silver+=g;bandit[i]=Math.max(0,bandit[i]-4);a.hp-=Math.round(rand()*8);
        alog(a,`${night()?'夜裡':''}一夥盜匪在${nm(i)}圍上來，被打退了，搜出 ${g} 銀。`,i,true)}
      else{const dmg=15+Math.round(rand()*20),lost=Math.floor(a.silver/2);a.hp-=dmg;a.silver-=lost;a.food=Math.max(0,a.food-1);
        alog(a,`${!online(a)&&!a.camped?'睡夢中':''}在${nm(i)}${night()?'被趁夜':'被'}盜匪襲擊，受了傷（生命 -${dmg}），被搶走 ${lost} 銀。`,i,true)}}
    else if(r<pb+pw){const dmg=6+Math.round(rand()*12);a.hp-=dmg;
      if(rand()<.5){a.food+=1;alog(a,`狼群在${nm(i)}撲來，砍倒一頭，生命 -${dmg}，多了一份肉。`)}else alog(a,`狼群在${nm(i)}撲來，負傷逃開（生命 -${dmg}）。`)}}
  const online=a=>a.human?true:!a.skipDay&&!!(a.mask&(1<<(T%4)));
  function act(a,kind,arg){const i=a.tile,need=c=>{if(a.ap<c)return false;a.ap-=c;return true};
    if(kind==='move'){const n=arg;if(!NBR[i].includes(n)||!land[n])return '只能移動到相鄰的陸地格。';const c=moveCost(n);if(!isFinite(c))return '雪峰無法通行。';
      if(!need(c))return `AP 不足（需要 ${c}）。`;a.tile=n;a.camped=false;for(const m of [n,...NBR[n]])catchUp(m,T);encounter(a);if(a.hp<=0)respawn(a);return `走到${nm(n)}（-${c} AP）。`}
    if(kind==='hunt'){if(gameK[i]<=0)return '這裡沒有獵物。';if(!need(3))return 'AP 不足（需要 3）。';
      const t=Math.min(game[i]*.2,1+rand()*2);game[i]-=t;a.food+=t;return `獵到 ${t.toFixed(1)} 份肉。`}
    if(kind==='chop'){if(timber[i]<1)return '這裡沒有可砍的樹。';if(!need(3))return 'AP 不足（需要 3）。';
      const t=Math.min(timber[i]*.1,1+rand()*2);timber[i]-=t;a.fuel+=t;return `砍了 ${t.toFixed(1)} 捆柴。`}
    if(kind==='mine'){if(vein[i]<=0)return '這裡沒有礦脈。';if(!need(4))return 'AP 不足（需要 4）。';
      if(!known[i]){known[i]=1;alog(a,`在${nm(i)}發現一條鐵礦脈。`,i,true)}
      const t=Math.min(vein[i],.5+rand());vein[i]-=t;a.parts+=t;if(vein[i]<=.5){vein[i]=0;say(curY,'econ',`${nm(i)}的鐵礦脈被挖掘殆盡。`,i)}return `挖出 ${t.toFixed(1)} 擔鐵。`}
    if(kind==='camp'){if(a.camped)return '已經紮營了。';if(!need(2))return 'AP 不足（需要 2）。';a.camped=true;return '紮營。'}
    if(kind==='sell'){if(!isTown(i))return '這裡沒有市集。';if(!need(1))return 'AP 不足。';
      const F=markets[i],keep={food:2,fuel:1,parts:a.role==='bounty'?1:0,water:0},parts=[];let g=0;
      for(const k of ['food','fuel','parts','water']){const q=Math.max(0,a[k]-keep[k]);if(q<.1)continue;const v=q*BASEP[k]*F.price[k];g+=v;F.stock[k]+=q;a[k]-=q;parts.push(`${GN[k]} ${q.toFixed(1)}`)}
      if(!parts.length)return '沒有多餘的東西可賣。';a.silver+=g;if(g>=25)alog(a,`在${nm(i)}賣出${parts.join('、')}，得 ${g.toFixed(0)} 銀。`,i,true);return `賣出${parts.join('、')}，得 ${g.toFixed(1)} 銀。`}
    if(kind==='buy'){const g=arg||'food',q=g==='food'?3:Math.min(6,Math.floor(a.silver/(BASEP[g]*(markets[i]?.price[g]||1)*1.1)));
      if(!isTown(i))return '這裡沒有市集。';const F=markets[i],price=BASEP[g]*F.price[g]*1.1;
      if(q<1||F.stock[g]<q+1)return `${nm(i)}買不到${GN[g]}。`;if(a.silver<price*q)return '錢不夠。';if(!need(1))return 'AP 不足。';
      a.silver-=price*q;F.stock[g]-=q;a[g]=(a[g]||0)+q;return `花 ${(price*q).toFixed(1)} 銀買了 ${q} 份${GN[g]}。`}
    if(kind==='raid'){if(bandit[i]<10)return '這裡沒什麼盜匪。';if(!need(4))return 'AP 不足（需要 4）。';
      const mine=(.6+a.parts*.15+a.hp/200)*(.6+rand()),foe=(.3+bandit[i]/70)*(.6+rand());
      if(mine>foe){const g=Math.round(bandit[i]/6+rand()*6);a.silver+=g;bandit[i]=Math.max(0,bandit[i]-10);alog(a,`清剿${nm(i)}的盜匪窩，領到 ${g} 銀賞金。`,i,true);return '清剿成功。'}
      const dmg=12+Math.round(rand()*18);a.hp-=dmg;alog(a,`清剿${nm(i)}的盜匪失敗，負傷撤退（生命 -${dmg}）。`,i,true);if(a.hp<=0)respawn(a);return '清剿失敗。'}
    return ''}
  // ---- NPC 的腦：每個時段上線時把 AP 花掉 ----
  function nearest(i,ok,r=99){let best=-1,bd=1e9;for(let n=0;n<N;n++){if(!ok(n))continue;const d=hdist(i,n);if(d<bd&&d<=r){bd=d;best=n}}return best}
  function bestNear(i,score,r){let best=-1,bs=0;for(let n=0;n<N;n++){if(!land[n])continue;const d=hdist(i,n);if(d>r)continue;const s=score(n)/(1+d*.35);if(s>bs){bs=s;best=n}}return best}
  function stepToward(a,t){if(t<0||t===a.tile)return false;let best=-1,bd=1e9;
    for(const n of NBR[a.tile]){if(!land[n])continue;const c=moveCost(n);if(!isFinite(c)||c>a.ap)continue;const d=hdist(n,t)*4+c+bandit[n]/25;if(d<bd){bd=d;best=n}}
    if(best<0||hdist(best,t)>=hdist(a.tile,t)+1)return false;act(a,'move',best);return true}
  function brain(a){for(let k=0;k<10&&a.ap>0&&a.hp>0;k++){const i=a.tile,town=isTown(i);
      // 生存優先：缺糧或重傷就回城
      if(a.food<1.5||a.hp<35){if(town){if(a.food<3&&act(a,'buy','food').startsWith('花'))continue;if(a.food>2.5&&a.hp>=35)continue;if(act(a,'sell').startsWith('賣'))continue;break}
        if(a.food<1.5&&gameK[i]>0&&game[i]>3&&a.ap>=3){act(a,'hunt');continue}
        if(!stepToward(a,nearest(i,isTown,12)))break;continue}
      const r=a.role;
      if(r==='hunter'||r==='woodcutter'||r==='miner'){
        const key=r==='hunter'?'food':r==='woodcutter'?'fuel':'parts',full=r==='miner'?4:8;
        if(a[key]>=full){if(town){act(a,'sell');continue}if(!stepToward(a,nearest(i,isTown,12)))break;continue}
        const here=r==='hunter'?game[i]>Math.max(3,gameK[i]*.35):r==='woodcutter'?timber[i]>Math.max(5,timberK[i]*.3):vein[i]>0;
        if(here){const c=r==='miner'?4:3;if(a.ap<c)break;act(a,r==='hunter'?'hunt':r==='woodcutter'?'chop':'mine');continue}
        if(a.target<0||a.target===i||(r==='miner'&&vein[a.target]<=0))a.target=r==='hunter'?bestNear(i,n=>game[n]>3?game[n]:0,5):r==='woodcutter'?bestNear(i,n=>timber[n]>5?timber[n]:0,5):nearest(i,n=>vein[n]>0&&(known[n]||hdist(i,n)<=1),8);
        if(a.target<0){a.target=bestNear(i,n=>gameK[n]+timberK[n],6)}
        if(!stepToward(a,a.target)){a.target=-1;break}continue}
      if(r==='trader'){
        if(a.cargo){if(a.tile===a.cargo.to&&town){act(a,'sell');a.cargo=null;continue}if(!stepToward(a,a.cargo.to)){if(town){act(a,'sell');a.cargo=null}break}continue}
        if(!town){if(!stepToward(a,nearest(i,isTown,12)))break;continue}
        const F=markets[i];let best=null;
        for(let n=0;n<N;n++){if(!isTown(n)||n===i)continue;const d=hdist(i,n);if(d>10)continue;const G=markets[n];
          for(const g of ['water','parts','food','fuel']){const gain=G.price[g]*.95-F.price[g]*1.1-d*.04*(g==='food'||g==='fuel'?1:.3);if(F.stock[g]>8&&(!best||gain>best.gain))best={gain,g,to:n}}}
        if(best&&best.gain>.25){if(act(a,'buy',best.g).startsWith('花')){a.cargo={g:best.g,to:best.to};alog(a,`在${nm(i)}收購${GN[best.g]}，準備運往${nm(best.to)}。`);continue}}
        if(a.ap>=1){a.ap-=1}break}
      if(r==='bounty'){
        if(bandit[i]>=15&&a.hp>=50){if(a.ap<4)break;act(a,'raid');continue}
        if(a.target<0||bandit[a.target]<15)a.target=bestNear(i,n=>bandit[n]>=15?bandit[n]:0,6);
        if(a.target<0||a.hp<50){if(!town&&stepToward(a,nearest(i,isTown,12)))continue;break}
        if(!stepToward(a,a.target)){a.target=-1;break}continue}
      break}
    // 要下線了：謹慎的人會先紮營
    const nextOn=!!(a.mask&(1<<((T+1)%4)));if(!nextOn&&!isTown(a.tile)&&!a.camped&&a.ap>=2&&rand()<a.careful)act(a,'camp')}
  // ===== 車隊與商隊：每時段沿路走一段，每進一格都可能遇劫 =====
  const stepCost=(a,b)=>CE[b]+(land[a]!==land[b]?2:0);
  // 車隊等裝貨（出發日分散在一季裡），夜裡紮營不走；白天每個時段走 1.2 點路程
  function moveConvoys(){if(night())return;
    const run=(list,isCv)=>{const keep=[];
      for(const c of list){if(c.wait>0){c.wait--;keep.push(c);continue}
        let bud=(c.left||0)+1.2;let done=false,lost=false;
        while(c.pos<c.path.length-1){const a=c.path[c.pos],b=c.path[c.pos+1],k=stepCost(a,b);if(k>bud)break;bud-=k;c.pos++;
          const p=bandit[b]/1500+(atWar(owner[b],c.f)?.027:0);
          if(rand()<p){lost=true;bandit[b]=Math.min(100,bandit[b]+.4);if(isCv){stats.cvLost++;if(cvRobbed(curY,c.from,c.to,c.g,c.amt,[b]))break}else stats.cartLost++;
            if(robTold!==curY&&rand()<.3){robTold=curY;robSay(curY,isCv?'v'+c.from+'>'+c.to:'c'+c.to,isCv?`${nm(c.from)}往${nm(c.to)}的${GN[c.g]}商隊在${nm(b)}遭劫。`:`運往${nm(c.to)}的${cargoName(c.goods)}車隊在${nm(b)}被掠奪者劫走。`,b)}
            break}}
        if(lost)continue;
        if(c.pos>=c.path.length-1){done=true;let m=markets[c.to];
          if(!m||(!isCv&&owner[c.to]!==c.f)){const f=fac[c.f];m=f&&f.alive?markets[f.cap]:null}   // 目的地丟了：改送首都，首都也沒了就散失
          if(m){if(isCv)m.stock[c.g]+=c.amt;else for(const g of GOODS)m.stock[g]+=c.goods[g]}}
        if(!done){c.left=Math.min(bud,1.2);keep.push(c)}}
      return keep};
    carts=run(carts,false);caravans=run(caravans,true)}
  function periodTick(){computed=0;T++;
    banditStep(1/PY);
    moveConvoys();
    if(T%4===0)for(const a of actors)a.skipDay=!a.human&&rand()<.12;   // 有些日子沒上線
    const order=actors.slice().sort(()=>rand()-.5);
    for(const a of order){const i=a.tile;
      a.ap=Math.min(24,a.ap+3);
      a.food-=.25;if(a.food<0){a.food=0;a.hp-=6;if(!a.hungry){a.hungry=true;alog(a,'口糧吃完了，開始挨餓。')}}else a.hungry=false;
      if(isTown(i))a.hp=Math.min(100,a.hp+3);
      if(night()){
        if(a.camped){if(a.fuel>=.5){a.fuel-=.5;a.hp=Math.min(100,a.hp+6)}else if(temp[i]<.45)a.hp-=3}
        else if(!isTown(i)&&temp[i]<.4&&curSeason()===3)a.hp-=6;
        encounter(a)}
      if(a.hp<=0){respawn(a);continue}
      if(online(a)&&!a.human){if(a.camped&&a.ap>2)a.camped=false;brain(a)}
      for(const n of [a.tile,...NBR[a.tile]])catchUp(n,T)}
    story=Math.min(1.5,story+.03);
    let ended=false;
    if(T%PS===0){const s=(curSeason()+3)%4;season(curY,s);
      if(s===3){yearEnd(curY);ownerHist.push(owner.slice());curY++;yearStart(curY);ended=true}}
    // 線上模式把重的路網計算拆到別的時段：每季結算前一刻重綁市場，開年第一個時段重建鎮際路網
    if(T%PY===1)buildTownNet(0);
    if(T%PY===3)buildTownNet(1);   // 鎮際路網分兩個時段各算一半
    if(T%PY===2)politics(curY);
    if((T+1)%PS===0)bindMarkets();
    lastComputed=computed;return ended}

  // ===== 存檔：把整個世界的可變狀態匯出成一個物件，之後原樣讀回 =====
  const MUT={biome,fert,timberK,gameK,timber,game,vein,known,deforest,wall,trench,vcap,vex,owner,pop,bandit,ruin,peak,lastT,town};
  function exportState(){const o={};for(const k in MUT)o[k]=MUT[k];
    return {...o,fac,events:ev.slice(-1500),graves,heroes,battles,nextHero,routeSeen,tension,war,routes,T,curY,live,story,actors,nextId,rng:rand.state(),ownerHist,lastComputed,markets,carts,caravans,flows,routeTiles:[...routeTiles],robTold,robSeen,stats,bc,front,covet,townNet,gangs,nextGang,legend:{ARC,weapons,saga,aff,houseAff,leagues}}}
  function importState(S){for(const k in MUT)if(S[k])MUT[k].set(S[k]);
    fac.splice(0,fac.length,...S.fac);ev.splice(0,ev.length,...S.events);graves.splice(0,graves.length,...S.graves);heroes.splice(0,heroes.length,...S.heroes);
    for(const k of Object.keys(routeSeen))delete routeSeen[k];Object.assign(routeSeen,S.routeSeen);
    for(let a=0;a<FMAX;a++){tension[a]=S.tension[a].slice();war[a]=S.war[a].slice()}
    routes=S.routes;T=S.T;curY=S.curY;live=S.live;story=S.story;actors=S.actors;nextId=S.nextId;ownerHist=S.ownerHist||[];lastComputed=S.lastComputed||0;rand.setState(S.rng);
    markets=S.markets||{};carts=S.carts||[];caravans=S.caravans||[];flows=S.flows||[];routeTiles=new Set(S.routeTiles||[]);robTold=S.robTold??-1;robSeen=S.robSeen||{};Object.assign(stats,S.stats||{});gangs=S.gangs||[];nextGang=S.nextGang||1;battles=S.battles||[];nextHero=S.nextHero||1;
    if(S.legend){const L=S.legend;for(const k of Object.keys(ARC))delete ARC[k];Object.assign(ARC,L.ARC);weapons.splice(0,weapons.length,...L.weapons);saga.splice(0,saga.length,...L.saga);
      for(const o of [aff,houseAff])for(const k of Object.keys(o))delete o[k];Object.assign(aff,L.aff);Object.assign(houseAff,L.houseAff);leagues.splice(0,leagues.length,...(L.leagues||[]))}
    netSig='';netYear=-99;if(live)yearStartNetOnly(S)}
  // 讀檔後路網與前線要重建（不存檔，因為可以重算）
  function yearStartNetOnly(S){refreshCE();bindMarkets();if(S.townNet)townNet=S.townNet;else buildTownNet();if(S.front){bc=S.bc;front=S.front;covet=S.covet}else buildFronts()}
  function view(){const econ=fac.map(f=>({n:f.n,c:f.c,born:f.born,merc:Math.round(f.merc),liege:f.alive?f.liege:-1,loyal:+(f.loyal||0).toFixed(2),alive:f.alive,cap:f.alive?f.cap:-1,ratio:f.ratio,price:f.price,store:f.store||0,tiles:0,pop:0}));
    for(let i=0;i<N;i++)if(owner[i]>=0){econ[owner[i]].tiles++;econ[owner[i]].pop+=pop[i]}
    let pending=0;for(let i=0;i<N;i++)if(land[i]&&lastT[i]<T)pending++;
    const r8=a=>Array.from(a,v=>Math.round(v));
    return {stamp:stamp(),T,year:curY,period:T%4,season:curSeason(),computed:lastComputed,pending,story,
      owner:Array.from(owner),pop:r8(pop),bandit:r8(bandit),ruin:Array.from(ruin),wall:r8(wall),biome:Array.from(biome),timber:r8(timber),timberK:r8(timberK),game:r8(game),gameK:r8(gameK),
      vein:r8(vein),vcap:r8(vcap),vex:Array.from(vex),known:Array.from(known),econ,routes,graves,town:Array.from(town),mkt:Array.from(mkt),stats:{...stats},gangs:gangs.map(g=>({name:g.name,lair:g.lair,str:Math.round(g.str)})),
      heroes:heroes.filter(h=>h.alive||h.wins>=2).map(h=>({name:h.name,f:h.f,born:h.born,alive:h.alive,fief:h.fief,wins:h.wins,battles:h.battles,skill:h.skill,loyal:h.loyal,diedY:h.diedY,end:h.end})),
      battles:(()=>{const sz=b=>b.LA+b.LD+b.xA+b.xD;const big=battles.slice().sort((p,q)=>sz(q)-sz(p)).slice(0,30);return [...new Set([...big,...battles.slice(-15)])]})(),
      lords:Object.keys(markets).map(Number).filter(t=>markets[t].lord).map(t=>[t,markets[t].lord]),
      wars:(()=>{const o=[];for(let a=0;a<FMAX;a++)for(let b=a+1;b<FMAX;b++){const W=war[a][b];if(W&&W.att!==undefined)o.push({att:W.att,def:W.def,goal:W.goal,start:W.start,score:W.score,siege:W.siege?W.siege.t:-1})}return o})(),
      markets:Object.keys(markets).map(Number).filter(t=>owner[t]>=0).map(t=>{const m=markets[t],r2=o=>Object.fromEntries(GOODS.map(g=>[g,+o[g].toFixed(2)]));
        return {t,f:owner[t],pop:Math.round(m.pop),stock:r2(m.stock),price:r2(m.price),ratio:r2(m.ratio)}}),
      carts:carts.map(c=>[c.path[c.pos],c.to,c.f]),caravans:caravans.map(c=>[c.path[c.pos],c.from,c.to,GOODS.indexOf(c.g),+c.amt.toFixed(1),c.f]),
      actors:actors.map(a=>({id:a.id,name:a.name,role:a.role,tile:a.tile,hp:Math.round(a.hp),ap:a.ap,online:online(a),camped:a.camped,silver:Math.round(a.silver),food:+a.food.toFixed(1),fuel:+a.fuel.toFixed(1),parts:+a.parts.toFixed(1),deaths:a.deaths,log:a.log.slice(-8)})),
      events:ev.slice(-160)}}

  w.events=ev;w.graves=graves;w.snaps=snaps;w.fac=fac;w.stats=stats;
  const legendData=()=>({leagues,weapons:weapons.map(wp=>{const h=wp.holder?heroById(wp.holder):null;return {...wp,at:h?(h.fief>=0?h.fief:fac[h.f].cap):wp.fac>=0?fac[wp.fac].cap:wp.gang?(gangs.find(g=>g.id===wp.gang)||{lair:wp.loc}).lair:(wp.lake&&wp.shore!==undefined?wp.shore:wp.loc)}}),saga,ARC,houseAff,aff,heroes:heroes.filter(h=>h.legend||h.ruled||h.famed||h.wins>=4),fac:fac.map(f=>({id:f.id,n:f.n,alive:f.alive,born:f.born,diedY:f.diedY,cap:f.cap,ruler:f.ruler,house:f.house,liege:f.liege,bloc:f.bloc||0,league:f.league||0,free:!!f.free,works:!!f.works,native:!!f.native})),names:w.names,owner:owner.slice(),events:ev});
  const peek=()=>({owner,pop,bandit,town,mkt,markets,gangs,fac,routeTiles,biome,trench,wall,ruin,ARC,leagues,saga,game,gameK,timber,timberK,vein,known,ev,T,curY,weapons,heroes,war,caravans,carts,stamp:stamp(),season:curSeason()});
  return {peek,legendData,runHistory,begin,stepYear,get year(){return histY},startLive,periodTick,act,exportState,importState,view,spawnActor,actors:()=>actors,get live(){return live},get T(){return T}};
}



// 從存檔還原世界：地形（static）直接讀回，不重新生成，冷啟動才快
function staticOf(w){const {sim,events,snaps,graves,fac,...rest}=w;return rest}
function restore(Wst,S){const rand=mulberry32(1),pick=a=>a[Math.floor(rand()*a.length)];const w={...Wst};const sim=createSim(w,rand,pick);sim.importState(S);w.sim=sim;return w}

export {generate,staticOf,restore,W,H,N,YEARS,BIOMES,FDEF,FMAX,NBR,GOODS,GN,BASEP,SEASON,MOVE,VEH,VN,col,row,hdist};
