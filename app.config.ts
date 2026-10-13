import type { ConfigContext, ExpoConfig } from "expo/config";

export default function configureApp({ config }: ConfigContext): ExpoConfig {
  const design = process.env.APP_VARIANT === "design" || process.env.LUNA_DESIGN_SANDBOX === "1";
  const internal = process.env.APP_VARIANT === "internal";
  return {
    ...config,
    name: design ? "LUNA Design" : internal ? "LUNA Shift Internal" : "LUNA Shift",
    slug: config.slug ?? "pflegeshift",
    scheme: design
      ? "lunashift-design"
      : internal
        ? ["pflegeshift-internal", "lunashift-internal"]
        : ["pflegeshift", "lunashift"],
    extra: {
      ...config.extra,
      appVariant: design ? "design" : internal ? "internal" : "production",
    },
    userInterfaceStyle: "automatic",
    updates: design
      ? {
          ...config.updates,
          enabled: true,
          checkAutomatically: "ON_LOAD",
          requestHeaders: {
            ...config.updates?.requestHeaders,
            "expo-channel-name": "design-shadcn",
          },
        }
      : config.updates,
    plugins: (config.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) && plugin[0] === "expo-widgets" && !design && !internal
        ? [
            plugin[0],
            { ...plugin[1], groupIdentifier: "group.com.lunashift.app.widgets.72c9t74sn2" },
          ]
        : plugin === "expo-font"
          ? [
              "expo-font",
              {
                fonts: [
                  "./assets/fonts/inter/Inter-Regular.ttf",
                  "./assets/fonts/inter/Inter-Medium.ttf",
                  "./assets/fonts/inter/Inter-SemiBold.ttf",
                  "./assets/fonts/inter/Inter-Bold.ttf",
                  "./assets/fonts/inter/Inter-ExtraBold.ttf",
                  "./assets/fonts/inter/Inter-Italic.ttf",
                ],
              },
            ]
          : plugin,
    ),
    ios: {
      ...config.ios,
      usesAppleSignIn: true,
      bundleIdentifier: design
        ? "com.lunashift.app.design"
        : internal
          ? "com.pflegeshift.app.internal"
          : "com.lunashift.app",
    },
    android: {
      ...config.android,
      package: design
        ? "com.lunashift.app.design"
        : internal
          ? "com.pflegeshift.app.internal"
          : "com.pflegeshift.app",
    },
  };
}
