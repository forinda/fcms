/**
 * The cron subset (ADR 0024 §7).
 *
 * These exist because the alternative to forty lines is a dependency that runs
 * unattended on every install — so the forty lines have to be right.
 */
import { describe, expect, it } from "vitest";

import { parseCron } from "../cron";

const at = (iso: string) => new Date(iso);
const matches = (expression: string, iso: string) => parseCron(expression)!.matches(at(iso));

describe("cron", () => {
  it("matches every minute", () => {
    expect(matches("* * * * *", "2026-09-07T13:37:00Z")).toBe(true);
  });

  it("matches a time of day", () => {
    expect(matches("30 9 * * *", "2026-09-07T09:30:00Z")).toBe(true);
    expect(matches("30 9 * * *", "2026-09-07T09:31:00Z")).toBe(false);
    expect(matches("30 9 * * *", "2026-09-07T10:30:00Z")).toBe(false);
  });

  it("matches steps, lists and ranges", () => {
    expect(matches("*/15 * * * *", "2026-09-07T10:45:00Z")).toBe(true);
    expect(matches("*/15 * * * *", "2026-09-07T10:46:00Z")).toBe(false);
    expect(matches("0 9-17 * * *", "2026-09-07T17:00:00Z")).toBe(true);
    expect(matches("0 9-17 * * *", "2026-09-07T18:00:00Z")).toBe(false);
    expect(matches("0 0 1,15 * *", "2026-09-15T00:00:00Z")).toBe(true);
    expect(matches("0 0 1,15 * *", "2026-09-16T00:00:00Z")).toBe(false);
    // `5/10` means from 5 onwards, not "every 10th from 0".
    expect(matches("5/10 * * * *", "2026-09-07T10:25:00Z")).toBe(true);
    expect(matches("5/10 * * * *", "2026-09-07T10:20:00Z")).toBe(false);
  });

  it("keeps cron's own day-of-month/day-of-week oddity", () => {
    // 2026-09-07 is a Monday, the 7th. With both day fields restricted the rule
    // is *or*: "the 1st, or any Monday".
    expect(matches("0 0 1 * 1", "2026-09-07T00:00:00Z")).toBe(true);
    expect(matches("0 0 1 * 1", "2026-09-01T00:00:00Z")).toBe(true);
    expect(matches("0 0 1 * 1", "2026-09-08T00:00:00Z")).toBe(false);
    // With only one restricted it is a plain match.
    expect(matches("0 0 * * 1", "2026-09-08T00:00:00Z")).toBe(false);
  });

  it("refuses what it does not understand rather than approximating", () => {
    // A schedule that runs at the wrong time is worse than one that was
    // rejected at validation.
    expect(parseCron("@daily")).toBeNull();
    expect(parseCron("0 0 * *")).toBeNull();
    expect(parseCron("0 0 * * * *")).toBeNull();
    expect(parseCron("61 * * * *")).toBeNull();
    expect(parseCron("* 24 * * *")).toBeNull();
    expect(parseCron("0 0 0 * *")).toBeNull();
    expect(parseCron("*/0 * * * *")).toBeNull();
    expect(parseCron("17-9 * * * *")).toBeNull();
    expect(parseCron("nonsense")).toBeNull();
  });
});
