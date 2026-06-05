// Render Chrome Web Store listing graphics (screenshots + promo tiles).
// 24-bit PNG, NO alpha (CWS requirement) -> we .flatten() onto an opaque bg.
//   cd extension/scripts && npm install && node generate-store-assets.mjs
// Output: extension/brand/store/*.png
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "brand", "store");
mkdirSync(outDir, { recursive: true });
const BG = "#060609";
const FONT = "Segoe UI, Arial, sans-serif";

function stars(seed, n, w, h) {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = (r() * w).toFixed(0), y = (r() * h * 0.92).toFixed(0);
    const rad = (0.6 + r() * 1.5).toFixed(2), o = (0.22 + r() * 0.5).toFixed(2);
    const c = r() > 0.62 ? "#a78bfa" : "#ffffff";
    out += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${c}" opacity="${o}"/>`;
  }
  return out;
}
function frame(w, h) {
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${w}" y2="${h}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0c0c16"/><stop offset="0.55" stop-color="#08080f"/><stop offset="1" stop-color="#060609"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.85"><stop offset="0" stop-color="#7c6fe0" stop-opacity="0.20"/><stop offset="1" stop-color="#7c6fe0" stop-opacity="0"/></radialGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="22" flood-color="#000000" flood-opacity="0.55"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#glow)"/>
  ${stars(7, Math.round((w * h) / 24000), w, h)}`;
}
function wordmark(x, y, size, anchor = "start") {
  const gap = size * 0.5;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-weight="700" font-size="${size}" letter-spacing="${size * 0.18}" fill="#f2f2f6">ENIGMA</text>
  <text x="${anchor === "middle" ? x : x}" y="${y + size * 0.95}" text-anchor="${anchor}" font-family="${FONT}" font-weight="600" font-size="${size * 0.42}" letter-spacing="${size * 0.34}" fill="#a78bfa">AXIOM</text>`;
}
function chip(x, y, label) {
  const w = 22 + label.length * 11;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="40" rx="20" fill="#13131f" stroke="#2c2c46"/><text x="${x + w / 2}" y="${y + 26}" text-anchor="middle" font-family="${FONT}" font-size="17" fill="#cfcfe0">${label}</text></g>`;
}

const SHOT1 = `<svg width="1280" height="800" viewBox="0 0 1280 800" xmlns="http://www.w3.org/2000/svg">
  ${frame(1280, 800)}
  <text x="96" y="104" font-family="${FONT}" font-size="22" letter-spacing="4" fill="#a78bfa">INDEPENDENT VERIFICATION</text>
  <text x="94" y="172" font-family="${FONT}" font-weight="700" font-size="54" fill="#f1f1f5">Check what the AI tells you.</text>

  <g>
    <rect x="96" y="232" width="700" height="420" rx="22" fill="#0e0e18" stroke="#23233a"/>
    <circle cx="132" cy="280" r="9" fill="#7c6fe0"/><text x="152" y="287" font-family="${FONT}" font-size="20" fill="#9a9ab2">AI answer</text>
    <text x="132" y="346" font-family="${FONT}" font-size="24" fill="#cfcfdd">The Transformer architecture was introduced</text>
    <text x="132" y="384" font-family="${FONT}" font-size="24" fill="#cfcfdd">by <tspan fill="#eaeaf4">Vaswani et al. (2017)</tspan> and relies</text>
    <rect x="430" y="362" width="40" height="30" rx="8" fill="#1a1530" stroke="#7c6fe0"/><text x="450" y="383" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="18" fill="#a78bfa">E</text>
    <text x="132" y="422" font-family="${FONT}" font-size="24" fill="#cfcfdd">entirely on self-attention mechanisms.</text>
    <text x="132" y="500" font-family="${FONT}" font-size="24" fill="#cfcfdd">Reported BLEU on WMT-14 EN-DE was 28.4,</text>
    <text x="132" y="538" font-family="${FONT}" font-size="24" fill="#cfcfdd">a new state of the art at the time.</text>
  </g>

  <g filter="url(#sh)">
    <rect x="610" y="356" width="574" height="306" rx="20" fill="#12121e" stroke="#34406a"/>
    <circle cx="646" cy="402" r="8" fill="#a78bfa"/><text x="666" y="409" font-family="${FONT}" font-weight="700" font-size="22" fill="#f0f0f6">ENIGMA Axiom</text>
    <rect x="646" y="430" width="172" height="40" rx="20" fill="#0c3b2e" stroke="#2e9e78"/><text x="732" y="456" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="19" fill="#6ee7b7">✓ Real source</text>
    <text x="646" y="522" font-family="${FONT}" font-size="19" fill="#9a9ab2">Matched in Crossref</text>
    <text x="646" y="556" font-family="${FONT}" font-size="22" fill="#dcd6ff">“Attention Is All You Need” (2017)</text>
    <text x="646" y="610" font-family="${FONT}" font-size="17" fill="#7e7e96">How checked: algorithm — no AI used</text>
  </g>

  <text x="96" y="724" font-family="${FONT}" font-size="24" fill="#b9b9cb">Every citation checked against authoritative sources — never the model that wrote it.</text>
</svg>`;

const SHOT2 = `<svg width="1280" height="800" viewBox="0 0 1280 800" xmlns="http://www.w3.org/2000/svg">
  ${frame(1280, 800)}
  <text x="96" y="104" font-family="${FONT}" font-size="22" letter-spacing="4" fill="#34d399">GOAL LAYER</text>
  <text x="94" y="172" font-family="${FONT}" font-weight="700" font-size="54" fill="#f1f1f5">Turn goals into a verified structure.</text>

  <g>
    <rect x="96" y="232" width="800" height="430" rx="22" fill="#0e0e18" stroke="#23233a"/>
    <circle cx="134" cy="292" r="9" fill="#34d399"/><text x="156" y="300" font-family="${FONT}" font-weight="700" font-size="26" fill="#eef0f5">Publish a peer-reviewed paper</text>

    <text x="170" y="364" font-family="${FONT}" font-size="23" fill="#cfcfdd">— Define the research question</text>
    <rect x="690" y="344" width="92" height="30" rx="15" fill="#10241d" stroke="#2e9e78"/><text x="736" y="365" text-anchor="middle" font-family="${FONT}" font-size="15" fill="#6ee7b7">done</text>

    <text x="170" y="420" font-family="${FONT}" font-size="23" fill="#cfcfdd">— Run experiments and analysis</text>
    <rect x="690" y="400" width="92" height="30" rx="15" fill="#1a1530" stroke="#6f63c8"/><text x="736" y="421" text-anchor="middle" font-family="${FONT}" font-size="15" fill="#b3a7f5">open</text>

    <text x="170" y="476" font-family="${FONT}" font-size="23" fill="#cfcfdd">— Write and submit the manuscript</text>
    <rect x="690" y="456" width="92" height="30" rx="15" fill="#1a1530" stroke="#6f63c8"/><text x="736" y="477" text-anchor="middle" font-family="${FONT}" font-size="15" fill="#b3a7f5">open</text>

    <rect x="132" y="540" width="150" height="46" rx="12" fill="#1a1530" stroke="#7c6fe0"/><text x="207" y="569" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="20" fill="#a78bfa">E  Decompose</text>
    <text x="300" y="569" font-family="${FONT}" font-size="21" fill="#9a9ab2">Coverage estimate: 80% — 1 gap flagged</text>
  </g>

  <text x="96" y="724" font-family="${FONT}" font-size="24" fill="#b9b9cb">The “E” engine proposes the breakdown and flags what is missing.</text>
</svg>`;

const SHOT3 = `<svg width="1280" height="800" viewBox="0 0 1280 800" xmlns="http://www.w3.org/2000/svg">
  ${frame(1280, 800)}
  ${wordmark(640, 250, 72, "middle")}
  <text x="640" y="430" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="52" fill="#f2f2f6">Reach your goals with AI you can trust.</text>
  <text x="640" y="492" text-anchor="middle" font-family="${FONT}" font-size="27" fill="#a9a9c0">Independently verify ChatGPT, Claude, Gemini &amp; Deepseek.</text>
  <g>
    ${chip(430, 540, "ChatGPT")}${chip(572, 540, "Claude")}${chip(700, 540, "Gemini")}${chip(836, 540, "Deepseek")}
  </g>
  <text x="640" y="660" text-anchor="middle" font-family="${FONT}" font-style="italic" font-size="26" fill="#c9a84c">Per aspera ad astra.</text>
</svg>`;

const SMALL = `<svg width="440" height="280" viewBox="0 0 440 280" xmlns="http://www.w3.org/2000/svg">
  ${frame(440, 280)}
  ${wordmark(220, 120, 40, "middle")}
  <text x="220" y="196" text-anchor="middle" font-family="${FONT}" font-size="18" fill="#a9a9c0">Independent AI verification</text>
  <text x="220" y="232" text-anchor="middle" font-family="${FONT}" font-style="italic" font-size="16" fill="#c9a84c">Per aspera ad astra.</text>
</svg>`;

const MARQUEE = `<svg width="1400" height="560" viewBox="0 0 1400 560" xmlns="http://www.w3.org/2000/svg">
  ${frame(1400, 560)}
  ${wordmark(90, 170, 56, "start")}
  <text x="92" y="300" font-family="${FONT}" font-weight="700" font-size="46" fill="#f2f2f6">Reach your goals with AI you can trust.</text>
  <text x="94" y="352" font-family="${FONT}" font-size="24" fill="#a9a9c0">Independently verify ChatGPT, Claude, Gemini &amp; Deepseek — every step.</text>
  <text x="94" y="446" font-family="${FONT}" font-style="italic" font-size="24" fill="#c9a84c">Per aspera ad astra.</text>
  <g filter="url(#sh)">
    <rect x="1010" y="150" width="300" height="260" rx="18" fill="#12121e" stroke="#34406a"/>
    <circle cx="1044" cy="196" r="7" fill="#a78bfa"/><text x="1062" y="203" font-family="${FONT}" font-weight="700" font-size="19" fill="#f0f0f6">ENIGMA Axiom</text>
    <rect x="1044" y="224" width="156" height="38" rx="19" fill="#0c3b2e" stroke="#2e9e78"/><text x="1122" y="249" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="17" fill="#6ee7b7">✓ Real source</text>
    <text x="1044" y="312" font-family="${FONT}" font-size="17" fill="#9a9ab2">Matched in Crossref</text>
    <text x="1044" y="344" font-family="${FONT}" font-size="18" fill="#dcd6ff">Verified · no AI used</text>
  </g>
</svg>`;

const jobs = [
  ["screenshot-1-verify.png", SHOT1, 1280, 800],
  ["screenshot-2-goals.png", SHOT2, 1280, 800],
  ["screenshot-3-hero.png", SHOT3, 1280, 800],
  ["promo-small-440x280.png", SMALL, 440, 280],
  ["promo-marquee-1400x560.png", MARQUEE, 1400, 560],
];

for (const [name, svg, w, h] of jobs) {
  const buf = await sharp(Buffer.from(svg), { density: 144 })
    .resize(w, h, { fit: "fill" })
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(buf).toFile(join(outDir, name));
  const meta = await sharp(join(outDir, name)).metadata();
  console.log(`${name}  ${meta.width}x${meta.height}  channels=${meta.channels}  alpha=${meta.hasAlpha}`);
}
