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
