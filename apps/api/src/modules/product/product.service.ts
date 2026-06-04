import { Injectable } from '@nestjs/common';
import type { Product } from '@prisma/client';
import type { ProductDto } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type { ProductFilterInput } from './product.dto';

// =============================================================================
// ProductService — the merchandising catalog behind the CREATE GUIDE pillar.
// =============================================================================
//
// Read surface for the product picker on the guide-fixture instruction sheet:
// search (name OR sku) plus the brand/category/colour facets. Always org-scoped
// and capped so a fat catalog can't blow up the picker's payload.
// =============================================================================

// Keep the picker payload bounded — the UI is a searchable list, not a full dump.
const MAX_PRODUCTS = 200;

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The org's catalog, filtered. `search` matches name OR sku (insensitive);
   * brand/category/colour are insensitive contains so partial facets still hit.
   * Capped at MAX_PRODUCTS, ordered brand → name for a stable, scannable list.
   */
  async list(orgId: string, filters: ProductFilterInput = {}): Promise<ProductDto[]> {
    const { search, brand, category, color } = filters;

    const products = await this.prisma.product.findMany({
      where: {
        orgId,
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
    });

    return products.map(toProductDto);
  }
}

/**
 * Map a Prisma Product row to the shared ProductDto. Prisma gives nullable
 * columns as `null`; the contract uses optional (`?`) — so collapse null → undefined
 * at this boundary rather than leaking `null` into the web app's types.
 */
export function toProductDto(p: Product): ProductDto {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    ...(p.brand != null ? { brand: p.brand } : {}),
    ...(p.category != null ? { category: p.category } : {}),
    ...(p.color != null ? { color: p.color } : {}),
    ...(p.imageUrl != null ? { imageUrl: p.imageUrl } : {}),
  };
}
