import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { MePreferences, SessionUser } from '@wally/types';

import { CurrentUser } from '../auth/current-user.decorator';
import { NoViewerGuard } from '../auth/no-viewer.guard';
import { ZodValidationPipe } from '../org/zod-validation.pipe';

import {
  UpdateMePreferencesSchema,
  type UpdateMePreferencesInput,
} from './me.dto';
import { MeService } from './me.service';

// =============================================================================
// MeController — the signed-in user's own account preferences.
//
// SessionGuard is global, so every route here is authenticated. GET is open to
// any session; PATCH adds NoViewerGuard so a read-only VIEWER can't mutate
// (mirrors the manager preferences route). This is the admin/reviewer Settings
// surface for the chase-email opt-out.
// =============================================================================
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** The signed-in user's account preferences. */
  @Get('preferences')
  getPreferences(@CurrentUser() user: SessionUser): Promise<MePreferences> {
    return this.me.getPreferences(user);
  }

  /** Patch the signed-in user's account preferences. */
  @Patch('preferences')
  @UseGuards(NoViewerGuard)
  updatePreferences(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(UpdateMePreferencesSchema))
    body: UpdateMePreferencesInput,
  ): Promise<MePreferences> {
    return this.me.updatePreferences(user, body);
  }
}
