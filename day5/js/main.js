'use strict';

// App: audio graph, transport, equalizer, playlist, mute/solo and the render loop.
(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = 'oppd2026.day5.settings';
  const BUFFER = 2048;
  const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const BAND_LABELS = ['31', '62', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];
  const PRESETS = {
    'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Rock': [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
    'Pop': [-1, 1, 3, 4, 3, 0, -1, -1, -1, -1],
    'Club': [0, 0, 2, 3, 3, 3, 2, 0, 0, 0],
    'Dance': [6, 5, 2, 0, 0, -3, -4, -4, 0, 0],
    'Classical': [0, 0, 0, 0, 0, 0, -4, -4, -4, -6],
    'Bass boost': [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
    'Treble boost': [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
    'Headphones': [3, 6, 3, -2, -1, 1, 3, 6, 8, 9],
    'Amiga 500': [2, 2, 1, 0, 0, -1, -3, -6, -9, -12],
  };

  const settings = Object.assign({
    volume: 0.8, separation: 0.7, eqOn: true, preamp: 0, bands: PRESETS.Flat.slice(), preset: 'Flat', repeat: false, view: 'patterns',
  }, readSettings());

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* storage not available */ }
  }

  // ------------------------------------------------------------ audio graph

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const node = ctx.createScriptProcessor(BUFFER, 0, 2);
  const preamp = ctx.createGain();
  const filters = BANDS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    b.Q.value = 1.3;
    return b;
  });
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.55;
  const volume = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 2;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  node.connect(preamp);
  let last = preamp;
  for (const f of filters) { last.connect(f); last = f; }
  last.connect(analyser);
  analyser.connect(volume);
  volume.connect(limiter);
  limiter.connect(ctx.destination);
  const waveBuf = new Float32Array(analyser.fftSize), freqBuf = new Uint8Array(analyser.frequencyBinCount);

  function resumeAudio() {
    if (ctx.state === 'suspended') ctx.resume();
  }

  // ------------------------------------------------------------ playback state

  let player = null, song = null, item = null;
  let playing = false, finished = false;
  let queue = [], cur = null;
  let rendered = 0, timeBase = 0;
  let mute = new Uint8Array(0), solo = new Uint8Array(0);
  const playlist = [];
  let current = -1, selected = -1;

  node.onaudioprocess = (e) => {
    const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
    if (!player || !playing || finished) { L.fill(0); R.fill(0); return; }
    const sr = ctx.sampleRate, p = player, base = rendered;
    const t0 = e.playbackTime > 0 ? e.playbackTime : ctx.currentTime + L.length / sr;
    p.render(L, R, (off) => {
      const snap = p.snapshot();
      snap.time = t0 + off / sr;
      if (snap.ended) {
        if (!settings.repeat) {
          finished = true;
          queue.push({ time: snap.time, end: true });
          return false;
        }
        timeBase = item.info.orderTimes[snap.order] - (base + off) / sr;
      }
      snap.songTime = timeBase + (base + off) / sr;
      queue.push(snap);
      return true;
    });
    rendered += L.length;
  };

  function idleSnapshot() {
    const s = player.snapshot();
    s.songTime = timeBase;
    s.time = 0;
    return s;
  }

  function play(index) {
    const it = playlist[index];
    if (!it || !it.song) return;
    resumeAudio();
    if (it.gain === undefined) it.gain = Player.measureGain(it.song);
    item = it;
    song = it.song;
    current = selected = index;
    player = new Player.Player(song, ctx.sampleRate);
    player.mixGain *= it.gain;
    player.separation = settings.separation;
    mute = new Uint8Array(song.channels);
    solo = new Uint8Array(song.channels);
    rendered = 0;
    timeBase = 0;
    queue = [];
    finished = false;
    cur = idleSnapshot();
    patternView.setSong(song);
    channelsView.setSong(song);
    samplesView.setSong(song);
    sampleBrowser.setSong(song);
    applyMutes();
    playing = true;
    updateButtons();
    renderPlaylist();
  }

  function togglePlay() {
    resumeAudio();
    if (!player) {
      const i = selected >= 0 ? selected : playlist.findIndex((p) => p.song);
      if (i >= 0) play(i); else $('file').click();
      return;
    }
    if (finished) { stop(); }
    playing = !playing;
    if (!playing) queue = [];
    updateButtons();
  }

  function stop() {
    playing = false;
    finished = false;
    queue = [];
    if (player) {
      player.seek(0);
      rendered = 0;
      timeBase = 0;
      cur = idleSnapshot();
    }
    updateButtons();
  }

  function seekOrder(order) {
    if (!player) return;
    order = Math.max(0, Math.min(song.orders.length - 1, order));
    player.seek(order);
    rendered = 0;
    timeBase = item.info.orderTimes[order];
    queue = [];
    finished = false;
    cur = idleSnapshot();
  }

  function step(dir) {
    if (!player) return;
    const order = cur ? cur.order : 0;
    if (dir > 0 && order >= song.orders.length - 1) { if (current + 1 < playlist.length) next(); return; }
    seekOrder(order + dir);
  }

  function next() {
    for (let i = current + 1; i < playlist.length; i++) if (playlist[i].song) { play(i); return; }
    stop();
  }

  function songEnded() {
    finished = false;
    if (playlist.slice(current + 1).some((p) => p.song)) next();
    else stop();
  }

  function updateButtons() {
    $('btn-play').classList.toggle('playing', playing);
    $('btn-repeat').classList.toggle('on', settings.repeat);
    $('eq-on').classList.toggle('on', settings.eqOn);
  }

  // ------------------------------------------------------------ mute / solo

  function toggleChannel(i, kind) {
    if (!song || i >= song.channels) return;
    if (kind === 'solo') solo[i] ^= 1; else mute[i] ^= 1;
    applyMutes();
  }

  function resetChannels() {
    mute.fill(0);
    solo.fill(0);
    applyMutes();
  }

  function applyMutes() {
    const any = solo.some((v) => v);
    if (player) for (let i = 0; i < mute.length; i++) player.muted[i] = any ? (solo[i] ? 0 : 1) : mute[i];
    patternView.setMutes(mute, solo);
    channelsView.setMutes(mute, solo);
  }

  // ------------------------------------------------------------ controls

  const lcd = new UI.Lcd($('lcd'));
  const patternView = new UI.PatternView($('pat-scroll'), $('pattern'), $('pat-spacer'));
  const channelsView = new UI.ChannelsView($('channels'));
  const samplesView = new UI.SamplesView($('samples'), $('smp-info'));
  const sampleBrowser = new UI.SampleBrowser($('smp-list'), $('smp-wave'), $('smp-canvas'), $('smp-meta'));
  patternView.onHeader = toggleChannel;
  channelsView.onToggle = toggleChannel;
  samplesView.onPick = (i) => { previewSample(i); sampleBrowser.select(i); };
  sampleBrowser.onPlay = previewSample;
  $('smp-play').addEventListener('click', () => previewSample(sampleBrowser.sel));

  // the Patterns window shows either the pattern or the sample browser
  function setView(view) {
    settings.view = view === 'samples' ? 'samples' : 'patterns';
    const smp = settings.view === 'samples';
    $('smp-panel').hidden = !smp;
    $('pat-scroll').hidden = smp;
    $('pat-legend').hidden = smp;
    $('pat-title').textContent = smp ? 'Sample browser' : 'Patterns';
    document.querySelectorAll('.view-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === settings.view));
    patternView.dirty = true;
    saveSettings();
  }
  document.querySelectorAll('.view-tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  setView(settings.view);

  let seekDrag = -1;
  const seek = new UI.Slider($('seek'), {
    min: 0, max: 1, value: 0,
    onInput: (v) => { seekDrag = v; },
    onChange: (v) => {
      seekDrag = -1;
      if (!player) return;
      const target = v * item.info.duration, times = item.info.orderTimes;
      let o = 0;
      for (let i = 0; i < times.length; i++) if (times[i] <= target + 0.01) o = i;
      seekOrder(o);
    },
  });
  seek.el.addEventListener('dblclick', (e) => e.stopImmediatePropagation(), true);

  const volSlider = new UI.Slider($('vol'), {
    min: 0, max: 1, value: settings.volume, def: 0.8,
    onInput: (v) => { settings.volume = v; applyVolume(); },
    onChange: saveSettings,
  });
  const sepSlider = new UI.Slider($('sep'), {
    min: 0, max: 1, step: 0.01, value: settings.separation, def: 0.7,
    onInput: (v) => { settings.separation = v; applySeparation(); },
    onChange: saveSettings,
  });

  function applyVolume() {
    volume.gain.value = settings.volume * settings.volume * 1.25;
    $('vol-val').textContent = Math.round(settings.volume * 100) + '%';
  }
  function applySeparation() {
    if (player) player.separation = settings.separation;
    $('sep-val').textContent = Math.round(settings.separation * 100) + '%';
  }

  // equalizer
  const presetSel = $('eq-preset');
  for (const name of [...Object.keys(PRESETS), 'Custom']) {
    const o = document.createElement('option');
    o.value = o.textContent = name;
    presetSel.appendChild(o);
  }
  const bandSliders = BANDS.map((f, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'band';
    wrap.innerHTML = `<div class="slider v" title="${BAND_LABELS[i]} Hz"></div><span>${BAND_LABELS[i]}</span>`;
    $('eq-sliders').appendChild(wrap);
    return new UI.Slider(wrap.firstChild, {
      min: -12, max: 12, step: 0.5, value: settings.bands[i] || 0, def: 0, center: true,
      onInput: (v) => { settings.bands[i] = v; settings.preset = 'Custom'; presetSel.value = 'Custom'; applyEq(); },
      onChange: saveSettings,
    });
  });
  const preSlider = new UI.Slider($('eq-pre'), {
    min: -12, max: 12, step: 0.5, value: settings.preamp, def: 0, center: true,
    onInput: (v) => { settings.preamp = v; applyEq(); },
    onChange: saveSettings,
  });
  presetSel.value = PRESETS[settings.preset] ? settings.preset : 'Custom';
  presetSel.addEventListener('change', () => {
    const p = PRESETS[presetSel.value];
    if (!p) return;
    settings.preset = presetSel.value;
    settings.bands = p.slice();
    bandSliders.forEach((s, i) => s.set(p[i]));
    applyEq();
    saveSettings();
  });

  function applyEq() {
    filters.forEach((f, i) => { f.gain.value = settings.eqOn ? settings.bands[i] : 0; });
    preamp.gain.value = settings.eqOn ? Math.pow(10, settings.preamp / 20) : 1;
    UI.drawEqCurve($('eq-curve'), filters, settings.eqOn);
  }

  function toggleEq() {
    settings.eqOn = !settings.eqOn;
    applyEq();
    updateButtons();
    saveSettings();
  }

  function toggleRepeat() {
    settings.repeat = !settings.repeat;
    updateButtons();
    saveSettings();
  }

  $('btn-play').addEventListener('click', togglePlay);
  $('btn-stop').addEventListener('click', stop);
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('btn-open').addEventListener('click', () => $('file').click());
  $('btn-repeat').addEventListener('click', toggleRepeat);
  $('eq-on').addEventListener('click', toggleEq);
  $('ch-reset').addEventListener('click', resetChannels);
  $('file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

  // sample preview, played through the equalizer
  let preview = null;
  function previewSample(i) {
    const s = song && song.samples[i];
    if (!s || !s.length) return;
    resumeAudio();
    if (preview) try { preview.stop(); } catch (e) { /* already stopped */ }
    const rate = Math.max(3000, Math.min(384000, Math.round(s.c5)));
    const buf = ctx.createBuffer(1, s.length, rate);
    buf.getChannelData(0).set(s.data);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    if (s.loopType) {
      src.loop = true;
      src.loopStart = s.loopStart / rate;
      src.loopEnd = s.loopEnd / rate;
    }
    const len = s.loopType ? Math.max(1.5, s.loopEnd / rate) : s.length / rate;
    g.gain.value = 0.45 * s.volume / 64;
    g.gain.setTargetAtTime(0, ctx.currentTime + Math.min(len, 4), 0.05);
    src.connect(g);
    g.connect(preamp);
    src.start();
    src.stop(ctx.currentTime + Math.min(len, 4) + 0.3);
    preview = src;
  }

  // ------------------------------------------------------------ playlist

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  async function addFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    resumeAudio();
    const start = playlist.length;
    for (const f of list) {
      const it = { file: f.name, song: null, info: null, error: '' };
      try {
        const buf = await f.arrayBuffer();
        it.song = Tracker.load(buf);
        it.info = Player.scan(it.song);
      } catch (err) {
        it.error = err.message || String(err);
        toast(`${f.name}: ${it.error}`);
      }
      playlist.push(it);
    }
    renderPlaylist();
    if (!playing) {
      const i = playlist.findIndex((p, k) => k >= start && p.song);
      if (i >= 0) play(i);
    }
  }

  function renderPlaylist() {
    const ol = $('playlist');
    ol.innerHTML = '';
    if (!playlist.length) {
      ol.innerHTML = '<li class="empty">Drop .mod .s3m .xm .it files here</li>';
      $('pl-total').textContent = '';
      return;
    }
    let total = 0;
    playlist.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = (i === current ? 'cur ' : '') + (i === selected ? 'sel ' : '') + (it.song ? '' : 'bad');
      const name = it.song ? `${it.song.title || it.file} [${it.song.format}]` : `${it.file} — ${it.error}`;
      li.innerHTML = '<span class="n"></span><span class="t"></span>';
      li.firstChild.textContent = name;
      li.lastChild.textContent = it.info ? UI.fmtTime(it.info.duration) : '';
      li.title = it.file;
      if (it.info) total += it.info.duration;
      li.addEventListener('click', () => { selected = i; renderPlaylist(); });
      li.addEventListener('dblclick', () => play(i));
      ol.appendChild(li);
    });
    $('pl-total').textContent = `${playlist.length} files · ${UI.fmtTime(total)}`;
  }

  $('pl-add').addEventListener('click', () => $('file').click());
  $('pl-rem').addEventListener('click', () => {
    if (selected < 0 || selected >= playlist.length) return;
    playlist.splice(selected, 1);
    if (selected === current) { current = -1; }
    else if (selected < current) current--;
    selected = Math.min(selected, playlist.length - 1);
    renderPlaylist();
  });
  $('pl-clr').addEventListener('click', () => {
    playlist.length = 0;
    current = selected = -1;
    renderPlaylist();
  });

  // drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').classList.add('show'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').classList.remove('show'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('drop').classList.remove('show');
    addFiles(e.dataTransfer.files);
  });

  // ------------------------------------------------------------ keyboard

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'SELECT') return;
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) {
      const n = +digit[1];
      if (n === 0) resetChannels(); else toggleChannel(n - 1, e.shiftKey ? 'solo' : 'mute');
      e.preventDefault();
      return;
    }
    switch (e.key.toLowerCase()) {
      case ' ': case 'x': case 'c': togglePlay(); break;
      case 'v': stop(); break;
      case 'z': case 'arrowleft': step(-1); break;
      case 'b': case 'arrowright': step(1); break;
      case 'l': $('file').click(); break;
      case 'r': toggleRepeat(); break;
      case 'e': toggleEq(); break;
      case 'p': setView(settings.view === 'samples' ? 'patterns' : 'samples'); break;
      case 'arrowup': case 'arrowdown':
        if (settings.view !== 'samples') return;
        sampleBrowser.move(e.key === 'ArrowUp' ? -1 : 1);
        break;
      case 'enter':
        if (settings.view !== 'samples' || e.target.tagName === 'BUTTON') return;
        previewSample(sampleBrowser.sel);
        break;
      default: return;
    }
    e.preventDefault();
  });

  // ------------------------------------------------------------ render loop

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = ctx.currentTime;
    while (queue.length && queue[0].time <= t) {
      const s = queue.shift();
      if (s.end) { songEnded(); break; }
      cur = s;
    }

    let elapsed = cur ? cur.songTime : 0;
    if (cur && playing && cur.time) elapsed += Math.max(0, Math.min(0.05, t - cur.time));
    const duration = item ? item.info.duration : 0;
    if (seekDrag >= 0) elapsed = seekDrag * duration;
    else seek.set(duration ? elapsed / duration : 0);

    analyser.getFloatTimeDomainData(waveBuf);
    analyser.getByteFrequencyData(freqBuf);
    const title = song
      ? `${current + 1}. ${song.title || item.file} (${UI.fmtTime(duration)})`
      : 'MODAMP  ·  DROP A .MOD .S3M .XM OR .IT FILE, OR PRESS L TO OPEN ONE';
    lcd.draw({
      state: playing ? 'play' : player && (elapsed > 0 || cur && cur.order > 0) ? 'pause' : 'stop',
      time: elapsed, duration, title, wave: waveBuf, freq: freqBuf,
      format: song && song.format, channels: song ? song.channels : 0, rate: ctx.sampleRate, linear: song && song.linear,
      separation: settings.separation, tracker: song && song.tracker,
      order: cur ? cur.order : -1, orders: song ? song.orders.length : 0, pattern: cur ? cur.pattern : -1,
      row: cur ? cur.row : -1, rows: cur ? cur.rows : 0, speed: cur ? cur.speed : -1, tempo: cur ? cur.tempo : 0,
      voices: cur && playing ? cur.voices : 0,
    });

    if (settings.view === 'samples') sampleBrowser.update(playing ? cur : null);
    else if (cur) patternView.update(cur.order, cur.row);
    else patternView.update(-1, -1);
    channelsView.update(playing ? cur : null, player ? player.mixGain : 1, song ? song.octaveShift : 0, dt);
    samplesView.update(playing ? cur : null, dt);
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => {
    patternView.dirty = true;
    UI.drawEqCurve($('eq-curve'), filters, settings.eqOn);
  });

  applyVolume();
  applySeparation();
  applyEq();
  updateButtons();
  requestAnimationFrame(frame);
})();
