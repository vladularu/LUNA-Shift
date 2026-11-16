package app.luna.engine

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** No Android/UI dependency; all native input/output is strict standard UTF-8. */
internal class EngineTransport(
  private val nativeSourceCall: (ByteArray, ByteArray) -> ByteArray = { header, source -> EngineNative.invokeSource(header, source) },
  private val nativeRanksCall: (ByteArray, ByteArray) -> ByteArray = { header, source -> EngineNative.invokeCalendarRanks(header, source) },
  private val nativeCatalogCall: (ByteArray, ByteArray) -> ByteArray = { header, source -> EngineNative.invokeCatalogFinalize(header, source) },
  private val nativeFinancialCollationCall: (ByteArray, ByteArray) -> ByteArray = { header, source -> EngineNative.invokeFinancialCollationFinalize(header, source) },
  private val nativeCalendarSourceCall: (ByteArray, ByteArray) -> ByteArray = { header, source -> EngineNative.invokeCalendarSource(header, source) },
  private val nativeCalendarWindowCall: (ByteArray, ByteArray) -> ByteArray = { header, source -> EngineNative.invokeCalendarWindowFinalize(header, source) },
  private val nativeFormCall: (ByteArray, ByteArray) -> ByteArray = { header, body -> EngineNative.invokeFormResource(header,body) },
  private val nativeCall: (Int, ByteArray) -> ByteArray = { operation, bytes -> EngineNative.invoke(operation, bytes) }
) : AutoCloseable {
  private fun worker(name: String, capacity: Int) = ThreadPoolExecutor(
    1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(capacity),
    { task -> Thread(task, "luna-engine-$name") }, ThreadPoolExecutor.AbortPolicy()
  )
  private val control = worker("control", 32)
  private val preparation = worker("preparation", 2)
  private val finance = worker("finance", 2)
  private val checks = worker("checks", 2)
  private val utilities = worker("utilities", 15)
  private val calendar = worker("calendar", 3)
  private val forms = worker("forms", 3)

  fun invoke(operation: String, payload: String, lane: String?, resolve: (String) -> Unit, reject: () -> Unit) {
    try {
      require(lane == null || lane == "finance" || lane == "checks")
      val opcode = operations[operation] ?: error("INVALID_OPERATION")
      val executor = when (opcode) {
        3, 4, 5, 6, 7, 12, 13, 14, 16, 18, 19, 20, 21, 23, 24 -> preparation
        8 -> finance
        9 -> checks
        17 -> utilities
        26, 27, 28 -> calendar
        else -> control
      }
      val maximum = when (opcode) {
        1, 2, 10, 14, 15, 16, 18, 19, 21, 22, 24, 25, 27, 28, 29 -> 1024
        13 -> 131072
        17 -> 262144
        20, 23, 26 -> 8192
        0, 8, 9, 11, 12 -> 0
        else -> 33554432
      }
      require(payload.length <= maximum)
      executor.execute {
        try {
          resolve(decode(nativeCall(opcode, encode(payload, maximum)), if (opcode == 8 || opcode == 9) 33554432 else 4194304))
        } catch (_: Exception) { reject() } catch (_: LinkageError) { reject() }
      }
    } catch (_: Exception) { reject() }
  }

  fun invokeSource(header: String, source: String, resolve: (String) -> Unit, reject: () -> Unit) {
    invokeRaw(header, source, 131072, nativeSourceCall, resolve, reject)
  }
  fun invokeCalendarRanks(header: String, ranks: String, resolve: (String) -> Unit, reject: () -> Unit) {
    invokeRaw(header, ranks, 1024, nativeRanksCall, resolve, reject)
  }
  fun invokeCatalogFinalize(header: String, ranks: String, resolve: (String) -> Unit, reject: () -> Unit) {
    invokeRaw(header, ranks, 1024, nativeCatalogCall, resolve, reject)
  }
  fun invokeFinancialCollationFinalize(header: String, ranks: String, resolve: (String) -> Unit, reject: () -> Unit) {
    invokeRaw(header, ranks, 1024, nativeFinancialCollationCall, resolve, reject)
  }
  fun invokeCalendarSource(header: String, source: String, resolve: (String) -> Unit, reject: () -> Unit) {
    invokeRaw(header, source, 8192, nativeCalendarSourceCall, resolve, reject, outputLimit = 33554432)
  }
  fun invokeCalendarWindowFinalize(header: String, ranks: String, resolve: (String) -> Unit, reject: () -> Unit) {
    invokeRaw(header, ranks, 1024, nativeCalendarWindowCall, resolve, reject, calendar)
  }
  fun invokeFormResource(header: String, body: String, resolve: (String) -> Unit, reject: () -> Unit) {
    invokeRaw(header,body,8192,nativeFormCall,resolve,reject,forms,16515072,33554432)
  }
  private fun invokeRaw(header: String, source: String, headerLimit: Int, native: (ByteArray, ByteArray) -> ByteArray, resolve: (String) -> Unit, reject: () -> Unit, executor: ThreadPoolExecutor = preparation, bodyLimit: Int = 33554432, outputLimit: Int = 4194304) {
    try {
      require(header.length <= headerLimit && source.length <= bodyLimit)
      executor.execute {
        try { resolve(decode(native(encode(header, headerLimit), encode(source, bodyLimit)),outputLimit)) }
        catch (_: Exception) { reject() } catch (_: LinkageError) { reject() }
      }
    } catch (_: Exception) { reject() }
  }
  private fun encode(text: String, maximum: Int): ByteArray {
    require(text.length <= maximum)
    var bytes = 0
    var index = 0
    while (index < text.length) {
      val unit = text[index++].code
      bytes += when {
        unit < 0x80 -> 1
        unit < 0x800 -> 2
        unit in 0xd800..0xdbff -> {
          require(index < text.length && text[index].code in 0xdc00..0xdfff)
          index++; 4
        }
        unit in 0xdc00..0xdfff -> error("INVALID_UTF8")
        else -> 3
      }
      require(bytes <= maximum)
    }
    return text.toByteArray(StandardCharsets.UTF_8)
  }
  private fun decode(reply: ByteArray, maximum: Int = 4194304): String {
    require(reply.size <= maximum)
    return StandardCharsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(reply)).toString()
  }

  override fun close() {
    // Host publication is already fenced; do not reset another module owner's core.
    listOf(control, preparation, finance, checks, utilities, calendar, forms).forEach { it.shutdown() }
  }

  companion object {
    private val operations = mapOf(
      "info" to 0, "bindOwner" to 1, "advanceRevision" to 2,
      "execute" to 3, "snapshotDigests" to 4, "calendarCandidates" to 5,
      "admitFinance" to 6, "admitChecks" to 7, "runFinance" to 8,
      "runChecks" to 9, "cancelJob" to 10, "reset" to 11, "collectRetired" to 12,
      "snapshotBegin" to 13, "snapshotSeal" to 14, "snapshotAbort" to 15,
      "snapshotCalendarCandidates" to 16, "utility" to 17, "snapshotCatalogCandidates" to 18,
      "snapshotProfileClock" to 19,
      "financialCollationPrepare" to 20, "financialCollationCandidates" to 21, "financialCollationAbort" to 22,
      "calendarBegin" to 23, "calendarSeal" to 24, "calendarAbort" to 25,
      "calendarWindowPrepare" to 26, "calendarWindowCandidates" to 27, "calendarWindowRead" to 28, "calendarWindowAbort" to 29
    )
  }
}
