import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Product } from '@prisma/client';
import type { ProductDto } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type {
  CreateProductInput,
  ProductFilterInput,
  UpdateProductInput,
} from './product.dto';

// =============================================================================
// ProductService — the merchandising catalog behind the CREATE GUIDE pillar.
// =============================================================================
//
// The catalog is the source of truth for merchandising placement and the
// sales-log unit price. Read surface: the product picker on the guide-fixture
// instruction sheet — search (name OR sku) plus brand/category/colour facets.
// Write surface (ADMIN): create / update / archive / unarchive / guarded delete.
// Always org-scoped and capped so a fat catalog can't blow up the payload.
// =============================================================================

// Keep the picker payload bounded — the UI is a searchable list, not a full dump.
// (500 comfortably fits the full ~318-SKU Cuisine::pro catalog in one page.)
const MAX_PRODUCTS = 500;

// Join the gift's qualifying product so the UI can show "Free with <name>".
const GWP_WITH_INCLUDE = {
  gwpWith: { select: { id: true, name: true, sku: true } },
} as const;

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The org's catalog, filtered. `search` matches name OR sku (insensitive);
   * brand/category/colour are insensitive contains so partial facets still hit.
   * Archived products are hidden by default (they leave the working catalog but
   * keep their merchandise/sales history) — pass `includeArchived` to see them.
   * Capped at MAX_PRODUCTS, ordered brand → name for a stable, scannable list.
   */
  async list(orgId: string, filters: ProductFilterInput = {}): Promise<ProductDto[]> {
    const { search, brand, category, color, includeArchived } = filters;
    const showArchived = includeArchived === 'true';

    const products = await this.prisma.product.findMany({
      where: {
        orgId,
        ...(showArchived ? {} : { archivedAt: null }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(brand ? { brand: { contains: brand, mode: 'insensitive' } } : {}),
        ...(category
          ? { category: { contains: category, mode: 'insensitive' } }
          : {}),
        ...(color ? { color: { contains: color, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ brand: 'asc' }, { name: 'asc' }],
      take: MAX_PRODUCTS,
      include: GWP_WITH_INCLUDE,
    });

    return products.map(toProductDto);
  }

  /**
   * Add a product to the org catalog. The (orgId, sku) pair is unique, so a
   * duplicate sku surfaces as a 409 rather than a raw Prisma error.
   */
  async create(orgId: string, input: CreateProductInput): Promise<ProductDto> {
    if (input.gwpWithId) await this.assertGwpTarget(orgId, input.gwpWithId);
    try {
      const created = await this.prisma.product.create({
        data: {
          orgId,
          sku: input.sku,
          name: input.name,
          webTitle: input.webTitle ?? null,
          brand: input.brand ?? null,
          range: input.range ?? null,
          category: input.category ?? null,
          color: input.color ?? null,
          imageUrl: input.imageUrl ?? null,
          rrp: input.rrp ?? null,
          salePrice: input.salePrice ?? null,
          saleWave: input.saleWave ?? null,
          // A gift always knows what it's free with — setting a target implies gwp.
          gwp: input.gwpWithId ? true : (input.gwp ?? false),
          gwpWithId: input.gwpWithId ?? null,
        },
        include: GWP_WITH_INCLUDE,
      });
      return toProductDto(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `a product with SKU "${input.sku}" already exists`,
        );
      }
      throw err;
    }
  }

  /**
   * Edit a product. Org-scoped; 404 if not the caller's. `sku` is editable but
   * the (orgId, sku) unique still holds, so a collision with another product
   * surfaces as a 409. Text fields accept null to clear the column.
   *
   * NOTE: editing rrp/salePrice only affects FUTURE sales — SalesEntry snapshots
   * the unit price at log time, so corrections here never rewrite logged history.
   */
  async update(
    orgId: string,
    id: string,
    input: UpdateProductInput,
  ): Promise<ProductDto> {
    const existing = await this.prisma.product.findFirst({
      where: { id, orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('product not found');

    // Only assign keys the caller sent; null clears a nullable column.
    const data: Prisma.ProductUncheckedUpdateInput = {};
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.name !== undefined) data.name = input.name;
    if (input.webTitle !== undefined) data.webTitle = input.webTitle;
    if (input.brand !== undefined) data.brand = input.brand;
    if (input.range !== undefined) data.range = input.range;
    if (input.category !== undefined) data.category = input.category;
    if (input.color !== undefined) data.color = input.color;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.rrp !== undefined) data.rrp = input.rrp;
    if (input.salePrice !== undefined) data.salePrice = input.salePrice;
    if (input.saleWave !== undefined) data.saleWave = input.saleWave;
    if (input.gwp !== undefined) data.gwp = input.gwp;
    if (input.gwpWithId !== undefined) {
      if (input.gwpWithId !== null) {
        if (input.gwpWithId === id) {
          throw new ConflictException("a product can't be its own gift target");
        }
        await this.assertGwpTarget(orgId, input.gwpWithId);
        // Setting a target implies the product is a gift.
        data.gwp = true;
      }
      data.gwpWithId = input.gwpWithId;
    }
    // A non-gift never keeps a stale qualifying-product pointer.
    if (input.gwp === false) data.gwpWithId = null;

    try {
      const updated = await this.prisma.product.update({
        where: { id: existing.id },
        data,
        include: GWP_WITH_INCLUDE,
      });
      return toProductDto(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `a product with SKU "${input.sku}" already exists`,
        );
      }
      throw err;
    }
  }

  /**
   * Soft-delete: stamp archivedAt so the product leaves the working catalog +
   * the picker, while its merchandise placements and sales history stay intact
   * (reversible via unarchive). Org-scoped; 404 if not found.
   */
  async archive(orgId: string, id: string): Promise<ProductDto> {
    const res = await this.prisma.product.updateMany({
      where: { id, orgId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('product not found');
    return this.getOne(orgId, id);
  }

  /** Restore an archived product back into the working catalog. */
  async unarchive(orgId: string, id: string): Promise<ProductDto> {
    const res = await this.prisma.product.updateMany({
      where: { id, orgId, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    if (res.count === 0) {
      throw new NotFoundException('product not found or not archived');
    }
    return this.getOne(orgId, id);
  }

  /**
   * Hard-delete: remove the product row. Org-scoped; 404 if not found.
   *
   * SAFETY: a delete cascades to Merchandise / FixtureProduct (its placement on
   * guide fixtures + library defaults) and SalesEntry (logged revenue history).
   * So if the product is merchandised anywhere or has any logged sales, we refuse
   * the hard delete (409) and steer the caller to Archive — which keeps that data
   * intact. Only a product nothing depends on can be hard-deleted.
   */
  async remove(orgId: string, id: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id, orgId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('product not found');

    const [merchandised, fixtureDefaults, sold] = await Promise.all([
      this.prisma.merchandise.count({ where: { productId: id } }),
      this.prisma.fixtureProduct.count({ where: { productId: id, orgId } }),
      this.prisma.salesEntry.count({ where: { productId: id } }),
    ]);

    if (merchandised > 0 || fixtureDefaults > 0 || sold > 0) {
      throw new ConflictException(
        'this product is in use (placed on a guide/fixture or has logged ' +
          'sales) — archive it instead to keep that history intact',
      );
    }

    await this.prisma.product.delete({ where: { id: product.id } });
  }

  /** Fetch one product as a DTO, org-scoped (404 if not the caller's). */
  private async getOne(orgId: string, id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findFirst({
      where: { id, orgId },
      include: GWP_WITH_INCLUDE,
    });
    if (!product) throw new NotFoundException('product not found');
    return toProductDto(product);
  }

  /** A gwp target must be an existing, unarchived product in the caller's org. */
  private async assertGwpTarget(orgId: string, targetId: string): Promise<void> {
    const target = await this.prisma.product.findFirst({
      where: { id: targetId, orgId, archivedAt: null },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('gift-with-purchase target product not found');
    }
  }
}

/**
 * Map a Prisma Product row to the shared ProductDto. Prisma gives nullable
 * columns as `null`; the contract uses optional (`?`) — so collapse null → undefined
 * at this boundary rather than leaking `null` into the web app's types. archivedAt
 * is the one field kept tri-state (null = active) so the UI can show archived state.
 */
export function toProductDto(
  p: Product & { gwpWith?: Pick<Product, 'id' | 'name' | 'sku'> | null },
): ProductDto {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    ...(p.webTitle != null ? { webTitle: p.webTitle } : {}),
    ...(p.brand != null ? { brand: p.brand } : {}),
    ...(p.range != null ? { range: p.range } : {}),
    ...(p.category != null ? { category: p.category } : {}),
    ...(p.color != null ? { color: p.color } : {}),
    ...(p.imageUrl != null ? { imageUrl: p.imageUrl } : {}),
    ...(p.rrp != null ? { rrp: p.rrp } : {}),
    ...(p.salePrice != null ? { salePrice: p.salePrice } : {}),
    saleWave: (p.saleWave as ProductDto['saleWave']) ?? null,
    gwp: p.gwp,
    // Only present when the caller joined the relation (catalog surfaces do;
    // merchandise rows don't need it).
    ...(p.gwpWith !== undefined
      ? {
          gwpWith: p.gwpWith
            ? { id: p.gwpWith.id, name: p.gwpWith.name, sku: p.gwpWith.sku }
            : null,
        }
      : {}),
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
  };
}
