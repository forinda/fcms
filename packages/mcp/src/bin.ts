#!/usr/bin/env node
/**
 * `fcms-mcp` — the server as a process.
 *
 * Speaks MCP over stdio, which is how an editor or agent runtime launches it:
 * one process per session, no port, no listener on the machine. Configuration
 * is the same link and token `fcms login` already wrote (ADR 0015 §4), so a
 * developer who can use the CLI can use this without a second credential.
 *
 *   {
 *     "mcpServers": {
 *       "forinda-cms": { "command": "fcms-mcp", "args": ["/path/to/my-site"] }
 *     }
 *   }
 *
 * `FCMS_URL` and `FCMS_TOKEN` override, for an agent that never ran the CLI.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client, readLink, readToken } from "@forinda-cms/sdk";

import { createServer } from "./index.js";

const root = process.argv[2] ?? process.cwd();

const url = process.env["FCMS_URL"] ?? readLink(root)?.url;
if (!url) {
  // stderr, never stdout: stdout is the protocol, and a friendly message written
  // there is a parse error at the other end.
  console.error(`No site linked in ${root}. Run \`fcms link <url>\` there, or set FCMS_URL.`);
  process.exit(1);
}

const token = process.env["FCMS_TOKEN"] ?? readToken(url) ?? undefined;
if (!token) {
  console.error(`No live token for ${url}. Run \`fcms login\`, or set FCMS_TOKEN.`);
  process.exit(1);
}

await createServer({ client: new Client({ url, token, source: "mcp" }) }).connect(
  new StdioServerTransport(),
);
