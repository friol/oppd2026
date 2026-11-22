# Builds img/atlas.png, img/title.png and js/atlas.js from the source art.
# Sprites are cut out of the white background (flood fill from the crop border),
# tiles and background strips are copied opaque.
# Usage: python tools/cut.py   (from the day22 folder)
import json
import os
from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage

SS = Image.open('img/spritesheet.webp').convert('RGB')
TS = Image.open('img/tiles.brackgrounds.jpg').convert('RGB')


def line_mask(a):
    """Long straight dark lines (frame borders in the sheet)."""
    dark = (a.sum(2) < 250).astype(float)
    h = ndimage.uniform_filter1d(dark, 50, axis=1) > 0.97
    v = ndimage.uniform_filter1d(dark, 50, axis=0) > 0.97
    # thick dark areas (like the boss armour) are not lines
    thick = ndimage.binary_dilation(ndimage.binary_opening(dark > 0, np.ones((6, 6))), iterations=3)
    return ndimage.binary_dilation((h | v) & ~thick, iterations=2)


SS_LINES = line_mask(np.asarray(SS).astype(int))


def cutout(src, box, lines=None, thr=70, peel=3, holes=False):
    x, y, w, h = box
    a = np.asarray(src.crop((x, y, x + w, y + h))).astype(int)
    light = (765 - a.sum(2)) < thr
    if lines is not None:
        light |= lines[y:y + h, x:x + w]
    # background = light pixels connected to the border
    lab, n = ndimage.label(light)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    if lines is not None:
        bg |= lines[y:y + h, x:x + w]
    lum = a.mean(2)
    sat = a.max(2) - a.min(2)
    # enclosed white gaps (e.g. between the arms and the body)
    if holes:
        lab3, n3 = ndimage.label((lum > 215) & (sat < 30) & ~bg)
        if n3:
            sizes = ndimage.sum(np.ones_like(lab3), lab3, range(1, n3 + 1))
            bg |= np.isin(lab3, [i + 1 for i, sz in enumerate(sizes) if sz >= 6])
    # peel the light, unsaturated compression halo layer by layer, down to the dark outline
    for _ in range(peel):
        ring = ndimage.binary_dilation(bg) & ~bg
        strip_ = ring & (lum > 135) & (sat < 60)
        if not strip_.any():
            break
        bg |= strip_
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # soften the light halo next to the background
    near = ndimage.binary_dilation(bg) & ~bg
    lum3 = a.sum(2)
    halo = near & (lum3 > 765 - 170) & (peel == 0)
    alpha[halo] = np.clip((765 - lum3[halo]) * 255 // 170, 0, 255).astype(np.uint8)
    # edge pixels that stay: pull any leftover white out of their colour
    edge = near & ~bg & (lum > 110)
    a = a.copy()
    a[edge] = (a[edge] * 0.75).astype(int)
    # drop small specks
    lab2, n2 = ndimage.label(alpha > 0)
    if n2 > 1:
        sizes = ndimage.sum(np.ones_like(lab2), lab2, range(1, n2 + 1))
        keep = np.zeros(n2 + 1, bool)
        keep[1:] = sizes >= max(12, sizes.max() * 0.04)
        alpha[~keep[lab2]] = 0
    rgba = np.dstack([a.astype(np.uint8), alpha])
    img = Image.fromarray(rgba, 'RGBA')
    bb = img.getbbox()
    return img.crop(bb) if bb else img


def scaled(img, s=None, size=None):
    if size:
        return img.resize(size, Image.LANCZOS)
    if s and s != 1:
        return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    return img


def tile(box, size=(32, 32)):
    x, y, w, h = box
    return TS.crop((x, y, x + w, y + h)).resize(size, Image.LANCZOS).convert('RGBA')


BG_CELL = 2  # screen pixels per background "art pixel"


def strip(box, height, colors=32, key=False, haze=True):
    """Background strip rebuilt as crisp pixel art: low-res grid, reduced palette, nearest upscale.
    key=True makes the strip's own sky transparent (flood fill from the top edge by colour)."""
    x, y, w, h = box
    im = TS.crop((x + 2, y + 1, x + w - 2, y + h - 1)).convert('RGB')
    sh = height // BG_CELL
    sw = round(im.width * sh / im.height)
    small = im.resize((sw, sh), Image.BOX if sh <= im.height else Image.LANCZOS)
    small = small.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
    small = small.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGBA')
    if key:
        a = np.array(small).astype(int)
        rgb = a[:, :, :3]
        # sky colour per column-independent: the brightest blue-ish colours of the top rows
        top = rgb[:2].reshape(-1, 3)
        sky = np.median(top, axis=0)
        near = np.sqrt(((rgb - sky) ** 2).sum(2)) < 46
        if haze:
            near |= (rgb[:, :, 2] > rgb[:, :, 0] + 25) & (rgb.sum(2) > 470)  # light blue haze
        lab, n = ndimage.label(near)
        seeds = set(np.unique(lab[0])) - {0}
        sky_mask = np.isin(lab, list(seeds))
        a[sky_mask, 3] = 0
        small = Image.fromarray(a.astype(np.uint8), 'RGBA')
    return small.resize((sw * BG_CELL, sh * BG_CELL), Image.NEAREST)


S = {}  # name -> image


NO_PEEL = {'brick', 'brick_cracked', 'qblock', 'qblock2', 'metal', 'smoke0', 'smoke1', 'pblue', 'porange', 'pblue_big',
           'porange_big', 'ladder', 'hbar', 'fireball_b', 'fireball_o', 'fire', 'crescent', 'boss_portal', 'window'}
HOLES = {'boss', 'boss_defeat'}


def spr(name, box, s=1, size=None, src=SS):
    S[name] = scaled(cutout(src, box, SS_LINES if src is SS else None, peel=0 if name in NO_PEEL else 3, holes=name in HOLES), s, size)


# ---- protagonist (native size, about 46 px tall) ----
for i, b in enumerate([(20, 25, 37, 46), (67, 25, 37, 46), (109, 25, 36, 45), (152, 25, 38, 45)]):
    spr('idle%d' % i, b)
for i, b in enumerate([(20, 76, 37, 45), (67, 76, 36, 45), (111, 76, 35, 45), (153, 76, 38, 45), (199, 76, 37, 45)]):
    spr('run%d' % i, b)
spr('jump', (19, 126, 37, 48))
spr('fall', (66, 127, 32, 46))
spr('crouch', (112, 136, 36, 45))
spr('crouch2', (157, 145, 40, 38))
spr('lunge', (17, 178, 34, 42))
for i, b in enumerate([(16, 226, 50, 50), (76, 226, 41, 48), (131, 226, 41, 48), (180, 226, 51, 48)]):
    spr('shoot%d' % i, b)
for i, b in enumerate([(19, 297, 41, 49), (69, 297, 48, 49), (134, 293, 41, 54), (190, 297, 47, 50)]):
    spr('spin%d' % i, b)
for i, b in enumerate([(19, 359, 39, 50), (73, 359, 43, 49), (134, 360, 41, 48), (187, 364, 46, 46)]):
    spr('aim%d' % i, b)

# Split the gun barrel off the body frames: the game draws it rotated toward the mouse.
# Anchor = pivot of the barrel inside the frame (right edge of the head, middle of the gun band).
GUN = {}


def split_gun(name, keep_piece=False):
    a = np.array(S[name])
    h, w = a.shape[:2]
    al = a[:, :, 3] > 40
    hr = max((np.where(al[r])[0].max() if al[r].any() else 0) for r in range(int(h * 0.18), int(h * 0.45)))
    g0, g1 = int(h * 0.45), int(h * 0.78)
    piece = a[g0:g1, hr + 1:].copy()
    rows = np.where((piece[:, :, 3] > 40).any(1))[0]
    ay = g0 + (int(rows.mean()) if len(rows) else (g1 - g0) // 2)
    a[g0:g1, hr + 1:, 3] = 0
    S[name] = Image.fromarray(a)
    GUN[name] = [int(hr + 1), int(ay)]
    if keep_piece:
        S['gun'] = Image.fromarray(piece).crop(Image.fromarray(piece).getbbox())
        bb = Image.fromarray(piece).getbbox()
        GUN["gun"] = [0, int(ay - g0 - bb[1])]  # pivot inside the barrel sprite


split_gun('idle0', True)
for n in ['idle1', 'idle2', 'idle3', 'run0', 'run1', 'run2', 'run3', 'run4', 'jump', 'fall', 'crouch', 'crouch2', 'lunge']:
    split_gun(n)


def make_walk(src='idle0', prefix='walk', n=8, stride=5, lift=2, pad=4, hipf=0.72, gun=True, sway=0, feetonly=True):
    """Walk cycle built from a single standing frame: the two legs swing like scissors (rotation
    approximated by a per-row shift growing toward the feet), the swinging leg lifts its foot,
    the body bobs."""
    base = np.array(S[src])
    h, w = base.shape[:2]
    al = base[:, :, 3] > 100
    # hip = first row of the lower part where the body narrows into the legs
    hip = int(h * hipf)
    # split column between the legs: the emptiest column in the bottom rows
    lo, hi = int(w * 0.3), int(w * 0.7)
    cols = al[h - 5:, lo:hi].sum(0)
    split = lo + int(np.argmin(cols))
    # columns that belong to the legs (those of the feet); anything else below the hip (hands)
    # moves with the body
    legcols = ndimage.binary_dilation(al[h - 4:].any(0), iterations=1) if feetonly else np.ones(w, bool)
    for k in range(n):
        ph = 2 * np.pi * k / n
        s, c = np.sin(ph), np.cos(ph)
        bob = int(round(1 - abs(s)))            # body higher when the legs pass each other
        out = np.zeros((h + 2, w + 2 * pad, 4), np.uint8)
        # upper body
        sx = int(round(sway * np.sin(ph)))     # side-to-side waddle of the upper body
        out[2 - bob:2 - bob + hip, pad + sx:pad + sx + w] = base[:hip]
        for y in range(hip, h):
            for x in np.where((base[y, :, 3] > 0) & ~legcols)[0]:
                if 0 <= y + 2 - bob < out.shape[0]:
                    out[y + 2 - bob, x + pad + sx] = base[y, x]
        # legs: back (left part) and front (right part) swing in opposite directions
        for leg, sign, up in ((0, -1, max(0.0, -c)), (1, 1, max(0.0, c))):
            for y in range(hip, h):
                t = (y - hip) / max(1, h - 1 - hip)
                dx = int(round(sign * s * stride * t))
                dy = int(round(up * lift * t))
                row = base[y].copy()
                row[~legcols, 3] = 0
                if leg == 0:
                    row[split:, 3] = 0
                else:
                    row[:split, 3] = 0
                ty = y + 2 - dy - (bob if y < hip + 2 else 0)
                for x in np.where(row[:, 3] > 0)[0]:
                    tx = x + dx + pad
                    if 0 <= tx < out.shape[1] and 0 <= ty < out.shape[0]:
                        out[ty, tx] = row[x]
        name = prefix + str(k)
        S[name] = Image.fromarray(out)
        if gun:
            GUN[name] = [GUN[src][0] + pad, GUN[src][1] + 2 - bob]


make_walk()

# ---- portals ----
spr('pblue', (276, 356, 32, 64), size=(22, 64))
spr('porange', (283, 295, 28, 57), size=(22, 64))
spr('pblue_big', (224, 226, 58, 60))
spr('porange_big', (294, 224, 44, 63))

# ---- blocks, items ----
spr('brick', (393, 29, 35, 34), size=(32, 32))
spr('brick_cracked', (431, 29, 36, 34), size=(32, 32))
spr('qblock', (469, 29, 35, 35), size=(32, 32))
spr('qblock2', (508, 29, 34, 34), size=(32, 32))
spr('metal', (546, 29, 35, 34), size=(32, 32))
spr('orb', (394, 74, 34, 34), 0.75)
spr('coin', (436, 74, 29, 34), 0.72)
spr('scoin', (511, 74, 29, 34), 0.72)
spr('key', (398, 160, 23, 39), 0.7)
spr('heart', (596, 121, 24, 26), 0.85)
spr('potion', (394, 204, 33, 35), 0.8)
spr('medkit', (433, 204, 35, 35), 0.8)
spr('ladder', (630, 161, 35, 79), size=(32, 64))

# ---- enemies ----
spr('plant0', (697, 25, 35, 46))
spr('plant1', (751, 27, 36, 43))
spr('plant2', (756, 85, 31, 46))
spr('plant_shoot', (801, 33, 45, 37))
spr('goblin0', (895, 90, 48, 41), 0.85)
spr('goblin1', (955, 84, 42, 47), 0.85)
spr('goblin2', (698, 198, 46, 43), 0.85)
spr('goblin3', (749, 195, 49, 46), 0.85)
# goblins: the standing pose with both arms down (goblin1), the brute a bigger, darker version of it
make_walk('goblin1', 'gwalk', stride=4, lift=3, pad=4, hipf=0.78, gun=False, sway=1)
_b = np.array(S['goblin1']).astype(float)
_b[:, :, 0] *= 0.62; _b[:, :, 1] *= 0.78; _b[:, :, 2] *= 0.7
S['brute_base'] = Image.fromarray(_b.clip(0, 255).astype(np.uint8)).resize((round(S['goblin1'].width * 1.15), round(S['goblin1'].height * 1.15)), Image.LANCZOS)
make_walk('brute_base', 'bwalk', stride=4, lift=3, pad=4, hipf=0.78, gun=False, sway=1)
del S['brute_base']
spr('slime0', (701, 156, 37, 29), 0.8)
spr('slime1', (805, 156, 37, 30), 0.8)
spr('slime2', (760, 144, 26, 22), 0.9)
spr('bat0', (880, 144, 64, 32), 0.75)
spr('bat1', (945, 144, 64, 32), 0.75)
spr('bateye', (944, 29, 64, 30), 0.75)
spr('eye0', (901, 202, 30, 29))
spr('eye_shoot', (961, 200, 52, 29))
spr('spitter', (698, 93, 57, 38))

# ---- boss ----
spr('boss', (380, 278, 84, 112), 1.3)
spr('boss_defeat', (793, 278, 92, 112), 1.3)
spr("boss_portal", (893, 282, 118, 104))

spr('crescent', (693, 315, 84, 72), 0.8)


# ---- richer enemy animations, generated from single frames (like the walk cycles) ----
def make_flap(src, prefix, n=8, pad=10, amp=9.0, body=6):
    """Bat wing flap: columns far from the body move up and down together (the tips most)."""
    base = np.array(S[src])
    h, w = base.shape[:2]
    cx = w / 2.0
    for k in range(n):
        ph = 2 * np.pi * k / n
        sn = np.sin(ph)
        out = np.zeros((h + 2 * pad, w, 4), np.uint8)
        bob = int(round(-1.2 * sn))              # the body dips a little when the wings go up
        for x in range(w):
            d = abs(x + 0.5 - cx)
            wing = max(0.0, d - body) / max(1.0, cx - body)
            dy = -int(round(sn * amp * wing ** 1.15)) + bob
            col = base[:, x]
            ys = np.where(col[:, 3] > 0)[0]
            for y in ys:
                ty = y + pad + dy
                if 0 <= ty < out.shape[0]:
                    out[ty, x] = col[y]
        S['%s%d' % (prefix, k)] = Image.fromarray(out)


def make_sway(src, prefix, n=8, amp=3.0, pivot=0.68, pad=4):
    """Plant sway: rows above the base bend sideways, more and more toward the top (the leaves stay put)."""
    base = np.array(S[src])
    h, w = base.shape[:2]
    for k in range(n):
        ph = 2 * np.pi * k / n
        out = np.zeros((h, w + 2 * pad, 4), np.uint8)
        for y in range(h):
            t = max(0.0, (pivot * h - y) / (pivot * h))
            dx = int(round(amp * np.sin(ph) * t ** 1.3))
            row = base[y]
            xs = np.where(row[:, 3] > 0)[0]
            for x in xs:
                tx = x + pad + dx
                if 0 <= tx < out.shape[1]:
                    out[y, tx] = row[x]
        S['%s%d' % (prefix, k)] = Image.fromarray(out)


make_flap('bat1', 'flap')
make_sway('plant0', 'psway')
make_sway('plant2', 'pasway')
make_walk('boss', 'bwk', stride=8, lift=5, pad=8, hipf=0.78, gun=False, sway=1, feetonly=False)

# ---- fx / hazards ----
spr('fireball_b', (16, 474, 75, 53), 0.42)
spr('fireball_o', (97, 478, 74, 49), 0.42)
spr('spikeball', (197, 470, 59, 61), 0.55)
spr('smoke0', (284, 478, 147, 61), 0.4)
spr('smoke1', (436, 452, 76, 87), 0.45)
spr('fire', (570, 477, 68, 61), 0.5)
spr('rocks', (676, 474, 145, 64), 0.5)
spr('hbar', (865, 441, 136, 23))

# ---- tiles from the tileset (opaque, 32x32) ----
GX = [21, 68, 115, 162, 210, 258, 306, 353, 401, 449, 496]
GY = [46, 93, 140, 187, 234, 282, 318]


def g(c, r):
    return (GX[c] + 1, GY[r] + 1, 42, 42)


T = {}
T['dirt'] = tile(g(1, 2))
T['dirt2'] = tile(g(4, 1))
T['cobble'] = tile(g(4, 2))
T['cobble_moss'] = tile(g(6, 2))
T['cobble_dark'] = tile(g(7, 1))
T['sand'] = tile(g(2, 3))
T['water'] = tile((GX[2] + 1, GY[5] + 1, 42, 31))
T['water_deep'] = tile(g(7, 6))
T['wall_red'] = tile((597, 48, 44, 40))
T['wall_grey'] = tile((648, 48, 44, 40))
T['wall_moss'] = tile((699, 48, 44, 40))
T['wall_light'] = tile((751, 48, 44, 40))
T['wood'] = tile((597, 302, 60, 30))
T['steel'] = tile((1152, 48, 38, 40))
T['steel2'] = tile((1203, 48, 40, 40))


def grass_top(base, grassbox):
    """Side view grass: bottom fringe of a top-down grass tile over a dirt tile."""
    gx, gy, gw, gh = grassbox
    gr = TS.crop((gx, gy, gx + gw, gy + gh)).resize((32, 32), Image.LANCZOS).convert('RGBA')
    out = base.copy()
    band = gr.crop((0, 14, 32, 32))  # grass then fringe then dirt edge
    out.paste(band, (0, 0))
    return out


T['grass'] = grass_top(T['dirt'], g(6, 0))
T['grass_cobble'] = grass_top(T['cobble'], g(6, 0))
T['moss_top'] = grass_top(T['cobble_dark'], g(1, 0))

# decorative cutouts from the tileset
def dec(name, box, s=1):
    S[name] = scaled(cutout(TS, box, peel=0 if name in NO_PEEL else 3), s)


dec('door', (1012, 152, 36, 61))
dec('door_wood', (1064, 47, 28, 43))
dec('chest', (891, 427, 46, 45), 0.75)
dec('chest_open', (892, 476, 45, 45), 0.75)
dec('torch', (762, 486, 12, 31))
dec('bush', (366, 429, 25, 21), 1.2)
dec('bush2', (474, 429, 24, 21), 1.2)
dec('bush3', (308, 436, 19, 14), 1.3)
dec('rock', (447, 436, 20, 14), 1.2)
dec('rocks2', (507, 427, 30, 23), 1.1)
dec('bigrock', (307, 493, 43, 29), 1.0)
dec('crate', (306, 618, 39, 36), 0.8)
dec('barrel', (305, 582, 30, 31), 0.9)
dec('sign', (402, 618, 37, 36), 0.9)
dec('fence', (258, 630, 37, 21), 1.2)
dec('pillar', (970, 151, 26, 61))
dec('window', (962, 46, 45, 44), 0.7)

# ---- "Legacy-Fantasy - High Forest" pack (img/forest): tiles, props and backgrounds ----
# The pack's tiles are 16 px; the game uses them at 2x (32 px tiles), nearest neighbour.
FO = Image.open('img/forest/Tiles.png').convert('RGBA')


def fo_cell(c, r, w=1, h=1, k=2):
    return FO.crop((c * 16, r * 16, (c + w) * 16, (r + h) * 16)).resize((w * 16 * k, h * 16 * k), Image.NEAREST)


# every non-empty 16 px cell of the terrain area (cols 0-14, rows 0-14) plus the water cells,
# named fo_<col>_<row>; the renderer autotiles from them
for r in range(15):
    for c in range(15):
        cell = fo_cell(c, r)
        if np.array(cell)[:, :, 3].any():
            S['fo_%d_%d' % (c, r)] = cell
for r in (19, 20):
    for c in range(6, 10):
        S['fo_%d_%d' % (c, r)] = fo_cell(c, r)
# props
S['fo_tuft'] = fo_cell(22, 17)
S['fo_cattail'] = fo_cell(16, 18, 1, 2, 1)
S['fo_pot'] = fo_cell(22, 19)
S['fo_pot2'] = fo_cell(24, 19)
S['fo_mushroom'] = fo_cell(15, 15)
S['fo_chest'] = fo_cell(18, 17, 2, 2, 1)
S['fo_chest_open'] = fo_cell(20, 17, 2, 2, 1)
ROCKS = Image.open('img/forest/Props-Rocks.png').convert('RGBA')
S['fo_rock'] = ROCKS.crop((211, 51, 272, 81))

# backgrounds: sky with clouds (2x, fills the view) and two rows of fir trees (1x), built by
# chaining the pack's pieces: [rise][middle][fall] hills separated by the tileable strip
os.makedirs('img', exist_ok=True)
sky = Image.open('img/forest/Background.png').convert('RGBA')
sky.resize((sky.width * 2, sky.height * 2), Image.NEAREST).save('img/bg_sky.png', optimize=True)
TB = Image.open('img/forest/Trees-Background.png').convert('RGBA')


def tree_layer(pieces, seq):
    parts = [TB.crop((x0, 0, x1 + 1, TB.height)) for x0, x1 in pieces]
    w = sum(parts[i].width for i in seq)
    out = Image.new('RGBA', (w, TB.height), (0, 0, 0, 0))
    x = 0
    for i in seq:
        out.alpha_composite(parts[i], (x, 0))
        x += parts[i].width
    return out


# pieces: 0 rise, 1 middle, 2 fall, 3 tileable strip
DARK = [(0, 95), (112, 207), (224, 350), (704, 799)]
LIGHT = [(352, 447), (464, 559), (576, 702), (800, 895)]
tree_layer(LIGHT, [3, 3, 0, 1, 2, 3, 0, 1, 1, 2, 3, 3, 3, 0, 2]).save('img/bg_far.png', optimize=True)
tree_layer(DARK, [3, 0, 1, 2, 3, 3, 3, 0, 1, 1, 2, 3, 0, 2, 3]).save('img/bg_near.png', optimize=True)
for old in ['bg_mountains', 'bg_forest', 'bg_city', 'bg_night', 'bg_cave', 'bg_tech', 'bg_castle']:
    if os.path.exists('img/%s.png' % old):
        os.remove('img/%s.png' % old)

# ---- "Sidescroller Shooter - Central City" pack (img/city), used by world 3 ----
CT = Image.open('img/city/Tiles.png').convert('RGBA')
for r in range(CT.height // 16):
    for c in range(CT.width // 16):
        cell = CT.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16))
        if np.array(cell)[:, :, 3].any():
            S2 = cell.resize((32, 32), Image.NEAREST)
            S['ct_%d_%d' % (c, r)] = S2
CP = Image.open('img/city/bg-props.png').convert('RGBA')
S['ct_moon'] = CP.crop((176, 144, 208, 176)).resize((64, 64), Image.NEAREST)
CA, CB = CP.crop((0, 0, 96, 192)), CP.crop((96, 0, 176, 192))


def skyline(seq, dark):
    w = sum(p.width if isinstance(p, Image.Image) else p for p in seq)
    out = Image.new('RGBA', (w, 192), (0, 0, 0, 0))
    x = 0
    for p in seq:
        if isinstance(p, Image.Image):
            out.alpha_composite(p, (x, 0)); x += p.width
        else:
            x += p
    a = np.array(out).astype(float)
    a[:, :, :3] *= dark
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


flipA, flipB = CA.transpose(Image.FLIP_LEFT_RIGHT), CB.transpose(Image.FLIP_LEFT_RIGHT)
skyline([CB, 50, CA, 90, flipB, 40, flipA, 70], 0.55).save('img/bg_city_far.png', optimize=True)
skyline([CA, 24, CB, 60, flipA, 30, flipB, 70], 1.0).save('img/bg_city_near.png', optimize=True)
base = Image.open('img/city/bg-base.png').convert('RGBA')
base.resize((base.width * 2, base.height * 2), Image.NEAREST).save('img/bg_city_sky.png', optimize=True)
for src, dst in (('bg-fog-mid', 'bg_fog_mid'), ('bg-fog-front', 'bg_fog_front')):
    f = Image.open('img/city/%s.png' % src).convert('RGBA')
    f.resize((f.width * 2, f.height * 2), Image.NEAREST).save('img/%s.png' % dst, optimize=True)

# city props (Props-01.png): street furniture used as decorations in world 3
PR = Image.open('img/city/Props-01.png').convert('RGBA')


def cprop(name, box, k):
    x, y, w, h = box
    im = PR.crop((x, y, x + w, y + h))
    bb = im.getbbox()
    im = im.crop(bb) if bb else im
    S[name] = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.NEAREST)


cprop('ct_p_mailbox', (0, 32, 32, 48), 1.25)
cprop('ct_p_bollard', (35, 32, 14, 32), 1.4)
cprop('ct_p_bag', (48, 4, 32, 28), 1.1)
cprop('ct_p_bag2', (32, 62, 16, 18), 1.6)
cprop('ct_p_frame', (0, 0, 48, 32), 1.0)
cprop('ct_p_barrier', (80, 176, 48, 33), 1.15)
cprop('ct_p_barrier2', (80, 191, 48, 17), 1.15)
cprop('ct_p_pole', (4, 144, 12, 80), 1.45)
cprop('ct_p_kiosk', (0, 88, 48, 56), 1.2)
cprop('ct_p_sign', (16, 177, 32, 16), 1.5)
cprop('ct_p_cam', (80, 4, 20, 28), 1.4)
for i in range(4):
    cprop('ct_p_tl%d' % i, (16 + 16 * i, 192, 16, 32), 1.6)
print('city tiles', len([k for k in S if k.startswith('ct_')]))

# ---- pack everything in one atlas ----
items = list(S.items()) + list(T.items())
items.sort(key=lambda kv: -kv[1].height)
W = 1024
x = y = rowh = 0
pos = {}
for name, img in items:
    if x + img.width + 2 > W:
        x, y, rowh = 0, y + rowh + 2, 0
    pos[name] = (x, y, img.width, img.height)
    x += img.width + 2
    rowh = max(rowh, img.height)
H = y + rowh
atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
for name, img in items:
    atlas.paste(img, pos[name][:2])
atlas.save('img/atlas.png', optimize=True)
with open('js/atlas.js', 'w') as f:
    f.write('// Generated by tools/cut.py: sprite rectangles [x, y, w, h] inside img/atlas.png\n')
    f.write('const ATLAS = ' + json.dumps(pos, separators=(',', ':')).replace('],"', '],\n"') + ';\n')
    f.write('// Gun pivot inside each player frame (the barrel itself is the "gun" sprite)\n')
    f.write('const GUN_ANCHOR = ' + json.dumps(GUN, separators=(',', ':')) + ';\n')
print('atlas', W, H, len(pos), 'sprites')

# ---- title logo: remove the white background ----
# (only when the source is present: otherwise img/title.png is kept as it is)
import os
if os.path.exists('img/title.jpg'):
    ti = Image.open('img/title.jpg').convert('RGB')
    logo = cutout(ti, (0, 0, ti.width, ti.height), thr=40)
    logo.save('img/title.png', optimize=True)
    print('title', logo.size)
else:
    print('title: img/title.jpg not found, img/title.png left untouched')

# ---- pixel mask of the player (2x2 blocks), used for the death explosion ----
with open('js/atlas.js', 'a') as f:
    a = np.array(S['idle0'])[:, :, 3] > 100
    cells = []
    for by in range(0, a.shape[0], 2):
        for bx in range(0, a.shape[1], 2):
            if a[by:by + 2, bx:bx + 2].mean() > 0.5:
                cells.append([bx, by])
    f.write('// Opaque 2x2 blocks of the idle0 frame, relative to its top-left corner\n')
    f.write('const PLAYER_PIXELS = ' + json.dumps(cells, separators=(',', ':')) + ';\n')
    print('player pixels', len(cells))
    # sampled pixels of the final boss' "defeat" sprite, every 3 px: [dx, dy, r, g, b] (the game cannot
    # read image pixels at run time: from file:// the canvas would be tainted)
    ba = np.array(S['boss_defeat'])
    bp = [[x, y, int(ba[y + 1, x + 1, 0]), int(ba[y + 1, x + 1, 1]), int(ba[y + 1, x + 1, 2])]
          for y in range(0, ba.shape[0] - 2, 3) for x in range(0, ba.shape[1] - 2, 3) if ba[y + 1, x + 1, 3] > 100]
    f.write('// Pixels of the boss_defeat sprite sampled every 3 px, used to break him into fragments\n')
    f.write('const BOSS_PIXELS = ' + json.dumps(bp, separators=(',', ':')) + ';\n')
    print('boss fragments', len(bp))

# ---- logo vortex: which cells of the "O" core get the animated vortex ----
# box 160,140 130x152 in img/title.png split in 24x28 cells (~5.4 px, the size of the logo's own pixels)
VBOX, VCOLS, VROWS = (160, 140, 130, 152), 24, 28
tl = np.array(Image.open('img/title.png').convert('RGBA')).astype(int)
bx, by, bw, bh = VBOX
mask = []
for r in range(VROWS):
    row = ''
    for c in range(VCOLS):
        x0, x1 = bx + c * bw // VCOLS, bx + (c + 1) * bw // VCOLS
        y0, y1 = by + r * bh // VROWS, by + (r + 1) * bh // VROWS
        cell = tl[y0:y1, x0:x1]
        dark = (cell[..., 3] > 200) & (cell[..., :3].sum(-1) < 170) & (cell[..., 2] >= cell[..., 0])
        # only the core: dark cells inside the ellipse of the "O" hole (not the outer outline)
        ex, ey = (c + 0.5 - VCOLS / 2) / 9.4, (r + 0.5 - (VROWS / 2 + 0.2)) / 12.4
        row += '#' if dark.mean() > 0.5 and ex * ex + ey * ey <= 1 else '.'
    mask.append(row)
with open('js/atlas.js', 'a') as f:
    f.write('// Cells of the logo "O" core covered by the animated vortex (see UI.drawVortex)\n')
    f.write('const VORTEX_MASK = ' + json.dumps(mask) + ';\n')
print('vortex cells', sum(r.count('#') for r in mask))

