import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import { Prisma, Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { RegisterClubDto } from './dto/register-club.dto'
import { RequestClubDto } from './dto/request-club.dto'
import { SaveSetupProgressDto } from './dto/save-setup-progress.dto'
import { notifyOps } from '../common/ops-alert'
import { formatSignupAlert } from './lib/signup-alert'
import { REQUIRED_STEP_IDS, SETUP_STEP_IDS, SetupProgress, SetupStepId, parseSetupProgress } from './lib/setup-steps'

const BCRYPT_ROUNDS = 10
/** Free-trial length for new clubs. */
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 14
const DAY_MS = 24 * 60 * 60 * 1000

/** State of one step of the guided setup. */
export interface SetupStepStatus {
  id: SetupStepId
  /** Derived from real data — true when the club actually has what this step configures. */
  done: boolean
  /** The owner moved past this step in the wizard (they may have skipped it on purpose). */
  acknowledged: boolean
  /** The bot cannot operate without this step. Skippable anyway; it just won't take bookings. */
  required: boolean
}

export interface SetupStatus {
  clubName: string
  /** Null while the setup is still pending. Finishing it is never mandatory. */
  setupCompletedAt: Date | null
  /** Where to resume the wizard. */
  currentStep: SetupStepId | null
  steps: SetupStepStatus[]
  /** What's already loaded, so each step shows it instead of starting from a blank slate. */
  counts: {
    courts: number
    recurringBookings: number
    staff: number
    products: number
    whatsappLines: number
  }
  /** True once every REQUIRED step is done: the bot can take a booking end to end. */
  ready: boolean
}

/** Everything getStatus needs from the club row, in one round trip. */
const setupClubSelect = {
  name: true,
  locationInfo: true,
  transferAlias: true,
  mpConnectedAt: true,
  setupCompletedAt: true,
  setupProgress: true,
} as const

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lead capture for the MANAGED signup: stores the prospect's answers from the
   * step-by-step `/register` flow and pings ops so we contact them, configure
   * MercadoPago/WhatsApp and provision the club ourselves. Idempotent enough for a public
   * form — repeats just create another NEW row.
   */
  async requestSignup(dto: RequestClubDto): Promise<{ received: boolean }> {
    const lead = await this.prisma.clubSignupRequest.create({
      data: {
        clubName: dto.clubName.trim(),
        ownerName: dto.ownerName.trim(),
        email: dto.email.toLowerCase().trim(),
        phone: dto.phone.trim(),
        message: dto.message?.trim() || null,
        city: dto.city?.trim() || null,
        courtCount: dto.courtCount ?? null,
        courtType: dto.courtType ?? null,
        slotDurationMinutes: dto.slotDurationMinutes ?? null,
        openTime: dto.openTime ?? null,
        closeTime: dto.closeTime ?? null,
        avgPriceCents: dto.avgPriceCents ?? null,
        chargesDeposit: dto.chargesDeposit ?? null,
        hasMercadoPago: dto.hasMercadoPago ?? null,
        currentSystem: dto.currentSystem ?? null,
        biggestPain: dto.biggestPain ?? null,
        fixedSlots: dto.fixedSlots ?? null,
        howFound: dto.howFound ?? null,
        contactWindow: dto.contactWindow ?? null,
        contactWindowNote: dto.contactWindowNote?.trim() || null,
      },
    })
    await notifyOps(formatSignupAlert(lead))
    return { received: true }
  }

  /**
   * Ops provisioning: creates the Club (on a trial) + its OWNER user, and nothing else.
   * The club starts EMPTY on purpose — courts, prices, payments and the WhatsApp line get
   * loaded for real in the `/setup` wizard, sitting with the owner. Seeding fake courts and
   * example bookings here would only leave them demo rows to hunt down and delete.
   */
  async register(dto: RegisterClubDto): Promise<{ email: string; clubId: string }> {
    const email = dto.email.toLowerCase().trim()
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
    let clubId = ''

    try {
      await this.prisma.$transaction(async tx => {
        const club = await tx.club.create({
          data: {
            name: dto.clubName.trim(),
            slug: await this.availableSlug(dto.clubName),
            trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS),
          },
          select: { id: true },
        })
        clubId = club.id

        await tx.user.create({
          data: {
            clubId: club.id,
            email,
            name: dto.ownerName.trim(),
            password: passwordHash,
            role: Role.OWNER,
            // The password here is set by whoever provisions the club (ops), not chosen by
            // the owner — so force a change on first login, same as a STAFF temp password.
            mustChangePassword: true,
          },
        })
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe una cuenta con ese email')
      }
      throw error
    }

    this.logger.log(`New club provisioned: ${dto.clubName} (${email}) — setup pending`)
    return { email, clubId }
  }

  /**
   * Aggregated state of the guided setup, in one request instead of the five the panel used
   * to fire. Each step's `done` comes from the club's REAL data, so a club set up by hand (or
   * before the wizard existed) reads as done without ever having opened it.
   */
  async getStatus(clubId: string): Promise<SetupStatus> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: setupClubSelect })
    if (!club) throw new NotFoundException(`Club ${clubId} not found`)

    const [courts, recurringBookings, staff, products, whatsappLines] = await Promise.all([
      this.prisma.court.count({ where: { clubId } }),
      this.prisma.recurringBooking.count({ where: { clubId, isActive: true } }),
      // The OWNER themself doesn't count — this step is about inviting the rest of the team.
      this.prisma.user.count({ where: { clubId, role: Role.STAFF, isActive: true } }),
      this.prisma.product.count({ where: { clubId, isActive: true } }),
      this.prisma.whatsAppLine.count({ where: { clubId, isActive: true } }),
    ])

    const progress = parseSetupProgress(club.setupProgress)
    // A club can take deposits once it can tell players WHERE to transfer: either its own
    // MercadoPago account is connected (auto-reconciled) or an alias is loaded (manual).
    const canTakePayments = Boolean(club.mpConnectedAt) || Boolean(club.transferAlias)

    const doneByStep: Record<SetupStepId, boolean> = {
      complejo: Boolean(club.locationInfo),
      canchas: courts > 0,
      pagos: canTakePayments,
      whatsapp: whatsappLines > 0,
      fijos: recurringBookings > 0,
      equipo: staff > 0,
      kiosco: products > 0,
    }

    const steps: SetupStepStatus[] = SETUP_STEP_IDS.map(id => ({
      id,
      done: doneByStep[id],
      acknowledged: progress.doneSteps.includes(id),
      required: REQUIRED_STEP_IDS.includes(id),
    }))

    return {
      clubName: club.name,
      setupCompletedAt: club.setupCompletedAt,
      currentStep: progress.currentStep,
      steps,
      counts: { courts, recurringBookings, staff, products, whatsappLines },
      ready: REQUIRED_STEP_IDS.every(id => doneByStep[id]),
    }
  }

  /** Persists the wizard's position so an interrupted setup resumes where it left off. */
  async saveProgress(clubId: string, dto: SaveSetupProgressDto): Promise<SetupProgress> {
    const progress: SetupProgress = {
      currentStep: dto.currentStep ?? null,
      doneSteps: [...new Set(dto.doneSteps ?? [])],
    }
    await this.prisma.club.update({
      where: { id: clubId },
      // SetupProgress is a closed interface; Prisma's Json input wants an index signature.
      data: { setupProgress: { ...progress } as Prisma.InputJsonObject },
    })
    return progress
  }

  /**
   * Marks the setup as finished. Deliberately does NOT require every step to be done: the
   * owner may finish with steps skipped (e.g. MercadoPago pending because they didn't have
   * the credentials at hand) and complete them later from Configuración.
   */
  async complete(clubId: string): Promise<{ setupCompletedAt: Date }> {
    const club = await this.prisma.club.update({
      where: { id: clubId },
      data: { setupCompletedAt: new Date() },
      select: { name: true, setupCompletedAt: true },
    })
    this.logger.log(`Club setup completed: ${club.name}`)
    return { setupCompletedAt: club.setupCompletedAt! }
  }

  /** Slugifies the club name; a short random suffix dodges collisions. */
  private async availableSlug(clubName: string): Promise<string> {
    const base =
      clubName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'club'

    const existing = await this.prisma.club.findUnique({ where: { slug: base }, select: { id: true } })
    if (!existing) return base
    return `${base}-${randomBytes(3).toString('hex')}`
  }
}
