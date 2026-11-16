import ExpoModulesCore
import Foundation

private struct PilotFailure: LocalizedError {
  let errorDescription: String?
  init(_ code: String) { errorDescription = code }
}

public final class LunaRestPilotModule: Module {
  private let computeQueue = DispatchQueue(label: "app.luna.rest-pilot", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("LunaRestPilot")
    Constant("engineVersion") { "luna-rest-native-v1" }
    Constant("yearEngineVersion") { "luna-rest-year-v1" }

    // A serial worker queue bounds native concurrency. The JS caller admits only
    // one benchmark run; this never executes the kernel on the main/UI queue.
    AsyncFunction("runAsync") { (payload: String) -> [String: Any] in
      try Self.compute(payload, year: false)
    }.runOnQueue(computeQueue)
    AsyncFunction("runYearAsync") { (payload: String) -> [String: Any] in
      try Self.compute(payload, year: true)
    }.runOnQueue(computeQueue)
  }

  private static func compute(_ payload: String, year: Bool) throws -> [String: Any] {
    guard !Thread.isMainThread else { throw PilotFailure("WORKER_QUEUE_REQUIRED") }
    let started = DispatchTime.now().uptimeNanoseconds
    guard !payload.isEmpty, payload.utf8.count <= 4 * 1024 * 1024 else {
      throw PilotFailure("INPUT_LIMIT")
    }
    let bytes = Array(payload.utf8)
    let result = bytes.withUnsafeBufferPointer { buffer in
      year ? luna_rest_year_run(buffer.baseAddress, buffer.count) : luna_rest_run(buffer.baseAddress, buffer.count)
    }
    guard let result else { throw PilotFailure("NATIVE_ALLOCATION") }
    defer { luna_rest_free(result) }
    let reply = String(cString: result)
    let nativeMs = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
    return ["payload": reply, "nativeMs": nativeMs]
  }
}
