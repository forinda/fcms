/**
 * Calling out on an owner's behalf (server-side request forgery).
 *
 * Each case is a way the old filter let a request through to the server's own
 * side of the network: an address it did not recognise, a public name that
 * resolves to a private one, or a redirect to one. The requests are real —
 * a server on loopback stands in for the admin or the metadata endpoint, and
 * every refusal has a control that reaches it, so a refusal is the guard and
 * not a test that could never connect.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent } from "undici";

import { guarded, isPublicAddress, reachable, send } from "../outbound";

describe("an address written into the URL", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    // The same places, written so the old filter did not recognise them.
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[0:0:0:0:0:ffff:7f00:1]/",
    "http://[::]/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://224.0.0.1/",
    "http://metadata.google.internal/",
  ])("refuses %s", (url) => {
    expect(reachable(url)).toBe(false);
  });

  it("allows a public one", () => {
    expect(reachable("https://hooks.slack.com/services/x")).toBe(true);
    expect(reachable("http://[::ffff:8.8.8.8]/")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });
});

describe("a name, at connect time", () => {
  let server: Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      hits += 1;
      if (request.url === "/hop") {
        response.writeHead(302, { location: `http://127.0.0.1:${port}/` }).end();
      } else response.end("the admin");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  /** A resolver that says `hooks.example.test` is loopback — what rebinding does. */
  const toLoopback = (
    _host: string,
    _options: unknown,
    callback: (error: null, addresses: { address: string; family: number }[]) => void,
  ) => callback(null, [{ address: "127.0.0.1", family: 4 }]);

  it("refuses a public-looking name that resolves to loopback", async () => {
    const before = hits;
    const agent = new Agent({ connect: { lookup: guarded(toLoopback) } });
    await expect(send(`http://hooks.example.test:${port}/`, {}, agent)).rejects.toThrow();
    expect(hits).toBe(before);
  });

  it("refuses when any one of its addresses is private", async () => {
    const agent = new Agent({
      connect: {
        lookup: guarded((_h, _o, callback) =>
          callback(null, [
            { address: "93.184.215.14", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]),
        ),
      },
    });
    await expect(send(`http://hooks.example.test:${port}/`, {}, agent)).rejects.toThrow();
  });

  it("is the guard that refuses: unguarded, the same request arrives", async () => {
    const before = hits;
    const agent = new Agent({ connect: { lookup: toLoopback as never } });
    const response = await send(`http://hooks.example.test:${port}/`, {}, agent);
    expect(await response.text()).toBe("the admin");
    expect(hits).toBe(before + 1);
  });

  it("does not follow a redirect, wherever it points", async () => {
    // Unguarded, so the connection itself is allowed: what is under test is
    // that the 302 to the admin is not followed.
    const agent = new Agent({ connect: { lookup: toLoopback as never } });
    const before = hits;
    await expect(send(`http://hooks.example.test:${port}/hop`, {}, agent)).rejects.toThrow();
    expect(hits).toBe(before + 1);
  });
});
