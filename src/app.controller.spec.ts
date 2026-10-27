import { Test, TestingModule } from '@nestjs/testing'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaService } from './prisma/prisma.service'
import type { Response } from 'express'

describe('AppController', () => {
  let appController: AppController

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: { $queryRaw: jest.fn() } }],
    }).compile()

    appController = app.get<AppController>(AppController)
  })

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!')
    })
  })

  describe('health', () => {
    it('reports ok when the DB is reachable', async () => {
      const response = { status: jest.fn() } as unknown as Response
      expect(await appController.getHealth(response)).toMatchObject({ status: 'ok', db: 'up' })
      expect(response.status).toHaveBeenCalledWith(200)
    })

    it('returns a service-unavailable status when the DB is down', async () => {
      const downModule = await Test.createTestingModule({
        controllers: [AppController],
        providers: [
          AppService,
          { provide: PrismaService, useValue: { $queryRaw: jest.fn().mockRejectedValue(new Error('db down')) } },
        ],
      }).compile()
      const controller = downModule.get<AppController>(AppController)
      const response = { status: jest.fn() } as unknown as Response

      expect(await controller.getHealth(response)).toMatchObject({ status: 'degraded', db: 'down' })
      expect(response.status).toHaveBeenCalledWith(503)
    })
  })
})
