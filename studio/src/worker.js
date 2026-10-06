// 像素工作室：Worker 入口與作品倉庫（Durable Object + SQLite）
import {DurableObject} from 'cloudflare:workers';

const MAX_BODY = 1_800_000;        // 單一作品存檔上限（SQLite 單列 2MB）
const KEEP_VERSIONS = 50;          // 每件作品保留的歷史版本數
const SNAP_EVERY = 2 * 60_000;     // 自動存檔時，至少隔這麼久才記一個歷史版本
const SESSION_DAYS = 30;
const enc = new TextEncoder();

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers}});
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode('studio-session:' + secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
// 長度無關的比較，避免用回應時間猜密語
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  const p = new Uint8Array(x), q = new Uint8Array(y); let d = 0;
  for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i];
  return d === 0;
}
const cookieOf = (req, name) => (req.headers.get('cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1];
const newId = () => b64url(crypto.getRandomValues(new Uint8Array(9)));

export class Studio extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS docs(id TEXT PRIMARY KEY, name TEXT, w INT, h INT, version INT, data TEXT, thumb TEXT, created INT, updated INT, deleted INT DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, version INT, data TEXT, thumb TEXT, saved INT, note TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS versions_doc ON versions(doc_id, saved)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS fails(ip TEXT, at INT)`);
  }

  async authed(req) {
    const key = this.env.STUDIO_KEY; if (!key) return false;
    const c = cookieOf(req, 'sid'); if (!c) return false;
    const [exp, sig] = c.split('.'); if (!exp || !sig || +exp < Date.now()) return false;
    return same(sig, await hmac(key, exp));
  }

  async login(req) {
    const key = this.env.STUDIO_KEY;
    if (!key) return json({error: '伺服器還沒設定密語（STUDIO_KEY），目前一律拒絕登入'}, 503);
    const ip = req.headers.get('cf-connecting-ip') || 'local', now = Date.now();
    this.sql.exec('DELETE FROM fails WHERE at < ?', now - 15 * 60_000);
    const n = this.sql.exec('SELECT COUNT(*) AS n FROM fails WHERE ip = ?', ip).one().n;
    if (n >= 8) return json({error: '嘗試太多次，請 15 分鐘後再試'}, 429);
    let body = {}; try { body = await req.json(); } catch {}
    if (!(await same(body.key || '', key))) {
      this.sql.exec('INSERT INTO fails VALUES (?, ?)', ip, now);
      return json({error: '密語不對'}, 401);
    }
    const exp = String(now + SESSION_DAYS * 864e5);
    const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
    return json({ok: true}, 200, {'set-cookie': `sid=${exp}.${await hmac(key, exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`});
  }

  snapshot(id, note, force) {
    const d = this.sql.exec('SELECT version, data, thumb FROM docs WHERE id = ?', id).toArray()[0]; if (!d) return;
    const last = this.sql.exec('SELECT saved, version FROM versions WHERE doc_id = ? ORDER BY id DESC LIMIT 1', id).toArray()[0];
    if (last && last.version === d.version) return;
    if (!force && last && Date.now() - last.saved < SNAP_EVERY) return;
    this.sql.exec('INSERT INTO versions(doc_id, version, data, thumb, saved, note) VALUES (?, ?, ?, ?, ?, ?)', id, d.version, d.data, d.thumb, Date.now(), note || '');
    this.sql.exec(`DELETE FROM versions WHERE doc_id = ? AND id NOT IN (SELECT id FROM versions WHERE doc_id = ? ORDER BY id DESC LIMIT ${KEEP_VERSIONS})`, id, id);
  }

  async fetch(req) {
    const url = new URL(req.url), p = url.pathname, m = req.method;
    if (m !== 'GET' && req.headers.get('x-studio') !== '1') return json({error: '缺少 X-Studio 標頭'}, 400);
    if (p === '/api/login' && m === 'POST') return this.login(req);
    if (p === '/api/logout' && m === 'POST') return json({ok: true}, 200, {'set-cookie': 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
    if (!(await this.authed(req))) return json({error: '請先登入'}, 401);
    if (p === '/api/me') return json({ok: true});

    let body = null;
    if (m === 'POST' || m === 'PUT') {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({error: '作品太大（超過 1.8MB），請縮小畫布或減少圖層'}, 413);
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json({error: '格式錯誤'}, 400); }
    }
    const now = Date.now();
    const meta = r => ({id: r.id, name: r.name, w: r.w, h: r.h, version: r.version, thumb: r.thumb, updated: r.updated, deleted: r.deleted});

    if (p === '/api/docs' && m === 'GET') {
      const trash = url.searchParams.get('trash') === '1';
      return json(this.sql.exec(`SELECT id, name, w, h, version, thumb, updated, deleted FROM docs WHERE ${trash ? 'deleted > 0' : 'deleted = 0'} ORDER BY updated DESC`).toArray().map(meta));
    }
    if (p === '/api/docs' && m === 'POST') {
      const id = /^[\w-]{6,40}$/.test(body.id || '') ? body.id : newId();
      if (this.sql.exec('SELECT 1 FROM docs WHERE id = ?', id).toArray().length) return json({error: '這個 id 已存在'}, 409);
      this.sql.exec('INSERT INTO docs VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 0)', id, String(body.name || '未命名').slice(0, 80), body.w | 0, body.h | 0, body.data || '', body.thumb || '', now, now);
      this.snapshot(id, '建立', true);
      return json({id, version: 1, updated: now});
    }
    if (p === '/api/export' && m === 'GET') {
      return json({exported: now, docs: this.sql.exec('SELECT * FROM docs WHERE deleted = 0').toArray()}, 200, {'content-disposition': `attachment; filename="studio-backup-${new Date(now).toISOString().slice(0, 10)}.json"`});
    }

    let r;
    if ((r = p.match(/^\/api\/docs\/([\w-]+)$/))) {
      const id = r[1], cur = this.sql.exec('SELECT * FROM docs WHERE id = ?', id).toArray()[0];
      if (!cur) return json({error: '找不到作品'}, 404);
      if (m === 'GET') return json(cur);
      if (m === 'PUT') {
        if (body.baseVersion !== cur.version) return json({error: '伺服器上有更新的版本', version: cur.version, updated: cur.updated}, 409);
        const v = cur.version + 1;
        this.sql.exec('UPDATE docs SET name = ?, w = ?, h = ?, data = ?, thumb = ?, version = ?, updated = ? WHERE id = ?',
          String(body.name ?? cur.name).slice(0, 80), body.w ?? cur.w, body.h ?? cur.h, body.data ?? cur.data, body.thumb ?? cur.thumb, v, now, id);
        this.snapshot(id, body.note, !!body.snapshot);
        return json({version: v, updated: now});
      }
      if (m === 'DELETE') {
        if (url.searchParams.get('purge') === '1' && cur.deleted) {
          this.sql.exec('DELETE FROM versions WHERE doc_id = ?', id); this.sql.exec('DELETE FROM docs WHERE id = ?', id);
          return json({ok: true, purged: true});
        }
        this.snapshot(id, '移到垃圾桶前', true);
        this.sql.exec('UPDATE docs SET deleted = ? WHERE id = ?', now, id); return json({ok: true});
      }
    }
    if ((r = p.match(/^\/api\/docs\/([\w-]+)\/restore$/)) && m === 'POST') {
      this.sql.exec('UPDATE docs SET deleted = 0, updated = ? WHERE id = ?', now, r[1]); return json({ok: true});
    }
    if ((r = p.match(/^\/api\/docs\/([\w-]+)\/versions$/)) && m === 'GET') {
      return json(this.sql.exec('SELECT id, version, thumb, saved, note FROM versions WHERE doc_id = ? ORDER BY id DESC', r[1]).toArray());
    }
    if ((r = p.match(/^\/api\/versions\/(\d+)$/)) && m === 'GET') {
      const v = this.sql.exec('SELECT * FROM versions WHERE id = ?', +r[1]).toArray()[0];
      return v ? json(v) : json({error: '找不到版本'}, 404);
    }
    return json({error: '找不到這個 API'}, 404);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return env.STUDIO.get(env.STUDIO.idFromName('main')).fetch(req);
    return env.ASSETS.fetch(req);
  }
};
