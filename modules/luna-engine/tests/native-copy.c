#include "LunaEngineBridge.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int releases = 0;
static bool release_ok = true;
bool luna_engine_release_buffer(uint64_t handle) {
  assert(handle == 17);
  releases++;
  return release_ok;
}
int main(void) {
  uint8_t input[] = {'{', 0, 0xff, '}'};
  uint8_t *copy = NULL;
  size_t length = 0;
  LunaEngineBuffer buffer = {input, sizeof(input), 17};
  assert(luna_engine_bridge_copy(buffer, &copy, &length) == 0);
  assert(length == sizeof(input) && memcmp(copy, input, length) == 0);
  input[0] = 'x';
  assert(copy[0] == '{' && releases == 1);
  luna_engine_bridge_free(copy);
  buffer.length = 4194305;
  assert(luna_engine_bridge_copy(buffer, &copy, &length) == 2);
  assert(copy == NULL && length == 0 && releases == 2);
  buffer.length = 0;
  assert(luna_engine_bridge_copy(buffer, &copy, &length) == 2 && releases == 3);
  buffer.length = sizeof(input);
  buffer.bytes = NULL;
  assert(luna_engine_bridge_copy(buffer, &copy, &length) == 2 && releases == 4);
  buffer.bytes = input;
  assert(luna_engine_bridge_copy(buffer, NULL, &length) == 1 && releases == 5);
  release_ok = false;
  assert(luna_engine_bridge_copy(buffer, &copy, &length) == 4 && releases == 6);
  assert(copy == NULL && length == 0);
  buffer.handle = 0;
  assert(luna_engine_bridge_copy(buffer, &copy, &length) == 0 && releases == 6);
  luna_engine_bridge_free(copy);
  const size_t large_length=4194305;
  uint8_t *large=(uint8_t *)malloc(large_length);
  assert(large!=NULL);
  memset(large,0x61,large_length);
  buffer.bytes=large;buffer.length=large_length;buffer.handle=17;release_ok=true;
  assert(luna_engine_bridge_copy_form(buffer,&copy,&length)==0);
  assert(length==large_length && copy[0]==0x61 && copy[length-1]==0x61 && releases==7);
  luna_engine_bridge_free(copy);
  assert(luna_engine_bridge_copy(buffer,&copy,&length)==2 && releases==8);
  buffer.length=33554433;
  assert(luna_engine_bridge_copy_form(buffer,&copy,&length)==2 && releases==9);
  assert(copy==NULL && length==0);
  free(large);
  puts("native-copy: 7 original +3 separate form lifetime/bounds cases passed");
  return 0;
}
