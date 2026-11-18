# Builds soundfx/gem.mp3 from soundfx/hexaedron.mp3: the item pickup sound with a little
# stereo echo (two short ping-pong delays, darker at every repeat).
# Run from day18: python tools/gem_echo.py [output folder]   (default soundfx)
import os, sys
import numpy as np
from audio_io import read, write_mp3

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'soundfx')
out_dir = sys.argv[1] if len(sys.argv) > 1 else here
sr, d = read(os.path.join(here, 'hexaedron.mp3'))
dry = d.mean(1)

tail = int(1.1 * sr)
L = np.zeros(len(dry) + tail, np.float32); R = np.zeros_like(L)
L[:len(dry)] += dry; R[:len(dry)] += dry
dl, dr, fb, mix = int(0.16 * sr), int(0.21 * sr), 0.42, 0.5
bufL = np.zeros_like(L); bufR = np.zeros_like(L)
lpL = lpR = 0.0
k = 1 - np.exp(-2 * np.pi * 3500 / sr)          # lowpass inside the loop
for i in range(len(L)):
    x = dry[i] if i < len(dry) else 0.0
    eL = bufR[i - dl] if i >= dl else 0.0       # cross feedback: ping-pong
    eR = bufL[i - dr] if i >= dr else 0.0
    lpL += (eL - lpL) * k; lpR += (eR - lpR) * k
    bufL[i] = x + lpL * fb
    bufR[i] = x * 0.6 + lpR * fb
    L[i] += lpL * mix; R[i] += lpR * mix
out = np.stack([L, R], 1)
out *= 10 ** (-1 / 20) / np.abs(out).max()
write_mp3(os.path.join(out_dir, 'gem.mp3'), out, sr)
print('gem.mp3', round(len(out) / sr, 2), 's')
