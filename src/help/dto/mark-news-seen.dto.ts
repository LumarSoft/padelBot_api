import { IsString, Matches } from 'class-validator'

/** The newest "Novedades" entry the user just saw — its id in the panel's content file. */
export class MarkNewsSeenDto {
  @IsString()
  @Matches(/^[a-z0-9-]{1,64}$/, { message: 'newsId must be a lowercase slug of up to 64 characters' })
  newsId: string
}
