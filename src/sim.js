// 六角世界模擬核心：觀看網頁、創世腳本與 Cloudflare Worker 共用

const W=30,H=24,N=W*H,YEARS=400;

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
 {n:'深海',c:'#1d3a52',f:0,res:99},{n:'淺海',c:'#2f5c78',f:0,res:99},
 {n:'雪峰',c:'#e4e8ea',f:0,res:4},{n:'山地',c:'#857c72',f:.12,res:3},
 {n:'丘陵',c:'#a29d68',f:.5,res:1.8},{n:'凍原',c:'#a7b6b1',f:.25,res:1.4},
 {n:'森林',c:'#3e6a3a',f:.7,res:1.6},{n:'草原',c:'#8dad59',f:1,res:1},
 {n:'荒漠',c:'#d2b878',f:.15,res:1.3},{n:'沼澤',c:'#566f59',f:.4,res:2}];
const SUF={2:['峰','頂'],3:['嶺','岩','關'],4:['丘','岡','坡'],5:['原','野'],6:['林','木','森'],7:['原','集','渡','鄉'],8:['漠','沙','磧'],9:['澤','沼','窪']};
const PRE='黑白赤灰霜鴉狼石柳鐵銀荒長古青寒烏鹿松楓鷹雁蘆棘燼雲蒼孤嵐鏽'.split('');
const FDEF=[{n:'灰塔王國',c:'#d9b13a'},{n:'赤柳氏族',c:'#d0503f'},{n:'霜原聯盟',c:'#5d9fd6'},{n:'鐵丘公國',c:'#a272cc'},{n:'鹿角部落',c:'#35b3a1'}];
const SUR='蘭韓洛岳沈顧霍秦葉裴溫衛'.split(''),GIV='鋒嵐川岩遠寂霜燁衡默青翎晦弦'.split('');
const ARMS=['長劍','戰斧','角弓','護盾','戰旗','騎槍'];
const GAMEK={3:10,4:30,5:25,6:60,7:40,8:6,9:30},TIMBK={3:6,4:25,5:10,6:100,7:8,9:40};

/* ---------- 世界生成 ---------- */
function generate(seedStr,{history=true}={}){
  const seed=strSeed(seedStr),rand=mulberry32(seed),s=seed%100000;
  const pick=a=>a[Math.floor(rand()*a.length)];
  const elev=new Float32Array(N),temp=new Float32Array(N),rain=new Float32Array(N),biome=new Uint8Array(N);
  const HH=H*.866;
  for(let i=0;i<N;i++){const px=col(i)+(row(i)&1)*.5,py=row(i)*.866;
    const dx=(px/W-.5)*2,dy=(py/HH-.5)*2;
    elev[i]=fbm(px*.17,py*.17,s)*1.1-(dx*dx+dy*dy)*.5;}
    {const ord=[...elev.keys()].sort((a,b)=>elev[a]-elev[b]);ord.forEach((i,k)=>elev[i]=k/(N-1))}
  const SEA=.36,land=i=>elev[i]>=SEA;
  for(let i=0;i<N;i++){const py=row(i)*.866;
    temp[i]=.15+.8*(py/HH)-Math.max(0,elev[i]-.7)*.6+(fbm(col(i)*.3,row(i)*.3,s+7)-.5)*.2}
  // 由西向東的濕氣：越過山脈後變乾（雨影）
  for(let r=0;r<H;r++){let m=.9;for(let c=0;c<W;c++){const i=idx(c,r);
    if(!land(i)){m=Math.min(1,m+.12);rain[i]=m;continue}
    rain[i]=m*(.55+.45*fbm(c*.25,r*.25,s+13));m*=elev[i]>.88?.5:.95}}
  for(let i=0;i<N;i++){const e=elev[i];let b;
    if(e<.2)b=0;else if(e<SEA)b=1;else if(e>.965)b=2;else if(e>.89)b=3;else if(e>.78)b=4;
    else if(temp[i]<.24)b=5;else if(e<.46&&rain[i]>.6)b=9;else if(rain[i]>.5)b=6;else if(rain[i]<.24&&temp[i]>.55)b=8;else b=7;
    biome[i]=b}
  // 河流：從高處沿最陡方向流向海
  const river=new Uint8Array(N),riverPaths=[];
  const springs=[];for(let i=0;i<N;i++)if(elev[i]>.82&&rain[i]>.3&&biome[i]!==2)springs.push(i);
  for(let k=0;k<9&&springs.length;k++){let cur=springs.splice(Math.floor(rand()*springs.length),1)[0];const path=[cur];
    for(let step=0;step<40;step++){let best=-1,be=elev[cur];for(const n of NBR[cur])if(elev[n]<be){be=elev[n];best=n}
      if(best<0)break;path.push(best);cur=best;if(!land(cur))break}
    if(path.length>3){riverPaths.push(path);for(const p of path)if(land(p))river[p]=1}}
  const fert=new Float32Array(N),res=new Float32Array(N);
  for(let i=0;i<N;i++){fert[i]=Math.min(1.3,BIOMES[biome[i]].f+(river[i]?.35:0));res[i]=BIOMES[biome[i]].res}
  // 地名
  const names=new Array(N).fill(''),used=new Set();
  for(let i=0;i<N;i++){if(!land(i))continue;let nm,t=0;
    do{nm=pick(PRE)+pick(SUF[biome[i]]);t++}while(used.has(nm)&&t<12);
    if(used.has(nm))nm=pick(PRE)+pick(PRE)+pick(SUF[biome[i]]);used.add(nm);names[i]=nm}
  // 天然資源：水源、木材、獵物、鹽、鐵礦脈
  const coast=new Uint8Array(N),water=new Float32Array(N),timberK=new Float32Array(N),gameK=new Float32Array(N),saltK=new Float32Array(N),vein0=new Float32Array(N);
  for(let i=0;i<N;i++){if(!land(i))continue;const b=biome[i];if(NBR[i].some(n=>!land(n)))coast[i]=1;
    water[i]=Math.min(1.2,rain[i]*.9+(river[i]?.4:0)+(coast[i]?.1:0));
    timberK[i]=(TIMBK[b]||0)*(.7+.6*rain[i]);gameK[i]=(GAMEK[b]||0)*(.8+.4*rand());saltK[i]=(coast[i]?.6:0)+(b===8?1:0)}
  const vc=[];for(let i=0;i<N;i++)if(biome[i]===3||biome[i]===4)vc.push(i);
  const veins=[];for(let t=0;t<300&&veins.length<16&&vc.length;t++){const c=vc[Math.floor(rand()*vc.length)];if(veins.every(v=>hdist(v,c)>=2)){veins.push(c);vein0[c]=250+rand()*650}}
  const w={elev,temp,rain,biome,river,riverPaths,fert,res,names,coast,water,timberK,gameK,saltK,vein0,land:Array.from({length:N},(_,i)=>land(i))};
  const sim=createSim(w,rand,pick);w.sim=sim;if(history)sim.runHistory();return w;
}

/* ---------- 歷史模擬 ---------- */
const GOODS=['food','wood','iron','stone','salt'],GN={food:'糧',wood:'木材',iron:'鐵',stone:'石材',salt:'鹽'};
const WEIGHT={food:1,wood:1.3,iron:.45,stone:1.6,salt:.4};      // 每格運輸損耗的倍率：重貨運不遠
const BASEP={food:1,wood:1.5,iron:8,stone:2,salt:4};             // 基準價（銀）
const SEASON=['春','夏','秋','冬'];
const HARVEST=[.1,.35,.55,0],SALTS=[.3,.4,.3,0];
// 移動成本：深海、淺海、雪峰、山地、丘陵、凍原、森林、草原、荒漠、沼澤
const MOVE=[1.1,.8,Infinity,5,2.5,2,2,1,2.5,3];
class Heap{constructor(n){this.k=new Float64Array(n);this.v=new Int32Array(n);this.size=0}
  push(key,val){let i=this.size++;const k=this.k,v=this.v;while(i>0){const p=(i-1)>>1;if(k[p]<=key)break;k[i]=k[p];v[i]=v[p];i=p}k[i]=key;v[i]=val}
  pop(){const k=this.k,v=this.v,rk=k[0],rv=v[0],n=--this.size,lk=k[n],lv=v[n];let i=0;
    for(;;){let c=2*i+1;if(c>=n)break;if(c+1<n&&k[c+1]<k[c])c++;if(k[c]>=lk)break;k[i]=k[c];v[i]=v[c];i=c}
    if(n>0){k[i]=lk;v[i]=lv}this.pk=rk;return rv}}
function createSim(w,rand,pick){
  const {land,res,names,temp,saltK,river}=w;
  const biome=w.biome.slice(),fert=w.fert.slice(),timberK=w.timberK.slice(),gameK=w.gameK.slice();
  const timber=Float32Array.from(timberK),game=Float32Array.from(gameK),vein=Float32Array.from(w.vein0);
  const known=new Uint8Array(N),deforest=new Uint16Array(N),wall=new Float32Array(N),vcap=Float32Array.from(w.vein0),vex=Uint8Array.from(w.vein0,v=>v>0?1:0);
  const owner=new Int8Array(N).fill(-1),pop=new Float32Array(N),bandit=new Float32Array(N),ruin=new Uint8Array(N),peak=new Float32Array(N);
  const zero=()=>({food:0,wood:0,iron:0,stone:0,salt:0}),one=()=>({food:1,wood:1,iron:1,stone:1,salt:1});
  const fac=FDEF.map((d,i)=>({...d,id:i,alive:true,cap:-1,aggr:.8+rand()*.6,stock:{food:60,wood:10,iron:4,stone:10,salt:3},
    ratio:one(),price:one(),prod:zero(),loss:0,pop:0,cold:0,fronts:0,frontsPrev:0,famineCD:0,woodCD:0,winterFood:1}));
  const ev=[],graves=[],heroes=[],snaps=[],routeSeen={};
  const nm=i=>names[i]||'無名之地';
  let live=false,curY=0,T=0;
  const say=(y,type,text,tile=-1)=>{const e={y,type,text,tile};if(live)e.ts=stamp();ev.push(e);return e};
  const tileCost=(i,n)=>{let c=MOVE[biome[n]];if(land[n]&&river[n])c*=.6;if(land[i]!==land[n])c+=2;return c};
  const winterExtra=n=>{const b=biome[n];return b===3||b===5?1:b<2?.5:.2};  // 冬季額外成本倍率
  const HEAP=new Heap(N*7),CE=new Float32Array(N);
  function dijkstra(src,blocked){const dist=new Float64Array(N).fill(Infinity),prev=new Int16Array(N).fill(-1),h=HEAP;h.size=0;
    dist[src]=0;h.push(0,src);
    while(h.size){const i=h.pop(),d=h.pk;if(d>dist[i])continue;const nb=NBR[i],li=land[i];
      for(let e=0;e<nb.length;e++){const n=nb[e];if(blocked&&blocked[n])continue;let c=CE[n];if(c===Infinity)continue;if(li!==land[n])c+=2;const nd=d+c;if(nd<dist[n]){dist[n]=nd;prev[n]=i;h.push(nd,n)}}}
    return {dist,prev,wd:null}}
  const pathTo=(D,t)=>{const p=[];for(let c=t;c>=0;c=D.prev[c])p.push(c);return p.reverse()};
  // 首都：肥沃且彼此遠離
  const cands=[];for(let i=0;i<N;i++)if(land[i]&&fert[i]>=.7)cands.push(i);
  if(cands.length<FDEF.length)for(let i=0;i<N;i++)if(land[i]&&fert[i]>.1&&!cands.includes(i))cands.push(i);
  const chosen=[];
  for(const f of fac){let best=-1,bd=-1;for(let k=0;k<160;k++){const c=cands[Math.floor(rand()*cands.length)];if(chosen.includes(c))continue;
      const d=chosen.length?Math.min(...chosen.map(x=>hdist(x,c))):99;if(d>bd){bd=d;best=c}}
    if(best<0){f.alive=false;continue}
    chosen.push(best);owner[best]=f.id;pop[best]=50;peak[best]=50;f.cap=best;
    say(0,'found',`${f.n}在${nm(best)}立城。`,best)}
  const tension=FDEF.map(()=>FDEF.map(()=>0)),war=FDEF.map(()=>FDEF.map(()=>null));
  let routes=[],netSig='',netYear=-99,haul=[],netPairs=[];
  const u8=a=>{const o=new Uint8Array(a.length);for(let i=0;i<a.length;i++){const v=Math.round(a[i]);o[i]=v>255?255:v}return o};
  const makeSnap=()=>{const econ=fac.map(f=>({stock:{...f.stock},ratio:{...f.ratio},price:{...f.price},winterFood:f.winterFood,store:f.store||0,tiles:0,pop:0,loss:f.loss}));
    for(let i=0;i<N;i++)if(owner[i]>=0){econ[owner[i]].tiles++;econ[owner[i]].pop+=pop[i]}
    return {owner:owner.slice(),pop:u8(pop),bandit:u8(bandit),ruin:ruin.slice(),caps:fac.map(f=>f.alive?f.cap:-1),
      biome:biome.slice(),timber:u8(timber),timberK:u8(timberK),game:u8(game),gameK:u8(gameK),vein:Uint16Array.from(vein),vcap:Uint16Array.from(vcap),vex:vex.slice(),
      known:known.slice(),wall:u8(wall),econ,routes}};
  snaps.push(makeSnap());
  const heroName=()=>pick(SUR)+pick(GIV)+(rand()<.5?pick(GIV):'');


  let hc,hcw,pairs=[],bc,front,covet;
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
    // 0. 路網：每國從首都出發找最便宜的路（避開交戰國領土）
    const enemyMask=a=>{const m=new Uint8Array(N);for(let i=0;i<N;i++){const o=owner[i];if(o>=0&&o!==a&&(war[Math.min(a,o)][Math.max(a,o)]))m[i]=1}return m};
    const sig=fac.map(f=>f.alive?f.cap:-1).join()+'|'+war.map(r=>r.map(x=>x?1:0).join('')).join('');
    const winterCostTo=(D,t)=>{let x=0;for(let c=t;c>=0;c=D.prev[c])x+=winterExtra(c)*MOVE[biome[c]]===Infinity?0:winterExtra(c)*Math.min(5,MOVE[biome[c]]);return x};
    if((sig!==netSig&&y-netYear>=3)||y-netYear>=8){netSig=sig;netYear=y;
    for(let n=0;n<N;n++)CE[n]=MOVE[biome[n]]*(land[n]&&river[n]?.6:1);
    haul=fac.map(f=>f.alive?dijkstra(f.cap,enemyMask(f.id)):null);
    for(const D of haul){if(!D)continue;const ord=[];for(let i=0;i<N;i++)if(D.dist[i]<Infinity)ord.push(i);ord.sort((x,z)=>D.dist[x]-D.dist[z]);
      D.wd=new Float32Array(N);for(const i of ord){const pv=D.prev[i];D.wd[i]=(pv>=0?D.wd[pv]:0)+winterExtra(i)*Math.min(5,MOVE[biome[i]])}}
    // 商路：和平的兩國之間，避開任一方的敵國
    netPairs=[];
    for(let a=0;a<FDEF.length;a++)for(let b=a+1;b<FDEF.length;b++){const A=fac[a],B=fac[b];
      if(!A.alive||!B.alive||war[a][b])continue;
      const m=enemyMask(a),mb=enemyMask(b);for(let i=0;i<N;i++)if(mb[i])m[i]=1;
      const D=dijkstra(A.cap,m);const cost=D.dist[B.cap];if(cost===Infinity)continue;
      const path=pathTo(D,B.cap);let risk=0,sea=false;for(const t of path){risk+=bandit[t];if(!land[t])sea=true}
      netPairs.push({a,b,cost,costW:cost+winterCostTo(D,B.cap),path,risk:Math.min(.5,risk/1000),sea})}}
    // 每格到首都的成本（含冬季加成）
    hc=new Float32Array(N).fill(Infinity);hcw=new Float32Array(N).fill(Infinity);
    for(let i=0;i<N;i++){const o=owner[i];if(o<0||!haul[o])continue;hc[i]=haul[o].dist[i];if(hc[i]<Infinity)hcw[i]=hc[i]+haul[o].wd[i]}
    pairs=netPairs.map(P=>({...P,flow:zero()}));

  }
  function buildFronts(){
    bc=FDEF.map(()=>FDEF.map(()=>0));front=FDEF.map(()=>FDEF.map(()=>[]));covet=FDEF.map(()=>FDEF.map(()=>false));
    for(const F of fac){if(!F.alive)continue;const a=F.id,dist=new Int8Array(N).fill(99),src=new Int16Array(N).fill(-1),q=[];
      for(let i=0;i<N;i++)if(owner[i]===a){dist[i]=0;src[i]=i;q.push(i)}
      for(let h=0;h<q.length;h++){const i=q[h];if(dist[i]>=3)continue;for(const n of NBR[i]){if(!land[n]||dist[n]<=dist[i]+1)continue;
        dist[n]=dist[i]+1;src[n]=src[i];const b=owner[n];
        if(b>=0&&b!==a){bc[a][b]+=dist[n]===1?1:.4;front[a][b].push([src[n],n,dist[n]]);if(vein[n]>0&&known[n]&&F.ratio.iron<.7)covet[a][b]=true}
        else q.push(n)}}}
    for(let a=0;a<FDEF.length;a++)for(let b=a+1;b<FDEF.length;b++){bc[a][b]=Math.max(bc[a][b],bc[b][a])}
  }
  // ===== 年層：開年 =====
  function yearStart(y){
    // 天災
    if(rand()<.07){say(y,'disaster','大寒之年，北地村落多有凍餓。');for(let i=0;i<N;i++)if(owner[i]>=0&&temp[i]<.5)pop[i]*=.72}
    if(rand()<.03){const al=fac.filter(f=>f.alive);if(al.length){const f=pick(al);say(y,'disaster',`瘟疫席捲${f.n}。`,f.cap);for(let i=0;i<N;i++)if(owner[i]===f.id)pop[i]*=.6}}

    buildNet(y);
    for(const f of fac){f.walls=0;f.prod=zero();f.loss=0;f.pop=0;f.cold=0;f.frontsPrev=f.fronts;f.fronts=0;f.rsum=zero()}
    for(let i=0;i<N;i++)if(owner[i]>=0){const f=fac[owner[i]];f.pop+=pop[i];f.walls+=wall[i];if(temp[i]<.4)f.cold+=pop[i]}
    // 前線、緊張與宣戰（每年判斷一次）
    buildFronts();
    for(let a=0;a<FDEF.length;a++)for(let b=a+1;b<FDEF.length;b++){
      if(!fac[a].alive||!fac[b].alive){war[a][b]=null;continue}
      if(!bc[a][b]){tension[a][b]*=.9;if(war[a][b]){war[a][b]=null;say(y,'war',`${fac[a].n}與${fac[b].n}之間已無人煙，戰事不了了之。`)}continue}
      if(!war[a][b]){tension[a][b]+=.4+rand()*1.6+Math.min(bc[a][b],20)*.06+(covet[a][b]||covet[b][a]?2:0);
        if(tension[a][b]>30+rand()*25){war[a][b]={end:y+4+Math.floor(rand()*8),gain:{}};
          let att,def;if(covet[a][b]&&!covet[b][a])[att,def]=[a,b];else if(covet[b][a]&&!covet[a][b])[att,def]=[b,a];else [att,def]=rand()<.5?[a,b]:[b,a];
          say(y,'war',covet[att][def]?`${fac[att].n}為奪取鐵礦向${fac[def].n}宣戰。`:`${fac[att].n}向${fac[def].n}宣戰。`,fac[def].cap)}}
      else{war[a][b].told=0;war[a][b].snowTold=false}}
  }

  // ===== 季層：生產、運輸、貿易、消耗、本季戰事 =====
  function season(y,s){
    for(let i=0;i<N;i++)if(owner[i]>=0)catchUp(i,T);   // 領地內的格子要先補算，才能照實際存量生產
      for(let i=0;i<N;i++){if(owner[i]<0)continue;const f=fac[owner[i]],p=pop[i];
        const hunt=Math.min(game[i]*.08,p*.08*(s===3?.5:1));game[i]-=hunt;
        const out={food:p*1.5*fert[i]*HARVEST[s]+hunt,wood:Math.min(timber[i]*.03,p*.075),iron:0,
          stone:p*(biome[i]===3?.03:biome[i]===4?.02:.001),salt:saltK[i]*p*.08*SALTS[s]};
        timber[i]-=out.wood;
        if(biome[i]===9)out.iron+=p*.005;
        if(vein[i]>0){const fe=Math.min(vein[i],p*.0625);out.iron+=fe;vein[i]-=fe;
          if(vein[i]<=.5){vein[i]=0;say(y,'econ',`${nm(i)}的鐵礦脈挖掘殆盡，礦坑就此廢棄。`,i)}}
        const c=s===3?hcw[i]:hc[i],bk=1-bandit[i]/200;
        for(const g of GOODS){const keep=c===Infinity?.1:Math.max(.1,1-.012*c*WEIGHT[g])*bk;f.prod[g]+=out[g]*keep;f.stock[g]+=out[g]*keep;f.loss+=out[g]*(1-keep)}}
      for(const f of fac){if(!f.alive)continue;
        f.need={food:f.pop*.25,wood:f.pop*.009+f.cold*(s===3?.05:s===1?0:.012),iron:f.pop*.0015+f.frontsPrev*.25,
          stone:f.pop*.002+f.walls*.05+1,salt:f.pop*.0075};
        // 市價：存貨能撐的季數越少越貴
        for(const g of GOODS){const cover=f.stock[g]/Math.max(.01,f.need[g]*4),p=Math.min(3.5,Math.max(.3,1/(.35+cover)));f.price[g]=f.price[g]*.6+p*.4}}
      // 貿易：價差大於運費才跑貨
      for(const P of pairs){if(war[P.a][P.b]||!fac[P.a].alive||!fac[P.b].alive)continue;const A=fac[P.a],B=fac[P.b],cost=s===3?P.costW:P.cost,cap=(4+.04*Math.min(A.pop,B.pop))/4;
        for(const g of GOODS){const eff=effOf(cost,g,P.risk);if(eff<.3)continue;
          for(const [S,T] of [[A,B],[B,A]]){
            if(T.price[g]*eff<=S.price[g]*1.15)continue;
            const amt=Math.min(cap*(g==='food'||g==='wood'||g==='stone'?1:.5),S.stock[g]-S.need[g]*2,T.need[g]*4-T.stock[g]);
            if(amt<.1)continue;
            S.stock[g]-=amt;T.stock[g]+=amt*eff;P.flow[g]+=amt;
            tension[P.a][P.b]=Math.max(0,tension[P.a][P.b]-amt*.08);
            const key=S.id+'>'+T.id+g;
            if(P.flow[g]>2&&(routeSeen[key]===undefined||y-routeSeen[key]>15)){
              const mid=P.path.filter(t=>land[t]&&owner[t]!==S.id&&owner[t]!==T.id);const via=P.sea?'經海路':mid.length?`經${nm(mid[Math.floor(mid.length/2)])}`:'';
              say(y,'trade',`${S.n}${via}向${T.n}輸出${GN[g]}。`,S.cap)}
            if(P.flow[g]>.5)routeSeen[key]=y}}}
      for(const f of fac){if(!f.alive)continue;
        for(const g of GOODS){const r=f.need[g]>0?Math.min(1,f.stock[g]/f.need[g]):1;f.rsum[g]+=r/4;if(s===3&&g==='food')f.winterFood=r;f.stock[g]=Math.max(0,f.stock[g]-f.need[g])}
        f.stock.food=Math.min(f.stock.food*(1-(.18-.14*f.rsum.salt*4/(s+1))),f.need.food*3);
        f.stock.wood*=.96;f.stock.salt*=.99;f.stock.iron*=.995;
        if(s===2)f.store=f.stock.food/Math.max(.01,f.pop*.25)}
    // 本季戰事：每場戰爭每季一場戰鬥
    for(let a=0;a<FDEF.length;a++)for(let b=a+1;b<FDEF.length;b++){const W=war[a][b];if(!W||!fac[a].alive||!fac[b].alive)continue;
      const prs=[...front[a][b],...front[b][a]];
        for(let k=0;k<1&&prs.length;k++){const [i,n,dd]=prs[Math.floor(rand()*prs.length)];
          if(owner[i]===owner[n]||owner[i]<0||owner[n]<0)continue;
          let wf=1-.18*(dd-1);if(s===3){const t=Math.min(temp[i],temp[n]);
            if(t<.35){if(!W.snowTold&&!W.snow){W.snowTold=true;W.snow=1;say(y,'war',`北地大雪封路，${fac[a].n}與${fac[b].n}在${nm(n)}一帶的戰事每逢冬天便暫歇到開春。`,n)}continue}
            if(t<.55){wf*=.65;pop[i]*=.93}}
          const A=owner[i],D=owner[n];fac[A].fronts++;fac[D].fronts++;
          const sa=(pop[i]+5)*fac[A].aggr*wf*(.55+.45*fac[A].ratio.iron)*(.6+rand()),sd=(pop[n]+5)*res[n]*(1+.35*wall[n])*(.55+.45*fac[D].ratio.iron)*(.6+rand())*.85;
          let win,lose,where=n,dead;
          if(sa>sd){dead=pop[n]*.5;owner[n]=A;pop[n]*=.5;pop[i]*=.85;wall[n]=Math.max(0,wall[n]-1);win=A;lose=D;W.gain[A]=(W.gain[A]||0)+1}else{dead=pop[i]*.3;pop[i]*=.7;win=D;lose=A}
          // 戰場繳獲：敗方陣亡者身上的鐵器，勝方撿回六成；敗方得從國庫補發裝備
          const gear=dead*.08*(.3+.7*fac[lose].ratio.iron),loot=gear*.6;
          fac[win].stock.iron+=loot;fac[lose].stock.iron=Math.max(0,fac[lose].stock.iron-gear*.5);
          if(!W.told||(win===A&&W.told<2)){W.told=(W.told||0)+1;say(y,'war',`${SEASON[s]}，${nm(where)}之戰：${fac[win].n}擊敗${fac[lose].n}${dd>1&&win===A?`，遠征軍奪下${nm(where)}`:win===A?`，奪下${nm(where)}`:wall[n]>=1?`，${nm(where)}的城牆擋住了攻勢`:''}${loot>=.5?`，繳獲鐵器 ${loot.toFixed(1)} 擔`:''}。`,where)}
          const hl=heroes.filter(h=>h.f===lose&&h.alive);
          if(hl.length&&rand()<.22){const h=pick(hl);h.alive=false;const art=`「${pick(GIV)}${pick(GIV)}」${pick(ARMS)}`;
            graves.push({tile:where,y,name:h.name});say(y,'hero',`${fac[lose].n}的英雄${h.name}戰死於${nm(where)}，其${art}從此下落不明。`,where)}}
    }
    if(s===3){
    for(const f of fac){if(!f.alive)continue;f.ratio={...f.rsum};
      if(f.ratio.food<.8&&y>=f.famineCD){say(y,'econ',f.winterFood<.6?`${f.n}冬糧告罄，飢民四散。`:`${f.n}糧食短缺，飢民四散。`,f.cap);f.famineCD=y+8}
      if(f.ratio.wood<.6&&f.cold>20&&y>=f.woodCD&&rand()<.3){f.woodCD=y+12;say(y,'econ',`${f.n}柴薪不足，北方村落寒冬難熬。`,f.cap)}}
    routes=pairs.filter(P=>GOODS.some(g=>P.flow[g]>.3)).map(P=>({a:P.a,b:P.b,path:P.path,flow:{...P.flow},sea:P.sea}));

    }
  }

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
    // 2. 生態：全部補算到年底，再做獵物遷徙與砍伐判定
    for(let i=0;i<N;i++)catchUp(i,T);
    for(let i=0;i<N;i++){if(!land[i]||gameK[i]<=0)continue;let s2=0,c=0;for(const n of NBR[i])if(gameK[n]>0){s2+=game[n]/gameK[n];c++}
      if(c)game[i]=Math.max(0,Math.min(gameK[i],game[i]+.1*(s2/c-game[i]/gameK[i])*gameK[i]))}
    for(let i=0;i<N;i++){if(biome[i]!==6)continue;
      if(timber[i]<timberK[i]*.2){if(++deforest[i]>15){biome[i]=7;fert[i]=Math.min(1.3,1+(river[i]?.35:0));
          timberK[i]=8;timber[i]=Math.min(timber[i],8);gameK[i]=gameK[i]*.6;game[i]=Math.min(game[i],gameK[i]);
          say(y,'econ',`${nm(i)}的森林被砍伐殆盡，化為草原。`,i)}}else deforest[i]=0}
    // 3. 人口
    for(let i=0;i<N;i++)if(owner[i]>=0){const f=fac[owner[i]],cap=fert[i]*100+5,fr=f.ratio.food;
      if(fr>=.95)pop[i]+=pop[i]*.2*(1-pop[i]/cap);else pop[i]*=.85+.15*fr;
      if(temp[i]<.4)pop[i]*=.97+.03*f.ratio.wood;
      pop[i]-=bandit[i]*.06;if(pop[i]>peak[i])peak[i]=pop[i]}

    // 4. 築城：石材夠就加固首都與前線
    for(const f of fac){if(!f.alive)continue;
      if(f.ratio.stone<.8)for(let i=0;i<N;i++)if(owner[i]===f.id&&wall[i]>0)wall[i]=Math.max(0,wall[i]-.05);
      for(let k=0;k<2&&f.stock.stone>25;k++){let best=-1,bs=0;
        for(let i=0;i<N;i++){if(owner[i]!==f.id||wall[i]>=3)continue;
          const front=NBR[i].some(n=>owner[n]>=0&&owner[n]!==f.id);const sc=(i===f.cap?3:0)+(front?2:0)+pop[i]/50-wall[i]*1.2;
          if((i===f.cap||front)&&sc>bs){bs=sc;best=i}}
        if(best<0)break;const before=Math.floor(wall[best]);wall[best]=Math.min(3,Math.floor(wall[best])+1);f.stock.stone-=25;
        if(before===0)say(y,'build',best===f.cap?`${f.n}在首都${nm(best)}築起石牆。`:`${f.n}在邊境的${nm(best)}築起石牆。`,best);
        else if(wall[best]>=3&&before<3)say(y,'build',`${nm(best)}的城牆增築至三重，成為${f.n}的堅城。`,best)}}

    // 5. 拓殖
    const order=[...Array(N).keys()];for(let k=N-1;k>0;k--){const j=Math.floor(rand()*(k+1));const t=order[k];order[k]=order[j];order[j]=t}
    for(const i of order){if(owner[i]<0)continue;const cap=fert[i]*100+5;
      if(pop[i]>Math.max(20,cap*.45)&&rand()<.3){let best=-1,bs=.3;
        for(const n of NBR[i]){if(!land[n]||owner[n]>=0||bandit[n]>=26)continue;
          const sc=fert[n]+(vein[n]>0&&known[n]?.8:0)+timber[n]/250+game[n]/150+saltK[n]*.3+([3,4].includes(biome[n])?.15:0);if(sc>bs){bs=sc;best=n}}
        if(best>=0){owner[best]=owner[i];pop[best]=12;pop[i]-=10;
          if(ruin[best]){ruin[best]=0;say(y,'found',`${fac[owner[i]].n}的墾民重返${nm(best)}的廢墟。`,best)}}}}
    for(let i=0;i<N;i++){if(owner[i]<0||vein[i]>0||(biome[i]!==3&&biome[i]!==4)||rand()>.0006)continue;
      vein[i]=vcap[i]=120+rand()*280;vex[i]=1;known[i]=1;say(y,'econ',`${fac[owner[i]].n}的礦工在${nm(i)}深處掘到新礦脈。`,i)}
    for(let i=0;i<N;i++){if(owner[i]<0)continue;for(const n of [i,...NBR[i]])if(vein[n]>0&&!known[n]){known[n]=1;say(y,'econ',`${fac[owner[i]].n}的探子在${nm(n)}發現鐵礦脈。`,n)}}

    // 6. 盜匪
    if(!live)banditStep(1);
    if(rand()<.15){let bi=-1,bv=35;for(let i=0;i<N;i++)if(owner[i]<0&&bandit[i]>bv){bv=bandit[i];bi=i}
      if(bi>=0){bandit[bi]=Math.min(100,bandit[bi]+25);say(y,'bandit',`盜匪頭目${heroName()}在${nm(bi)}聚眾。`,bi)}}
    let raids=0;
    for(let i=0;i<N;i++)if(owner[i]>=0&&bandit[i]>20&&rand()<.2/(1+wall[i])){pop[i]*=.62;fac[owner[i]].stock.food*=.95;if(raids++<2)say(y,'bandit',`盜匪洗劫了${nm(i)}。`,i)}
    for(let i=0;i<N;i++)if(owner[i]>=0&&pop[i]<3){owner[i]=-1;pop[i]=0;wall[i]=0;
      if(peak[i]>=20){ruin[i]=1;say(y,'ruin',`${nm(i)}人煙散盡，化為廢墟。`,i)}peak[i]=0}

    // 7. 戰爭結束
    for(let a=0;a<FDEF.length;a++)for(let b=a+1;b<FDEF.length;b++){const W=war[a][b];if(!W)continue;
        if(y>=W.end){war[a][b]=null;tension[a][b]=0;const ga=W.gain[a]||0,gb=W.gain[b]||0;
          if(Math.abs(ga-gb)>=2){const [vw,vl]=ga>gb?[a,b]:[b,a];say(y,'war',`${fac[vl].n}向${fac[vw].n}求和。`,fac[vw].cap)}
          else say(y,'war',`${fac[a].n}與${fac[b].n}議和。`)}
    }
    for(const f of fac){if(!f.alive)continue;if(owner[f.cap]!==f.id){let best=-1,bp=-1;
        for(let i=0;i<N;i++)if(owner[i]===f.id&&pop[i]>bp){bp=pop[i];best=i}
        if(best<0){f.alive=false;say(y,'war',`${f.n}的最後一座城鎮失守，${f.n}就此滅亡。`,f.cap);for(const h of heroes)if(h.f===f.id)h.alive=false}
        else{say(y,'war',`${f.n}的首都${nm(f.cap)}陷落，朝廷遷往${nm(best)}。`,best);f.cap=best}}}
    for(const f of fac)if(f.alive&&rand()<.035){const h={name:heroName(),f:f.id,born:y,alive:true};heroes.push(h);say(y,'hero',`${h.name}在${f.n}嶄露頭角。`,f.cap)}
    for(const h of heroes)if(h.alive&&y-h.born>25&&rand()<.06){h.alive=false;say(y,'hero',`${fac[h.f].n}的老英雄${h.name}壽終於${nm(fac[h.f].cap)}。`,fac[h.f].cap)}
  }

  function runHistory(){for(let y=1;y<=YEARS;y++){yearStart(y);for(let s=0;s<4;s++){T+=PS;season(y,s)}yearEnd(y);snaps.push(makeSnap())}}

  // ===== 線上模式：時段層與即時層（角色：NPC 與玩家走同一套行動介面）=====
  let actors=[],story=0,lastComputed=0,nextId=1,ownerHist=[];
  const night=()=>T%4===3,curSeason=()=>Math.floor((T%PY)/PS);
  const isTown=i=>owner[i]>=0&&pop[i]>=8;
  function moveCost(n){let c=Math.ceil(MOVE[biome[n]]*(river[n]?.6:1));if(night())c+=1;return c}
  const alog=(a,text,tile=a.tile,pub=false)=>{const e={ts:stamp(),text};a.log.push(e);if(a.log.length>20)a.log.shift();if(pub)say(curY,'npc',`${a.name}：${text}`,tile)};
  const ROLE={hunter:'獵人',woodcutter:'樵夫',miner:'礦工',trader:'行商',bounty:'賞金獵人'};
  function homeCap(a){const f=fac[a.home];if(f&&f.alive)return f.cap;const F=fac.filter(f=>f.alive).sort((p,q)=>q.pop-p.pop)[0];a.home=F.id;return F.cap}
  function spawnActor(role,human=false){
    const alive=fac.filter(f=>f.alive),F=alive[Math.floor(rand()*alive.length)];
    let mask=0;const st=Math.floor(rand()*4),len=rand()<.3?3:2;for(let k=0;k<len;k++)mask|=1<<((st+k)%4);
    const a={id:nextId++,name:pick(SUR)+pick(GIV)+(rand()<.5?pick(GIV):''),role,human,home:F.id,tile:F.cap,ap:24,hp:100,food:5,wood:2,iron:1,salt:0,silver:15,
      camped:false,hungry:false,mask,skipDay:false,careful:.4+rand()*.6,target:-1,cargo:null,deaths:0,log:[]};
    for(const n of [a.tile,...NBR[a.tile]])catchUp(n,T);
    actors.push(a);alog(a,`以${ROLE[role]}身分在${F.n}的${nm(a.tile)}落腳。`);return a}
  function startLive(npcCount=25){live=true;curY=YEARS+1;yearStart(curY);
    const roles=['hunter','hunter','woodcutter','miner','trader','bounty'];
    for(let k=0;k<npcCount;k++)spawnActor(roles[k%roles.length]);
    say(curY,'npc',`${npcCount} 名旅人陸續來到這片土地。`)}
  function respawn(a){const cap=homeCap(a);a.deaths++;
    alog(a,`倒在${nm(a.tile)}。醒來時已被人抬進${nm(cap)}城裡，身上值錢的東西都沒了。`,a.tile,true);
    Object.assign(a,{tile:cap,hp:60,food:2,wood:0,silver:0,salt:0,ap:0,camped:false,target:-1,cargo:null})}
  function encounter(a){const i=a.tile,nightMul=night()?1.8:1,camp=a.camped?.35:1,town=isTown(i)?.25:1,asleep=!a.human&&!online(a)&&!a.camped?1.6:1;
    const pb=bandit[i]/160*nightMul*camp*town*asleep*(1+story);
    const pw=owner[i]<0&&gameK[i]>0?game[i]/(gameK[i]+30)*.12*nightMul*camp*(1+story):0;
    const r=rand();
    if(r<pb){story=Math.min(story,-.2);const mine=(.5+a.iron*.12+a.hp/250+(a.role==='bounty'?.4:0))*(.6+rand())*(online(a)?1:.6),foe=(.35+bandit[i]/90)*(.6+rand());
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
      const t=Math.min(timber[i]*.1,1+rand()*2);timber[i]-=t;a.wood+=t;return `砍了 ${t.toFixed(1)} 捆柴。`}
    if(kind==='mine'){if(vein[i]<=0)return '這裡沒有礦脈。';if(!need(4))return 'AP 不足（需要 4）。';
      if(!known[i]){known[i]=1;alog(a,`在${nm(i)}發現一條鐵礦脈。`,i,true)}
      const t=Math.min(vein[i],.5+rand());vein[i]-=t;a.iron+=t;if(vein[i]<=.5){vein[i]=0;say(curY,'econ',`${nm(i)}的鐵礦脈被挖掘殆盡。`,i)}return `挖出 ${t.toFixed(1)} 擔鐵。`}
    if(kind==='camp'){if(a.camped)return '已經紮營了。';if(!need(2))return 'AP 不足（需要 2）。';a.camped=true;return '紮營。'}
    if(kind==='sell'){if(!isTown(i))return '這裡沒有市集。';if(!need(1))return 'AP 不足。';
      const F=fac[owner[i]],keep={food:2,wood:1,iron:a.role==='bounty'?1:0,salt:0},parts=[];let g=0;
      for(const k of ['food','wood','iron','salt']){const q=Math.max(0,a[k]-keep[k]);if(q<.1)continue;const v=q*BASEP[k]*F.price[k];g+=v;F.stock[k]+=q;a[k]-=q;parts.push(`${GN[k]} ${q.toFixed(1)}`)}
      if(!parts.length)return '沒有多餘的東西可賣。';a.silver+=g;if(g>=25)alog(a,`在${nm(i)}賣出${parts.join('、')}，得 ${g.toFixed(0)} 銀。`,i,true);return `賣出${parts.join('、')}，得 ${g.toFixed(1)} 銀。`}
    if(kind==='buy'){const g=arg||'food',q=g==='food'?3:Math.min(6,Math.floor(a.silver/(BASEP[g]*fac[owner[i]]?.price[g]*1.1||1)));
      if(!isTown(i))return '這裡沒有市集。';const F=fac[owner[i]],price=BASEP[g]*F.price[g]*1.1;
      if(q<1||F.stock[g]<q+1)return `${nm(i)}買不到${GN[g]}。`;if(a.silver<price*q)return '錢不夠。';if(!need(1))return 'AP 不足。';
      a.silver-=price*q;F.stock[g]-=q;a[g]=(a[g]||0)+q;return `花 ${(price*q).toFixed(1)} 銀買了 ${q} 份${GN[g]}。`}
    if(kind==='raid'){if(bandit[i]<10)return '這裡沒什麼盜匪。';if(!need(4))return 'AP 不足（需要 4）。';
      const mine=(.6+a.iron*.15+a.hp/200)*(.6+rand()),foe=(.3+bandit[i]/70)*(.6+rand());
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
        const key=r==='hunter'?'food':r==='woodcutter'?'wood':'iron',full=r==='miner'?4:8;
        if(a[key]>=full){if(town){act(a,'sell');continue}if(!stepToward(a,nearest(i,isTown,12)))break;continue}
        const here=r==='hunter'?game[i]>Math.max(3,gameK[i]*.35):r==='woodcutter'?timber[i]>Math.max(5,timberK[i]*.3):vein[i]>0;
        if(here){const c=r==='miner'?4:3;if(a.ap<c)break;act(a,r==='hunter'?'hunt':r==='woodcutter'?'chop':'mine');continue}
        if(a.target<0||a.target===i||(r==='miner'&&vein[a.target]<=0))a.target=r==='hunter'?bestNear(i,n=>game[n]>3?game[n]:0,5):r==='woodcutter'?bestNear(i,n=>timber[n]>5?timber[n]:0,5):nearest(i,n=>vein[n]>0&&(known[n]||hdist(i,n)<=1),8);
        if(a.target<0){a.target=bestNear(i,n=>gameK[n]+timberK[n],6)}
        if(!stepToward(a,a.target)){a.target=-1;break}continue}
      if(r==='trader'){
        if(a.cargo){if(a.tile===a.cargo.to&&town){act(a,'sell');a.cargo=null;continue}if(!stepToward(a,a.cargo.to)){if(town){act(a,'sell');a.cargo=null}break}continue}
        if(!town){if(!stepToward(a,nearest(i,isTown,12)))break;continue}
        const F=fac[owner[i]];let best=null;
        for(let n=0;n<N;n++){if(!isTown(n)||n===i)continue;const d=hdist(i,n);if(d>10)continue;const G=fac[owner[n]];
          for(const g of ['salt','iron','food','wood']){const gain=G.price[g]*.95-F.price[g]*1.1-d*.04*(g==='food'||g==='wood'?1:.3);if(F.stock[g]>8&&(!best||gain>best.gain))best={gain,g,to:n}}}
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
  function periodTick(){computed=0;T++;
    banditStep(1/PY);
    if(T%4===0)for(const a of actors)a.skipDay=!a.human&&rand()<.12;   // 有些日子沒上線
    const order=actors.slice().sort(()=>rand()-.5);
    for(const a of order){const i=a.tile;
      a.ap=Math.min(24,a.ap+3);
      a.food-=.25;if(a.food<0){a.food=0;a.hp-=6;if(!a.hungry){a.hungry=true;alog(a,'口糧吃完了，開始挨餓。')}}else a.hungry=false;
      if(isTown(i))a.hp=Math.min(100,a.hp+3);
      if(night()){
        if(a.camped){if(a.wood>=.5){a.wood-=.5;a.hp=Math.min(100,a.hp+6)}else if(temp[i]<.45)a.hp-=3}
        else if(!isTown(i)&&temp[i]<.4&&curSeason()===3)a.hp-=6;
        encounter(a)}
      if(a.hp<=0){respawn(a);continue}
      if(online(a)&&!a.human){if(a.camped&&a.ap>2)a.camped=false;brain(a)}
      for(const n of [a.tile,...NBR[a.tile]])catchUp(n,T)}
    story=Math.min(1.5,story+.03);
    let ended=false;
    if(T%PS===0){const s=(curSeason()+3)%4;season(curY,s);
      if(s===3){yearEnd(curY);ownerHist.push(owner.slice());curY++;yearStart(curY);ended=true}}
    lastComputed=computed;return ended}

  // ===== 存檔：把整個世界的可變狀態匯出成一個物件，之後原樣讀回 =====
  const MUT={biome,fert,timberK,gameK,timber,game,vein,known,deforest,wall,vcap,vex,owner,pop,bandit,ruin,peak,lastT};
  function exportState(){const o={};for(const k in MUT)o[k]=MUT[k];
    return {...o,fac,events:ev.slice(-1500),graves,heroes:heroes.filter(h=>h.alive),routeSeen,tension,war,routes,T,curY,live,story,actors,nextId,rng:rand.state(),ownerHist,lastComputed}}
  function importState(S){for(const k in MUT)MUT[k].set(S[k]);
    fac.splice(0,fac.length,...S.fac);ev.splice(0,ev.length,...S.events);graves.splice(0,graves.length,...S.graves);heroes.splice(0,heroes.length,...S.heroes);
    for(const k of Object.keys(routeSeen))delete routeSeen[k];Object.assign(routeSeen,S.routeSeen);
    for(let a=0;a<FDEF.length;a++){tension[a]=S.tension[a].slice();war[a]=S.war[a].slice()}
    routes=S.routes;T=S.T;curY=S.curY;live=S.live;story=S.story;actors=S.actors;nextId=S.nextId;ownerHist=S.ownerHist||[];lastComputed=S.lastComputed||0;rand.setState(S.rng);
    netSig='';netYear=-99;if(live)yearStartNetOnly()}
  // 讀檔後路網與前線要重建（不存檔，因為可以重算）
  function yearStartNetOnly(){buildNet(curY);buildFronts()}
  function view(){const econ=fac.map(f=>({n:f.n,c:f.c,alive:f.alive,cap:f.alive?f.cap:-1,ratio:f.ratio,price:f.price,store:f.store||0,tiles:0,pop:0}));
    for(let i=0;i<N;i++)if(owner[i]>=0){econ[owner[i]].tiles++;econ[owner[i]].pop+=pop[i]}
    let pending=0;for(let i=0;i<N;i++)if(land[i]&&lastT[i]<T)pending++;
    const r8=a=>Array.from(a,v=>Math.round(v));
    return {stamp:stamp(),T,year:curY,period:T%4,season:curSeason(),computed:lastComputed,pending,story,
      owner:Array.from(owner),pop:r8(pop),bandit:r8(bandit),ruin:Array.from(ruin),wall:r8(wall),biome:Array.from(biome),timber:r8(timber),timberK:r8(timberK),game:r8(game),gameK:r8(gameK),
      vein:r8(vein),vcap:r8(vcap),vex:Array.from(vex),known:Array.from(known),econ,routes,graves,
      actors:actors.map(a=>({id:a.id,name:a.name,role:a.role,tile:a.tile,hp:Math.round(a.hp),ap:a.ap,online:online(a),camped:a.camped,silver:Math.round(a.silver),food:+a.food.toFixed(1),wood:+a.wood.toFixed(1),iron:+a.iron.toFixed(1),deaths:a.deaths,log:a.log.slice(-8)})),
      events:ev.slice(-160)}}

  w.events=ev;w.graves=graves;w.snaps=snaps;w.fac=fac;
  return {runHistory,startLive,periodTick,act,exportState,importState,view,spawnActor,actors:()=>actors,get live(){return live},get T(){return T}};
}



// 從存檔還原世界：地形（static）直接讀回，不重新生成，冷啟動才快
function staticOf(w){const {sim,events,snaps,graves,fac,...rest}=w;return rest}
function restore(Wst,S){const rand=mulberry32(1),pick=a=>a[Math.floor(rand()*a.length)];const w={...Wst};const sim=createSim(w,rand,pick);sim.importState(S);w.sim=sim;return w}

export {generate,staticOf,restore,W,H,N,YEARS,BIOMES,FDEF,NBR,GOODS,GN,BASEP,SEASON,MOVE,col,row,hdist};
