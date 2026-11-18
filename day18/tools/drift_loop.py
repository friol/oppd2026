# Builds soundfx/drift_loop.wav from soundfx/drift.wav: a seamless, steady tyre screech for
# long skids. Takes the core of the sample (0.2-0.7 s), flattens its loudness so the loop
# does not pulse, and crossfades the end into the start.
# Run from day18: python tools/drift_loop.py
import os, wave
import numpy as np

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'soundfx')
w = wave.open(os.path.join(here, 'drift.wav'))
sr, ch = w.getframerate(), w.getnchannels()
d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, ch).astype(np.float32) / 32768

seg = d[int(0.2 * sr):int(0.7 * sr)].copy()
# flatten the loudness: divide by a smoothed RMS envelope (50 ms window)
win = int(0.05 * sr)
pw = np.convolve((seg ** 2).mean(1), np.ones(win) / win, mode='same')
env = np.sqrt(pw) + 1e-4
seg *= (env.mean() / env)[:, None]
# seamless loop: the last `xf` samples fade into the first ones
xf = int(0.06 * sr)
t = np.linspace(0, 1, xf)[:, None]
loop = seg[xf:].copy()
loop[-xf:] = seg[-xf:] * (1 - t) + seg[:xf] * t
loop *= 10 ** (-3 / 20) / np.abs(loop).max()
o = wave.open(os.path.join(here, 'drift_loop.wav'), 'wb')
o.setnchannels(ch); o.setsampwidth(2); o.setframerate(sr)
o.writeframes((loop * 32767).astype(np.int16).tobytes())
o.close()
print('drift_loop.wav', round(len(loop) / sr, 3), 's')
