// 設定對照：把《已知世界》筆記裡對「現在」的描述，逐條拿來跟模擬結果比
// 輸入 view（sim.view() 的結果）與 W、H；回傳每一條的判定與數據
export function loreCheck(v,W,H){
  const E=v.econ,F=k=>E[k],N=W*H,HH=H*.866,uOf=i=>Math.floor(i/W)*.866/HH;
  const alive=k=>F(k)&&F(k).alive,name=k=>F(k).n;
  const EL=[0,1,2,3,4],elA=EL.filter(alive);
  let northLand=0,northEl=0,northWild=0;
  for(let i=0;i<N;i++){if(!v.land||!v.land[i]||uOf(i)>=.32||uOf(i)<.06)continue;northLand++;const o=v.owner[i];
    if(o>=0&&F(o).elector)northEl++;if(o<0||F(o).tr.includes('free')||F(o).tr.includes('orc'))northWild++}
  const rank=(k,key,pool)=>{const xs=pool.filter(alive).map(j=>[j,key(F(j))]).sort((a,b)=>b[1]-a[1]);const r=xs.findIndex(x=>x[0]===k);return r<0?99:r+1};
  const all=E.map((_,k)=>k).filter(alive);
  const horde=E.find(e=>e.alive&&e.tr.includes('orc'));
  const kegToEv=v.tradeFood?v.tradeFood[9][0]:0,kegFood=v.tradeFood?v.tradeFood[9].reduce((a,b)=>a+b,0):0;
  const R=[];
  const add=(id,text,ok,detail)=>R.push({id,text,ok:!!ok,detail});
  add('north','北方荒原已不在帝國手中',northEl<=northLand*.25,`北方 ${northLand} 格陸地，選帝侯只握有 ${northEl} 格`);
  add('wild','北方是自由民與獸人的天下',northWild>=northLand*.5||v.orcs>0,`無主、自由民或獸人的格子 ${northWild} 格，獸人部落 ${v.orcs} 股`);
  add('orcsplit','獸人四分五裂，沒有共主',!horde,horde?`${horde.n}仍在，佔 ${horde.tiles} 格`:`各部分散，共 ${v.orcs} 股`);
  add('electors','五個選帝侯都還在，且彼此不臣屬',elA.length===5&&elA.every(k=>F(k).liege<0),`還在的：${elA.map(name).join('、')||'無'}${elA.filter(k=>F(k).liege>=0).map(k=>`；${name(k)}臣屬${name(F(k).liege)}`).join('')}`);
  add('evstrong','艾文鐸是兵源最多的選帝侯',alive(0)&&rank(0,e=>e.pop,EL)===1,alive(0)?`人口在選帝侯中排第 ${rank(0,e=>e.pop,EL)}`:'艾文鐸已亡');
  add('emperor','皇位在艾文鐸手上',v.emperor===0,`現任皇帝：${alive(v.emperor)?name(v.emperor):'（無）'}`);
  add('elrich','雅蘭追爾靠貿易崛起',alive(3)&&rank(3,e=>e.L.exp,all)<=2,alive(3)?`出口收入在全世界排第 ${rank(3,e=>e.L.exp,all)}，銀兩排第 ${rank(3,e=>e.silver,all)}`:'雅蘭追爾已亡');
  add('elmerc','雅蘭追爾養最多傭兵',alive(3)&&rank(3,e=>e.L.merc,all)===1,alive(3)?`傭兵支出排第 ${rank(3,e=>e.L.merc,all)}`:'雅蘭追爾已亡');
  add('soltoll','索辣拉靠過路費坐大',alive(7)&&rank(7,e=>e.L.toll,all)===1,alive(7)?`過路費收入排第 ${rank(7,e=>e.L.toll,all)}（${Math.round(F(7).L.toll)} 兩）`:'索辣拉已亡');
  add('goldgrain','金穗是主要的糧食出口國',alive(8)&&F(8).L.foodEx>0&&rank(8,e=>e.L.foodEx,all)<=2,alive(8)?`糧食淨出口 ${Math.round(F(8).L.foodEx)} 擔，排第 ${rank(8,e=>e.L.foodEx,all)}`:'金穗已亡');
  add('kegia','凱基雅的畜牧糧產賣不進艾文鐸',!alive(9)||kegToEv<Math.max(1,kegFood)*.15,alive(9)?`凱基雅糧食出口 ${Math.round(kegFood)} 兩，其中賣給艾文鐸 ${Math.round(kegToEv)} 兩`:'凱基雅已亡');
  add('emerald','翡翠海岸人口外流',alive(6)&&F(6).L.migOut>F(6).L.migIn,alive(6)?`移出 ${Math.round(F(6).L.migOut)}、移入 ${Math.round(F(6).L.migIn)}`:'翡翠海岸已亡');
  add('warlords','依賽卡與烏煞兩個林中軍閥都還在',alive(10)&&alive(11),`依賽卡${alive(10)?'在':'已亡'}、烏煞${alive(11)?'在':'已亡'}`);
  add('green','格林瓦德內部不穩（諸子爭位、地方自立）',alive(5)&&(F(5).L.crisis>=2||F(5).L.seced>=1),alive(5)?`爭位 ${F(5).L.crisis} 次、地方自立 ${F(5).L.seced} 次`:'格林瓦德已亡');
  add('elves','精靈森林仍在且獨立',alive(12)&&F(12).liege<0,alive(12)?(F(12).liege>=0?`臣屬${name(F(12).liege)}`:`${F(12).tiles} 格`):'精靈森林已亡');
  add('leth','列羅多斯的兵最精',alive(2)&&rank(2,e=>e.vet,EL)===1,alive(2)?`老兵係數 ${F(2).vet}，在選帝侯中排第 ${rank(2,e=>e.vet,EL)}`:'列羅多斯已亡');
  return R}
