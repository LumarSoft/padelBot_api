import { IsIn, IsOptional } from 'class-validator'
import { MercadoPagoConnectOrigin } from '../clubs.service'

export class ConnectMercadoPagoDto {
  /**
   * Screen the owner started the connect flow from, so the OAuth callback returns them
   * there. A closed set, not a URL — the callback is public and echoing a caller-supplied
   * destination into a redirect would be an open redirect. Defaults to Configuración.
   */
  @IsOptional()
  @IsIn(['configuracion', 'setup'])
  origin?: MercadoPagoConnectOrigin
}
