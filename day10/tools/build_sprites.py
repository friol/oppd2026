"""Build assets/sprites.png + js/atlas.js (and assets/logo.png) from the source images in assets/src.

Backgrounds are removed offline:
  * magenta sheet  -> chroma key (+ despill of the pink fringe)
  * gradient sheets -> flood fill from the crop border that follows smooth colour steps
Run from day10:  python tools/build_sprites.py   (needs Pillow only)
"""
import os
import math
import json
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'src')


def load(name):
    return Image.open(os.path.join(SRC, name)).convert('RGB')


# ---------------------------------------------------------------- background removal
def flood_cut(im, tol):
    """Keep-mask (rows of 0/1): flood the background in from the crop border."""
    W, H = im.size
    px = im.load()
    keep = [[1] * W for _ in range(H)]
    stack = [(x, 0) for x in range(W)] + [(x, H - 1) for x in range(W)]
    stack += [(0, y) for y in range(H)] + [(W - 1, y) for y in range(H)]
    for x, y in stack:
        keep[y][x] = 0
    while stack:
        x, y = stack.pop()
        c = px[x, y]
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and keep[ny][nx]:
                d = px[nx, ny]
                if abs(d[0] - c[0]) + abs(d[1] - c[1]) + abs(d[2] - c[2]) <= tol:
                    keep[ny][nx] = 0
                    stack.append((nx, ny))
    return keep


def magenta_cut(im):
    W, H = im.size
    px = im.load()
    keep = [[1] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            if r > 110 and b > 110 and r - g > 70 and b - g > 70:
                keep[y][x] = 0
    return keep


def drop_specks(keep, min_px, single=False):
    """Remove 4-connected islands smaller than min_px pixels (or all but the largest when single)."""
    H, W = len(keep), len(keep[0])
    if single:
        min_px = max(min_px, max(len(p) for p in parts(keep)))
    seen = [[0] * W for _ in range(H)]
    for y0 in range(H):
        for x0 in range(W):
            if keep[y0][x0] and not seen[y0][x0]:
                part = [(x0, y0)]
                seen[y0][x0] = 1
                i = 0
                while i < len(part):
                    x, y = part[i]
                    i += 1
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= nx < W and 0 <= ny < H and keep[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx] = 1
                            part.append((nx, ny))
                if len(part) < min_px:
                    for x, y in part:
                        keep[y][x] = 0
    return keep


def parts(keep):
    H, W = len(keep), len(keep[0])
    seen = [[0] * W for _ in range(H)]
    out = []
    for y0 in range(H):
        for x0 in range(W):
            if keep[y0][x0] and not seen[y0][x0]:
                part = [(x0, y0)]
                seen[y0][x0] = 1
                i = 0
                while i < len(part):
                    x, y = part[i]
                    i += 1
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= nx < W and 0 <= ny < H and keep[ny][nx] and not seen[ny][nx]:
                            seen[ny][nx] = 1
                            part.append((nx, ny))
                out.append(part)
    return out


def row_span(row):
    xs = [x for x, v in enumerate(row) if v]
    return (xs[0], xs[-1]) if xs else None


def fill_body(keep, frac=0.8):
    """Car only: below the body top, fill each row solid between its outer edges
    (the dark diffuser/tyres are too close to the dark background for the flood)."""
    spans = [row_span(r) for r in keep]
    widths = [s[1] - s[0] if s else 0 for s in spans]
    top = next(y for y, w in enumerate(widths) if w >= max(widths) * frac)
    for y in range(top, len(keep)):
        if spans[y]:
            for x in range(spans[y][0], spans[y][1] + 1):
                keep[y][x] = 1
    return keep


def despill(im, keep):
    px = im.load()
    for y, row in enumerate(keep):
        for x, v in enumerate(row):
            if v:
                r, g, b = px[x, y]
                lim = g + 50
                if r > lim and b > lim:
                    px[x, y] = (min(r, lim + 30), g, min(b, lim))
    return im


def to_rgba(im, keep):
    out = im.convert('RGBA')
    op = out.load()
    for y, row in enumerate(keep):
        for x, v in enumerate(row):
            if not v:
                op[x, y] = (0, 0, 0, 0)
    return out.crop(out.getbbox())


def shrink(img, f):
    """Box-filter downscale with premultiplied alpha, then a hard alpha threshold (crisp pixel edges)."""
    w, h = max(1, round(img.width * f)), max(1, round(img.height * f))
    a = img.getchannel('A')
    pm = Image.composite(img.convert('RGB'), Image.new('RGB', img.size), a)
    rgb = pm.resize((w, h), Image.BOX) if f != 1 else pm
    al = a.resize((w, h), Image.BOX) if f != 1 else a
    rp, ap = rgb.load(), al.load()
    out = Image.new('RGBA', (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            A = ap[x, y]
            if A >= 120:
                r, g, b = rp[x, y]
                k = 255 / A
                op[x, y] = (min(255, round(r * k)), min(255, round(g * k)), min(255, round(b * k)), 255)
    return out.crop(out.getbbox())


def cut_flood(sheet, box, tol=9, f=0.5, car=False, min_px=60, single=False, width=None):
    crop = sheet.crop(box)
    keep = drop_specks(flood_cut(crop, tol), min_px, single)
    if car:
        keep = fill_body(keep)
    img = to_rgba(crop, keep)
    return shrink(img, width / img.width if width else f)


def cut_magenta(sheet, box, f=1.0, single=False, tile=False):
    """tile=True also removes the dark rounded tile behind the countdown digits."""
    x0, y0, x1, y1 = box
    crop = sheet.crop((x0 - 2, y0 - 2, x1 + 3, y1 + 3))
    keep = drop_specks(magenta_cut(crop), 25, single)
    if tile:
        # flood in from the border through near-black tile pixels and the purple magenta fringe;
        # it stops at the red glow around the digit
        W, H = crop.size
        px = crop.load()

        def bg(x, y):
            r, g, b = px[x, y]
            return not keep[y][x] or max(r, g, b) < 45 or (r - g > 40 and b - g > 40 and b >= r * 0.6)
        stack = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
        seen = set(stack)
        while stack:
            x, y = stack.pop()
            keep[y][x] = 0
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen and bg(nx, ny):
                    seen.add((nx, ny))
                    stack.append((nx, ny))
        keep = drop_specks(keep, 25)
    return shrink(to_rgba(despill(crop, keep), keep), f)


# ---------------------------------------------------------------- sprite list (source pixel boxes)
TRAFFIC_F = 0.38  # ~340 px wide cars in the traffic sheets -> ~128 px

TRAFFIC_MIX = [
    (51, 33, 377, 223), (423, 33, 756, 223), (797, 26, 1117, 223), (1173, 29, 1480, 223),
    (40, 261, 386, 452), (425, 264, 755, 452), (798, 264, 1118, 454), (1166, 265, 1488, 455),
    (75, 472, 349, 706), (427, 469, 753, 706), (820, 501, 1096, 702), (1183, 503, 1472, 702),
    (42, 750, 386, 975), (438, 742, 743, 975), (828, 728, 1094, 978), (1209, 735, 1448, 972),
]

CAR_CELLS = {'car0': (0, 0), 'carBrake': (0, 1), 'carTurn': (0, 2)}

SYNTH = {
    'palm0': (18, 318, 210, 536), 'palm1': (358, 314, 543, 547), 'palm2': (560, 313, 726, 562),
    'palm3': (729, 346, 860, 560), 'palm4': (214, 351, 356, 536),
    'agave': (872, 399, 971, 489), 'shrub': (857, 508, 949, 561), 'flowerbush0': (973, 503, 1063, 561),
    'flowerbush1': (1090, 488, 1213, 561), 'fern': (469, 507, 566, 565),
    'rockBig': (1159, 355, 1390, 475), 'rockMid': (984, 382, 1143, 475), 'rockSmall': (1238, 491, 1351, 561),
    'rockFlat': (1395, 461, 1520, 518),
    'billSunset': (20, 555, 237, 691), 'billPalm': (266, 562, 399, 694), 'arrowSign': (443, 577, 613, 693),
    'route66': (647, 578, 748, 693), 'chevron': (886, 591, 970, 722), 'curveSign': (1079, 582, 1173, 722),
    'guardrail': (1302, 594, 1518, 654), 'barrier': (1302, 667, 1444, 734), 'cone': (1464, 668, 1518, 734),
    'girl': (26, 831, 89, 1007), 'guy': (101, 827, 164, 1004),
    'umbrella': (544, 866, 657, 996), 'chair': (641, 933, 733, 1002), 'flamingo': (746, 899, 805, 1000),
    'cactus': (1038, 924, 1081, 1006), 'hibiscus0': (839, 940, 914, 1007), 'hibiscus1': (941, 939, 1015, 1007),
}

SINGLE = {'umbrella', 'chair', 'palm1'}  # boxes that overlap a neighbour: keep the main part only

MAGENTA = {
    'lampA': (639, 183, 682, 304), 'lampB': (695, 183, 727, 304), 'lampTriple': (738, 180, 784, 304),
    'lampC': (804, 183, 844, 304), 'lampD': (857, 182, 892, 304),
    'treeCone': (782, 44, 826, 124), 'treeRound': (838, 39, 899, 124), 'treeBig': (1199, 35, 1259, 124),
    'treeA': (925, 37, 980, 124), 'treeB': (1150, 45, 1190, 125),
    'signLeft': (974, 181, 1013, 225), 'signRight': (1020, 181, 1064, 225),
    'boulders': (278, 358, 442, 451), 'rocks2': (156, 374, 257, 440),
}

# full-body spectators (second crowd row; the group sprite in the first row is cut at the waist)
CHEER = {
    'person0': (47, 588, 99, 665),
    'person1': (108, 588, 163, 665),
    'person2': (169, 579, 227, 665),
    'person3': (235, 586, 280, 665),
    'person4': (288, 586, 349, 665),
    'person5': (366, 588, 417, 665),
    'person6': (422, 588, 458, 665),
    'person7': (459, 588, 505, 665),
    'person8': (507, 585, 546, 665),
    'person9': (553, 588, 602, 665),
    'person10': (609, 584, 645, 665),
    'person11': (659, 591, 693, 665),
    'person12': (707, 591, 742, 665),
    'person13': (755, 589, 789, 665),
    'person14': (797, 583, 879, 665),
    'person15': (884, 588, 927, 665),
    'person16': (930, 590, 965, 665),
    'person17': (972, 582, 1012, 665),
    'person18': (1014, 585, 1052, 665),
}

BARRIER = (1196, 266, 1281, 302)  # orange-striped concrete barricade

UI = {'cd3': (551, 683, 617, 756), 'cd2': (638, 683, 704, 756), 'cd1': (725, 683, 792, 756),
      'uiGo': (842, 683, 1022, 759), 'uiCheckpoint': (1063, 699, 1393, 742)}


def build():
    S = {}
    car = load('car_rear.png')
    # straight frames are normalised to 164 px (drawn 1:1 at the player distance in the 640 px view) so switching
    # to the brake frame does not wobble; the turn frame keeps the sheet scale (~375 px -> 164 px)
    for name, (cx, cy) in CAR_CELLS.items():
        box = (cx * 512 + 4, cy * 256 + 4, cx * 512 + 508, cy * 256 + 252)
        S[name] = cut_flood(car, box, tol=8, f=164 / 375, car=True, min_px=400,
                            width=None if name == 'carTurn' else 164)
    S['carTurnR'] = mirror_keep_seats(S['carTurn'])
    for name in ('car0', 'carBrake', 'carTurn', 'carTurnR'):
        S['shadow_' + name] = ground_shadow(S[name])
        for k, im in enumerate(wheel_frames(S[name], name.startswith('carTurn'))):
            S['%s_w%d' % (name, k)] = im

    # traffic: one common scale keeps vans/trucks bigger than cars
    tr = load('traffic_sport.png')  # regular 4x4 grid of 384x256 cells
    for i in range(16):
        r, c = divmod(i, 4)
        box = (c * 384 + 4, r * 256 + 4, c * 384 + 380, r * 256 + 252)
        S['trafficA%d' % i] = cut_flood(tr, box, tol=8, f=TRAFFIC_F, car=True, min_px=400)
    tr = load('traffic_mix.png')    # rows are not on a grid: use the measured boxes
    for i, (x0, y0, x1, y1) in enumerate(TRAFFIC_MIX):
        S['trafficB%d' % i] = cut_flood(tr, (x0 - 6, y0 - 6, x1 + 7, y1 + 7), tol=8, f=TRAFFIC_F, car=True, min_px=400)

    syn = load('props_synthwave.png')
    for k, (x0, y0, x1, y1) in SYNTH.items():
        S[k] = cut_flood(syn, (x0 - 3, y0 - 3, x1 + 4, y1 + 4), tol=9, f=1, single=k in SINGLE)

    mag = load('props_magenta.jpg')
    for k, b in MAGENTA.items():
        S[k] = cut_magenta(mag, b)
    # spectators: most people in the sheet are drawn only down to the thighs, so each one is
    # composited behind a piece of race barrier that hides the cut
    barrier = cut_magenta(mag, BARRIER)
    for k, b in CHEER.items():
        S[k] = behind_barrier(cut_magenta(mag, b, single=True), barrier)
    for k, b in UI.items():      # countdown + banners, kept at full resolution for the overlay canvas
        S[k] = cut_magenta(mag, b, tile=k.startswith('cd'))
    return S


def mirror_keep_seats(car):
    """Right-turn frame from the left-turn one: mirror the car, then mirror back the cockpit band
    (everything above the rear deck) around its own centre, so the driver stays on the right and
    the passenger on the left instead of swapping seats."""
    m = car.transpose(Image.FLIP_LEFT_RIGHT)
    a = m.getchannel('A').load()
    W, H = m.size
    widths = []
    for y in range(H):
        xs = [x for x in range(W) if a[x, y]]
        widths.append((xs[-1] - xs[0]) if xs else 0)
    top = next(y for y, w in enumerate(widths) if w >= max(widths) * 0.8)  # rear deck starts here
    px = m.load()
    hair = [y for y in range(top, min(H, top + 12)) for x in range(W)   # just below the deck line,
            if a[x, y] and px[x, y][0] > 190 and px[x, y][1] > 150 and px[x, y][2] < 120]  # above the lights
    top = max(top, max(hair) + 1) if hair else top                        # include the whole ponytail
    band = m.crop((0, 0, W, top))
    bb = band.getbbox()
    people = band.crop(bb).transpose(Image.FLIP_LEFT_RIGHT)
    out = m.copy()
    out.paste((0, 0, 0, 0), (0, 0, W, top))
    out.alpha_composite(people, (bb[0], bb[1]))
    return out


WHEEL_FRAMES = 4


def wheel_frames(car, side_view):
    """WHEEL_FRAMES copies of a player frame with turning wheels.
    Rear view: the visible tyre backs (outer bottom corners, dark pixels) get tread grooves that
    scroll upwards. 3/4 view: each rim (tall cluster of light grey pixels) is rotated about its
    centre inside its perspective ellipse."""
    W, H = car.size
    src = car.load()
    frames = []
    if not side_view:
        tyre = [(x, y) for y in range(int(H * 0.6), H) for x in range(W)
                if (x < W * 0.12 or x > W * 0.88) and src[x, y][3] and max(src[x, y][:3]) < 90]
        for k in range(WHEEL_FRAMES):
            im = car.copy(); px = im.load()
            for x, y in tyre:
                r, g, b, al = src[x, y]
                ph = (y + k) % 4                           # pattern moves up as k grows
                f = 0.55 if ph == 0 else 1.45 if ph == 2 else 1.0
                px[x, y] = (min(255, int(r * f + (6 if f > 1 else 0))), min(255, int(g * f + (6 if f > 1 else 0))),
                            min(255, int(b * f + (8 if f > 1 else 0))), al)
            frames.append(im)
        return frames
    # rims: light, unsaturated pixels in the lower part, grouped into tall clusters
    light = {(x, y) for y in range(int(H * 0.4), H) for x in range(W)
             if src[x, y][3] and max(src[x, y][:3]) - min(src[x, y][:3]) < 50 and max(src[x, y][:3]) >= 0x58}
    rims, seen = [], set()
    for p0 in sorted(light):
        if p0 in seen:
            continue
        stack, pts = [p0], []
        seen.add(p0)
        while stack:
            x, y = stack.pop(); pts.append((x, y))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in light and q not in seen:
                        seen.add(q); stack.append(q)
        xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
        if max(ys) - min(ys) >= H * 0.22:
            rims.append(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2,
                         (max(xs) - min(xs)) / 2 + 1.5, (max(ys) - min(ys)) / 2 + 1))
    for k in range(WHEEL_FRAMES):
        im = car.copy(); px = im.load()
        ang = -k * (2 * math.pi / 5) / WHEEL_FRAMES          # one spoke pitch (5 spokes) per cycle
        ca, sa = math.cos(ang), math.sin(ang)
        for cx, cy, rx, ry in rims:
            for y in range(int(cy - ry), int(cy + ry) + 1):
                for x in range(int(cx - rx), int(cx + rx) + 1):
                    u, v = (x - cx) / rx, (y - cy) / ry          # ellipse -> unit circle
                    if u * u + v * v > 1 or not (0 <= x < W and 0 <= y < H):
                        continue
                    su, sv = u * ca - v * sa, u * sa + v * ca     # rotate back to sample the source
                    sx, sy = round(cx + su * rx), round(cy + sv * ry)
                    if 0 <= sx < W and 0 <= sy < H and src[sx, sy][3]:
                        px[x, y] = src[sx, sy]
        frames.append(im)
    return frames


SHADOW_M = 8  # shadow sprites are this many px wider than their car frame on each side


def ground_shadow(car):
    """Shadow sprite for a player frame: a band along the lower convex hull of the silhouette
    (the line through the tyre contact points), so it follows wheels that sit higher in the
    3/4 turning view. Same top-left as the frame, SHADOW_M px wider on both sides."""
    a = car.getchannel('A').load()
    W, H = car.size
    pts = []
    for x in range(W):
        ys = [y for y in range(H) if a[x, y]]
        if ys:
            pts.append((x, max(ys)))
    hull = []  # upper hull in y-down coords = the bottom-most chain
    for p in pts:
        while len(hull) >= 2:
            (x1, y1), (x2, y2) = hull[-2], hull[-1]
            if (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1) >= 0:
                hull.pop()
            else:
                break
        hull.append(p)

    def line_y(x):
        if x <= hull[0][0]:
            return hull[0][1]
        for (x1, y1), (x2, y2) in zip(hull, hull[1:]):
            if x1 <= x <= x2:
                return y1 + (y2 - y1) * (x - x1) / max(1, x2 - x1)
        return hull[-1][1]
    M = SHADOW_M
    x0, x1 = pts[0][0] - M + 2, pts[-1][0] + M - 2
    out = Image.new("RGBA", (W + 2 * M, H + 9))
    op = out.load()
    for x in range(x0, x1 + 1):
        edge = min(x - x0, x1 - x) / 6  # rounded ends
        up, down = round(min(1, edge) * 6), round(min(1, edge) * 8)
        gy = round(line_y(min(max(x, pts[0][0]), pts[-1][0])))
        for y in range(gy - up, gy + down + 1):
            if 0 <= y < H + 9:
                op[x + M, y] = (0, 0, 0, 255)
    return out


def behind_barrier(person, barrier, cover=0.3, below=4):
    """Person standing behind a barrier piece as wide as them, covering the lowest `cover` of their height."""
    bw, bh = person.width + 6, round(person.height * cover) + below
    bar = barrier.resize((bw, bh), Image.NEAREST)
    out = Image.new('RGBA', (bw, person.height + below))
    out.alpha_composite(person, ((bw - person.width) // 2, 0))
    out.alpha_composite(bar, (0, out.height - bh))
    return out


def base_x(im):
    """Centre of the opaque pixels in the bottom rows, as a fraction of the width (trunk/pole position)."""
    a = im.getchannel('A').load()
    xs = [x for y in range(max(0, im.height - 4), im.height) for x in range(im.width) if a[x, y]]
    return round((sum(xs) / len(xs) + 0.5) / im.width, 3) if xs else 0.5


def pack(S, width=1024):
    """Simple shelf packer, tallest first, 1 px gap."""
    x = y = shelf = 0
    pos = {}
    for k, im in sorted(S.items(), key=lambda kv: -kv[1].height):
        if x + im.width > width:
            x, y, shelf = 0, y + shelf + 1, 0
        pos[k] = [x, y, im.width, im.height, base_x(im)]
        x += im.width + 1
        shelf = max(shelf, im.height)
    atlas = Image.new('RGBA', (width, y + shelf))
    for k, im in S.items():
        atlas.paste(im, tuple(pos[k][:2]))
    return atlas, pos


if __name__ == '__main__':
    S = build()
    atlas, pos = pack(S)
    atlas.save(os.path.join(ROOT, 'assets', 'sprites.png'), optimize=True)
    with open(os.path.join(ROOT, 'js', 'atlas.js'), 'w') as f:
        f.write('// Generated by tools/build_sprites.py: name -> [x, y, w, h, base x fraction] in assets/sprites.png\n')
        f.write('const ATLAS = {\n')
        f.write(',\n'.join('  %s: %s' % (k, json.dumps(v)) for k, v in sorted(pos.items())))
        f.write('\n};\n')
    print('atlas', atlas.size, len(pos), 'sprites')
    # title logo: already transparent, just trimmed and resized for the title overlay canvas
    logo = Image.open(os.path.join(SRC, 'logo.png')).convert('RGBA')
    logo = logo.crop(logo.getbbox())
    logo = logo.resize((1400, round(logo.height * 1400 / logo.width)), Image.LANCZOS)
    logo.save(os.path.join(ROOT, 'assets', 'logo.png'), optimize=True)
    print('logo', logo.size)
