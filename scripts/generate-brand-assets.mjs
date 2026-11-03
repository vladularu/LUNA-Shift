import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
// PNG renderer already pinned by the Expo image toolchain in package-lock.json.
import Jimp from "jimp-compact";

const source = resolve("assets/brand/lunashift");
const output = resolve("assets/images");
mkdirSync(output, { recursive: true });

// Keep the separate Final 20 masters byte-for-byte, including their approved scale.
copyFileSync(resolve(source, "app-icon-final-20-light.png"), resolve(output, "icon.png"));
copyFileSync(resolve(source, "app-icon-final-20-dark.png"), resolve(output, "icon-dark.png"));

const light = await Jimp.read(resolve(source, "app-icon-final-20-light.png"));
const dark = await Jimp.read(resolve(source, "app-icon-final-20-dark.png"));
await light.clone().resize(48, 48).writeAsync(resolve(output, "favicon.png"));

// Recover the antialiased LS silhouette from the separate dark icon's #10121B background.
const symbol = dark.clone();
symbol.scan(0, 0, symbol.bitmap.width, symbol.bitmap.height, function (_x, _y, offset) {
  const coverage = Math.max(0, Math.min(1, (this.bitmap.data[offset] - 16) / (255 - 16)));
  this.bitmap.data[offset] = 255;
  this.bitmap.data[offset + 1] = 255;
  this.bitmap.data[offset + 2] = 255;
  this.bitmap.data[offset + 3] = Math.round(255 * coverage);
});
await new Jimp(1024, 1024, "#000000")
  .composite(symbol, 0, 0)
  .writeAsync(resolve(output, "icon-tinted.png"));

// Adaptive icons need more margin so Android's different masks retain the entire LS.
const foreground = new Jimp(432, 432, 0x00000000).composite(
  symbol.clone().resize(288, 288),
  72,
  72,
);
await foreground.writeAsync(resolve(output, "android-icon-foreground.png"));
const monochrome = foreground.clone();
monochrome.scan(0, 0, 432, 432, function (_x, _y, offset) {
  this.bitmap.data[offset] = 0;
  this.bitmap.data[offset + 1] = 0;
  this.bitmap.data[offset + 2] = 0;
});
await monochrome.writeAsync(resolve(output, "android-icon-monochrome.png"));
await new Jimp(432, 432, "#10121B").writeAsync(resolve(output, "android-icon-background.png"));

for (const [theme, name] of [
  ["light", "splash-icon.png"],
  ["dark", "splash-icon-dark.png"],
]) {
  const logo = await Jimp.read(resolve(source, `logo-stacked-${theme}.png`));
  await logo.resize(512, Jimp.AUTO).writeAsync(resolve(output, name));
}

console.log("Generated 9 LUNA Shift assets from the supplied logos and separate Final 20 icons.");
