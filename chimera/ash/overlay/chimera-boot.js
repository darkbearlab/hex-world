// 奇美拉：把 ASH 載進奇美拉自己的頁面（不用 iframe）。build.mjs 產生 public/ash/chimera-boot.js（__REV__ 換成 ASH 的版本號）。
// bootAsh()：放進 #ash-root（平常藏著）與只作用在它裡面的樣式，載入 ASH，回傳 globalThis.ASH_EMBED（見 src/chimera-entry.js）。
// REV：ASH 的版本號（只算 ASH 的 src/）；CREV：再加上奇美拉自己的樣式、畫面元素、機器人。奇美拉的檔案用 CREV，改了才會換網址
const REV='__REV__',base=new URL('./',import.meta.url);
let booting=null;
export function bootAsh(){
 if(booting)return booting;
 booting=(async()=>{
  // ASH 的 service worker（帶版本號的檔案優先讀快取）預設只管 /ash/；奇美拉的主頁在 /，所以另外註冊一份管整個網站
  // （public/_headers 給 sw.js 加上 Service-Worker-Allowed: /）。第一次載入照常下載，之後開頁面就快了。
  try{navigator.serviceWorker?.register(new URL('sw.js',base),{scope:new URL('../',base).pathname}).catch(()=>{});}catch{}
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL(`chimera.css?v=${CREV}`,base).href;document.head.appendChild(link);
  const root=document.createElement('div');root.id='ash-root';root.hidden=true;
  root.innerHTML=await (await fetch(new URL(`battle-dom.html?v=${CREV}`,base))).text();
  document.body.appendChild(root);
  globalThis.ASH_EMBED={active:false};
  // ASH 會改分頁標題、在 body 底下直接加幾個元素（結尾的遮罩、回放控制）：標題改回來，元素收進 #ash-root
  const title=document.title,before=new Set(document.body.children);
  await import(new URL(`src/chimera-entry.js?v=${CREV}`,base).href);
  const E=await globalThis.ASH_EMBED.loaded;
  for(const el of [...document.body.children])if(!before.has(el)&&el!==root&&el.tagName!=='SCRIPT')root.appendChild(el);
  document.title=title;
  return E;
 })();
 return booting;
}
