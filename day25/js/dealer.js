'use strict';
// Lucky Lou, the dealer (portrait and speech bubble in the corner of the
// table), plus the table ambience from day24: the brass lamp swinging over the
// felt, its light cone and the dust motes floating in it.

const DEALER = (function () {
  const FACE_SVG =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="31" fill="#3a2416"/>' +
    '<ellipse cx="32" cy="38" rx="15" ry="17" fill="#e2b48c"/>' +
    '<ellipse cx="17" cy="38" rx="3" ry="5" fill="#d6a47c"/>' +
    '<ellipse cx="47" cy="38" rx="3" ry="5" fill="#d6a47c"/>' +
    // Hair under the hat, so he can tip it.
    '<path d="M19 27 C19 21 45 21 45 27 L45 31 C41 26 23 26 19 31 Z" fill="#3b2415"/>' +
    '<g class="hat bowler"><ellipse cx="32" cy="24" rx="22" ry="4.5" fill="#151515"/>' +
    '<path d="M19 24 C19 8 45 8 45 24 Z" fill="#1f1f1f"/>' +
    '<rect x="19" y="19" width="26" height="4" fill="#7a1d22"/></g>' +
    '<path class="brow0" d="M24 33 l6 -1.5 M34 31.5 l6 1.5" stroke="#2b1a12" stroke-width="2" stroke-linecap="round"/>' +
    '<path class="brow1" d="M23 31 L31 34.5 M41 34.5 L49 31" stroke="#2b1a12" stroke-width="2.6" stroke-linecap="round"/>' +
    '<circle class="eye" cx="27" cy="36" r="1.8" fill="#2b1a12"/>' +
    '<circle class="eye" cx="37" cy="36" r="1.8" fill="#2b1a12"/>' +
    '<path d="M32 38 l-2 6 h3" stroke="#b07f5c" stroke-width="1.4" fill="none"/>' +
    '<path d="M21 46 C26 42 30 45 32 45 C34 45 38 42 43 46 C40 47 36 48 32 47 C28 48 24 47 21 46 Z" fill="#2b1a12"/>' +
    '<path class="mouth0" d="M28 50 Q33 53 37 49" stroke="#8a3a2a" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<path class="mouth1" d="M27 52 Q32 48 38 52" stroke="#8a3a2a" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  const LINES = {
    hello: ['Howdy, partner. Got a good memory?', 'Step right up! Every card has a twin.', 'Welcome to the Déjà Vu, friend.'],
    deal: ['Watch closely now…', 'Take a good long look.', 'Every card has a twin. Remember where.', 'Burn them into your brain, partner.'],
    hide: ['And… they\'re gone!', 'Face down. Good luck!', 'Now let\'s see what you remember.', 'Lights out, cards down.'],
    match: ['Lucky guess.', 'Hmph. Not bad.', 'You\'ve seen that one before, eh?', 'Well, I\'ll be.', 'Déjà vu, huh?'],
    streak: ['Now you\'re just showing off!', 'Who taught you that?', 'You\'re cleaning me out!', 'Somebody check those sleeves!'],
    miss: ['Nope!', 'Close, but no cigar.', 'Ha! Wrong twin.', 'Memory getting foggy?', 'Too much whiskey, friend?'],
    last: ['One more slip and you\'re out.', 'Last chance, partner…', 'Careful now. Real careful.'],
    win: ['Well, darn. You cleared the table!', 'A memory like a steel trap!', 'Fine, fine. Drinks are on me.'],
    perfect: ['Not a single mistake? You\'re a ghost!', 'A perfect game! I\'m calling the sheriff.'],
    lose: ['That\'s all, folks!', 'The house always remembers.', 'Better luck next time, partner.', 'Out of chances!'],
    wait: ['Take your time… I\'ve got all night.', 'Tick tock, partner.', 'Forgot already?', 'Any card. Pick one.'],
    quit: ['Walking away? Smart move.', 'Folding already?', 'Fine, pick your poison.', 'Changed your mind, partner?'],
    level: ['A bigger table, eh?', 'Feeling brave tonight?', 'More cards, more trouble.', 'Back to basics?']
  };

  let table, dealerEl, bubble, bubbleText, hideTimer = 0;
  const lastLine = {};

  // A random line of a kind, never the same one twice in a row.
  function pickLine(kind) {
    const list = LINES[kind];
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastLine[kind]) i = (i + 1) % list.length;
    lastLine[kind] = i;
    return list[i];
  }

  // Say a line of `kind` (or a literal text), with an optional probability.
  function say(kind, chance) {
    if (chance !== undefined && Math.random() > chance) return;
    const text = LINES[kind] ? pickLine(kind) : kind;
    bubbleText.textContent = text;
    bubble.hidden = false;
    bubble.classList.remove('pop');
    void bubble.offsetWidth;
    bubble.classList.add('pop');
    SOUND.mumble(text.split(' ').length);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { bubble.hidden = true; }, 1800 + text.length * 45);
  }

  // He tips his hat for a moment.
  function tip() {
    dealerEl.classList.add('tip');
    setTimeout(() => dealerEl.classList.remove('tip'), 1300);
  }

  // ---------- Lamp, light cone and dust ----------

  let lamp, canvas, ctx;
  const motes = [];

  function resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(table.clientWidth * dpr);
    canvas.height = Math.round(table.clientHeight * dpr);
  }

  function makeMote(anywhere) {
    return {
      x: Math.random(),
      y: anywhere ? Math.random() : -0.02,
      vx: (Math.random() - 0.5) * 0.006,
      vy: 0.004 + Math.random() * 0.01,
      r: 0.6 + Math.random() * 1.4,
      ph: Math.random() * 6.28
    };
  }

  let last = 0;
  function loop(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0);
    last = t;

    // The lamp swings slowly on a long cord: a mix of two sines.
    const angle = 2.4 * Math.sin(t * 0.75) + 0.8 * Math.sin(t * 1.83 + 1);
    const W = table.clientWidth, H = table.clientHeight;
    const rad = angle * Math.PI / 180;
    const off = Math.sin(rad) * H * 1.4;          // horizontal offset of the cord in px
    lamp.style.transform = 'translateX(calc(-50% + ' + off.toFixed(1) + 'px)) rotate(' + (-angle).toFixed(2) + 'deg)';
    const BULB = 20;
    const apexX = W / 2 + off + BULB * Math.sin(rad), apexY = BULB * Math.cos(rad);
    const tilt = Math.tan(rad);
    table.style.setProperty('--lx', (apexX + tilt * (H * 0.45 - apexY) - W / 2).toFixed(1) + 'px');
    table.style.setProperty('--shx', (-off * 0.1).toFixed(1) + 'px');

    // Light cone from the bulb down to the felt, and dust that glows inside it.
    const cw = canvas.width, ch = canvas.height, sc = cw / W;
    ctx.clearRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'lighter';
    const lx = apexX * sc, top = apexY * sc;
    const bottomX = (apexX + tilt * (H - apexY)) * sc;
    const grad = ctx.createLinearGradient(0, top, 0, ch);
    grad.addColorStop(0, 'rgba(255,214,150,0.08)');
    grad.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(lx - 12 * sc, top);
    ctx.lineTo(lx + 12 * sc, top);
    ctx.lineTo(bottomX + W * 0.36 * sc, ch);
    ctx.lineTo(bottomX - W * 0.36 * sc, ch);
    ctx.closePath();
    ctx.fill();

    for (const m of motes) {
      m.x += (m.vx + Math.sin(t * 0.7 + m.ph) * 0.002) * dt * 4;
      m.y += m.vy * dt * 4;
      if (m.y > 1.02 || m.x < -0.05 || m.x > 1.05) Object.assign(m, makeMote(false));
      const px = m.x * cw, py = m.y * ch;
      const coneX = lx + (bottomX - lx) * m.y;
      const half = (12 * sc) + (W * 0.36 * sc - 12 * sc) * m.y;
      const inCone = Math.exp(-Math.pow((px - coneX) / half, 2) * 2);
      const a = (0.05 + 0.5 * inCone) * (0.6 + 0.4 * Math.sin(t * 2 + m.ph));
      ctx.fillStyle = 'rgba(255,226,170,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, m.r * sc, 0, 6.283);
      ctx.fill();
    }
    requestAnimationFrame(loop);
  }

  function init(tableEl) {
    table = tableEl;

    lamp = document.createElement('div');
    lamp.className = 'lamp';
    lamp.setAttribute('aria-hidden', 'true');
    lamp.innerHTML = '<i class="cord"></i><i class="shade"></i><i class="bulb"></i>';
    table.appendChild(lamp);

    canvas = document.createElement('canvas');
    canvas.className = 'dust';
    canvas.setAttribute('aria-hidden', 'true');
    table.appendChild(canvas);
    ctx = canvas.getContext('2d');
    for (let i = 0; i < 50; i++) motes.push(makeMote(true));
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    dealerEl = document.createElement('div');
    dealerEl.className = 'dealer';
    dealerEl.innerHTML = '<div class="portrait">' + FACE_SVG + '</div>' +
      '<div class="bubble" hidden><span class="who">Lucky Lou</span><span class="text"></span></div>';
    table.appendChild(dealerEl);
    bubble = dealerEl.querySelector('.bubble');
    bubbleText = dealerEl.querySelector('.text');

    requestAnimationFrame(loop);
  }

  return { init, say, tip, FACE_SVG, resize: resizeCanvas };
})();
