import { Global, Module } from '@nestjs/common'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'
import { AuditQueryService } from './audit-query.service'
import { AuditReportsService } from './audit-reports.service'

/**
 * Global on purpose: almost every module that writes something needs to record it, and
 * importing AuditModule in each of them would add noise without adding clarity.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService, AuditReportsService],
  exports: [AuditService],
})
export class AuditModule {}
