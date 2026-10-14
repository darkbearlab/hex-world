// 劇情演出（Alan 2026-10-14，參考碧藍幻想）：蓋在整個畫面上的一層。
// 上方左邊是地點（地名＋小字），右上角是選單（自動、快轉、對話紀錄、跳過）；中間左、中、右三個位置放立繪，背景鋪滿；下方是對話框（名字＋台詞）。
// 點畫面、空白鍵、Enter 下一句（字還在打就先打完）；Esc 開選單。純演出：不動遊戲狀態。
// playScene({place, sub, bg, reveal, cast: {key: {name, art, pos: 'l'|'c'|'r'}}, lines: [{who: key|null, text, pos?}]}) → Promise（播完或跳過時 resolve）
// reveal：立繪等那個人第一次開口才出現（劇情裡中途登場的人）
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const CPS = 40, AUTO_MS = 1400;   // 打字速度（字／秒）、自動播放時一句打完後停多久
let live = null;
export function playScene(S) {
  if (live) live.end();
  return new Promise(resolve => {
    const root = document.createElement('div'); root.className = 'chs-story'; root.tabIndex = -1;
    root.innerHTML = `<div class="st-bg"></div><div class="st-stage">${['l', 'c', 'r'].map(p => `<div class="st-slot st-${p}"></div>`).join('')}</div>
      <div class="st-place"><b>${esc(S.place)}</b>${S.sub ? `<span>${esc(S.sub)}</span>` : ''}</div>
      <button class="st-menubtn" type="button" aria-label="選單">☰</button>
      <div class="st-menu" hidden><button data-m="auto" type="button">自動播放</button><button data-m="fast" type="button">快轉</button><button data-m="log" type="button">對話紀錄</button><button data-m="skip" type="button">跳過</button><button data-m="close" type="button">關閉選單</button></div>
      <div class="st-log" hidden><div class="st-loghead"><b>對話紀錄</b><button data-m="logx" type="button">✕</button></div><div class="st-logbody"></div></div>
      <div class="st-box"><div class="st-name"></div><div class="st-text"></div><i class="st-next">▼</i></div>`;
    const bg = root.querySelector('.st-bg'); if (S.bg) bg.style.background = S.bg;
    const $q = s => root.querySelector(s), box = $q('.st-box'), nameEl = $q('.st-name'), textEl = $q('.st-text'), menu = $q('.st-menu'), logEl = $q('.st-log');
    const slots = Object.fromEntries(['l', 'c', 'r'].map(p => [p, $q('.st-' + p)]));
    const cast = S.cast || {}, shown = {};
    for (const [k, c] of Object.entries(cast)) if (c.art && c.pos) { const im = document.createElement('img'); im.src = c.art; im.alt = ''; im.dataset.k = k; if (S.reveal) im.classList.add('later'); slots[c.pos].appendChild(im); shown[k] = im; }
    let i = -1, typing = null, auto = false, fast = false, autoT = null, done = false;
    const history = [];
    const finish = () => { if (done) return; done = true; clearInterval(typing); clearTimeout(autoT); document.removeEventListener('keydown', key, true); root.classList.add('out'); setTimeout(() => root.remove(), 250); live = null; resolve(); };
    const settle = () => { clearInterval(typing); typing = null; textEl.textContent = S.lines[i].text; box.classList.add('ready'); if (auto || fast) autoT = setTimeout(next, fast ? 120 : AUTO_MS); };
    function next() {
      clearTimeout(autoT);
      if (typing) { settle(); return; }
      if (++i >= S.lines.length) { finish(); return; }
      const L = S.lines[i], c = cast[L.who];
      if (c && L.pos && L.pos !== c.pos && shown[L.who]) { slots[L.pos].appendChild(shown[L.who]); c.pos = L.pos; }
      if (shown[L.who]) shown[L.who].classList.remove('later');
      for (const [k, im] of Object.entries(shown)) im.classList.toggle('dim', !!L.who && k !== L.who);   // 說話的人亮、其他人暗；旁白全部亮
      nameEl.textContent = c?.name || ''; nameEl.hidden = !c; box.classList.toggle('narr', !c); box.classList.remove('ready');
      history.push(`${c ? c.name + '：' : ''}${L.text}`);
      if (fast) { textEl.textContent = L.text; settle(); return; }
      let n = 0; textEl.textContent = ''; typing = setInterval(() => { n++; textEl.textContent = L.text.slice(0, n); if (n >= L.text.length) settle(); }, 1000 / CPS);
    }
    const setMode = (a, f) => { auto = a; fast = f; root.classList.toggle('auto', auto); root.classList.toggle('fast', fast); menu.querySelector('[data-m=auto]').classList.toggle('on', auto); menu.querySelector('[data-m=fast]').classList.toggle('on', fast); if ((auto || fast) && !typing) next(); };
    root.addEventListener('click', e => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (e.target.closest('.st-menubtn')) { menu.hidden = !menu.hidden; return; }
      if (m === 'auto') { setMode(!auto, false); menu.hidden = true; return; }
      if (m === 'fast') { setMode(false, !fast); menu.hidden = true; return; }
      if (m === 'log') { menu.hidden = true; $q('.st-logbody').innerHTML = history.map(t => `<p>${esc(t)}</p>`).join(''); logEl.hidden = false; return; }
      if (m === 'logx') { logEl.hidden = true; return; }
      if (m === 'skip') { finish(); return; }
      if (m === 'close') { menu.hidden = true; return; }
      if (!menu.hidden || !logEl.hidden) { menu.hidden = true; logEl.hidden = true; return; }
      if (auto || fast) setMode(false, false);   // 自動、快轉中點一下就停
      next();
    });
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!logEl.hidden) logEl.hidden = true; else menu.hidden = !menu.hidden; return; }
      if ((e.key === ' ' || e.key === 'Enter') && menu.hidden && logEl.hidden) { e.preventDefault(); e.stopPropagation(); next(); }
    }
    document.addEventListener('keydown', key, true);
    document.body.appendChild(root); root.focus();
    live = {end: finish};
    requestAnimationFrame(() => { root.classList.add('in'); next(); });
  });
}
