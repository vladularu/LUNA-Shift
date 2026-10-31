import { useState } from "react";
import { Image, View } from "react-native";
import { usePalette } from "@/theme/palette";
import { RADII } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import Ionicons from "@/ui/icon";
import { Text } from "@/ui/text";

export function PersonAvatar({
  name,
  color,
  photoUri,
  size = 40,
  selected,
  showSelectionBadge = true,
}: {
  readonly name: string;
  readonly color: string;
  readonly photoUri?: string | null;
  readonly size?: 40 | 80 | 96;
  readonly selected?: boolean;
  readonly showSelectionBadge?: boolean;
}) {
  const palette = usePalette();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const inner = size - 8;
  const initials = name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase("de-DE");
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: RADII.pill,
        borderWidth: 2,
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
        opacity: selected === false ? 0.6 : 1,
      }}
    >
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: RADII.pill,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.surface,
        }}
      >
        {photoUri && photoUri !== failedUri ? (
          <Image
            key={photoUri}
            testID="calendar-person-photo"
            source={{ uri: photoUri }}
            resizeMode="cover"
            accessible={false}
            onError={() => setFailedUri(photoUri)}
            style={{ width: inner, height: inner }}
          />
        ) : initials ? (
          <Text
            allowFontScaling={false}
            style={{ ...(size === 40 ? TYPOGRAPHY.label : TYPOGRAPHY.hero), color: palette.text }}
          >
            {initials}
          </Text>
        ) : (
          <Ionicons name="person-outline" size={size === 40 ? 18 : 34} color={palette.text} />
        )}
      </View>
      {selected && showSelectionBadge ? (
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 14,
            height: 14,
            borderRadius: RADII.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.text,
          }}
        >
          <Ionicons name="checkmark" size={10} color={palette.surface} />
        </View>
      ) : null}
    </View>
  );
}
