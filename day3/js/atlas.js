// Glyph atlas: renders the Matrix font into a GRID x GRID canvas texture.
const Atlas = (() => {
  const GRID = 8;
  const CELL = 128;
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*+';
  const FONT_URL = 'fonts/MatrixCodeNfi-YPPj.otf';

  async function loadFont() {
    try {
      const face = new FontFace('MatrixCode', `url(${FONT_URL})`);
      await face.load();
      document.fonts.add(face);
      return 'MatrixCode';
    } catch (e) {
      console.warn('Matrix font could not be loaded, falling back to monospace', e);
      return 'monospace';
    }
  }

  async function create(maxAnisotropy) {
    const family = await loadFont();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GRID * CELL;
    const g = canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);

    // Measure every glyph once so they can share a scale and be centered in their cell
    const size = 100;
    g.font = `${size}px ${family}`;
    const boxes = [...CHARS].map(ch => {
      const m = g.measureText(ch);
      return {
        left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight,
        ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent
      };
    });
    const biggest = Math.max(...boxes.map(b => Math.max(b.left + b.right, b.ascent + b.descent)));
    const scale = CELL * 0.82 / biggest;

    g.fillStyle = '#fff';
    g.font = `${size * scale}px ${family}`;
    [...CHARS].forEach((ch, i) => {
      const b = boxes[i];
      const cx = (i % GRID + 0.5) * CELL;
      const cy = (Math.floor(i / GRID) + 0.5) * CELL;
      g.fillText(ch, cx - (b.right - b.left) * scale / 2, cy + (b.ascent - b.descent) * scale / 2);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = maxAnisotropy;
    return { texture, grid: GRID, count: CHARS.length };
  }

  return { create };
})();
