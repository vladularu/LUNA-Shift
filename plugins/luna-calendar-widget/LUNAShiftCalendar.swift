// LUNA_NATIVE_CALENDAR_RENDERER
// Draw the privacy-safe local snapshot directly; never evaluate app JavaScript.
import Foundation
import SwiftUI
import UIKit
import WidgetKit

private let lunaWidgetKind = "LUNAShiftCalendar"
private let lunaDefaultURL = __LUNA_DEFAULT_URL__

struct LUNAShiftCalendar: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: lunaWidgetKind, provider: LUNACalendarProvider()) { entry in
      LUNACalendarEntryView(entry: entry)
    }
    .configurationDisplayName(__LUNA_DISPLAY_NAME__)
    .description(__LUNA_DESCRIPTION__)
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct LUNAWidgetPalette: Decodable, Sendable {
  let background, surface, text, muted, today, onToday: String
  let separator: String?
  static func fallback(dark: Bool) -> Self {
    dark
      ? Self(background: "#09090B", surface: "#27272A", text: "#FAFAFA", muted: "#A1A1AA", today: "#FAFAFA", onToday: "#18181B", separator: nil)
      : Self(background: "#F4F4F5", surface: "#F4F4F5", text: "#18181B", muted: "#71717A", today: "#18181B", onToday: "#FAFAFA", separator: nil)
  }
}

struct LUNAChipPalette: Decodable, Sendable {
  let main, detail, onMain, onDetail: String
}

struct LUNAChipStyle: Decodable, Sendable {
  let radius, rowHeight, fontSize: Double
  let textColor: String
  static let fallback = Self(radius: 2, rowHeight: 17, fontSize: 12, textColor: "#FFFFFF")
}

struct LUNAWidgetShift: Decodable, Sendable {
  let id: String?
  var stableID: String { id ?? "\(title)_\(start)_\(end)_\(color)" }
  let label, title, start, end, color, textColor: String
  let nextDay: Bool
  // Optional fields keep the already-published Build-38 timeline readable.
  let displayLabel, symbol, detail: String?
  let ownerName, ownerColor: String?
  let light, dark: LUNAChipPalette?
}

struct LUNAWidgetDay: Decodable, Identifiable, Sendable {
  let date, weekday, shortDate, url: String
  let shifts: [LUNAWidgetShift]
  let weekdayIndex, weekNumber: Int?
  var id: String { date }
  var dayNumber: String { Int(date.suffix(2)).map { String($0) } ?? shortDate }
}

struct LUNAWidgetData: Decodable, Sendable {
  let days: [LUNAWidgetDay]
  let weekDays, monthDays: [LUNAWidgetDay]?
  let todayDate, month, monthTitle: String?
  let state, url: String
  let light, dark: LUNAWidgetPalette
  let themeMode, backgroundFileName: String?
  let backgroundOpacity: Double?
  let chipStyle: LUNAChipStyle?

  static let empty = Self(days: [], weekDays: nil, monthDays: nil, todayDate: nil, month: nil, monthTitle: nil, state: "setup", url: lunaDefaultURL,
                          light: .fallback(dark: false), dark: .fallback(dark: true),
                          themeMode: nil, backgroundFileName: nil, backgroundOpacity: nil, chipStyle: nil)
  var destination: URL { URL(string: url) ?? URL(string: lunaDefaultURL)! }
  func usesDark(systemDark: Bool) -> Bool {
    themeMode == "dark" || (themeMode != "light" && systemDark)
  }
}

struct LUNACalendarEntry: TimelineEntry, Sendable {
  let date: Date
  let data: LUNAWidgetData
  let imageData: Data?
}

struct LUNACalendarProvider: TimelineProvider {
  func placeholder(in context: Context) -> LUNACalendarEntry {
    LUNACalendarEntry(date: Date(), data: .empty, imageData: nil)
  }
  func getSnapshot(in context: Context, completion: @escaping @Sendable (LUNACalendarEntry) -> Void) {
    let now = Date()
    let current = entries().last(where: { $0.date <= now })
    completion(current ?? LUNACalendarEntry(date: now, data: .empty, imageData: nil))
  }
  func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<LUNACalendarEntry>) -> Void) {
    let saved = entries()
    let timeline = saved.isEmpty ? [LUNACalendarEntry(date: Date(), data: .empty, imageData: nil)] : saved
    completion(Timeline(entries: timeline, policy: .atEnd))
  }
  private func entries() -> [LUNACalendarEntry] {
    guard let identifier = Bundle.main.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String,
          let defaults = UserDefaults(suiteName: identifier),
          let saved = defaults.array(forKey: "__expo_widgets_\(lunaWidgetKind)_timeline") else { return [] }
    var images: [String: Data] = [:]
    return saved.compactMap { value -> LUNACalendarEntry? in
      guard let entry = value as? [String: Any],
            let timestamp = entry["timestamp"] as? NSNumber,
            timestamp.doubleValue.isFinite,
            let props = entry["props"] as? [String: Any],
            JSONSerialization.isValidJSONObject(props),
            let json = try? JSONSerialization.data(withJSONObject: props),
            let data = try? JSONDecoder().decode(LUNAWidgetData.self, from: json) else { return nil }
      var imageData: Data?
      if let name = data.backgroundFileName {
        if let cached = images[name] { imageData = cached }
        else if let loaded = photo(name: name, group: identifier) {
          images[name] = loaded
          imageData = loaded
        }
      }
      return LUNACalendarEntry(date: Date(timeIntervalSince1970: timestamp.doubleValue / 1000), data: data, imageData: imageData)
    }.sorted { $0.date < $1.date }
  }
  private func photo(name: String, group: String) -> Data? {
    guard name.range(of: "^luna-widget-calendar-[a-z0-9-]+\\.jpg$", options: .regularExpression) != nil,
          let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
    let file = root.appendingPathComponent("ExpoWidgets", isDirectory: true).appendingPathComponent(name)
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
          let size = attributes[.size] as? NSNumber, size.intValue > 0, size.intValue <= 8 * 1024 * 1024 else { return nil }
    return try? Data(contentsOf: file, options: .mappedIfSafe)
  }
}

struct LUNACalendarEntryView: View {
  @Environment(\.colorScheme) private var colorScheme
  let entry: LUNACalendarEntry
  var month = false
  var body: some View {
    if #available(iOS 17.0, *) {
      LUNAModernCalendarView(entry: entry, month: month)
    } else {
      let dark = entry.data.usesDark(systemDark: colorScheme == .dark)
      let palette = dark ? entry.data.dark : entry.data.light
      LUNACalendarContent(data: entry.data, palette: palette, dark: dark, tinted: false, month: month)
        .padding(16)
        .background(LUNAWidgetBackground(entry: entry, palette: palette, tinted: false))
        .widgetURL(entry.data.destination)
    }
  }
}

@available(iOS 17.0, *)
struct LUNAModernCalendarView: View {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetRenderingMode) private var renderingMode
  let entry: LUNACalendarEntry
  var month = false
  var body: some View {
    let dark = entry.data.usesDark(systemDark: colorScheme == .dark)
    let palette = dark ? entry.data.dark : entry.data.light
    let tinted = renderingMode != .fullColor
    LUNACalendarContent(data: entry.data, palette: palette, dark: dark, tinted: tinted, month: month)
      .containerBackground(for: .widget) { LUNAWidgetBackground(entry: entry, palette: palette, tinted: tinted) }
      .widgetURL(entry.data.destination)
  }
}

struct LUNAWidgetBackground: View {
  let palette: LUNAWidgetPalette
  let opacity: Double
  let image: Image?
  init(entry: LUNACalendarEntry, palette: LUNAWidgetPalette, tinted: Bool) {
    self.palette = palette
    self.opacity = min(1, max(0, entry.data.backgroundOpacity ?? 0.75))
    self.image = tinted ? nil : entry.imageData.flatMap { UIImage(data: $0) }.map { Image(uiImage: $0) }
  }
  var body: some View {
    GeometryReader { geometry in
      Color.lunaHex(palette.background)
      if let image {
        image.resizable().scaledToFill()
          .frame(width: geometry.size.width, height: geometry.size.height)
          .clipped()
          .overlay(Color.lunaHex(palette.background).opacity(opacity))
      }
    }
  }
}

private struct LUNAWidgetRow: Identifiable {
  let days: [LUNAWidgetDay]
  var id: String { days.first?.date ?? "empty" }
}

struct LUNACalendarContent: View {
  @Environment(\.widgetFamily) private var family
  let data: LUNAWidgetData
  let palette: LUNAWidgetPalette
  let dark, tinted, month: Bool
  private var small: Bool { family == .systemSmall }
  private var columns: Int { small && !month ? 3 : 7 }
  private var rowCount: Int { month ? max(1, (data.monthDays?.count ?? 35) / 7) : family == .systemLarge ? 4 : 2 }
  private var days: [LUNAWidgetDay] {
    month ? data.monthDays ?? [] : small ? Array(data.days.prefix(6)) : Array((data.weekDays ?? data.days).prefix(family == .systemLarge ? 28 : 14))
  }
  private var primary: Color { tinted ? .primary : .lunaHex(palette.text) }
  private var muted: Color { tinted ? .secondary : .lunaHex(palette.muted) }
  private var todayDate: String { data.todayDate ?? data.days.first?.date ?? "" }
  private var rows: [[LUNAWidgetDay]] {
    stride(from: 0, to: days.count, by: columns).map { Array(days[$0..<min($0 + columns, days.count)]) }
  }
  private var sharedPeople: [String] {
    Array(Set(days.flatMap { $0.shifts.compactMap { $0.ownerName } })).sorted()
  }

  var body: some View {
    if data.state == "ready" && !days.isEmpty {
      GeometryReader { geometry in
        let headingHeight: CGFloat = month ? 25 : family == .systemLarge ? 17 : 0
        let legendHeight: CGFloat = sharedPeople.isEmpty ? 0 : 12
        let height = max(1, (geometry.size.height - headingHeight - legendHeight) / CGFloat(rowCount))
        VStack(alignment: .leading, spacing: 0) {
          if month {
            Text(data.monthTitle ?? "Dieser Monat").font(.system(size: 17, weight: .semibold))
              .foregroundStyle(primary).lineLimit(1).minimumScaleFactor(0.8).frame(height: headingHeight, alignment: .topLeading)
          } else if family == .systemLarge {
            HStack(spacing: 2) {
              ForEach(Array(["M", "D", "M", "D", "F", "S", "S"].enumerated()), id: \.offset) { _, name in
                Text(name).font(.system(size: 10)).foregroundStyle(muted).frame(maxWidth: .infinity)
              }
            }.frame(height: headingHeight)
          }
          ForEach(rows.map { LUNAWidgetRow(days: $0) }) { item in
            let row = item.days
            HStack(alignment: .top, spacing: 2) {
              ForEach(row) { day in
                if month { monthCell(day, height: height) }
                else {
                  Link(destination: URL(string: day.url) ?? data.destination) {
                    serviceCell(day, height: height)
                  }.buttonStyle(.plain)
                }
              }
            }.frame(height: height, alignment: .top)
          }
          if !sharedPeople.isEmpty {
            Text("Geteilt: " + sharedPeople.joined(separator: " · "))
              .font(.system(size: 8)).foregroundStyle(muted).lineLimit(1)
              .frame(height: legendHeight, alignment: .bottomLeading)
          }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    } else {
      VStack(spacing: 8) {
        Text("LUNA Shift").font(.headline)
        Text(data.state == "expired" ? "Kalender aktualisieren" : "Dein Dienstplan auf einen Blick")
          .font(.subheadline).multilineTextAlignment(.center)
      }.foregroundStyle(primary).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func dayNumber(_ day: LUNAWidgetDay, compact: Bool) -> some View {
    let today = day.date == todayDate
    let outside = month && String(day.date.prefix(7)) != data.month
    return Text(day.dayNumber)
      .font(.system(size: compact ? 10 : 12, weight: today ? .semibold : .regular))
      .lineLimit(1).minimumScaleFactor(0.8)
      .foregroundStyle(today && !tinted ? Color.lunaHex(palette.onToday) : outside ? muted : primary)
      .frame(minWidth: compact ? 16 : 25, minHeight: compact ? 12 : 18)
      .background(today ? Color.lunaHex(palette.today) : Color.clear)
      .clipShape(Capsule())
  }
  private func weekend(_ day: LUNAWidgetDay) -> Color {
    (["Sa", "So"].contains(day.weekday)) ? (tinted ? Color.secondary.opacity(0.08) : Color.lunaHex(palette.surface).opacity(0.45)) : .clear
  }
  private func serviceCell(_ day: LUNAWidgetDay, height: CGFloat) -> some View {
    let lineHeight = min(data.chipStyle?.rowHeight ?? 17, small ? 13 : 12)
    let chipHeight = lineHeight * (day.shifts.first?.detail == nil ? 1 : 2)
    let capacity = max(1, min(2, Int(max(0, height - 25 - (day.shifts.count > 2 ? 9 : 0)) / max(1, chipHeight + 2))))
    let visible = Array(day.shifts.prefix(capacity))
    return VStack(spacing: 2) {
      dayNumber(day, compact: false).frame(maxWidth: .infinity).padding(.bottom, 2)
      ForEach(visible, id: \.stableID) { shift in shiftChip(shift, lineHeight: lineHeight) }
      if day.shifts.count > capacity {
        Text("+\(day.shifts.count - capacity)").font(.system(size: 8)).foregroundStyle(muted)
      }
      Spacer(minLength: 0)
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .background(weekend(day)).clipShape(RoundedRectangle(cornerRadius: 2))
      .accessibilityElement(children: .ignore).accessibilityLabel(spokenLabel(day))
  }
  private func monthCell(_ day: LUNAWidgetDay, height: CGFloat) -> some View {
    VStack(spacing: 1) {
      dayNumber(day, compact: true)
      HStack(spacing: 1) {
        ForEach(Array(day.shifts.prefix(3)), id: \.stableID) { shift in
          Circle().fill(tinted ? primary : Color.lunaHex(shift.color)).frame(width: 3, height: 3)
        }
      }.frame(height: 3)
      Spacer(minLength: 0)
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .background(weekend(day))
      .accessibilityElement(children: .ignore).accessibilityLabel(spokenLabel(day))
  }
  private func shiftChip(_ shift: LUNAWidgetShift, lineHeight: Double) -> some View {
    let colors = dark ? shift.dark : shift.light
    let detail = shift.displayLabel == nil ? (shift.start.isEmpty ? "GT" : shift.start) : shift.detail
    let size = min(data.chipStyle?.fontSize ?? 12, small ? 11 : 10)
    return VStack(spacing: 0) {
      Group {
        if let symbol = shift.symbol { Image(systemName: symbol).font(.system(size: size, weight: .medium)) }
        else { Text(shift.displayLabel ?? shift.title).font(.system(size: size, weight: .medium)).lineLimit(1).minimumScaleFactor(0.7) }
      }.foregroundStyle(tinted ? primary : Color.lunaHex(shift.ownerColor == nil ? (data.chipStyle?.textColor ?? "#FFFFFF") : (colors?.onDetail ?? shift.textColor)))
        .frame(maxWidth: .infinity, minHeight: lineHeight)
        .background(Color.lunaHex(shift.ownerColor == nil ? (colors?.main ?? shift.color) : (colors?.detail ?? shift.color)))
      if let detail, !detail.isEmpty {
        Text(detail).font(.system(size: size, weight: .regular)).monospacedDigit()
          .lineLimit(1).minimumScaleFactor(0.7)
          .foregroundStyle(tinted ? primary : Color.lunaHex(colors?.onDetail ?? shift.textColor))
          .frame(maxWidth: .infinity, minHeight: lineHeight)
          .background(Color.lunaHex(colors?.detail ?? shift.color))
      }
    }.overlay(alignment: .leading) {
      if let ownerColor = shift.ownerColor {
        Rectangle().fill(tinted ? primary : Color.lunaHex(ownerColor)).frame(width: 3)
      }
    }.clipShape(RoundedRectangle(cornerRadius: data.chipStyle?.radius ?? 2, style: .continuous))
  }
  private func spokenLabel(_ day: LUNAWidgetDay) -> String {
    let shifts = day.shifts.map { shift in
      (shift.ownerName.map { "\($0), nur ansehen, " } ?? "Dein Dienst, ") + (shift.start.isEmpty ? "\(shift.title), ganztägig" : "\(shift.title), \(shift.start) bis \(shift.end)\(shift.nextDay ? " am Folgetag" : "")")
    }.joined(separator: "; ")
    return "\(day.date == todayDate ? "Heute, " : "")\(day.weekday), \(day.shortDate), \(shifts.isEmpty ? "kein Eintrag" : shifts)"
  }
}

private extension Color {
  static func lunaHex(_ value: String) -> Color {
    var text = value.hasPrefix("#") ? String(value.dropFirst()) : value
    if text.count == 3 { text = text.map { "\($0)\($0)" }.joined() }
    guard (text.count == 6 || text.count == 8), let number = UInt64(text, radix: 16) else { return .primary }
    let rgb = text.count == 8 ? number >> 8 : number
    let alpha = text.count == 8 ? Double(number & 0xff) / 255 : 1
    return Color(.sRGB, red: Double((rgb >> 16) & 0xff) / 255,
                 green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255, opacity: alpha)
  }
}
