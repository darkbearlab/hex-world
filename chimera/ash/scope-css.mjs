// 把一份樣式表改寫成只作用在某個元素裡（build.mjs 用：ASH 的樣式只作用在奇美拉頁面的 #ash-root）。
// 規則的選擇器前面加上 root；:root 與 body 換成 root 本身；html（含它身上的 class）保留在最前面，後面接 root。
// @media／@supports 往裡面遞迴；@keyframes、@font-face、@import 原樣保留（@import 另外挑出來，放在最前面）。
export function scopeCss(css, root = '#ash-root') {
  const imports = [];
  const body = walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return {imports, css: body};

  function walk(src) {
    let out = '', i = 0;
    while (i < src.length) {
      let j = i, depth = 0, quote = null;
      // 讀到 { 或 ;（略過字串與括號裡的）
      for (; j < src.length; j++) {
        const c = src[j];
        if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '(') depth++; else if (c === ')') depth--;
        else if (depth === 0 && (c === '{' || c === ';')) break;
      }
      const prelude = src.slice(i, j).trim();
      if (j >= src.length) { out += src.slice(i); break; }
      if (src[j] === ';') { if (prelude.startsWith('@import')) imports.push(prelude + ';'); else if (prelude) out += prelude + ';'; i = j + 1; continue; }
      const end = matching(src, j), inner = src.slice(j + 1, end);
      if (/^@(media|supports|layer|container)\b/.test(prelude)) out += `${prelude}{${walk(inner)}}`;
      else if (prelude.startsWith('@')) out += `${prelude}{${inner}}`;
      else out += `${selectors(prelude)}{${inner}}`;
      i = end + 1;
    }
    return out;
  }
  function matching(src, open) {
    let depth = 0, quote = null;
    for (let k = open; k < src.length; k++) {
      const c = src[k];
      if (quote) { if (c === '\\') k++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '{') depth++; else if (c === '}' && --depth === 0) return k;
    }
    return src.length - 1;
  }
  function selectors(list) {
    const parts = [];let depth = 0, start = 0;
    for (let k = 0; k < list.length; k++) { const c = list[k]; if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; else if (c === ',' && depth === 0) { parts.push(list.slice(start, k)); start = k + 1; } }
    parts.push(list.slice(start));
    return parts.map(s => one(s.trim())).join(',');
  }
  function one(s) {
    let m;
    if ((m = s.match(/^:root((?:[.:\[][^\s>+~]*)?)(.*)$/))) return root + m[1] + m[2];
    if ((m = s.match(/^html((?:[.:\[#][^\s>+~]*)?)\s*(.*)$/))) { const b = m[2].match(/^body((?:[.:\[#][^\s>+~]*)?)(.*)$/); return b ? `html${m[1]} ${root}${b[1]}${b[2]}` : `html${m[1]} ${root}${m[2] ? ' ' + m[2] : ''}`; }
    if ((m = s.match(/^body((?:[.:\[#][^\s>+~]*)?)(.*)$/))) return root + m[1] + m[2];
    return `${root} ${s}`;
  }
}
