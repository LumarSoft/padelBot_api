import { ConflictException, Injectable, Logger } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import { Role, SlotStatus } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { isUniqueConstraintError } from '../prisma/prisma-errors'
import { shiftDateKey, todayKey } from '../availability/lib/datetime'
import { bandDateTimes, bandsForDate } from '../availability/lib/schedule'
import { RegisterClubDto } from './dto/register-club.dto'
import { RequestClubDto } from './dto/request-club.dto'
import { notifyOps } from '../common/ops-alert'

const BCRYPT_ROUNDS = 10
/** Free-trial length for self-service signups. */
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 14
const DAY_MS = 24 * 60 * 60 * 1000

/** Note demo bookings carry so the owner knows they are safe to cancel. */
const DEMO_NOTE = 'Reserva de ejemplo creada por PadelBot — cancelala cuando quieras.'

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lead capture for the MANAGED signup: stores the prospect and pings ops so we
   * contact them, configure MercadoPago/WhatsApp and provision the club ourselves.
   * Idempotent enough for a public form — repeats just create another NEW row.
   */
  async requestSignup(dto: RequestClubDto): Promise<{ received: boolean }> {
    await this.prisma.clubSignupRequest.create({
      data: {
        clubName: dto.clubName.trim(),
        ownerName: dto.ownerName.trim(),
        email: dto.email.toLowerCase().trim(),
        phone: dto.phone.trim(),
        message: dto.message?.trim() || null,
      },
    })
    await notifyOps(
      `🏓 Nueva solicitud de club: *${dto.clubName.trim()}* — ${dto.ownerName.trim()} ` +
        `(${dto.email.trim()}, ${dto.phone.trim()})${dto.message ? ` — "${dto.message.trim()}"` : ''}`,
    )
    return { received: true }
  }

  /**
   * Self-service signup: creates the Club (on a 14-day trial) + its OWNER user +
   * demo data (two padel courts and a couple of example bookings) in one
   * transaction, so the panel never greets a new owner with an empty, dead
   * dashboard. Everything demo is plainly labeled and deletable.
   */
  async register(dto: RegisterClubDto): Promise<{ email: string }> {
    const email = dto.email.toLowerCase().trim()
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)

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

        await tx.user.create({
          data: {
            clubId: club.id,
            email,
            name: dto.ownerName.trim(),
            password: passwordHash,
            role: Role.OWNER,
          },
        })

        const courtOne = await tx.court.create({
          data: { clubId: club.id, name: 'Cancha 1', priceCents: 2000000, courtType: 'INDOOR' },
          select: { id: true, openTime: true, closeTime: true, slotDurationMinutes: true, weeklyHours: true },
        })
        await tx.court.create({
          data: { clubId: club.id, name: 'Cancha 2', priceCents: 1800000, courtType: 'OUTDOOR' },
        })

        // Two example bookings tomorrow evening so the agenda shows life on day one.
        const tomorrow = shiftDateKey(todayKey(), 1)
        const eveningBands = bandsForDate(courtOne, tomorrow)
          .filter(b => b.start >= '18:00' && b.startOffset === 0)
          .slice(0, 2)
        for (const band of eveningBands) {
          const { startsAt, endsAt } = bandDateTimes(tomorrow, band)
          const slot = await tx.slot.create({
            data: {
              clubId: club.id,
              courtId: courtOne.id,
              startsAt,
              endsAt,
              priceCents: 2000000,
              status: SlotStatus.BOOKED,
            },
            select: { id: true },
          })
          await tx.booking.create({
            data: {
              clubId: club.id,
              slotId: slot.id,
              playerName: 'Jugador de ejemplo',
              status: 'CONFIRMED',
              notes: DEMO_NOTE,
            },
          })
        }
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe una cuenta con ese email')
      }
      throw error
    }

    this.logger.log(`New self-service club registered: ${dto.clubName} (${email})`)
    return { email }
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
