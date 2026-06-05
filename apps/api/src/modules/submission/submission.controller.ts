import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';
import { StorageService } from '../storage/storage.service';

import {
  CreateSubmissionSchema,
  type CreateSubmissionInput,
  SetBestInClassSchema,
  type SetBestInClassInput,
  UploadPhotoSchema,
} from './submission.dto';
import { SubmissionService } from './submission.service';

// In-memory upload — the buffer goes straight to StorageService.put(), never to
// a temp file on disk (no stray bytes left around). 15MB cap mirrors the
// service-side check so multer rejects oversized files before buffering fully.
const PHOTO_UPLOAD = { limits: { fileSize: 15 * 1024 * 1024, files: 1 } };

interface UploadedPhotoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Controller('submissions')
@UseGuards(SessionGuard)
export class SubmissionController {
  constructor(private readonly submissions: SubmissionService) {}

  /** Open (or resume) a store's submission for a campaign. Idempotent. */
  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateSubmissionSchema)) dto: CreateSubmissionInput,
  ) {
    return this.submissions.create(user.orgId, dto);
  }

  /**
   * Upload one fixture photo (multipart/form-data: `photo` file + `fixtureKey`
   * text field). Persists the bytes, creates a Photo and a PENDING ScoreJob,
   * and returns the Photo with a signed URL.
   */
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('photo', PHOTO_UPLOAD))
  async addPhoto(
    @CurrentUser() user: SessionUser,
    @Param('id') submissionId: string,
    @UploadedFile() file: UploadedPhotoFile | undefined,
    @Body(new ZodValidationPipe(UploadPhotoSchema)) body: { fixtureKey: string },
  ) {
    return this.submissions.addPhoto(
      user.orgId,
      submissionId,
      body.fixtureKey,
      {
        buffer: file?.buffer as Buffer,
        mimetype: file?.mimetype ?? '',
        size: file?.size ?? 0,
      },
    );
  }

  /**
   * The signed-in store manager's current checklist: resolves their store + the
   * active campaign, opens (or resumes) the submission, and returns its id — so
   * /capture lands straight on the checklist with no ID to paste.
   * Declared before `:id` so "current" isn't swallowed by the param route.
   */
  @Get('current')
  current(@CurrentUser() user: SessionUser) {
    return this.submissions.currentForManager(user);
  }

  /** A submission with its photos + verdicts. */
  @Get(':id')
  getOne(@CurrentUser() user: SessionUser, @Param('id') submissionId: string) {
    return this.submissions.getOne(user.orgId, submissionId);
  }
}

// The reviewer queue for one campaign. Separate controller so the route group
// `campaigns/:id/queue` reads naturally without colliding with CampaignController.
@Controller('campaigns')
@UseGuards(SessionGuard)
export class CampaignQueueController {
  constructor(private readonly submissions: SubmissionService) {}

  @Get(':id/queue')
  queue(@CurrentUser() user: SessionUser, @Param('id') campaignId: string) {
    return this.submissions.campaignQueue(user.orgId, campaignId);
  }

  /** Every execution image across the campaign's stores (the gallery). */
  @Get(':id/gallery')
  gallery(@CurrentUser() user: SessionUser, @Param('id') campaignId: string) {
    return this.submissions.gallery(user.orgId, campaignId);
  }

  /** Operational turnaround: review speed + which stores needed most rework. */
  @Get(':id/turnaround')
  turnaround(@CurrentUser() user: SessionUser, @Param('id') campaignId: string) {
    return this.submissions.campaignTurnaround(user.orgId, campaignId);
  }

  /** Compliance snapshots over time (the trend chart). */
  @Get(':id/trend')
  trend(@CurrentUser() user: SessionUser, @Param('id') campaignId: string) {
    return this.submissions.campaignTrend(user.orgId, campaignId);
  }

  /** Capture today's compliance as a snapshot now (idempotent per day). */
  @Post(':id/snapshot')
  @Roles('ADMIN')
  snapshot(@CurrentUser() user: SessionUser, @Param('id') campaignId: string) {
    return this.submissions.captureSnapshot(user.orgId, campaignId);
  }

  /** Best-in-class execution photos — exemplars to show other stores. */
  @Get(':id/best-in-class')
  bestInClass(
    @CurrentUser() user: SessionUser,
    @Param('id') campaignId: string,
  ) {
    return this.submissions.bestInClass(user.orgId, campaignId);
  }
}

// Photo-addressed mutations (best-in-class toggle). Reviewers curate exemplars.
@Controller('photos')
@UseGuards(SessionGuard)
export class PhotoController {
  constructor(private readonly submissions: SubmissionService) {}

  @Patch(':id/best-in-class')
  @Roles('ADMIN', 'REVIEWER')
  setBestInClass(
    @CurrentUser() user: SessionUser,
    @Param('id') photoId: string,
    @Body(new ZodValidationPipe(SetBestInClassSchema)) dto: SetBestInClassInput,
  ) {
    return this.submissions.setBestInClass(user.orgId, photoId, dto.value);
  }
}

// One store's rolled-up score for a campaign (?campaignId=...).
@Controller('stores')
@UseGuards(SessionGuard)
export class StoreScoreController {
  constructor(private readonly submissions: SubmissionService) {}

  @Get(':id/store-score')
  storeScore(
    @CurrentUser() user: SessionUser,
    @Param('id') storeId: string,
    @Query('campaignId') campaignId: string,
  ) {
    if (!campaignId) {
      // store-score is always relative to a campaign — be explicit, don't guess.
      throw new NotFoundException('campaignId query param is required');
    }
    return this.submissions.storeScore(user.orgId, storeId, campaignId);
  }
}

// Signed-photo blob serving. Authorised by the HMAC token in the path, NOT by a
// session — so it's @Public(). The token (StorageService.signedGetToken) is
// short-lived and scoped to one storage key; bytes are streamed, never logged.
@Controller('photos')
export class PhotoBlobController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('blob/:token')
  @Header('Cache-Control', 'private, max-age=300')
  async blob(@Param('token') token: string, @Res() res: Response) {
    let key: string;
    try {
      key = this.storage.verifyGetToken(token);
    } catch {
      // verifyGetToken throws NotFound on bad/expired tokens — don't leak why.
      throw new NotFoundException('image not found');
    }
    const bytes = await this.storage.getBytes(key);
    res.setHeader('Content-Type', contentTypeForKey(key));
    res.setHeader('Content-Length', bytes.length);
    // Allow the SPA on a different origin (web :5173 -> api :3001) to embed the
    // image. Helmet's default CORP is 'same-origin', which blocks <img> render.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(bytes);
  }
}

function contentTypeForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
