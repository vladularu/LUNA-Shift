package app.luna.engine

internal object EngineNative {
  init { System.loadLibrary("luna_engine_jni") }
  @JvmStatic external fun invoke(operation: Int, payload: ByteArray): ByteArray
  @JvmStatic external fun invokeSource(header: ByteArray, source: ByteArray): ByteArray
  @JvmStatic external fun invokeCalendarRanks(header: ByteArray, ranks: ByteArray): ByteArray
  @JvmStatic external fun invokeCatalogFinalize(header: ByteArray, ranks: ByteArray): ByteArray
  @JvmStatic external fun invokeFinancialCollationFinalize(header: ByteArray, ranks: ByteArray): ByteArray
  @JvmStatic external fun invokeCalendarSource(header: ByteArray, source: ByteArray): ByteArray
  @JvmStatic external fun invokeCalendarWindowFinalize(header: ByteArray, ranks: ByteArray): ByteArray
  @JvmStatic external fun invokeFormResource(header: ByteArray, body: ByteArray): ByteArray
}
