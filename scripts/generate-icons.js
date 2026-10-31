const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createIconPNG(size) {
  const width = size;
  const height = size;
  const rowBytes = width * 4 + 1;
  const buffer = Buffer.alloc(rowBytes * height);

  // Background color: #002f6c (0, 47, 108)
  // Yellow accent: #ffcc00 (255, 204, 0)
  // White: (255, 255, 255)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    buffer[rowOffset] = 0; // Filter: none

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Rounded rectangle distance
      const r = size * 0.22;
      const dx = Math.max(Math.abs(x - width / 2) - (width / 2 - r), 0);
      const dy = Math.max(Math.abs(y - height / 2) - (height / 2 - r), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > r) {
        // Transparent outside rounded corners
        buffer[pxOffset] = 0;
        buffer[pxOffset + 1] = 0;
        buffer[pxOffset + 2] = 0;
        buffer[pxOffset + 3] = 0;
        continue;
      }

      // Default background: Royal Blue #002f6c
      let red = 0;
      let green = 47;
      let blue = 108;
      let alpha = 255;

      // Euro/Calculator badge top-right circle
      const badgeCenterX = width * 0.75;
      const badgeCenterY = height * 0.28;
      const badgeR = size * 0.22;
      const badgeDist = Math.hypot(x - badgeCenterX, y - badgeCenterY);

      if (badgeDist <= badgeR) {
        // Yellow badge
        red = 255;
        green = 204;
        blue = 0;

        // Border
        if (badgeDist >= badgeR - Math.max(1, size * 0.03)) {
          red = 255;
          green = 255;
          blue = 255;
        }
      } else {
        // Car body simplified representation
        const nx = x / width;
        const ny = y / height;

        // Lower body
        if (nx >= 0.2 && nx <= 0.8 && ny >= 0.6 && ny <= 0.8) {
          red = 255;
          green = 255;
          blue = 255;
        }
        // Cabin
        if (nx >= 0.32 && nx <= 0.68 && ny >= 0.44 && ny <= 0.6) {
          red = 255;
          green = 255;
          blue = 255;
        }
        // Wheels
        if ((Math.hypot(nx - 0.35, ny - 0.8) <= 0.09) || (Math.hypot(nx - 0.65, ny - 0.8) <= 0.09)) {
          red = 20;
          green = 20;
          blue = 30;
        }
      }

      buffer[pxOffset] = red;
      buffer[pxOffset + 1] = green;
      buffer[pxOffset + 2] = blue;
      buffer[pxOffset + 3] = alpha;
    }
  }

  const idatData = zlib.deflateSync(buffer);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const sizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

sizes.forEach((s) => {
  const png = createIconPNG(s);
  const filePath = path.join(iconsDir, `icon-${s}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
});
