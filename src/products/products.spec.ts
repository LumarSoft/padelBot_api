import 'reflect-metadata'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { Prisma } from 'generated/prisma/client'
import { ProductsService } from './products.service'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { FindByBarcodeDto } from './dto/find-by-barcode.dto'
import { normalizeBarcode } from './lib/barcode'

/**
 * Barcodes for the kiosk's point of sale: a scan has to resolve to exactly one product of the
 * caller's club, so a code is unique per club (never across clubs), trimmed, and a clash says
 * which product already has it.
 */

interface FakeProduct {
  id: string
  clubId: string
  name: string
  priceCents: number
  category: string
  isActive: boolean
  barcode: string | null
  stockQuantity: number | null
  lowStockThreshold: number | null
}

interface Where {
  id?: string | { not: string }
  clubId?: string
  barcode?: string
}

const CLUB = 'club-1'
const OTHER_CLUB = 'club-2'

function pick<T extends object>(row: T, select?: Record<string, unknown>): Partial<T> {
  if (!select) return row
  return Object.fromEntries(Object.keys(select).map(key => [key, row[key as keyof T]])) as Partial<T>
}

function matches(p: FakeProduct, where: Where): boolean {
  if (where.clubId !== undefined && p.clubId !== where.clubId) return false
  if (where.barcode !== undefined && p.barcode !== where.barcode) return false
  if (typeof where.id === 'string' && p.id !== where.id) return false
  if (typeof where.id === 'object' && p.id === where.id.not) return false
  return true
}

/** What MySQL's unique (clubId, barcode) index answers on a clash. */
function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

function fakeDb(initial: FakeProduct[]) {
  const products = new Map(initial.map(p => [p.id, { ...p }]))
  let nextId = 1
  const assertUnique = (clubId: string, barcode: string | null | undefined, exceptId?: string) => {
    if (!barcode) return
    const clash = [...products.values()].some(p => p.clubId === clubId && p.barcode === barcode && p.id !== exceptId)
    if (clash) throw uniqueViolation()
  }

  const client = {
    product: {
      findFirst: jest.fn(async ({ where, select }: { where: Where; select?: Record<string, unknown> }) => {
        const found = [...products.values()].find(p => matches(p, where))
        return found ? pick(found, select) : null
      }),
      create: jest.fn(async ({ data, select }: { data: Partial<FakeProduct>; select?: Record<string, unknown> }) => {
        assertUnique(data.clubId!, data.barcode)
        const row: FakeProduct = {
          id: `p${nextId++}`,
          clubId: data.clubId!,
          name: data.name!,
          priceCents: data.priceCents!,
          category: data.category ?? 'OTRO',
          isActive: data.isActive ?? true,
          barcode: data.barcode ?? null,
          stockQuantity: null,
          lowStockThreshold: data.lowStockThreshold ?? null,
        }
        products.set(row.id, row)
        return pick(row, select)
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeProduct> }) => {
        const row = products.get(where.id)!
        if (data.barcode !== undefined) assertUnique(row.clubId, data.barcode, row.id)
        Object.assign(row, data)
        return row
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  }

  return { client, products }
}

function product(id: string, overrides: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id,
    clubId: CLUB,
    name: id,
    priceCents: 200_000,
    category: 'BEBIDA',
    isActive: true,
    barcode: null,
    stockQuantity: null,
    lowStockThreshold: null,
    ...overrides,
  }
}

function setup(products: FakeProduct[]) {
  const db = fakeDb(products)
  const stock = {
    assertCanStartTracking: jest.fn().mockResolvedValue(undefined),
    setQuantity: jest.fn().mockResolvedValue(undefined),
    refreshLowStockFlag: jest.fn().mockResolvedValue(undefined),
  }
  const service = new ProductsService(db.client as never, stock as never)
  return { db, service }
}

async function errorsOf<T extends object>(cls: new () => T, plain: object) {
  const dto = plainToInstance(cls, plain)
  return { dto, errors: await validate(dto) }
}

describe('normalizeBarcode', () => {
  it('trims what the scanner sent and treats blank as no code', () => {
    expect(normalizeBarcode('  7790895000782\n')).toBe('7790895000782')
    expect(normalizeBarcode('   ')).toBeNull()
    expect(normalizeBarcode('')).toBeNull()
  })

  it('passes anything that is not a string through, for the validators to reject', () => {
    expect(normalizeBarcode(7790895000782)).toBe(7790895000782)
    expect(normalizeBarcode(undefined)).toBeUndefined()
    expect(normalizeBarcode(null)).toBeNull()
  })
})

describe('barcode validation in the DTOs', () => {
  it('accepts an EAN with stray whitespace and stores it trimmed', async () => {
    const { dto, errors } = await errorsOf(CreateProductDto, {
      name: 'Agua',
      priceCents: 1000,
      barcode: ' 7790895000782 ',
    })
    expect(errors).toEqual([])
    expect(dto.barcode).toBe('7790895000782')
  })

  it('accepts a code of the club’s own with letters and symbols', async () => {
    const { errors } = await errorsOf(CreateProductDto, { name: 'Grip', priceCents: 1000, barcode: 'GTP-GRIP-01' })
    expect(errors).toEqual([])
  })

  it('rejects spaces inside the code and codes longer than 64 characters', async () => {
    const spaced = await errorsOf(CreateProductDto, { name: 'Agua', priceCents: 1000, barcode: '779 089' })
    const long = await errorsOf(CreateProductDto, { name: 'Agua', priceCents: 1000, barcode: '1'.repeat(65) })
    expect(spaced.errors.map(e => e.property)).toEqual(['barcode'])
    expect(long.errors.map(e => e.property)).toEqual(['barcode'])
  })

  it('lets an update clear the code with null or a blank string', async () => {
    for (const barcode of [null, '  ']) {
      const { dto, errors } = await errorsOf(UpdateProductDto, { barcode })
      expect(errors).toEqual([])
      expect(dto.barcode).toBeNull()
    }
  })

  it('requires a code to look one up', async () => {
    expect((await errorsOf(FindByBarcodeDto, {})).errors.map(e => e.property)).toEqual(['code'])
    expect((await errorsOf(FindByBarcodeDto, { code: '  ' })).errors.map(e => e.property)).toEqual(['code'])
    expect((await errorsOf(FindByBarcodeDto, { code: '7790895000782' })).errors).toEqual([])
  })
})

describe('ProductsService barcodes', () => {
  it('creates a product with its code and returns it', async () => {
    const { service } = setup([])

    const created = await service.create(CLUB, { name: 'Agua 500 ml', priceCents: 150_000, barcode: '7790895000782' })

    expect(created).toEqual(expect.objectContaining({ name: 'Agua 500 ml', barcode: '7790895000782' }))
  })

  it('refuses a code another product of the club already has, naming it, and creates nothing', async () => {
    const { db, service } = setup([product('agua', { name: 'Agua 500 ml', barcode: '7790895000782' })])

    await expect(
      service.create(CLUB, { name: 'Agua con gas', priceCents: 150_000, barcode: '7790895000782' }),
    ).rejects.toThrow(new ConflictException('El código 7790895000782 ya es de «Agua 500 ml»'))
    expect(db.products.size).toBe(1)
  })

  it('lets two clubs use the same code: a bottle has the same EAN everywhere', async () => {
    const { service } = setup([product('agua', { clubId: OTHER_CLUB, barcode: '7790895000782' })])

    const created = await service.create(CLUB, { name: 'Agua', priceCents: 150_000, barcode: '7790895000782' })

    expect(created.barcode).toBe('7790895000782')
  })

  it('answers the same conflict when a concurrent save got the code first (unique index)', async () => {
    const { db, service } = setup([product('agua', { name: 'Agua 500 ml', barcode: '7790895000782' })])
    // The pre-check runs before the other save lands; the unique index is what stops this one.
    db.client.product.findFirst.mockResolvedValueOnce(null)

    await expect(
      service.create(CLUB, { name: 'Agua con gas', priceCents: 150_000, barcode: '7790895000782' }),
    ).rejects.toThrow(new ConflictException('El código 7790895000782 ya es de «Agua 500 ml»'))
  })

  it('assigns a code to an existing product (the first scan of a bottle loaded without one)', async () => {
    const { db, service } = setup([product('agua')])

    const updated = await service.update(CLUB, 'agua', { barcode: '7790895000782' })

    expect(updated.barcode).toBe('7790895000782')
    expect(db.products.get('agua')!.barcode).toBe('7790895000782')
  })

  it('re-saving a product with its own code is not a conflict', async () => {
    const { service } = setup([product('agua', { barcode: '7790895000782' })])

    await expect(service.update(CLUB, 'agua', { name: 'Agua mineral', barcode: '7790895000782' })).resolves.toEqual(
      expect.objectContaining({ name: 'Agua mineral', barcode: '7790895000782' }),
    )
  })

  it('refuses moving a code that belongs to another product', async () => {
    const { db, service } = setup([
      product('agua', { name: 'Agua 500 ml', barcode: '7790895000782' }),
      product('coca', { name: 'Coca 500 ml' }),
    ])

    await expect(service.update(CLUB, 'coca', { barcode: '7790895000782' })).rejects.toThrow(
      new ConflictException('El código 7790895000782 ya es de «Agua 500 ml»'),
    )
    expect(db.products.get('coca')!.barcode).toBeNull()
  })

  it('clears a code with null and leaves it alone when the update does not mention it', async () => {
    const { db, service } = setup([product('agua', { barcode: '7790895000782' }), product('coca', { barcode: '123' })])

    await service.update(CLUB, 'agua', { barcode: null })
    await service.update(CLUB, 'coca', { priceCents: 180_000 })

    expect(db.products.get('agua')!.barcode).toBeNull()
    expect(db.products.get('coca')!.barcode).toBe('123')
  })
})

describe('ProductsService.findByBarcode', () => {
  it('finds the product a scan belongs to, inactive ones included', async () => {
    const { service } = setup([product('agua', { barcode: '7790895000782', isActive: false })])

    await expect(service.findByBarcode(CLUB, ' 7790895000782 ')).resolves.toEqual(
      expect.objectContaining({ id: 'agua', barcode: '7790895000782', isActive: false }),
    )
  })

  it('answers 404 for a code nobody has, so the point of sale offers to create it', async () => {
    const { service } = setup([product('agua', { barcode: '7790895000782' })])

    await expect(service.findByBarcode(CLUB, '0000000000000')).rejects.toThrow(NotFoundException)
  })

  it('never resolves a code to another club’s product', async () => {
    const { service } = setup([product('agua', { clubId: OTHER_CLUB, barcode: '7790895000782' })])

    await expect(service.findByBarcode(CLUB, '7790895000782')).rejects.toThrow(NotFoundException)
  })
})
