# PadelBot API

Backend y **bot conversacional multitenant** para clubes de pádel. Construido con **NestJS v11**, **Prisma v7** y **MySQL/MariaDB**.

Este repo es uno de los dos que componen el producto:

| Repo | Rol |
| ---- | --- |
| **`padelbot_api`** (este) | API REST + bot multitenant. Atiende a los jugadores por mensajería, gestiona turnos y expone los endpoints que consume el panel. |
| **`padelbot_admin`** | Panel de administración (Next.js) para que cada club gestione sus turnos, supervise y dirija las conversaciones del bot. |

---

## 1. La idea (visión de producto)

PadelBot es un **SaaS multitenant** que se vende a varios clubes de pádel. Cada club es un **tenant** aislado dentro de la misma plataforma.

- Cada club conecta su canal de mensajería (WhatsApp como principal) y obtiene un **bot** que atiende a sus jugadores: consulta de disponibilidad, reserva de turnos, cancelaciones, recordatorios, etc.
- El bot es **híbrido**:
  - **Camino feliz por opciones/menús** (máquina de estados): determinístico, rápido y barato. Es el comportamiento por defecto y cubre el grueso de las reservas.
  - **Fallback con LLM (OpenAI)**: cuando el jugador escribe en lenguaje natural o el flujo por menús no alcanza, interviene el LLM con *function calling* para entender la intención y ejecutar acciones (consultar/reservar/cancelar) sobre los datos del club.
- Desde el panel (`padelbot_admin`), el club puede **ver las conversaciones, interrumpirlas y tomar el control** (handoff humano), además de administrar qué turnos ofrece, verlos y editarlos.

> El objetivo es que el mismo código sirva a N clubes sin mezclar datos entre ellos. Todo lo que toca la base de datos debe estar **filtrado por tenant**.

---

## 2. Stack

- **NestJS v11** (TypeScript, target ES2022, CommonJS).
- **Prisma v7** con el provider nuevo `prisma-client` (cliente generado en `generated/prisma`, **gitignored**) y el adapter `@prisma/adapter-mariadb`. La config vive en `prisma.config.ts`, no en `schema.prisma`.
- **MySQL/MariaDB** como base de datos.
- **Auth JWT** (`@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, `bcrypt`) — paquetes ya instalados, módulos por scaffoldear.
- **OpenAI** para el fallback conversacional del bot (a integrar).
- Mensajería: **WhatsApp Cloud API**. Por el momento se integra vía el **webhook de Meta** (recepción de mensajes por el webhook de la Cloud API y envío por su Graph API). Va detrás de una capa de canales abstracta para poder sumar otros canales después.

> **Estado actual:** el proyecto está recién scaffoldeado. Solo existen `AppModule` (con el `AppController`/`AppService` por defecto) y un `PrismaModule`/`PrismaService` global. El schema define un único modelo `User`. Todo lo de abajo es el trabajo a construir.

---

## 3. Multitenancy

Estrategia elegida para arrancar: **una sola base de datos, aislada por `tenantId` (club)**.

Reglas:

- Existe un modelo raíz **`Club`** (el tenant). Casi todos los demás modelos llevan un `clubId` con su `@relation` al `Club`.
- **Toda** query a la base debe filtrar por el `clubId` del request. Ninguna consulta puede devolver datos de otro club.
- El `clubId` del request se resuelve y se inyecta de forma central (guard/interceptor + un objeto de contexto por request), **nunca** se confía en un `clubId` que mande el cliente en el body.
- Recomendado: un **middleware/extension de Prisma** que inyecte automáticamente el filtro `clubId` en lecturas y el valor en escrituras, para que sea imposible olvidarlo a mano.
- Para el bot, el tenant se resuelve a partir del canal entrante (p. ej. el número/línea de WhatsApp del club → `clubId`).

> Alternativas (schema-por-tenant o base-por-tenant) quedan descartadas para el MVP por costo operativo. Si se necesitan más adelante, la capa de resolución de tenant ya estará aislada.

---

## 4. Arquitectura del bot

```
Mensaje entrante (WhatsApp)
        │
        ▼
[ Channel adapter ]  → normaliza el mensaje y resuelve el club (tenant)
        │
        ▼
[ Conversation engine ]
   ├─ ¿Coincide con un paso del flujo por menús/estado?  → Máquina de estados (determinística)
   └─ ¿Mensaje libre / sin match?                        → LLM (OpenAI) + tools
                                                              ├─ getAvailability(clubId, ...)
                                                              ├─ bookSlot(clubId, ...)
                                                              ├─ cancelBooking(clubId, ...)
                                                              └─ ...
        │
        ▼
[ Estado de la conversación persistido ]  ← el panel puede leerlo, interrumpirlo y tomar control
        │
        ▼
Respuesta saliente (WhatsApp)
```

Puntos clave de diseño:

- **Capa de canales abstracta**: un `ChannelAdapter` por proveedor (WhatsApp primero; Telegram/web después). El motor de conversación no sabe de qué canal viene el mensaje.
- **Canal actual — WhatsApp vía webhook de Meta**: por ahora el único canal es WhatsApp Cloud API. Meta envía los mensajes entrantes a nuestro **webhook** (con verificación por `WHATSAPP_VERIFY_TOKEN` en el handshake `GET`) y nosotros respondemos llamando a la Graph API de WhatsApp. El `ChannelAdapter` de WhatsApp encapsula esto; el resto del bot es agnóstico del canal.
- **Máquina de estados primero**: el flujo de reserva común se resuelve con opciones/botones, sin gastar tokens de LLM.
- **LLM como fallback** con *function calling*: las "tools" del LLM son funciones del backend que **siempre** reciben el `clubId` resuelto del lado servidor. El LLM nunca ejecuta SQL ni recibe datos crudos de otros clubes.
- **Estado de conversación persistido por tenant**: cada conversación (jugador ↔ bot) se guarda con su historial y estado. Esto habilita el **handoff humano**: un operador del club puede pausar el bot, escribir manualmente y reanudar.
- **Idempotencia y webhooks**: la recepción de mensajes (webhook de WhatsApp) debe ser idempotente.

---

## 5. Modelo de dominio propuesto

Punto de partida para `prisma/schema.prisma` (a refinar por el equipo). Todo modelo de negocio cuelga de `Club`:

- **`Club`** — el tenant. Datos del club, config del canal (credenciales WhatsApp), zona horaria, estado de la suscripción.
- **`User`** — usuario del **panel** (staff del club). Tiene `clubId`, `email`, `password` (hash), `role`. Es quien hace login en `padelbot_admin`. *(El modelo `User` actual hay que extenderlo con `clubId` y `role`.)*
- **`Court`** — cancha del club.
- **`Slot` / `TimeSlot`** — turno que ofrece el club (cancha + fecha/hora + duración + precio + estado disponible/reservado/bloqueado). "Administrar qué turnos da el club" = CRUD sobre esto.
- **`Player`** — jugador final (cliente del club) identificado por su canal (p. ej. teléfono de WhatsApp). Pertenece a un `Club`.
- **`Booking`** — reserva de un `Slot` por un `Player`. Estados (pendiente/confirmada/cancelada).
- **`Conversation`** — hilo entre un `Player` y el bot, con su estado de máquina de estados y flag de "control humano".
- **`Message`** — cada mensaje de una `Conversation` (entrante/saliente, autor: jugador/bot/operador).

> Recordá las reglas de `docs/rules/database.md`: PK en todo modelo, `createdAt`/`updatedAt`, FKs con `@relation` explícito, y **nunca** devolver campos sensibles (`password`, tokens) — usar `select` explícito.

---

## 6. Endpoints que consume el panel

El panel (`padelbot_admin`) necesitará, como mínimo:

- **Auth**: `register` / `login` de usuarios del club (JWT). Cada token lleva el `clubId`.
- **Slots/turnos**: CRUD de la oferta de turnos del club.
- **Bookings**: listar/editar/cancelar reservas.
- **Conversations**: listar conversaciones, leer el historial, **interrumpir** (tomar control), enviar un mensaje manual y **reanudar** el bot.
- **Players**: listado de jugadores del club.

> Cada endpoint autenticado debe llevar el guard JWT explícito y filtrar por el `clubId` del token (ver `docs/rules/security.md`). Documentar cada endpoint en `docs/endpoints.md` en el mismo commit (ver `docs/rules/documentation.md`).

---

## 7. Roadmap sugerido

1. **Fundaciones multitenant**: modelos `Club` + `User(clubId, role)`, auth JWT con `clubId` en el token, resolución de tenant central (guard/interceptor) y filtro Prisma por `clubId`.
2. **Gestión de turnos**: modelos `Court`/`Slot`, CRUD de la oferta de turnos (consumido por el panel).
3. **Canal + recepción de mensajes**: webhook de Meta (WhatsApp Cloud API) con su verificación, `ChannelAdapter`, persistencia de `Conversation`/`Message`/`Player`.
4. **Motor por menús**: máquina de estados para el flujo de reserva (consultar disponibilidad → elegir turno → confirmar).
5. **Fallback LLM (OpenAI)**: function calling con tools `getAvailability`/`bookSlot`/`cancelBooking`, siempre con `clubId` del servidor.
6. **Handoff humano**: endpoints de conversaciones para que el panel interrumpa, escriba y reanude.
7. **Reservas y recordatorios**: `Booking`, confirmaciones y recordatorios programados.

---

## 8. Puesta en marcha

### Requisitos

- Node.js
- pnpm
- MySQL/MariaDB corriendo localmente

### 1. Instalar dependencias

```bash
pnpm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

```
DATABASE_URL="mysql://usuario:contraseña@localhost:3306/nombre_db"
JWT_SECRET="cualquier_string_largo_y_random"
JWT_EXPIRES_IN="7d"
# A sumar cuando se integren:
# OPENAI_API_KEY="..."
# WHATSAPP_TOKEN="..."  / WHATSAPP_PHONE_ID="..." / WHATSAPP_VERIFY_TOKEN="..."
```

> La base (`nombre_db`) debe existir antes de migrar: `CREATE DATABASE nombre_db;`

### 3. Generar el cliente Prisma y migrar

```bash
npx prisma generate
npx prisma migrate dev
```

### 4. Levantar el servidor

```bash
pnpm run start:dev
```

API disponible en `http://localhost:3000`.

---

## 9. Comandos

```bash
# Desarrollo
pnpm run start:dev       # watch mode
pnpm run build           # compila a dist/
pnpm run start:prod      # corre el build

# Tests
pnpm run test            # unit (jest, rootDir: src, patrón *.spec.ts)
pnpm run test:watch
pnpm run test:cov
pnpm run test:e2e

# Calidad
pnpm run lint            # eslint --fix
pnpm run format          # prettier

# Prisma
npx prisma migrate dev --name describe-what-changed
npx prisma generate
npx prisma studio
```

> `migrate dev` corre `generate` internamente. Si solo cambiás tipos sin migración, corré `npx prisma generate` a mano.

---

## 10. Reglas del repo

El código sigue las reglas en `docs/rules/` (también referenciadas desde `CLAUDE.md`):

- `architecture.md` — estructura de módulos (controller → service → Prisma).
- `database.md` — Prisma/MySQL y exclusión de campos sensibles.
- `validation.md` — DTOs con `class-validator`.
- `error-handling.md` — excepciones de NestJS.
- `security.md` — hashing, JWT, guards, secretos.
- `naming.md` — convenciones (código y archivos en inglés).
- `commits.md` — Conventional Commits.
- `documentation.md` — documentar cada endpoint en `docs/endpoints.md`.
