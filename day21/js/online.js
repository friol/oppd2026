// online.js - client of the online leaderboard (server/leaderboard.php, PHP + MySQL).
// Enabled only when the page is served over http(s) from a public host: from file://,
// localhost, 127.x, ::1, *.local or private network addresses it stays off entirely
// (no requests, no menu entries).
(function () {
  'use strict';

  function isLocalHost(h) {
    h = (h || '').toLowerCase().replace(/^\[|\]$/g, '');
    return h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      h === '::1' || h === '0.0.0.0' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
  }

  const ON = {
    enabled: /^https?:$/.test(location.protocol) && !isLocalHost(location.hostname),
    url: 'server/leaderboard.php',
    cache: null,        // { t, entries }
    error: null         // message of the last failed request
  };
  const NAME_KEY = 'riemann.name';

  ON.getName = function () { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
  ON.setName = function (n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* storage unavailable */ } };
  ON.validName = function (n) { return /^[\p{L}\p{N} _.\-]{2,16}$/u.test(n); };

  async function request(url, opt) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, Object.assign({ cache: 'no-store', signal: ctl.signal }, opt || {}));
      let data = null;
      try { data = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
      return data;
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Server not responding' : e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  // Top 10 (cached for 30 s)
  ON.top = async function (force) {
    if (!ON.enabled) return [];
    if (ON.cache && !force && Date.now() - ON.cache.t < 30000) return ON.cache.entries;
    try {
      const data = await request(ON.url + '?limit=10');
      ON.cache = { t: Date.now(), entries: data.entries };
      ON.error = null;
      return data.entries;
    } catch (e) {
      ON.error = e.message;
      throw e;
    }
  };

  // Submits a lap { name, timeMs, driveMs, derails }; resolves with { rank, best, entries }
  ON.submit = async function (run) {
    if (!ON.enabled) throw new Error('Leaderboard disabled');
    const data = await request(ON.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run)
    });
    ON.cache = { t: Date.now(), entries: data.entries };
    return data;
  };

  window.ONLINE = ON;
})();
