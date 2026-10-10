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
import {enemyRoster, ASH_FACTION, LEGACY_KINDS, LEGACY_BOSS} from '../cases.js';

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
  // 沙盒結算（每季）時核心發出的資料留一份（ysnap），大家拿同一份：snapshot() 只附「上次之後的新事件」，不能每個請求各算一次
  constructor(ctx, env) { super(ctx, env); this.ready = null; this.out = []; this.ysnap = null; this.core = new Core(m => { if (m.type === 'year') this.ysnap = m.data; this.out.push(m); }); }
  hourMs() { return Math.max(1000, +(this.env.HOUR_MS || 3600000)); }
  nowHour() { return Math.floor(this.exact()); }
  // 世界時間對齊現實時間（Alan 2026-10-09）：一比一時，開服時刻定在台灣時間（UTC+8）當天的午夜，
  // 遊戲的「幾點」就是台灣的現實時間，每個遊戲整點也落在現實的整點；建好世界後的第一次補算就推進到現在
  aligned(t) { if (this.hourMs() !== 3600000) return t; const day = 864e5, tz = 8 * 3600e3; return Math.floor((t + tz) / day) * day - tz; }
  exact() { return (Date.now() - this.meta.startedAt) / this.hourMs(); }   // 現在是第幾個遊戲小時（帶小數）

  /* ───── 讀檔、建世界、存檔 ───── */
  async init() {
    if (this.ready) return this.ready;
    return this.ready = (async () => { try {
      const st = this.ctx.storage, meta = await st.get('meta'), version = this.env.WORLD_VERSION || '1';
      if (meta && meta.version === version) {
        const parts = []; for (let i = 0; i < meta.chunks; i++) parts.push(await st.get('save:' + i));
        const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        this.meta = meta; this.core.load(meta.seed, JSON.parse(await gunzip(all)));
        // 舊的星球補對齊：開服時刻往前移到當天的午夜，接下來的補算會把差的小時一次推完
        if (!meta.aligned && this.hourMs() === 3600000) { meta.startedAt = this.aligned(meta.startedAt); meta.aligned = true; }
      } else {
        // 新世界：用 WORLD_SEED 產生星球、推演歷史，開服時間就是現在
        await st.deleteAll();
        const seed = this.env.WORLD_SEED || '奇美拉-1';
        this.core.start(seed); while (this.core.year < YEARS) this.core.sim.stepYear();
        this.core.open();
        this.meta = {version, seed, startedAt: this.aligned(Date.now()), chunks: 0, aligned: true};
        await this.persist();
      }
      this.roster = await st.get('roster') || {};
      this.out = [];
      if (this.env.NPC !== '0') this.core.enableNpcs();   // NPC 傭兵公司（Alan 2026-10-09：讓世界動起來）
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
  // 鬧鐘：下一個整點，或更早完成的培養槽
  async arm() { const ms = this.hourMs(), due = this.core.nextDue(), next = this.meta.startedAt + Math.min(this.nowHour() + 1, due > this.exact() ? due : Infinity) * ms; await this.ctx.storage.setAlarm(Math.ceil(next) + 50); }
  // 補算到現在（每個請求、每次鬧鐘都先做）
  catchUp() {
    if (this.env.PAUSED === '1' || this.meta.paused) return false;
    const before = this.core.hour; this.core.advanceTo(this.nowHour());
    const t = this.exact(); this.core.exactNow = t;
    return this.core.finishDue(t) > 0 || this.core.hour !== before;
  }
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
    if (path === 'hello') return json({pid: !!pid, company: name, seed: this.meta.seed, google: !!pid && pid[0] === 'g', clientId: this.env.GOOGLE_CLIENT_ID || '', hour: this.core.hour, year: this.core.year, startedAt: this.meta.startedAt, hourMs: this.hourMs(), now: Date.now(), colo: await colo(), paused: this.env.PAUSED === '1' || !!this.meta.paused, yearDays: this.core.game.yearDays, companies: Object.keys(this.core.game.cos).length});
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
    if ((path === 'admin/world' || path === 'admin/save') && !pid && this.env.ADMIN_TOKEN_SHA256 && req.headers.get('x-admin-token')) {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(req.headers.get('x-admin-token')))), hex = [...d].map(x => x.toString(16).padStart(2, '0')).join('');
      if (hex !== this.env.ADMIN_TOKEN_SHA256) return bad('沒有權限', 403);
      // 整份存檔（Alan 2026-10-10：拉到測試環境比對改動的影響）；唯讀
      if (path === 'admin/save') return json({seed: this.meta.seed, save: this.core.save()});
      const accounts = {}; for (const [p, n] of Object.entries(this.roster)) accounts[n] = p[0] === 'g' ? 'Google' : '訪客';
      return json({...this.core.adminView(accounts), server: {started: this.meta.startedAt, hourMs: this.hourMs(), world: this.env.WORLD_VERSION || '1', colo: this.colo || ''}});
    }
    if (!pid) return bad('沒有身分代碼', 401);
    if (path === 'view') return name ? json({view: this.core.view(name), hour: this.core.hour}) : json({view: null});
    // 後台（Alan 2026-10-09：上帝視角）：只有管理員的 Google 帳號（ADMIN_EMAILS，預設 darkbearlab@gmail.com）看得到；本機開發（DEV=1）誰都可以
    if (path === 'admin/world') {
      const acct = pid[0] === 'g' ? await this.ctx.storage.get('acct:' + pid) : null, admins = String(this.env.ADMIN_EMAILS || 'darkbearlab@gmail.com').split(',').map(x => x.trim().toLowerCase());
      if (this.env.DEV !== '1' && !(acct && admins.includes(String(acct.email).toLowerCase()))) return bad('沒有權限', 403);
      const accounts = {}; for (const [p, n] of Object.entries(this.roster)) accounts[n] = p[0] === 'g' ? 'Google' : '訪客';
      return json({...this.core.adminView(accounts), server: {started: this.meta.startedAt, hourMs: this.hourMs(), world: this.env.WORLD_VERSION || '1', colo: this.colo || ''}});
    }
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
      if (ALLOWED.includes(body.type) && this.env.PAUSED !== '1') await this.arm();   // 鬧鐘改排到最早要結算的時刻（培養完成、抵達、回到總部）
      return json({view: this.core.view(name, err), msgs});
    }
    return bad('不認得的請求', 404);
  }
}

// 測試場的任務：隨機種子、四名 3 級隊員（學會兵種技能）、一隊混編的敵人；夜間、頭目可選
const ARENA_CLS = ['soldier', 'recon', 'bulwark', 'berserker'], ARENA_FACES = ['ember', 'onyx', 'silver', 'cedar'];
// 戰鬥類型（cases.js 的服務單類型）與生態（sim.js 的 BIOMES）：測試場可以選，戶外地圖照這兩個產生（chimera-outdoor.js）
const ARENA_TYPES = ['ambush', 'native', 'intercept', 'transit', 'assault', 'hold', 'trench', 'sabotage', 'probe', 'clear'];
const ARENA_BIOMES = ['鹼灘', '斷崖', '岩山', '礫丘', '寒漠', '油棘林', '旱原', '沙海', '鹽沼', '總督府'];
// 敵方（Alan 2026-10-09，cases.js 的兵種表）：不選就照類型（原住民襲擊→根者、勢力戰→正規軍、其餘→掠奪者）
const ARENA_SIDES = {raider: {scav: 4, shotgun: 1, thug: 1}, hive: {infected: 2, infected_rifle: 1, hound: 2, larva: 2, spitter: 1}, native: {warrior: 4, hunter: 1, dog: 2},
  army: {trooper: 4, trooper_heavy: 1, shotgunner: 1, leader: 1}, works: {drone: 2, bomb_bot: 2, guard_elite: 1, flamer: 1}, warlord: {elite: 2, scav: 3, enforcer: 1}, free: {merc: 4, merc_shotgun: 1, marksman: 1}};
function arenaMission(b) {
  const r = crypto.getRandomValues(new Uint32Array(3)), n = Math.max(1, Math.min(4, b.size | 0 || 2));
  const type = ARENA_TYPES.includes(b.type) ? b.type : ARENA_TYPES[r[2] % ARENA_TYPES.length], biome = ARENA_BIOMES.includes(b.biome) ? b.biome : ARENA_BIOMES[(r[2] >>> 8) % ARENA_BIOMES.length];
  const side = ARENA_SIDES[b.side] ? b.side : type === 'native' ? 'native' : ['intercept', 'assault', 'hold', 'trench', 'sabotage', 'probe'].includes(type) ? 'army' : 'raider';
  const units = Object.fromEntries(Object.entries(ARENA_SIDES[side]).map(([k, v]) => [k, Math.max(1, Math.round(v * n / 2))]));
  const veh = {}; if (b.veh || n >= 3) { if (['raider', 'warlord'].includes(side)) veh.rush = 1; if (['army', 'free', 'works'].includes(side)) veh.armor = 1; }
  // 頭目：掠奪者、軍閥、根者是拿遺產級的（第幾次被打倒照選的；第三次起有機會戰死），巢匪是巢母，正規軍是標定官
  const kind = LEGACY_KINDS[r[1] % LEGACY_KINDS.length], defeats = Math.max(0, Math.min(4, b.defeats | 0));
  const boss = !(b.boss || type === 'clear') ? null : side === 'hive' ? {ash: 'hive_beast', name: '巢母'} : side === 'army' || side === 'free' ? {ash: 'designator', name: '標定官'} : side === 'works' ? {ash: 'burnline', name: '焚線官'}
    : {weapon: `測試${kind}`, kind, bonus: .2, legacy: -1, chief: '測試頭目', ash: LEGACY_BOSS[kind], defeats, dies: defeats >= 2 && r[0] % 100 < [0, 0, 30, 60, 100][defeats]};
  const night = b.night === true || (b.night == null && ['trench', 'sabotage'].includes(type));
  const enemy = {name: '測試敵人', side, power: 0, units, veh, boss};
  return {id: 'arena-' + Date.now().toString(36) + r[1].toString(36).slice(0, 4), title: '戰鬥測試場', seed: 1 + r[0] % 999999, faction: ASH_FACTION[side] || 'rebel', night, type, biome,
    enemy: {...enemy, roster: enemyRoster(enemy)},
    squad: ARENA_CLS.map((cls, i) => ({id: `T-${1001 + i}`, cls, portrait: ARENA_FACES[i], donor: ARENA_FACES[i], st: {hp: cls === 'berserker' ? 160 : 100}, lv: 3, xp: 0, picks: [], skills: [], prep: null, perkPicks: 0, classPerkMisses: 0, legacyPerkPicks: 0}))};
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
