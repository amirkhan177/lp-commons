import { describe, expect, it } from "vitest";
import { filterSql, hasFilters, parseFilters } from "@/lib/fund-filters";

describe("fund filters", () => {
  it("parses only allowed values", () => {
    expect(parseFilters({ status: "raising", remaining: "10000000", raised: "50000000" }))
      .toEqual({ status: "raising", minRemaining: 10e6, minRaised: 50e6 });
    expect(parseFilters({ status: "drop table", remaining: "123", raised: "-1" }))
      .toEqual({ status: null, minRemaining: null, minRaised: null });
    expect(hasFilters(parseFilters({}))).toBe(false);
  });

  it("builds parameterized SQL after existing params", () => {
    const params: unknown[] = [1, "x"];
    const sql = filterSql({ status: "fresh_capital", minRemaining: 1e6, minRaised: 10e6 }, "fp", params);
    expect(sql).toBe(" AND fp.raise_status = $3 AND (fp.offering_indefinite OR fp.remaining_to_raise >= $4) AND fp.total_amount_sold >= $5");
    expect(params).toEqual([1, "x", "fresh_capital", 1e6, 10e6]);
    expect(filterSql({ status: null, minRemaining: null, minRaised: null }, "fp", [])).toBe("");
  });
});
