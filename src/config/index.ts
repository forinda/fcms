import { loadEnvFromSchema } from "@forinda/kickjs/config";
import { fromZod } from "@forinda/kickjs-schema/zod";
import { z } from "zod";

/**
 * Project environment schema (Zod).
 *
 * `fromZod` wraps it as a `KickSchema` so the env loader, validate middleware
 * and swagger generator all see the same shape, and `kick typegen` reads it to
 * populate `KickEnv` — which is what makes `@Value('FOO')` autocomplete.
 */
const envSchema = fromZod(
  z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z.string().default("info"),

    DATABASE_URL: z.string(),

    /**
     * Where a single-site install serves from.
     *
     * v1 is single-site self-hosted (ADR 0013, doc 09): one org, one site, and
     * the words never appear in the UI. The multi-site resolver reads the host
     * instead — these two variables are the seam, not a permanent shape.
     */
    SITE_ID: z.string().default("default"),
    ORG_ID: z.string().default("default"),

    /**
     * Trust `X-Forwarded-Host`. Off by default because trusting it unconditionally
     * lets a caller pick which site they get once multi-site exists.
     */
    TRUST_PROXY: z.coerce.boolean().default(false),

    /** Absolute base for canonicals and the sitemap (doc 08). */
    PUBLIC_URL: z.string().optional(),

    /** Shown on the starter page a fresh install boots into. */
    SITE_NAME: z.string().optional(),
    SITE_TIMEZONE: z.string().default("UTC"),
  }),
);

loadEnvFromSchema(envSchema);

export default envSchema;
