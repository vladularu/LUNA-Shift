"""Check the actual compact annual C ABI and the legacy ABI's shared ownership."""
import ctypes
import json
import sys
from pathlib import Path

library = ctypes.CDLL(str(Path(sys.argv[1]).resolve()))
library.luna_rest_year_run.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
library.luna_rest_year_run.restype = ctypes.c_void_p
library.luna_rest_free.argtypes = [ctypes.c_void_p]
library.luna_rest_free.restype = None


def call(data):
    buffer = ctypes.create_string_buffer(data)
    result = library.luna_rest_year_run(buffer, len(data))
    assert result
    try:
        return json.loads(ctypes.string_at(result).decode("utf-8"))
    finally:
        library.luna_rest_free(result)


cases = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
count = 0
for case in cases:
    reply = call(json.dumps(case["batch"], ensure_ascii=False).encode("utf-8"))
    assert reply.get("requestId") == case["batch"]["requestId"], reply
    assert reply["engineVersion"] == "luna-rest-year-v1"
    assert reply["schemaVersion"] == 2
    assert [r["id"] for r in reply["results"]] == [r["id"] for r in case["batch"]["requests"]]
    for index, expected in zip(case["indices"], case["expected"], strict=True):
        assert reply["results"][index]["result"] == expected, case["id"]
        count += 1

base = cases[1]["batch"]
for mutate in [
    lambda x: x.update(schemaVersion=99),
    lambda x: x["requests"][0]["days"].__setitem__(0, len(x["days"])),
    lambda x: x["requests"][0]["intervals"].__setitem__(0, len(x["intervals"])),
    lambda x: x["requests"][0]["days"].reverse(),
    lambda x: x["requests"][0].update(schemaVersion=2),
    lambda x: x["requests"][1].update(id=x["requests"][0]["id"]),
]:
    item = json.loads(json.dumps(base))
    mutate(item)
    assert "error" in call(json.dumps(item).encode())
for data in [b"", b"\xff", b"{}", b"x" * (4 * 1024 * 1024 + 1)]:
    assert "error" in call(data)
assert call(json.dumps(base).encode())["results"]
print(json.dumps({"sharedYearFullComparisons": count, "invalidInputGroups": 10, "recovery": "passed"}))
