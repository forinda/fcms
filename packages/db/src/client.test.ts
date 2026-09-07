/**
 * Pool sharing, and the shutdown that used to break the dev server.
 *
 * postgres.js connects lazily, so a client can be created and released here
 * without a database — what is under test is the bookkeeping, not the socket.
 */
import { describe, expect, it } from "vitest";

import { closeAllPools, createDb, releaseDb } from "./client.js";

const URL_ = "postgres://nobody:nothing@127.0.0.1:1/unused";

describe("connection pooling", () => {
  it("shares one client between holders of the same URL", () => {
    const a = createDb(URL_);
    const b = createDb(URL_);
    expect(a.$client).toBe(b.$client);
    return closeAllPools();
  });

  it("keeps the pool alive while another holder has it", async () => {
    // What `kick dev` does on every save: the reloaded application builds and
    // takes the pool, then the previous one shuts down. Ending it there ended
    // the new application's connection, and every request after a file save
    // failed with `write CONNECTION_ENDED`.
    const reloaded = createDb(URL_);
    const previous = createDb(URL_);
    expect(reloaded.$client).toBe(previous.$client);

    await releaseDb(URL_);

    // Same client, still the one the surviving application holds.
    expect(createDb(URL_).$client).toBe(reloaded.$client);
    await closeAllPools();
  });

  it("closes the pool once the last holder lets go", async () => {
    const first = createDb(URL_);
    await releaseDb(URL_);

    // A fresh pool, because the old one was closed rather than handed back.
    const second = createDb(URL_);
    expect(second.$client).not.toBe(first.$client);
    await closeAllPools();
  });

  it("survives a release nobody asked for", async () => {
    await expect(releaseDb("postgres://never:opened@127.0.0.1:1/x")).resolves.toBeUndefined();
  });
});
