// Shared zod validation pipe for the resource modules (org/store/campaign/
// rubric/submission/review/report). Lives in the org module because that's the
// first resource module to load; siblings import it directly.
//
// Usage:
//   @Body(new ZodValidationPipe(CreateStoreSchema)) dto: CreateStoreInput
//
// On a parse failure it throws a 400 with a flat list of issues — never leaks a
// stack trace, never lets an unvalidated payload reach a service.
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodSchema, ZodError } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: flatten(result.error),
      });
    }
    return result.data;
  }
}

function flatten(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
