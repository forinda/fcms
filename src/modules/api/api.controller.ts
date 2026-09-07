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
import { Controller, Get, HttpException, Inject, Post, type Ctx } from "@forinda/kickjs";
import { SiteSpec } from "@forinda-cms/spec";

import { PublicAuth } from "@/route-flags";
import { InvalidCredentialsError, LoginUseCase } from "@/shared/auth/auth.usecase";
import { EntryReadUseCase, SiteSpecUseCase } from "@/shared/use-cases";
import {
  ApplySpecUseCase,
  DestructiveChangeError,
} from "@/modules/admin/use-cases/apply-spec.usecase";
import { SiteHistoryUseCase } from "@/modules/admin/use-cases/site-history.usecase";
import { clientIp } from "@/modules/admin/utils/http";

@Controller()
export class ApiController {
  @Inject(LoginUseCase) private readonly loginUseCase!: LoginUseCase;
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(EntryReadUseCase) private readonly entries!: EntryReadUseCase;
  @Inject(ApplySpecUseCase) private readonly applySpec!: ApplySpecUseCase;
  @Inject(SiteHistoryUseCase) private readonly changes!: SiteHistoryUseCase;

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
    const body = (ctx.body ?? {}) as { allowDestructive?: boolean };
    const next = parseSpec(ctx);

    try {
      const result = await this.applySpec.execute(next, {
        actor: ctx.require("actor").email,
        // Recorded, so history says which door a change came through — the
        // whole point of the column (doc 03).
        source: "cli",
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
