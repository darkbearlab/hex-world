// PVP 的鏡頭（Alan 2026-10-15）：不再強制以操作中的單位為中心，可以自由拖曳；擊殺鏡頭照 ASH 原本的演出。
// ASH 的繪圖器每一格都重算鏡頭（renderer.updateCamera → camera.js 的 cameraFrame，跟著操作中的人與鎖定的目標）。
// 這裡包一層：平常鏡頭停在玩家拖到的位置；演出中（遠處擊殺的 cameraHold、自己的人倒下的 KIA、首領場景的滑鏡）照原本的拍，演完回到原位。
// 拖曳：在戰場上按住拖動。ASH 原本「滑一下＝走一格」，拖過一點距離就當成拖畫面（攔下這次放開，不讓 ASH 當成滑動）；點一下照舊。
const DRAG_PX = 8;
export function installFreeCamera(renderer, canvas) {
  let free = null, drag = null;
  const orig = renderer.updateCamera.bind(renderer);
  renderer.updateCamera = function (dt) {
    orig(dt);
    const cine = this.kia || (this.sceneFocus && this.sceneFocus.blend > 0) || this.effects.some(e => e.type === 'cameraHold' && this.time - e.time < e.duration);
    if (!free) { free = {...this.camera}; return; }   // 第一次：用 ASH 開場的取景
    if (cine) return;                                  // 演出：照原本的鏡頭
    this.camera = {...free};
  };
  canvas.addEventListener('pointerdown', e => { if (e.button > 0) return; drag = {id: e.pointerId, x: e.clientX, y: e.clientY, cam: free ? {...free} : {...renderer.camera}, moving: false}; });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moving && Math.hypot(dx, dy) < DRAG_PX) return;
    drag.moving = true; const t = renderer.tile || 40;
    free = {x: drag.cam.x - dx / t, y: drag.cam.y - dy / t};
  });
  // 拖過的那次放開不交給 ASH（ASH 會當成「滑一下走一格」）
  canvas.addEventListener('pointerup', e => { const d = drag; drag = null; if (d?.moving) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.style.touchAction = 'none';
  return {
    center(p) { if (p) free = {x: p.x, y: p.y}; },   // 「置中」按鈕：移到操作中的人
    get position() { return free; },
  };
}
