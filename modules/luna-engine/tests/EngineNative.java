package app.luna.engine;
public final class EngineNative {
  static { System.loadLibrary("luna_engine_jni"); }
  public static native byte[] invoke(int operation, byte[] payload);
  public static native byte[] invokeSource(byte[] header, byte[] source);
  public static native byte[] invokeCalendarRanks(byte[] header, byte[] ranks);
  public static native byte[] invokeCatalogFinalize(byte[] header, byte[] ranks);
  public static native byte[] invokeFinancialCollationFinalize(byte[] header, byte[] ranks);
  public static native byte[] invokeCalendarSource(byte[] header, byte[] source);
  public static native byte[] invokeCalendarWindowFinalize(byte[] header, byte[] ranks);
  public static native byte[] invokeFormResource(byte[] header, byte[] body);
}
