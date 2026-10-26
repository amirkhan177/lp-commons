import { describe, expect, it } from "vitest";
import { businessDaysBetween, digestAnchor, digestText, isDue, isStale, mappingNotice, shouldAlert } from "@/lib/schedule";

const at = (s: string) => new Date(s);

describe("schedule", () => {
  it("anchors the digest to Monday 14:00 UTC", () => {
    expect(digestAnchor(at("2026-10-26T15:00:00Z")).toISOString()).toBe("2026-10-26T14:00:00.000Z"); // Monday after 14:00
    expect(digestAnchor(at("2026-10-26T09:00:00Z")).toISOString()).toBe("2026-10-19T14:00:00.000Z"); // Monday before 14:00
    expect(digestAnchor(at("2026-10-29T09:00:00Z")).toISOString()).toBe("2026-10-26T14:00:00.000Z"); // Thursday
  });

  it("decides what is due", () => {
    const now = at("2026-10-29T12:00:00Z");
    expect(isDue("weekly_remap", null, now)).toBe(true);
    expect(isDue("weekly_remap", at("2026-10-23T12:00:00Z"), now)).toBe(false);
    expect(isDue("weekly_remap", at("2026-10-22T12:00:00Z"), now)).toBe(true);
    expect(isDue("freshness_check", at("2026-10-29T07:00:00Z"), now)).toBe(false);
    expect(isDue("freshness_check", at("2026-10-29T05:00:00Z"), now)).toBe(true);
    expect(isDue("weekly_digest", at("2026-10-26T14:30:00Z"), now)).toBe(false); // already sent this week
    expect(isDue("weekly_digest", at("2026-10-20T14:30:00Z"), now)).toBe(true);
  });

  it("counts business days and flags stale data", () => {
    expect(businessDaysBetween(at("2026-10-23T00:00:00Z"), at("2026-10-26T00:00:00Z"))).toBe(1); // Fri -> Mon
    expect(isStale(at("2026-10-23T00:00:00Z"), at("2026-10-28T10:00:00Z"))).toBe(false); // Fri -> Wed: 3
    expect(isStale(at("2026-10-23T00:00:00Z"), at("2026-10-29T10:00:00Z"))).toBe(true);  // Fri -> Thu: 4
    expect(isStale(null, at("2026-10-29T10:00:00Z"))).toBe(true);
  });

  it("re-alerts at most daily", () => {
    const now = at("2026-10-29T12:00:00Z");
    expect(shouldAlert(true, null, now)).toBe(true);
    expect(shouldAlert(true, at("2026-10-29T01:00:00Z"), now)).toBe(false);
    expect(shouldAlert(true, at("2026-10-28T11:00:00Z"), now)).toBe(true);
    expect(shouldAlert(false, null, now)).toBe(false);
  });

  it("writes the digest", () => {
    expect(digestText({ newRaising: 37, reachable: 5, strong: 2, top: ["A Fund", "B Fund", "C Fund"] })).toEqual({
      title: "This week: 37 new funds started raising",
      body: "37 new funds started raising this week. 5 reachable through your network (2 with a strong path): A Fund, B Fund, C Fund and 2 more.",
    });
    expect(digestText({ newRaising: 1, reachable: 0, strong: 0, top: [] }).body)
      .toBe("1 new fund started raising this week. None are reachable through your network yet.");
  });
});


describe("mapping notifications", () => {
  it("always reports runs the user started", () => {
    expect(mappingNotice("linkedin_import", 9, { funds_reachable: 9, strong_paths: 2 })?.title).toBe("Your intro map is ready");
  });
  it("keeps background re-maps quiet unless reach grew", () => {
    expect(mappingNotice("new_filings", 9, { funds_reachable: 9, strong_paths: 2 })).toBeNull();
    expect(mappingNotice("weekly", 9, { funds_reachable: 7, strong_paths: 2 })).toBeNull();
    expect(mappingNotice("new_filings", 9, { funds_reachable: 12, strong_paths: 3 })?.title).toBe("3 more funds reachable");
  });
});
