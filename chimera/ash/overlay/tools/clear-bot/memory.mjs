// Clear bot memory (docs/CLEAR_BOT.md): what the bot remembers on its own, as a player would. Nothing here is read
// from hidden game state: ghosts are enemies it saw and lost sight of, marks are its own bookkeeping.
import {key,dist} from './util.mjs';

export const MEMORY_TUNING=Object.freeze({ghostTurns:12});
export class Memory{
 constructor(){this.floor=null;this.reset(0);}
 reset(floor){
  this.floor=floor;this.lastSeen=new Map();this.visits=new Map();this.skipTerminals=new Set();this.skipItems=new Set();
  this.skipTargets=new Set();this.skipExplore=new Set();this.ignored=new Map();this.late=false;this.blockedEdges=new Map();this.bossSeen=null;this.stuck=0;this.goal=null;this.explored=0;this.lastProgress=0;
  this.avoid=new Map();this.trail=[];this.bounces=0;   // tiles the bot bounced between (key → until turn), recent tiles, count
 }
 // Called by perception with the enemies in sight this turn.
 observe(g,seen){
  if(this.floor!==g.floor)this.reset(g.floor);
  for(const e of seen){if(e.civilian)continue;this.lastSeen.set(e.id,{id:e.id,type:e.type,x:e.x,y:e.y,hp:e.hp,boss:e.boss,range:e.range,melee:e.melee,damage:e.damage,turn:g.turn});if(e.boss)this.bossSeen={id:e.id,x:e.x,y:e.y,turn:g.turn};}
  // A remembered tile in plain sight with nobody on it: it has moved on.
  for(const [id,m] of this.lastSeen){
   if(seen.some(e=>e.id===id))continue;
   if(g.turn-m.turn>MEMORY_TUNING.ghostTurns&&!m.boss){this.lastSeen.delete(id);continue;}
   if(g.visibleTiles?.has(key(m))&&!seen.some(e=>e.id===id))this.lastSeen.delete(id);
  }
 }
 forget(id){this.lastSeen.delete(id);}
 ghosts(g){return [...this.lastSeen.values()].filter(m=>g.turn-m.turn<=MEMORY_TUNING.ghostTurns||m.boss);}
 visit(p){const k=key(p);const n=(this.visits.get(k)||0)+1;this.visits.set(k,n);return n;}
}
