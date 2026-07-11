import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

/** Guards every cross-tenant ops route. See OpsJwtStrategy for why it's a separate strategy. */
@Injectable()
export class OpsAuthGuard extends AuthGuard('ops-jwt') {}
