import { describe, expect, it } from "vitest";
import { formatDuration, humanize } from "./components";

describe("humanize", () => {
  it("turns machine state into readable copy", () => {
    expect(humanize("restart_recovery")).toBe("Restart recovery");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds as minutes and seconds", () => {
    expect(formatDuration(12_900)).toBe("0:12");
    expect(formatDuration(134_000)).toBe("2:14");
  });
});
