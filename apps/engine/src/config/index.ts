import { loadEnvFromSchema } from "@forinda/kickjs/config";
import { fromZod } from "@forinda/kickjs-schema/zod";
import { z } from "zod";
import { existsSync } from "node:fs";

/**
 * Where uploads go when nobody says.
 *
 * Beside the database, in `.fcms`, so one directory holds everything the
 * platform owns and one volume covers it. It used to be `./data/media`, which
 * put binary uploads inside the directory an author keeps their content files
 * in — the same collision the database had before it moved.
 *
 * An install that already has `./data/media` keeps using it: moving somebody's
 * pictures on an upgrade would answer 404 for every one of them, and a tidier
 * default is not worth that.
 *
 * A function, and the only one, because the resolved value is needed in two
 * places — here, and wherever a store is built before the schema is loaded —
 * and two defaults for one setting is how they come to disagree.
 */
export function defaultMediaDir(): string {
  return existsSync("./data/media") ? "./data/media" : "./.fcms/media";
}

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

    /**
     * A Postgres URL, or a directory — and a directory by default (ADR 0050).
     *
     * `postgres://…` is a server somebody runs. Anything else is a place to
     * keep files, and the database runs inside this process. The default means
     * `npx forinda-cms` starts a working site with nothing configured, which
     * was the last thing standing between somebody and one.
     *
     * `.fcms/` and not `data/`: a site directory already uses `data/` for
     * content files — `fcms pull --content` writes them there and an author
     * commits them — so the default put a forty-megabyte Postgres cluster in
     * the middle of somebody's YAML. Hidden, named after the product, and one
     * line in `.gitignore`.
     */
    DATABASE_URL: z.string().default("./.fcms/db"),

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

    /**
     * The first owner, created once on first boot and then ignored.
     *
     * Leaving these unset is a valid install — it just has nobody who can sign
     * in until an owner is created another way.
     */
    OWNER_EMAIL: z.string().email().optional(),
    OWNER_PASSWORD: z.string().min(12).optional(),

    /**
     * Set for a site served over HTTPS. The session cookie is marked `Secure`
     * when true, which is what stops it travelling over plain HTTP.
     */
    SECURE_COOKIES: z.coerce.boolean().default(false),

    /**
     * Where uploaded media is written.
     *
     * Beside the database, in `.fcms`, so one directory holds everything the
     * platform owns and one volume covers it. It used to default to
     * `./data/media`, which put binary uploads inside the directory an author
     * keeps their content files in — the same collision the database had before
     * it moved.
     *
     * An install that already has `./data/media` keeps using it. Moving
     * somebody's pictures on upgrade would answer 404 for every one of them,
     * and a default is not worth that.
     *
     * Content-addressed on disk (ADR 0010), so the path is a hash and the same
     * photo uploaded twice is one file.
     */
    MEDIA_DIR: z.string().default(defaultMediaDir()),

    /** Shown on the starter page a fresh install boots into. */
    SITE_NAME: z.string().optional(),
    SITE_TIMEZONE: z.string().default("UTC"),
  }),
);

loadEnvFromSchema(envSchema);

export default envSchema;
