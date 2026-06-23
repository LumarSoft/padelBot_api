import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { Response } from 'express'

/**
 * Global error normalizer. Known NestJS HttpExceptions pass through with their status
 * and message; anything unexpected becomes a generic 500 so we never leak stack traces
 * or internal details to the client (per docs/rules/error-handling.md). The real error
 * is logged server-side for debugging.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception')

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      // 5xx HttpExceptions are still worth logging; 4xx are expected client errors.
      if (status >= 500) this.logger.error(exception.message, exception.stack)
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body)
      return
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
      exception instanceof Error ? exception.stack : undefined,
    )
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
    })
  }
}
