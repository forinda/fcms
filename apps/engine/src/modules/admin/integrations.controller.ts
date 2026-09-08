/**
 * Declaring what this site talks to (ADR 0034).
 *
 * Every route produces a whole spec and applies it, like every other builder.
 * The one rule specific to this screen: a credential never arrives. A secret
 * field posts the **name** of an environment variable, and the use-case refuses
 * anything that is not one.
 */
import { Controller, Get, Inject, Post, type Ctx } from "@forinda/kickjs";

import { INTEGRATION_KIND_INFO, settingsFor } from "@/shared/integrations";
import { SiteSpecUseCase } from "@/shared/use-cases";
import { roleOf, type Role } from "@/shared/roles";
import {
  IntegrationEditUseCase,
  missingFrom,
  type EditResult,
} from "./use-cases/integration-edit.usecase";
import { html, noSiteYet, notFound, redirect } from "./utils/http";
import { integrationEdit, integrationList } from "./utils/integrations.view";
import { page } from "./utils/view";

@Controller()
export class IntegrationsController {
  @Inject(SiteSpecUseCase) private readonly specs!: SiteSpecUseCase;
  @Inject(IntegrationEditUseCase) private readonly edits!: IntegrationEditUseCase;

  @Get("/integrations")
  async list(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: "Integrations",
        trail: [{ label: "Integrations" }],
        section: "integrations",
        body: integrationList({ spec, kinds: INTEGRATION_KIND_INFO, error: error(ctx) }),
      }),
    );
  }

  @Post("/integrations")
  async create(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const key = str(body["key"]).trim();
    const result = await this.edits.create(spec, key, str(body["kind"]), str(body["label"]), {
      actor: actor(ctx),
      role: role(ctx),
    });

    redirect(
      ctx,
      result.ok
        ? `/admin/integrations/${encodeURIComponent(key)}`
        : `/admin/integrations?error=${encodeURIComponent(result.error)}`,
    );
  }

  @Get("/integrations/:key")
  async show(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    const integration = spec?.wiring.find((i) => i.key === key);
    if (!spec || !integration) return notFound(ctx);

    const info = INTEGRATION_KIND_INFO[integration.kind];
    if (!info) return notFound(ctx);

    const applicable = settingsFor(info, integration.config ?? {});

    // Presence only, never a value: "this machine has no MPESA_PASSKEY" is the
    // answer to why a payment will not start, and reading the variable to say
    // so does not put it on the page.
    const present: Record<string, boolean> = {};
    for (const ref of Object.values(integration.secrets ?? {})) {
      const name = ref.replace(/^secret:/, "");
      present[name] = typeof process.env[name] === "string" && process.env[name] !== "";
    }

    html(
      ctx,
      200,
      page({
        role: viewerRole(ctx),
        title: `${integration.label ?? integration.key} — integration`,
        trail: [
          { label: "Integrations", href: "/admin/integrations" },
          { label: integration.label ?? integration.key },
        ],
        section: "integrations",
        body: integrationEdit({
          integration,
          info,
          config: applicable.config,
          secrets: applicable.secrets,
          present,
          usedBy: this.edits.usedBy(spec, key),
          missing: missingFrom(integration, applicable),
          error: error(ctx),
        }),
      }),
    );
  }

  @Post("/integrations/:key")
  async update(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const body = form(ctx);
    const result = await this.edits.update(
      spec,
      key,
      {
        label: str(body["label"]),
        enabled: str(body["enabled"]) === "on",
        config: prefixed(body, "config__"),
        secrets: prefixed(body, "secret__"),
      },
      { actor: actor(ctx), role: role(ctx) },
    );

    this.back(ctx, key, result);
  }

  @Post("/integrations/:key/delete")
  async remove(ctx: Ctx): Promise<void> {
    const spec = await this.specs.execute();
    const key = keyOf(ctx);
    if (!spec) return noSiteYet(ctx);

    const result = await this.edits.remove(spec, key, { actor: actor(ctx), role: role(ctx) });
    if (result.ok) return redirect(ctx, "/admin/integrations");
    this.back(ctx, key, result);
  }

  private back(ctx: Ctx, key: string, result: EditResult): void {
    const at = `/admin/integrations/${encodeURIComponent(key)}`;
    redirect(ctx, result.ok ? at : `${at}?error=${encodeURIComponent(result.error)}`);
  }
}

/**
 * The posted fields under one prefix, as plain names.
 *
 * `config__shortcode` rather than `config.shortcode`: a body parser configured
 * with `allowDots` turns the dotted form into a nested object, the flat lookup
 * then finds nothing, and the save reports success having changed nothing.
 */
function prefixed(body: Record<string, unknown>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(body)) {
    if (name.startsWith(prefix)) out[name.slice(prefix.length)] = str(value);
  }
  return out;
}

const keyOf = (ctx: Ctx): string => String((ctx.params as Record<string, string>)["key"] ?? "");
const actor = (ctx: Ctx): string => ctx.require("actor").email;
/** The role on the session, never a role a request can claim for itself. */
const role = (ctx: Ctx): Role => roleOf(ctx.require("actor").role);
const form = (ctx: Ctx): Record<string, unknown> => (ctx.body ?? {}) as Record<string, unknown>;
const error = (ctx: Ctx): string | undefined => {
  const asked = (ctx.query as Record<string, unknown>)["error"];
  return typeof asked === "string" ? asked : undefined;
};

/** The last value wins, which is how a checkbox's hidden `off` pair is read. */
const str = (value: unknown): string =>
  typeof value === "string" ? value : Array.isArray(value) ? str(value[value.length - 1]) : "";

/** The role on the session, for the chrome to hide what it cannot open. */
const viewerRole = (ctx: Ctx): Role => roleOf(ctx.require("actor").role);
