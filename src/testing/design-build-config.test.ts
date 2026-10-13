import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import configureApp from "../../app.config";

const original = JSON.parse(readFileSync("app.json", "utf8")).expo;
const profiles = JSON.parse(readFileSync("eas.json", "utf8"));

function configFor(variant: string, designSandbox = false) {
  const previous = process.env.APP_VARIANT;
  const previousSandbox = process.env.LUNA_DESIGN_SANDBOX;
  process.env.APP_VARIANT = variant;
  if (designSandbox) process.env.LUNA_DESIGN_SANDBOX = "1";
  else delete process.env.LUNA_DESIGN_SANDBOX;
  try {
    return configureApp({ config: structuredClone(original) } as Parameters<
      typeof configureApp
    >[0]);
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previous;
    if (previousSandbox === undefined) delete process.env.LUNA_DESIGN_SANDBOX;
    else process.env.LUNA_DESIGN_SANDBOX = previousSandbox;
  }
}

describe("isolated iPhone design build", () => {
  it("uses an independent app identity and its own OTA channel", () => {
    const design = configFor("design");
    const preview = configFor("internal");
    const production = configFor("production");
    expect(design.ios?.bundleIdentifier).toBe("com.lunashift.app.design");
    expect(
      new Set([
        design.ios?.bundleIdentifier,
        preview.ios?.bundleIdentifier,
        production.ios?.bundleIdentifier,
      ]).size,
    ).toBe(3);
    expect(design.name).toBe("LUNA Design");
    expect(design.scheme).toBe("lunashift-design");
    expect(design.updates?.enabled).toBe(true);
    expect(design.updates?.checkAutomatically).toBe("ON_LOAD");
    expect(design.updates?.url).toBe(original.updates.url);
    expect(design.updates?.requestHeaders?.["expo-channel-name"]).toBe("design-shadcn");
    expect(design.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(design.userInterfaceStyle).toBe("automatic");
    expect(profiles.build.design.channel).toBe("design-shadcn");
    expect(profiles.build.design.distribution).toBe("internal");
    expect(profiles.build.design.env.APP_VARIANT).toBe("design");
    expect(profiles.build.design.env.LUNA_DESIGN_SANDBOX).toBe("1");
    expect(profiles.build.design.autoIncrement).toBe(true);
    expect(
      new Set([
        profiles.build.design.channel,
        profiles.build.preview.channel,
        profiles.build.production.channel,
      ]).size,
    ).toBe(3);
  });

  it("keeps the Design OTA configuration when the shared cloud environment selects internal", () => {
    expect(configFor("internal", true)).toEqual(configFor("design", true));
  });

  it("preserves Preview and Production identity and OTA routing", () => {
    for (const [variant, name, scheme, id] of [
      ["internal", "LUNA Shift Internal", "pflegeshift-internal", "com.pflegeshift.app.internal"],
      ["production", "LUNA Shift", "pflegeshift", "com.lunashift.app"],
    ]) {
      const config = configFor(variant);
      expect(config.name).toBe(name);
      expect(config.scheme).toEqual([
        scheme,
        variant === "internal" ? "lunashift-internal" : "lunashift",
      ]);
      expect(config.ios?.bundleIdentifier).toBe(id);
      expect(config.updates).toEqual(original.updates);
      const otherPlugins = (value: typeof config) =>
        value.plugins?.filter((plugin) => !(Array.isArray(plugin) && plugin[0] === "expo-widgets"));
      expect(otherPlugins(config)).toEqual(otherPlugins(configFor("design")));
      expect(config.userInterfaceStyle).toBe("automatic");
    }
    expect(profiles.build.preview.channel).toBe("preview");
    expect(profiles.build.production.channel).toBe("production");
    expect(profiles.build.preview.env).not.toHaveProperty("LUNA_DESIGN_SANDBOX");
  });

  it("isolates the registered TestFlight widget App Group from the internal and design apps", () => {
    for (const variant of ["internal", "design", "production", ""]) {
      const options = configFor(variant).plugins?.find(
        (plugin) => Array.isArray(plugin) && plugin[0] === "expo-widgets",
      ) as [string, Record<string, unknown>];
      const originalOptions = original.plugins.find(
        (plugin: string | [string, unknown]) =>
          Array.isArray(plugin) && plugin[0] === "expo-widgets",
      )[1];
      expect(options[1]).toEqual(
        variant === "production" || variant === ""
          ? { ...originalOptions, groupIdentifier: "group.com.lunashift.app.widgets.72c9t74sn2" }
          : originalOptions,
      );
    }
  });

  it("embeds every required Inter face as a non-empty local font asset", () => {
    const plugin = configFor("design").plugins?.find(
      (item) => Array.isArray(item) && item[0] === "expo-font",
    );
    expect(Array.isArray(plugin)).toBe(true);
    const paths = (plugin as [string, { fonts: string[] }])[1].fonts;
    expect(paths).toHaveLength(6);
    for (const font of paths) {
      const bytes = readFileSync(font);
      expect(bytes.length).toBeGreaterThan(100_000);
      expect(bytes.readUInt32BE(0)).toBe(0x00010000);
    }
  });
});
