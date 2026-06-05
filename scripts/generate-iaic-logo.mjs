// Render the IAIC organization avatar (brand/iaic-logo.svg) to a square PNG.
//
//   cd extension/scripts && npm install && node generate-iaic-logo.mjs
//
// Output: extension/brand/iaic-logo-512.png  (GitHub org avatar / general use)
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "..", "brand", "iaic-logo.svg"));
const out = join(here, "..", "brand", "iaic-logo-512.png");

await sharp(svg, { density: 288 })
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log("wrote", out);
