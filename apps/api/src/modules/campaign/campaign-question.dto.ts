import { z } from 'zod';

// The admin-defined extra questions on a campaign's report (text / yes-no / note).

const QuestionType = z.enum(['SHORT_TEXT', 'YES_NO', 'LONG_NOTE']);

export const CreateQuestionSchema = z
  .object({
    label: z.string().min(1).max(200),
    type: QuestionType,
    required: z.boolean().optional(),
    allowNA: z.boolean().optional(),
  })
  .strict();

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;

export const UpdateQuestionSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    type: QuestionType.optional(),
    required: z.boolean().optional(),
    allowNA: z.boolean().optional(),
  })
  .strict();

export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>;

/** Reorder the campaign's questions: the full ordered list of question ids. */
export const ReorderQuestionsSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type ReorderQuestionsInput = z.infer<typeof ReorderQuestionsSchema>;

/** A store (manager) answering one question. */
export const AnswerQuestionSchema = z
  .object({
    valueText: z.string().max(4000).nullable().optional(),
    valueBool: z.boolean().nullable().optional(),
    isNA: z.boolean().optional(),
  })
  .strict();

export type AnswerQuestionInput = z.infer<typeof AnswerQuestionSchema>;
