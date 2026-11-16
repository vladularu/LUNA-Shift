#ifndef LUNA_ENGINE_BRIDGE_H
#define LUNA_ENGINE_BRIDGE_H
#include "LunaEngine.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Copies a bounded reply and releases its opaque Rust handle, including errors.
 * The caller owns successful *bytes and must call luna_engine_bridge_free. */
int luna_engine_bridge_copy(LunaEngineBuffer buffer, uint8_t **bytes, size_t *length);
/* Dedicated private FormResource reply; ordinary copy remains limited to4MiB. */
int luna_engine_bridge_copy_form(LunaEngineBuffer buffer, uint8_t **bytes, size_t *length);
void luna_engine_bridge_free(uint8_t *bytes);
#ifdef __cplusplus
}
#endif
#endif
