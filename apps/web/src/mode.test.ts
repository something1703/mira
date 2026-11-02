import { describe, expect, it } from "vitest";
import { spendsRealUnits } from "./mode";

describe("spendsRealUnits", () => {
  it("is true in live mode and with real YouCam behind local state", () => {
    expect(spendsRealUnits({ MIRA_MODE: "live" })).toBe(true);
    expect(spendsRealUnits({ MIRA_MODE: "mock", MIRA_YOUCAM: "live" })).toBe(true);
  });

  it("is false with synthetic YouCam", () => {
    expect(spendsRealUnits({ MIRA_MODE: "mock" })).toBe(false);
    expect(spendsRealUnits({ MIRA_MODE: "mock", MIRA_YOUCAM: "fake" })).toBe(false);
    expect(spendsRealUnits({})).toBe(false);
  });
});
