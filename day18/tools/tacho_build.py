# Builds day18/img/tacho.png from contagiri.png: removes the painted needle so the game
# can draw a rotating one. Run from day18: python tools/tacho_build.py <path of contagiri.png>
from PIL import Image, ImageFilter
import numpy as np, json, sys, os

SRC = sys.argv[1]
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img', 'tacho.png')
OUT_W = 600

orig = np.array(Image.open(SRC).convert('RGBA')).astype(np.float32)
H, W = orig.shape[:2]
yy, xx = np.mgrid[0:H, 0:W]
R, G, B = orig[..., 0], orig[..., 1], orig[..., 2]

# painted needle: from the hub (1110, 537) to the tip (1655, 410)
p0 = np.array([1110., 537.]); p1 = np.array([1655., 410.])
d = p1 - p0; L = np.linalg.norm(d); u = d / L; n = np.array([-u[1], u[0]])
t = (xx - p0[0]) * u[0] + (yy - p0[1]) * u[1]
s = (xx - p0[0]) * n[0] + (yy - p0[1]) * n[1]
band = (t > -30) & (t < L + 6) & (np.abs(s) < 56)
hubzone = (np.hypot(xx - 1078, yy - 540) < 128) & (yy < 592)
navy = ((R + G + B) / 3 < 30) & (B >= R)
bluish = (B > R + 40) & (B > 70) & (R < 90) & (G < 150)
label = (B >= R) & ((R + G + B) / 3 > 90) & (np.abs(s) > 16)       # numbers / ticks beside the needle
mask = band & ~hubzone & ~navy & ~bluish & ~label

img = orig.copy()
ring = (np.abs(s) < 80) & (t > -30) & (t < L + 30) & ~band & navy
face = orig[ring][:, :3].mean(0)
img[mask, :3] = face
# soften the seam
bl = np.array(Image.fromarray(img.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))).astype(np.float32)
m8 = Image.fromarray((mask * 255).astype(np.uint8))
edge = (np.array(m8.filter(ImageFilter.MaxFilter(7))) > 0) & ~(np.array(m8.filter(ImageFilter.MinFilter(7))) > 0) & ~label & ~hubzone
img[edge, :3] = bl[edge, :3]

# hub and green ring: symmetric about x = 1081, copy the hidden part from the mirrored side
CX = 1081
keep = hubzone & ~band
img[keep] = orig[keep]
mir = hubzone & band
img[yy[mir], xx[mir]] = orig[yy[mir], (2 * CX - xx[mir]).astype(int)]

# thin blue arc (a circle centred at (1085, 837), r = 542): redraw it across the gap
dist = np.hypot(xx - 1085, yy - 837) - 542.3
near = bluish & (np.abs(dist) < 8) & ~band
col = np.array([R[near].mean(), G[near].mean(), B[near].mean()])
paint = band & ~hubzone & (np.abs(dist) < 2.2)
k = np.clip(1 - np.abs(dist[paint]) / 2.2, 0, 1)[:, None]
img[paint, :3] = img[paint, :3] * (1 - k) + col * k

# crop to the visible part and scale down for the HUD
out = Image.fromarray(img.clip(0, 255).astype(np.uint8))
bbox = out.getchannel('A').getbbox()
out = out.crop(bbox)
sc = OUT_W / out.width
out = out.resize((OUT_W, round(out.height * sc)), Image.LANCZOS)
out.save(DST)

# geometry for the game, in output pixels
pivot = ((1081 - bbox[0]) * sc, (538 - bbox[1]) * sc)
# scale: ellipse through the tick marks (centre 1085.2, 699; semi-axes 643.8 x 531.0) and the
# parametric angle of each value 0..8 measured on the ticks (3 and 5 from symmetry)
params = [166.7, 150.2, 132.9, 111.5, 90.0, 68.5, 47.0, 29.8, 13.3]
ticks = []
for th in params:
    a = np.radians(th)
    ticks.append([round((1085.2 + 643.8 * np.cos(a) - bbox[0]) * sc, 2), round((699 - 531.0 * np.sin(a) - bbox[1]) * sc, 2)])
# paste these into TACHO in js/game.js if they change
print(json.dumps({'size': out.size, 'pivot': [round(pivot[0], 2), round(pivot[1], 2)], 'hubR': round(55 * sc, 2), 'ticks': ticks}))
