const fs = require("node:fs/promises");
const path = require("node:path");
const { createRunOncePlugin, withXcodeProject } = require("expo/config-plugins");

const WIDGET_NAME = "LUNAShiftCalendar";
const MONTH_NAME = "LUNAShiftMonth";
const MARKER = "LUNA_NATIVE_CALENDAR_RENDERER";

function swiftString(value) {
  return JSON.stringify(value).replace(/\\u([0-9a-f]{4})/gi, "\\u{$1}");
}

function widgetOptions(config) {
  const plugin = config.plugins?.find(
    (entry) => Array.isArray(entry) && entry[0] === "expo-widgets",
  );
  const widget = plugin?.[1]?.widgets?.find((entry) => entry.name === WIDGET_NAME);
  if (!widget || widget.ios === null || widget.ios?.configuration || widget.configuration) {
    throw new Error("Native LUNA widget requires the static expo-widgets calendar configuration.");
  }
  const families = widget.ios?.supportedFamilies ?? widget.supportedFamilies;
  if (JSON.stringify(families) !== JSON.stringify(["systemSmall", "systemMedium", "systemLarge"])) {
    throw new Error(
      "Native LUNA widget supports the configured small, medium and large families only.",
    );
  }
  if (widget.ios?.contentMarginsDisabled || widget.contentMarginsDisabled) {
    throw new Error("Native LUNA widget requires system content margins.");
  }
  const scheme = Array.isArray(config.scheme) ? config.scheme[0] : config.scheme;
  if (typeof scheme !== "string" || !/^[a-z][a-z0-9+.-]*$/i.test(scheme)) {
    throw new Error("Native LUNA widget needs a valid app URL scheme.");
  }
  const month = plugin[1].widgets.find((entry) => entry.name === MONTH_NAME);
  if (
    !month ||
    month.ios?.configuration ||
    JSON.stringify(month.ios?.supportedFamilies) !== JSON.stringify(["systemSmall"]) ||
    month.ios?.contentMarginsDisabled
  ) {
    throw new Error("Native LUNA widget requires the static small month configuration.");
  }
  return { ...widget, month, url: `${scheme}:///` };
}

function renderSource(template, options) {
  return template
    .replace("__LUNA_DEFAULT_URL__", swiftString(options.url))
    .replace("__LUNA_DISPLAY_NAME__", swiftString(options.displayName))
    .replace("__LUNA_DESCRIPTION__", swiftString(options.description));
}

async function replaceWidgetSource(platformProjectRoot, options) {
  const root = path.resolve(platformProjectRoot);
  if (!/^57\./.test(require("expo-widgets/package.json").version))
    throw new Error("Native LUNA widget integration requires Expo SDK 57.");
  const replacements = [];
  for (const widget of [options, options.month]) {
    const destination = path.resolve(root, "ExpoWidgetsTarget", widget.name + ".swift");
    if (!destination.startsWith(root + path.sep))
      throw new Error("Widget source escapes the iOS project.");
    const existing = await fs.readFile(destination, "utf8");
    if (
      !existing.includes(MARKER) &&
      (!existing.includes(`struct ${widget.name}: Widget`) ||
        !existing.includes("WidgetsTimelineProvider(name: name)") ||
        !existing.includes("WidgetsEntryView(entry: entry)"))
    ) {
      throw new Error(
        "Expo's generated LUNA widget source changed; refusing an incomplete native integration.",
      );
    }
    const template = await fs.readFile(
      path.join(__dirname, "luna-calendar-widget", widget.name + ".swift"),
      "utf8",
    );
    replacements.push({
      destination,
      source: renderSource(template, { ...widget, url: options.url }),
    });
  }
  for (const replacement of replacements)
    await fs.writeFile(replacement.destination, replacement.source);
}

function withNativeCalendarWidget(config) {
  const options = widgetOptions(config);
  // Dangerous mods generate the SDK target first. Replacing an existing source in
  // the Xcode-project phase preserves its existing group and Sources build entry.
  return withXcodeProject(config, async (mod) => {
    await replaceWidgetSource(mod.modRequest.platformProjectRoot, options);
    return mod;
  });
}

module.exports = createRunOncePlugin(
  withNativeCalendarWidget,
  "with-native-calendar-widget",
  "1.0.0",
);
module.exports.replaceWidgetSource = replaceWidgetSource;
module.exports.widgetOptions = widgetOptions;
module.exports.renderSource = renderSource;
