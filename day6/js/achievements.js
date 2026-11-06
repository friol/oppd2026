// Achievements of both variants: storage, unlock toasts and the list dialog.
// Tetraphon and Octaphon keep separate lists, each with Forward and Reverse.
const Achievements = (() => {
  // { classic: { 5: '2026-11-06', … }, reverse: { … }, 'octa.classic': { … }, 'octa.reverse': { … } }
  const KEY = 'oppd2026.day6.achievements';
  const TOAST_TIME = 3200; // ms a toast stays on screen
  const MODES = { classic: 'Forward', reverse: 'Reverse' };
  const VARIANTS = { tetra: 'Tetraphon', octa: 'Octaphon' };
  const slot = (variant, mode) => (variant === 'octa' ? 'octa.' : '') + mode;

  const data = {};
  for (const v in VARIANTS) for (const m in MODES) data[slot(v, m)] = {};
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k in data) if (d[k] && typeof d[k] === 'object') data[k] = d[k];
  } catch (e) { /* no storage or bad data: start empty */ }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode */ } };
  const total = () => Game.ACHIEVEMENTS.length * Object.keys(MODES).length; // per variant
  const count = variant => Object.keys(MODES).reduce((n, m) => n + Object.keys(data[slot(variant, m)]).length, 0);

  const toast = document.getElementById('toast');
  const dialog = document.getElementById('achievements');
  const list = document.getElementById('ach-list');
  const queue = [];
  let showing = false;

  function showNext() {
    if (showing || !queue.length) return;
    const { a, variant, mode } = queue.shift();
    showing = true;
    toast.querySelector('.toast-kind').textContent = `Achievement unlocked · ${VARIANTS[variant]} ${MODES[mode]}`;
    toast.querySelector('.toast-title').textContent = a.title;
    toast.querySelector('.toast-sub').textContent = `A sequence of ${a.len} notes`;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { showing = false; showNext(); }, 400);
    }, TOAST_TIME);
  }

  // Records the achievements reached with a completed sequence of `len` notes; returns the new ones
  function reach(variant, mode, len) {
    const have = data[slot(variant, mode)];
    const fresh = Game.earned(len, have);
    if (!fresh.length) return fresh;
    const today = new Date().toISOString().slice(0, 10);
    for (const a of fresh) {
      have[a.len] = today;
      queue.push({ a, variant, mode });
    }
    save();
    showNext();
    return fresh;
  }

  function fmt(iso) {
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? '✓' : '✓ ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // The list of one variant
  function render(variant) {
    list.innerHTML = '';
    const rows = Object.keys(MODES).map(m => data[slot(variant, m)]);
    for (const a of Game.ACHIEVEMENTS) {
      const row = document.createElement('tr');
      row.className = rows.some(d => d[a.len]) ? 'got' : '';
      row.innerHTML = `<td class="len">${a.len}</td><td class="title"></td>` +
        rows.map(d => `<td class="${d[a.len] ? 'yes' : 'no'}">${d[a.len] ? fmt(d[a.len]) : '—'}</td>`).join('');
      row.querySelector('.title').textContent = a.title;
      list.appendChild(row);
    }
    document.getElementById('ach-heading').textContent = `Achievements · ${VARIANTS[variant]}`;
    document.getElementById('ach-count').textContent = `${count(variant)} of ${total()} unlocked`;
  }

  function open(variant) {
    render(variant);
    dialog.showModal();
  }

  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); // click on the backdrop
  document.getElementById('ach-close').addEventListener('click', () => dialog.close());

  return { reach, open, count, total, isOpen: () => dialog.open };
})();
