import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

// =============================================================================
// Shared image-upload validation — one place that decides "is this a real image
// we accept" for every multipart image upload (manager photos, guide example
// images, rubric reference images).
// =============================================================================
//
// Mirrors the manager photo flow: a 15MB cap, an allow-list of mime types, and a
// sharp metadata() probe so a renamed non-image is rejected loudly rather than
// stored and later choking the scorer. NEVER logs bytes (CLAUDE.md).
// =============================================================================

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Validate an uploaded image: present, under the size cap, an allowed mime type,
 * and actually decodable by sharp. Throws BadRequestException otherwise.
 */
export async function assertReadableImage(
  file: UploadedImageFile | undefined,
): Promise<void> {
  if (!file?.buffer?.length) {
    throw new BadRequestException('no image file received');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new BadRequestException('image exceeds 15MB limit');
  }
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw new BadRequestException(
      `unsupported image type "${file.mimetype}" (allowed: jpeg, png, webp)`,
    );
  }
  try {
    await sharp(file.buffer).metadata();
  } catch {
    throw new BadRequestException('file is not a readable image');
  }
}

/** Map an accepted image mime type to the storage extension. */
export function imageExtFor(mimetype: string): string {
  switch (mimetype) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '.jpg';
  }
}
