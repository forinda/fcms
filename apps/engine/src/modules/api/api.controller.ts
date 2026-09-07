/**
 * `fcms`'s server side.
 *
 * Five routes, matching the five verbs ADR 0002 scopes the CLI to: sign in,
 * describe the site, read the spec back, plan a change, apply it. Everything
 * here is JSON, and everything except `login` requires the session the actor
 * contributor resolves — from a `Bearer` token, in a terminal's case.
 *
 * The spec crosses this boundary as JSON rather than as source text. The
 * language is the CLI's surface and the CLI owns it: the server stores an AST
 * (ADR 0006 makes the syntax swappable precisely so it is not load-bearing
 * here), and a server that parsed YAML would be a second parser to keep in step
 * with the printer.
 */
import {
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Patch,
  Post,
  type Ctx,
} from "@forinda/kickjs";
import { SiteSpec, type ContentType } from "@forinda-cms/spec";

import { PublicAuth } from "@/route-flags";
import {
  InvalidCredentialsError,
  LoginUseCase,
  TooManyAttemptsError,
} from "@/shared/auth/auth.usecase";
import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import {
  ApplySpecUseCase,
  DestructiveChangeError,
} from "@/modules/admin/use-cases/apply-spec.usecase";
import { EntryWriteUseCase } from "@/modules/admin/use-cases/entries.usecase";
import { SiteHistoryUseCase } from "@/modules/admin/use-cases/site-history.usecase";
import { UndoSpecUseCase } from "@/modules/admin/use-cases/undo-spec.usecase";
import { clientIp } from "@/modules/admin/utils/http";

@Controller()
export class ApiController {
  @Inject(LoginUseCase) private readonly loginUseCase!: LoginUseCase;
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryReadUseCase) private readonly entries!: EntryReadUseCase;
  @Inject(ApplySpecUseCase) private readonly applySpec!: ApplySpecUseCase;
  @Inject(SiteHistoryUseCase) private readonly changes!: SiteHistoryUseCase;
  @Inject(UndoSpecUseCase) private readonly undoLast!: UndoSpecUseCase;
  @Inject(EntryWriteUseCase) private readonly writer!: EntryWriteUseCase;

  /**
   * `fcms login`.
   *
   * Issues the same session row the admin's form does, so a token from a
   * terminal appears in the same list and is revoked the same way. Public by
   * necessity — it is how a caller stops being anonymous.
   */
  @Post("/login")
  @PublicAuth
  async login(ctx: Ctx): Promise<unknown> {
    const body = (ctx.body ?? {}) as { email?: string; password?: string };

    try {
      const session = await this.loginUseCase.execute({
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        userAgent: "fcms",
        ipAddress: clientIp(ctx),
      });

      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        owner: { email: session.owner.email },
      };
    } catch (error) {
      // 429 so a script backs off rather than hammering a locked account.
      if (error instanceof TooManyAttemptsError) throw new HttpException(429, error.message);
      if (!(error instanceof InvalidCredentialsError)) throw error;
      // The same message either way, for the same reason the form gives one:
      // a distinguishable answer turns this into a user-enumeration oracle.
      throw new HttpException(401, error.message);
    }
  }

  /** `fcms status` — is this linked to the right site, and what state is it in. */
  @Get("/status")
  async status(): Promise<unknown> {
    const spec = await this.specs.execute();
    const [latest] = await this.changes.execute(1);

    return {
      site: spec ? { name: spec.name, pages: spec.pages.length, types: spec.content.length } : null,
      counts: spec ? await this.entries.counts(spec) : {},
      lastChange: latest
        ? {
            seq: latest.seq,
            actor: latest.actor,
            source: latest.source,
            classification: latest.classification,
            summary: latest.summary,
            at: latest.appliedAt.toISOString(),
          }
        : null,
    };
  }

  /** `fcms pull` — the stored spec, for the CLI to print as canonical files. */
  @Get("/spec")
  async spec(): Promise<unknown> {
    const spec = await this.specs.execute();
    if (!spec) throw new HttpException(404, "This site has no spec yet.");
    return { spec };
  }

  /**
   * `fcms plan` — what applying this spec would do. Writes nothing.
   *
   * The same computation `apply` runs, so the two cannot disagree about whether
   * a change is destructive.
   */
  @Post("/plan")
  async plan(ctx: Ctx): Promise<unknown> {
    const next = parseSpec(ctx);
    const { changes, destructive, migration, initial } = await this.applySpec.plan(next);
    return {
      initial,
      changes,
      destructive: destructive.length,
      migration: migration.map((s) => ({ kind: s.kind, statement: s.statement })),
    };
  }

  /** `fcms apply` — and a 409 rather than a 500 when the gate refuses. */
  @Post("/apply")
  async apply(ctx: Ctx): Promise<unknown> {
    const body = (ctx.body ?? {}) as { allowDestructive?: boolean; source?: unknown };
    const next = parseSpec(ctx);

    try {
      const result = await this.applySpec.execute(next, {
        actor: ctx.require("actor").email,
        // Which door this came through, from a closed set. History exists to
        // answer "what did the model change" as a query rather than an
        // inference (ADR 0015 §5), and it cannot if every API caller is
        // recorded as the CLI — which is what a hardcoded value did.
        source: source(body.source),
        allowDestructive: body.allowDestructive === true,
      });

      return {
        seq: result.seq,
        changes: result.changes,
        migration: result.migration.map((s) => ({ kind: s.kind, statement: s.statement })),
      };
    } catch (error) {
      if (!(error instanceof DestructiveChangeError)) throw error;
      // 409: the request is well-formed and the server understood it. It is the
      // *state* that makes it refusable, and a client can resolve it by asking
      // again with confirmation.
      throw new HttpException(409, error.message);
    }
  }

  /** `site_history` — what has happened, so a caller can explain or undo it. */
  @Get("/history")
  async history(ctx: Ctx): Promise<unknown> {
    const limit = Number((ctx.query as Record<string, unknown>)["limit"] ?? 20);
    const entries = await this.changes.execute(Number.isFinite(limit) ? limit : 20);
    return {
      history: entries.map((e) => ({
        seq: e.seq,
        actor: e.actor,
        source: e.source,
        classification: e.classification,
        summary: e.summary,
        at: e.appliedAt.toISOString(),
        reverted: e.revertedAt !== null,
      })),
    };
  }

  /**
   * `site_undo` — the last patch, reversed.
   *
   * A table lookup, not a replay: the inverse was recorded when the change was
   * applied (doc 03), which is what makes this cheap enough to offer a model.
   */
  @Post("/undo")
  async undo(): Promise<unknown> {
    const result = await this.undoLast.execute();
    if (!result) throw new HttpException(404, "There is nothing to undo.");
    return result;
  }

  /**
   * `entry_list` — rows of one content type.
   *
   * Content, which doc 11 §2 gives to MCP and deliberately withholds from the
   * CLI: two machine doors for one audience is two surfaces to keep in step.
   */
  @Get("/entries/:type")
  async listEntries(ctx: Ctx): Promise<unknown> {
    const type = await this.contentType(String((ctx.params as Record<string, string>)["type"]));
    const rows = await this.entries.rows(type.key);

    return {
      type: type.key,
      entries: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        status: row.status,
        data: row.data,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  @Post("/entries/:type")
  async createEntry(ctx: Ctx): Promise<unknown> {
    const spec = await this.requireSpec();
    const type = await this.contentType(String((ctx.params as Record<string, string>)["type"]));
    const body = (ctx.body ?? {}) as {
      data?: Record<string, unknown>;
      slug?: string;
      status?: string;
    };

    const result = await this.writer.create(spec, {
      typeKey: type.key,
      slug: body.slug,
      ...(body.status === "published" || body.status === "draft" ? { status: body.status } : {}),
      data: body.data ?? {},
    });

    if (!result.ok) throw invalidEntry(result.errors);
    return { entry: result.entry };
  }

  @Patch("/entries/:type/:id")
  async updateEntry(ctx: Ctx): Promise<unknown> {
    const spec = await this.requireSpec();
    const params = ctx.params as Record<string, string>;
    const type = await this.contentType(String(params["type"]));
    const body = (ctx.body ?? {}) as {
      data?: Record<string, unknown>;
      slug?: string;
      status?: string;
    };

    const result = await this.writer.update(spec, String(params["id"]), {
      typeKey: type.key,
      slug: body.slug,
      ...(body.status === "published" || body.status === "draft" ? { status: body.status } : {}),
      data: body.data ?? {},
    });

    if (!result.ok) throw invalidEntry(result.errors);
    return { entry: result.entry };
  }

  @Delete("/entries/:type/:id")
  async deleteEntry(ctx: Ctx): Promise<unknown> {
    const id = String((ctx.params as Record<string, string>)["id"]);
    if (!(await this.writer.delete(id)))
      throw new HttpException(404, "That entry no longer exists.");
    return { deleted: id };
  }

  /** The spec, or a 409 — writing content to a site with no content model. */
  private async requireSpec(): Promise<SiteSpec> {
    const spec = await this.specs.execute();
    if (!spec) throw new HttpException(409, "This site has no spec yet.");
    return spec;
  }

  /**
   * A declared, stored content type.
   *
   * 404 for a type nobody declared and 409 for a derived one, rather than a
   * write that succeeds and is then invisible because nothing reads the table
   * for it (ADR 0014).
   */
  private async contentType(key: string): Promise<ContentType> {
    const spec = await this.requireSpec();
    const type = spec.content.find((t) => t.key === key);
    if (!type) throw new HttpException(404, `No content type named "${key}".`);
    if (type.derived)
      throw new HttpException(409, `${type.label} is computed and cannot be edited.`);
    return type;
  }
}

/**
 * Field-level errors, kept per field rather than flattened into a sentence.
 *
 * The third argument, not the second: the message parameter is a string, and an
 * object passed there is stringified — `"[object Object]"` reached the client
 * instead of the errors, which is worse than no detail because it looks like a
 * bug in the caller. `details` serializes into the problem body's `errors`.
 */
function invalidEntry(errors: Record<string, string>): HttpException {
  return new HttpException(
    422,
    "That entry is not valid.",
    Object.entries(errors).map(([path, message]) => ({ path, message })),
  );
}

/**
 * The surface a change came through.
 *
 * A closed set, defaulting to `api`: an open string is a column that means
 * whatever the last caller felt like, and the whole value of recording it is
 * that a query over it is trustworthy.
 */
const SOURCES = new Set(["cli", "mcp", "chat", "canvas", "api"]);

function source(value: unknown): string {
  return typeof value === "string" && SOURCES.has(value) ? value : "api";
}

/**
 * The spec from a request body, validated here rather than deeper in.
 *
 * A malformed document should fail as a 400 naming the path, not as a 500 from
 * a use-case that assumed its caller checked.
 */
function parseSpec(ctx: Ctx): SiteSpec {
  const body = (ctx.body ?? {}) as { spec?: unknown };
  const parsed = SiteSpec.safeParse(body.spec);

  if (!parsed.success) {
    throw new HttpException(400, {
      message: "That is not a valid spec.",
      issues: parsed.error.issues.map((i) => ({
        path: "/" + i.path.join("/"),
        message: i.message,
      })),
    } as never);
  }

  return parsed.data;
}
