// Clear bot measurement (docs/CLEAR_BOT.md): how exposed the bot was, step by step, on the same definition the main
// session used on the player's run logs (2026-09-30). This is a yardstick, not an input: it reads the enemies' alert
// state and their sight of us, which the bot's own decisions never see.
//   exposure per action: alert armed enemies that can see us and are within their card's range; `open` = of those, the
//   ones we have no protectingCover from. Fall-back episodes: in combat, 1-5 moves in a row that end with fewer enemies
//   seeing us or fewer uncovered, followed within 3 actions by an attack from that tile ("fall back, then hold").
import {ENEMY_TYPES} from '../../src/data.js';
import {isNoncombatant} from '../../src/enemy-data.js';
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export function exposureNow(g){
 const p=g.player;let see=0,open=0,near=99;
 for(const e of g.enemies){if(e.hp<=0||isNoncombatant(e)||!e.alert)continue;const d=dist(e,p),r=ENEMY_TYPES[e.type]?.range||1;
  if(g.sight(e,p)){near=Math.min(near,d);if(d<=Math.max(r,1)){see++;if(!g.protectingCover(p,e))open++;}}}
 return {see,open,near,turn:g.turn,floor:g.floor,x:p.x,y:p.y};
}
export const ATTACKS=new Set(['fire','launch','blindFire','bumpMelee','grenade','usePrepared','skill']);
// steps: [{type, b:exposure before, a:exposure after}]
export function summarize(steps){
 const combat=steps.filter(s=>s.b.see>0||s.a.see>0);
 const bucket=v=>v>=3?'3+':String(v);
 const hist=k=>{const h={0:0,1:0,2:0,'3+':0};for(const s of combat)h[bucket(s.b[k])]++;return h;};
 const attack=s=>ATTACKS.has(s.type);
 const episodes=[];
 for(let k=0;k<steps.length;k++){
  const s=steps[k];if(s.type!=='move'||s.b.see===0)continue;
  let j=k;while(j+1<steps.length&&steps[j+1].type==='move'&&steps[j+1].b.floor===s.b.floor&&j-k<5)j++;
  const start=s.b,end=steps[j].a;
  if(end.see<start.see||end.open<start.open){
   const next=steps.slice(j+1,j+4).find(t=>attack(t)&&t.b.x===end.x&&t.b.y===end.y);
   episodes.push({moves:j-k+1,held:Boolean(next)});
  }
  k=j;
 }
 const attacksBySeen={0:0,1:0,2:0,'3+':0};for(const s of combat)if(attack(s))attacksBySeen[bucket(s.b.see)]++;
 return {actions:steps.length,combat:combat.length,seen:hist('see'),open:hist('open'),attacksBySeen,
  fallBacks:episodes.length,fallBacksThenHold:episodes.filter(e=>e.held).length,multiTurn:episodes.filter(e=>e.moves>=2).length,
  moves:episodes.reduce((a,e)=>a+e.moves,0)};
}
// Adds one run's summary into a running total (the counts add; percentages are taken at print time).
export function addSummary(total,s){
 if(!s)return total;
 for(const k of ['actions','combat','fallBacks','fallBacksThenHold','multiTurn','moves'])total[k]=(total[k]||0)+s[k];
 for(const k of ['seen','open','attacksBySeen']){total[k]||={0:0,1:0,2:0,'3+':0};for(const b in s[k])total[k][b]+=s[k][b];}
 return total;
}
export function formatProfile(t){
 if(!t?.combat)return 'no combat';
 const pct=h=>{const n=Object.values(h).reduce((a,b)=>a+b,0)||1;return Object.entries(h).map(([k,v])=>`${k}:${Math.round(100*v/n)}%`).join(' ');};
 return `seen-by ${pct(t.seen)} | open-to ${pct(t.open)} | attacks by seen ${pct(t.attacksBySeen)} | fall-backs ${t.fallBacks} (then hold ${t.fallBacksThenHold}, 2+ moves ${t.multiTurn}, avg ${(t.moves/Math.max(1,t.fallBacks)).toFixed(1)} moves) per ${t.combat} combat actions`;
}
