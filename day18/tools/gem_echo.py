# Builds soundfx/gem.wav from soundfx/hexaedron.wav: the item pickup sound with a little
# stereo echo (two short ping-pong delays, darker at every repeat).
# Run from day18: python tools/gem_echo.py
import os, wave
import numpy as np

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'soundfx')
w = wave.open(os.path.join(here, 'hexaedron.wav'))
sr, ch = w.getframerate(), w.getnchannels()
d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, ch).astype(np.float32) / 32768
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
o = wave.open(os.path.join(here, 'gem.wav'), 'wb')
o.setnchannels(2); o.setsampwidth(2); o.setframerate(sr)
o.writeframes((out * 32767).astype(np.int16).tobytes())
o.close()
print('gem.wav', round(len(out) / sr, 2), 's')
