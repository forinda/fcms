# AGENTS.md — AI Agent Guide for forinda-cms

This guide is the **canonical, multi-agent reference** for this KickJS
application — Claude, Copilot, Codex, Gemini, etc. all read it first.
Per-agent files (`CLAUDE.md`, `GEMINI.md`, etc.) are thin layers that
add tool-specific affordances on top.

## Before You Start

1. Run `pnpm install` to install dependencies
2. Run `kick dev` to verify the app starts
3. Read the [KickJS documentation](https://kickjs.app/) for framework details

## HTTP runtime — DON'T assume Express-only

KickJS is **engine-pluggable**. It runs on **Express (default), Fastify, or h3** —
chosen with one line: `bootstrap({ runtime: fastifyRuntime() })`. Before writing
any engine-specific code, **check which engine this project uses**:

- `kick.config.ts` → the `runtime` field (`'express'` | `'fastify'` | `'h3'`), and/or
- `src/index.ts` → the `runtime:` passed to `bootstrap()`, and/or
- `package.json` → `fastify` / `h3` in deps.

Rules that keep generated code correct on **every** engine:

- **Prefer return-value handlers.** `return payload` sends 200 json on every
  engine and lets `kick typegen` infer the response type into
  `KickRoutes.Api` (consumed by the `@forinda/kickjs-client` typed client);
  `reply(status, body)` for non-200, `reply.noContent()` for 204. A declared
  `{ response: schema }` on the route feeds BOTH the OpenAPI success response
  and the typegen response type. `ctx.json(...)` stays fully supported but
  infers `unknown`.
- **Lifecycle hooks:** `@PostConstruct()` after instantiation; `@PreDestroy()`
  when a REQUEST-scoped service's request closes (release transactions/handles).
- **Write to `ctx`, not the raw request/response.** `ctx.json()`, `ctx.body`,
  `ctx.params`, `ctx.query`, `ctx.set/get`, `ctx.sse()` are engine-neutral and
  work identically everywhere. `ctx.req` / `ctx.res` are the engine-native
  objects — their **type follows the active runtime** (Express by default; the
  `kick/runtime` typegen retypes them to Fastify / h3 when `runtime` is set).
  Don't assume `ctx.req` is an `express.Request` in portable code.
- **Global middleware** in `bootstrap({ middlewares })` is connect-style
  `(req, res, next)` — it runs on all engines (Fastify via `@fastify/middie`,
  h3 via `fromNodeMiddleware`). But on Fastify / h3 the engine parses the body
  natively, so the default `express.json()` is **auto-skipped** (`nativeBodyParsing`).
  Don't add `express.json()` manually on those engines.
- **File uploads** work on all three: `@FileUpload({ mode, fieldName, ... })` →
  `ctx.file` / `ctx.files` (same Multer-shaped object everywhere). Backends:
  Express `multer`, Fastify `@fastify/multipart`, h3 native. Run
  `kick add upload` to install the runtime-correct driver. The `@FileUpload`
  decorator is **memory-only** (portable); disk / custom-storage (`storage` /
  `dest`) is Express-only via the `upload.single/array()` middleware.
- **Engine subpaths**: `import { fastifyRuntime } from '@forinda/kickjs/fastify'`
  or `h3Runtime` from `'@forinda/kickjs/h3'`. Express is the zero-config default
  (no import, nothing to install).
- **Not supported on Fastify / h3**: `ctx.render()` (no view engine). Calling it
  throws a clear error rather than failing silently.
- Run `kick doctor` to verify the runtime's engine peers + upload driver are installed.

## v4 Conventions (don't skip)

KickJS v4 made a handful of structural changes from v3. Internalise these
before generating or modifying code — they are the source of most agent
mistakes:

- **Adapters** — `defineAdapter()` factory. Never write `class Foo implements AppAdapter`.

  ```ts
  export const MyAdapter = defineAdapter<MyOptions>({
    name: 'MyAdapter',
    defaults: { ... },
    build: (config) => ({
      beforeMount({ app }) { /* ... */ },
      afterStart({ server }) { /* ... */ },
    }),
  })
  ```

- **Plugins** — `definePlugin()` factory. Same shape, never plain function returning `KickPlugin`.

- **DI tokens** — `<scope>/<PascalKey>[/<suffix>]`. Scope is lowercase,
  the key segment is **PascalCase** (the regex enforces both):

  ```ts
  const USERS_REPO = createToken<UsersRepo>('app/Users/repository')
  const DB         = createToken<Database>('app/Db/connection')
  ```

  The `kick/` prefix is reserved for first-party packages; this project
  owns its own scope (`app/`, your domain name, etc.).

- **`@Controller()`** takes **no path argument**. Mount prefix comes from
  the module's `routes()` return value, not the decorator. `@Controller('/users')`
  is a v3 leftover; the linter and codegen reject it.

- **Env wiring** — `src/config/index.ts` calls `loadEnv(envSchema)` as a
  side effect. `src/index.ts` MUST have `import './config'` as its **first**
  import (before `bootstrap()`). Without it, `ConfigService.get('YOUR_KEY')`
  returns `undefined` and `@Value()` only works via raw `process.env` fallback
  (Zod coercion + defaults silently skipped).

- **Module entry files MUST be named `<name>.module.ts`** — see the Vite
  HMR contract at the top of "Module Pattern" below. The CLI enforces this;
  hand-rolled files must too.

- **Assets** — drop new template files into `src/templates/<namespace>/`
  (or wherever `kick.config.ts` points). The dev watcher auto-rebuilds the
  `KickAssets` augmentation; `assets.x.y()` re-walks on next call. No restart,
  no manual build step.

- **Context over `@Middleware()`** — when a middleware's only job is to
  populate `ctx.set('key', value)`, use `defineHttpContextDecorator()`
  (HTTP) or `defineContextDecorator()` (transport-agnostic) instead.
  Typed via `ContextMeta`, ordered via `dependsOn`, validated at boot.
  Reserve `@Middleware()` for response short-circuit / stream mutation /
  pre-route-matching work.

  Two ground rules around the data flow — both stem from the fact that
  every per-request stage gets its OWN `RequestContext` instance, all
  reading/writing the SAME `AsyncLocalStorage`-backed Map:
  - **`resolve` and `onError` must RETURN the value.** The runner
    writes it via `ctx.set(reg.key, value)` on your behalf. Direct
    property assignment (`ctx.tenant = …`) sticks to the contributor
    instance only — the handler instance never sees it.
  - **Read across instances via `ctx.set` / `ctx.get`** (or
    `getRequestValue(key)` from a service that has no `ctx` reference
    — typed via `MetaValue<K>`). `ctx.req` works because the underlying
    Express request is shared; bespoke property assignments don't.

- **Test isolation** — default to `Container.create()` for fresh DI state.
  Never `new Container()` and never `getInstance().reset()` — both leak
  registrations between tests.

  ```ts
  const container = Container.create()
  // ... register test-scoped providers, run, discard
  ```

- **Bootstrap export** — `src/index.ts` MUST end with
  `export const app = await bootstrap({ ... })`. The Vite plugin imports
  the named `app` symbol to drive HMR module swaps; testing helpers
  (`createTestApp`) and the OpenAPI introspector also rely on it. Drop
  the `export` and `kick dev` will silently fall back to a full restart
  on every save while `createTestApp` complains about a missing handle.

- **Keep `src/index.ts` thin** — collect plugins, modules, middleware, and
  adapters in dedicated folders and re-export aggregated arrays. Do **not**
  inline registration in the entry file:

  ```ts
  // src/modules/index.ts — fluent chain (default for `modules.style: 'define'`)
  export const modules = defineModules().mount(HelloModule()).mount(UsersModule())
  // OR with `modules.style: 'class'`:
  //   export const modules: AppModuleEntry[] = [HelloModule, UsersModule]

  // src/middleware/index.ts
  export const middleware = [helmet(), cors(), requestId(), ...]

  // src/plugins/index.ts
  export const plugins = [MetricsPlugin(), AuditPlugin()]

  // src/adapters/index.ts
  export const adapters = [SwaggerAdapter({ ... }), DevToolsAdapter()]
  ```

  ```ts
  // src/index.ts — stays small; one import per category
  import 'reflect-metadata'
  import './config'
  import { bootstrap } from '@forinda/kickjs'
  import { modules } from './modules'
  import { middleware } from './middleware'
  import { plugins } from './plugins'
  import { adapters } from './adapters'

  export const app = await bootstrap({ modules, middlewares, plugins, adapters })
  ```

  This keeps the entry file diff-friendly, scales to dozens of modules
  without git churn, and lets each domain own its own registration list.
  The generators (`kick g module`, `kick g middleware`, `kick g plugin`,
  `kick g adapter`) follow this layout — manual additions should too.

Everything else (controllers, services, modules, RequestContext API, generators,
package additions, env access patterns, troubleshooting) is detailed below.

## Where to Find Things

### Application Structure

| What | Where |
|------|-------|
| Entry point | `src/index.ts` |
| Module registry | `src/modules/index.ts` |
| Feature modules | `src/modules/<module-name>/` |
| **Module entry file** | `src/modules/<name>/<name>.module.ts` (filename suffix is required — see Vite HMR contract below) |
| Env values | `.env` |
| Env schema (Zod) | `src/config/index.ts` |
| TypeScript config | `tsconfig.json` |
| Vite config (HMR) | `vite.config.ts` |
| Vitest config | `vitest.config.ts` |
| Formatter config | `.oxfmtrc.json` (oxfmt) |
| CLI config | `kick.config.ts` |

### Module Pattern (MINIMAL)

> **Vite HMR auto-discovery contract:** module files **must** be named `<name>.module.ts` (or `.tsx`/`.js`/`.jsx`) and live under `src/modules/`. The Vite plugin scans for `*.module.[tj]sx?` to drive graceful HMR rebuilds; renaming a file to `projects.ts` (no `.module`) silently breaks HMR — saves trigger a full restart instead of a swap. The CLI generator (`kick g module <name>`) follows the convention; manual files must too.

Each module in `src/modules/<name>/` typically contains:

```
src/
├── index.ts                 # Add routes here
└── ...                      # Custom structure
```


## Checklist: Adding a Feature

Follow the **`kickjs-add-module`** skill — it has the ordered steps, the
canonical `defineModule` shape, and the `import.meta.glob` requirement that
silently breaks DI when omitted.

## Common Tasks

Each of these has a skill with the steps and the traps:

| Task | Skill |
| --- | --- |
| Add a feature module | `kickjs-add-module` |
| Add an adapter | `kickjs-add-adapter` |
| Add a plugin | `kickjs-add-plugin` |
| Add a context contributor | `kickjs-context-contributor` |
| Write a controller test | `kickjs-write-controller-test` |
| List endpoint with filters / pagination | `kickjs-query-parsing-list-endpoint` |
| Serve bundled assets | `kickjs-use-asset-manager` |
| Anything else | `kickjs-docs-lookup` |

## Testing Guidelines

See the **`kickjs-write-controller-test`** skill for the canonical test — it
carries the call shape, the DI reset, and the env side-effect import, each of
which has its own failure mode.

Run with `pnpm run test` (`test:watch` for watch mode).

## Environment Variables

The schema lives in `src/config/index.ts` and registers itself with kickjs **at
module load**; `src/index.ts` imports it (`import './config'`) before
`bootstrap()` so the cache is populated before DI resolves anything. Add a key
to the schema, put its value in `.env`, and it is typed everywhere.

Read it with `@Value('KEY')` for construction-time values, or inject
`ConfigService` for dynamic access.

When a key reads as `undefined`, use the **`kickjs-env-wiring-check`** skill or
run `kick explain "ConfigService.get('KEY') returned undefined"`. The cause
differs between app code and tests and the two look identical, which is what
makes it slow to spot.

## Standalone Utilities (No DI Required)

These work anywhere — scripts, plain files, outside `@Service`/`@Controller`:

| Utility | Import | Example |
|---------|--------|---------|
| `Logger.for(name)` | `@forinda/kickjs` | `const log = Logger.for('MyScript')` |
| `createLogger(name)` | `@forinda/kickjs` | `const log = createLogger('Worker')` |
| `createToken<T>(name)` | `@forinda/kickjs` | `const TOKEN = createToken<string>('app/Db/url')` |
| `ref(value)` | `@forinda/kickjs` | `const count = ref(0)` |
| `computed(fn)` | `@forinda/kickjs` | `const doubled = computed(() => count.value * 2)` |
| `watch(source, cb)` | `@forinda/kickjs` | `watch(() => count.value, (v) => log(v))` |
| `reactive(obj)` | `@forinda/kickjs` | `const state = reactive({ count: 0 })` |
| `HttpException` | `@forinda/kickjs` | `throw new HttpException(404, 'Not found')` |
| `HttpStatus` | `@forinda/kickjs` | `HttpStatus.NOT_FOUND // 404` |

## Key Decorators

### HTTP Routes
| Decorator | Purpose |
|-----------|---------|
| `@Controller()` | Define route prefix |
| `@Get('/'), @Post('/')` | HTTP method handlers |
| `@Middleware(fn)` | Attach middleware |
| `@Public()` | Skip auth (requires auth adapter) |
| `@Roles('admin')` | Role-based access |

### Dependency Injection
| Decorator | Purpose |
|-----------|---------|
| `defineModule({...})` | Define feature module (factory; preferred — paired with `defineModules()` registry) |
| `defineModules()` | Build the modules registry as a chainable list (`.mount(X())`) |
| `AppModule` interface | Legacy module shape — `class X implements AppModule` (toggle via `modules.style: 'class'`) |
| `@Service()` | Register singleton service |
| `@Repository()` | Register repository |
| `@Autowired()` | Property injection |
| `@Inject('token')` | Token-based injection |
| `@Value('VAR')` | Inject env variable |

### Context Decorators

Typed, ordered way to populate `ctx.set/get` keys before the handler runs.
Use this **instead of `@Middleware()`** when the middleware's only output
is a value other code reads off `ctx`.

**Authoring** — pick the right factory:

| Factory | When |
|---------|------|
| `defineHttpContextDecorator(spec)` | HTTP only (the common case). `Ctx` is `RequestContext`, so `ctx.req` / `ctx.params` / `ctx.query` are typed. |
| `defineContextDecorator(spec)` | Transport-agnostic (HTTP + WS + queue + cron). `Ctx` is `ExecutionContext` — only `get` / `require` / `set` / `requestId`. |
| `<either>.withParams<P>()(spec)` | The contributor takes per-call params. **Always use the curried form for params** — the positional form forces you to spell `K` and `D` and loses `deps` inference. |

Spec fields: `{ key, deps, dependsOn, optional, paramDefaults, requiredParams, onError, resolve }`.

**Call sites — all five, precedence high → low:**

| # | Site | Form |
|---|------|------|
| 1 | Method | `@LoadX` / `@LoadX({ ... })` above a controller method |
| 2 | Class | `@LoadX` / `@LoadX({ ... })` above the controller class |
| 3 | Module | `defineModule({ build: () => ({ contributors: () => [LoadX.registration] }) })` — or `AppModule.contributors?()` in class form |
| 4 | Adapter | `AppAdapter.contributors?(): ContributorRegistration[]` |
| 5 | Global | `bootstrap({ contributors: [LoadX.registration] })` |

Sites 3–5 take **registrations**, not decorators:

- `LoadX.registration` — uses `paramDefaults` as-is.
- `LoadX.with({ ...params }).registration` — call-site params merged over `paramDefaults`.

Duplicate keys are resolved by precedence; the lower-precedence one is
dropped silently, which is how a method-level decorator overrides an
adapter-shipped default.

**Params:** a **required** field of `P` with no `paramDefaults` entry must be
supplied at every call site — `@LoadX` bare, `@LoadX()`, and `.registration`
are compile errors for such a decorator. Never invent a placeholder default
just to make the type check; add `requiredParams: ['field']` for runtime
enforcement at JS call sites.

**Reading values:** `ctx.require('key')` for values a contributor guarantees
(throws `MissingContextValueError`, returns a non-optional type);
`ctx.get('key')` for `optional: true` contributors and ad-hoc keys (returns
`| undefined`). Never `ctx.get('key')!` — it compiles even when the producing
decorator isn't applied to the route.

| Concept | Where it lives |
|---------|----------------|
| Type augmentation (value types) | `declare module '@forinda/kickjs' { interface ContextMeta { ... } }` |
| Type augmentation (key-only) | `declare module '@forinda/kickjs' { interface ContextKeys { ... } }` — valid in `dependsOn`, value stays `unknown` |

Cycles and missing `dependsOn` keys throw at `app.setup()` (boot fails
fast). The `onError` hook is async-permitted.

Full guide: <https://kickjs.app/guide/context-decorators>.

## Common Pitfalls

See the **`kickjs-deny-list`** skill — the maintained list of things that
compile, run, and are still wrong.

For a specific failure, `kick explain "<error message>"` beats reading either:
it matches the message against known causes and prints the fix.

## CLI Commands Reference

See the **`kickjs-cli-commands-cheatsheet`** skill for the full table, the
shell-safe field syntax, and the non-obvious flags. `kick --help` and
`kick <cmd> --help` are authoritative for the installed version.

## Learn More

Use the **`kickjs-docs-lookup`** skill — it maps questions to the right guide
page and lists the local tools (`kick explain`, `kick doctor`, `kick inspect`,
`.kickjs/types/`) that usually answer faster than a search.

Start at <https://kickjs.app/>.

