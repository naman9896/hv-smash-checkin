// Regenerate the logo and app icons from the master logo.
// Usage: node design/make-icons.mjs design/logo-source.jpg   (uses sharp, installed with Next)
//
// The master is a red roundel on a white background. The white around the circle is made
// transparent by flood-filling near-white pixels from the image edges, so the white lettering
// inside the roundel (enclosed by red) stays white.
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const src = process.argv[2] ?? "design/logo-source.jpg";
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;

const isLight = (i) => data[i] > 215 && data[i + 1] > 215 && data[i + 2] > 215;
const seen = new Uint8Array(w * h);
const stack = [];
for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
while (stack.length) {
  const p = stack.pop();
  if (seen[p]) continue;
  seen[p] = 1;
  if (!isLight(p * 4)) continue;
  data[p * 4 + 3] = 0;
  const x = p % w;
  const y = (p - x) / w;
  if (x > 0) stack.push(p - 1);
  if (x < w - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - w);
  if (y < h - 1) stack.push(p + w);
}

// Soften the jagged edge: pixels next to the cleared area that are pale pink get partial alpha
for (let p = 0; p < w * h; p++) {
  const i = p * 4;
  if (data[i + 3] === 0) continue;
  const x = p % w;
  const nearClear = [p - 1, p + 1, p - w, p + w].some((q) => q >= 0 && q < w * h && data[q * 4 + 3] === 0 && Math.abs((q % w) - x) <= 1);
  if (nearClear && data[i + 1] > 120) data[i + 3] = Math.max(0, 255 - (data[i + 1] - 40) * 1.2);
}

const cut = sharp(data, { raw: { width: w, height: h, channels: 4 } }).png();
const trimmed = await sharp(await cut.toBuffer()).trim().png().toBuffer();

await sharp(trimmed).resize(600, 600, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile("public/logo.png");

/** Square icon: the roundel on a transparent (or solid) background with a little padding. */
async function icon(size, file, background = { r: 0, g: 0, b: 0, alpha: 0 }, pad = 0.04) {
  const inner = Math.round(size * (1 - pad * 2));
  const roundel = await sharp(trimmed).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const out = await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: roundel, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  if (file) writeFileSync(file, out);
  return out;
}

const white = { r: 255, g: 255, b: 255, alpha: 1 };
await icon(192, "public/icon-192.png", white, 0.06);
await icon(512, "public/icon-512.png", white, 0.1); // also the maskable icon: keep the roundel inside the safe zone
await icon(180, "public/apple-icon.png", white, 0.06);
await icon(180, "src/app/apple-icon.png", white, 0.06);
await icon(512, "src/app/icon.png");

// favicon.ico holding one 32×32 PNG (PNG-in-ICO is supported by every current browser)
const png32 = await icon(32, null, { r: 0, g: 0, b: 0, alpha: 0 }, 0);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6);
header.writeUInt8(32, 7);
header.writeUInt16LE(1, 12);
header.writeUInt16LE(32, 14);
header.writeUInt32LE(png32.length, 16);
header.writeUInt32LE(22, 18);
const ico = Buffer.concat([header, png32]);
writeFileSync("public/favicon.ico", ico);
writeFileSync("src/app/favicon.ico", ico);
console.log("done", w, h);
