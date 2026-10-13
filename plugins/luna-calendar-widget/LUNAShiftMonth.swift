// LUNA_NATIVE_CALENDAR_RENDERER
// Both native kinds read the same private local snapshot and background.
import SwiftUI
import WidgetKit

struct LUNAShiftMonth: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "LUNAShiftMonth", provider: LUNACalendarProvider()) { entry in
      LUNACalendarEntryView(entry: entry, month: true)
    }
    .configurationDisplayName(__LUNA_DISPLAY_NAME__)
    .description(__LUNA_DESCRIPTION__)
    .supportedFamilies([.systemSmall])
  }
}
