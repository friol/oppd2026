# Builds soundfx/drift_loop.mp3 from soundfx/drift.mp3: a seamless, steady tyre screech for
# long skids. Takes the core of the sample (0.2-0.7 s), flattens its loudness so the loop
# does not pulse, and crossfades the end into the start.
# Run from day18: python tools/drift_loop.py [output folder]   (default soundfx)
import os, sys
import numpy as np
from audio_io import read, write_mp3

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'soundfx')
out_dir = sys.argv[1] if len(sys.argv) > 1 else here
sr, d = read(os.path.join(here, 'drift.mp3'))
ch = d.shape[1]

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
write_mp3(os.path.join(out_dir, 'drift_loop.mp3'), loop, sr)
print('drift_loop.mp3', round(len(loop) / sr, 3), 's')
