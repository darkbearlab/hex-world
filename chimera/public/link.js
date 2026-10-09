// 連伺服器（伺服器化 S1）：對畫面來說和背景的 worker 一樣（postMessage 送指令、onmessage 收畫面資料），
// 其實是跟 /api/* 的共用星球（server/worker.js）講話。網址加 ?local 才用單人測試模式的 worker.js。
// 身分：用 Google 登入的話，伺服器發一組工作階段代碼（換裝置登入同一個帳號就是同一家公司）；
// 不登入就是訪客：第一次開頁面時產生一組代碼，存在這個瀏覽器（換瀏覽器就是另一個人）。
const KEY = 'chimera-token', SESS = 'chimera-session', ACCT = 'chimera-acct';
const ls = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
export const account = () => ls(SESS) ? (ls(ACCT) || 'Google 帳號') : '';
export function signOut() { try { localStorage.removeItem(SESS); localStorage.removeItem(ACCT); } catch {} }
export function signedIn(session, email) { try { localStorage.setItem(SESS, session); localStorage.setItem(ACCT, email || ''); } catch {} }
export const authHeaders = () => ls(SESS) ? {'x-chimera-session': ls(SESS)} : {'x-chimera-token': token()};
window.chimeraAuth = authHeaders;   // 戰鬥（chimera-entry.js）也用同一個身分
export { token };
function token() {
  let t = null; try { t = localStorage.getItem(KEY); } catch {}
  if (!t || t.length < 16) { t = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join(''); try { localStorage.setItem(KEY, t); } catch {} }
  return t;
}
export class ServerLink {
  constructor() { this.onmessage = null; this.onerror = null; this.token = token(); this.year = -1; this.company = null; this.timer = null; this.busy = false; }
  emit(m) { this.onmessage?.({data: m}); }
  terminate() { clearInterval(this.timer); clearTimeout(this.tick); this.timer = null; }
  async api(path, body) {
    const r = await fetch('/api/' + path, {method: body ? 'POST' : 'GET', headers: {...authHeaders(), ...(body ? {'content-type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    let d = null; try { d = await r.json(); } catch {}
    if (r.status === 401 && ls(SESS)) { signOut(); this.terminate(); this.emit({type: 'relogin', text: d?.error || '登入已失效，請重新登入'}); throw new Error(d?.error || '登入已失效'); }
    if (!r.ok) throw new Error(d?.error || `伺服器回應 ${r.status}`);
    return d;
  }
  // 本機時鐘（只用來顯示倒數；什麼時候生效以伺服器為準）：開服時間、一小時幾毫秒、和伺服器的時間差
  setClock(h) { const t1 = Date.now(); this.clock = {startedAt: h.startedAt, hourMs: h.hourMs, skew: h.now - t1, paused: !!h.paused}; }
  // 現在是第幾個遊戲小時（帶小數）
  hourNow() { const c = this.clock; return c && !c.paused ? (Date.now() + c.skew - c.startedAt) / c.hourMs : null; }
  // 每跨過一個遊戲小時，伺服器的鬧鐘結算完就馬上拉一次，不用等 15 秒的定時
  armTick() { clearTimeout(this.tick); const x = this.hourNow(); if (x == null) return; this.tick = setTimeout(() => { this.poll(); this.armTick(); }, (Math.floor(x) + 1 - x) * this.clock.hourMs + 1500); }
  async pullYear() { const d = await this.api('year?y=' + this.year); if (!d.same) { this.year = d.data.y; this.emit(d); } }
  async pullView() { const d = await this.api('view'); if (d.view) this.emit(d.view); }
  // 定時拉一次：沙盒換年、公司的畫面（伺服器的時鐘一小時走一格，不必拉太勤）
  async poll() { if (this.busy) return; this.busy = true; try { await this.pullYear(); if (this.company) await this.pullView(); } catch {} finally { this.busy = false; } }
  async postMessage(m) {
    try {
      if (m.type === 'start') {
        const hello = await this.api('hello'); this.hello = hello; this.company = hello.company || null; this.setClock(hello); this.armTick();
        this.emit(await this.api('static')); await this.pullYear();
        try { const ch = await this.api('chronicle'); this.emit({type: 'chronicle', events: ch.events}); } catch {}
        this.emit({type: 'idle', year: this.year});
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
