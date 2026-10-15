// Clear bot navigation (docs/CLEAR_BOT.md): routes over the explored map only (unless the view's `mapKnown` option is
// on). A tile is walkable when it has been seen and the rules say it can be stood on; an edge is crossable when the rules
// route through it (open or closed door, low partition), or it is a locked vault door and we carry this floor's keycard.
import {barrierBetween,edgeBlocks,vaultable} from '../../src/barriers.js';
import {DIRS,key,dist} from './util.mjs';
import {hazardAt} from './perception.mjs';
import {SIZE} from '../../src/data.js';
import {swapReason} from '../../src/allies.js';
import {isNoncombatant} from '../../src/enemy-data.js';

export function walkable(view,x,y){
 const g=view.g;
 return x>=0&&y>=0&&x<SIZE&&y<SIZE&&view.known(x,y)&&g.passable(x,y);
}
export function crossable(view,a,b){
 const g=view.g;if(g.canRoute(a,b))return true;
 const edge=barrierBetween(g.barriers,a,b);
 return Boolean(edge&&edge.type==='door'&&edge.locked&&view.me.keycard);
}
const edgeCost=(g,a,b)=>{const e=barrierBetween(g.barriers,a,b);return e&&edgeBlocks(e)?(vaultable(e)?2:1):0;};
// Why we could not swap with `ally` stepping in from `q` (the rules' swapReason judges from where the player stands now,
// so an ally across a partition read as swappable from two tiles away and not from beside it, and a route flipped
// between the two every step).
function swapFrom(g,q,ally){
 if(q.x===g.player.x&&q.y===g.player.y)return swapReason(g,ally);
 const at=Object.create(g);at.player={...g.player,x:q.x,y:q.y};
 return swapReason(at,ally);
}
// Dijkstra from us. `goal(q)` ends the search; `cost(q)` adds to entering q (Infinity = blocked). Enemies block their
// tiles. Allies that can swap cost `allyCost` (default: the view's, else 2: in a fight, keep a pet in front of us); the
// bot's walks to goals set 0, as any extra cost made routes flip every turn while a necromancer's train shuffled behind
// it. Allies that cannot swap cost a lot. A civilian blocks too, unless `civilianCost` (default: the view's) is finite:
// then its tile costs that much, the price of clearing it (walking into it is a bump attack). Returns
// {first, path, cost, end, through} or null; `through` lists the civilians on the path, nearest first.
export function route(view,goal,{cost=null,maxCost=400,allowEnemyGoal=false,ignoreUnits=false,unknownGoal=false,civilianCost=view.civilianCost??Infinity,allyCost=view.allyCost??2}={}){
 const g=view.g,start={x:view.me.x,y:view.me.y};
 // Only enemies we can see block a route; walking into one we cannot see is a blind attack, as for a player.
 const seen=g.enemies.filter(e=>e.hp>0&&g.teamVisible(e));
 const civAt=new Map(seen.filter(e=>isNoncombatant(e)).map(e=>[key(e),e]));
 const passCiv=ignoreUnits||Number.isFinite(civilianCost);
 const enemyAt=new Set(ignoreUnits?[]:seen.filter(e=>!(passCiv&&isNoncombatant(e))).map(key));
 const allyAt=new Map((view.allies||[]).map(a=>[key(a),a]));
 const best=new Map([[key(start),0]]),prev=new Map(),buckets=[[start]];
 for(let c=0;c<buckets.length&&c<=maxCost;c++){
  for(const q of buckets[c]||[]){
   if(best.get(key(q))<c)continue;
   if(c>0&&goal(q)){
    const path=[];let k=key(q),cur=q;while(k!==key(start)){path.unshift(cur);cur=prev.get(k);k=key(cur);}
    const through=passCiv?path.map(p=>civAt.get(key(p))).filter(Boolean):[];
    return {first:[path[0].x-start.x,path[0].y-start.y],path,cost:c,end:q,through};
   }
   for(const [dx,dy] of DIRS){
    const n={x:q.x+dx,y:q.y+dy},k=key(n);
    // An unexplored floor tile (not drawn as a wall) may be the goal itself, never a tile to route through.
    const unknown=unknownGoal&&!view.known(n.x,n.y)&&g.grid[n.y]?.[n.x]===1;
    if(unknown){if(!crossable(view,q,n)||!goal(n))continue;}
    else if(!walkable(view,n.x,n.y)||!crossable(view,q,n))continue;
    if(enemyAt.has(k)&&!(allowEnemyGoal&&goal(n)))continue;
    let step=1+edgeCost(g,q,n);
    // An ally we cannot swap with is a wall for the first step (the rules refuse the move, and the bot retried it every
    // decision, boxed in by its drones: engineer, rebel, seed 108); further on it may have moved by then.
    // A druid's beast keeps its cost even on walks: swapped behind us it is not in front when the fight starts.
    const ally=allyAt.get(k);if(ally){const no=swapFrom(g,q,ally);if(no&&c===0)continue;step+=no?50:ally.kind==='pet'?Math.max(2,allyCost):allyCost;}
    if(!ignoreUnits&&civAt.has(k))step+=civilianCost;
    const extra=cost?cost(n):0;if(!Number.isFinite(extra))continue;
    const nc=c+step+Math.max(0,Math.round(extra));
    if(best.has(k)&&best.get(k)<=nc)continue;
    best.set(k,nc);prev.set(k,q);(buckets[nc]||=[]).push(n);
   }
  }
 }
 return null;
}
// Standard walking cost: hazards and telegraphed tiles are avoided while there is another way.
export function safeCost(view,{hazard=8,danger=30}={}){
 return q=>{
  let c=0;const h=hazardAt(view.g,q.x,q.y);if(h)c+=hazard+h;
  const d=view.danger.get(key(q));if(d)c+=d.t<=1?danger:danger/3;
  return c;
 };
}
// Frontier: a walkable seen tile with an unseen floor neighbour. The map draws every wall and pit that borders an
// explored floor tile (tools/text-play.mjs `shown`, the renderer likewise), so an unseen neighbour that is not drawn as a
// wall is unexplored floor: reading `grid` for a tile bordering explored floor is reading the drawn map.
export function isFrontier(view,q){
 const g=view.g;
 for(const [dx,dy] of DIRS){const x=q.x+dx,y=q.y+dy;if(x<0||y<0||x>=SIZE||y>=SIZE)continue;if(!g.seen[y][x]&&g.grid[y]?.[x]===1)return true;}
 return false;
}
// The nearest unexplored floor tile, stepping into it as the last step (a closed door on the way is opened by walking into
// it). `skip` holds tiles given up on.
export function exploreRoute(view,{cost=null,maxCost=200,skip=null,...more}={}){
 const g=view.g;
 return route(view,q=>!g.seen[q.y]?.[q.x]&&g.grid[q.y]?.[q.x]===1&&!skip?.has(key(q)),{cost,maxCost,unknownGoal:true,...more});
}
export const adjacentTo=(target,{cross=null}={})=>q=>dist(q,target)===1&&(!cross||cross(q,target));
