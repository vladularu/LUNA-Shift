import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const native = require("../plugins/with-native-calendar-widget.js");
const sdkSource = require("expo-widgets/plugin/build/ios/withWidgetSourceFiles.js").default;
const plist = require("@expo/plist").default;
const app = require("../app.json").expo;
const widgets = app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-widgets")[1]
  .widgets;
const widget = widgets[0];

function configured(
  scheme = "pflegeshift-internal",
  bundleIdentifier = "com.pflegeshift.app.internal",
) {
  return { ...app, scheme, ios: { ...app.ios, bundleIdentifier } };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "luna-native-widget-"));
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
  assert.ok(basename(absolute).startsWith("luna-native-widget-"));
  t.after(async () => {
    // Delete only this verified, dedicated test directory with one filesystem API.
    assert.ok(
      resolve(directory) === absolute && basename(absolute).startsWith("luna-native-widget-"),
    );
    await rm(absolute, { recursive: true, force: true });
  });
  return absolute;
}

for (const [scheme, bundle, group = "group." + bundle] of [
  ["pflegeshift-internal", "com.pflegeshift.app.internal"],
  ["lunashift-design", "com.lunashift.app.design"],
  ["pflegeshift", "com.lunashift.app", "group.com.lunashift.app.widgets.72c9t74sn2"],
]) {
  test(`replaces the real SDK-generated source in the Xcode phase for ${scheme}`, async (t) => {
    const directory = await fixture(t);
    const ios = join(directory, "ios");
    let generated;
    let config = sdkSource(configured(scheme, bundle), {
      widgets,
      targetName: "ExpoWidgetsTarget",
      groupIdentifier: group,
      onFilesGenerated: (files) => {
        generated = files;
      },
    });
    config = native(config);
    const request = {
      projectRoot: directory,
      platformProjectRoot: ios,
      platformName: "ios",
      modName: "dangerous",
    };
    const result = await config.mods.ios.dangerous({ ...config, modRequest: request });
    const destination = join(ios, "ExpoWidgetsTarget", "LUNAShiftCalendar.swift");
    assert.ok((await readFile(destination, "utf8")).includes("WidgetsEntryView(entry: entry)"));
    await result.mods.ios.xcodeproj({
      ...result,
      modResults: {},
      modRequest: { ...request, modName: "xcodeproj" },
    });
    const source = await readFile(destination, "utf8");
    assert.ok(source.includes("LUNA_NATIVE_CALENDAR_RENDERER"));
    assert.ok(source.includes('lunaDefaultURL = "' + scheme + ':///"'));
    assert.ok(source.includes("LUNACalendarProvider()"));
    assert.ok(source.includes("LUNACalendarEntryView(entry: entry)"));
    assert.doesNotMatch(source, /WidgetsEntryView|AppContext|JSContext|evaluateLayout/);
    assert.doesNotMatch(source, /__LUNA_(DEFAULT_URL|DISPLAY_NAME|DESCRIPTION)__/);
    assert.ok(generated.includes(destination), "the existing Sources entry remains valid");
    const info = plist.parse(await readFile(join(ios, "ExpoWidgetsTarget", "Info.plist"), "utf8"));
    assert.equal(info.ExpoWidgetsAppGroupIdentifier, group);
    const entitlement = plist.parse(
      await readFile(join(ios, "ExpoWidgetsTarget", "ExpoWidgetsTarget.entitlements"), "utf8"),
    );
    assert.deepEqual(entitlement["com.apple.security.application-groups"], [group]);
    const index = await readFile(join(ios, "ExpoWidgetsTarget", "index.swift"), "utf8");
    assert.ok(index.includes("LUNAShiftCalendar()"));
    assert.ok(index.includes("LUNAShiftMonth()"));
    const monthSource = await readFile(
      join(ios, "ExpoWidgetsTarget", "LUNAShiftMonth.swift"),
      "utf8",
    );
    assert.ok(monthSource.includes("LUNACalendarEntryView(entry: entry, month: true)"));
    assert.ok(monthSource.includes(".supportedFamilies([.systemSmall])"));
    assert.doesNotMatch(monthSource, /WidgetsEntryView|__LUNA_/);
    assert.ok(source.includes(".supportedFamilies([.systemSmall, .systemMedium, .systemLarge])"));
    assert.ok(source.includes("Link(destination: URL(string: day.url)"));
    assert.ok(source.includes("let ownerName, ownerColor: String?"));
    await native.replaceWidgetSource(ios, native.widgetOptions(configured(scheme, bundle)));
    assert.equal(
      await readFile(destination, "utf8"),
      source,
      "repeated prebuild application is idempotent",
    );
  });
}

test("rejects missing/configurable calendars, changed families and invalid schemes", () => {
  for (const bad of [
    { ...configured(), plugins: [] },
    { ...configured(), scheme: "bad\nURL" },
    { ...configured(), plugins: [["expo-widgets", { widgets: [{ ...widget, ios: null }] }]] },
    {
      ...configured(),
      plugins: [["expo-widgets", { widgets: [{ ...widget, ios: { configuration: {} } }] }]],
    },
    {
      ...configured(),
      plugins: [
        ["expo-widgets", { widgets: [{ ...widget, ios: { supportedFamilies: ["systemSmall"] } }] }],
      ],
    },
    {
      ...configured(),
      plugins: [
        [
          "expo-widgets",
          { widgets: [{ ...widget, ios: { ...widget.ios, contentMarginsDisabled: true } }] },
        ],
      ],
    },
  ])
    assert.throws(() => native.widgetOptions(bad), /Native LUNA widget/);
});

test("fails closed rather than shipping a partially replaced or missing widget file", async (t) => {
  const directory = await fixture(t);
  const ios = join(directory, "ios");
  const config = sdkSource(configured(), {
    widgets,
    targetName: "ExpoWidgetsTarget",
    groupIdentifier: "group.test",
    onFilesGenerated: () => {},
  });
  await config.mods.ios.dangerous({
    ...config,
    modRequest: { projectRoot: directory, platformProjectRoot: ios },
  });
  const destination = join(ios, "ExpoWidgetsTarget", "LUNAShiftCalendar.swift");
  await writeFile(destination, "unexpected source");
  await assert.rejects(
    native.replaceWidgetSource(ios, native.widgetOptions(configured())),
    /source changed/,
  );
  assert.equal(await readFile(destination, "utf8"), "unexpected source");
  await assert.rejects(
    native.replaceWidgetSource(join(directory, "missing"), native.widgetOptions(configured())),
    /ENOENT/,
  );
});

test("keeps the native source and plugin in runtime fingerprinting", () => {
  const config = require("../fingerprint.config.js");
  for (const file of [
    "plugins/with-native-calendar-widget.js",
    "plugins/luna-calendar-widget/LUNAShiftCalendar.swift",
    "plugins/luna-calendar-widget/LUNAShiftMonth.swift",
  ]) {
    assert.ok(config.extraSources.some((source) => source.filePath === file));
  }
  const sdkIndex = app.plugins.findIndex(
    (entry) => Array.isArray(entry) && entry[0] === "expo-widgets",
  );
  assert.equal(app.plugins[sdkIndex + 1], "./plugins/with-native-calendar-widget");
});

test("escapes Swift literals including interpolation and Unicode control escapes", () => {
  const rendered = native.renderSource(
    "__LUNA_DEFAULT_URL__ __LUNA_DISPLAY_NAME__ __LUNA_DESCRIPTION__",
    {
      url: "pflegeshift://",
      displayName: 'Text \" \\(interpolation)',
      description: "control\u0001",
    },
  );
  assert.ok(rendered.includes('"pflegeshift://"'));
  assert.ok(rendered.includes("\\u{0001}"));
  assert.ok(rendered.includes("\\\\(interpolation)"));
});

test("validates the month source before touching the calendar source", async (t) => {
  const directory = await fixture(t),
    ios = join(directory, "ios");
  const config = sdkSource(configured(), {
    widgets,
    targetName: "ExpoWidgetsTarget",
    groupIdentifier: "group.test",
    onFilesGenerated: () => {},
  });
  await config.mods.ios.dangerous({
    ...config,
    modRequest: { projectRoot: directory, platformProjectRoot: ios },
  });
  const calendar = join(ios, "ExpoWidgetsTarget", "LUNAShiftCalendar.swift");
  const before = await readFile(calendar, "utf8");
  await writeFile(
    join(ios, "ExpoWidgetsTarget", "LUNAShiftMonth.swift"),
    "unexpected month source",
  );
  await assert.rejects(
    native.replaceWidgetSource(ios, native.widgetOptions(configured())),
    /source changed/,
  );
  assert.equal(await readFile(calendar, "utf8"), before);
});
