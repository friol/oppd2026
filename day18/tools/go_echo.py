# Builds soundfx/go.mp3 from soundfx/go.dry.mp3 ("GO!" with lots of echo): cuts the word
# (0.2-0.85 s) out of the background hiss, adds early reflections and two long ping-pong delays
# (darker at every repeat), normalizes to -1 dBFS.
# Run from day18: python tools/go_echo.py [output folder]   (default soundfx)
import os, sys
import numpy as np
from audio_io import read, write_mp3

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'soundfx')
out_dir = sys.argv[1] if len(sys.argv) > 1 else here
sr, d = read(os.path.join(here, 'go.dry.mp3'))
a, b = int(0.2 * sr), int(0.85 * sr)
dry = d[a:b, 0].copy()
n = len(dry)
fi, fo = int(0.01 * sr), int(0.08 * sr)
dry[:fi] *= np.linspace(0, 1, fi)
dry[-fo:] *= np.linspace(1, 0, fo)

total = n + int(3.6 * sr)
L = np.zeros(total, np.float32); R = np.zeros_like(L)
L[:n] += dry; R[:n] += dry
for dl_, gl, gr in [(0.023, 0.35, 0.3), (0.041, 0.28, 0.33), (0.059, 0.22, 0.2), (0.079, 0.18, 0.24)]:
    o = int(dl_ * sr)
    L[o:o + n] += dry * gl; R[o:o + n] += dry * gr
dL, dR, fb, mix = int(0.30 * sr), int(0.37 * sr), 0.58, 0.7
bufL = np.zeros_like(L); bufR = np.zeros_like(L)
lpL = lpR = 0.0
k = 1 - np.exp(-2 * np.pi * 2600 / sr)
for i in range(total):
    x = dry[i] if i < n else 0.0
    eL = bufR[i - dL] if i >= dL else 0.0
    eR = bufL[i - dR] if i >= dR else 0.0
    lpL += (eL - lpL) * k; lpR += (eR - lpR) * k
    bufL[i] = x + lpL * fb
    bufR[i] = x * 0.6 + lpR * fb
    L[i] += lpL * mix; R[i] += lpR * mix
out = np.stack([L, R], 1)
out *= 10 ** (-1 / 20) / np.abs(out).max()
write_mp3(os.path.join(out_dir, 'go.mp3'), out, sr)
print('go.mp3', round(total / sr, 2), 's')
