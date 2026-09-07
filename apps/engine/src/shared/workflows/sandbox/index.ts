/**
 * Running a script step (ADR 0031).
 *
 * Everything here is about the boundary being real rather than described: a
 * child process with the runtime's own permission model on, a heap cap, a
 * wall-clock kill, and a reply that is parsed rather than trusted.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * The program the child runs, passed on the command line rather than read from
 * a file (ADR 0031 §1).
 *
 * Two reasons, and the second is the important one. A loose `.mjs` beside this
 * file is not part of the bundle, so it would exist in development and be
 * missing in the image — the failure a build cannot catch. And a child that
 * never reads a file needs no filesystem allowance at all, so the permission
 * model can deny **everything** rather than everything-but-one-path.
 */
const RUNNER = String.raw`
import vm from "node:vm";

const MAX_OUTPUT = 256 * 1024;

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

function reply(payload) {
  const text = JSON.stringify(payload);
  process.stdout.write(
    text.length > MAX_OUTPUT ? JSON.stringify({ error: "returned too much" }) : text,
  );
}

try {
  const { code, input, timeoutMs } = JSON.parse(raw);

  // 'Object.create(null)': no prototype, so no inherited anything. The context
  // gets exactly what is put in it, and 'globalThis' inside is empty.
  const context = vm.createContext(Object.create(null));
  const logs = [];
  context.console = {
    log: (...args) => {
      // Kept for the run history rather than written anywhere: a script's
      // console is a debugging aid, not an output channel.
      if (logs.length < 50) logs.push(args.map(String).join(" ").slice(0, 500));
    },
  };

  const fn = vm.compileFunction(String(code), ["input"], {
    parsingContext: context,
    // A synchronous loop is stopped here; anything else is stopped by the
    // parent killing this process.
    timeout: timeoutMs,
  });

  const value = await fn(input);
  reply({ value: value === undefined ? null : value, logs });
} catch (error) {
  // Not 'instanceof Error': an error thrown inside the 'vm' comes from that
  // context's realm, so it is an Error with a different constructor and the
  // check quietly fails — reporting "Error: nope" where the author wrote
  // "nope".
  const message =
    error &&
    typeof error === "object" &&
    typeof (/** @type {{message?: unknown}} */ (error).message) === "string"
      ? /** @type {{message: string}} */ (error).message
      : String(error);
  reply({ error: message });
}
`;

/** Two seconds is plenty for arithmetic; ten is the most anyone may ask for. */
export const DEFAULT_TIMEOUT_MS = 2_000;
export const MAX_TIMEOUT_MS = 10_000;
const HEAP_MB = 64;

export interface ScriptResult {
  readonly value?: unknown;
  readonly logs?: readonly string[];
  readonly error?: string;
}

export function timeoutOf(asked: unknown): number {
  const wanted = Number(asked);
  if (!Number.isFinite(wanted) || wanted <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.trunc(wanted), MAX_TIMEOUT_MS);
}

/**
 * @param input What the pipeline put in front of it — and the only thing it
 *   can see. No network, no filesystem, no secrets: not "declared and
 *   enforced", absent (ADR 0031 §2).
 */
export async function runScript(
  code: string,
  input: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ScriptResult> {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [
      // The runtime itself denies the filesystem, child processes, worker
      // threads and native addons — with no allowance, because this child has
      // nothing to read.
      "--permission",
      `--max-old-space-size=${HEAP_MB}`,
      "--input-type=module",
      "-e",
      RUNNER,
    ],
    {
      stdio: "pipe",
      /**
       * No inherited environment: a child that cannot see `DATABASE_URL`
       * cannot leak it, whatever happens inside.
       *
       * The cast is the point rather than a workaround — `kick typegen` marks
       * this project's variables *required* on `ProcessEnv`, which is right for
       * the app and exactly wrong for a process that is meant to have none of
       * them.
       */
      env: { NODE_OPTIONS: "" } as unknown as NodeJS.ProcessEnv,
    },
  );

  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    err += chunk.toString();
  });

  child.stdin.end(JSON.stringify({ code, input, timeoutMs }));

  // The wall clock, not the `vm`'s: a script that awaits forever never reaches
  // the `vm`'s own timeout, and a killed process is the only reliable stop.
  const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs + 500);

  const finished = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(killer);

  if (finished.signal === "SIGKILL") return { error: `took longer than ${timeoutMs}ms` };

  // 13 is Node's "unsettled top-level await": a script that never resolves ends
  // the event loop and exits *before* any kill, so this arrives instead of a
  // timeout. It means the same thing to whoever wrote the script.
  if (finished.code === 13) return { error: `took longer than ${timeoutMs}ms` };

  if (!out) {
    // A heap cap or a crash. The child's own last line, if it reads like a
    // message rather than a caret from a stack — an owner reading a run should
    // see what went wrong, not the shape of it.
    const said = err
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /[a-z]{3}/i.test(line))
      .pop();
    return { error: said?.slice(0, 200) || "the script did not finish" };
  }

  try {
    return JSON.parse(out) as ScriptResult;
  } catch {
    return { error: "the script did not answer with a value" };
  }
}
