/**
 * The script sandbox (ADR 0031).
 *
 * This is the file that has to be right. A script step puts code — possibly
 * written by a model, in a document somebody approved in a hurry — inside the
 * platform, and the only thing between that and the database is what is tested
 * here.
 *
 * Each case is an escape somebody would actually try.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, runScript, timeoutOf } from "../sandbox";

const run = (code: string, input: unknown = {}, ms?: number) => runScript(code, input, ms);

describe("what a script can do", () => {
  it("returns a value from its input", async () => {
    const result = await run("return input.a + input.b", { a: 2, b: 3 });
    expect(result).toMatchObject({ value: 5 });
  });

  it("does the thing declarative steps cannot", async () => {
    // The case the escape hatch exists for: arithmetic over a shape.
    const result = await run(
      `const net = input.lines.reduce((sum, l) => sum + l.amount, 0);
       return { net, vat: Math.round(net * 0.16), lines: input.lines.length };`,
      { lines: [{ amount: 1500 }, { amount: 4500 }] },
    );
    expect(result.value).toEqual({ net: 6000, vat: 960, lines: 2 });
  });

  it("keeps what it logged, without anywhere for it to go", async () => {
    const result = await run('console.log("halfway"); return 1');
    expect(result.logs).toEqual(["halfway"]);
  });

  it("reports its own error rather than failing the process", async () => {
    const result = await run('throw new Error("nope")');
    expect(result.error).toBe("nope");
  });
});

describe("what a script cannot reach", () => {
  const absent = [
    ["the process", "return typeof process"],
    ["require", "return typeof require"],
    ["the network", "return typeof fetch"],
    ["timers that outlive it", "return typeof setInterval"],
    ["the module system", "return typeof module"],
  ] as const;

  for (const [what, code] of absent) {
    it(`cannot see ${what}`, async () => {
      const result = await run(code);
      expect(result.value === "undefined" || result.value === 0).toBe(true);
    });
  }

  it("has nothing on its global but the console it was given", async () => {
    // Nothing to hang state on between runs, and nothing inherited: the context
    // is made with a null prototype.
    const result = await run("return Object.keys(globalThis).join(',')");
    expect(result.value).toBe("console");
  });

  it("cannot import anything, dynamically or otherwise", async () => {
    expect((await run('return import("node:fs")')).error).toBeDefined();
    expect((await run('return require("node:fs")')).error).toBeDefined();
  });

  it("cannot climb out through a constructor", async () => {
    // The classic `vm` escape. It finds the sandbox's own globals, where
    // `process` does not exist.
    const result = await run("return this.constructor.constructor('return process')()");
    expect(result.error).toMatch(/process is not defined/);
  });

  // The same climb through anything handed in from outside. A function or
  // object made in the runner's own realm has that realm's `Function` as its
  // constructor's constructor — and that one *can* see `process`. Each of
  // these reached it, and from there the network, which `--permission` does
  // not cover on this Node.
  it.each([
    ["the console it was given", "console.log.constructor('return process')()"],
    ["its input", "input.constructor.constructor('return process')()"],
    ["something nested in its input", "input.lines.constructor.constructor('return process')()"],
    [
      "the console's own prototype",
      "Object.getPrototypeOf(console).constructor.constructor('return process')()",
    ],
  ])("cannot climb out through %s", async (_, climb) => {
    const result = await run(`return typeof (${climb}).pid`, { lines: [1] });
    expect(result.value).not.toBe("number");
    expect(result.error).toMatch(/process is not defined/);
  });

  it("cannot climb out through whatever settles what it returns", async () => {
    // Returning a thenable makes whoever awaits it call `then` with *its*
    // resolve and reject — functions from the awaiting realm. If the runner
    // awaits it, those are the runner's, and their constructor sees
    // `process`: the reply then carries a real pid.
    const result = await run(
      `return { then(resolve) {
         try { resolve(typeof resolve.constructor("return process")().pid); }
         catch (error) { resolve("refused: " + error.message); }
       } }`,
    );
    expect(result.value).not.toBe("number");
    expect(String(result.value)).toMatch(/process is not defined/);
  });

  it("cannot climb out through a 'then' it planted for whoever settles it", async () => {
    // A script can replace its own realm's Promise.prototype.then. Nothing
    // that settles its value may call it: the runner never awaits the
    // context, and the settling code uses the 'then' taken before the script
    // ran. Were it called, the reply would carry what it found instead of 1.
    const result = await run(
      `const then = Promise.prototype.then;
       Promise.prototype.then = function (resolve, reject) {
         let found;
         try { found = typeof resolve.constructor("return process")().pid; }
         catch (error) { found = "refused: " + error.message; }
         Promise.prototype.then = then;
         return then.call(Promise.resolve(found), resolve, reject);
       };
       return Promise.resolve(1);`,
    );
    expect(result, JSON.stringify(result)).toMatchObject({ value: 1 });
  });

  it("cannot change what it hands back by replacing its own JSON", async () => {
    const result = await run("JSON.stringify = () => ({ length: 1 }); return 1");
    expect(result).toMatchObject({ value: 1 });
  });

  it("cannot read a file, even when it asks the runtime nicely", async () => {
    // Belt and braces: the `vm` has no `require`, and the process itself is
    // started with the filesystem denied.
    const result = await run('return process.binding("fs")');
    expect(result.error).toBeDefined();
    expect(result.value).toBeUndefined();
  });

  it("cannot see the environment it was started from", async () => {
    const result = await run("return typeof process === 'undefined' ? 'no process' : 'leaked'");
    expect(result.value).toBe("no process");
  });
});

describe("what stops a script that is merely wrong", () => {
  it("stops one that loops forever", async () => {
    const result = await run("while (true) {}", {}, 300);
    expect(result.error).toMatch(/took longer|Script execution timed out/);
  }, 10_000);

  it("stops one that never settles", async () => {
    // A promise that never resolves reaches no `vm` timeout — only the wall
    // clock and a killed process stop it.
    const result = await run("return new Promise(() => {})", {}, 300);
    expect(result.error).toMatch(/took longer/);
  }, 10_000);

  it("refuses to return more than it should", async () => {
    const result = await run('return "x".repeat(300000)');
    expect(result.error).toBe("returned too much");
  }, 10_000);

  it("caps what anyone may ask for", () => {
    expect(timeoutOf(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutOf("500")).toBe(500);
    expect(timeoutOf(60_000)).toBe(MAX_TIMEOUT_MS);
    expect(timeoutOf(-1)).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutOf("forever")).toBe(DEFAULT_TIMEOUT_MS);
  });
});
