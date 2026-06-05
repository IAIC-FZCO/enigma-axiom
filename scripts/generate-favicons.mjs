// Render the ENIGMA brand mark (assets/enigma-icon.svg) into the favicon files
// the Laravel layouts already reference (favicon.svg / favicon.png / apple-touch
// / favicon.ico), written into the site's public/ root.
//
//   cd extension/scripts && npm install && node generate-favicons.mjs
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = join(here, "..", "assets", "enigma-icon.svg");
const pub = join(here, "..", "..", "public"); // Laravel public/
const svg = readFileSync(svgPath);

// SVG favicon (modern browsers)
copyFileSync(svgPath, join(pub, "favicon.svg"));
// 32x32 PNG (referenced by the <link rel=icon>)
await sharp(svg, { density: 512 }).resize(32, 32).png().toFile(join(pub, "favicon.png"));
// Apple touch icon
await sharp(svg, { density: 512 }).resize(180, 180).png().toFile(join(pub, "apple-touch-icon.png"));
// Multi-size .ico (legacy + /favicon.ico auto-fetch)
const bufs = await Promise.all(
  [16, 32, 48].map((s) => sharp(svg, { density: 512 }).resize(s, s).png().toBuffer()),
);
writeFileSync(join(pub, "favicon.ico"), await pngToIco(bufs));

console.log("favicons written to public/: favicon.svg, favicon.png, apple-touch-icon.png, favicon.ico");
