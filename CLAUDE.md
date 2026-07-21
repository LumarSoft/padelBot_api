# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm run start:dev       # watch mode (preferred for development)
pnpm run build           # compile to dist/
pnpm run start:prod      # run compiled output

# Testing
pnpm run test            # unit tests (jest, rootDir: src, pattern: *.spec.ts)
pnpm run test:watch      # watch mode
pnpm run test:cov        # coverage report
pnpm run test:e2e        # e2e tests (test/jest-e2e.json config)

# Single test file
pnpm run test -- --testPathPattern=app.controller

# Code quality
pnpm run lint            # eslint with auto-fix
pnpm run format          # prettier write

# Prisma
npx prisma migrate dev   # create and apply migration
npx prisma generate      # regenerate client after schema changes
npx prisma studio        # visual DB browser
```

## Architecture

**Framework:** NestJS v11 with TypeScript (target ES2022, `CommonJS` module / `node` resolution).

**Database:** MySQL via Prisma v7 (using `@prisma/adapter-mariadb`). The Prisma client is generated to `generated/prisma` (gitignored — run `npx prisma generate` after cloning). Always import from `'generated/prisma/client'` (resolved via `baseUrl: "./"` in tsconfig).

**Prisma v7 config:** Configuration lives in `prisma.config.ts`, not in `schema.prisma`. The datasource block in `schema.prisma` has no `url` — the connection string is resolved at runtime from `env('DATABASE_URL')` in `prisma.config.ts`. The generator uses the new `prisma-client` provider (not `prisma-client-js`), which is why output goes to `generated/prisma` and `PrismaService` is constructed with an explicit `PrismaMariaDb` adapter rather than a bare `PrismaClient`.

**Auth stack:** JWT via `@nestjs/jwt` + `@nestjs/passport` + `passport-jwt`, passwords hashed with `bcrypt`. The JWT payload carries `clubId`, `role`, `name`, `email` (`src/auth/types/jwt-payload.ts`). Protect routes with `@UseGuards(JwtAuthGuard)` and read the caller with the `@CurrentUser()` decorator. `OWNER` vs `STAFF` is enforced per-controller (e.g. only OWNER can change payment settings).

**Env vars:** `DATABASE_URL` (Prisma, loaded via `dotenv/config` in `main.ts`), `JWT_SECRET`, `ENCRYPTION_KEY` (AES key used by `CryptoService` to encrypt MercadoPago tokens at rest), Meta WhatsApp credentials, and MercadoPago OAuth (`MP_*`) credentials. Server port defaults to `3000` (`process.env.PORT`). Copy `.env.example` → `.env` and fill in the values.

**DTO validation:** `ValidationPipe` is configured globally in `main.ts` with `whitelist`, `forbidNonWhitelisted`, and `transform`. Use `class-validator` decorators on all DTOs.

**Module structure:** Standard NestJS feature modules — each domain gets its own directory under `src/` with `module`, `controller`, `service`, and `dto/` files. Register new modules in `AppModule`.

## Product & domain

This is **GTP**, a multi-tenant SaaS for padel clubs in Rosario, Argentina (see `../docs/BITACORA.md` for the product story). A WhatsApp bot attends players, books courts and reconciles the deposit ("seña") transfer automatically; owners manage everything from the Next.js panel (`../padelBot_admin`). The data model and tenant boundaries live in `prisma/schema.prisma` — **read it first**; it is the source of truth.

**Multi-tenant of record:** `Club` is the tenant. Every relevant row (`Court`, `Slot`, `Booking`, `RecurringBooking`, `WhatsAppLine`, `ConversationSession`, `User`) carries a `clubId` and is isolated per club. **Never** write a query that can cross tenants — always scope by the caller's `clubId` from the JWT.

**Feature modules (all built and wired in `AppModule`):**

- `auth` — JWT login, guard, `@CurrentUser()` decorator, `OWNER`/`STAFF` roles.
- `onboarding` — managed club signup (`POST /onboarding/request` captures the lead; ops-only `POST /onboarding/register` provisions an **empty** Club + OWNER on a trial — no demo data), plus the **guided account setup** behind the panel's `/setup` wizard: `GET /onboarding/status` aggregates the state of the seven setup steps, `PATCH /onboarding/progress` stores the resume position on `Club.setupProgress`, `POST /onboarding/complete` sets `Club.setupCompletedAt`. Each step's `done` is **derived from the club's real data** (`OnboardingService.getStatus`), never trusted from the stored progress blob, so a club configured by hand reads as done. Every step is skippable; `ready` gates only on the three the bot can't run without (courts, payment config, WhatsApp line).
- `clubs` — per-club transfer config (alias/holder) and **MercadoPago Connect OAuth** (each club connects its own MP account; tokens stored encrypted via `CryptoService`, refreshed by the poller before expiry).
- `courts` — physical courts (`name`, `priceCents`, `openTime`/`closeTime`, `courtType` INDOOR/OUTDOOR).
- `slots` — bookable time bands (`turnos`); supports bulk-blocking. Unique `(courtId, startsAt)` prevents concurrent admin+bot from duplicating a slot.
- `availability` — derives open bands from a court's schedule. **Slot duration is the hardcoded constant `SLOT_DURATION_MINUTES = 90` in `availability/lib/schedule.ts` — it is NOT yet a per-court field.** Making it configurable (with the 90-min padel default) is a roadmap item.
- `bookings` — reservations with a `BookingStatus` state machine (`PENDING_PAYMENT` → `CONFIRMED` / `CANCELLED`), reschedule, cancel.
- `recurring-bookings` — weekly fixed reservations (`turnos fijos`) auto-applied to matching slots.
- `whatsapp` — Meta WhatsApp Business webhook (verify + receive), with dedup of Meta retries via `ProcessedWebhookMessage`.
- `whatsapp-lines` — maps a Meta `phoneNumberId` to a club so the bot resolves the tenant of an incoming message.
- `bot` — the conversational state machine + `ConversationSession` persistence; AI/HUMAN takeover mode.
- `llm` — LLM with tool-calling (`llm/tools.ts`, `llm/system.prompt.ts`) that interprets messages and executes booking actions.
- `conversations` — persistent per-message log (`ConversationMessage`), admin manual replies, AI/HUMAN mode switch.
- `payments` — transfer reconciliation against MercadoPago, including the **centavos trick**: when two pending bookings collide in the same whole-peso bucket, each gets a distinct `transferAmountCents` so one incoming transfer maps to exactly one pending booking.
- `mercadopago` — MercadoPago API client + OAuth token exchange/refresh.
- `events` — Server-Sent Events (`booking-events.service.ts`) so the panel reflects bot bookings in real time.
- `stats` — `GET /stats/overview` aggregates per-club dashboard metrics (today's turnos, active reservations, active chats, pending payments, deposits collected, bot-vs-panel bookings, and a 14-day series).
- `ops` — the **Lumarsoft ops console** (`/ops` in the panel), and the ONE module that reads across tenants on purpose: the lead pipeline from the `/register` form (+ provisioning a club straight from a lead), the tenants table, business/bot metrics (MRR, activation, bot-vs-panel, OpenAI cost per club) and cross-club system health. Two things keep the tenant boundary honest: the identity is a `PlatformAdmin` (no `clubId` — a club `User` can never be one), and its JWT is signed with **`OPS_JWT_SECRET`, not `JWT_SECRET`**, so a club token doesn't verify against `OpsAuthGuard` and vice versa. The console is **opt-in**: with `OPS_JWT_SECRET` unset it disables itself (login 503s, no token validates) and the club API is untouched — never crash the tenants' product over an internal tool. Bootstrap an operator with `npm run ops:admin`.
- `booking-reminders` — cron (`EVERY_5_MINUTES`) that WhatsApps a player ~1h before their confirmed slot via a Meta message template (required outside the 24h session window). Needs `WHATSAPP_REMINDER_TEMPLATE_NAME`/`_LANG` approved per club's number to actually deliver; `Booking.reminderSentAt` guards against duplicate sends and is reset on reschedule.

**Payment policy (seña vs full):** what the bot asks the player to transfer is per-club config on `Club`: `depositMode` (`DEPOSIT` = a seña of `depositPercent`% of the court price, default 25%; `FULL` = the whole court price). `BookingsService.resolveDepositCents` computes the amount; the bot's confirmation wording adapts in `messages.ts`. The owner sets this in the panel's Pagos tab. (Per-player choice at booking time is a future extension — see ROADMAP.)
- `common/crypto` — AES encrypt/decrypt for secrets at rest. `common/filters` — global exception filter.

**What's NOT built yet (see `../docs/ROADMAP.md`):** self-service onboarding (alta of a club without manual DB work), SaaS billing of GTP itself, configurable slot duration per court, "tipo de complejo" and multi-venue (one brand with several addresses), and automated tests of the critical flows.

> ⚠️ **Pending migration:** `prisma/migrations/20260623190000_add_deposit_mode` (adds `Club.depositMode`/`depositPercent`) must be applied with `npx prisma migrate deploy` (or `dev`) before running against a real DB. The Prisma client is already regenerated.

**Code style:** Single quotes, trailing commas (enforced by Prettier). `noImplicitAny` is off; `strictNullChecks` is on. Everything in English (code, comments); user-facing bot/panel copy is in Spanish (Rioplatense).

## Rules

See @docs/rules/architecture.md for module structure rules.
See @docs/rules/database.md for Prisma and MySQL rules.
See @docs/rules/validation.md for DTO and validation rules.
See @docs/rules/error-handling.md for error handling rules.
See @docs/rules/security.md for security rules.
See @docs/rules/naming.md for naming conventions.
See @docs/rules/commits.md for commit conventions.
See @docs/rules/documentation.md for endpoint documentation rules.
