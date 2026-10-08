// 奇美拉的伺服器（伺服器化 S1，warband/DESIGN.md「伺服器化實作計畫」）：Cloudflare Worker ＋ 一個 Durable Object「Planet」。
//
// - Planet 持有一顆大家共用的星球：遊戲核心（../core.js：沙盒、帳本、所有公司），和單人測試模式是同一份程式。
// - 時間：遊戲小時＝(現在 − 開服時間) ÷ HOUR_MS（預設一小時，現實時間一比一）。每次有請求、每次鬧鐘醒來就補算到現在；
//   鬧鐘每個遊戲小時響一次，沒人在線時間也照走。
// - 存檔：核心的完整存檔（沙盒 exportState＋帳本＋公司），gzip 後分塊存在 Durable Object 的儲存空間；每個指令與每個小時都存。
// - 身分：訪客＝瀏覽器自己產生一組代碼（x-chimera-token），雜湊後就是玩家 ID；Google 登入＝伺服器發工作階段代碼（x-chimera-session），
//   對到 Google 帳號，換裝置也是同一家公司（照 warband）。一個玩家一家公司。
// - 戰鬥（S1 還在瀏覽器裡跑）：fight 回傳任務資料，submit 收戰果。S2 搬到伺服器。
import {DurableObject} from 'cloudflare:workers';
import {Core, COMMANDS, QUERIES, YEARS} from '../core.js';
import {verifyGoogle} from './auth.js';   // 和 warband 同一份
export {Skirmish} from './battle.js';
import {colo} from './battle.js';

const json = (data, status = 200) => new Response(JSON.stringify(data, (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const bad = (msg, status = 400) => json({error: msg}, status);
const CHUNK = 100000;
// 伺服器上玩家能下的指令：加速、改年長度只有單人測試模式有；放棄親自打（abort）在伺服器上不用通知
// 戰果（submit）只能由伺服器上的戰鬥交（S2），瀏覽器不能自己報
const ALLOWED = COMMANDS.filter(c => !['speed', 'yearDays', 'submit', 'abort'].includes(c));
export const battleName = (env, ticket) => `battle-${env.WORLD_VERSION || '1'}-${ticket}`;
// Durable Object 第一次被叫的時候就決定放在哪個機房，之後不會搬。戰鬥每個行動都要往返一次，所以開戰時照玩家所在的洲放
// （不給提示的話會放在叫它的星球旁邊；星球在美國，台灣打一步就要繞半個地球）。入口的 Worker 把玩家的洲寫在 x-continent。
const HINT = {AS: 'apac', OC: 'oc', EU: 'weur', NA: 'enam', SA: 'sam', AF: 'afr'};
const battleStub = (env, ticket, continent) => env.SKIRMISH.get(env.SKIRMISH.idFromName(battleName(env, ticket)), HINT[continent] ? {locationHint: HINT[continent]} : undefined);

async function sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }
async function gzip(str) { return new Uint8Array(await new Response(new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
async function gunzip(u8) { return new TextDecoder().decode(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

export class Planet extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ready = null; this.out = []; this.core = new Core(m => this.out.push(m)); }
  hourMs() { return Math.max(1000, +(this.env.HOUR_MS || 3600000)); }
  nowHour() { return Math.floor((Date.now() - this.meta.startedAt) / this.hourMs()); }

  /* ───── 讀檔、建世界、存檔 ───── */
  async init() {
    if (this.ready) return this.ready;
    return this.ready = (async () => { try {
      const st = this.ctx.storage, meta = await st.get('meta'), version = this.env.WORLD_VERSION || '1';
      if (meta && meta.version === version) {
        const parts = []; for (let i = 0; i < meta.chunks; i++) parts.push(await st.get('save:' + i));
        const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        this.meta = meta; this.core.load(meta.seed, JSON.parse(await gunzip(all)));
      } else {
        // 新世界：用 WORLD_SEED 產生星球、推演歷史，開服時間就是現在
        await st.deleteAll();
        const seed = this.env.WORLD_SEED || '奇美拉-1';
        this.core.start(seed); while (this.core.year < YEARS) this.core.sim.stepYear();
        this.core.open();
        this.meta = {version, seed, startedAt: Date.now(), chunks: 0};
        await this.persist();
      }
      this.roster = await st.get('roster') || {};
      this.out = [];
      if (!(await st.getAlarm()) && this.env.PAUSED !== '1') await this.arm();
    } catch (e) { this.ready = null; throw e; } })();
  }
  async persist() {
    const st = this.ctx.storage, d = this.core.save(); d.log = d.log.slice(-500);
    const z = await gzip(JSON.stringify(d)), n = Math.ceil(z.length / CHUNK);
    for (let i = 0; i < n; i++) await st.put('save:' + i, z.slice(i * CHUNK, (i + 1) * CHUNK));
    for (let i = n; i < (this.meta.chunks || 0); i++) await st.delete('save:' + i);
    this.meta.chunks = n; this.meta.savedAt = Date.now(); this.meta.bytes = z.length; await st.put('meta', this.meta);
  }

  /* ───── 時鐘 ───── */
  async arm() { const ms = this.hourMs(), next = this.meta.startedAt + (this.nowHour() + 1) * ms; await this.ctx.storage.setAlarm(next + 50); }
  // 補算到現在（每個請求、每次鬧鐘都先做）
  catchUp() { if (this.env.PAUSED === '1' || this.meta.paused) return false; const before = this.core.hour; this.core.advanceTo(this.nowHour()); return this.core.hour !== before; }
  async alarm() {
    await this.init();
    if (this.catchUp()) await this.persist();
    this.out = [];
    await this.arm();
  }

  /* ───── 請求 ───── */
  // 玩家 ID：Google 工作階段對到的帳號（找不到就是 false：登入失效，例如世界重開），或訪客代碼的雜湊
  async who(req) {
    const s = req.headers.get('x-chimera-session'); if (s) { const r = await this.ctx.storage.get('sess:' + await sha('sess:' + s)); return r ? r.pid : false; }
    const t = req.headers.get('x-chimera-token') || ''; return t.length >= 16 ? 'v' + await sha('guest:' + t) : null;
  }
  // 用 Google 登入：驗證 Google 發的 ID token，發一組工作階段代碼。第一次登入時，這個瀏覽器原本的訪客公司搬到帳號上
  async googleLogin(req) {
    const cid = this.env.GOOGLE_CLIENT_ID; if (!cid) return bad('伺服器沒有設定 Google 登入');
    let body; try { body = await req.json(); } catch { return bad('請求格式不對'); }
    let g; try { g = this.env.DEV === '1' && body.devSub ? {sub: String(body.devSub), email: 'dev@test', name: 'dev'} : await verifyGoogle(body.credential, cid); } catch (e) { return bad(e.message, 401); }
    const gid = 'g' + await sha('google:' + g.sub), st = this.ctx.storage;
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    await st.put('sess:' + await sha('sess:' + token), {pid: gid, at: Date.now()});
    await st.put('acct:' + gid, {email: g.email, name: g.name, last: Date.now()});
    let moved = null;
    const legacy = String(body.legacy || ''), lid = legacy.length >= 16 ? 'v' + await sha('guest:' + legacy) : null;
    if (!this.roster[gid] && lid && this.roster[lid]) { moved = this.roster[gid] = this.roster[lid]; delete this.roster[lid]; await st.put('roster', this.roster); }
    return json({session: token, email: g.email, company: this.roster[gid] || null, moved});
  }
  async fetch(req) {
    await this.init();
    const url = new URL(req.url), path = url.pathname.slice(5);
    if (path === 'auth/google' && req.method === 'POST') return this.googleLogin(req);
    const pid = await this.who(req);
    if (pid === false) return bad('登入已失效，請重新登入', 401);
    // 伺服器上的戰鬥用：Google 工作階段是誰（只有入口的 Worker 會叫）
    if (path === 'internal/who') return json({pid});
    if (this.catchUp()) await this.persist();
    this.out = [];
    const name = pid ? this.roster[pid] : null;
    if (path === 'hello') return json({pid: !!pid, company: name, google: !!pid && pid[0] === 'g', clientId: this.env.GOOGLE_CLIENT_ID || '', hour: this.core.hour, year: this.core.year, startedAt: this.meta.startedAt, hourMs: this.hourMs(), now: Date.now(), colo: await colo(), paused: this.env.PAUSED === '1' || !!this.meta.paused, yearDays: this.core.game.yearDays, companies: Object.keys(this.core.game.cos).length});
    if (path === 'static') { if (!this.staticMsg) { const c = new Core(m => { if (m.type === 'static') this.staticMsg = m; }); c.w = this.core.w; c.emitStatic(); } return json(this.staticMsg); }
    if (path === 'year') { const y = +url.searchParams.get('y'); return y === this.core.year ? json({same: true, year: y}) : json({type: 'year', data: this.core.snapshot()}); }
    // 伺服器上的戰鬥打完，交戰果（只有 Skirmish 會叫，外面的請求在入口就擋掉了）
    if (path === 'internal/settle') {
      const b = await req.json(), nm = this.roster[b.owner]; if (!nm) return bad('沒有這家公司');
      const err = this.core.command({type: 'submit', ticket: b.ticket, result: b.result}, nm); await this.persist();
      return json({ok: !err, err});
    }
    if (!pid) return bad('沒有身分代碼', 401);
    if (path === 'view') return name ? json({view: this.core.view(name), hour: this.core.hour}) : json({view: null});
    if (req.method !== 'POST') return bad('不認得的請求', 404);
    let body; try { body = await req.json(); } catch { return bad('請求格式不對'); }
    if (path === 'found') {
      if (name) return bad('你已經開過公司了');
      const nm = String(body.name || '').trim().slice(0, 16);
      if (!nm) return bad('公司要有名字');
      const err = this.core.found(+body.base, nm); if (err) return bad(err);
      this.roster[pid] = nm; await this.ctx.storage.put('roster', this.roster); await this.persist();
      return json({view: this.core.view(nm)});
    }
    if (path === 'cmd') {
      if (!name) return bad('還沒開公司');
      if (!ALLOWED.includes(body.type) && !QUERIES.includes(body.type)) return bad('不認得的指令');
      const err = this.core.command(body, name), msgs = this.out.splice(0);
      // 親自打：在伺服器上開（或接回）這場戰鬥；種子留在伺服器，瀏覽器只拿到畫面
      for (const m of msgs) if (m.type === 'mission') {
        const r = await battleStub(this.env, m.data.id, req.headers.get('x-continent')).fetch(new Request('https://battle/start', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mission: m.data, owner: pid, mode: this.env.BATTLE_MODE || 'verify'})}));
        const d = await r.json(); if (!r.ok) return bad(d.error || '開戰失敗', 500);
        m.data = battleTicket(m.data, d);
      }
      if (ALLOWED.includes(body.type)) await this.persist();
      return json({view: this.core.view(name, err), msgs});
    }
    return bad('不認得的請求', 404);
  }
}

// 測試場的任務：隨機種子、四名 3 級隊員（學會兵種技能）、一隊混編的敵人；夜間、頭目可選
const ARENA_CLS = ['soldier', 'recon', 'bulwark', 'berserker'], ARENA_FACES = ['ember', 'onyx', 'silver', 'cedar'];
function arenaMission(b) {
  const r = crypto.getRandomValues(new Uint32Array(2)), n = Math.max(1, Math.min(4, b.size | 0 || 2));
  return {id: 'arena-' + Date.now().toString(36) + r[1].toString(36).slice(0, 4), title: '戰鬥測試場', seed: 1 + r[0] % 999999, faction: r[1] % 2 ? 'rebel' : 'loyalist', night: !!b.night,
    enemy: {name: '測試敵人', side: 'gang', power: 0, units: {raider: 2 * n, raider_heavy: n, trooper: n}, veh: {}, boss: b.boss ? {weapon: '測試'} : null},
    squad: ARENA_CLS.map((cls, i) => ({id: `T-${1001 + i}`, cls, portrait: ARENA_FACES[i], st: {hp: cls === 'berserker' ? 160 : 100}, lv: 3, xp: 0, picks: [], skills: [], prep: null, perkPicks: 0, classPerkMisses: 0, legacyPerkPicks: 0}))};
}
// 給瀏覽器的開戰資料：verify＝任務（含種子）與已收到的輸入，瀏覽器自己跑；authority＝過濾過的畫面
const battleTicket = (mission, d) => d.mode === 'verify' ? {id: mission.id, title: mission.title, remote: true, mode: 'verify', mission: d.mission, log: d.log, resumed: !!d.resumed}
  : {id: mission.id, title: mission.title, remote: true, mode: 'authority', state: d.state, resumed: !!d.resumed};
const planetOf = env => env.PLANET.get(env.PLANET.idFromName('planet-' + (env.WORLD_VERSION || '1')), env.PLANET_HINT ? {locationHint: env.PLANET_HINT} : undefined);
// 這個請求是哪個玩家：訪客直接算；Google 工作階段要問星球（存在星球的儲存空間）
async function ownerOf(req, env) {
  const s = req.headers.get('x-chimera-session');
  if (s) { const r = await planetOf(env).fetch(new Request('https://planet/api/internal/who', {headers: {'x-chimera-session': s}})); return r.ok ? (await r.json()).pid : false; }
  const t = req.headers.get('x-chimera-token') || ''; return t.length >= 16 ? 'v' + await sha('guest:' + t) : null;
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/internal/')) return new Response('not found', {status: 404});
    // 伺服器上的戰鬥：/api/battle/<任務票>/act|state，用身分代碼確認是自己的戰鬥
    const mb = url.pathname.match(env.DEV === '1' ? /^\/api\/battle\/([^/]+)\/(act|state|log|selftest)$/ : /^\/api\/battle\/([^/]+)\/(act|state|log)$/);   // selftest：開發用，機器人打完
    if (mb) {
      const owner = await ownerOf(req, env); if (!owner) return bad(owner === false ? '登入已失效，請重新登入' : '沒有身分代碼', 401);
      return battleStub(env, decodeURIComponent(mb[1]), req.cf?.continent).fetch(new Request('https://battle/' + mb[2], {method: req.method, headers: {'content-type': 'application/json', 'x-owner': owner}, body: req.method === 'POST' ? await req.text() : undefined}));
    }
    // 戰鬥測試場（Alan 2026-10-09：不用等抽到任務票就能測手感）：開一場隨機的伺服器戰鬥，打完不結算、不影響公司。
    // 網址加 ?arena 才在標題畫面顯示入口；每次開新的一場（舊的留在原處，沒人叫就不花錢）
    if (url.pathname === '/api/arena' && req.method === 'POST') {
      const owner = await ownerOf(req, env); if (!owner) return bad(owner === false ? '登入已失效，請重新登入' : '沒有身分代碼', 401);
      let b = {}; try { b = await req.json(); } catch {}
      const mode = b.mode === 'authority' ? 'authority' : 'verify';
      const mission = arenaMission(b), r = await battleStub(env, mission.id, req.cf?.continent).fetch(new Request('https://battle/start', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mission, owner, arena: true, mode})}));
      const d = await r.json(); if (!r.ok) return bad(d.error || '開戰失敗', 500);
      return json(battleTicket(mission, d));
    }
    // 開發用：開一場屬於這個瀏覽器的伺服器戰鬥（不經過任務票），測遠端操作（DEV=1 才開）
    if (env.DEV === '1' && url.pathname === '/api/dev/remote' && req.method === 'POST') {
      const t = req.headers.get('x-chimera-token') || '', owner = 'v' + await sha('guest:' + t), b = await req.json();
      return battleStub(env, b.mission.id, req.cf?.continent).fetch(new Request('https://battle/start', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mission: b.mission, owner})}));
    }
    // 開發用：直接開一場戰鬥、讓機器人打完（DEV=1 才開）
    if (env.DEV === '1' && url.pathname.startsWith('/api/dev/battle/')) { const [, , , , id, op] = url.pathname.split('/'); return env.SKIRMISH.get(env.SKIRMISH.idFromName('dev-' + id)).fetch(new Request('https://battle/' + op, req)); }
    if (url.pathname.startsWith('/api/')) { const r = new Request(req); r.headers.set('x-continent', req.cf?.continent || ''); return planetOf(env).fetch(r); }
    return env.ASSETS.fetch(req);
  },
};
