import { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import { QR_COLORS, RADII, SPACING } from "@/theme/tokens";
import { sharingQrData } from "./sharing-qr-data";

/** Local generation; the invitation never leaves the device for image rendering. */
export function SharingQr({ url }: { readonly url: string }) {
  const code = useMemo(() => sharingQrData(url), [url]);
  const { width } = useWindowDimensions();
  const side = Math.min(240, Math.max(120, width - SPACING.xl * 4 - SPACING.sm * 2));
  return (
    <View
      accessibilityLabel="Einladungs-QR-Code. Alternativ Einladung teilen."
      style={{
        alignSelf: "center",
        backgroundColor: QR_COLORS.paper,
        borderRadius: RADII.card,
        padding: SPACING.sm,
      }}
    >
      <Svg testID="sharing-qr" width={side} height={side} viewBox={`0 0 ${code.size} ${code.size}`}>
        <Path d={code.path} fill={QR_COLORS.ink} />
      </Svg>
    </View>
  );
}
