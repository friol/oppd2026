'use strict';
// Boot, input, DOM menus and the main loop.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');

// ---------- stage scaling (960x540 logical) ----------
let stageScale = 1;
function fit() {
  stageScale = Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H);
  stage.style.transform = `translate(-50%, -50%) scale(${stageScale})`;
}
addEventListener('resize', fit);
fit();

// ---------- input ----------
const IN = { keys: {}, pressed: {}, mouse: { sx: 480, sy: 270, btn: [false, false, false], clicked: [false, false, false] } };
const JUMP_KEYS = ['Space', 'KeyZ', 'ArrowUp', 'KeyW'];

addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // M: music on / off
    const on = MUSIC.toggle();
    if (GAME.state === 'play') GAME.flash('MUSIC ' + (on ? 'ON' : 'OFF'), '', '#fff', 1);
    if (UI.current === 'menu') UI.render();
    return;
  }
  if (!IN.keys[e.code]) IN.pressed[e.code] = true;
  IN.keys[e.code] = true;
  EDITOR.keys[e.code] = true;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
  if (GAME.state === 'play' && (e.code === 'Escape' || e.code === 'KeyP')) {
    if (GAME.test && e.code === 'Escape') EDITOR.open(GAME.levelIndex, true); else UI.pause();
    return;
  }
  if (UI.current === 'victory') { if (['Enter', 'Space', 'Escape'].indexOf(e.code) >= 0) { e.preventDefault(); UI.victoryNext(); } return; }
  if (UI.current === 'menu') UI.key(e);
  else if (GAME.state === 'editor' && e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); EDITOR.playHere(); }
});
addEventListener('keyup', e => { IN.keys[e.code] = false; EDITOR.keys[e.code] = false; });
addEventListener('blur', () => { IN.keys = {}; EDITOR.keys = {}; IN.mouse.btn = [false, false, false]; if (GAME.state === 'play') UI.pause(); });

function stagePos(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) / stageScale, (e.clientY - r.top) / stageScale];
}
canvas.addEventListener('mousedown', e => {
  const [x, y] = stagePos(e);
  IN.mouse.sx = x; IN.mouse.sy = y;
  IN.mouse.btn[e.button] = true; IN.mouse.clicked[e.button] = true;
  if (GAME.state === 'editor') EDITOR.mouseDown(x, y, e.button);
  e.preventDefault();
});
addEventListener('mousemove', e => {
  const [x, y] = stagePos(e);
  IN.mouse.sx = x; IN.mouse.sy = y;
  if (GAME.state === 'editor') EDITOR.mouseMove(x, y);
});
addEventListener('mouseup', e => { IN.mouse.btn[e.button] = false; if (GAME.state === 'editor') EDITOR.mouseUp(); });
canvas.addEventListener('wheel', e => { if (GAME.state === 'editor') { EDITOR.wheel(e.deltaX, e.deltaY, e.shiftKey); e.preventDefault(); } }, { passive: false });
stage.addEventListener('contextmenu', e => e.preventDefault());

function gameInput() {
  const k = IN.keys, m = IN.mouse;
  const inp = {
    left: k.ArrowLeft || k.KeyA, right: k.ArrowRight || k.KeyD,
    jump: JUMP_KEYS.some(c => k[c]), jumpPressed: JUMP_KEYS.some(c => IN.pressed[c]),
    fire0: m.clicked[0] || (m.btn[0] && !m.clicked[2]), fire1: m.clicked[2] || m.btn[2],
    fire2: m.clicked[1] || m.btn[1] || k.ShiftLeft || k.ShiftRight,
    sx: m.sx, sy: m.sy, mx: m.sx + GAME.cam.x, my: m.sy + GAME.cam.y
  };
  if (inp.fire0 && inp.fire1) inp.fire1 = false;
  if (IN.pressed.KeyR && GAME.world) GAME.world.clearPortals();
  return inp;
}

$('victory').addEventListener('click', () => UI.victoryNext());
// editor toolbar
document.querySelectorAll('#edbar [data-lvl]').forEach(b => b.onclick = () => EDITOR.selectLevel(+b.dataset.lvl));
$('edPlay').onclick = () => EDITOR.play();
$('edPlayHere').onclick = () => EDITOR.playHere();
$('edSave').onclick = () => EDITOR.save();
$('edRevert').onclick = () => EDITOR.revert();
$('edRegen').onclick = () => EDITOR.regenerate();
$('edRandom').onclick = () => EDITOR.randomSeed();
$('edWider').onclick = () => EDITOR.resize(10);
$('edNarrower').onclick = () => EDITOR.resize(-10);
$('edExport').onclick = () => EDITOR.exportJSON();
$('edImport').onclick = () => $('edFile').click();
$('edFile').onchange = e => { if (e.target.files[0]) EDITOR.importJSON(e.target.files[0]); e.target.value = ''; };
$('edClose').onclick = () => EDITOR.close();
// keep keyboard focus off the buttons so Space/Enter do not re-click them
document.querySelectorAll('button').forEach(b => b.addEventListener('mouseup', () => b.blur()));

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  MUSIC.update(dt);
  if (GAME.state === 'play') GAME.update(dt, gameInput());
  else if (GAME.state === 'title') GAME.update(dt);
  else if (GAME.state === 'editor') EDITOR.update(dt);
  IN.pressed = {};
  IN.mouse.clicked = [false, false, false];
  ctx.imageSmoothingEnabled = false;
  GAME.draw(ctx);
  // title screen: animated logo vortex and the tension drone
  const onTitle = GAME.state === 'title' && UI.current === 'menu';
  if (onTitle && MENU.mode === 'main') UI.drawVortex(now / 1000);
  if (onTitle) SFX.droneOn(); else SFX.droneOff();
  stage.style.cursor = GAME.state === 'play' ? 'crosshair' : '';
  requestAnimationFrame(frame);
}

SPR.load(() => {
  // the level files (levels/*.json) are optional: without them (or from file://) the levels are generated
  GAME.loadFiles().then(() => {
    $('loading').classList.add('hidden');
    UI.title();
    requestAnimationFrame(frame);
  });
}, f => { $('loadbar').style.width = (f * 100) + '%'; });
