/**
 * Where model responses come from.
 *
 * Two providers, and the split is deliberate. **An eval that needs a paid API
 * call on every CI run is an eval nobody runs**, so recorded responses are the
 * default and the live call is opt-in. Re-recording is a decision someone makes,
 * not a side effect of running the suite.
 *
 * It also keeps this honest about its own principles: doc 13 says the platform
 * must stay fully usable at zero AI spend, and a test suite that cannot run
 * without a key would be the first thing to violate that.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

export interface Provider {
  readonly name: string;
  complete(system: string, user: string, id: string): Promise<string>;
}

export const FIXTURE_DIR = join(import.meta.dirname, "fixtures");

/** Replays a recorded response. The default, so CI needs no key and no budget. */
export function replayProvider(): Provider {
  return {
    name: "replay",
    async complete(_system, _user, id) {
      const path = join(FIXTURE_DIR, `${id}.txt`);
      if (!existsSync(path)) {
        throw new Error(
          `no recording for "${id}". Run \`pnpm eval:record\` with an API key to create one, ` +
            `or pass --only to skip this task.`,
        );
      }
      return readFileSync(path, "utf8");
    },
  };
}

export interface LiveOptions {
  readonly model?: string;
  /** Write each response to `fixtures/` so CI can replay it later. */
  readonly record?: boolean;
}

/**
 * Calls Claude for real.
 *
 * Streaming because the spec is large and the response is a full rewrite of it;
 * a non-streaming request at this `max_tokens` risks an HTTP timeout. Thinking
 * is left adaptive — the point is to measure what a capable model does with the
 * language, not to handicap it.
 */
export function liveProvider(options: LiveOptions = {}): Provider {
  const client = new Anthropic();
  const model = options.model ?? "claude-opus-5";

  return {
    name: model,
    async complete(system, user, id) {
      const stream = client.messages.stream({
        model,
        max_tokens: 64000,
        // `thinking` is deliberately omitted rather than set to `adaptive`:
        // on Claude Opus 5 thinking is on by default, so omitting it *is*
        // adaptive — and the installed SDK's types predate the `adaptive`
        // literal. Omitting keeps the behaviour and the types honest at once.
        system,
        messages: [{ role: "user", content: user }],
      });
      const message = await stream.finalMessage();

      // A refusal is a legitimate outcome to record rather than an error: on a
      // trap task it may even be the right answer.
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (options.record) {
        mkdirSync(FIXTURE_DIR, { recursive: true });
        writeFileSync(join(FIXTURE_DIR, `${id}.txt`), text, "utf8");
      }
      return text;
    },
  };
}

/**
 * Pick a provider from the environment.
 *
 * Credentials may come from `ANTHROPIC_API_KEY` or from an `ant auth login`
 * profile, so an unset key does not mean no credentials — the SDK resolves both.
 * `--live` asks for the live provider explicitly and fails loudly if it cannot
 * authenticate, rather than silently replaying stale recordings.
 */
export function chooseProvider(argv: readonly string[]): Provider {
  const record = argv.includes("--record");
  const live = record || argv.includes("--live");
  if (!live) return replayProvider();

  const modelFlag = argv.indexOf("--model");
  const model = modelFlag === -1 ? undefined : argv[modelFlag + 1];
  return liveProvider({ ...(model ? { model } : {}), record });
}
