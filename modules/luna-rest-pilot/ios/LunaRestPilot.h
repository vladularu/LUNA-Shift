#ifndef LUNA_REST_PILOT_H
#define LUNA_REST_PILOT_H
#include <stddef.h>
#include <stdint.h>
// Input stays owned by Swift. Output must be released exactly once.
char *luna_rest_run(const uint8_t *input, size_t length);
char *luna_rest_year_run(const uint8_t *input, size_t length);
void luna_rest_free(char *value);
#endif
