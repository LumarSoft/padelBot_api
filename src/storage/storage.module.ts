import { Global, Module } from '@nestjs/common'
import { ReceiptStorageService } from './receipt-storage.service'

/**
 * Global so any feature that needs to persist/serve receipt images can inject
 * ReceiptStorageService without re-importing the module everywhere.
 */
@Global()
@Module({
  providers: [ReceiptStorageService],
  exports: [ReceiptStorageService],
})
export class StorageModule {}
