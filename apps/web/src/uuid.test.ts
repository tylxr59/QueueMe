import { describe, expect, it, vi } from "vitest";
import { createClientRequestId } from "./uuid";

describe("createClientRequestId", () => {
  it("uses crypto.randomUUID when the browser provides it", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes);

    expect(createClientRequestId({ randomUUID: () => id, getRandomValues })).toBe(id);
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("creates a valid v4 UUID when randomUUID is unavailable", () => {
    const getRandomValues = (bytes: Uint8Array) => {
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return bytes;
    };

    expect(createClientRequestId({ getRandomValues })).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});
