// 奇美拉的伺服器（伺服器化 S1，warband/DESIGN.md「伺服器化實作計畫」）：Cloudflare Worker ＋ 一個 Durable Object「Planet」。
//
// - Planet 持有一顆大家共用的星球：遊戲核心（../core.js：沙盒、帳本、所有公司），和單人測試模式是同一份程式。
// - 時間：遊戲小時＝(現在 − 開服時間) ÷ HOUR_MS（預設一小時，現實時間一比一）。每次有請求、每次鬧鐘醒來就補算到現在；
//   鬧鐘每個遊戲小時響一次，沒人在線時間也照走。
// - 存檔：核心的完整存檔（沙盒 exportState＋帳本＋公司），gzip 後分塊存在 Durable Object 的儲存空間。
//   節流（Alan 2026-10-15，玩家一多每個指令都整包重寫會排隊）：一般指令只標「改過」，SAVE_EVERY 毫秒內最多存一次；
//   整點、戰鬥結算、開公司、後台操作、匯入世界馬上存。伺服器剛好當掉或部署時，最多丟掉最後 SAVE_EVERY 毫秒的一般指令
// - 身分：訪客＝瀏覽器自己產生一組代碼（x-chimera-token），雜湊後就是玩家 ID；Google 登入＝伺服器發工作階段代碼（x-chimera-session），
//   對到 Google 帳號，換裝置也是同一家公司（照 warband）。一個玩家一家公司。
// - 戰鬥（S1 還在瀏覽器裡跑）：fight 回傳任務資料，submit 收戰果。S2 搬到伺服器。
import {DurableObject} from 'cloudflare:workers';
import {Core, COMMANDS, QUERIES, YEARS} from '../core.js';
import {verifyGoogle} from './auth.js';   // 和 warband 同一份
export {Skirmish} from './battle.js';
import {colo} from './battle.js';
import {enemyRoster, ASH_FACTION, LEGACY_KINDS, LEGACY_BOSS} from '../cases.js';
import {parked, RARE} from '../company.js';
import {NEAR} from '../near.js';

const json = (data, status = 200) => new Response(JSON.stringify(data, (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const bad = (msg, status = 400) => json({error: msg}, status);
const CHUNK = 100000;
const SAVE_EVERY = 5000;   // 一般指令的存檔節流（毫秒）
// 伺服器上玩家能下的指令：加速、改年長度只有單人測試模式有；放棄親自打（abort）在伺服器上不用通知
// 戰果（submit）只能由伺服器上的戰鬥交（S2），瀏覽器不能自己報
const ALLOWED = COMMANDS.filter(c => !['speed', 'yearDays', 'submit', 'abort', 'sortie'].includes(c));   // sortie（派遣）只有單機
// 單機（Alan 2026-10-18，DESIGN.md「縮小規模」）：SOLO=1 的伺服器只有一家公司，時間不跟現實走——
// 玩家按播放才走（速度＝每秒幾個遊戲小時，核心的 game.speed），親自打的時候停住（core.pauseOnFight），
// 有服務單要簽收、基地到站、玩家離開頁面太久都會自動暫停。開發階段放在伺服器上，單機版就是開一個本機的這個
const SOLO_ALLOWED = [...ALLOWED, 'speed', 'abort', 'sortie'];
const SOLO_AWAY = 20000;
// 速度（Alan 2026-10-18）：暫停、普通（照現實：一小時一小時）、加速 1（每秒一小時）、加速 2（每秒六小時）
export const SOLO_SPEEDS = [0, 1 / 3600, 1, 6];   // 這麼久沒有請求（頁面關了、睡著了）就停住
export const battleName = (env, ticket, owner) => env.SOLO === '1' && owner ? `battle-${env.WORLD_VERSION || '1'}-${owner}-${ticket}` : `battle-${env.WORLD_VERSION || '1'}-${ticket}`;   // 單機：每個人的世界各自編號，戰鬥名字要帶上是誰的
// Durable Object 第一次被叫的時候就決定放在哪個機房，之後不會搬。戰鬥每個行動都要往返一次，所以開戰時照玩家所在的洲放
// （不給提示的話會放在叫它的星球旁邊；星球在美國，台灣打一步就要繞半個地球）。入口的 Worker 把玩家的洲寫在 x-continent。
const HINT = {AS: 'apac', OC: 'oc', EU: 'weur', NA: 'enam', SA: 'sam', AF: 'afr'};
const battleStub = (env, ticket, continent, owner) => env.SKIRMISH.get(env.SKIRMISH.idFromName(battleName(env, ticket, owner)), HINT[continent] ? {locationHint: HINT[continent]} : undefined);

async function sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }
async function gzip(str) { return new Uint8Array(await new Response(new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
async function gunzip(u8) { return new TextDecoder().decode(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

export class Planet extends DurableObject {
  // 沙盒結算（每季）時核心發出的資料留一份（ysnap），大家拿同一份：snapshot() 只附「上次之後的新事件」，不能每個請求各算一次
  constructor(ctx, env) { super(ctx, env); this.ready = null; this.out = []; this.ysnap = null; this.core = new Core(m => { if (m.type === 'year') this.ysnap = m.data; this.out.push(m); }); }
  hourMs() { return Math.max(1000, +(this.env.HOUR_MS || 3600000)); }
  get solo() { return this.env.SOLO === '1'; }
  nowHour() { return Math.floor(this.exact()); }
  // 世界時間對齊現實時間（Alan 2026-10-09）：一比一時，開服時刻定在台灣時間（UTC+8）當天的午夜，
  // 遊戲的「幾點」就是台灣的現實時間，每個遊戲整點也落在現實的整點；建好世界後的第一次補算就推進到現在
  aligned(t) { if (this.hourMs() !== 3600000) return t; const day = 864e5, tz = 8 * 3600e3; return Math.floor((t + tz) / day) * day - tz; }
  exact() { return this.solo ? this.soloH ?? this.core.hour : (Date.now() - this.meta.startedAt) / this.hourMs(); }   // 現在是第幾個遊戲小時（帶小數；單機＝推到哪裡就是哪裡）

  /* ───── 讀檔、建世界、存檔 ───── */
  async init() {
    if (this.ready) return this.ready;
    return this.ready = (async () => { try {
      const st = this.ctx.storage, meta = await st.get('meta'), version = this.env.WORLD_VERSION || '1';
      // 單機（Alan 2026-10-18：扶正成預設入口）：一個玩家一顆自己的星球（solo-版本-玩家），從 hub 的世界範本複製；
      // hub 存世界範本和 Google 登入；舊的共用星球（planet-版本，沒有 role）封存：不載入、鬧鐘停掉，資料原封不動
      if (this.solo) {
        if (meta && !meta.role) { this.archived = true; this.roster = {}; this.out = []; await st.deleteAlarm(); return; }
        const role = meta?.role || this.roleHint;
        if (role === 'hub') { this.hub = true; this.meta = meta || {role: 'hub', version}; if (!meta) await st.put('meta', this.meta); this.roster = {}; this.out = []; return; }
        if (!meta) {   // 這個玩家第一次來：從範本建自己的星球
          const r = await hubOf(this.env).fetch(new Request('https://hub/api/internal/template', {headers: {'x-role': 'hub'}}));
          if (!r.ok) { this.pending = true; this.meta = {role: 'player', version, pending: true}; this.roster = {}; this.out = []; this.ready = null; return; }
          const t = await r.json(); this.core.load(t.seed, t.save); if (!this.core.game) this.core.open();
          this.meta = {role: 'player', pid: this.pidHint, version, seed: t.seed, template: t.at, startedAt: Date.now(), chunks: 0, aligned: true};
          this.roster = {}; await st.put('roster', this.roster); this.out = [];
          if (this.env.NPC !== '0') this.core.enableNpcs();
          this.pending = false; this.soloInit(); await this.persist(); return;
        }
      }
      if (meta && meta.version === version && meta.pending) { this.meta = meta; this.pending = true; this.roster = {}; this.out = []; return; }
      if (meta && meta.version === version) {
        const parts = []; for (let i = 0; i < meta.chunks; i++) parts.push(await st.get('save:' + i));
        const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        this.meta = meta; this.core.load(meta.seed, JSON.parse(await gunzip(all)));
        // 舊的星球補對齊：開服時刻往前移到當天的午夜，接下來的補算會把差的小時一次推完
        if (!meta.aligned && this.hourMs() === 3600000) { meta.startedAt = this.aligned(meta.startedAt); meta.aligned = true; }
      } else {
        // 新世界：用 WORLD_SEED 產生星球、推演歷史，開服時間就是現在
        await st.deleteAll();
        // WORLD_IMPORT＝1：不在這裡推演，等管理員用 admin/import 把本機推好的世界傳上來（傳上來之前只回「新世界準備中」）
        if (this.env.WORLD_IMPORT === '1') { this.meta = {version, seed: this.env.WORLD_SEED || '奇美拉-1', startedAt: 0, chunks: 0, aligned: true, pending: true}; await st.put('meta', this.meta); this.pending = true; this.roster = {}; this.out = []; return; }
        const seed = this.env.WORLD_SEED || '奇美拉-1';
        this.core.start(seed); while (this.core.year < YEARS) this.core.sim.stepYear();
        this.core.open();
        this.meta = {version, seed, startedAt: this.aligned(Date.now()), chunks: 0, aligned: true};
        await this.persist();
      }
      this.roster = await st.get('roster') || {};
      this.out = [];
      if (this.env.NPC !== '0') this.core.enableNpcs();   // NPC 傭兵公司（Alan 2026-10-09：讓世界動起來）
      if (this.solo) this.soloInit();
      if (!(await st.getAlarm()) && this.env.PAUSED !== '1') await this.arm();
    } catch (e) { this.ready = null; throw e; } })();
  }
  // 一般指令：標「改過」，SAVE_EVERY 之後存一次（中間的指令合併成這一次）
  markDirty() { this.dirty = true; if (!this.saveT) this.saveT = setTimeout(() => { this.saveT = null; if (this.dirty) this.persist().catch(e => { this.dirty = true; console.error('存檔失敗', e); }); }, SAVE_EVERY); }
  async persist() {
    this.dirty = false; if (this.saveT) { clearTimeout(this.saveT); this.saveT = null; }   // 馬上存的時候，排著的那一次就不用了
    const st = this.ctx.storage, d = this.core.save(); d.log = d.log.slice(-500);
    const z = await gzip(JSON.stringify(d)), n = Math.ceil(z.length / CHUNK);
    for (let i = 0; i < n; i++) await st.put('save:' + i, z.slice(i * CHUNK, (i + 1) * CHUNK));
    for (let i = n; i < (this.meta.chunks || 0); i++) await st.delete('save:' + i);
    this.meta.chunks = n; this.meta.savedAt = Date.now(); this.meta.bytes = z.length; await st.put('meta', this.meta);
  }

  /* ───── 時鐘 ───── */
  // 鬧鐘：下一個整點，或更早完成的培養槽
  async arm() { if (this.solo) return this.soloArm(); const ms = this.hourMs(), due = this.core.nextDue(), next = this.meta.startedAt + Math.min(this.nowHour() + 1, due > this.exact() ? due : Infinity) * ms; await this.ctx.storage.setAlarm(Math.ceil(next) + 50); }
  // 補算到現在（每個請求、每次鬧鐘都先做）
  catchUp() {
    if (this.solo) return this.soloCatchUp();
    if (this.env.PAUSED === '1' || this.meta.paused) return false;
    const before = this.core.hour; this.core.advanceTo(this.nowHour());
    const t = this.exact(); this.core.exactNow = t;
    return this.core.finishDue(t) > 0 || this.core.hour !== before;
  }
  async alarm() {
    await this.init();
    if (this.pending || this.archived || this.hub) { if (this.archived || this.hub) await this.ctx.storage.deleteAlarm(); return; }
    if (this.solo) { const was = this.core.game?.speed; if (this.soloCatchUp()) this.markDirty(); this.out = [];
      if (this.dirty && (!this.core.game?.speed && was || Date.now() - (this.meta.savedAt || 0) > 10000)) await this.persist();   // 鬧鐘醒來後物件可能被回收，節流的計時器不一定等得到：至少每 10 秒、自動暫停時馬上存
      return this.soloArm(); }
    if (this.catchUp() || this.dirty) await this.persist();
    this.out = [];
    await this.arm();
  }

  /* ───── 單機的 hub：世界範本、Google 登入 ───── */
  async hubFetch(req, path) {
    const st = this.ctx.storage;
    if (path === 'auth/google' && req.method === 'POST') return this.googleLogin(req);
    if (path === 'internal/who') { const s = req.headers.get('x-chimera-session'); const r = s ? await st.get('sess:' + await sha('sess:' + s)) : null; return json({pid: r ? r.pid : false}); }
    // 世界範本：管理員用 admin/template 傳本機推好的世界（{seed, save}，make-world.mjs 的格式）；新玩家第一次來時複製一份
    if (path === 'internal/template') { const m = await st.get('tpl'); if (!m) return bad('還沒有世界範本', 503); const parts = []; for (let i = 0; i < m.chunks; i++) parts.push(await st.get('tpl:' + i)); const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } return new Response(await gunzip(all), {headers: {'content-type': 'application/json'}}); }
    if (path === 'admin/template' && req.method === 'POST') {
      const tok = req.headers.get('x-admin-token') || '', d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok))), hex = [...d].map(x => x.toString(16).padStart(2, '0')).join('');
      if (!this.env.ADMIN_TOKEN_SHA256 || hex !== this.env.ADMIN_TOKEN_SHA256) return bad('沒有權限', 403);
      const text = await req.text(); let b; try { b = JSON.parse(text); } catch { return bad('請求格式不對'); } if (!b?.save?.sim) return bad('存檔格式不對');
      const at = Date.now(), z = await gzip(JSON.stringify({seed: String(b.seed || '奇美拉-1'), save: b.save, at})), n = Math.ceil(z.length / CHUNK), old = await st.get('tpl');
      for (let i = 0; i < n; i++) await st.put('tpl:' + i, z.slice(i * CHUNK, (i + 1) * CHUNK)); for (let i = n; i < (old?.chunks || 0); i++) await st.delete('tpl:' + i);
      await st.put('tpl', {chunks: n, bytes: z.length, at}); return json({ok: true, bytes: z.length, at});
    }
    // 後台：有哪些 Google 帳號（只有管理員的鑰匙）；拿 pid 去 admin/save?pid= 看那個人的星球
    if (path === 'admin/accounts') {
      const tok = req.headers.get('x-admin-token') || '', d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok))), hex = [...d].map(x => x.toString(16).padStart(2, '0')).join('');
      if (!this.env.ADMIN_TOKEN_SHA256 || hex !== this.env.ADMIN_TOKEN_SHA256) return bad('沒有權限', 403);
      const L = []; for (const [k, v] of await st.list({prefix: 'acct:'})) L.push({pid: k.slice(5), email: v.email, last: v.last}); return json(L);
    }
    return bad('不認得的請求', 404);
  }

  /* ───── 單機的時鐘 ───── */
  // 開機（讀檔或建好世界）一律從暫停開始：伺服器重開後世界不會自己跑掉
  soloInit() { RARE.on = true; NEAR.on = true; this.core.pauseOnFight = true; if (this.core.game && this.core.game.fighting == null) this.core.game.speed = 0; this.soloH = this.core.hour; this.soloAt = Date.now(); this.soloPause = null; }
  // 自動暫停要比對的東西：每家玩家公司的服務單通知數、基地停著沒有
  soloMark() {
    const G = this.core.game; if (!G) return null; const out = {};
    for (const n of Object.values(this.roster || {})) { const co = G.cos[n]; if (!co) continue; out[n] = {tk: G.book.inbox.filter(x => x.player === n && (x.kind === 'ticket' || x.kind === 'refused')).length, parked: parked(co)}; }
    return out;
  }
  soloWhy(a, b) {
    for (const [n, x] of Object.entries(b || {})) { const y = a?.[n]; if (!y) continue; if (x.tk > y.tk) return 'ticket'; if (x.parked && !y.parked) return 'arrive'; }
    return null;
  }
  // 推到現在：上次推到 soloH（帶小數），之後過了多少現實時間 × 速度；離開太久的那段不算，而且停住
  soloCatchUp() {
    const G = this.core.game, now = Date.now(); if (!G || this.pending) { this.soloAt = now; return false; }
    const sp = G.speed || 0, seen = this.seenAt ?? now, until = Math.min(now, seen + SOLO_AWAY);
    let target = (this.soloH ?? this.core.hour) + Math.max(0, until - (this.soloAt ?? now)) / 1000 * sp;
    this.soloAt = now;
    if (sp && until < now) { G.speed = 0; this.soloPause = 'away'; }
    const before = this.core.hour;
    while (this.core.hour < Math.floor(target)) {
      const mark = this.soloMark(); this.core.advanceTo(this.core.hour + 1);
      const why = this.soloWhy(mark, this.soloMark());
      if (why) { G.speed = 0; this.soloPause = why; target = this.core.hour; break; }
      if (Date.now() - now > 3000) { target = this.core.hour; break; }   // 一次最多算 3 秒（速度太快、伺服器跟不上時就慢下來）
    }
    this.soloH = Math.max(this.core.hour, Math.min(target, this.core.hour + .999));
    this.core.exactNow = this.soloH;
    return this.core.finishDue(this.soloH) > 0 || this.core.hour !== before;
  }
  // 走著的時候：下一個整點（或更早完成的培養）叫醒；最快 250 毫秒一次（一次推好幾個小時）。暫停就不排
  async soloArm() {
    const G = this.core.game, sp = G?.speed || 0, st = this.ctx.storage;
    if (!sp || this.pending) { await st.deleteAlarm(); return; }
    const h = this.soloH ?? this.core.hour, due = this.core.nextDue(), next = Math.min(Math.floor(h) + 1, due > h ? due : Infinity);
    await st.setAlarm(Date.now() + Math.max(250, Math.ceil((next - h) / sp * 1000) + 20));
  }
  soloInfo() { return {speed: this.core.game?.speed || 0, h: this.soloH ?? this.core.hour, pause: this.soloPause || null, fighting: this.core.game?.fighting != null}; }

  /* ───── 請求 ───── */
  // 玩家 ID：Google 工作階段對到的帳號（找不到就是 false：登入失效，例如世界重開），或訪客代碼的雜湊
  async who(req) {
    if (this.solo && !this.hub) return req.headers.get('x-pid') || null;   // 單機：入口的 Worker 已經認好人了（外面送來的 x-pid 在入口就被蓋掉）
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
    if (this.solo) {   // 單機：第一次登入時，這個瀏覽器原本的訪客世界搬到帳號上（帳號那邊還沒開公司才搬）
      const acc = soloOf(this.env, gid), mine = await (await acc.fetch(new Request('https://p/api/internal/export', {headers: {'x-role': 'player', 'x-pid': gid}}))).json();
      if (!mine.company && lid) { const old = await (await soloOf(this.env, lid).fetch(new Request('https://p/api/internal/export', {headers: {'x-role': 'player', 'x-pid': lid}}))).json();
        if (old.company) { await acc.fetch(new Request('https://p/api/internal/adopt', {method: 'POST', headers: {'x-role': 'player', 'x-pid': gid, 'content-type': 'application/json'}, body: JSON.stringify(old)})); moved = old.company; } }
      return json({session: token, email: g.email, company: moved || mine.company || null, moved});
    }
    if (!this.roster[gid] && lid && this.roster[lid]) { moved = this.roster[gid] = this.roster[lid]; delete this.roster[lid]; await st.put('roster', this.roster); }
    return json({session: token, email: g.email, company: this.roster[gid] || null, moved});
  }
  // 管理員把本機推好的新世界傳上來：{seed, save}（core.save() 的格式，已經 open() 過、還沒有公司）。只在新世界還沒建好時開
  async importWorld(req, path) {
    if (path !== 'admin/import' || req.method !== 'POST') return bad('新世界準備中，請稍後再來', 503);
    const tok = req.headers.get('x-admin-token') || '', d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok))), hex = [...d].map(x => x.toString(16).padStart(2, '0')).join('');
    if (!this.env.ADMIN_TOKEN_SHA256 || hex !== this.env.ADMIN_TOKEN_SHA256) return bad('沒有權限', 403);
    let body; try { body = await req.json(); } catch { return bad('請求格式不對'); }
    if (!body?.save?.sim) return bad('存檔格式不對');
    const seed = String(body.seed || this.meta.seed);
    this.core.load(seed, body.save); if (!this.core.game) this.core.open();
    this.meta = {version: this.env.WORLD_VERSION || '1', seed, startedAt: this.aligned(Date.now()), chunks: 0, aligned: true};
    this.roster = {}; await this.ctx.storage.put('roster', this.roster); this.out = [];
    if (this.env.NPC !== '0') this.core.enableNpcs();
    if (this.solo) this.soloInit();
    await this.persist(); this.pending = false;
    if (this.env.PAUSED !== '1') await this.arm();
    return json({ok: true, year: this.core.year, companies: Object.keys(this.core.game.cos).length});
  }
  // 快轉（Alan 2026-10-11：測試用）：把開服時刻往前挪 hours 小時，世界照常一小時一小時推過去（NPC、案件、每日結算都照算）。
  // 一次最多 168 小時；這個請求最多算 20 秒，沒推完的由下一個請求補完
  async forward(hours) {
    const h = Math.max(1, Math.min(168, Math.floor(+hours || 0)));
    if (this.solo) { const end = this.core.hour + h, t0 = Date.now(); while (this.core.hour < end && Date.now() - t0 < 20000) this.core.advanceTo(this.core.hour + 1); this.soloH = this.core.hour; this.core.exactNow = this.soloH; this.core.finishDue(this.soloH); await this.persist(); this.out = []; return {ok: true, hours: h, hour: this.core.hour, year: this.core.year}; }   // 單機：直接往前推
    this.meta.startedAt -= h * this.hourMs(); this.meta.forwarded = (this.meta.forwarded || 0) + h;
    const target = this.nowHour(), t0 = Date.now();
    while (this.core.hour < target && Date.now() - t0 < 20000) this.core.advanceTo(this.core.hour + 1);
    const t = this.exact(); this.core.exactNow = t; this.core.finishDue(t);
    await this.persist(); this.out = []; await this.arm();
    return {ok: true, hours: h, hour: this.core.hour, target, behind: target - this.core.hour, forwarded: this.meta.forwarded, year: this.core.year};
  }
  async fetch(req) {
    if (this.solo && !this.roleHint) { this.roleHint = req.headers.get('x-role'); this.pidHint = req.headers.get('x-pid'); }
    await this.init();
    const url = new URL(req.url), path = url.pathname.slice(5);
    if (this.archived) return bad('這是封存的舊世界', 410);
    if (this.hub) return this.hubFetch(req, path);
    if (this.solo && this.pending) return bad('新世界準備中，請稍後再來', 503);
    // 單機：Google 登入搬家用（只有 hub 會叫；外面的 /api/internal/ 在入口就擋掉了）
    if (this.solo && path === 'internal/export') { const name = Object.values(this.roster)[0] || null; return json(name ? {company: name, seed: this.meta.seed, save: this.core.save()} : {company: null}); }
    if (this.solo && path === 'internal/adopt' && req.method === 'POST') { const b = await req.json(); this.core.load(b.seed, b.save); this.roster = {[this.meta.pid || req.headers.get('x-pid')]: b.company}; await this.ctx.storage.put('roster', this.roster); this.soloInit(); await this.persist(); return json({ok: true}); }
    if (this.pending) return this.importWorld(req, path);
    if (path === 'auth/google' && req.method === 'POST') return this.googleLogin(req);
    const pid = await this.who(req);
    if (pid === false) return bad('登入已失效，請重新登入', 401);
    // 伺服器上的戰鬥用：Google 工作階段是誰（只有入口的 Worker 會叫）
    if (path === 'internal/who') return json({pid});
    if (this.solo && pid) { if (this.seenAt && Date.now() - this.seenAt > SOLO_AWAY) this.soloCatchUp(); this.seenAt = Date.now(); }   // 單機：玩家回來了（離開的那段先結算成暫停）
    if (this.catchUp()) this.markDirty();
    this.out = [];
    const name = pid ? this.roster[pid] : null;
    if (path === 'hello') return json({pid: !!pid, company: name, seed: this.meta.seed, google: !!pid && pid[0] === 'g', clientId: this.env.GOOGLE_CLIENT_ID || '', hour: this.core.hour, year: this.core.year, startedAt: this.meta.startedAt, hourMs: this.hourMs(), now: Date.now(), colo: await colo(), paused: this.env.PAUSED === '1' || !!this.meta.paused, yearDays: this.core.game.yearDays, companies: Object.keys(this.core.game.cos).length, solo: this.solo ? this.soloInfo() : null});
    if (path === 'static') { if (!this.staticMsg) { const c = new Core(m => { if (m.type === 'static') this.staticMsg = m; }); c.w = this.core.w; c.emitStatic(); } return json(this.staticMsg); }
    // 每季結算一次：照 stamp（年×4＋季）判斷有沒有新的地圖
    if (path === 'year') { const y = +url.searchParams.get('y'); if (y === this.core.stamp) return json({same: true, year: this.core.year}); if (this.ysnap?.stamp !== this.core.stamp) this.ysnap = this.core.snapshot(); return json({type: 'year', data: this.ysnap}); }
    // 編年史：開服前的歷史加上開服後的事（Alan 2026-10-09：看不到開局前的事）
    if (path === 'chronicle') { const E = this.core.w.events; if (this.chron?.n !== E.length) this.chron = {n: E.length, body: JSON.stringify({events: E.map(e => ({y: e.y, type: e.type, text: e.text, tile: e.tile}))})}; return new Response(this.chron.body, {headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}}); }
    // 伺服器上的戰鬥打完，交戰果（只有 Skirmish 會叫，外面的請求在入口就擋掉了）
    if (path === 'internal/settle') {
      const b = await req.json(), nm = this.roster[b.owner]; if (!nm) return bad('沒有這家公司');
      const err = this.core.command({type: 'submit', ticket: b.ticket, result: b.result}, nm); await this.persist();
      return json({ok: !err, err});
    }
    // 後台的唯讀鑰匙（Alan 2026-10-10：讓 Claude 也能看後台查問題）：x-admin-token 的 SHA-256 等於 ADMIN_TOKEN_SHA256 才放行；只開 admin/world，不能下指令
    if ((path === 'admin/world' || path === 'admin/save' || path === 'admin/forward' || path === 'admin/fix') && (!pid || this.solo) && this.env.ADMIN_TOKEN_SHA256 && req.headers.get('x-admin-token')) {   // 單機：入口照 ?pid= 轉進來的，帶著 x-pid
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(req.headers.get('x-admin-token')))), hex = [...d].map(x => x.toString(16).padStart(2, '0')).join('');
      if (hex !== this.env.ADMIN_TOKEN_SHA256) return bad('沒有權限', 403);
      // 整份存檔（Alan 2026-10-10：拉到測試環境比對改動的影響）；唯讀
      if (path === 'admin/save') return json({seed: this.meta.seed, save: this.core.save()});
      if (path === 'admin/fix' && req.method === 'POST') { let b = {}; try { b = await req.json(); } catch {} const err = this.core.adminFix(b); if (!err) await this.persist(); return json({ok: !err, err}); }   // 後台修復（Alan 2026-10-11）
      if (path === 'admin/forward' && req.method === 'POST') { let b = {}; try { b = await req.json(); } catch {} return json(await this.forward(b.hours)); }
      const accounts = {}; for (const [p, n] of Object.entries(this.roster)) accounts[n] = p[0] === 'g' ? 'Google' : '訪客';
      return json({...this.core.adminView(accounts), clientErrors: (await this.ctx.storage.get('clientErrors')) || [], server: {started: this.meta.startedAt, hourMs: this.hourMs(), world: this.env.WORLD_VERSION || '1', colo: this.colo || ''}});
    }
    if (!pid) return bad('沒有身分代碼', 401);
    // 瀏覽器回報的錯誤（Alan 2026-10-10）：留最近 50 筆，後台（admin/world 的 clientErrors）看得到
    if (path === 'clientlog' && req.method === 'POST') {
      let b = {}; try { b = await req.json(); } catch {}
      const L = (await this.ctx.storage.get('clientErrors')) || []; L.push({t: Date.now(), who: name || (pid ? String(pid).slice(0, 6) : '?'), where: String(b.where || '').slice(0, 40), msg: String(b.msg || '').slice(0, 300), stack: String(b.stack || '').slice(0, 1500), ua: String(b.ua || '').slice(0, 200)});
      await this.ctx.storage.put('clientErrors', L.slice(-50)); return json({ok: true});
    }
    if (path === 'view') return name ? json({view: this.core.view(name), hour: this.core.hour, solo: this.solo ? this.soloInfo() : null}) : json({view: null});
    // 後台（Alan 2026-10-09：上帝視角）：只有管理員的 Google 帳號（ADMIN_EMAILS，預設 darkbearlab@gmail.com）看得到；本機開發（DEV=1）誰都可以
    if (path === 'admin/world') {
      const acct = pid[0] === 'g' ? await this.ctx.storage.get('acct:' + pid) : null, admins = String(this.env.ADMIN_EMAILS || 'darkbearlab@gmail.com').split(',').map(x => x.trim().toLowerCase());
      if (this.env.DEV !== '1' && !(acct && admins.includes(String(acct.email).toLowerCase()))) return bad('沒有權限', 403);
      if (req.method === 'POST' && url.searchParams.get('forward')) return json(await this.forward(+url.searchParams.get('forward')));
      const accounts = {}; for (const [p, n] of Object.entries(this.roster)) accounts[n] = p[0] === 'g' ? 'Google' : '訪客';
      return json({...this.core.adminView(accounts), server: {started: this.meta.startedAt, hourMs: this.hourMs(), world: this.env.WORLD_VERSION || '1', colo: this.colo || ''}});
    }
    if (req.method !== 'POST') return bad('不認得的請求', 404);
    let body; try { body = await req.json(); } catch { return bad('請求格式不對'); }
    // 本機開發（DEV=1）才有：讀一份存檔進來，並把這個瀏覽器的身分接到指定的公司（拿線上存檔重現問題用；線上不會有這條）
    if (this.env.DEV === '1' && path === 'dev/import' && req.method === 'POST') {
      this.core.load(body.seed || this.meta.seed, body.save);
      this.meta.startedAt = Date.now() - this.core.hour * this.hourMs(); this.staticMsg = null; this.ysnap = null; if (this.solo) this.soloInit();   // 地形（含後來冒出的河）重新送   // 時鐘對齊存檔的時間（不然會以為落後了很多小時，一次補算好幾分鐘）
      if (body.as) { this.roster[pid] = body.as; await this.ctx.storage.put('roster', this.roster); }
      await this.persist(); return json({ok: true, hour: this.core.hour});
    }
    if (path === 'found') {
      if (name) return bad('你已經開過公司了');
      if (this.solo && Object.keys(this.roster).length) return bad('單機模式只有一家公司');
      const nm = String(body.name || '').trim().slice(0, 16);
      if (!nm) return bad('公司要有名字');
      const err = this.core.found(+body.base, nm); if (err) return bad(err);
      this.roster[pid] = nm; await this.ctx.storage.put('roster', this.roster); await this.persist();
      return json({view: this.core.view(nm)});
    }
    if (path === 'cmd') {
      if (!name) return bad('還沒開公司');
      const allowed = this.solo ? SOLO_ALLOWED : ALLOWED;
      if (!allowed.includes(body.type) && !QUERIES.includes(body.type)) return bad('不認得的指令');
      if (this.solo && body.type === 'speed') body.v = SOLO_SPEEDS.find(v => Math.abs(v - +body.v) < 1e-9) ?? 0;
      if ((body.type === 'note' || body.type === 'say') && pid[0] !== 'g' && this.env.DEV !== '1') return bad('訪客不能留言，用 Google 帳號登入才行');   // 同一格的留言、對話（照 warband）
      const err = this.core.command(body, name), msgs = this.out.splice(0);
      // 親自打：在伺服器上開（或接回）這場戰鬥；種子留在伺服器，瀏覽器只拿到畫面
      for (const m of msgs) if (m.type === 'mission') {
        const r = await battleStub(this.env, m.data.id, req.headers.get('x-continent'), pid).fetch(new Request('https://battle/start', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({mission: m.data, owner: pid, mode: this.env.BATTLE_MODE || 'verify'})}));
        const d = await r.json(); if (!r.ok) return bad(d.error || '開戰失敗', 500);
        m.data = battleTicket(m.data, d);
      }
      if (this.solo && body.type === 'speed' && body.v) this.soloPause = null;
      if (this.solo && (body.type === 'speed' || body.type === 'abort')) await this.persist();   // 單機：按暫停／換速度時馬上存（推到哪裡就存到哪裡）
      if (allowed.includes(body.type)) this.markDirty();   // 節流：SAVE_EVERY 內的指令合併成一次存檔
      if (allowed.includes(body.type) && this.env.PAUSED !== '1') await this.arm();   // 鬧鐘改排到最早要結算的時刻（培養完成、抵達、回到總部）
      return json({view: this.core.view(name, err), msgs, solo: this.solo ? this.soloInfo() : null});
    }
    return bad('不認得的請求', 404);
  }
}

// 測試場的任務：隨機種子、四名 3 級隊員（學會兵種技能）、一隊混編的敵人；夜間、頭目可選
const ARENA_CLS = ['soldier', 'recon', 'bulwark', 'berserker'], ARENA_FACES = ['ember', 'onyx', 'silver', 'cedar'];
// 戰鬥類型（cases.js 的服務單類型）與生態（sim.js 的 BIOMES）：測試場可以選，戶外地圖照這兩個產生（chimera-outdoor.js）
const ARENA_TYPES = ['ambush', 'native', 'intercept', 'transit', 'assault', 'hold', 'trench', 'sabotage', 'probe', 'clear', 'barricade', 'ied', 'breakdown', 'patrol', 'checkpoint', 'pursuit', 'cordon', 'demo'];
const ARENA_BIOMES = ['鹼灘', '斷崖', '岩山', '礫丘', '寒漠', '油棘林', '旱原', '沙海', '鹽沼', '總督府'];
// 敵方（Alan 2026-10-09，cases.js 的兵種表）：不選就照類型（原住民襲擊→根者、勢力戰→正規軍、其餘→掠奪者）
const ARENA_SIDES = {raider: {scav: 4, shotgun: 1, thug: 1}, hive: {infected: 2, infected_rifle: 1, hound: 2, larva: 2, spitter: 1}, native: {warrior: 4, hunter: 1, dog: 2},
  army: {trooper: 4, trooper_heavy: 1, shotgunner: 1, leader: 1}, works: {drone: 2, bomb_bot: 2, guard_elite: 1, flamer: 1}, warlord: {elite: 2, scav: 3, enforcer: 1}, free: {merc: 4, merc_shotgun: 1, marksman: 1}};
function arenaMission(b) {
  const r = crypto.getRandomValues(new Uint32Array(3)), n = Math.max(1, Math.min(4, b.size | 0 || 2));
  const type = ARENA_TYPES.includes(b.type) ? b.type : ARENA_TYPES[r[2] % ARENA_TYPES.length], biome = ARENA_BIOMES.includes(b.biome) ? b.biome : ARENA_BIOMES[(r[2] >>> 8) % ARENA_BIOMES.length];
  const side = ARENA_SIDES[b.side] ? b.side : type === 'native' ? 'native' : ['intercept', 'assault', 'hold', 'trench', 'sabotage', 'probe'].includes(type) ? 'army' : 'raider';
  // 戰場大小（Alan 2026-10-11：先做 50×50 的測試場）：地圖大了，敵人照面積加（同樣的「敵人」選項密度一樣）
  const map = b.map === 50 ? 50 : 27, dens = (map / 27) ** 2;
  const units = Object.fromEntries(Object.entries(ARENA_SIDES[side]).map(([k, v]) => [k, Math.max(1, Math.round(v * n / 2 * dens))]));
  const veh = {}; if (b.veh || n >= 3) { if (['raider', 'warlord'].includes(side)) veh.rush = 1; if (['army', 'free', 'works'].includes(side)) veh.armor = 1; }
  // 頭目：掠奪者、軍閥、根者是拿遺產級的（第幾次被打倒照選的；第三次起有機會戰死），巢匪是巢母，正規軍是標定官
  const kind = LEGACY_KINDS[r[1] % LEGACY_KINDS.length], defeats = Math.max(0, Math.min(4, b.defeats | 0));
  const boss = !(b.boss || type === 'clear') ? null : side === 'hive' ? {ash: 'hive_beast', name: '巢母'} : side === 'army' || side === 'free' ? {ash: 'designator', name: '標定官'} : side === 'works' ? {ash: 'burnline', name: '焚線官'}
    : {weapon: `測試${kind}`, kind, bonus: .2, legacy: -1, chief: '測試頭目', ash: LEGACY_BOSS[kind], defeats, dies: defeats >= 2 && r[0] % 100 < [0, 0, 30, 60, 100][defeats]};
  const night = b.night === true || (b.night == null && ['trench', 'sabotage'].includes(type));
  const enemy = {name: '測試敵人', side, power: 0, units, veh, boss};
  return {id: 'arena-' + Date.now().toString(36) + r[1].toString(36).slice(0, 4), title: map === 27 ? '戰鬥測試場' : `戰鬥測試場（${map}×${map}）`, size: map, seed: 1 + r[0] % 999999, faction: ASH_FACTION[side] || 'rebel', night, type, biome,
    enemy: {...enemy, roster: enemyRoster(enemy)},
    squad: ARENA_CLS.map((cls, i) => ({id: `T-${1001 + i}`, cls, portrait: ARENA_FACES[i], donor: ARENA_FACES[i], st: {hp: cls === 'berserker' ? 160 : 100}, lv: 3, xp: 0, picks: [], skills: [], prep: null, perkPicks: 0, classPerkMisses: 0, legacyPerkPicks: 0}))};
}
// 給瀏覽器的開戰資料：verify＝任務（含種子）與已收到的輸入，瀏覽器自己跑；authority＝過濾過的畫面
const battleTicket = (mission, d) => d.mode === 'verify' ? {id: mission.id, title: mission.title, remote: true, mode: 'verify', mission: d.mission, log: d.log, resumed: !!d.resumed}
  : {id: mission.id, title: mission.title, remote: true, mode: 'authority', state: d.state, resumed: !!d.resumed};
const planetOf = env => env.PLANET.get(env.PLANET.idFromName('planet-' + (env.WORLD_VERSION || '1')), env.PLANET_HINT ? {locationHint: env.PLANET_HINT} : undefined);
// 單機（SOLO=1）：hub（世界範本、Google 登入）和每個玩家自己的星球
export const hubOf = env => env.PLANET.get(env.PLANET.idFromName('hub-' + (env.WORLD_VERSION || '1')), env.PLANET_HINT ? {locationHint: env.PLANET_HINT} : undefined);
export const soloOf = (env, pid) => env.PLANET.get(env.PLANET.idFromName('solo-' + (env.WORLD_VERSION || '1') + '-' + pid), env.PLANET_HINT ? {locationHint: env.PLANET_HINT} : undefined);
const asHub = req => { const r = new Request(req); r.headers.set('x-role', 'hub'); r.headers.delete('x-pid'); return r; };
const asPlayer = (req, pid, continent) => { const r = new Request(req); r.headers.set('x-role', 'player'); r.headers.set('x-pid', pid); r.headers.set('x-continent', continent || ''); return r; };
// 這個請求是哪個玩家：訪客直接算；Google 工作階段要問星球（存在星球的儲存空間）
async function ownerOf(req, env) {
  const s = req.headers.get('x-chimera-session');
  if (s) { const r = await (env.SOLO === '1' ? hubOf(env) : planetOf(env)).fetch(new Request('https://planet/api/internal/who', {headers: {'x-chimera-session': s, 'x-role': 'hub'}})); return r.ok ? (await r.json()).pid : false; }
  const t = req.headers.get('x-chimera-token') || ''; return t.length >= 16 ? 'v' + await sha('guest:' + t) : null;
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/internal/')) return new Response('not found', {status: 404});
    // 伺服器上的戰鬥：/api/battle/<任務票>/act|state，用身分代碼確認是自己的戰鬥
    const mb = url.pathname.match(env.DEV === '1' ? /^\/api\/battle\/([^/]+)\/(act|state|log|ping|selftest)$/ : /^\/api\/battle\/([^/]+)\/(act|state|log|ping)$/);   // ping：打的時候讓戰鬥留在記憶體（2026-10-14）   // selftest：開發用，機器人打完
    if (mb) {
      const owner = await ownerOf(req, env); if (!owner) return bad(owner === false ? '登入已失效，請重新登入' : '沒有身分代碼', 401);
      return battleStub(env, decodeURIComponent(mb[1]), req.cf?.continent, owner).fetch(new Request('https://battle/' + mb[2], {method: req.method, headers: {'content-type': 'application/json', 'x-owner': owner}, body: req.method === 'POST' ? await req.text() : undefined}));
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
    if (env.SOLO === '1' && url.pathname.startsWith('/api/')) {
      const p = url.pathname.slice(5);
      if (p === 'auth/google' || p === 'admin/template' || p === 'admin/accounts') return hubOf(env).fetch(asHub(req));
      // 管理員的唯讀鑰匙：?pid= 指定看哪一個玩家的星球
      if (p.startsWith('admin/') && req.headers.get('x-admin-token') && url.searchParams.get('pid')) return soloOf(env, url.searchParams.get('pid')).fetch(asPlayer(req, url.searchParams.get('pid'), req.cf?.continent));
      const owner = await ownerOf(req, env);
      if (owner === false) return bad('登入已失效，請重新登入', 401);
      if (!owner) return bad('沒有身分代碼', 401);
      return soloOf(env, owner).fetch(asPlayer(req, owner, req.cf?.continent));
    }
    if (url.pathname.startsWith('/api/')) { const r = new Request(req); r.headers.set('x-continent', req.cf?.continent || ''); return planetOf(env).fetch(r); }
    return env.ASSETS.fetch(req);
  },
};
