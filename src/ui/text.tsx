import { forwardRef, type ComponentRef } from "react";
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";

import { interFontFamily } from "@/theme/shadcn";

export type Text = ComponentRef<typeof NativeText>;
export type TextInput = ComponentRef<typeof NativeTextInput>;

function fontStyle(style: TextProps["style"]): TextStyle {
  const resolved = StyleSheet.flatten(style);
  return {
    fontFamily: interFontFamily(resolved?.fontWeight, resolved?.fontStyle === "italic"),
  };
}

// Preserve native props, refs, accessibility and Dynamic Type. Legacy screen
// styles also get the matching Inter font instead of the platform default.
// The native component contract uses the same name for its value and ref type.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const Text = forwardRef<ComponentRef<typeof NativeText>, TextProps>(function DesignText(
  { style, ...props },
  ref,
) {
  return <NativeText ref={ref} {...props} style={[style, fontStyle(style)]} />;
});

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const TextInput = Object.assign(
  forwardRef<ComponentRef<typeof NativeTextInput>, TextInputProps>(function DesignTextInput(
    { style, hitSlop = 2, ...props },
    ref,
  ) {
    return (
      <NativeTextInput ref={ref} {...props} hitSlop={hitSlop} style={[style, fontStyle(style)]} />
    );
  }),
  { State: NativeTextInput.State },
);
