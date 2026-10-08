// 「用 Google 帳號登入」：瀏覽器拿到 Google 簽發的 ID token（JWT），這裡驗證簽章與欄位，取出帳號（sub）與信箱。
// 不需要用戶端密鑰：ID token 用 Google 公開的金鑰（JWKS）簽，任何人都能驗。
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISS = new Set(['accounts.google.com', 'https://accounts.google.com']);
let cache = {at: 0, keys: null};

const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const jsonPart = s => JSON.parse(new TextDecoder().decode(b64u(s)));

async function googleKeys(fetchJwks) {
  if (cache.keys && Date.now() - cache.at < 3600e3) return cache.keys;
  const d = fetchJwks ? await fetchJwks() : await (await fetch(JWKS_URL)).json();
  cache = {at: Date.now(), keys: d.keys || []}; return cache.keys;
}

// 驗證成功回傳 {sub, email, name}；失敗丟出錯誤
export async function verifyGoogle(token, clientId, {fetchJwks, now = Date.now()} = {}) {
  const parts = String(token || '').split('.'); if (parts.length !== 3) throw new Error('登入憑證格式不對');
  let head, body; try { head = jsonPart(parts[0]); body = jsonPart(parts[1]); } catch { throw new Error('登入憑證格式不對'); }
  if (head.alg !== 'RS256') throw new Error('登入憑證的簽章方式不對');
  let jwk = (await googleKeys(fetchJwks)).find(k => k.kid === head.kid);
  if (!jwk) { cache.at = 0; jwk = (await googleKeys(fetchJwks)).find(k => k.kid === head.kid); }
  if (!jwk) throw new Error('找不到驗證登入憑證的金鑰');
  const key = await crypto.subtle.importKey('jwk', {kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true}, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('登入憑證的簽章不對');
  if (!ISS.has(body.iss)) throw new Error('登入憑證不是 Google 發的');
  if (body.aud !== clientId) throw new Error('登入憑證不是給這個遊戲的');
  if (!(body.exp * 1000 > now - 60e3)) throw new Error('登入憑證過期了，請再登入一次');
  if (!body.sub) throw new Error('登入憑證缺少帳號');
  return {sub: String(body.sub), email: body.email || '', name: body.name || ''};
}
export const _resetCache = () => { cache = {at: 0, keys: null}; };
