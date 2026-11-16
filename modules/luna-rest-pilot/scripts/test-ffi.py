"""Exercise the actual shared-library C ABI against frozen full outputs.

Usage: python test-ffi.py path/to/luna_rest_pilot.dll path/to/final-baseline/fixtures.json
The fixture file is the frozen, synthetic P1 reference, never personal duties.
"""
import ctypes
import json
import sys
from pathlib import Path

library = ctypes.CDLL(str(Path(sys.argv[1]).resolve()))
library.luna_rest_run.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
library.luna_rest_run.restype = ctypes.c_void_p
library.luna_rest_free.argtypes = [ctypes.c_void_p]
library.luna_rest_free.restype = None


def call(data):
    buffer = ctypes.create_string_buffer(data)
    result = library.luna_rest_run(buffer, len(data))
    assert result
    try:
        return json.loads(ctypes.string_at(result).decode("utf-8"))
    finally:
        library.luna_rest_free(result)


fixtures = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
count = 0
for case in fixtures["cases"]:
    command = {"schemaVersion": 1, "requestId": case["id"], "requests": case["requests"]}
    reply = call(json.dumps(command, ensure_ascii=False).encode("utf-8"))
    assert reply.get("results") == case["expected"], case["id"]
    assert reply["requestId"] == case["id"]
    assert reply["engineVersion"] == "luna-rest-native-v1"
    for key in ["kernelMs", "parseMs", "validationMs"]:
        assert reply[key] >= 0
    count += len(case["requests"])

for data in [b"", b"\xff", b"{}", b'{"schemaVersion":2,"requestId":"test","requests":[]}']:
    assert "error" in call(data)

base = fixtures["cases"][1]
command = {"schemaVersion": 1, "requestId": "bad", "requests": base["requests"]}
for mutate in [
    lambda x: x.update(requestId="x" * 81),
    lambda x: x.update(requests=x["requests"] + x["requests"]),
    lambda x: x["requests"][0].update(schemaVersion=99),
    lambda x: x["requests"][0]["intervals"][0].update(endMs=-1),
]:
    item = json.loads(json.dumps(command))
    mutate(item)
    assert "error" in call(json.dumps(item).encode())

# Check recovery after rejections and repeated transfer/free ownership.
valid = json.dumps(command).encode()
for _ in range(10):
    assert call(valid)["results"] == base["expected"]
library.luna_rest_free(None)
print(json.dumps({"fullFrozenComparisons": count, "invalidInputGroups": 8, "repeatedOwnershipTransfers": 10, "status": "passed"}))
