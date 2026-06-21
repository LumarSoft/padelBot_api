import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  // rawBody: true exposes req.rawBody (Buffer) needed for Meta webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  // The admin panel calls this API server-to-server (BFF), but CORS is enabled
  // for any future direct browser calls from the panel origin.
  app.enableCors({
    origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  })
  await app.listen(process.env.PORT ?? 3001)
}
void bootstrap()
