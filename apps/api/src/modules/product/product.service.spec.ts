import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProductService } from './product.service';

// =============================================================================
// ProductService contract — the two safety-critical rules for catalog CRUD:
//   1. CREATE on a duplicate (orgId, sku) maps Prisma's P2002 to a 409, so the
//      unique key surfaces as a clean conflict, not a raw 500.
//   2. DELETE of an in-use product (merchandised on a guide/fixture, or with
//      logged SalesEntry rows) is refused with a 409 that steers to Archive —
//      a hard delete would cascade away merchandise placements + sales history.
// Prisma is mocked at the method boundary (mirrors review.contract.spec.ts).
// =============================================================================

const ORG = 'org_1';
const PRODUCT_ID = 'prod_1';

function makePrisma() {
  return {
    product: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    merchandise: { count: vi.fn(async () => 0) },
    fixtureProduct: { count: vi.fn(async () => 0) },
    salesEntry: { count: vi.fn(async () => 0) },
  };
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'x',
  });
}

describe('ProductService catalog CRUD contract', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ProductService;

  beforeEach(() => {
    prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ProductService(prisma as any);
  });

  it('CREATE on a duplicate sku maps P2002 to a 409 ConflictException', async () => {
    prisma.product.create.mockRejectedValueOnce(p2002());
    await expect(
      service.create(ORG, { sku: 'DUP-1', name: 'A mug' }),
    ).rejects.toThrow(ConflictException);
  });

  it('CREATE returns the new product DTO on success', async () => {
    prisma.product.create.mockResolvedValueOnce({
      id: PRODUCT_ID,
      orgId: ORG,
      sku: 'NEW-1',
      name: 'A mug',
      webTitle: null,
      brand: null,
      range: null,
      category: null,
      color: null,
      imageUrl: null,
      rrp: null,
      salePrice: null,
      createdAt: new Date(),
      archivedAt: null,
    });
    const dto = await service.create(ORG, { sku: 'NEW-1', name: 'A mug' });
    expect(dto).toMatchObject({ id: PRODUCT_ID, sku: 'NEW-1', archivedAt: null });
  });

  it('DELETE refuses (409) a product that is merchandised on a guide/fixture', async () => {
    prisma.product.findFirst.mockResolvedValueOnce({ id: PRODUCT_ID });
    prisma.merchandise.count.mockResolvedValueOnce(2); // placed on a guide fixture
    await expect(service.remove(ORG, PRODUCT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it('DELETE refuses (409) a product that has logged SalesEntry rows', async () => {
    prisma.product.findFirst.mockResolvedValueOnce({ id: PRODUCT_ID });
    prisma.salesEntry.count.mockResolvedValueOnce(5); // sold history exists
    await expect(service.remove(ORG, PRODUCT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.product.delete).not.toHaveBeenCalled();
  });

  it('DELETE hard-deletes a product nothing depends on', async () => {
    prisma.product.findFirst.mockResolvedValueOnce({ id: PRODUCT_ID });
    // all counts default to 0
    prisma.product.delete.mockResolvedValueOnce({ id: PRODUCT_ID });
    await service.remove(ORG, PRODUCT_ID);
    expect(prisma.product.delete).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID },
    });
  });

  it('DELETE 404s when the product is not in the caller org', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(null);
    await expect(service.remove(ORG, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('ARCHIVE 404s when nothing was updated (wrong org / already archived)', async () => {
    prisma.product.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.archive(ORG, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('UPDATE maps a sku collision (P2002) to a 409', async () => {
    prisma.product.findFirst.mockResolvedValueOnce({ id: PRODUCT_ID });
    prisma.product.update.mockRejectedValueOnce(p2002());
    await expect(
      service.update(ORG, PRODUCT_ID, { sku: 'TAKEN' }),
    ).rejects.toThrow(ConflictException);
  });
});
