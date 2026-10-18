import { describe, it, expect, vi } from "vitest";
import { saveAccountName } from "./save-account-name";

function fixture() {
  return {
    isCurrentAccount: vi.fn(() => true),
    updateName: vi.fn(async (_id: string, _first: string, _last: string) => ({
      displayName: "Alex Sommer",
    })),
    saveSharingName: vi.fn(async (_id: string, _name: string) => undefined),
    refreshAccount: vi.fn(async () => undefined),
  };
}
describe("one account name for private cloud and sharing", () => {
  it("uses the same expected account and canonical name in both stores", async () => {
    const p = fixture();
    await saveAccountName(p, "a", " Alex ", "Sommer");
    expect(p.updateName).toHaveBeenCalledWith("a", " Alex ", "Sommer");
    expect(p.saveSharingName).toHaveBeenCalledWith("a", "Alex Sommer");
    expect(p.refreshAccount).toHaveBeenCalledOnce();
  });
  it.each([0, 1, 2])("stops after account changes at checkpoint %i", async (checkpoint) => {
    const p = fixture();
    let calls = 0;
    p.isCurrentAccount.mockImplementation(() => calls++ < checkpoint);
    await expect(saveAccountName(p, "a", "Alex", "Sommer")).rejects.toThrow(
      "Konto hat sich geändert",
    );
    expect(p.updateName).toHaveBeenCalledTimes(checkpoint > 0 ? 1 : 0);
    expect(p.saveSharingName).toHaveBeenCalledTimes(checkpoint > 1 ? 1 : 0);
    expect(p.refreshAccount).not.toHaveBeenCalled();
  });
  it("keeps failure retryable when the sharing profile cannot be saved", async () => {
    const p = fixture();
    p.saveSharingName.mockRejectedValueOnce(new Error("offline"));
    await expect(saveAccountName(p, "a", "Alex", "Sommer")).rejects.toThrow("offline");
    expect(p.refreshAccount).not.toHaveBeenCalled();
    await saveAccountName(p, "a", "Alex", "Sommer");
    expect(p.refreshAccount).toHaveBeenCalledOnce();
  });
});
