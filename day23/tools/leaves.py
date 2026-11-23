# Builds img/leaves.png (colour) and img/leaves_n.png (normals), atlases of
# autumn leaves, from the CC0 leaf sets of ambientCG (https://ambientcg.com,
# LeafSet027 and LeafSet028, 1K-PNG).
#
# Usage: python tools/leaves.py <LeafSet027 folder> <LeafSet028 folder>
# Each folder holds the extracted zip (…_Color.png, …_Opacity.png and
# …_NormalGL.png). Every leaf is cut out by its opacity, turned so the stem
# points down, scaled into a CELL x CELL square and packed into a grid; the
# normal map gets the same crop and turn (its vectors turned as well).
# js/leafatlas.js carries both atlases as data URIs and the grid size.
import sys, os, io, base64
import numpy as np
from PIL import Image
from scipy import ndimage

CELL = 160
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'img', 'leaves.png')
OUT_N = os.path.join(ROOT, 'img', 'leaves_n.png')
# The same atlases embedded in a script as WebP data URIs: WebGL cannot use
# images loaded from file:// (they count as cross-origin), data URIs work.
OUT_JS = os.path.join(ROOT, 'js', 'leafatlas.js')


def load(folder):
    name = [f for f in os.listdir(folder) if f.endswith('_Color.png')][0]
    color = Image.open(os.path.join(folder, name)).convert('RGB')
    alpha = Image.open(os.path.join(folder, name.replace('_Color', '_Opacity'))).convert('L').resize(color.size)
    normal = Image.open(os.path.join(folder, name.replace('_Color', '_NormalGL'))).convert('RGB').resize(color.size)
    color.putalpha(alpha)
    return color, normal


def turn_normals(img, turn):
    """Rotates a GL normal map image by `turn` degrees counter-clockwise,
    turning the vectors too (x right, y up)."""
    if not turn:
        return img
    img = img.rotate(turn, expand=True, resample=Image.BICUBIC, fillcolor=(128, 128, 255))
    a = np.asarray(img).astype(np.float32) / 127.5 - 1
    c, s = np.cos(np.radians(turn)), np.sin(np.radians(turn))
    x, y = a[:, :, 0].copy(), a[:, :, 1].copy()
    a[:, :, 0] = c * x - s * y
    a[:, :, 1] = s * x + c * y
    return Image.fromarray(np.clip((a + 1) * 127.5, 0, 255).astype(np.uint8))


def leaves_of(pair, turn, grow):
    img, nrm = pair
    a = np.array(img)[:, :, 3] > 24
    # Join each blade with its thin stem before labelling.
    labels, n = ndimage.label(ndimage.binary_dilation(a, iterations=grow))
    out = []
    for sl in ndimage.find_objects(labels):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h * w < 2000:
            continue
        box = (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)
        leaf, leafn = img.crop(box), nrm.crop(box)
        if turn:
            leaf = leaf.rotate(turn, expand=True, resample=Image.BICUBIC)
            leafn = turn_normals(leafn, turn)
        out.append((leaf, leafn))
    return out


def bleed(arr, alpha, sigma, flat=None):
    """Fills transparent pixels with nearby colours (or a flat value), so
    filtering never pulls in dark or wrong fringes."""
    a = alpha[:, :, None]
    if flat is not None:
        return np.where(a > 0.5, arr, np.array(flat, np.float32))
    blur_rgb = ndimage.gaussian_filter(arr * a, (sigma, sigma, 0))
    blur_a = ndimage.gaussian_filter(a, (sigma, sigma, 0))
    return np.where(a > 0.5, arr, blur_rgb / np.maximum(blur_a, 1e-4))


def to_data(img, quality):
    buf = io.BytesIO()
    img.save(buf, 'WEBP', quality=quality, method=6)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def main():
    if len(sys.argv) < 3:
        print('usage: leaves.py <set027> <set028>')
        sys.exit(1)
    leaves = leaves_of(load(sys.argv[1]), 0, 4)     # stems already point down
    leaves += leaves_of(load(sys.argv[2]), 90, 1)   # stems point left: turn them down (tightly packed)
    cols = int(np.ceil(np.sqrt(len(leaves))))
    rows = int(np.ceil(len(leaves) / cols))
    atlas = Image.new('RGBA', (cols * CELL, rows * CELL), (0, 0, 0, 0))
    natlas = Image.new('RGB', (cols * CELL, rows * CELL), (128, 128, 255))
    for i, (leaf, leafn) in enumerate(leaves):
        s = (CELL - 8) / max(leaf.size)
        size = (max(1, round(leaf.width * s)), max(1, round(leaf.height * s)))
        leaf, leafn = leaf.resize(size, Image.LANCZOS), leafn.resize(size, Image.LANCZOS)
        x = (i % cols) * CELL + (CELL - leaf.width) // 2
        y = (i // cols) * CELL + (CELL - leaf.height) // 2
        atlas.alpha_composite(leaf, (x, y))
        natlas.paste(leafn, (x, y))
    arr = np.array(atlas).astype(np.float32)
    alpha = arr[:, :, 3] / 255
    arr[:, :, :3] = bleed(arr[:, :, :3], alpha, 6)
    final = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    final.save(OUT, optimize=True)
    narr = bleed(np.array(natlas).astype(np.float32), alpha, 0, flat=(128, 128, 255))
    nfinal = Image.fromarray(np.clip(narr, 0, 255).astype(np.uint8))
    nfinal.save(OUT_N, optimize=True)
    data, ndata = to_data(final, 86), to_data(nfinal, 90)
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/leaves.py from img/leaves.png and img/leaves_n.png:\n')
        f.write('// autumn leaves from ambientCG (LeafSet027, LeafSet028), CC0. Do not edit by hand.\n')
        f.write('window.LEAF_GRID = { cols: %d, rows: %d, count: %d };\n' % (cols, rows, len(leaves)))
        f.write("window.LEAF_ATLAS = 'data:image/webp;base64,%s';\n" % data)
        f.write("window.LEAF_NORMAL = 'data:image/webp;base64,%s';\n" % ndata)
    print('leaves:', len(leaves), 'grid:', cols, 'x', rows, '+ leafatlas.js',
          (len(data) + len(ndata)) // 1024, 'KB')


if __name__ == '__main__':
    main()
