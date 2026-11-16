#include <jni.h>
#include <memory>
#include <vector>
#include "LunaEngineBridge.h"

static void reject(JNIEnv *env) {
  if (env->ExceptionCheck()) return;
  jclass type = env->FindClass("java/lang/IllegalStateException");
  if (type != nullptr) env->ThrowNew(type, "ENGINE_TRANSPORT");
}
static jbyteArray copy_reply(JNIEnv *env, LunaEngineBuffer buffer, bool form = false) {
  uint8_t *copy = nullptr;
  size_t output_length = 0;
  const int status = form ? luna_engine_bridge_copy_form(buffer, &copy, &output_length) : luna_engine_bridge_copy(buffer, &copy, &output_length);
  if (status != 0) { reject(env); return nullptr; }
  std::unique_ptr<uint8_t, decltype(&luna_engine_bridge_free)> owned(copy, luna_engine_bridge_free);
  jbyteArray output = env->NewByteArray(static_cast<jsize>(output_length));
  if (output == nullptr || env->ExceptionCheck()) return nullptr;
  env->SetByteArrayRegion(output, 0, static_cast<jsize>(output_length), reinterpret_cast<const jbyte *>(copy));
  return env->ExceptionCheck() ? nullptr : output;
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_luna_engine_EngineNative_invoke(JNIEnv *env, jclass, jint operation, jbyteArray payload) {
  try {
    if (payload == nullptr || operation < 0 || operation > 29) { reject(env); return nullptr; }
    const jsize length = env->GetArrayLength(payload);
    size_t maximum = 33554432;
    switch (operation) {
      case 1: case 2: case 10: case 14: case 15: case 16: case 18: case 19: case 21: case 22: case 24: case 25: case 27: case 28: case 29: maximum = 1024; break;
      case 13: maximum = 131072; break;
      case 17: maximum = 262144; break;
      case 20: case 23: case 26: maximum = 8192; break;
      case 0: case 8: case 9: case 11: case 12: maximum = 0; break;
    }
    if (length < 0 || static_cast<size_t>(length) > maximum) { reject(env); return nullptr; }
    std::vector<uint8_t> input(static_cast<size_t>(length));
    // Copy first, so no JVM primitive-array pin is held through a Rust job.
    if (length != 0) env->GetByteArrayRegion(payload, 0, length, reinterpret_cast<jbyte *>(input.data()));
    if (env->ExceptionCheck()) return nullptr;
    LunaEngineBuffer buffer{};
    const uint8_t *bytes = input.empty() ? nullptr : input.data();
    switch (operation) {
      case 0: buffer = luna_engine_info(); break;
      case 1: buffer = luna_engine_bind_owner(bytes, input.size()); break;
      case 2: buffer = luna_engine_advance_revision(bytes, input.size()); break;
      case 3: buffer = luna_engine_execute(bytes, input.size()); break;
      case 4: buffer = luna_engine_snapshot_digests(bytes, input.size()); break;
      case 5: buffer = luna_engine_calendar_candidates(bytes, input.size()); break;
      case 6: buffer = luna_engine_admit(bytes, input.size(), 0); break;
      case 7: buffer = luna_engine_admit(bytes, input.size(), 1); break;
      case 8: buffer = luna_engine_run_next(0); break;
      case 9: buffer = luna_engine_run_next(1); break;
      case 10: buffer = luna_engine_cancel_job(bytes, input.size()); break;
      case 11: buffer = luna_engine_reset(); break;
      case 12: buffer = luna_engine_collect_retired(); break;
      case 13: buffer = luna_engine_snapshot_begin(bytes, input.size()); break;
      case 14: buffer = luna_engine_snapshot_seal(bytes, input.size()); break;
      case 15: buffer = luna_engine_snapshot_abort(bytes, input.size()); break;
      case 16: buffer = luna_engine_snapshot_calendar_candidates(bytes, input.size()); break;
      case 17: buffer = luna_engine_utility(bytes, input.size()); break;
      case 18: buffer = luna_engine_snapshot_catalog_candidates(bytes, input.size()); break;
      case 19: buffer = luna_engine_snapshot_profile_clock(bytes, input.size()); break;
      case 20: buffer = luna_engine_financial_collation_prepare(bytes, input.size()); break;
      case 21: buffer = luna_engine_financial_collation_candidates(bytes, input.size()); break;
      case 22: buffer = luna_engine_financial_collation_abort(bytes, input.size()); break;
      case 23: buffer = luna_engine_calendar_begin(bytes,input.size()); break;
      case 24: buffer = luna_engine_calendar_seal(bytes,input.size()); break;
      case 25: buffer = luna_engine_calendar_abort(bytes,input.size()); break;
      case 26: buffer = luna_engine_calendar_window_prepare(bytes,input.size()); break;
      case 27: buffer = luna_engine_calendar_window_candidates(bytes,input.size()); break;
      case 28: buffer = luna_engine_calendar_window_read(bytes,input.size()); break;
      case 29: buffer = luna_engine_calendar_window_abort(bytes,input.size()); break;
      default: reject(env); return nullptr;
    }
    return copy_reply(env, buffer, operation == 8 || operation == 9);
  } catch (...) { reject(env); return nullptr; }
}
enum class RawKind { Source, CalendarRanks, CatalogFinalize, FinancialCollationFinalize, CalendarSource, CalendarWindowFinalize, FormResource };
static jbyteArray invoke_raw(JNIEnv *env, jbyteArray header, jbyteArray source, RawKind kind) {
  try {
    if (header == nullptr || source == nullptr) { reject(env); return nullptr; }
    const jsize header_length = env->GetArrayLength(header);
    const jsize source_length = env->GetArrayLength(source);
    const jsize header_maximum=kind==RawKind::Source?131072:((kind==RawKind::CalendarSource || kind==RawKind::FormResource)?8192:1024);
    const jsize source_maximum=kind==RawKind::FormResource?16515072:33554432;
    if (header_length < 0 || header_length > header_maximum || source_length < 0 || source_length > source_maximum) { reject(env); return nullptr; }
    std::vector<uint8_t> h(static_cast<size_t>(header_length));
    std::vector<uint8_t> s(static_cast<size_t>(source_length));
    if (header_length != 0) env->GetByteArrayRegion(header, 0, header_length, reinterpret_cast<jbyte *>(h.data()));
    if (env->ExceptionCheck()) return nullptr;
    if (source_length != 0) env->GetByteArrayRegion(source, 0, source_length, reinterpret_cast<jbyte *>(s.data()));
    if (env->ExceptionCheck()) return nullptr;
    const uint8_t *header_bytes=h.empty() ? nullptr : h.data();
    const uint8_t *source_bytes=s.empty() ? nullptr : s.data();
    LunaEngineBuffer buffer{};
    switch(kind) {
      case RawKind::Source: buffer=luna_engine_snapshot_source(header_bytes,h.size(),source_bytes,s.size()); break;
      case RawKind::CalendarRanks: buffer=luna_engine_snapshot_calendar_ranks(header_bytes,h.size(),source_bytes,s.size()); break;
      case RawKind::CatalogFinalize: buffer=luna_engine_snapshot_catalog_finalize(header_bytes,h.size(),source_bytes,s.size()); break;
      case RawKind::FinancialCollationFinalize: buffer=luna_engine_financial_collation_finalize(header_bytes,h.size(),source_bytes,s.size()); break;
      case RawKind::CalendarSource: buffer=luna_engine_calendar_source(header_bytes,h.size(),source_bytes,s.size()); break;
      case RawKind::CalendarWindowFinalize: buffer=luna_engine_calendar_window_finalize(header_bytes,h.size(),source_bytes,s.size()); break;
      case RawKind::FormResource: buffer=luna_engine_form_resource(header_bytes,h.size(),source_bytes,s.size()); break;
    }
    return copy_reply(env, buffer, kind==RawKind::FormResource || kind==RawKind::CalendarSource);
  } catch (...) { reject(env); return nullptr; }
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_luna_engine_EngineNative_invokeSource(JNIEnv *env, jclass, jbyteArray header, jbyteArray source) {
  return invoke_raw(env,header,source,RawKind::Source);
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_luna_engine_EngineNative_invokeCalendarRanks(JNIEnv *env, jclass, jbyteArray header, jbyteArray source) {
  return invoke_raw(env,header,source,RawKind::CalendarRanks);
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_luna_engine_EngineNative_invokeCatalogFinalize(JNIEnv *env, jclass, jbyteArray header, jbyteArray source) {
  return invoke_raw(env,header,source,RawKind::CatalogFinalize);
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_luna_engine_EngineNative_invokeFinancialCollationFinalize(JNIEnv *env, jclass, jbyteArray header, jbyteArray source) {
  return invoke_raw(env,header,source,RawKind::FinancialCollationFinalize);
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_luna_engine_EngineNative_invokeCalendarSource(JNIEnv *env,jclass,jbyteArray header,jbyteArray source){
  return invoke_raw(env,header,source,RawKind::CalendarSource);
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_luna_engine_EngineNative_invokeCalendarWindowFinalize(JNIEnv *env,jclass,jbyteArray header,jbyteArray ranks){
  return invoke_raw(env,header,ranks,RawKind::CalendarWindowFinalize);
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_luna_engine_EngineNative_invokeFormResource(JNIEnv *env,jclass,jbyteArray header,jbyteArray body){
  return invoke_raw(env,header,body,RawKind::FormResource);
}
