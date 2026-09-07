/**
 * The tool table, driven through a real MCP client.
 *
 * In-memory transport rather than mocks, so these exercise what an agent
 * actually gets: the schemas, the descriptions, and the text a failure comes
 * back as. The properties worth holding are the ones ADR 0015 argues make this
 * safe — the table stays small, nothing takes SQL or a path, a destructive
 * refusal explains its own resolution, and every write goes through the SDK.
 */
import { describe, expect, it } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApiError, Client } from "@forinda-cms/sdk";
import { SiteSpec } from "@forinda-cms/spec";

import { createServer } from "./index.js";

const spec = SiteSpec.parse({
  specVersion: 2,
  name: "Riverside Salon",
  theme: { colors: { brand: "#1a7f5a" }, fonts: { body: "Inter" }, typeScale: { md: "1rem" } },
  content: [
    {
      key: "service",
      label: "Service",
      fields: [{ name: "name", label: "Name", type: "text", required: true }],
    },
  ],
  pages: [],
});

/** A `Client` with the methods a test needs replaced, and the rest left to fail loudly. */
function stubClient(overrides: Partial<Client>): Client {
  return Object.assign(Object.create(Client.prototype) as Client, overrides);
}

async function connect(client: Client) {
  const server = createServer({ client });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new McpClient({ name: "test", version: "0" });
  await Promise.all([mcp.connect(clientTransport), server.connect(serverTransport)]);
  return mcp;
}

const textOf = (result: unknown) =>
  ((result as { content: { text: string }[] }).content ?? []).map((c) => c.text).join("\n");

describe("the tool table", () => {
  it("is the ten tools ADR 0015 lists, and nothing else", async () => {
    const mcp = await connect(stubClient({}));
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();

    expect(names).toEqual([
      "entry_create",
      "entry_delete",
      "entry_list",
      "entry_update",
      "site_apply",
      "site_history",
      "site_plan",
      "site_spec",
      "site_status",
      "site_undo",
    ]);
  });

  it("takes no argument that is SQL, a path, or a command", async () => {
    // The safety argument is the table itself: a hallucination's blast radius is
    // bounded by what can be named here. This test is that argument, executable.
    //
    // Names and argument names, not the serialised listing — that carries the
    // protocol's own metadata (`execution`, `$schema`), which matches a crude
    // substring scan and would make this pass or fail for reasons that have
    // nothing to do with our tools.
    const mcp = await connect(stubClient({}));
    const tools = (await mcp.listTools()).tools;

    const surface = tools.flatMap((tool) => [
      tool.name,
      ...Object.keys((tool.inputSchema as { properties?: object }).properties ?? {}),
    ]);

    for (const name of surface) {
      expect(name).not.toMatch(/sql|query|exec|shell|eval|file|path|command|script/i);
    }
  });

  it("offers no fine-grained edit verbs — the caller declares a whole spec", async () => {
    const mcp = await connect(stubClient({}));
    const names = (await mcp.listTools()).tools.map((t) => t.name);

    for (const verb of [
      "add_field",
      "remove_field",
      "move_block",
      "set_block_attrs",
      "create_page",
    ]) {
      expect(names).not.toContain(verb);
    }
  });
});

describe("planning", () => {
  it("describes changes in the owner's vocabulary, not as a patch", async () => {
    const mcp = await connect(
      stubClient({
        plan: async () => ({
          initial: false,
          destructive: 1,
          migration: [{ kind: "purge-field", statement: "…" }],
          changes: [
            {
              path: "/content/service/fields/blurb",
              classification: "destructive",
              summary: "Removes the Short description field from Service.",
              impact: "340 entries have a value; it is not kept.",
            },
            { path: "/name", classification: "additive", summary: "Renames the site." },
          ],
        }),
      }),
    );

    const out = textOf(await mcp.callTool({ name: "site_plan", arguments: { spec } }));

    expect(out).toContain("DESTRUCTIVE");
    expect(out).toContain("340 entries have a value");
    expect(out).toContain("Renames the site.");
    // And it says what the gate will do, so the model does not discover it by
    // being refused.
    expect(out).toContain("confirm");
  });

  it("rejects a malformed spec locally, naming the path", async () => {
    const mcp = await connect(
      stubClient({
        plan: async () => {
          throw new Error("must not reach the server");
        },
      }),
    );

    const out = textOf(await mcp.callTool({ name: "site_plan", arguments: { spec: { name: 1 } } }));
    expect(out).toContain("not a valid spec");
    expect(out).toContain("/name");
  });
});

describe("the destructive gate", () => {
  it("refuses, and the refusal names its own resolution", async () => {
    const mcp = await connect(
      stubClient({
        apply: async () => {
          throw new ApiError(409, "refusing 1 destructive change(s)");
        },
      }),
    );

    const result = await mcp.callTool({ name: "site_apply", arguments: { spec } });
    expect((result as { isError?: boolean }).isError).toBe(true);

    const out = textOf(result);
    expect(out).toContain("destructive");
    // A model told only "refused" reports failure; a model told how to proceed
    // asks the human, which is the behaviour this exists to produce.
    expect(out).toContain("confirm: true");
  });

  it("passes confirmation through only when it is given", async () => {
    const seen: boolean[] = [];
    const mcp = await connect(
      stubClient({
        apply: async (_spec, options) => {
          seen.push(options?.allowDestructive === true);
          return { seq: 4, changes: [], migration: [] };
        },
      }),
    );

    await mcp.callTool({ name: "site_apply", arguments: { spec } });
    await mcp.callTool({ name: "site_apply", arguments: { spec, confirm: true } });

    expect(seen).toEqual([false, true]);
  });

  it("points at sign-in when the session is gone", async () => {
    const mcp = await connect(
      stubClient({
        status: async () => {
          throw new ApiError(401, "Sign in to continue.");
        },
      }),
    );

    expect(textOf(await mcp.callTool({ name: "site_status", arguments: {} }))).toContain(
      "fcms login",
    );
  });
});

describe("entries", () => {
  it("creates one through the client, with its type and fields", async () => {
    const calls: unknown[] = [];
    const mcp = await connect(
      stubClient({
        createEntry: async (type, input) => {
          calls.push({ type, input });
          return { id: "1", slug: "cut", status: "draft", data: input.data, updatedAt: "" };
        },
      }),
    );

    await mcp.callTool({
      name: "entry_create",
      arguments: { type: "service", data: { name: "Cut" }, slug: "cut" },
    });

    expect(calls).toEqual([
      { type: "service", input: { data: { name: "Cut" }, slug: "cut", status: undefined } },
    ]);
  });

  it("surfaces field-level validation errors as the server named them", async () => {
    const mcp = await connect(
      stubClient({
        createEntry: async () => {
          throw new ApiError(422, "That entry is not valid.", [
            { path: "name", message: "This is required." },
          ]);
        },
      }),
    );

    const out = textOf(
      await mcp.callTool({ name: "entry_create", arguments: { type: "service", data: {} } }),
    );
    expect(out).toContain("name");
    expect(out).toContain("This is required.");
  });
});
