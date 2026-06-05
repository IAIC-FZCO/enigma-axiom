// Render 1920x1080 scene cards for the goals-led promo video (captions baked in).
//   cd extension/scripts && node generate-video-frames.mjs
// Output: extension/brand/video/frames/card-{1..6}.png
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "brand", "video", "frames");
mkdirSync(outDir, { recursive: true });
const F = "Segoe UI, Arial, sans-serif";
const W = 1920, H = 1080;

function stars(seed, n) {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  let o = "";
  for (let i = 0; i < n; i++) o += `<circle cx="${(r()*W)|0}" cy="${(r()*H*0.95)|0}" r="${(0.7+r()*1.6).toFixed(2)}" fill="${r()>0.62?'#a78bfa':'#ffffff'}" opacity="${(0.2+r()*0.5).toFixed(2)}"/>`;
  return o;
}
function frame() {
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0c0c16"/><stop offset="0.55" stop-color="#08080f"/><stop offset="1" stop-color="#060609"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.0" r="0.9"><stop offset="0" stop-color="#7c6fe0" stop-opacity="0.20"/><stop offset="1" stop-color="#7c6fe0" stop-opacity="0"/></radialGradient>
    <linearGradient id="ink" x1="700" y1="380" x2="1220" y2="540" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#dcd6ff"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="26" flood-color="#000000" flood-opacity="0.55"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>${stars(7, 90)}`;
}
const cap = (t, sub = "") => `<text x="${W/2}" y="150" text-anchor="middle" font-family="${F}" font-weight="700" font-size="62" fill="#f2f2f6">${t}</text>${sub?`<text x="${W/2}" y="205" text-anchor="middle" font-family="${F}" font-size="28" fill="#a9a9c0">${sub}</text>`:""}`;
const pill = (x,y,w,h,fill,stroke,tc,t,fs=20,fw=700) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h/2}" fill="${fill}" stroke="${stroke}"/><text x="${x+w/2}" y="${y+h/2+fs*0.35}" text-anchor="middle" font-family="${F}" font-weight="${fw}" font-size="${fs}" fill="${tc}">${t}</text>`;
function subrow(x,y,w,label,state){
  const map={done:["#10241d","#2e9e78","#6ee7b7","done"],open:["#1a1530","#6f63c8","#b3a7f5","open"]};
  const[c1,c2,c3,lab]=map[state];
  return `<text x="${x}" y="${y+8}" font-family="${F}" font-size="27" fill="#cfcfdd">${state==='done'?'✓':'—'} ${label}</text>${pill(x+w-110,y-18,96,34,c1,c2,c3,lab,16,600)}`;
}
function tree(title, states, coverage){
  const x=560,y=300,w=820,h=520;
  let rows=""; const labels=["Survey the key papers","Verify the sources","Synthesize and write"];
  for(let i=0;i<3;i++) rows+=`<g transform="translate(${x+40},${y+150+i*72})">${subrow(0,0,w-80,labels[i],states[i])}</g>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#0e0e18" stroke="#23233a" filter="url(#sh)"/>
   <circle cx="${x+44}" cy="${y+74}" r="10" fill="${states.every(s=>s==='done')?'#34d399':'#7c6fe0'}"/>
   <text x="${x+66}" y="${y+83}" font-family="${F}" font-weight="700" font-size="30" fill="#eef0f5">${title}</text>
   ${rows}
   ${pill(x+40,y+h-86,168,50,"#1a1530","#7c6fe0","#a78bfa","E  Decompose",21)}
   <text x="${x+232}" y="${y+h-54}" font-family="${F}" font-size="23" fill="#9a9ab2">${coverage}</text>`;
}

const CARD1 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${frame()}
  ${cap("Start with a goal.")}
  <rect x="460" y="470" width="1000" height="118" rx="20" fill="#0e0e18" stroke="#2c2c46" filter="url(#sh)"/>
  <text x="500" y="544" font-family="${F}" font-size="34" fill="#e7e7f2">Write a well-sourced literature review</text>
  <rect x="1352" y="492" width="74" height="74" rx="16" fill="#1a1530" stroke="#7c6fe0"/><text x="1389" y="540" text-anchor="middle" font-family="${F}" font-weight="700" font-size="34" fill="#a78bfa">E</text>
</svg>`;
const CARD2 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${frame()}
  ${cap("ENIGMA turns it into a verified structure.")}
  ${tree("Write a well-sourced literature review", ["open","open","open"], "Coverage estimate: 80% — 1 gap flagged")}
</svg>`;
const CARD3 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${frame()}
  ${cap("Work with any AI — verify every step.")}
  <rect x="300" y="300" width="780" height="470" rx="22" fill="#0e0e18" stroke="#23233a"/>
  <circle cx="340" cy="356" r="9" fill="#7c6fe0"/><text x="362" y="364" font-family="${F}" font-size="22" fill="#9a9ab2">AI answer</text>
  <text x="340" y="436" font-family="${F}" font-size="27" fill="#cfcfdd">…introduced by Vaswani et al. (2017),</text>
  <text x="340" y="486" font-family="${F}" font-size="27" fill="#cfcfdd">which relies on self-attention.</text>
  <g filter="url(#sh)"><rect x="760" y="430" width="600" height="300" rx="20" fill="#12121e" stroke="#34406a"/>
   <circle cx="800" cy="480" r="8" fill="#a78bfa"/><text x="820" y="488" font-family="${F}" font-weight="700" font-size="23" fill="#f0f0f6">ENIGMA Axiom</text>
   ${pill(800,508,184,42,"#0c3b2e","#2e9e78","#6ee7b7","✓ Real source",20)}
   <text x="800" y="602" font-family="${F}" font-size="20" fill="#9a9ab2">Matched in Crossref</text>
   <text x="800" y="638" font-family="${F}" font-size="23" fill="#dcd6ff">“Attention Is All You Need” (2017)</text>
   <text x="800" y="690" font-family="${F}" font-size="18" fill="#7e7e96">How checked: algorithm — no AI used</text></g>
</svg>`;
const CARD4 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${frame()}
  ${cap("Never let an AI grade its own homework.")}
  <g filter="url(#sh)">${pill(660,500,600,72,"#3a2a0c","#b8862c","#fbd36b","⚠  Likely fabricated — add the DOI",26)}</g>
  <text x="${W/2}" y="640" text-anchor="middle" font-family="${F}" font-size="26" fill="#a9a9c0">We don't even trust our own AI — every claim is checked independently.</text>
</svg>`;
const CARD5 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${frame()}
  ${cap("And actually reach them.")}
  ${tree("Write a well-sourced literature review", ["done","done","done"], "Coverage: 100% — goal satisfied")}
</svg>`;
const CARD6 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${frame()}
  <text x="${W/2}" y="360" text-anchor="middle" font-family="${F}" font-weight="700" font-size="104" letter-spacing="18" fill="#f2f2f6">ENIGMA</text>
  <text x="${W/2}" y="430" text-anchor="middle" font-family="${F}" font-weight="600" font-size="44" letter-spacing="34" fill="#a78bfa">AXIOM</text>
  <text x="${W/2}" y="560" text-anchor="middle" font-family="${F}" font-weight="700" font-size="50" fill="#f2f2f6">Reach your goals with AI you can trust.</text>
  <text x="${W/2}" y="630" text-anchor="middle" font-family="${F}" font-style="italic" font-size="34" fill="#c9a84c">Per aspera ad astra.</text>
  ${pill(W/2-200,700,400,64,"#13131f","#2c2c46","#cfcfe0","Free on the Chrome Web Store",24,600)}
</svg>`;

const cards = [CARD1, CARD2, CARD3, CARD4, CARD5, CARD6];
let i = 0;
for (const svg of cards) {
  i++;
  await sharp(Buffer.from(svg), { density: 144 }).resize(W, H, { fit: "fill" }).flatten({ background: "#060609" }).png().toFile(join(outDir, `card-${i}.png`));
  console.log("card-" + i + ".png");
}
console.log("done");
