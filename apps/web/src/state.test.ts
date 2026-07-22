import { describe, expect, it } from "vitest";
import { newestSnapshot } from "./state";

describe("newestSnapshot", () => {
  it("does not let a late response overwrite newer socket state", () => {
    const promoted = { revision: 2, state: "current" };
    const staleEnqueueResponse = { revision: 1, state: "queued" };

    expect(newestSnapshot(promoted, staleEnqueueResponse)).toBe(promoted);
  });

  it("accepts a newer snapshot", () => {
    const queued = { revision: 1, state: "queued" };
    const promoted = { revision: 2, state: "current" };

    expect(newestSnapshot(queued, promoted)).toBe(promoted);
  });
});
