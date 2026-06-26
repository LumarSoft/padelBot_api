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

| Field      | Type    | Required | Constraints |
| ---------- | ------- | -------- | ----------- |
| name       | string  | Yes      | 1–80 chars  |
| priceCents | integer | Yes      | ≥ 0         |

```json
{ "name": "Cancha 3", "priceCents": 1200000 }
```

`201 Created` — the created court

### PATCH /courts/:id

Updates a court.

**Auth required:** Yes

**Request body** — `{ "name"?: string (1–80 chars), "priceCents"?: integer (≥ 0) }`

`200 OK` — updated court · `404 Not Found`

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

### PATCH /bookings/:id/reject-payment

Manually rejects a `PENDING_PAYMENT` booking (transfer never arrived). Cancels the booking, releases the slot back to `AVAILABLE`, and notifies the player. Idempotent and club-scoped.

**Auth required:** Yes

`200 OK`

```json
{ "cancelled": true }
```

`{ "cancelled": false }` — booking existed but was already processed (not pending)

`404 Not Found` — booking not found in the caller's club

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

`200 OK`

```json
{ "applied": 4 }
```

`400 Bad Request` — recurring booking is inactive

`404 Not Found`

## Clubs

Per-club settings. The transfer config holds the MercadoPago alias/CVU players send the deposit to.

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

| Field          | Type   | Required | Constraints   |
| -------------- | ------ | -------- | ------------- |
| transferAlias  | string | No       | max 120 chars |
| transferHolder | string | No       | max 120 chars |

```json
{ "transferAlias": "padel.club.mp", "transferHolder": "Padel Club SRL" }
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

Read-only production go/no-go check. Lists the club's recent incoming transfers exactly as the reconciler sees them, exposing the payer identity MercadoPago returns (name, CUIT, the DNI derived from it, MP user id, email) and whether each movement would match a pending booking. Confirms nothing and changes no booking state. Reads the club's own MercadoPago account when connected, otherwise the shared env account.

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
