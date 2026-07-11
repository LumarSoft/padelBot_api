# API Endpoints

## Auth

### POST /auth/login

Authenticates a club staff user by email + password and returns a signed JWT
whose claims include the user's `clubId` (the tenant). The token must be sent as
`Authorization: Bearer <token>` on protected routes.

**Auth required:** No

**Request body**

| Field    | Type   | Required | Constraints      |
| -------- | ------ | -------- | ---------------- |
| email    | string | Yes      | Valid email      |
| password | string | Yes      | Min length 1     |

```json
{ "email": "admin@clubdemo.com", "password": "padel1234" }
```

**Responses**

`200 OK`

```json
{
  "token": "<jwt>",
  "user": {
    "id": "1",
    "email": "admin@clubdemo.com",
    "name": "Admin Demo",
    "clubId": "clx...",
    "clubName": "Club Demo Pádel",
    "role": "owner"
  }
}
```

`401 Unauthorized` — invalid credentials

```json
{ "statusCode": 401, "message": "Invalid credentials", "error": "Unauthorized" }
```

`400 Bad Request` — validation error (invalid/missing fields)

```json
{
  "statusCode": 400,
  "message": ["email must be an email"],
  "error": "Bad Request"
}
```

### GET /auth/me

Returns the authenticated user resolved from the JWT.

**Auth required:** Yes (`Authorization: Bearer <token>`)

**Responses**

`200 OK`

```json
{
  "user": {
    "id": "1",
    "email": "admin@clubdemo.com",
    "name": "Admin Demo",
    "clubId": "clx...",
    "clubName": "Club Demo Pádel",
    "role": "owner"
  }
}
```

`401 Unauthorized` — missing or invalid token

```json
{ "statusCode": 401, "message": "Unauthorized" }
```

## Onboarding

Club creation is **managed**: prospects ask for a club through the public form; we contact
them, configure MercadoPago and the WhatsApp line, and provision the tenant ourselves.

### POST /onboarding/request

Public lead form: the answers from the step-by-step signup at `/register`. Stores a
`ClubSignupRequest` and alerts ops (`OPS_ALERT_WEBHOOK_URL`) with a readable summary
(`lib/signup-alert.ts`) so we can call the club already knowing how their complex works.
Rate-limited 3/min per IP.

The questions serve two ends: **pre-loading the `/setup` wizard** (courts, hours, price,
deposit policy — so provisioning is half done before we sit with them) and **qualifying the
lead**. Only the contact fields are required — the commercial block is skippable in the UI,
and a half-answered lead is still worth keeping, so nothing else is rejected.

**Auth required:** No. The BFF must proxy this **without** a session (`proxyPublicToApi`) —
a prospect has none by definition.

**Request body**

| Field               | Type   | Required | Constraints                                              |
| ------------------- | ------ | -------- | -------------------------------------------------------- |
| clubName            | string | Yes      | 2–80 chars                                               |
| ownerName           | string | Yes      | 1–100 chars                                              |
| email               | string | Yes      | valid email                                              |
| phone               | string | Yes      | 6–30 chars                                               |
| message             | string | No       | ≤1000 chars                                              |
| city                | string | No       | ≤80 chars                                                |
| courtCount          | int    | No       | 1–50                                                     |
| courtType           | string | No       | `INDOOR` \| `OUTDOOR` \| `MIXED`                         |
| slotDurationMinutes | int    | No       | 30–240                                                   |
| openTime            | string | No       | `HH:MM`                                                  |
| closeTime           | string | No       | `HH:MM`                                                  |
| avgPriceCents       | int    | No       | ≥0 (cents, like everywhere else)                         |
| chargesDeposit      | string | No       | `ALWAYS` \| `SOMETIMES` \| `NEVER`                       |
| hasMercadoPago      | string | No       | `YES` \| `NO` \| `UNSURE`                                |
| currentSystem       | string | No       | `PAPER` \| `WHATSAPP` \| `SPREADSHEET` \| `SOFTWARE`     |
| biggestPain         | string | No       | `REPLYING` \| `DEPOSITS` \| `CHANGES` \| `FIXED_SLOTS` \| `OTHER` |
| fixedSlots          | string | No       | `NONE` \| `FEW` \| `SOME` \| `MANY`                      |
| howFound            | string | No       | `INSTAGRAM` \| `REFERRAL` \| `GOOGLE` \| `OTHER_CLUB` \| `OTHER` |
| contactWindow       | string | No       | `MORNING` \| `AFTERNOON` \| `EVENING` \| `ANY`           |

The allowed values live in `src/onboarding/lib/signup-answers.ts`, together with the Spanish
labels the ops alert renders.

```json
{
  "clubName": "Pádel Center",
  "ownerName": "Juan Pérez",
  "email": "juan@padelcenter.com",
  "phone": "+54 9 341 555-5555",
  "city": "Rosario",
  "courtCount": 4,
  "courtType": "INDOOR",
  "slotDurationMinutes": 90,
  "openTime": "09:00",
  "closeTime": "23:00",
  "avgPriceCents": 2000000,
  "chargesDeposit": "ALWAYS",
  "hasMercadoPago": "YES",
  "contactWindow": "AFTERNOON"
}
```

`201 Created` — `{ "received": true }`

### POST /onboarding/register

**Ops-only** provisioning (header `x-ops-secret` must equal `OPS_ADMIN_SECRET`; fails
closed when unset): creates the Club (on a `TRIAL_DAYS` free trial, default 14) and its
OWNER user, then returns the login payload (token + user).

The club is created **empty** — no demo courts, no example bookings. Courts, prices,
payments and the WhatsApp line are loaded for real in the `/setup` wizard, sitting with the
owner; seeding fake rows would only leave them data to hunt down and delete.

**Auth required:** ops secret header

**Request body** — `clubName` (2–80), `ownerName` (1–100), `email`, `password` (8–72)

`201 Created` — token + user · `403 Forbidden` — missing/invalid ops secret · `409 Conflict` — email in use

### GET /onboarding/status

Aggregated state of the guided account setup (the `/setup` wizard), in one request instead
of the five the panel used to fire. Each step's `done` is derived from the club's **real
data**, never from stored progress — a club configured by hand reads as done without ever
having opened the wizard.

Steps: `complejo` · `canchas` · `pagos` · `whatsapp` · `fijos` · `equipo` · `kiosco`.
`required` marks the three the bot cannot operate without (`canchas`, `pagos`, `whatsapp`);
`ready` is true once all of those are done. Every step is skippable regardless.

**Auth required:** Yes

`200 OK`

```json
{
  "clubName": "Padel Center",
  "setupCompletedAt": null,
  "currentStep": "pagos",
  "steps": [
    { "id": "complejo", "done": true, "acknowledged": true, "required": false },
    { "id": "canchas", "done": true, "acknowledged": true, "required": true },
    { "id": "pagos", "done": false, "acknowledged": false, "required": true }
  ],
  "counts": { "courts": 4, "recurringBookings": 12, "staff": 2, "products": 6, "whatsappLines": 1 },
  "ready": false
}
```

`404 Not Found` — club does not exist

### PATCH /onboarding/progress

Saves the wizard's position so an interrupted setup resumes where it left off. Advisory
only: `GET /onboarding/status` always derives `done` from real data, never from this.

**Auth required:** Yes (OWNER)

**Request body**

| Field       | Type     | Required | Constraints                          |
| ----------- | -------- | -------- | ------------------------------------ |
| currentStep | string   | No       | one of the step ids, or null         |
| doneSteps   | string[] | No       | step ids; duplicates are collapsed   |

```json
{ "currentStep": "pagos", "doneSteps": ["complejo", "canchas"] }
```

`200 OK` — `{ "currentStep": "pagos", "doneSteps": ["complejo", "canchas"] }`

`403 Forbidden` — caller is not the OWNER

### POST /onboarding/complete

Marks the setup as finished (`Club.setupCompletedAt`). Deliberately does **not** require
every step to be done — the owner may finish with steps skipped (e.g. MercadoPago pending
because they didn't have the credentials at hand) and complete them later in Configuración.

**Auth required:** Yes (OWNER)

`200 OK` — `{ "setupCompletedAt": "2026-07-11T18:30:00.000Z" }`

`403 Forbidden` — caller is not the OWNER

## Users (equipo)

Team management for the panel. All routes require auth; everything except
`POST /users/me/change-password` is OWNER-only. Users are always scoped to the caller's club.

### GET /users

Lists the club's users.

**Auth required:** Yes (OWNER only)

`200 OK`

```json
[
  {
    "id": 2,
    "email": "maria@club.com",
    "name": "María López",
    "role": "STAFF",
    "isActive": true,
    "mustChangePassword": false,
    "createdAt": "2026-07-09T12:00:00.000Z"
  }
]
```

### POST /users

Creates a team member with a generated temporary password, returned ONCE (the owner passes
it to the employee out-of-band; no email delivery involved). The user is flagged
`mustChangePassword` until they set their own.

**Auth required:** Yes (OWNER only)

**Request body**

| Field | Type   | Required | Constraints            |
| ----- | ------ | -------- | ---------------------- |
| email | string | Yes      | valid email, unique    |
| name  | string | Yes      | 1–100 chars            |
| role  | enum   | No       | OWNER \| STAFF (def. STAFF) |

```json
{ "email": "maria@club.com", "name": "María López" }
```

**Responses**

`201 Created`

```json
{ "user": { "id": 2, "email": "maria@club.com", "name": "María López", "role": "STAFF", "isActive": true, "mustChangePassword": true, "createdAt": "..." }, "tempPassword": "k3Xq9vZ_p1aB" }
```

`409 Conflict` — email already in use

### PATCH /users/:id

Updates a team member's name, role or active state. Deactivated users cannot log in.
The caller cannot edit themself (avoids self-lockout).

**Auth required:** Yes (OWNER only)

**Request body** — `{ "name"?: string, "role"?: "OWNER" | "STAFF", "isActive"?: boolean }`

`200 OK` — updated user · `400 Bad Request` — attempted self-edit · `404 Not Found`

### POST /users/:id/reset-password

Generates a fresh temporary password for a team member (returned once) and flags them
to change it.

**Auth required:** Yes (OWNER only)

`201 Created`

```json
{ "tempPassword": "k3Xq9vZ_p1aB" }
```

`400 Bad Request` — attempted on self (use change-password) · `404 Not Found`

### POST /users/me/change-password

Changes the caller's own password (any role). Requires the current password.

**Auth required:** Yes

**Request body**

| Field           | Type   | Required | Constraints |
| --------------- | ------ | -------- | ----------- |
| currentPassword | string | Yes      | —           |
| newPassword     | string | Yes      | 8–72 chars  |

`201 Created`

```json
{ "changed": true }
```

`400 Bad Request` — current password incorrect

## Courts

All court routes are scoped to the authenticated user's club (`clubId` from the
JWT). A club can never see or modify another club's courts.

### GET /courts

Lists the club's courts, ordered by name.

**Auth required:** Yes

`200 OK`

```json
[{ "id": "clx...", "name": "Cancha 1", "priceCents": 1200000, "createdAt": "...", "updatedAt": "..." }]
```

`priceCents` is the court's default price, applied to slots created on it.

### GET /courts/:id

Returns a single court.

**Auth required:** Yes

`200 OK` — court object · `404 Not Found` — unknown id (or another club's)

### POST /courts

Creates a court.

**Auth required:** Yes

**Request body**

| Field               | Type    | Required | Constraints                                                              |
| ------------------- | ------- | -------- | ------------------------------------------------------------------------ |
| name                | string  | Yes      | 1–80 chars                                                                |
| priceCents          | integer | Yes      | ≥ 0                                                                       |
| openTime            | string  | No       | "HH:MM" (default "09:00")                                                 |
| closeTime           | string  | No       | "HH:MM" (default "00:00"); ≤ openTime = closes past midnight the next day |
| slotDurationMinutes | integer | No       | 30–240 (default 90)                                                       |
| weeklyHours         | object  | No       | `{"0".."6": {open, close} \| null}` per-weekday overrides; null = closed  |
| courtType           | enum    | No       | INDOOR \| OUTDOOR (default INDOOR)                                        |

```json
{
  "name": "Cancha 3",
  "priceCents": 1200000,
  "openTime": "09:00",
  "closeTime": "00:00",
  "slotDurationMinutes": 90,
  "weeklyHours": { "5": { "open": "09:00", "close": "01:00" }, "0": null }
}
```

`201 Created` — the created court · `400 Bad Request` — invalid weeklyHours shape

### POST /courts/bulk-price

Mass price adjustment ("subí todo 10%"): applies a percentage to EVERY court default
price and per-band price rule of the club, rounding to the nearest $100. `dryRun: true`
returns the preview without writing. Owner-only.

**Auth required:** Yes (OWNER only)

**Request body**

| Field   | Type    | Required | Constraints        |
| ------- | ------- | -------- | ------------------ |
| percent | number  | Yes      | -50–300, non-zero  |
| dryRun  | boolean | No       | preview only       |
| effectiveDate | string | No | "YYYY-MM-DD"; a FUTURE date SCHEDULES the change (applied by a daily job at 00:10 club time) instead of applying now |

`201 Created`

```json
{
  "applied": true,
  "percent": 10,
  "courts": [{ "id": "…", "name": "Cancha 1", "beforeCents": 4000000, "afterCents": 4400000 }],
  "priceRulesUpdated": 3
}
```

### GET /courts/scheduled-price-adjustments

Pending scheduled mass price adjustments (not yet applied), soonest first. Owner-only.

**Auth required:** Yes (OWNER only)

`200 OK` — `[{ "id": "…", "percent": 10, "effectiveDateKey": "2026-08-01", "createdAt": "…" }]`

### DELETE /courts/scheduled-price-adjustments/:id

Removes a pending scheduled adjustment. Owner-only.

**Auth required:** Yes (OWNER only)

`204 No Content` · `404 Not Found`

### PATCH /courts/:id

Updates a court. Same fields as POST, all optional; `weeklyHours: null` clears every
per-weekday override.

**Auth required:** Yes

`200 OK` — updated court · `404 Not Found` · `400 Bad Request` — invalid weeklyHours

### DELETE /courts/:id

Deletes a court (and cascades its slots).

**Auth required:** Yes

`204 No Content` · `404 Not Found`

## Slots (turnos)

All slot routes are scoped to the authenticated user's club.

### GET /slots

Lists slots, ordered by `startsAt`. Optional filters via query string.

**Auth required:** Yes

**Query**

| Param   | Type     | Notes                                     |
| ------- | -------- | ----------------------------------------- |
| from    | ISO 8601 | inclusive lower bound on `startsAt`       |
| to      | ISO 8601 | inclusive upper bound on `startsAt`       |
| courtId | string   | filter by court                           |
| status  | enum     | `AVAILABLE` \| `BOOKED` \| `BLOCKED`      |

`200 OK`

```json
[
  {
    "id": "clx...",
    "courtId": "clx...",
    "startsAt": "2026-06-19T21:00:00.000Z",
    "endsAt": "2026-06-19T22:30:00.000Z",
    "priceCents": 1200000,
    "status": "AVAILABLE",
    "court": { "id": "clx...", "name": "Cancha 1" },
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

### GET /slots/:id

Returns a single slot. `200 OK` / `404 Not Found`.

**Auth required:** Yes

### POST /slots

Creates a slot.

**Auth required:** Yes

**Request body**

| Field      | Type     | Required | Constraints                              |
| ---------- | -------- | -------- | ---------------------------------------- |
| courtId    | string   | Yes      | must belong to the club                  |
| startsAt   | ISO 8601 | Yes      |                                          |
| endsAt     | ISO 8601 | Yes      | must be after `startsAt`                 |
| priceCents | integer  | Yes      | ≥ 0                                      |
| status     | enum     | No       | defaults to `AVAILABLE`                  |

```json
{
  "courtId": "clx...",
  "startsAt": "2026-06-20T18:00:00.000Z",
  "endsAt": "2026-06-20T19:30:00.000Z",
  "priceCents": 1200000
}
```

`201 Created` — the created slot

`400 Bad Request` — `endsAt` not after `startsAt`, or `courtId` not in this club

### PATCH /slots/:id

Updates a slot (any subset of the create fields).

**Auth required:** Yes

`200 OK` — updated slot · `400 Bad Request` · `404 Not Found`

### DELETE /slots/:id

Deletes a slot.

**Auth required:** Yes

`204 No Content` · `404 Not Found`

### POST /slots/bulk-block

Blocks many slots at once (e.g. a tournament): every selected court, for every day in the range, on the chosen time bands. Missing slots are created as `BLOCKED`; `AVAILABLE` slots are flipped to `BLOCKED`; `BOOKED` or already `BLOCKED` slots are left untouched and counted as skipped. New slots use the court's default price.

**Auth required:** Yes

**Request body**

| Field      | Type     | Required | Constraints                                              |
| ---------- | -------- | -------- | -------------------------------------------------------- |
| courtIds   | string[] | Yes      | non-empty; all must belong to the club                   |
| fromDate   | ISO 8601 | Yes      | inclusive start date (`YYYY-MM-DD`)                      |
| toDate     | ISO 8601 | Yes      | inclusive end date; on/after `fromDate`                  |
| slotStarts | string[] | No       | subset of valid slot starts; omit to block the whole day |

```json
{
  "courtIds": ["clx...", "cly..."],
  "fromDate": "2026-07-10",
  "toDate": "2026-07-12",
  "slotStarts": ["18:00", "19:30", "21:00"]
}
```

`200 OK`

```json
{ "blocked": 18, "created": 12, "skipped": 2 }
```

`400 Bad Request` — a court is not in this club, or `toDate` is before `fromDate`

## Bookings

All booking routes are scoped to the authenticated user's club. Bookings link a player (name + phone) to a specific slot. Creating a booking transitions the slot from `AVAILABLE` to `BOOKED`; cancelling it transitions it back to `AVAILABLE`.

### GET /bookings

Lists bookings ordered by creation date (newest first). Optional filters via query string.

**Auth required:** Yes

**Query**

| Param       | Type     | Notes                                      |
| ----------- | -------- | ------------------------------------------ |
| from        | ISO 8601 | inclusive lower bound on slot `startsAt`   |
| to          | ISO 8601 | inclusive upper bound on slot `startsAt`   |
| courtId     | string   | filter by court                            |
| status      | enum     | `CONFIRMED` \| `CANCELLED`                 |
| search  | string   | global search: player name or phone (contains); returns latest 30 by slot time |
| playerPhone | string   | exact match on player phone                |

`200 OK`

```json
[
  {
    "id": "clx...",
    "slotId": "clx...",
    "clubId": "clx...",
    "playerName": "Juan Pérez",
    "playerPhone": "+541112345678",
    "status": "CONFIRMED",
    "notes": null,
    "recurringBookingId": null,
    "bookedByUserId": 1,
    "createdAt": "...",
    "updatedAt": "...",
    "slot": {
      "id": "clx...",
      "startsAt": "2026-06-23T12:00:00.000Z",
      "endsAt": "2026-06-23T13:30:00.000Z",
      "priceCents": 1200000,
      "status": "BOOKED",
      "court": { "id": "clx...", "name": "Cancha 1" }
    }
  }
]
```

### GET /bookings/:id

Returns a single booking. `200 OK` / `404 Not Found`.

**Auth required:** Yes

### POST /bookings

Books a slot for a player. The slot must be `AVAILABLE`.

**Auth required:** Yes

**Request body**

| Field       | Type   | Required | Constraints       |
| ----------- | ------ | -------- | ----------------- |
| slotId      | string | Yes      | must be AVAILABLE |
| playerName  | string | Yes      | 2–100 chars       |
| playerPhone | string | No       | 6–20 chars        |
| notes       | string | No       | max 500 chars     |

```json
{
  "slotId": "clx...",
  "playerName": "Juan Pérez",
  "playerPhone": "+541112345678"
}
```

`201 Created` — the created booking (slot status is now `BOOKED`)

`404 Not Found` — slot not found

`409 Conflict` — slot is not available

`400 Bad Request` — validation error

### PATCH /bookings/:id/cancel

Cancels a booking. The associated slot transitions back to `AVAILABLE`.

**Auth required:** Yes

`200 OK` — the updated booking (status: `CANCELLED`)

`400 Bad Request` — booking is already cancelled

`404 Not Found`


**Deposit outcome:** when the cancelled booking had a PAID deposit (bot flow,
`transferAmountCents` set, CONFIRMED), the club's cancellation policy decides where the
money goes and records it on the booking as `depositOutcome`: cancelled
`cancellationWindowHours`+ before the slot → `CREDITED` (deposit + any applied credit
become the player's `creditCents`, applied automatically to their next booking); later →
`FORFEITED`. Unpaid bookings just restore any player credit they had consumed.

### PATCH /bookings/:id/reschedule

Moves a booking to a different slot. The old slot becomes `AVAILABLE`; the new slot becomes `BOOKED`. Both changes happen in a single transaction.

**Auth required:** Yes

**Request body**

| Field     | Type   | Required | Constraints                 |
| --------- | ------ | -------- | --------------------------- |
| newSlotId | string | Yes      | must be AVAILABLE, different |

```json
{ "newSlotId": "clx..." }
```

`200 OK` — the updated booking

`400 Bad Request` — booking is cancelled, or newSlotId equals current slotId

`404 Not Found` — booking or new slot not found

`409 Conflict` — new slot is not available

### PATCH /bookings/:id/confirm-payment

Manually confirms the transfer deposit for a `PENDING_PAYMENT` booking (front-desk verified the money landed). Flips the booking to `CONFIRMED` and notifies the player via WhatsApp. Idempotent and club-scoped.

**Auth required:** Yes

`200 OK`

```json
{ "confirmed": true }
```

`{ "confirmed": false }` — booking existed but was already processed (not pending)

`404 Not Found` — booking not found in the caller's club


**Casi-match (asignar transferencia):** the body may carry the detected transfer being
assigned — `{ "paymentRef": "<mp movement id>", "payerCuit"?, "payerEmail"?, "payerMpUserId"? }`.
The ref is single-use (400 if it already confirmed another booking), it bypasses the
RECEIPT-mode receipt requirement (the money is verified by the transfer itself), and the
payer identity is recorded on the booking + Player so future transfers reconcile alone.

### PATCH /bookings/:id/reject-payment

Manually rejects a `PENDING_PAYMENT` booking (transfer never arrived). Cancels the booking, releases the slot back to `AVAILABLE`, and notifies the player. Idempotent and club-scoped.

**Auth required:** Yes

`200 OK`

```json
{ "cancelled": true }
```

`{ "cancelled": false }` — booking existed but was already processed (not pending)

`404 Not Found` — booking not found in the caller's club

### GET /bookings/:id/receipt

Streams the latest transfer-receipt image for a booking (RECEIPT verification mode). The bytes are read from object storage server-side; the raw storage URL is never exposed. Club-scoped. Intended to be loaded by an `<img>` tag through the panel's same-origin BFF proxy.

**Auth required:** Yes

`200 OK` — the image bytes, with the stored `Content-Type` (e.g. `image/jpeg`) and `Cache-Control: private, max-age=60`.

### PUT /bookings/:id/products

Replaces all consumo lines (products consumed during the court session) attached to a booking. Passing an empty `items` array clears all consumos. Club-scoped.

Each line records which of the 4 fixed anonymous players (`1`..`4`) share its cost — used by the panel to split the turno's bill (court price ÷ 4 plus each player's share of shared consumos).

**Auth required:** Yes

**Request body**

| Field           | Type     | Required | Constraints                                  |
| --------------- | -------- | -------- | --------------------------------------------- |
| items           | array    | Yes      | may be empty to clear all consumos            |
| items[].productId | string | Yes      | must belong to the caller's club              |
| items[].quantity  | number | Yes      | integer ≥ 1                                   |
| items[].players   | number[] | Yes    | non-empty, each 1..4 (player positions sharing this line) |

```json
{
  "items": [
    { "productId": "clx...", "quantity": 1, "players": [1] },
    { "productId": "clx...", "quantity": 2, "players": [3, 4] }
  ]
}
```

`200 OK` — the updated booking, including `bookingProducts[].players` (e.g. `[1]`, `[3, 4]`, or `[1, 2, 3, 4]` for a line shared by all four)

`404 Not Found` — booking not found in the caller's club, or one of the `productId`s doesn't exist in the caller's club

`400 Bad Request` — validation error

`404 Not Found` — no receipt for this booking, or booking not in the caller's club

## Players (CRM)

The club's player file, keyed by phone. Players are created/refreshed automatically on
every booking that carries a phone (bot and panel) and backfilled from history
(`npm run players:backfill`). All routes are club-scoped.

Booking policy driven by the CRM: a player with `noShowCount ≥ NO_SHOW_FULL_THRESHOLD`
(default 3) is asked the FULL court price as the deposit by the bot; a blocked player
can't book through the bot at all (the panel always can).

### GET /players

Lists the club's players (most recently active first, up to 200), with the total
bookings count. Optional `?search=` matches name or phone.

**Auth required:** Yes

`200 OK`

```json
[
  {
    "id": "ckx…",
    "phone": "5493411234567",
    "name": "Juan Pérez",
    "dni": "30405060",
    "noShowCount": 1,
    "creditCents": 0,
    "isBlocked": false,
    "notes": null,
    "bookingsCount": 12,
    "createdAt": "…",
    "updatedAt": "…"
  }
]
```

### GET /players/:id

The player file: profile + the 15 most recent bookings (court, times, status, no-show flag).

**Auth required:** Yes

`200 OK` — player with `bookings[]` · `404 Not Found`

### PATCH /players/:id

Updates the player's name, blocked state or club notes.

**Auth required:** Yes

**Request body** — `{ "name"?: string, "isBlocked"?: boolean, "notes"?: string (≤2000) }`

`200 OK` — updated player · `404 Not Found`

### GET /bookings/:id/account

The turno's bill ("cuenta del turno"): court price ÷ 4 + each player's consumo shares
(positions J1–J4, same as `BookingProduct.playerMask`), what each already put in — the
paid seña (+ applied credit) is credited to J1, quien reservó — and the settled state.

**Auth required:** Yes

`200 OK`

```json
{
  "courtPriceCents": 4000000,
  "consumosTotalCents": 600000,
  "totalCents": 4600000,
  "depositPaidCents": 1000000,
  "unassignedPaidCents": 0,
  "paidCents": 1000000,
  "remainingCents": 3600000,
  "settledAt": null,
  "players": [
    { "slot": 1, "owesCents": 1300000, "paidCents": 1000000, "remainingCents": 300000, "depositCreditedCents": 1000000 }
  ],
  "payments": [{ "id": "…", "playerSlot": 2, "amountCents": 1000000, "method": "CASH", "createdAt": "…" }]
}
```

### POST /bookings/:id/payments

Registers one player's payment toward the bill (cierre del turno). When the whole bill
is covered, `Booking.settledAt` is set automatically ("turno finalizado"); it clears
again if a payment is undone. Returns the refreshed account.

**Auth required:** Yes

**Request body**

| Field       | Type | Required | Constraints             |
| ----------- | ---- | -------- | ----------------------- |
| playerSlot  | int  | Yes      | 1–4 (J1 = quien reservó) |
| amountCents | int  | Yes      | ≥ 1                     |
| method      | enum | Yes      | CASH \| QR \| TRANSFER |

`200 OK` — refreshed account · `400 Bad Request` — cancelled booking · `404 Not Found`

### DELETE /bookings/:id/payments/:paymentId

Undoes a registered player payment (reopens the account if it was settled). Returns the
refreshed account.

**Auth required:** Yes

`200 OK` — refreshed account · `404 Not Found`

### PATCH /bookings/:id/local-payment

Modo mostrador: records money collected at the front desk for a booking (cash or the
club's own QR — e.g. the rest of the court price on arrival), feeding the daily cash
closure in `/stats/revenue`. Amount 0 clears the record.

**Auth required:** Yes

**Request body**

| Field       | Type   | Required | Constraints    |
| ----------- | ------ | -------- | -------------- |
| method      | enum   | Yes      | CASH \| QR    |
| amountCents | int    | Yes      | ≥ 0            |

`200 OK` — updated booking · `400 Bad Request` — cancelled booking · `404 Not Found`

### POST /bookings/:id/no-show

Marks a CONFIRMED booking as a no-show (the player never came) and bumps the player's
counter. Idempotent.

**Auth required:** Yes

`200 OK` — `{ "noShowAt": "…" }` · `400 Bad Request` — booking not confirmed · `404 Not Found`

### DELETE /bookings/:id/no-show

Undoes a no-show mark (and decrements the player's counter).

**Auth required:** Yes

`204 No Content` · `404 Not Found`

## Recurring Bookings (Turnos Fijos)

Admin-only recurring reservations. When created, the pattern is automatically applied to all existing matching `AVAILABLE` slots. The pattern can be re-applied manually via the `apply` action.

A slot matches a recurring booking when: `courtId` matches, `dayOfWeek` matches the slot's `startsAt.getDay()`, and `slotStart`/`slotEnd` match the slot's hours and minutes.

### GET /recurring-bookings

Lists all recurring bookings for the club ordered by day and start time.

**Auth required:** Yes

`200 OK`

```json
[
  {
    "id": "clx...",
    "clubId": "clx...",
    "courtId": "clx...",
    "dayOfWeek": 1,
    "slotStart": "09:00",
    "slotEnd": "10:30",
    "playerName": "Club Semana",
    "playerPhone": "+541199999999",
    "priceCents": 1200000,
    "notes": null,
    "isActive": true,
    "createdByUserId": 1,
    "createdAt": "...",
    "updatedAt": "...",
    "court": { "id": "clx...", "name": "Cancha 1" }
  }
]
```

### GET /recurring-bookings/:id

Returns a single recurring booking. `200 OK` / `404 Not Found`.

**Auth required:** Yes

### POST /recurring-bookings

Creates a recurring booking and immediately applies it to all existing matching available slots.

**Auth required:** Yes

**Request body**

| Field       | Type    | Required | Constraints                                                  |
| ----------- | ------- | -------- | ------------------------------------------------------------ |
| courtId     | string  | Yes      | must belong to the club                                      |
| dayOfWeek   | integer | Yes      | 0 (Sunday) – 6 (Saturday)                                   |
| slotStart   | string  | Yes      | one of the 10 valid starts: `09:00`, `10:30`, … `22:30`     |
| slotEnd     | string  | Yes      | one of the 10 valid ends: `10:30`, `12:00`, … `00:00`       |
| playerName  | string  | Yes      | 2–100 chars                                                  |
| playerPhone | string  | Yes      | 6–20 chars                                                   |
| priceCents  | integer | Yes      | ≥ 0                                                          |
| notes       | string  | No       | max 500 chars                                                |

```json
{
  "courtId": "clx...",
  "dayOfWeek": 1,
  "slotStart": "09:00",
  "slotEnd": "10:30",
  "playerName": "Club Semana",
  "playerPhone": "+541199999999",
  "priceCents": 1200000
}
```

`201 Created` — the created recurring booking

`400 Bad Request` — invalid slot pair, courtId not in club, or validation error

### PATCH /recurring-bookings/:id

Updates editable fields (`playerName`, `playerPhone`, `priceCents`, `notes`, `isActive`). Court, day, and time cannot be changed after creation.

**Auth required:** Yes

`200 OK` — updated recurring booking · `404 Not Found`

### DELETE /recurring-bookings/:id

Hard-deletes the recurring booking. Existing bookings generated from it are kept but their `recurringBookingId` is set to `null`.

**Auth required:** Yes

`204 No Content` · `404 Not Found`

### POST /recurring-bookings/:id/apply

Re-applies a recurring booking to all currently `AVAILABLE` matching slots (useful after new slots are created).

**Auth required:** Yes

Occurrences whose booking was CANCELLED are treated as deliberately skipped ("el fijo no viene ESTE martes") and are never re-booked by apply or the weekly sweep — cancel the occurrence from the agenda to skip it.

`200 OK`

```json
{ "applied": 4 }
```

`400 Bad Request` — recurring booking is inactive

`404 Not Found`

## Clubs

Per-club settings. The transfer config holds the MercadoPago alias/CVU players send the deposit to.

### GET /clubs/me/subscription

Effective PadelBot subscription state for the panel's banner. Derived from the stored
status + dates: an ACTIVE club whose paid period lapsed behaves as past-due on its own,
with a grace window (`SUBSCRIPTION_GRACE_DAYS`, default 7) before the bot answers a
fallback message. The panel itself is never blocked.

**Auth required:** Yes

`200 OK`

```json
{
  "subscriptionStatus": "TRIAL",
  "plan": "base",
  "trialEndsAt": "2026-07-23T00:00:00.000Z",
  "currentPeriodEnd": null,
  "severity": "trial",
  "botAllowed": true,
  "daysLeft": 14
}
```

### GET /clubs/me/transfer-config

Returns the caller's club transfer config.

**Auth required:** Yes

`200 OK`

```json
{ "transferAlias": "padel.club.mp", "transferHolder": "Padel Club SRL" }
```

Fields are `null` until configured.

### PATCH /clubs/me/transfer-config

Updates the caller's club transfer config. **Owner only.** Send a field as an empty string to clear it.

**Auth required:** Yes (role `owner`)

**Request body**

| Field                   | Type   | Required | Constraints                        |
| ----------------------- | ------ | -------- | ---------------------------------- |
| transferAlias           | string | No       | max 120 chars                      |
| transferHolder          | string | No       | max 120 chars                      |
| depositMode             | enum   | No       | `DEPOSIT` \| `FULL`                |
| depositPercent          | int    | No       | 1–100 (used when `DEPOSIT`)        |
| cancellationWindowHours | int    | No       | 0–168; cancelling ≥ N h before the slot credits the deposit to the player, later forfeits it |
| requireDniMatch         | bool   | No       | only relevant in `AUTO` mode       |
| paymentVerificationMode | enum   | No       | `AUTO` \| `RECEIPT`                |

`AUTO` reconciles the deposit automatically via MercadoPago; `RECEIPT` makes the bot ask the player for a receipt photo that an admin verifies manually from the panel (the poller skips RECEIPT clubs).

```json
{ "transferAlias": "padel.club.mp", "transferHolder": "Padel Club SRL", "paymentVerificationMode": "RECEIPT" }
```

`200 OK` — the updated transfer config

`403 Forbidden` — caller is not the club owner

### GET /clubs/me/mercadopago

Returns whether the caller's club has connected its own MercadoPago account (OAuth).

**Auth required:** Yes

`200 OK`

```json
{ "connected": true, "connectedAt": "2026-06-21T18:00:00.000Z", "mpUserId": "123456789" }
```

### POST /clubs/me/mercadopago/connect

Starts the MercadoPago Connect (OAuth) flow. Returns the authorization URL the owner's
browser must visit to authorize their MercadoPago account. **Owner only.**

**Auth required:** Yes (role `owner`)

**Request body**

| Field  | Type   | Required | Constraints                                    |
| ------ | ------ | -------- | ---------------------------------------------- |
| origin | string | No       | `"configuracion"` (default) or `"setup"`       |

`origin` is the panel screen the owner started from; the OAuth callback returns them to it
(so connecting from the setup wizard doesn't dump them into Configuración). It travels
inside the encrypted `state` and is resolved against a fixed whitelist of panel paths on
the way back — it is **not** a URL, because the callback is public and echoing a
caller-supplied destination into a redirect would be an open redirect.

`200 OK`

```json
{ "url": "https://auth.mercadopago.com.ar/authorization?client_id=...&state=..." }
```

`400 Bad Request` — MercadoPago Connect or `ENCRYPTION_KEY` not configured on the server

`403 Forbidden` — caller is not the club owner

### GET /clubs/mercadopago/callback

OAuth callback hit by MercadoPago after the owner authorizes. **Not JWT-authenticated** —
secured by the signed, time-limited `state`. Exchanges the `code` for the club's tokens
(stored encrypted) and redirects the browser back to the panel (`/configuracion?mp=connected`
or `?mp=error`).

**Auth required:** No (verified via signed `state`)

**Query params**

| Field | Type   | Required | Notes                          |
| ----- | ------ | -------- | ------------------------------ |
| code  | string | Yes      | OAuth authorization code       |
| state | string | Yes      | Signed state issued at connect |

`302 Found` — redirect to the panel

### DELETE /clubs/me/mercadopago

Disconnects the club's MercadoPago account (clears stored tokens). **Owner only.**

**Auth required:** Yes (role `owner`)

`200 OK`

```json
{ "disconnected": true }
```

`403 Forbidden` — caller is not the club owner

## Stats reports

### GET /stats/occupancy

Occupancy heatmap (weekday × band start) aggregated over the last N full weeks across
every court. Owner-only. Drives "tus martes 15:00 están al 20%, probá un precio promo".

**Auth required:** Yes (OWNER only)

**Query** — `weeks` (int 1–12, default 4)

`200 OK`

```json
{
  "weeks": 4,
  "fromDateKey": "2026-06-12",
  "toDateKey": "2026-07-09",
  "bandStarts": ["09:00", "10:30"],
  "cells": [{ "weekday": 2, "bandStart": "15:00", "offered": 8, "occupied": 2 }]
}
```

### GET /stats/revenue

Money per club-local day in a range: deposits actually collected through the transfer
flow, kiosk consumption, and front-desk collections — both the legacy aggregate and the
per-player bill payments (CASH → efectivo; QR/TRANSFER → mostrador digital). Owner-only. The panel exports this as CSV.

**Auth required:** Yes (OWNER only)

**Query** — `from`, `to` ("YYYY-MM-DD"; defaults: last 30 days)

`200 OK`

```json
{
  "fromDateKey": "2026-06-10",
  "toDateKey": "2026-07-09",
  "totalDepositCents": 1250000,
  "totalProductsCents": 340000,
  "totalBookings": 84,
  "days": [{ "dateKey": "2026-07-08", "depositCents": 25000, "productsCents": 8000, "bookings": 3 }]
}
```

**Weekly digest:** every Monday 09:05 (club timezone) each club's staff devices get a
push with last week's numbers (turnos, % ocupación, señas, turnos vendidos por el bot).
Skipped for clubs with zero bookings that week. Gated by `RUN_SCHEDULER`.

## Payments (Webhooks)

Deposits are paid by bank transfer to the club's MercadoPago alias/CVU. An incoming transfer is matched to a pending booking by its **exact unique amount** (`transferAmountCents`), then the booking is confirmed and the player notified. These endpoints are unauthenticated by JWT — they are secured by a signature / shared secret instead.

### POST /webhooks/mercadopago

MercadoPago IPN webhook. The `x-signature` HMAC is verified, the payment is fetched from the MP API, and the booking is reconciled: by `external_reference` for legacy checkout payments, or by exact amount for incoming transfers.

**Auth required:** No (verified via `x-signature` header)

`200 OK` — always (processing is best-effort and idempotent)

`401 Unauthorized` — invalid `x-signature`

### POST /webhooks/transfer

Generic transfer-received webhook for an external notification source (e.g. a PagaVoz-style bridge that reads the MercadoPago/bank app's "money received" notification). Confirms the single non-expired pending booking whose `transferAmountCents` equals `amountCents`; if zero or more than one match, nothing is confirmed (left for manual review).

**Auth required:** No JWT — requires the `x-bridge-secret` header to equal `TRANSFER_BRIDGE_SECRET` (fails closed when the env var is unset).

**Request body**

| Field      | Type   | Required | Constraints           |
| ---------- | ------ | -------- | --------------------- |
| amountCents | number | Yes     | positive integer      |
| reference  | string | Yes      | source-unique movement id |

```json
{ "amountCents": 250047, "reference": "mov_abc123" }
```

`200 OK` — always (processing is best-effort and idempotent)

`403 Forbidden` — missing/invalid `x-bridge-secret`, or bridge not configured

### GET /payments/diagnostics/money-in

Read-only production go/no-go check. Lists the club's recent incoming transfers exactly as the reconciler sees them, exposing the payer identity MercadoPago returns (name, CUIT, the DNI derived from it, MP user id, email), whether each movement would match a pending booking, and `alreadyUsed` (the movement already confirmed a booking). Feeds the panel's "transferencias sin asignar" queue. Confirms nothing and changes no booking state. Reads the club's own MercadoPago account when connected, otherwise the shared env account.

**Auth required:** Yes (OWNER only)

**Query params**

| Field   | Type   | Required | Constraints              |
| ------- | ------ | -------- | ------------------------ |
| minutes | number | No       | integer 1–1440 (def. 60) |

**Responses**

`200 OK`

```json
{
  "account": "own",
  "windowMinutes": 60,
  "count": 1,
  "withIdentity": 1,
  "movements": [
    {
      "id": "123456789",
      "amountCents": 125000,
      "amountPesos": 1250,
      "dateCreated": "2026-06-26T18:20:00.000Z",
      "operationType": "cvu_in",
      "payerName": "Juan Perez",
      "payerCuit": "20304050609",
      "derivedDni": "30405060",
      "payerMpUserId": "987654321",
      "payerEmail": "juan@example.com",
      "hasPayerIdentity": true,
      "pendingMatch": { "bookingId": "ckxyz", "transferAmountCents": 125000, "playerDni": "30405060", "dniMatches": true }
    }
  ]
}
```

`400 Bad Request` — no MercadoPago account available (club not connected and no `MERCADOPAGO_ACCESS_TOKEN`)

`403 Forbidden` — caller is not the club OWNER

### GET /payments/diagnostics/health

Reconciliation health for the panel's "reconciliación activa" indicator: whether the
payments poller ran recently, consecutive failure counters (global and for the caller's
club), when the club's last booking was auto-confirmed from a real transfer, and how many
bookings are pending payment. Exposes no payer data, so STAFF can read it too. In-memory
poll state reflects the instance that runs the scheduler (see `RUN_SCHEDULER`).

**Auth required:** Yes

**Responses**

`200 OK`

```json
{
  "reconciliationActive": true,
  "lastPollOkAt": "2026-07-09T20:15:04.000Z",
  "consecutiveFailures": 0,
  "clubConsecutiveFailures": 0,
  "lastAutoConfirmationAt": "2026-07-09T19:58:31.000Z",
  "pendingCount": 2
}
```

## Waitlist (bot)

No HTTP surface — the waitlist lives inside the bot flow:

1. When a requested day has no availability, the bot offers: "respondé *avisame* y te
   escribo apenas se libere un turno ese día". Answering joins `WaitlistEntry`
   (club + phone + dateKey, deduped).
2. Whenever a slot frees (panel cancellation, expired/rejected pending) a `slot.freed`
   event fires and every waitlisted player for that day gets a WhatsApp with the freed
   court/time — throttled to one broadcast per entry per 10 minutes, max 10 recipients.
3. Each notified player's bot session is pre-seeded at the CONFIRM step for that exact
   slot, so replying "sí" runs the normal pending-booking flow — the atomic slot lock
   makes "primero que confirma, gana" true by construction.
4. Entries whose day passed are pruned daily (03:00, gated by `RUN_SCHEDULER`).

## Notifications

Registers/unregisters the staff mobile app's Expo push token so `NotificationsService.notifyClub`
can reach it. Triggered automatically (no client call needed) when a booking is created
(`"Nueva reserva pendiente de seña"`) or a transfer receipt is uploaded
(`"Nuevo comprobante para revisar"`) — hooked directly into `BookingsService.emitBookingChange`
and the receipt-upload flow, right where the SSE events already fire. Sending is best-effort: a
push failure never blocks or fails the booking/receipt action, and tokens Expo reports as
`DeviceNotRegistered` are pruned automatically.

### POST /notifications/register

Registers (or re-registers, on token rotation) the caller's device for push notifications.
Upserts by `token`, so calling it again with the same token is a no-op update. Club/user scoped
from the JWT.

**Auth required:** Yes

**Request body**

| Field    | Type   | Required | Constraints        |
| -------- | ------ | -------- | ------------------- |
| token    | string | Yes      | Min length 1 (Expo push token) |
| platform | string | Yes      | One of `ios`, `android` |

```json
{ "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "platform": "ios" }
```

**Responses**

`200 OK` — empty body

### DELETE /notifications/register

Removes a device token (called on logout so a signed-out device stops receiving pushes for this
club). Scoped to the caller — a user cannot remove another user's token.

**Auth required:** Yes

**Request body**

| Field | Type   | Required | Constraints  |
| ----- | ------ | -------- | ------------ |
| token | string | Yes      | Min length 1 |

```json
{ "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
```

**Responses**

`200 OK` — empty body

---

## Ops console (Lumarsoft, cross-tenant)

The internal console at `/ops` (panel). **Every route here reads across tenants**, which is
exactly what the rest of this API is built never to do. Two things keep that safe:

1. **A separate identity.** `PlatformAdmin` is not a `User` — it has no `clubId`, so a club
   admin can never be one by accident.
2. **A separate key.** Ops tokens are signed with `OPS_JWT_SECRET`, not `JWT_SECRET`. A club's
   token doesn't merely get rejected here — it fails to verify. The reverse holds too.

The console is **opt-in**: with `OPS_JWT_SECRET` unset, login returns `503` and no token can
validate. The club-facing API is unaffected.

Create the first operator on the server: `npm run ops:admin -- --email … --name … --password …`

### POST /ops/auth/login

Signs an operator in and returns the ops token.

**Auth required:** No (it mints the token). Rate-limited to 5/min per IP.

**Request body**

| Field    | Type   | Required | Constraints  |
| -------- | ------ | -------- | ------------ |
| email    | string | Yes      | valid email  |
| password | string | Yes      | min length 1 |

```json
{ "email": "mateo@lumarsoft.com", "password": "…" }
```

**Responses**

`200 OK`
```json
{
  "token": "eyJhbGciOi…",
  "admin": { "id": "1", "email": "mateo@lumarsoft.com", "name": "Mateo" }
}
```

`401 Unauthorized` — wrong credentials, or the account is deactivated.
```json
{ "message": "Credenciales incorrectas", "statusCode": 401 }
```

`503 Service Unavailable` — `OPS_JWT_SECRET` is not configured; the console is disabled.
```json
{ "message": "La consola de operaciones no está configurada", "statusCode": 503 }
```

### GET /ops/auth/me

The signed-in operator.

**Auth required:** Yes (ops token)

**Responses**

`200 OK`
```json
{ "id": "1", "email": "mateo@lumarsoft.com", "name": "Mateo" }
```

### GET /ops/leads

The signup pipeline — every answer from the `/register` form, plus our sales file.

**Auth required:** Yes (ops token)

**Query**

| Field  | Type   | Required | Constraints                            |
| ------ | ------ | -------- | -------------------------------------- |
| status | string | No       | `NEW` \| `CONTACTED` \| `CONVERTED` \| `LOST` — omit for the whole pipeline |

**Responses**

`200 OK` — newest first.
```json
[
  {
    "id": "clx…",
    "clubName": "Padel Center",
    "ownerName": "Ana",
    "email": "ana@padelcenter.com",
    "phone": "5493411234567",
    "city": "Rosario",
    "courtCount": 3,
    "courtType": "INDOOR",
    "slotDurationMinutes": 90,
    "openTime": "09:00",
    "closeTime": "00:00",
    "avgPriceCents": 2000000,
    "chargesDeposit": "SOMETIMES",
    "hasMercadoPago": "YES",
    "currentSystem": "WHATSAPP",
    "biggestPain": "DEPOSITS",
    "fixedSlots": "SOME",
    "howFound": "REFERRAL",
    "contactWindow": "CUSTOM",
    "contactWindowNote": "martes y jueves después de las 16",
    "message": "Quiero dejar de perseguir las señas.",
    "status": "NEW",
    "internalNotes": null,
    "contactedAt": null,
    "convertedClubId": null,
    "createdAt": "2026-07-11T18:00:00.000Z"
  }
]
```

### GET /ops/leads/summary

Where the leads come from, how fast we answer, and what they say hurts.

**Auth required:** Yes (ops token)

**Responses**

`200 OK` — `medianResponseHours` is the median (not mean) time from lead to first contact, and
is `null` until we've contacted at least one.
```json
{
  "pipeline": { "NEW": 2, "CONTACTED": 1, "CONVERTED": 1, "LOST": 0 },
  "last30Days": 4,
  "medianResponseHours": 3.5,
  "byChannel": [{ "value": "REFERRAL", "leads": 3, "converted": 1 }],
  "byPain": [{ "value": "DEPOSITS", "count": 3 }]
}
```

### GET /ops/leads/:id

One lead.

**Auth required:** Yes (ops token)

**Responses**

`200 OK` — same shape as an item of `GET /ops/leads`.

`404 Not Found`
```json
{ "message": "Lead no encontrado", "statusCode": 404 }
```

### PATCH /ops/leads/:id

Moves a lead through the pipeline, and stores our notes on it. `contactedAt` is stamped the
first time the lead leaves `NEW` and is never overwritten — it's the start of the
response-time metric.

**Auth required:** Yes (ops token)

**Request body**

| Field         | Type   | Required | Constraints                                     |
| ------------- | ------ | -------- | ----------------------------------------------- |
| status        | string | No       | `NEW` \| `CONTACTED` \| `CONVERTED` \| `LOST`   |
| internalNotes | string | No       | max 4000 chars. Never shown to the prospect.    |

```json
{ "status": "CONTACTED", "internalNotes": "Llamar el lunes, compara con Playtomic." }
```

**Responses**

`200 OK` — the updated lead.

`404 Not Found`
```json
{ "message": "Lead no encontrado", "statusCode": 404 }
```

### POST /ops/leads/:id/provision

Creates the tenant from the lead and marks it `CONVERTED`, linked to the club it became. The
club is created **empty** (as with `POST /onboarding/register`) — the courts/prices/hours the
prospect gave us pre-load the `/setup` wizard, they are not written here.

**Auth required:** Yes (ops token)

**Request body**

| Field     | Type   | Required | Constraints                                              |
| --------- | ------ | -------- | -------------------------------------------------------- |
| password  | string | Yes      | 8–72 chars. Temporary — the owner changes it on first login. |
| clubName  | string | No       | 2–80 chars. Defaults to the lead's.                       |
| ownerName | string | No       | 1–100 chars. Defaults to the lead's.                      |
| email     | string | No       | valid email. Defaults to the lead's.                      |

```json
{ "password": "temporal-2026", "clubName": "Padel Center" }
```

**Responses**

`201 Created` — the lead, now `CONVERTED` with `convertedClubId` set.

`409 Conflict` — already provisioned, or the email is taken by another account.
```json
{ "message": "Este lead ya fue convertido en club", "statusCode": 409 }
```

### GET /ops/clubs

Every tenant: subscription, whether it can actually take a booking, what it's doing, and what
it costs us. `activity` covers the last 30 days.

**Auth required:** Yes (ops token)

**Responses**

`200 OK` — `readiness.ready` is true only with courts + payments + a WhatsApp line: a club
missing any of them is not live, whatever its subscription says. `dormant` means nobody has
opened the panel in 14 days (trial clubs are exempt — they haven't had time).
```json
[
  {
    "id": "clx…",
    "name": "Club Demo Pádel",
    "slug": "club-demo",
    "createdAt": "2026-06-21T20:30:28.969Z",
    "subscription": {
      "subscriptionStatus": "TRIAL",
      "plan": "base",
      "trialEndsAt": null,
      "currentPeriodEnd": null,
      "severity": "trial",
      "botAllowed": true,
      "daysLeft": null
    },
    "readiness": {
      "courts": 2,
      "paymentsConfigured": true,
      "mpConnected": false,
      "whatsappLines": 1,
      "ready": true,
      "setupCompletedAt": "2026-07-11T15:28:16.035Z"
    },
    "activity": {
      "bookingsBot": 22,
      "bookingsPanel": 9,
      "depositsCents": 10000000,
      "conversations": 1,
      "lastPanelLoginAt": "2026-07-11T14:02:00.000Z",
      "dormant": false
    },
    "llmCostMicroUsd": 41230
  }
]
```

### PATCH /ops/clubs/:id/subscription

Manual billing from the UI — the same thing `npm run subscription` does from the shell.

**Auth required:** Yes (ops token)

**Request body**

| Field  | Type   | Required | Constraints                                                 |
| ------ | ------ | -------- | ----------------------------------------------------------- |
| status | string | Yes      | `TRIAL` \| `ACTIVE` \| `PAST_DUE` \| `CANCELLED`            |
| months | number | No       | 1–24. With `ACTIVE`: paid months from now. Default 1.       |
| days   | number | No       | 1–180. With `TRIAL`: trial days from now. Default 14.       |
| plan   | string | No       | max 40 chars (`base` / `pro`).                              |

```json
{ "status": "ACTIVE", "months": 1 }
```

**Responses**

`200 OK` — the derived subscription state.
```json
{
  "subscriptionStatus": "ACTIVE",
  "plan": "base",
  "trialEndsAt": null,
  "currentPeriodEnd": "2026-08-10T21:00:00.000Z",
  "severity": "ok",
  "botAllowed": true,
  "daysLeft": 30
}
```

`404 Not Found`
```json
{ "message": "Club no encontrado", "statusCode": 404 }
```

### GET /ops/metrics/business

MRR, activation, GMV and bot-vs-panel across every club. Last 30 days.

**Auth required:** Yes (ops token)

**Responses**

`200 OK` — MRR prices each `ACTIVE` club by `PLAN_PRICE_<PLAN>_CENTS`; a plan with no
configured price contributes 0 and is counted in `clubsWithoutPrice` rather than guessed at.
`activation.activated` counts clubs that reached a real bot booking within 7 days of being
provisioned.
```json
{
  "mrrCents": 3500000,
  "clubsWithoutPrice": 0,
  "clubs": { "total": 1, "trial": 1, "active": 0, "pastDue": 0, "cancelled": 0, "ready": 1 },
  "activation": { "provisioned": 1, "activated": 1, "medianDaysToFirstBooking": 0 },
  "gmvCents": 10000000,
  "bookings": { "bot": 22, "panel": 9 },
  "series": [{ "date": "2026-07-11", "bot": 3, "panel": 1 }]
}
```

### GET /ops/metrics/bot

Whether the bot closes bookings on its own, and what it costs us to do so. Last 30 days.

**Auth required:** Yes (ops token)

**Responses**

`200 OK` — `handedToHuman` is the bot's failure rate (the player asked for a person, or staff
took over). Costs are in **micro-USD** (integers; 1e-6 USD) and come from `LlmUsageDaily`.
```json
{
  "funnel": {
    "conversations": 84,
    "bookingsStarted": 22,
    "bookingsConfirmed": 15,
    "handedToHuman": 3
  },
  "byState": [{ "state": "BOOK_SLOT", "count": 1 }],
  "messages": { "user": 81, "bot": 81, "admin": 2 },
  "cost": {
    "totalMicroUsd": 41230,
    "calls": 96,
    "microUsdPerConfirmedBooking": 2749,
    "perClub": [
      { "clubId": "clx…", "clubName": "Club Demo Pádel", "microUsd": 41230, "calls": 96 }
    ],
    "series": [{ "date": "2026-07-11", "microUsd": 1820 }]
  }
}
```

### GET /ops/health

Everything that needs a human, across every club. **An empty `issues` array means nothing is
wrong** — the screen is a to-do list, not a wall of green ticks.

**Auth required:** Yes (ops token)

**Responses**

`200 OK` — `poller` is the reconciliation poller's in-memory state (meaningful on the instance
running the scheduler, see `RUN_SCHEDULER`). Issue kinds: `POLLER_DOWN`, `CLUB_MP_FAILING`,
`STUCK_PENDING`, `RECEIPT_AWAITING_REVIEW`, `MP_TOKEN_EXPIRING`, `ADVISOR_WAITING`,
`CLUB_NOT_LIVE`. Critical ones sort first.
```json
{
  "poller": {
    "reconciliationActive": true,
    "lastPollOkAt": "2026-07-11T21:06:40.000Z",
    "consecutiveFailures": 0,
    "failingClubs": []
  },
  "issues": [
    {
      "kind": "RECEIPT_AWAITING_REVIEW",
      "severity": "warning",
      "message": "2 comprobantes sin revisar en Club Demo Pádel. El jugador ya pagó y está esperando.",
      "clubId": "clx…",
      "clubName": "Club Demo Pádel",
      "count": 2
    }
  ],
  "webhookDedupRows": 0,
  "checkedAt": "2026-07-11T21:06:58.317Z"
}
```
