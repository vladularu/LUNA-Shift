import { expect, it } from "vitest";
import jsQR from "jsqr";
import { sharingQrData } from "./sharing-qr-data";
it.each([
  "https://luna.example/sharing-invite?token=",
  "lunashift-internal://sharing-invite?token=",
])("decodes the actual QR geometry to the unchanged invitation %s", (prefix) => {
  const url = prefix + "ab".repeat(32);
  const code = sharingQrData(url);
  const scale = 6,
    width = code.size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const square of code.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    for (let y = 0; y < scale; y++)
      for (let x = 0; x < scale; x++) {
        const i = ((Number(square[2]) * scale + y) * width + Number(square[1]) * scale + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
  }
  expect(jsQR(pixels, width, width)?.data).toBe(url);
});
