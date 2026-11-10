'use strict';
// Stage themes. Offsets are in road half-widths from the road centre (|x| <= 1 is tarmac).
// The route is a pyramid: OCEAN DRIVE -> (NEON CITY | GATOR BAYOU) -> (KEYS BRIDGE | DESERT RUN) -> GOAL.
const THEMES = {
  miami: {
    name: 'OCEAN DRIVE', next: ['neon', 'bayou'],
    road: ['#5e5872', '#575169'], rumble: ['#ff3fa4', '#f6f6f6'], lane: '#f6f6f6',
    groundL: ['#3aa070', '#329262'], groundR: ['#f4c983', '#eab872'],
    water: { r: 3.2, cols: ['#25a9cc', '#1d96bb'], foam: '#f2fdff' },
    limit: 2.8, traffic: 9, hill: 22, curve: 4,
    // tunnel: wall / ceiling colours (light, dark segment), portal face, neon trim, ceiling lamps
    tunnel: { wall: ['#d8aab4', '#cc9ea8'], ceil: ['#9a7080', '#906676'], face: '#f2a2bc', trim: '#18b8c4', lamp: '#fff6d8' },
    decorate(n, rnd, add) {
      if (n % 9 === 0) add('palm', -1.2 - rnd() * 0.25, { collide: true });
      if (n % 45 === 20) add('hotel', -1.9 - rnd() * 0.5, { collide: true });
      if (n % 150 === 80) add('oceansign', -1.5, { collide: true });
      if (n % 15 === 6) add('umbrella', 1.35 + rnd() * 1.3, { collide: true });
      if (n % 64 === 30) add('lifeguard', 1.5 + rnd() * 0.6, { collide: true });
      if (n % 21 === 12) add('surfboard', 1.25 + rnd() * 1.6, { collide: true });
      if (n % 27 === 3 && rnd() < 0.7) add('palm', 1.2 + rnd() * 0.3, { collide: true });
      if (n % 11 === 5) add('surfer', 3.7 + rnd() * 5, { ax: -0.5, bob: true });
      if (n % 13 === 9) add('beachgoer', 1.4 + rnd() * 1.6, { collide: true });
      if (n % 17 === 2) add('chair', 1.5 + rnd() * 1.4);
      if (n % 5 === 2 && n % 45 > 30) add('flowers', -1.2 - rnd() * 0.4);
      if (n % 30 === 24) add('streetlamp', -1.12, { collide: true });
      if (n % 150 === 125) add('billboard', -1.5, { collide: true });
      if (n % 85 === 60) add('flamingo', 1.3 + rnd() * 0.8);
    },
    forkDecor(n, rnd, add) {
      if (n % 12 === 0) { add('palm', -1.3, { collide: true }); add('palm', 1.3, { collide: true }); }
      if (n % 20 === 10) add('umbrella', 1.7, { collide: true });
      if (n % 14 === 7) add('surfer', 4 + rnd() * 4, { ax: -0.5, bob: true });
    }
  },

  neon: {
    name: 'NEON CITY', next: ['keys', 'desert'],
    road: ['#2c2640', '#28223a'], rumble: ['#00f0ff', '#ff2bd6'], lane: '#ffd0ff',
    groundL: ['#1c1534', '#17112c'], groundR: ['#1c1534', '#17112c'],
    limit: 2.2, traffic: 7, hill: 14, curve: 4, nightK: 0.45,
    tunnel: { wall: ['#3a3452', '#332e4a'], ceil: ['#262238', '#221e33'], face: '#4a4466', trim: '#00f0ff', lamp: '#ffe9a0' },
    decorate(n, rnd, add) {
      if (n % 10 === 0) { add('lampL', -1.12, { collide: true }); add('lampR', 1.12, { collide: true }); }
      if (n % 28 === 14) add('skyscraper', -(1.8 + rnd() * 0.6), { collide: true });
      if (n % 28 === 0) add('skyscraper', 1.8 + rnd() * 0.6, { collide: true });
      if (n % 60 === 30) add('neonsign', (rnd() < 0.5 ? -1 : 1) * 1.35, { collide: true });
      if (n % 20 === 5) add('palmNight', (rnd() < 0.5 ? -1 : 1) * (1.3 + rnd() * 0.3), { collide: true });
      if (n % 75 === 50) add('neonarrow', (rnd() < 0.5 ? -1 : 1) * 1.4, { collide: true });
    },
    forkDecor(n, rnd, add) {
      if (n % 10 === 0) { add('lampL', -1.12, { collide: true }); add('lampR', 1.12, { collide: true }); }
      if (n % 30 === 15) { add('skyscraper', -1.9, { collide: true }); add('skyscraper', 1.9, { collide: true }); }
    }
  },

  bayou: {
    name: 'GATOR BAYOU', next: ['keys', 'desert'],
    road: ['#4c4c46', '#47473f'], rumble: ['#f0e8c8', '#b03a2a'], lane: '#f0e8c8',
    groundL: ['#4e7e2e', '#467228'], groundR: ['#4e7e2e', '#467228'],
    water: { l: 2.4, r: 2.4, cols: ['#2e5e52', '#28544a'], foam: '#9cc0a0' },
    limit: 2.2, traffic: 6, hill: 18, curve: 5, weather: 'rain',
    decorate(n, rnd, add) {
      if (n % 8 === 0) add('tree', -(1.3 + rnd() * 0.7), { collide: true });
      if (n % 8 === 4) add('tree', 1.3 + rnd() * 0.7, { collide: true });
      if (n % 6 === 2) add('bush', (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * 0.8), { collide: true });
      if (n % 19 === 9) add('flamingo', (rnd() < 0.5 ? -1 : 1) * (2.7 + rnd() * 2), { ax: -0.5 });
      if (n % 90 === 45) add('airboat', (rnd() < 0.5 ? -1 : 1) * (3.2 + rnd() * 3), { ax: -0.5, bob: true });
      if (n % 200 === 100) add('gatorsign', 1.25, { collide: true });
      if (n % 110 === 55) add('curvesign', -1.25, { collide: true });
    },
    forkDecor(n, rnd, add) {
      if (n % 8 === 0) { add('tree', -1.4, { collide: true }); add('tree', 1.4, { collide: true }); }
      if (n % 19 === 9) add('flamingo', 3 + rnd() * 2, { ax: -0.5 });
    }
  },

  keys: {
    name: 'KEYS BRIDGE', next: null,
    road: ['#6c6c76', '#66666f'], rumble: ['#ffffff', '#e03030'], lane: '#ffffff',
    groundL: ['#cfcfc8', '#c4c4bc'], groundR: ['#cfcfc8', '#c4c4bc'],
    water: { l: 1.22, r: 1.22, cols: ['#1cbad0', '#16a8c0'], foam: '#ffffff' },
    limit: 1.1, rail: true, traffic: 5, hill: 10, curve: 3,
    nightK: 0,                        // always daytime on the bridge
    decorate(n, rnd, add) {
      if (n % 6 === 0) { add('railpost', -1.17, { ax: -0.5 }); add('railpost', 1.17, { ax: -0.5 }); }
      if (n % 23 === 7) add('sailboat', (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 6), { ax: -0.5, bob: true });
      if (n % 70 === 35) add('island', (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 5), { ax: -0.5 });
      if (n % 260 === 130) add('lighthouse', (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 2), { ax: -0.5 });
      if (n % 17 === 3) add('buoy', (rnd() < 0.5 ? -1 : 1) * (1.6 + rnd() * 2), { ax: -0.5, bob: true });
    },
    forkDecor() {}
  },

  desert: {
    name: 'DESERT RUN', next: null,
    road: ['#5c4c4a', '#574842'], rumble: ['#ffffff', '#f0a020'], lane: '#fff2c0',
    groundL: ['#e39456', '#d9884c'], groundR: ['#e39456', '#d9884c'],
    limit: 3, traffic: 7, hill: 40, curve: 5, weather: 'sand',
    tunnel: { wall: ['#9a5a3c', '#8e5236'], ceil: ['#6e3e2a', '#673a27'], face: '#b0663e', trim: '#f0a020', lamp: '#ffd890' },
    decorate(n, rnd, add) {
      if (n % 7 === 0) add('cactus', (rnd() < 0.5 ? -1 : 1) * (1.3 + rnd() * 2.2), { collide: true });
      if (n % 19 === 9) add('rock', (rnd() < 0.5 ? -1 : 1) * (1.4 + rnd() * 2), { collide: true });
      if (n % 220 === 110) add('motel', -1.5, { collide: true });
      if (n % 11 === 4) add('agave', (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * 1.5));
      if (n % 160 === 40) add('route66', 1.3, { collide: true });
      if (n % 90 === 70) add('chevron', 1.25, { collide: true });
    },
    forkDecor() {}
  }
};
