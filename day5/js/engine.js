'use strict';

// Audio engine: owns the replayer that feeds the audio output. It receives commands from the page
// and posts back the snapshot of every tick with the time it becomes audible.
// It runs inside an AudioWorklet (audio thread, not slowed down when the page is in the background)
// or, as a fallback, on the page in a ScriptProcessor. Both functions below are plain so that
// main.js can put their source into the worklet (toString()).
function defineEngine(Player) {
  class Engine {
    constructor(sampleRate, post) {
      this.sr = sampleRate;
      this.post = post;
      this.player = null;
      this.playing = false;
      this.finished = false;
      this.repeat = false;
      this.orderTimes = [];
      this.rendered = 0;
      this.timeBase = 0;
      this.gen = 0;   // command generation: snapshots of older generations are dropped by the page
    }

    command(m) {
      if (m.gen !== undefined) this.gen = m.gen;
      const p = this.player;
      switch (m.type) {
        case 'load':
          this.player = new Player.Player(m.song, this.sr);
          this.player.mixGain *= m.gain;
          this.player.separation = m.separation;
          if (m.muted) this.player.muted.set(m.muted);
          this.orderTimes = m.orderTimes;
          this.restart(0);
          this.playing = !!m.play;
          break;
        case 'play': this.playing = m.value; return;
        case 'seek': if (p) { p.seek(m.order); this.restart(this.orderTimes[m.order] || 0); } break;
        case 'repeat': this.repeat = m.value; return;
        case 'separation': if (p) p.separation = m.value; return;
        case 'muted': if (p) p.muted.set(m.muted); return;
        default: return;
      }
      if (this.player) this.post({ type: 'idle', gen: this.gen, mixGain: this.player.mixGain, snap: this.idleSnapshot() });
    }

    restart(timeBase) {
      this.rendered = 0;
      this.timeBase = timeBase;
      this.finished = false;
    }

    idleSnapshot() {
      const s = this.player.snapshot();
      s.songTime = this.timeBase;
      s.time = 0;
      s.gen = this.gen;
      return s;
    }

    // fills one output buffer; t0 = audio context time of its first sample
    process(L, R, t0) {
      const p = this.player;
      if (!p || !this.playing || this.finished) { L.fill(0); R.fill(0); return; }
      const sr = this.sr, base = this.rendered, out = [];
      p.render(L, R, (off) => {
        const snap = p.snapshot();
        snap.time = t0 + off / sr;
        snap.gen = this.gen;
        if (snap.ended) {
          if (!this.repeat) {
            this.finished = true;
            out.push({ time: snap.time, end: true, gen: this.gen });
            return false;
          }
          this.timeBase = this.orderTimes[snap.order] - (base + off) / sr;
        }
        snap.songTime = this.timeBase + (base + off) / sr;
        out.push(snap);
        return true;
      });
      this.rendered += L.length;
      if (out.length) this.post({ type: 'snaps', gen: this.gen, list: out });
    }
  }
  return Engine;
}

// AudioWorklet entry point (runs in the AudioWorkletGlobalScope)
function workletMain(T, definePlayer, defineEngine) {
  const Engine = defineEngine(definePlayer(T));
  class ModAmpProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.engine = new Engine(sampleRate, (m) => this.port.postMessage(m));
      this.port.onmessage = (e) => this.engine.command(e.data);
    }
    process(inputs, outputs) {
      const o = outputs[0];
      this.engine.process(o[0], o[1], currentTime);
      return true;
    }
  }
  registerProcessor('modamp', ModAmpProcessor);
}
