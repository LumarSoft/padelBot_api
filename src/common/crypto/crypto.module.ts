import { Global, Module } from '@nestjs/common'
import { CryptoService } from './crypto.service'

/**
 * Global so any feature that needs to encrypt/decrypt secrets at rest can inject
 * CryptoService without re-importing the module everywhere.
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
