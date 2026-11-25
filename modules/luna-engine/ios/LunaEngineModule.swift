import ExpoModulesCore
import Foundation

public final class LunaEngineModule: Module {
  // Rust's registry is process-wide; queues must also survive module reloads.
  private static let control = DispatchQueue(label: "app.luna.engine.control", qos: .userInitiated)
  private static let preparation = DispatchQueue(label: "app.luna.engine.preparation", qos: .userInitiated)
  private static let finance = DispatchQueue(label: "app.luna.engine.finance", qos: .userInitiated)
  private static let checks = DispatchQueue(label: "app.luna.engine.checks", qos: .utility)
  private static let utilities = DispatchQueue(label: "app.luna.engine.utilities", qos: .userInitiated)
  private static let calendar = DispatchQueue(label: "app.luna.engine.calendar", qos: .userInitiated)
  private static let forms = DispatchQueue(label: "app.luna.engine.forms", qos: .userInitiated)
  private static let controlSlots = DispatchSemaphore(value: 32)
  private static let preparationSlots = DispatchSemaphore(value: 2)
  private static let financeSlots = DispatchSemaphore(value: 2)
  private static let checksSlots = DispatchSemaphore(value: 2)
  private static let utilitySlots = DispatchSemaphore(value: 16)
  private static let calendarSlots = DispatchSemaphore(value: 4)
  private static let formSlots = DispatchSemaphore(value: 4)

  public func definition() -> ModuleDefinition {
    Name("LunaEngine")
    Constant("transportAbiVersion") { 1 }
    Constant("annualGrossSummaryEngineVersion") { Self.annualGrossSummaryEngineVersion() }
    AsyncFunction("invoke") { (operation: String, payload: String, lane: String?, promise: Promise) in
      do {
        let (queue, slots) = try self.queue(operation: operation, lane: lane)
        guard slots.wait(timeout: .now()) == .success else { throw TransportFailure.invalid }
        queue.async {
          defer { slots.signal() }
          do { promise.resolve(try Self.invoke(operation, payload, lane)) }
          catch { promise.reject("ENGINE_TRANSPORT", "Native engine transport failed.") }
        }
      } catch { promise.reject("ENGINE_TRANSPORT", "Invalid engine operation.") }
    }
    AsyncFunction("invokeSource") { (header: String, source: String, promise: Promise) in
      Self.invokeRaw(header, source, .source, promise)
    }
    AsyncFunction("invokeCalendarRanks") { (header: String, source: String, promise: Promise) in
      Self.invokeRaw(header, source, .calendarRanks, promise)
    }
    AsyncFunction("invokeCatalogFinalize") { (header: String, source: String, promise: Promise) in
      Self.invokeRaw(header, source, .catalogFinalize, promise)
    }
    AsyncFunction("invokeFinancialCollationFinalize") { (header: String, source: String, promise: Promise) in
      Self.invokeRaw(header, source, .financialCollationFinalize, promise)
    }
    AsyncFunction("invokeCalendarSource") { (header: String, source: String, promise: Promise) in
      Self.invokeRaw(header, source, .calendarSource, promise)
    }
    AsyncFunction("invokeCalendarWindowFinalize") { (header: String, ranks: String, promise: Promise) in
      Self.invokeRaw(header, ranks, .calendarWindowFinalize, promise)
    }
    AsyncFunction("invokeFormResource") { (header: String, body: String, promise: Promise) in
      Self.invokeFormResource(header, body, promise)
    }
  }

  private static func invokeFormResource(_ header: String, _ body: String, _ promise: Promise) {
    guard formSlots.wait(timeout: .now()) == .success else {
      promise.reject("ENGINE_TRANSPORT", "Native form queue is full."); return
    }
    forms.async {
      defer { formSlots.signal() }
      do {
        guard !Thread.isMainThread, header.utf8.count <= 8192, body.utf8.count <= 16515072 else { throw TransportFailure.invalid }
        let h = Array(header.utf8), b = Array(body.utf8)
        let result = h.withUnsafeBufferPointer { header in
          b.withUnsafeBufferPointer { body in
            luna_engine_form_resource(header.baseAddress, header.count, body.baseAddress, body.count)
          }
        }
        var bytes: UnsafeMutablePointer<UInt8>?
        var length = 0
        guard luna_engine_bridge_copy_form(result, &bytes, &length) == 0, let bytes else { throw TransportFailure.invalid }
        defer { luna_engine_bridge_free(bytes) }
        guard var metadata = try JSONSerialization.jsonObject(with: Data(bytes: bytes, count: length)) as? [String: Any],
              let ok = metadata["ok"] as? Bool else { throw TransportFailure.invalid }
        let taken = ok && (metadata["state"] as? String) == "WRITE_PLAN_TAKEN"
        let originalPlan = metadata.removeValue(forKey: "planBody")
        let plan: String?
        if taken {
          guard let value = originalPlan as? String, value.utf8.count <= 16515072 else { throw TransportFailure.invalid }
          plan = value
        } else {
          guard originalPlan == nil else { throw TransportFailure.invalid }; plan = nil
        }
        let small = try JSONSerialization.data(withJSONObject: metadata)
        guard small.count <= 1048576, let text = String(data: small, encoding: .utf8) else { throw TransportFailure.invalid }
        let response: [String: Any] = ["metadataJson": text, "planBody": plan.map { $0 as Any } ?? NSNull()]
        promise.resolve(response)
      } catch { promise.reject("ENGINE_TRANSPORT", "Native form transport failed.") }
    }
  }

  private enum RawKind { case source, calendarRanks, catalogFinalize, financialCollationFinalize, calendarSource, calendarWindowFinalize }
  private static func invokeRaw(_ header: String, _ source: String, _ kind: RawKind, _ promise: Promise) {
      let queue = kind == .calendarWindowFinalize ? Self.calendar : Self.preparation
      let slots = kind == .calendarWindowFinalize ? Self.calendarSlots : Self.preparationSlots
      guard slots.wait(timeout: .now()) == .success else {
        promise.reject("ENGINE_TRANSPORT", "Native engine queue is full."); return
      }
      queue.async {
        defer { slots.signal() }
        do {
          let headerMaximum = kind == .source ? 131072 : (kind == .calendarSource ? 8192 : 1024)
          guard !Thread.isMainThread, header.utf8.count <= headerMaximum, source.utf8.count <= 33554432 else { throw TransportFailure.invalid }
          let headerBytes = Array(header.utf8)
          let sourceBytes = Array(source.utf8)
          let buffer = headerBytes.withUnsafeBufferPointer { h in
            sourceBytes.withUnsafeBufferPointer { s in
              switch kind {
              case .source: return luna_engine_snapshot_source(h.baseAddress, h.count, s.baseAddress, s.count)
              case .calendarRanks: return luna_engine_snapshot_calendar_ranks(h.baseAddress, h.count, s.baseAddress, s.count)
              case .catalogFinalize: return luna_engine_snapshot_catalog_finalize(h.baseAddress, h.count, s.baseAddress, s.count)
              case .financialCollationFinalize: return luna_engine_financial_collation_finalize(h.baseAddress, h.count, s.baseAddress, s.count)
              case .calendarSource: return luna_engine_calendar_source(h.baseAddress, h.count, s.baseAddress, s.count)
              case .calendarWindowFinalize: return luna_engine_calendar_window_finalize(h.baseAddress, h.count, s.baseAddress, s.count)
              }
            }
          }
          promise.resolve(try Self.copy(buffer, large: kind == .calendarSource))
        } catch { promise.reject("ENGINE_TRANSPORT", "Native source transport failed.") }
      }
  }

  private func queue(operation: String, lane: String?) throws -> (DispatchQueue, DispatchSemaphore) {
    if let lane, lane != "finance" && lane != "checks" { throw TransportFailure.invalid }
    switch operation {
    case "info", "bindOwner", "advanceRevision", "cancelJob", "reset", "snapshotAbort", "financialCollationAbort", "calendarAbort", "calendarWindowAbort":
      return (Self.control, Self.controlSlots)
    case "admitFinance", "admitChecks", "execute", "snapshotDigests", "calendarCandidates", "collectRetired", "snapshotBegin", "snapshotSeal", "snapshotCalendarCandidates", "snapshotCatalogCandidates", "snapshotProfileClock", "financialCollationPrepare", "financialCollationCandidates", "calendarBegin", "calendarSeal": return (Self.preparation, Self.preparationSlots)
    case "calendarWindowPrepare", "calendarWindowCandidates", "calendarWindowRead": return (Self.calendar, Self.calendarSlots)
    case "runFinance": return (Self.finance, Self.financeSlots)
    case "runChecks": return (Self.checks, Self.checksSlots)
    case "utility": return (Self.utilities, Self.utilitySlots)
    default: throw TransportFailure.invalid
    }
  }

  private static func invoke(_ operation: String, _ payload: String, _ lane: String?) throws -> String {
    guard !Thread.isMainThread else { throw TransportFailure.invalid }
    let maximum: Int
    switch operation {
    case "bindOwner", "advanceRevision", "cancelJob", "snapshotSeal", "snapshotAbort", "snapshotCalendarCandidates", "snapshotCatalogCandidates", "snapshotProfileClock", "financialCollationCandidates", "financialCollationAbort", "calendarSeal", "calendarAbort", "calendarWindowCandidates", "calendarWindowRead", "calendarWindowAbort": maximum = 1024
    case "snapshotBegin": maximum = 131072
    case "utility": maximum = 262144
    case "financialCollationPrepare", "calendarBegin", "calendarWindowPrepare": maximum = 8192
    case "info", "reset", "collectRetired", "runFinance", "runChecks": maximum = 0
    default: maximum = 33554432
    }
    guard payload.utf8.count <= maximum else { throw TransportFailure.invalid }
    let bytes = Array(payload.utf8)
    let result = try bytes.withUnsafeBufferPointer { input -> LunaEngineBuffer in
      switch operation {
      case "info": return luna_engine_info()
      case "bindOwner": return luna_engine_bind_owner(input.baseAddress, input.count)
      case "advanceRevision": return luna_engine_advance_revision(input.baseAddress, input.count)
      case "execute": return luna_engine_execute(input.baseAddress, input.count)
      case "utility": return luna_engine_utility(input.baseAddress, input.count)
      case "snapshotBegin": return luna_engine_snapshot_begin(input.baseAddress, input.count)
      case "snapshotSeal": return luna_engine_snapshot_seal(input.baseAddress, input.count)
      case "snapshotAbort": return luna_engine_snapshot_abort(input.baseAddress, input.count)
      case "snapshotCalendarCandidates": return luna_engine_snapshot_calendar_candidates(input.baseAddress, input.count)
      case "snapshotCatalogCandidates": return luna_engine_snapshot_catalog_candidates(input.baseAddress, input.count)
      case "snapshotProfileClock": return luna_engine_snapshot_profile_clock(input.baseAddress, input.count)
      case "financialCollationPrepare": return luna_engine_financial_collation_prepare(input.baseAddress, input.count)
      case "financialCollationCandidates": return luna_engine_financial_collation_candidates(input.baseAddress, input.count)
      case "financialCollationAbort": return luna_engine_financial_collation_abort(input.baseAddress, input.count)
      case "calendarBegin": return luna_engine_calendar_begin(input.baseAddress, input.count)
      case "calendarSeal": return luna_engine_calendar_seal(input.baseAddress, input.count)
      case "calendarAbort": return luna_engine_calendar_abort(input.baseAddress, input.count)
      case "calendarWindowPrepare": return luna_engine_calendar_window_prepare(input.baseAddress, input.count)
      case "calendarWindowCandidates": return luna_engine_calendar_window_candidates(input.baseAddress, input.count)
      case "calendarWindowRead": return luna_engine_calendar_window_read(input.baseAddress, input.count)
      case "calendarWindowAbort": return luna_engine_calendar_window_abort(input.baseAddress, input.count)
      case "snapshotDigests": return luna_engine_snapshot_digests(input.baseAddress, input.count)
      case "calendarCandidates": return luna_engine_calendar_candidates(input.baseAddress, input.count)
      case "admitFinance": return luna_engine_admit(input.baseAddress, input.count, 0)
      case "admitChecks": return luna_engine_admit(input.baseAddress, input.count, 1)
      case "runFinance": return luna_engine_run_next(0)
      case "runChecks": return luna_engine_run_next(1)
      case "cancelJob": return luna_engine_cancel_job(input.baseAddress, input.count)
      case "reset": return luna_engine_reset()
      case "collectRetired": return luna_engine_collect_retired()
      default: throw TransportFailure.invalid
      }
    }
    return try copy(result, large: operation == "runFinance" || operation == "runChecks")
  }

  private static func annualGrossSummaryEngineVersion() -> String {
    guard let text = try? copy(luna_engine_info()),
          let info = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any],
          let version = info["engineVersion"] as? String else { return "" }
    return version
  }

  private static func copy(_ result: LunaEngineBuffer, large: Bool = false) throws -> String {
    var bytes: UnsafeMutablePointer<UInt8>?
    var length = 0
    let status = large ? luna_engine_bridge_copy_form(result, &bytes, &length) : luna_engine_bridge_copy(result, &bytes, &length)
    guard status == 0, let bytes else {
      throw TransportFailure.invalid
    }
    defer { luna_engine_bridge_free(bytes) }
    guard let text = String(data: Data(bytes: bytes, count: length), encoding: .utf8) else {
      throw TransportFailure.invalid
    }
    return text
  }
}
private enum TransportFailure: Error { case invalid }
