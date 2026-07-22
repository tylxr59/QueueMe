import { describe, expect, it } from "vitest";
import { applyPinnedPositions, fifoPolicy, roundRobinPolicy, type PendingQueueItem } from "./index.js";

const item = (id: string, guestId: string, arrivalSequence: number, pinnedPosition: number | null = null): PendingQueueItem => ({
  id,
  guestId,
  arrivalSequence,
  pinnedPosition,
});

describe("queue ordering", () => {
  it("orders FIFO", () => {
    expect(fifoPolicy.order([item("b", "g", 2), item("a", "g", 1)], null)).toEqual(["a", "b"]);
  });

  it("round robins by guest", () => {
    const items = [item("a1", "a", 1), item("a2", "a", 2), item("b1", "b", 3), item("b2", "b", 4)];
    expect(roundRobinPolicy.order(items, null)).toEqual(["a1", "b1", "a2", "b2"]);
    expect(roundRobinPolicy.order(items, "a")).toEqual(["b1", "a1", "b2", "a2"]);
  });

  it("keeps pinned slots while policy fills gaps", () => {
    const items = [item("a", "a", 1), item("b", "b", 2, 0), item("c", "c", 3)];
    expect(applyPinnedPositions(["a", "b", "c"], items)).toEqual(["b", "a", "c"]);
  });
});

