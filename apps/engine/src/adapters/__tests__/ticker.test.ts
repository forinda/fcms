/**
 * The schedule's owner, across module reloads.
 *
 * This exists because of a bug that only appears in development and never
 * stops: an interval created in a module graph the reload has replaced keeps
 * calling code whose imports are gone, so `migrateSpec is not a function`
 * arrives on a timer, forever, from a file nobody is editing.
 */
import { describe, expect, it } from "vitest";

import { workflowsTicker } from "../workflows.adapter";

const { claim, owns } = workflowsTicker;

describe("who owns the schedule", () => {
  it("gives ownership to the application that started last", () => {
    const first = claim();
    expect(owns(first)).toBe(true);

    // A reload: a second application starts while the first one's timer is
    // still in the event loop.
    const second = claim();
    expect(owns(second)).toBe(true);
    expect(owns(first)).toBe(false);
  });

  it("counts on the process, not on this module", () => {
    // A closure-local flag cannot answer the question, because the superseded
    // interval has its own copy of every variable in that file. The counter is
    // on `globalThis` so a stale tick can see that it is stale.
    const host = globalThis as unknown as Record<symbol, number | undefined>;
    const before = host[workflowsTicker.GENERATION] ?? 0;

    const mine = claim();
    expect(host[workflowsTicker.GENERATION]).toBe(before + 1);
    expect(mine).toBe(before + 1);
  });
});
