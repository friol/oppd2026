# Cuts HUD graphics out of the sheets supplied by the user (white background, each picture
# inside a grey frame) and writes transparent PNGs into img/.
# Background removal: flood fill of near-white pixels from the frame edges (white parts
# enclosed by the glyph, like highlights, are kept), then the anti-aliased rim is
# "un-mixed" from white so no light halo remains.
# Run from day18:
#   python tools/sprite_cutout.py "<...>/3.2.1.go.jpg" count3:40:277:262:506 count2:303:545:262:506 count1:572:804:262:506 countgo:831:1073:262:506
#   python tools/sprite_cutout.py "<...>/lap2.lap3.boost.splat.jpg" lap2:19:320:29:277 lap3:346:652:29:277 boost:679:1052:29:277 splat:1078:1315:29:277
#   python tools/sprite_cutout.py "<...>/place.bestlap.boom.jpg" --inset=6 place1:37:281:257:510 place2:296:550:257:510 place3:565:811:257:510 bestlap:826:1080:271:510 boom:1050:1359:16:269
# name:x0:x1:y0:y1 = inner area of each frame in sheet pixels.
# Optional --inset=N (default 2): extra pixels cut inside the area, to drop the blurry rim of the
# frame lines (JPEG ringing) when the frame is thick.
import os, sys
from collections import deque
import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img')
CELLS = {}
INSET = 2
for a in sys.argv[2:]:
    if a.startswith('--inset='):
        INSET = int(a.split('=')[1]); continue
    n, x0, x1, y0, y1 = a.split(':')
    CELLS[n] = (int(x0), int(x1), int(y0), int(y1))

sheet = np.array(Image.open(SRC).convert('RGB')).astype(np.float32)
for name, (x0, x1, y0, y1) in CELLS.items():
    c = sheet[y0 + INSET:y1 - INSET, x0 + INSET:x1 - INSET]
    H, W = c.shape[:2]
    # whiteness: distance from pure white
    dist = np.sqrt(((255 - c) ** 2).sum(2))
    bg = np.zeros((H, W), bool)
    q = deque()
    for y in range(H):
        for x in (0, W - 1):
            q.append((y, x))
    for x in range(W):
        for y in (0, H - 1):
            q.append((y, x))
    while q:
        y, x = q.popleft()
        if bg[y, x] or dist[y, x] > 60:
            continue
        bg[y, x] = True
        if y > 0: q.append((y - 1, x))
        if y < H - 1: q.append((y + 1, x))
        if x > 0: q.append((y, x - 1))
        if x < W - 1: q.append((y, x + 1))
    alpha = np.where(bg, 0.0, 1.0)
    # rim pixels next to the background: alpha from how far they are from white,
    # colour un-mixed from white (c = a * fg + (1 - a) * 255)
    near = np.zeros_like(bg)
    near[1:] |= bg[:-1]; near[:-1] |= bg[1:]; near[:, 1:] |= bg[:, :-1]; near[:, :-1] |= bg[:, 1:]
    rim = near & ~bg
    a_rim = np.clip(dist / 140.0, 0.15, 1.0)
    alpha[rim] = a_rim[rim]
    fg = c.copy()
    a3 = np.maximum(alpha, 1e-3)[..., None]
    fg = np.where(rim[..., None], np.clip((c - (1 - a3) * 255) / a3, 0, 255), c)
    # the background pixels that passed the threshold but are a bit darker (jpeg noise)
    rgba = np.dstack([fg, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, 'RGBA')
    img = img.crop(img.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox())
    # pixel art: upscale x2 with nearest neighbour so it stays crisp when shown large
    img = img.resize((img.width * 2, img.height * 2), Image.NEAREST)
    img.save(os.path.join(OUT, name + '.png'))
    print(name, img.size)
