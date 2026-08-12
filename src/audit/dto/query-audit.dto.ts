import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

const ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'STATUS_CHANGE',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'PERMISSION_CHANGED',
] as const

export class QueryAuditDto {
  /** "Booking" | "User" | "PermissionGroup" | "Session" */
  @IsOptional()
  @IsString()
  entity?: string

  @IsOptional()
  @IsString()
  entityId?: string

  @IsOptional()
  @IsIn(ACTIONS as unknown as string[])
  action?: (typeof ACTIONS)[number]

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  userId?: number

  /** Inclusive, "YYYY-MM-DD". */
  @IsOptional()
  @IsString()
  from?: string

  /** Inclusive, "YYYY-MM-DD". */
  @IsOptional()
  @IsString()
  to?: string

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}
