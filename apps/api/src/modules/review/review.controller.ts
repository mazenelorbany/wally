import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import { CreateReviewSchema, type CreateReviewInput } from './review.dto';
import { ReviewService } from './review.service';

// Reviews act on verdicts. Store managers capture; reviewers and admins judge.
@Controller('verdicts')
@UseGuards(SessionGuard)
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  /**
   * Record a CONFIRM / OVERRIDE / ESCALATE on a verdict. OVERRIDE flips one
   * criterion and recomputes the fixture rollup; the others are audit-only.
   * Restricted to REVIEWER/ADMIN — a store manager doesn't grade their own work.
   */
  @Post(':id/review')
  @Roles('REVIEWER', 'ADMIN')
  review(
    @CurrentUser() user: SessionUser,
    @Param('id') verdictId: string,
    @Body(new ZodValidationPipe(CreateReviewSchema)) dto: CreateReviewInput,
  ) {
    return this.reviews.review(user.orgId, user.id, verdictId, dto);
  }
}
