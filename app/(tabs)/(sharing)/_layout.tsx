import { Stack } from "expo-router";
export default function SharingStack() {
  return (
    <Stack>
      <Stack.Screen name="sharing" options={{ title: "Teilen" }} />
    </Stack>
  );
}
