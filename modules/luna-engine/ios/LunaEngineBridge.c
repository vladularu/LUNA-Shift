#include "LunaEngineBridge.h"
#include <stdlib.h>
#include <string.h>

static int copy_bounded(LunaEngineBuffer buffer, uint8_t **bytes, size_t *length, size_t maximum) {
  int failure = 0;
  uint8_t *copy = NULL;
  if (bytes == NULL || length == NULL) {
    failure = 1;
  } else {
    *bytes = NULL;
    *length = 0;
    if (buffer.bytes == NULL || buffer.length == 0 || buffer.length > maximum) {
      failure = 2;
    } else {
      copy = (uint8_t *)malloc(buffer.length);
      if (copy == NULL) failure = 3;
      else memcpy(copy, buffer.bytes, buffer.length);
    }
  }
  /* handle=0 denotes static storage, never an owned allocation. */
  if (buffer.handle != 0 && !luna_engine_release_buffer(buffer.handle)) failure = 4;
  if (failure != 0) {
    free(copy);
    return failure;
  }
  *bytes = copy;
  *length = buffer.length;
  return 0;
}
int luna_engine_bridge_copy(LunaEngineBuffer buffer, uint8_t **bytes, size_t *length) {
  return copy_bounded(buffer,bytes,length,4194304);
}
int luna_engine_bridge_copy_form(LunaEngineBuffer buffer, uint8_t **bytes, size_t *length) {
  return copy_bounded(buffer,bytes,length,33554432);
}
void luna_engine_bridge_free(uint8_t *bytes) { free(bytes); }
