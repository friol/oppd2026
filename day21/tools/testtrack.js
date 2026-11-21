// Node test: builds the track, prints the speed / g-force profile of a free ride and an AI time-trial lap.
// Usage: node tools/testtrack.js [step meters]
global.UTIL = require('../js/util.js');
const T = require('../js/track.js');
const t0 = Date.now();
T.build();
console.log('length', T.L.toFixed(1), 'm, samples', T.N, 'build', Date.now() - t0, 'ms, ride time', T.rideTime.toFixed(1), 's');
const step = parseFloat(process.argv[2] || '10');
const zn = Object.keys(T.Z);
let gmax = -9, gmin = 9, lmax = 0, gi = 0, ni = 0, li = 0;
for (let i = 0; i < T.N; i++) {
  const s = i * T.ds, v = T.vDesign[i];
  const g = T.gAt(s, v);
  if (g.vert > gmax) { gmax = g.vert; gi = s; }
  if (g.vert < gmin) { gmin = g.vert; ni = s; }
  if (Math.abs(g.lat) > lmax) { lmax = Math.abs(g.lat); li = s; }
  if (i % Math.round(step / T.ds) === 0) {
    const p = T.P[i];
    console.log(s.toFixed(0).padStart(4), zn[T.zone[i]].padEnd(7), 'pos', p.map(x => x.toFixed(1).padStart(6)).join(' '),
      ' v', (v * 3.6).toFixed(0).padStart(4), ' bank', (T.bank[i] * 57.3).toFixed(0).padStart(4),
      ' vert', g.vert.toFixed(2).padStart(6), ' lat', g.lat.toFixed(2).padStart(6),
      ' safe', (T.vSafe[i] * 3.6).toFixed(0).padStart(4), ' cap', (T.vCap[i] * 3.6).toFixed(0).padStart(4), ' up.y', T.uy[i].toFixed(2));
  }
}
console.log('free ride: max vert', gmax.toFixed(2), '@', gi.toFixed(0), ' min vert', gmin.toFixed(2), '@', ni.toFixed(0), ' max |lat|', lmax.toFixed(2), '@', li.toFixed(0));

// AI time trial
const st = T.newState('game');
let t = 0, derail = null, maxV = 0;
const dt = 1 / 60;
while (st.dist < T.L && t < 300) {
  const cap = T.trainCap(st.s, 2) * 0.97;
  const ctl = { throttle: st.v < cap - 0.3 ? 1 : 0, brake: st.v > cap ? 1 : 0 };
  T.step(st, dt, ctl);
  t += dt; maxV = Math.max(maxV, st.v);
  for (let c = 0; c < T.N_CARS; c++) {
    const g = T.gAt(T.carS(st.s, c), st.v);
    if (g.vert > T.LIMITS.vmax || g.vert < T.LIMITS.vmin || Math.abs(g.lat) > T.LIMITS.lat) { derail = derail || { s: st.s, t, g }; }
  }
}
console.log('AI lap', t.toFixed(2), 's, max speed', (maxV * 3.6).toFixed(0), 'km/h, derail', JSON.stringify(derail));
