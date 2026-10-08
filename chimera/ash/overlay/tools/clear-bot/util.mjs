// Clear bot (docs/CLEAR_BOT.md): small shared helpers. No game state is read here.
export const DIRS=Object.freeze([[0,-1],[1,0],[0,1],[-1,0]]);
export const key=p=>`${p.x},${p.y}`;
export const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export const cheb=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
export const same=(a,b)=>Boolean(a&&b)&&a.x===b.x&&a.y===b.y;
export const neighbours=p=>DIRS.map(([dx,dy])=>({x:p.x+dx,y:p.y+dy,step:[dx,dy]}));
// Deterministic RNG (mulberry32) seeded from the run seed: the bot never reads Math.random or the clock.
export function seededRng(seed){
 let a=(seed>>>0)^0x9e3779b9;
 return ()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export const sum=(list,f=x=>x)=>list.reduce((s,x)=>s+f(x),0);
export const minBy=(list,f)=>{let best=null,score=Infinity;for(const x of list){const s=f(x);if(s<score){score=s;best=x;}}return best;};
export const maxBy=(list,f)=>{let best=null,score=-Infinity;for(const x of list){const s=f(x);if(s>score){score=s;best=x;}}return best;};
