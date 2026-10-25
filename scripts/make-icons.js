// Generates the PWA icons (green tile with a gold crescent) with no image dependencies.
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function png(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2, R = size * (maskable ? 0.17 : 0.215); // the crescent sits inside the tile with room around it, as app icons do
  const ox = R * 0.3; // a crescent's weight leans to its outer edge, so it is moved right to look centred
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const d = Math.hypot(x - c, y - c) / size;
    let rgb = [11 + d * 30, 107 - d * 40, 74 - d * 20]; // soft radial green
    const outer = Math.hypot(x - (c + ox), y - c) <= R * 1.6;
    const cut = Math.hypot(x - (c + ox + R * 0.75), y - (c - R * 0.15)) <= R * 1.4;
    if (outer && !cut) rgb = [244, 200, 80];
    px.set([...rgb.map(Math.round), 255], i);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, false));
writeFileSync('public/icons/icon-512.png', png(512, false));
writeFileSync('public/icons/maskable-512.png', png(512, true));
console.log('icons written');
