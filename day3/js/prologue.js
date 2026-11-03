// Short prologue on a black screen: a block cursor blinks, types a line with an
// irregular rhythm, waits a few seconds, then the screen goes black again.
const Prologue = (() => {
  const WAIT_BEFORE = 1.5;  // seconds of blinking cursor before typing
  const WAIT_AFTER = 3.5;   // seconds the full line stays on screen
  const BLACK = 0.8;        // seconds of black screen before the effect starts

  function create(el) {
    const text = document.createElement('span');
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    el.append(text, cursor);
    let timers = [];

    const later = (s, f) => timers.push(setTimeout(f, s * 1000));

    function stop() {
      timers.forEach(clearTimeout);
      timers = [];
      el.classList.add('hidden');
    }

    function play(line, done) {
      stop();
      text.textContent = '';
      el.classList.remove('hidden', 'typing');
      // Uneven typing like a person at a keyboard, with a pause after punctuation
      let t = WAIT_BEFORE;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        later(t, () => {
          el.classList.add('typing');
          text.textContent += ch;
        });
        t += 0.06 + Math.random() * 0.12 + (',.'.includes(ch) ? 0.45 : 0);
      }
      later(t, () => el.classList.remove('typing'));
      later(t + WAIT_AFTER, () => el.classList.add('hidden'));
      later(t + WAIT_AFTER + BLACK, done);
    }

    return { play, stop };
  }

  return { create };
})();
