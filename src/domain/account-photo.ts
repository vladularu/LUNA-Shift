/** Small JPEG carried by the private cloud document, never a public URL. */
export const ACCOUNT_PHOTO_MAX_BASE64 = 512 * 1024;

export function isAccountPhoto(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= ACCOUNT_PHOTO_MAX_BASE64 &&
      value.length % 4 === 0 &&
      /^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value))
  );
}
