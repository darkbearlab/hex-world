import {W,H,N,BIOMES,FDEF,NBR,GOODS,GN,BASEP,col,row} from './sim.js';
const $=id=>document.getElementById(id);
const GC={food:'#e7b84a',wood:'#74b85e',iron:'#9fc3e6',stone:'#c7a98a',salt:'#f3efe4'};
const ROLE={hunter:'獵人',woodcutter:'樵夫',miner:'礦工',trader:'行商',bounty:'賞金獵人'};
const RC={hunter:'#e8a33d',woodcutter:'#5fbf6a',miner:'#a9b8c6',trader:'#e46ec0',bounty:'#ef5b4a'};
const TAG={war:'戰爭',ruin:'廢墟',hero:'英雄',bandit:'盜匪',disaster:'天災',found:'開拓',econ:'物資',trade:'貿易',build:'築城',npc:'旅人',you:'你'};
const PERIOD=['晨','午','暮','夜'];
let ST=null,S=null,layer='faction',tmode='ratio',cf='all',sel=-1,selActor=-1,R=10,centers=[],histData=null,viewYear=null;
const cv=$('map'),ctx=cv.getContext('2d');

function layout(){const cssW=cv.parentElement.clientWidth-16;R=cssW/(Math.sqrt(3)*(W+.5));const cssH=R*(1.5*(H-1)+2);
  const dpr=window.devicePixelRatio||1;cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);cv.style.height=cssH+'px';ctx.setTransform(dpr,0,0,dpr,0,0);
  centers=[];for(let i=0;i<N;i++){const c=col(i),r=row(i);centers.push([Math.sqrt(3)*R*(c+.5*(r&1))+Math.sqrt(3)*R/2,R+1.5*R*r])}}
function hexPath(x,y,r){ctx.beginPath();for(let k=0;k<6;k++){const a=Math.PI/180*(60*k-30);const px=x+r*Math.cos(a),py=y+r*Math.sin(a);k?ctx.lineTo(px,py):ctx.moveTo(px,py)}ctx.closePath()}
function hexRGB(h){if(h[0]!=='#')return h.match(/\d+/g).map(Number);const n=parseInt(h.slice(1),16);return[n>>16&255,n>>8&255,n&255]}
function mix(a,b,t){const A=hexRGB(a),B=hexRGB(b);return`rgb(${A.map((v,i)=>Math.round(v+(B[i]-v)*t)).join(',')})`}
const isHist=()=>viewYear!==null&&histData&&viewYear<S.year;
function ownerAt(y){if(y<=400)return histData.genesis.slice(y*N,(y+1)*N);return histData.live[y-401]||S.owner}

function draw(){if(!S||!ST)return;ctx.clearRect(0,0,cv.width,cv.height);
  const hist=isHist(),own=hist?ownerAt(viewYear):S.owner;
  for(let i=0;i<N;i++){const [x,y]=centers[i],b=S.biome[i],base=BIOMES[b].c;let fill=base;
    if(ST.land[i]){const dull=mix(base,'#8a8c86',.65);
      if(layer==='faction'||hist){const o=own[i];fill=o>=0?mix(mix(base,'#888888',.5),FDEF[o].c,.35+(hist?.25:Math.min(.5,S.pop[i]/160))):mix(base,'#7a7a72',.55)}
      else if(layer==='bandit')fill=mix(dull,'#b3261e',Math.min(1,S.bandit[i]/100*1.4));
      else if(layer==='timber')fill=mix(dull,'#2e7d32',Math.min(1,S.timber[i]/110));
      else if(layer==='game')fill=mix(dull,'#c27a1e',Math.min(1,S.game[i]/60));
      else if(layer==='ore')fill=mix(dull,'#5b5f66',.25);
      else{const sh=(ST.elev[i]-.36)*.3;fill=mix(base,'#ffffff',Math.max(0,sh-.08))}}
    hexPath(x,y,R*1.01);ctx.fillStyle=fill;ctx.fill()}
  if(layer==='faction'||hist)for(let i=0;i<N;i++){const o=own[i];if(o<0)continue;
    if(NBR[i].some(n=>own[n]!==o)||NBR[i].length<6){hexPath(centers[i][0],centers[i][1],R*.82);ctx.strokeStyle=FDEF[o].c;ctx.lineWidth=Math.max(1,R*.14);ctx.stroke()}}
  ctx.strokeStyle='#6fb4e0';ctx.lineWidth=Math.max(1.2,R*.22);ctx.lineCap='round';ctx.lineJoin='round';
  for(const p of ST.riverPaths){ctx.beginPath();p.forEach((t,k)=>{const[x,y]=centers[t];k?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()}
  const fs=Math.max(9,R*1.05);ctx.font=`700 ${fs}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const mark=(i,ch,c,sz)=>{const[x,y]=centers[i];if(sz)ctx.font=`700 ${sz}px system-ui,sans-serif`;ctx.lineWidth=3;ctx.strokeStyle='#0009';ctx.strokeText(ch,x,y);ctx.fillStyle=c;ctx.fillText(ch,x,y);if(sz)ctx.font=`700 ${fs}px system-ui,sans-serif`};
  if(hist){ctx.fillStyle='#0006';ctx.fillRect(0,0,cv.width,cv.height);return}
  if(layer==='ore'||layer==='terrain')for(let i=0;i<N;i++){if(!S.vex[i])continue;const v=S.vein[i];
    if(v<=0)mark(i,'◇','#9aa0a6');else mark(i,'◆',S.known[i]?'#dfe7ee':'#ffffff55',Math.max(8,fs*(.6+.6*v/Math.max(1,S.vcap[i]))))}
  if(layer==='faction'||layer==='terrain')for(let i=0;i<N;i++){const wl=S.wall[i];if(!wl)continue;const [x,y]=centers[i],z=R*(.22+.12*wl);
    ctx.fillStyle='#eae3d2';ctx.strokeStyle='#000a';ctx.lineWidth=1.5;ctx.fillRect(x-z,y+R*.25-z/2,z*2,z);ctx.strokeRect(x-z,y+R*.25-z/2,z*2,z)}
  for(let i=0;i<N;i++)if(S.ruin[i])mark(i,'✕','#e8dfcf');
  for(const g of S.graves)mark(g.tile,'†','#f2d27a');
  if(layer==='faction')for(const r of S.routes){const tot=GOODS.reduce((a,g)=>a+r.flow[g],0);if(tot<.3)continue;
    const g=GOODS.slice().sort((p,q)=>r.flow[q]-r.flow[p])[0],wd=Math.max(1.6,Math.min(R*.6,1+Math.sqrt(tot)*.7));
    for(let k=1;k<r.path.length;k++){const a=r.path[k-1],b=r.path[k],[x1,y1]=centers[a],[x2,y2]=centers[b],sea=!ST.land[a]||!ST.land[b];
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.lineCap='round';ctx.setLineDash([]);ctx.strokeStyle='#000b';ctx.lineWidth=wd+2;ctx.stroke();
      ctx.setLineDash(sea?[1,R*.35]:[]);ctx.strokeStyle=GC[g];ctx.lineWidth=wd;ctx.stroke()}ctx.setLineDash([])}
  S.econ.forEach((e,f)=>{if(e.cap>=0)mark(e.cap,'★',FDEF[f].c)});
  const dark=[.08,0,.22,.45][S.period];if(dark){ctx.fillStyle=`rgba(8,14,40,${dark})`;ctx.fillRect(0,0,cv.width,cv.height)}
  // 旅人：同一格多人時圍成一圈
  const byTile={};for(const a of S.actors)(byTile[a.tile]=byTile[a.tile]||[]).push(a);
  for(const t in byTile){const list=byTile[t],[cx,cy]=centers[t];list.forEach((a,k)=>{const ang=k/list.length*Math.PI*2,off=list.length>1?R*.42:0,x=cx+Math.cos(ang)*off,y=cy+Math.sin(ang)*off,r=Math.max(3,R*.3);
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=a.online?RC[a.role]:'#555';ctx.fill();ctx.lineWidth=a.id===selActor?2.5:1.2;ctx.strokeStyle=a.id===selActor?'#fff':'#000c';ctx.stroke();
    if(a.camped){ctx.fillStyle='#ffcf6b';ctx.beginPath();ctx.moveTo(x,y-r*2.1);ctx.lineTo(x-r*.7,y-r*1.1);ctx.lineTo(x+r*.7,y-r*1.1);ctx.fill()}})}
  if(sel>=0){hexPath(centers[sel][0],centers[sel][1],R*1.02);ctx.strokeStyle='#fff';ctx.lineWidth=2.2;ctx.stroke()}}

function pct(r){const v=Math.round(r*100),c=v>=95?'ok':v>=70?'warn':'bad';return`<td class="r ${c}">${v}%</td>`}
function prc(g,idx){const c=idx<=.8?'ok':idx<1.6?'':idx<2.4?'warn':'bad';return`<td class="r ${c}">${(BASEP[g]*idx).toFixed(1)}</td>`}
function renderFactions(){const head=tmode==='ratio'?'<th>糧</th><th>木材</th><th>鐵</th><th>石材</th><th>鹽</th><th>冬前存糧</th>':'<th>糧</th><th>木材</th><th>鐵</th><th>石材</th><th>鹽</th>';
  const rows=S.econ.map((e,k)=>{const f=FDEF[k];if(!e.alive)return`<tr class="dead"><th><i style="background:${f.c}"></i>${f.n}</th><td colspan="${tmode==='ratio'?8:7}">已滅亡</td></tr>`;
    const cells=tmode==='ratio'?GOODS.map(g=>pct(e.ratio[g])).join('')+`<td class="r ${e.store>=2?'ok':e.store>=1.2?'warn':'bad'}">${e.store.toFixed(1)} 季</td>`:GOODS.map(g=>prc(g,e.price[g])).join('');
    return`<tr><th><i style="background:${f.c}"></i>${f.n}</th><td>${e.tiles}</td><td>${Math.round(e.pop)}</td>${cells}</tr>`}).join('');
  $('ehead').textContent=tmode==='ratio'?'需求滿足率':'市價（銀）';
  $('factions').innerHTML=`<div class="tw"><table class="econ"><thead><tr><th>勢力</th><th>領地</th><th>人口</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`}
function renderRoster(){const sorted=S.actors.slice().sort((a,b)=>(b.online-a.online)||a.role.localeCompare(b.role));
  $('roster').innerHTML=sorted.map(a=>`<button class="npc" data-id="${a.id}" aria-pressed="${a.id===selActor}"><b><span class="dot" style="background:${a.online?RC[a.role]:'#777'}"></span>${a.name}</b>
    <small>${ROLE[a.role]}・${a.online?'上線':a.camped?'離線（紮營）':'離線'}・${ST.names[a.tile]}</small><small>${a.silver} 銀・糧 ${a.food}${a.deaths?`・倒下 ${a.deaths} 次`:''}</small>
    <div class="hpbar"><i class="${a.hp<35?'low':''}" style="width:${Math.max(0,a.hp)}%"></i></div></button>`).join('');
  const a=S.actors.find(x=>x.id===selActor);
  $('actor').innerHTML=a?`<span class="lbl">${ROLE[a.role]}的日誌</span><h2>${a.name}</h2><div class="hint">生命 ${a.hp}・AP ${a.ap}/24・銀 ${a.silver}・糧 ${a.food}・柴 ${a.wood}・鐵 ${a.iron}・目前在${ST.names[a.tile]}</div>
    <ul class="alog">${a.log.slice().reverse().map(e=>`<li><span>${e.ts.replace(/^\d+ 年 /,'')}</span>${e.text}</li>`).join('')}</ul>`:''}
function renderChron(){const list=S.events.filter(e=>cf==='all'||(cf==='npc'?e.type==='npc':e.type!=='npc')).slice().reverse();
  $('chronHead').textContent=`第 ${S.year} 年・最近 ${list.length} 條`;
  $('chron').innerHTML=list.map(e=>`<li data-tile="${e.tile}"><span class="y">${e.ts?e.ts.replace(/^(\d+) 年 /,'$1 '):e.y+' 年'}</span><span class="t"><span class="tag ${e.type}">${TAG[e.type]||e.type}</span>${e.text}</span></li>`).join('')}
function renderTile(){if(sel<0)return;const i=sel,b=S.biome[i];
  if(!ST.land[i]){$('tile').innerHTML=`<span class="lbl">地塊</span><h2>${BIOMES[b].n}</h2><div class="hint">這片海域沒有人居住。</div>`;return}
  const o=S.owner[i],who=S.actors.filter(a=>a.tile===i);
  $('tile').innerHTML=`<span class="lbl">地塊 · ${col(i)},${row(i)}</span><h2>${ST.names[i]}</h2>
  <dl class="kv"><dt>地貌</dt><dd>${BIOMES[b].n}${ST.river[i]?'，有河流經過':''}${ST.coast[i]?'，臨海':''}</dd>
  <dt>歸屬</dt><dd>${o>=0?FDEF[o].n:(S.ruin[i]?'無主（廢墟）':'無主')}</dd><dt>人口</dt><dd>${S.pop[i]}</dd><dt>盜匪壓力</dt><dd>${S.bandit[i]} / 100</dd>
  <dt>木材</dt><dd>${S.timberK[i]?`${S.timber[i]} / ${S.timberK[i]}`:'無'}</dd><dt>獵物</dt><dd>${S.gameK[i]?`${S.game[i]} / ${S.gameK[i]}`:'無'}</dd>
  <dt>鐵礦</dt><dd>${S.vex[i]?(S.vein[i]<=0?'已挖光':S.known[i]?`剩 ${S.vein[i]} / ${S.vcap[i]}`:'有礦脈，尚未發現'):'無'}</dd><dt>城牆</dt><dd>${S.wall[i]?S.wall[i]+' 重':'無'}</dd>
  <dt>旅人</dt><dd>${who.length?who.map(a=>`${a.name}（${ROLE[a.role]}）`).join('、'):'無'}</dd></dl>`}
const LEG={terrain:'地貌：◆ 鐵礦脈，◇ 已挖光。',faction:'勢力：彩色線是商隊實際走的路（黃＝糧、綠＝木材、藍＝鐵、褐＝石材、白＝鹽），白色方塊是城牆。',bandit:'盜匪：越紅壓力越高。',timber:'木材：越綠存量越多。',game:'獵物：越橘越多。',ore:'礦脈：◆ 越大剩餘越多。'};
function renderLegend(){$('legend').innerHTML=isHist()?`正在看第 ${viewYear} 年的勢力範圍。按「回到現在」看即時的世界。`:
  LEG[layer]+'　圓點是旅人（<span style="color:#e8a33d">獵人</span>・<span style="color:#5fbf6a">樵夫</span>・<span style="color:#a9b8c6">礦工</span>・<span style="color:#e46ec0">行商</span>・<span style="color:#ef5b4a">賞金獵人</span>，灰色＝離線，黃色小帳篷＝紮營）。'}
function renderClock(){if(!S)return;$('clock').textContent=S.stamp;
  const left=Math.max(0,S.nextAt-(Date.now()-clockSkew));const m=Math.floor(left/60000),s=Math.floor(left/1000)%60;
  $('countdown').textContent=`下一個時段：${m}:${String(s).padStart(2,'0')}　｜　本時段實際計算 ${S.computed} 格，${S.pending} 格待補算`;
  $('badge').textContent=isHist()?`第 ${viewYear} 年`:`${PERIOD[S.period]}`}
function render(){if(!S)return;$('year').max=S.year;if(viewYear===null)$('year').value=S.year;draw();renderFactions();renderRoster();renderChron();renderTile();renderLegend();renderClock()}

let clockSkew=0,timer=null;
async function poll(){try{const r=await fetch('/api/state',{cache:'no-store'});S=await r.json();clockSkew=Date.now()-S.now;$('busy').hidden=true;
    $('tickdesc').textContent=S.tickMs>=60000?`${Math.round(S.tickMs/60000)} 分鐘`:`${Math.round(S.tickMs/1000)} 秒`;render()}
  catch(e){$('busy').hidden=false;$('busy').textContent='連不上世界，稍後自動重試…'}
  clearTimeout(timer);const wait=S?Math.min(30000,Math.max(3000,S.nextAt-(Date.now()-clockSkew)+2500)):10000;timer=setTimeout(poll,wait)}
async function boot(){ST=await (await fetch('/api/static')).json();layout();await poll();setInterval(renderClock,1000)}

document.querySelectorAll('[data-layer]').forEach(b=>b.addEventListener('click',()=>{layer=b.dataset.layer;document.querySelectorAll('[data-layer]').forEach(x=>x.setAttribute('aria-pressed',x===b));draw();renderLegend()}));
document.querySelectorAll('[data-tmode]').forEach(b=>b.addEventListener('click',()=>{tmode=b.dataset.tmode;document.querySelectorAll('[data-tmode]').forEach(x=>x.setAttribute('aria-pressed',x===b));renderFactions()}));
document.querySelectorAll('[data-cf]').forEach(b=>b.addEventListener('click',()=>{cf=b.dataset.cf;document.querySelectorAll('[data-cf]').forEach(x=>x.setAttribute('aria-pressed',x===b));renderChron()}));
$('roster').addEventListener('click',e=>{const b=e.target.closest('.npc');if(!b)return;selActor=+b.dataset.id===selActor?-1:+b.dataset.id;const a=S.actors.find(x=>x.id===selActor);if(a)sel=a.tile;render()});
$('chron').addEventListener('click',e=>{const li=e.target.closest('li');if(!li)return;const t=+li.dataset.tile;if(t>=0){sel=t;draw();renderTile()}});
cv.addEventListener('click',e=>{const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=-1,bd=1e9;
  for(let i=0;i<N;i++){const d=(centers[i][0]-x)**2+(centers[i][1]-y)**2;if(d<bd){bd=d;best=i}}sel=best;draw();renderTile()});
$('year').addEventListener('input',async e=>{if(!histData){$('legend').textContent='載入歷史中…';histData=await (await fetch('/api/history')).json()}
  const y=+e.target.value;viewYear=y>=S.year?null:y;draw();renderLegend();renderClock()});
$('now').addEventListener('click',()=>{viewYear=null;$('year').value=S.year;render()});
let rt;window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>{layout();draw()},120)});
boot();
