import { isAccountPhoto } from "./account-photo";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Cross-account image data is untrusted: bound both encoded bytes and decoded dimensions. */
export function isSharedProfilePhoto(value: unknown): value is string {
  if (typeof value !== "string" || !isAccountPhoto(value)) return false;
  const size = (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  const byte = (offset: number) => {
    const group = Math.floor(offset / 3) * 4;
    const part = offset % 3;
    const a = BASE64.indexOf(value[group + part]);
    const b = BASE64.indexOf(value[group + part + 1]);
    return part === 0
      ? (a << 2) | (b >> 4)
      : part === 1
        ? ((a & 15) << 4) | (b >> 2)
        : ((a & 3) << 6) | b;
  };
  if (size < 15 || byte(size - 2) !== 0xff || byte(size - 1) !== 0xd9) return false;
  let offset = 2;
  while (offset + 3 < size) {
    if (byte(offset++) !== 0xff) return false;
    while (offset < size && byte(offset) === 0xff) offset++;
    const marker = byte(offset++);
    if (marker === 0xda || marker === 0xd9 || marker === 0 || marker === 0xd8) return false;
    const length = (byte(offset) << 8) | byte(offset + 1);
    if (length < 2 || offset + length > size) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || byte(offset + 2) !== 8) return false;
      const height = (byte(offset + 3) << 8) | byte(offset + 4);
      const width = (byte(offset + 5) << 8) | byte(offset + 6);
      return height > 0 && width > 0 && height <= 512 && width <= 512;
    }
    offset += length;
  }
  return false;
}
