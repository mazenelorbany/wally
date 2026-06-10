import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Spinner } from '@wally/ui';
import type {
  AnswerQuestionBody,
  CampaignQuestionWithAnswer,
} from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none disabled:bg-surface/60 disabled:text-steel';

/**
 * The store's extra report questions (text / yes-no / note), each autosaved as
 * the manager answers it. Read-only once the report is submitted. The query key
 * is shared so the report view can read progress from the same data.
 */
export function ReportQuestions({
  storeId,
  readOnly = false,
}: {
  storeId?: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['manager', 'questions', storeId];

  const questionsQ = useQuery({
    queryKey: key,
    queryFn: () => api.manager.listQuestions(storeId),
  });

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string; body: AnswerQuestionBody }) =>
      api.manager.answerQuestion(id, body, storeId),
    onSuccess: (rows) => qc.setQueryData(key, rows),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const questions = questionsQ.data ?? [];
  if (questionsQ.isLoading) {
    return (
      <div className="grid h-20 place-items-center">
        <Spinner className="text-xl text-steel" />
      </div>
    );
  }
  if (questions.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-brand text-steel">
        A few questions
      </h2>
      <ul className="space-y-3">
        {questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            readOnly={readOnly}
            saving={save.isPending && save.variables?.id === q.id}
            onSave={(body) => save.mutate({ id: q.id, body })}
          />
        ))}
      </ul>
    </section>
  );
}

function QuestionField({
  question,
  readOnly,
  saving,
  onSave,
}: {
  question: CampaignQuestionWithAnswer;
  readOnly: boolean;
  saving: boolean;
  onSave: (body: AnswerQuestionBody) => void;
}) {
  const a = question.answer;
  const isNA = Boolean(a?.isNA);
  const [text, setText] = React.useState(a?.valueText ?? '');
  React.useEffect(() => setText(a?.valueText ?? ''), [a?.valueText]);

  const answered =
    isNA ||
    (question.type === 'YES_NO'
      ? a?.valueBool != null
      : Boolean((a?.valueText ?? '').trim()));
  const missingRequired = question.required && !answered;
  const disabled = readOnly || isNA;

  return (
    <li className="rounded-lg border border-mist/60 bg-paper p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">
          {question.label}
          {question.required ? <span className="text-fail"> *</span> : null}
        </span>
        <span className="flex items-center gap-2 text-xs text-steel">
          {saving ? (
            <Spinner className="text-xs" />
          ) : answered ? (
            <span className="inline-flex items-center gap-1 text-pass">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          ) : missingRequired ? (
            <span className="text-fail">Required</span>
          ) : null}
        </span>
      </div>

      {question.type === 'YES_NO' ? (
        <div className="flex gap-2">
          {[
            { v: true, label: 'Yes' },
            { v: false, label: 'No' },
          ].map((opt) => {
            const active = !isNA && a?.valueBool === opt.v;
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onSave({ valueBool: opt.v, isNA: false })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  active
                    ? 'border-graphite bg-graphite text-paper'
                    : 'border-mist/70 bg-paper text-graphite hover:bg-surface/60'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : question.type === 'LONG_NOTE' ? (
        <textarea
          value={isNA ? '' : text}
          disabled={disabled}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (!isNA && text !== (a?.valueText ?? ''))
              onSave({ valueText: text, isNA: false });
          }}
          className={fieldCls}
          placeholder="Type your answer…"
        />
      ) : (
        <input
          value={isNA ? '' : text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (!isNA && text !== (a?.valueText ?? ''))
              onSave({ valueText: text, isNA: false });
          }}
          className={fieldCls}
          placeholder="Type your answer…"
        />
      )}

      {question.allowNA && !readOnly ? (
        <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-1.5 text-xs text-graphite">
          <input
            type="checkbox"
            checked={isNA}
            onChange={(e) => onSave({ isNA: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-mist accent-graphite"
          />
          Not applicable
        </label>
      ) : null}
    </li>
  );
}
