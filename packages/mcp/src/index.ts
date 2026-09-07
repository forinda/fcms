/**
 * The machine door (ADR 0015).
 *
 * Ten tools over `@forinda-cms/sdk`, and no database driver anywhere in the
 * dependency tree — which is what makes the safety argument structural rather
 * than careful. The server cannot read a table it was not given a route for,
 * cannot write SQL, and cannot reach a site the session does not scope it to,
 * because scoping is re-checked server-side on every call from the session
 * rather than taken from an argument (doc 04: *"never trust scoping the model
 * was told about"*).
 *
 * The shape of the write tools is the decision worth understanding: a caller
 * sends **the spec it wants**, and the server computes what changed. There is no
 * `add_field`, no `move_block`, no `set_block_attrs`. One tool asks what a
 * change would do and one does it, both running the same diff — so they cannot
 * disagree, and a model with a stale idea of the page cannot corrupt it by
 * index.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError, Client, type Plan } from "@forinda-cms/sdk";
import { SiteSpec } from "@forinda-cms/spec";
import { z } from "zod";

export interface ServerOptions {
  readonly client: Client;
  /** Overridden in tests; the real one comes from package.json. */
  readonly version?: string;
}

/**
 * A tool result, in the shape MCP expects.
 *
 * Text, not JSON-as-a-blob, wherever a human would read it: the destructive
 * warning ("340 customers will lose this field") is the whole point of the diff,
 * and a model that receives it as a nested object is one prompt away from not
 * mentioning it.
 */
function text(body: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof body === "string" ? body : JSON.stringify(body, null, 2),
      },
    ],
  };
}

function failure(message: string) {
  return { ...text(message), isError: true };
}

/** One place that turns a failed request into something a model can act on. */
function explain(error: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (!(error instanceof ApiError)) throw error;

  if (error.unauthorized) {
    return failure(
      "Not signed in to that site. The person running this server needs to run `fcms login`.",
    ) as never;
  }
  if (error.needsConfirmation) {
    // The refusal names its own resolution, because a model that does not know
    // `confirm` exists will report the failure instead of asking the human.
    return failure(
      `${error.message}\n\nThis change is destructive. Ask the person you are working with, ` +
        "and only then call site_apply again with confirm: true.",
    ) as never;
  }

  const issues = error.issues.map((i) => `  ${i.path} — ${i.message}`).join("\n");
  return failure(issues ? `${error.message}\n${issues}` : error.message) as never;
}

/** How a plan reads back — the owner's vocabulary, not a JSON patch. */
function describe(plan: Plan): string {
  if (plan.initial) {
    return "This site has no spec yet, so this would be the first publish. Nothing to compare against.";
  }
  if (plan.changes.length === 0) return "No changes — the site already matches this spec.";

  const lines = plan.changes.map((c) =>
    c.classification === "destructive"
      ? `  DESTRUCTIVE  ${c.summary}${c.impact ? ` — ${c.impact}` : ""}`
      : `  ${c.classification}  ${c.summary}`,
  );

  const steps = plan.migration.length > 0 ? `\n${plan.migration.length} migration step(s).` : "";
  const gate =
    plan.destructive > 0
      ? `\n\n${plan.destructive} destructive change(s). site_apply refuses these unless confirm is true.`
      : "";

  return `${lines.join("\n")}${steps}${gate}`;
}

const SPEC_ARG = {
  spec: z
    .unknown()
    .describe(
      "The complete site spec you want, as JSON — not a patch and not a diff. " +
        "Fetch the current one with site_spec, change what you mean to change, and send the whole thing back.",
    ),
};

const ENTRY_ARGS = {
  type: z.string().describe("The content type's key, as declared in the spec."),
  data: z
    .record(z.string(), z.unknown())
    .describe("The entry's fields, validated against that type."),
  slug: z
    .string()
    .optional()
    .describe("The entry's address. Omit for a type with no page of its own."),
  status: z.enum(["draft", "published"]).optional(),
};

export function createServer({ client, version = "0.0.0" }: ServerOptions): McpServer {
  const server = new McpServer({ name: "forinda-cms", version });

  server.registerTool(
    "site_status",
    {
      title: "Site status",
      description:
        "What this site is: its name, how many content types and pages it has, how many entries of each type, and the last change made to it. Start here.",
      inputSchema: {},
    },
    async () => {
      try {
        const status = await client.status();
        if (!status.site) return text("This site has no spec yet.");
        return text(status);
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "site_spec",
    {
      title: "Read the spec",
      description:
        "The whole site spec: content types, pages, logic, access and integrations. This is the source of truth — the site is generated from it.",
      inputSchema: {},
    },
    async () => {
      try {
        return text(await client.spec());
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "site_plan",
    {
      title: "Plan a change",
      description:
        "What applying this spec would do, described the way you would explain it to the site's owner. Writes nothing. Always plan before you apply.",
      inputSchema: SPEC_ARG,
    },
    async ({ spec }) => {
      const parsed = SiteSpec.safeParse(spec);
      if (!parsed.success) return failure(invalid(parsed.error.issues));

      try {
        return text(describe(await client.plan(parsed.data)));
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "site_apply",
    {
      title: "Apply a change",
      description:
        "Apply this spec to the site. Destructive changes — anything that loses data — are refused unless confirm is true, and you should ask a person before setting it.",
      inputSchema: {
        ...SPEC_ARG,
        confirm: z
          .boolean()
          .optional()
          .describe(
            "Set only after a human has agreed to the destructive changes site_plan listed.",
          ),
      },
    },
    async ({ spec, confirm }) => {
      const parsed = SiteSpec.safeParse(spec);
      if (!parsed.success) return failure(invalid(parsed.error.issues));

      try {
        const result = await client.apply(parsed.data, { allowDestructive: confirm === true });
        return text(
          `Applied as patch #${result.seq}.` +
            (result.migration.length > 0 ? ` ${result.migration.length} migration step(s).` : "") +
            " Undo it with site_undo.",
        );
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "site_history",
    {
      title: "What has changed",
      description:
        "Recent changes to the site, newest first: who made each one, which surface it came through, and whether it was destructive.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ limit }) => {
      try {
        return text(await client.history(limit ?? 20));
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "site_undo",
    {
      title: "Undo the last change",
      description:
        "Reverse the most recent change. Every change is stored with its inverse, so this is exact rather than a guess at the opposite.",
      inputSchema: {},
    },
    async () => {
      try {
        const { seq } = await client.undo();
        return text(`Reversed patch #${seq}.`);
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "entry_list",
    {
      title: "List entries",
      description: "Every entry of one content type, with its id, slug, status and fields.",
      inputSchema: { type: ENTRY_ARGS.type },
    },
    async ({ type }) => {
      try {
        return text(await client.entries(type));
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "entry_create",
    {
      title: "Create an entry",
      description:
        "Add one entry of a content type. The fields are validated against that type — a field nobody declared is rejected rather than stored.",
      inputSchema: ENTRY_ARGS,
    },
    async ({ type, data, slug, status }) => {
      try {
        return text(await client.createEntry(type, { data, slug, status }));
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "entry_update",
    {
      title: "Update an entry",
      description:
        "Replace one entry's fields. Send the fields you want it to have — this is not a partial patch.",
      inputSchema: { ...ENTRY_ARGS, id: z.string().describe("The entry's id, from entry_list.") },
    },
    async ({ type, id, data, slug, status }) => {
      try {
        return text(await client.updateEntry(type, id, { data, slug, status }));
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "entry_delete",
    {
      title: "Delete an entry",
      description:
        "Remove one entry. Unlike a spec change this is not undoable from history — ask before calling it.",
      inputSchema: { type: ENTRY_ARGS.type, id: z.string() },
    },
    async ({ type, id }) => {
      try {
        await client.deleteEntry(type, id);
        return text(`Deleted ${id}.`);
      } catch (error) {
        return explain(error);
      }
    },
  );

  return server;
}

function invalid(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const lines = issues.map((i) => `  /${i.path.join("/")} — ${i.message}`).join("\n");
  return `That is not a valid spec:\n${lines}`;
}

export { Client } from "@forinda-cms/sdk";
