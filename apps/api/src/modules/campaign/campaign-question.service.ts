import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CampaignQuestionType } from '@prisma/client';
import type { CampaignQuestionDto } from '@wally/types';

import { PrismaService } from '../../prisma/prisma.service';

import type {
  AnswerQuestionInput,
  CreateQuestionInput,
  ReorderQuestionsInput,
  UpdateQuestionInput,
} from './campaign-question.dto';

/**
 * The admin-defined extra questions on a campaign's report (text / yes-no /
 * note), plus the store answers. Photo steps stay on FixtureCapture; these are
 * the non-photo steps the Myer-style report adds ("Who completed this?", "Any
 * difficulties?"). All ops are org-scoped; a question is soft-archived (not
 * deleted) once it has answers so the report history survives.
 */
@Injectable()
export class CampaignQuestionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Confirm the campaign belongs to the org (404 otherwise). */
  private async requireCampaign(orgId: string, campaignId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');
  }

  /** The campaign's live (non-archived) questions, in order. */
  async list(orgId: string, campaignId: string): Promise<CampaignQuestionDto[]> {
    await this.requireCampaign(orgId, campaignId);
    const rows = await this.prisma.campaignQuestion.findMany({
      where: { campaignId, orgId, archivedAt: null },
      orderBy: { order: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    orgId: string,
    campaignId: string,
    input: CreateQuestionInput,
  ): Promise<CampaignQuestionDto> {
    await this.requireCampaign(orgId, campaignId);
    const max = await this.prisma.campaignQuestion.aggregate({
      where: { campaignId, orgId, archivedAt: null },
      _max: { order: true },
    });
    const row = await this.prisma.campaignQuestion.create({
      data: {
        orgId,
        campaignId,
        order: (max._max.order ?? -1) + 1,
        label: input.label,
        type: input.type as CampaignQuestionType,
        required: input.required ?? false,
        allowNA: input.allowNA ?? false,
      },
    });
    return toDto(row);
  }

  async update(
    orgId: string,
    campaignId: string,
    questionId: string,
    input: UpdateQuestionInput,
  ): Promise<CampaignQuestionDto> {
    await this.requireQuestion(orgId, campaignId, questionId);
    const row = await this.prisma.campaignQuestion.update({
      where: { id: questionId },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.type !== undefined
          ? { type: input.type as CampaignQuestionType }
          : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.allowNA !== undefined ? { allowNA: input.allowNA } : {}),
      },
    });
    return toDto(row);
  }

  /** Soft-archive when answers exist (keep history); hard-delete when none. */
  async remove(orgId: string, campaignId: string, questionId: string): Promise<void> {
    await this.requireQuestion(orgId, campaignId, questionId);
    const answers = await this.prisma.storeQuestionAnswer.count({
      where: { questionId },
    });
    if (answers > 0) {
      await this.prisma.campaignQuestion.update({
        where: { id: questionId },
        data: { archivedAt: new Date() },
      });
    } else {
      await this.prisma.campaignQuestion.delete({ where: { id: questionId } });
    }
  }

  /** Re-number the campaign's questions to match the given id order. */
  async reorder(
    orgId: string,
    campaignId: string,
    input: ReorderQuestionsInput,
  ): Promise<CampaignQuestionDto[]> {
    await this.requireCampaign(orgId, campaignId);
    const live = await this.prisma.campaignQuestion.findMany({
      where: { campaignId, orgId, archivedAt: null },
      select: { id: true },
    });
    const liveIds = new Set(live.map((q) => q.id));
    // Only reorder ids that actually belong to this campaign; ignore strays.
    const ordered = input.ids.filter((id) => liveIds.has(id));
    await this.prisma.$transaction(
      ordered.map((id, i) =>
        this.prisma.campaignQuestion.update({
          where: { id },
          data: { order: i },
        }),
      ),
    );
    return this.list(orgId, campaignId);
  }

  /** Confirm a question belongs to the org's campaign (404 otherwise). */
  private async requireQuestion(
    orgId: string,
    campaignId: string,
    questionId: string,
  ): Promise<void> {
    const q = await this.prisma.campaignQuestion.findFirst({
      where: { id: questionId, campaignId, orgId },
      select: { id: true },
    });
    if (!q) throw new NotFoundException('question not found');
  }

  // ----- store answers (manager) -------------------------------------------

  /**
   * Upsert a store's answer to a question. Validates the value matches the
   * question type and that N/A is only used when allowed. Stamps the answerer.
   */
  async answer(
    orgId: string,
    storeId: string,
    campaignId: string,
    questionId: string,
    userId: string,
    input: AnswerQuestionInput,
  ): Promise<void> {
    const question = await this.prisma.campaignQuestion.findFirst({
      where: { id: questionId, campaignId, orgId, archivedAt: null },
    });
    if (!question) throw new NotFoundException('question not found');

    const isNA = Boolean(input.isNA);
    if (isNA && !question.allowNA) {
      throw new NotFoundException('this question does not allow N/A');
    }

    // Normalise the stored value to the question's type (clear the other column).
    const valueText =
      !isNA && (question.type === 'SHORT_TEXT' || question.type === 'LONG_NOTE')
        ? (input.valueText ?? null)
        : null;
    const valueBool =
      !isNA && question.type === 'YES_NO' ? (input.valueBool ?? null) : null;

    await this.prisma.storeQuestionAnswer.upsert({
      where: { storeId_questionId: { storeId, questionId } },
      create: {
        orgId,
        storeId,
        campaignId,
        questionId,
        valueText,
        valueBool,
        isNA,
        answeredById: userId,
        answeredAt: new Date(),
      },
      update: {
        valueText,
        valueBool,
        isNA,
        answeredById: userId,
        answeredAt: new Date(),
      },
    });
  }
}

function toDto(row: {
  id: string;
  order: number;
  label: string;
  type: CampaignQuestionType;
  required: boolean;
  allowNA: boolean;
}): CampaignQuestionDto {
  return {
    id: row.id,
    order: row.order,
    label: row.label,
    type: row.type,
    required: row.required,
    allowNA: row.allowNA,
  };
}
