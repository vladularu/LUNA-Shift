import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformFileSync } from "@babel/core";

// Compile the same isolated runtime that the native extension uses. This is a
// local JS check; it does not compile Swift or claim iPhone visual acceptance.
const build = spawnSync(process.execPath, ["node_modules/expo-widgets/scripts/build-bundle.mjs"], {
  stdio: "inherit",
});
assert.equal(build.status, 0, "Widget runtime bundle must build");
const transformed = transformFileSync("src/features/widgets/calendar-widget.ios.tsx", {
  ast: true,
  code: false,
  presets: ["babel-preset-expo"],
  caller: {
    name: "metro",
    platform: "ios",
    isDev: false,
    isServer: false,
    supportsStaticESM: true,
    supportsReactCompiler: true,
  },
});
const declaration = transformed.ast.program.body.find(
  (node) =>
    node.type === "ExportNamedDeclaration" &&
    node.declaration?.declarations?.[0]?.id.name === "CalendarWidget",
);
const layoutSource = declaration?.declaration.declarations[0].init.quasis[0].value.cooked;
assert.ok(layoutSource, "Expo must serialize the widget directive");
// JavaScriptCore in the extension has no React Native globals or timers.
const context = vm.createContext({});
vm.runInContext(
  readFileSync("node_modules/expo-widgets/bundle/build/ExpoWidgets.bundle", "utf8"),
  context,
);
context.__expoWidgetLayout = vm.runInContext("(" + layoutSource + ")", context);

const colors = {
  background: "#FAFAFA",
  surface: "#EDEDEF",
  text: "#18181B",
  muted: "#5D5D66",
  today: "#18181B",
  onToday: "#FAFAFA",
};
const props = {
  state: "ready",
  url: "pflegeshift-internal:///?month=2027-01",
  todayDate: "2027-01-01",
  light: colors,
  dark: colors,
  days: Array.from({ length: 28 }, (_, i) => ({
    date: "2027-01-" + String(i + 1).padStart(2, "0"),
    shortDate: String(i + 1).padStart(2, "0") + ".01.",
    weekday: "Mo",
    url: "pflegeshift-internal:///?month=2027-01",
    shifts:
      i === 0
        ? [
            {
              label: "N",
              displayLabel: "Nacht",
              detail: "22:00",
              title: "Nacht",
              start: "22:00",
              end: "06:00",
              nextDay: true,
              color: "#123456",
              textColor: "#FFFFFF",
            },
            {
              label: "F",
              displayLabel: "Früh",
              detail: "06:00",
              title: "Früh",
              start: "06:00",
              end: "14:00",
              nextDay: false,
              color: "#F0F0F0",
              textColor: "#1C1C1E",
            },
          ]
        : [],
  })),
};
props.weekDays = props.days;
props.days = props.days.slice(0, 6);
function nodes(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (value.type) found.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => nodes(item, found));
    else if (child && typeof child === "object") nodes(child, found);
  }
  return found;
}
for (const [family, count, rows] of [
  ["systemSmall", 6, 2],
  ["systemMedium", 14, 2],
  ["systemLarge", 28, 4],
]) {
  for (const colorScheme of ["light", "dark"]) {
    for (const widgetRenderingMode of ["fullColor", "accented"]) {
      const tree = context.__expoWidgetRender(props, {
        widgetFamily: family,
        colorScheme,
        widgetRenderingMode,
      });
      const rendered = nodes(tree);
      const links = rendered.filter((node) => node.type === "LinkView");
      assert.equal(links.length, 0, "all taps use the single calendar widgetURL");
      const directRows = tree.props.children.filter((node) => node?.type === "HStackView");
      assert.equal(directRows.length, rows);
      assert.equal(directRows.flatMap((row) => row.props.children).length, count);
      assert.ok(JSON.stringify(tree).includes("Heute"));
      assert.ok(JSON.stringify(tree).includes("am Folgetag"));
      assert.ok(JSON.stringify(tree).includes("Nacht"));
      assert.ok(
        JSON.stringify(tree).includes("+1"),
        "additional own entries stay visible as a compact count",
      );
      assert.ok(JSON.stringify(tree).includes(props.url));
      assert.ok(!JSON.stringify(tree).includes("widget-day"));
      const renderedDates = directRows
        .flatMap((row) => row.props.children)
        .map((cell) => cell.props.children[0]);
      for (const date of renderedDates) {
        assert.ok(
          JSON.stringify(date).includes('"size":14'),
          "same date typography in all service families",
        );
      }
      const oldMixed = structuredClone(props);
      const shared = {
        ...oldMixed.days[0].shifts[1],
        title: "Fremder Dienst",
        displayLabel: "Fremder Dienst",
        ownerName: "Andere Person",
        ownerColor: "#0088CC",
      };
      oldMixed.days[0].shifts.unshift(shared);
      oldMixed.weekDays[0] = oldMixed.days[0];
      const ownTree = context.__expoWidgetRender(oldMixed, {
        widgetFamily: family,
        colorScheme,
        widgetRenderingMode,
      });
      assert.ok(JSON.stringify(ownTree).includes("Nacht"));
      assert.ok(
        !JSON.stringify(ownTree).includes("Fremder Dienst"),
        "legacy snapshots also prefer own shifts",
      );
      oldMixed.days[0].shifts = [
        shared,
        { ...shared, title: "Weiterer Dienst", displayLabel: "Weiterer Dienst" },
      ];
      const sharedTree = context.__expoWidgetRender(oldMixed, {
        widgetFamily: family,
        colorScheme,
        widgetRenderingMode,
      });
      assert.ok(JSON.stringify(sharedTree).includes("Fremder Dienst"));
      assert.ok(!JSON.stringify(sharedTree).includes("Weiterer Dienst"));
      assert.ok(!JSON.stringify(sharedTree).includes("+1"));
      const withAppointments = structuredClone(props);
      withAppointments.pastelColors = true;
      const day = withAppointments.days[0];
      day.shifts[0].light = {
        main: "#F4B8C5",
        detail: "#FCEBF0",
        onMain: "#171719",
        onDetail: "#171719",
      };
      day.shifts[0].dark = {
        main: "#F4B8C5",
        detail: "#67505B",
        onMain: "#171719",
        onDetail: "#FFFFFF",
      };
      day.appointments = [
        { id: "appt", title: "Kontrolle", start: "10:00", end: "11:00", nextDay: false },
        { id: "all", title: "Familientag", start: "", end: "", nextDay: false },
      ];
      day.dayLabel = "Silvester";
      day.tint = { light: "#D39A4540", dark: "#D39A4540" };
      withAppointments.weekDays[0] = day;
      const appointmentTree = context.__expoWidgetRender(withAppointments, {
        widgetFamily: family,
        colorScheme,
        widgetRenderingMode,
      });
      const text = JSON.stringify(appointmentTree);
      assert.ok(
        text.includes("Kontrolle") && text.includes("Familientag"),
        "VoiceOver retains all appointments",
      );
      assert.ok(
        text.includes("•") && text.includes("+2"),
        "a shift and appointment fit together with overflow",
      );
      assert.ok(text.includes("Silvester"));
      if (widgetRenderingMode === "fullColor") {
        assert.ok(text.includes("#F4B8C5"), "pastel main color reaches the isolated renderer");
        assert.ok(text.includes("#171719"), "pastel title uses a readable foreground");
        assert.ok(text.includes("#D39A4540"), "calendar day tint reaches the isolated renderer");
      }
      const serialized = JSON.parse(JSON.stringify(tree));
      assert.ok(serialized.props);
    }
  }
}
for (const state of ["setup", "expired"]) {
  const tree = context.__expoWidgetRender(
    { ...props, state, days: [] },
    {
      widgetFamily: "systemLarge",
      colorScheme: "light",
      widgetRenderingMode: "fullColor",
    },
  );
  assert.equal(nodes(tree).filter((node) => node.type === "LinkView").length, 0);
  assert.ok(JSON.stringify(tree).includes(props.url));
  if (state === "expired") assert.ok(JSON.stringify(tree).includes("Kalender aktualisieren"));
}
assert.doesNotThrow(() =>
  context.__expoWidgetRender(
    {},
    {
      widgetFamily: "systemMedium",
      colorScheme: "light",
      widgetRenderingMode: "fullColor",
    },
  ),
);
console.log(
  "Widget isolated runtime: 6/14/28 days, 2/2/4 rows, pastel contrast, appointments beside shifts, overflow, day tints, legacy snapshots, light/dark/tinted, calendar-only link and empty/expired states passed.",
);

const require = createRequire(import.meta.url);
for (const [variant, bundleIdentifier] of [
  ["production", "com.lunashift.app"],
  ["internal", "com.pflegeshift.app.internal"],
  ["design", "com.lunashift.app.design"],
]) {
  const configured = spawnSync(
    process.execPath,
    [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"],
    { encoding: "utf8", env: { ...process.env, APP_VARIANT: variant, LUNA_DESIGN_SANDBOX: "0" } },
  );
  assert.equal(configured.status, 0, configured.stderr);
  const config = JSON.parse(configured.stdout);
  const group =
    variant === "production"
      ? "group.com.lunashift.app.widgets.72c9t74sn2"
      : "group." + bundleIdentifier;
  assert.equal(config.ios.bundleIdentifier, bundleIdentifier);
  assert.deepEqual(config.ios.entitlements["com.apple.security.application-groups"], [group]);
  assert.equal(
    config.ios.entitlements["aps-environment"],
    undefined,
    "Offline widgets must not restore the APNs entitlement",
  );
  assert.equal(config.ios.infoPlist.ExpoWidgets_EnablePushNotifications, false);
  assert.equal(config.ios.infoPlist.ExpoWidgetsAppGroupIdentifier, group);
  const extension = config.extra.eas.build.experimental.ios.appExtensions.find(
    (entry) => entry.targetName === "ExpoWidgetsTarget",
  );
  assert.equal(extension.bundleIdentifier, bundleIdentifier + ".ExpoWidgetsTarget");
  assert.deepEqual(extension.entitlements["com.apple.security.application-groups"], [group]);
  const plugin = config.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === "expo-widgets",
  );
  assert.deepEqual(plugin[1].widgets[0].ios.supportedFamilies, [
    "systemSmall",
    "systemMedium",
    "systemLarge",
  ]);
  assert.equal(plugin[1].widgets[1].name, "LUNAShiftMonth");
  assert.deepEqual(plugin[1].widgets[1].ios.supportedFamilies, ["systemSmall"]);
}
console.log(
  "Widget config: production/internal/design App Groups and extension IDs, offline/no APNs passed.",
);
