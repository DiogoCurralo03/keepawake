// Reproducible, dependency-free Windows tray icons (16/32/48 px).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function bitmap(size, active) {
  const rgba = Buffer.alloc(size * size * 4), samples = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const px = ((x + (sx + .5) / samples) / size - .5) * 2;
      const py = ((y + (sy + .5) / samples) / size - .5) * 2;
      let color = Math.hypot(px, py) < .94 ? (active ? [31, 37, 46, 255] : [64, 75, 91, 255]) : [0, 0, 0, 0];
      if (active) {
        const r = Math.hypot(px, py), angle = Math.atan2(py, px);
        if (r < .36 || (r > .49 && r < .70 && Math.abs(Math.sin(angle * 4)) < .24)) color = [255, 194, 66, 255];
      } else if (Math.abs(py) < .41 && ((px > -.37 && px < -.11) || (px > .11 && px < .37))) color = [227, 234, 244, 255];
      for (let i = 0; i < 4; i++) sum[i] += color[i];
    }
    for (let i = 0; i < 4; i++) rgba[(y * size + x) * 4 + i] = Math.round(sum[i] / samples ** 2);
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const dib = Buffer.alloc(40 + size * size * 4 + maskStride * size);
  dib.writeUInt32LE(40); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const from = (y * size + x) * 4, to = 40 + ((size - y - 1) * size + x) * 4;
    dib[to] = rgba[from + 2]; dib[to + 1] = rgba[from + 1]; dib[to + 2] = rgba[from]; dib[to + 3] = rgba[from + 3];
  }
  return dib;
}
const dir = fileURLToPath(new URL('../src/assets/', import.meta.url));
fs.mkdirSync(dir, { recursive: true });
for (const active of [false, true]) {
  const sizes = [16, 32, 48], bitmaps = sizes.map(size => bitmap(size, active));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => { const j = 6 + i * 16; header[j] = header[j + 1] = size; header.writeUInt16LE(1, j + 4); header.writeUInt16LE(32, j + 6); header.writeUInt32LE(bitmaps[i].length, j + 8); header.writeUInt32LE(offset, j + 12); offset += bitmaps[i].length; });
  fs.writeFileSync(path.join(dir, active ? 'active.ico' : 'inactive.ico'), Buffer.concat([header, ...bitmaps]));
}
