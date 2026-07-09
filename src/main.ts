import 'dotenv/config'
import { networkInterfaces } from 'os'
import { NestFactory } from '@nestjs/core'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'

function localNetworkIp(): string | null {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return null
}

async function bootstrap() {
  // rawBody: true exposes req.rawBody (Buffer) needed for Meta webhook signature verification
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })
  // Behind a reverse proxy (Railway/Render/Nginx) so the rate limiter and logs see the
  // real client IP from X-Forwarded-For instead of the proxy's.
  app.set('trust proxy', 1)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  // Normalize all errors so internal details / stack traces never reach the client.
  app.useGlobalFilters(new AllExceptionsFilter())
  // The admin panel calls this API server-to-server (BFF), but CORS is enabled
  // for any future direct browser calls from the panel origin.
  app.enableCors({
    origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  })
  const port = process.env.PORT ?? 3001
  await app.listen(port)
  const networkIp = localNetworkIp()
  Logger.log(`API running on http://localhost:${port}`, 'Bootstrap')
  if (networkIp) Logger.log(`Network (mobile .env): http://${networkIp}:${port}`, 'Bootstrap')
}
void bootstrap()
