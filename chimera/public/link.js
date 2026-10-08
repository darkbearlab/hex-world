// 連伺服器（伺服器化 S1）：對畫面來說和背景的 worker 一樣（postMessage 送指令、onmessage 收畫面資料），
// 其實是跟 /api/* 的共用星球（server/worker.js）講話。網址加 ?local 才用單人測試模式的 worker.js。
// 身分先用訪客代碼：第一次開頁面時產生一組，存在這個瀏覽器（換瀏覽器就是另一個人）。
const KEY = 'chimera-token';
function token() {
  let t = null; try { t = localStorage.getItem(KEY); } catch {}
  if (!t || t.length < 16) { t = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join(''); try { localStorage.setItem(KEY, t); } catch {} }
  return t;
}
export class ServerLink {
  constructor() { this.onmessage = null; this.onerror = null; this.token = token(); this.year = -1; this.company = null; this.timer = null; this.busy = false; }
  emit(m) { this.onmessage?.({data: m}); }
  terminate() { clearInterval(this.timer); this.timer = null; }
  async api(path, body) {
    const r = await fetch('/api/' + path, {method: body ? 'POST' : 'GET', headers: {'x-chimera-token': this.token, ...(body ? {'content-type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    let d = null; try { d = await r.json(); } catch {}
    if (!r.ok) throw new Error(d?.error || `伺服器回應 ${r.status}`);
    return d;
  }
  async pullYear() { const d = await this.api('year?y=' + this.year); if (!d.same) { this.year = d.data.y; this.emit(d); } }
  async pullView() { const d = await this.api('view'); if (d.view) this.emit(d.view); }
  // 定時拉一次：沙盒換年、公司的畫面（伺服器的時鐘一小時走一格，不必拉太勤）
  async poll() { if (this.busy) return; this.busy = true; try { await this.pullYear(); if (this.company) await this.pullView(); } catch {} finally { this.busy = false; } }
  async postMessage(m) {
    try {
      if (m.type === 'start') {
        const hello = await this.api('hello'); this.hello = hello;
        this.emit(await this.api('static')); await this.pullYear(); this.emit({type: 'idle', year: this.year});
        if (hello.company) { this.company = hello.company; await this.pullView(); }
        this.timer = setInterval(() => this.poll(), 15000);
        return;
      }
      if (m.type === 'found') {
        const name = (m.name || prompt('公司名稱（最多 16 個字，星球上的其他人看得到）', '') || '').trim();
        if (!name) return;
        const d = await this.api('found', {base: m.base, name}); this.company = name; this.emit(d.view); return;
      }
      if (['more', 'stop', 'speed', 'yearDays'].includes(m.type)) return;
      const d = await this.api('cmd', m);
      for (const x of d.msgs || []) this.emit(x);
      if (d.view) this.emit(d.view);
    } catch (e) { this.emit({type: 'error', text: e.message}); }
  }
}
