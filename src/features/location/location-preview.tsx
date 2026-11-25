import { CORNER_CURVE, RADII } from "@/theme/tokens";
import { ActionSheetIOS, Linking, Pressable } from "react-native";

import type { EntryLocation, GeocodedEntryLocation } from "@/domain/types";
import { LocationMap } from "@/features/location/location-map";
import { usePalette } from "@/theme/palette";

export function hasLocationCoordinates(
  location: EntryLocation | null,
): location is GeocodedEntryLocation {
  return typeof location?.latitude === "number" && typeof location.longitude === "number";
}

export function LocationPreview({
  location,
  height = 126,
}: {
  readonly location: EntryLocation;
  readonly height?: number;
}) {
  const palette = usePalette();

  if (!hasLocationCoordinates(location)) return null;
  const geocodedLocation = location;

  function openMap() {
    const encodedName = encodeURIComponent(geocodedLocation.name);
    const apple = `https://maps.apple.com/?q=${encodedName}&ll=${geocodedLocation.latitude},${geocodedLocation.longitude}`;
    const google = `https://www.google.com/maps/search/?api=1&query=${geocodedLocation.latitude},${geocodedLocation.longitude}`;
    if (process.env.EXPO_OS !== "ios") {
      void Linking.openURL(google);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ["Abbrechen", "Apple Karten", "Google Maps"], cancelButtonIndex: 0 },
      (index) => {
        if (index === 1) void Linking.openURL(apple);
        if (index === 2) void Linking.openURL(google);
      },
    );
  }

  return (
    <Pressable
      accessibilityLabel={`${geocodedLocation.name} in Karten öffnen`}
      accessibilityRole="button"
      onPress={openMap}
      style={{
        borderCurve: CORNER_CURVE,
        height,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: RADII.control,
      }}
    >
      <LocationMap location={geocodedLocation} />
    </Pressable>
  );
}
