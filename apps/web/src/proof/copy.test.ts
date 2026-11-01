import { describe, expect, it } from "vitest";
import { calendarFile } from "./copy";

describe("calendarFile", () => {
  it("keeps a product name from adding lines or fields to the file", () => {
    const text = calendarFile(
      "Serum\r\nATTENDEE:x@evil.test;\\, \u0000",
      new Date("2026-11-08T09:00:00Z"),
    );
    const lines = text.split("\r\n");
    expect(lines.filter((l) => l.startsWith("ATTENDEE"))).toEqual([]);
    expect(lines.find((l) => l.startsWith("SUMMARY"))?.trim()).toBe(
      "SUMMARY:MIRA check-in: Serum  ATTENDEE:x@evil.test",
    );
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
  });
});
