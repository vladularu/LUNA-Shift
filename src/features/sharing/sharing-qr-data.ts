import createQrCode from "qrcode-generator";
export function sharingQrData(url: string) {
  const qr = createQrCode(0, "M");
  qr.addData(url, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const path: string[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (qr.isDark(y, x)) path.push(`M${x + 4} ${y + 4}h1v1h-1z`);
  return { size: size + 8, path: path.join("") };
}
