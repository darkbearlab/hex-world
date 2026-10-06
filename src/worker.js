// 六角世界：Cloudflare Worker 入口與世界本體（Durable Object）
import {DurableObject} from 'cloudflare:workers';
import {restore} from './sim.js';
import {decode} from './codec.js';
import genesisRaw from './genesis.json';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

export class World extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.w=null;this.nextAt=0}
  tickMs(){return Math.max(60,+(this.env.TICK_SECONDS||300))*1000}
  paused(){return this.env.PAUSED==='1'}

  // 讀檔：記憶體裡沒有世界就從儲存空間讀；版本不同或沒有存檔就從創世檔開始
  async load(){
    if(this.w)return;
    const st=this.ctx.storage;
    const got=await st.get(['version','static','state']);
    let stat=got.get('static'),state=got.get('state');
    if(!state||got.get('version')!==this.env.WORLD_VERSION){
      const G=decode(genesisRaw);
      stat=G.static;state=G.state;
      await st.deleteAll();
      await st.put({version:this.env.WORLD_VERSION,seed:G.seed,static:stat,state,hist:G.hist,archive:G.archive,startedAt:Date.now()});
    }
    this.w=restore(stat,state);
    const alarm=await st.getAlarm();
    if(this.paused()){if(alarm!=null)await st.deleteAlarm();this.nextAt=0;return}
    if(alarm==null)await st.setAlarm(Date.now()+this.tickMs());
    this.nextAt=alarm??Date.now()+this.tickMs();
  }

  // 世界時鐘：每次鬧鐘推進一個時段，存檔，再排下一次
  async alarm(){
    await this.load();
    if(this.paused()){await this.ctx.storage.deleteAlarm();return}   // 暫停：不推進、不再排下一次
    const ended=this.w.sim.periodTick();
    const st=this.ctx.storage;
    await st.put('state',this.w.sim.exportState());
    if(ended)await st.put('lastYearAt',Date.now());
    this.nextAt=Date.now()+this.tickMs();
    await st.setAlarm(this.nextAt);
  }

  async fetch(req){
    await this.load();
    const url=new URL(req.url),st=this.ctx.storage;
    if(url.pathname==='/api/state'){const v=this.w.sim.view();v.paused=this.paused();v.nextAt=this.nextAt;v.tickMs=this.tickMs();v.now=Date.now();return json(v)}
    if(url.pathname==='/api/static'){const w=this.w;
      return json({W:30,H:24,names:w.names,land:w.land,elev:Array.from(w.elev,x=>+x.toFixed(3)),river:Array.from(w.river),coast:Array.from(w.coast),riverPaths:w.riverPaths,
        water:Array.from(w.water,x=>+x.toFixed(2)),fert:Array.from(w.fert,x=>+x.toFixed(2)),saltK:Array.from(w.saltK,x=>+x.toFixed(2)),seed:await st.get('seed')})}
    if(url.pathname==='/api/history'){const hist=await st.get('hist');const live=this.w.sim.exportState().ownerHist;
      return json({years:hist.length/720+live.length,genesis:Array.from(hist),live:live.map(a=>Array.from(a))})}
    if(url.pathname==='/api/archive'){return json(await st.get('archive'))}
    return json({error:'找不到這個 API'},404);
  }
}

export default {
  async fetch(req,env){
    const url=new URL(req.url);
    if(url.pathname.startsWith('/api/')){const stub=env.WORLD.get(env.WORLD.idFromName('main'));return stub.fetch(req)}
    return env.ASSETS.fetch(req);
  }
};
