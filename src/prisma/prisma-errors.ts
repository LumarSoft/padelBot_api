import { Prisma } from 'generated/prisma/client'

/**
 * True when the error is a Prisma unique-constraint violation (P2002).
 * Used to translate concurrent-insert races into a clean ConflictException
 * instead of leaking a raw 500.
 */
export function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
