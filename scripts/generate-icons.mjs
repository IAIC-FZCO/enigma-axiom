// Render the ENIGMA brand icon (assets/enigma-icon.svg) to the PNG sizes the
// Chrome extension + Web Store require. Crisp at every size via high-density
// rasterization, then downscale.
//
//   cd extension/scripts && npm install && node generate-icons.mjs
//
// Outputs: extension/public/icons/icon-{16,32,48,128}.png
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "..", "assets", "enigma-icon.svg"));
const outDir = join(here, "..", "public", "icons");

for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, `icon-${size}.png`));
  console.log(`wrote icon-${size}.png`);
}
