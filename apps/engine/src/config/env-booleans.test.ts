/**
 * A switch written `false` is off.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, and every non-empty string is
 * true — so `SECURE_COOKIES=false` marked cookies `Secure` and a plain-HTTP
 * install could not keep anybody signed in, and `TRUST_PROXY=false` trusted
 * the proxy it was written to refuse.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getEnv, reloadEnv } from "@forinda/kickjs";

import "./index";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  reloadEnv();
});

const read = (name: "SECURE_COOKIES" | "TRUST_PROXY", value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  reloadEnv();
  return getEnv(name);
};

describe.each(["SECURE_COOKIES", "TRUST_PROXY"] as const)("%s", (name) => {
  it("is off when written false", () => {
    expect(read(name, "false")).toBe(false);
    expect(read(name, "0")).toBe(false);
  });

  it("is on when written true", () => {
    expect(read(name, "true")).toBe(true);
    expect(read(name, "1")).toBe(true);
  });

  it("is off when not written at all", () => {
    expect(read(name, undefined)).toBe(false);
  });
});
