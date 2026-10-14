# 武器特效／音效試聽台（Alan 2026-10-14）：不同武器配不同的槍口火光、擊中特效、槍聲，播放比較，選好的存在 picks.json。
# 素材從 D:\_遊戲素材 複製到 assets/（不進 git：槍聲是 Sonniss 授權，不能原樣散布，所以這一頁只在本機開，不放上網）。
# python chimera/tools/fx-lab/serve.py  → http://localhost:8790
import json, os, re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, 'assets'); PICKS = os.path.join(here, 'picks.json')
def assets():
    sfx = {}
    for cat in sorted(os.listdir(os.path.join(A, 'sfx'))):
        for f in sorted(os.listdir(os.path.join(A, 'sfx', cat))):
            if not f.endswith('.mp3'): continue
            g = re.sub(r'_\d+$', '', f[:-4]); sfx.setdefault(f'{cat}/{g}', []).append(f'assets/sfx/{cat}/{f}')   # 同一把槍的不同發
    sheets = []   # 序列圖：檔名後綴是 欄x列
    for d in ('brackeys', 'unity'):
        for f in sorted(os.listdir(os.path.join(A, d))):
            m = re.search(r'_(\d+)x(\d+)?\.png$', f)
            if m: sheets.append({'id': f'{d}/{f[:-4]}', 'src': f'assets/{d}/{f}', 'cols': int(m.group(1)), 'rows': int(m.group(2) or 1), 'pack': d})
    sprites = [{'id': f'kenney/{f[:-4]}', 'src': f'assets/kenney/{f}'} for f in sorted(os.listdir(os.path.join(A, 'kenney'))) if f.endswith('.png')]
    return {'sfx': sfx, 'sheets': sheets, 'sprites': sprites}
class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=here, **k)
    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8'); self.send_response(code); self.send_header('content-type', 'application/json; charset=utf-8'); self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith('/api/assets'): return self._json(assets())
        if self.path.startswith('/api/picks'): return self._json(json.load(open(PICKS, encoding='utf-8')) if os.path.exists(PICKS) else {})
        return super().do_GET()
    def do_POST(self):
        if self.path.startswith('/api/snap'):   # 測試用：頁面把拼好的截圖傳上來存成 snap.png（不進 git）
            import base64; n = int(self.headers.get('content-length') or 0); d = self.rfile.read(n).decode(); open(os.path.join(here, 'snap' + (re.sub(r'[^a-z0-9]', '', self.path.split('n=')[-1]) if 'n=' in self.path else '') + '.png'), 'wb').write(base64.b64decode(d.split(',', 1)[1])); return self._json({'ok': True})
        if not self.path.startswith('/api/picks'): return self._json({'error': 'no'}, 404)
        n = int(self.headers.get('content-length') or 0); data = json.loads(self.rfile.read(n) or b'{}')
        json.dump(data, open(PICKS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2); return self._json({'ok': True})
    def end_headers(self): self.send_header('cache-control', 'no-store'); super().end_headers()
if __name__ == '__main__':
    print('http://localhost:8790'); ThreadingHTTPServer(('127.0.0.1', 8790), H).serve_forever()
