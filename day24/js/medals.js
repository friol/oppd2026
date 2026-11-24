'use strict';
// Medals: achievements earned for special feats, kept in localStorage.
// Shown in the "Tables & records" panel (locked ones greyed out).

const MEDALS = (function () {
  const LIST = [
    { id: 'first', icon: '★', name: 'First Blood', desc: 'Find the Joker for the first time.' },
    { id: 'streak5', icon: '5', name: 'Hot Hand', desc: 'Find the Joker 5 times in a row.' },
    { id: 'allin', icon: '$', name: 'Nerves of Steel', desc: 'Win a round with an all-in bet.' },
    { id: 'fast', icon: '»', name: 'Eagle Eye', desc: 'Win on Hard or Pro at speed ×1.8 or faster.' },
    { id: 'coin', icon: '¢', name: 'Not Fooled', desc: 'Win a round in which the dealer used the coin trick.' },
    { id: 'rich', icon: '$$', name: 'High Roller', desc: 'Cash out with $1000 or more.' },
    { id: 'legend', icon: '♛', name: 'Legend', desc: 'Reach a bank of $5000.' },
    { id: 'pro', icon: '4', name: 'Four of a Kind', desc: 'Win a round on Pro, with four cards.' },
    { id: 'ace', icon: 'A', name: 'Golden Touch', desc: 'Pick the Golden Ace.' },
    { id: 'skull', icon: '☠', name: 'Skull & Bones', desc: 'Pick the Skull and survive.' },
    { id: 'brink', icon: '!', name: 'Back from the Brink', desc: 'Win a round starting with $20 or less.' },
    { id: 'gadget', icon: '+', name: 'Gadget Man', desc: 'Use all three helpers in a single run.' },
    { id: 'cat', icon: '♥', name: 'Cat Whisperer', desc: 'Pet the bar cat three times.' },
    { id: 'thief', icon: 'QH', name: 'Quick Hands', desc: 'Catch the chip thief three times.' },
    { id: 'sheriff', icon: '★', name: 'Wanted', desc: 'Anger the dealer so much that the sheriff walks in.' },
    { id: 'duel', icon: 'D', name: 'Fastest Gun', desc: 'Win a duel against the sheriff.' },
    { id: 'lightning', icon: '!!', name: 'Lightning Draw', desc: 'Win a duel with a reaction under 250 ms.' }
  ];

  const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

  let earned = load('day24.medals', []);
  if (!Array.isArray(earned)) earned = [];
  let progress = load('day24.medalprog', {});
  if (!progress || typeof progress !== 'object') progress = {};

  const has = id => earned.includes(id);

  // Earn a medal; returns true the first time (with a toast and a little fanfare).
  function award(id) {
    const m = LIST.find(x => x.id === id);
    if (!m || has(id)) return false;
    earned.push(id);
    store('day24.medals', earned);
    SOUND.unlock();
    SALOON.toast('Medal earned: ' + m.name + '!');
    if (typeof SCENE !== 'undefined') SCENE.refreshPosters();
    return true;
  }

  // Count one more step toward a medal that needs `target` of them.
  function bump(id, target) {
    progress[id] = (progress[id] || 0) + 1;
    store('day24.medalprog', progress);
    if (progress[id] >= target) award(id);
  }

  function render(box) {
    box.innerHTML = LIST.map(m =>
      '<div class="medal' + (has(m.id) ? ' on' : '') + '">' +
      '<span class="mico">' + m.icon + '</span>' +
      '<span class="mtext"><b>' + m.name + '</b><small>' + m.desc + '</small></span></div>').join('');
  }

  return { award, bump, has, render, list: LIST, get count() { return earned.length; } };
})();
