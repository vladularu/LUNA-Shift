import { expect, it } from "vitest";
import { isSharedProfilePhoto } from "./shared-profile-photo";

function jpeg(width = 256, height = 256) {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    17,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    3,
    1,
    17,
    0,
    2,
    17,
    0,
    3,
    17,
    0,
    0xff,
    0xd9,
  ]).toString("base64");
}
it("bounds peer JPEG dimensions before the native image decoder", () => {
  expect(isSharedProfilePhoto(jpeg())).toBe(true);
  expect(isSharedProfilePhoto(jpeg(512, 512))).toBe(true);
  for (const value of [
    jpeg(513),
    jpeg(1, 65535),
    jpeg(0),
    "/9j/AA==",
    "https://example.invalid/photo.jpg",
    null,
    {},
    "/9j/" + "A".repeat(524288),
  ])
    expect(isSharedProfilePhoto(value)).toBe(false);
});
it("rejects truncated or invalid marker lengths and missing JPEG end markers", () => {
  for (const bytes of [
    [255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 217],
    [255, 216, 255, 224, 255, 255, 0, 0, 0, 0, 0, 0, 0, 255, 217],
    [255, 216, 255, 218, 0, 8, 0, 0, 0, 0, 0, 0, 0, 255, 217],
  ])
    expect(isSharedProfilePhoto(Buffer.from(bytes).toString("base64"))).toBe(false);
  expect(isSharedProfilePhoto(jpeg().slice(0, -4) + "AAAA")).toBe(false);
});
