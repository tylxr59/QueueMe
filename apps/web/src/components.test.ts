import { describe, expect, it } from "vitest";
import { humanize } from "./components";

describe("humanize", () => {
  it("turns machine state into readable copy", () => {
    expect(humanize("restart_recovery")).toBe("Restart recovery");
  });
});

