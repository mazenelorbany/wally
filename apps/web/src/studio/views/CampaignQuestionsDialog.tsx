import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@wally/ui';
import type {
  CampaignQuestionDto,
  CampaignQuestionType,
  CampaignSummary,
} from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

const TYPES: { value: CampaignQuestionType; label: string }[] = [
  { value: 'SHORT_TEXT', label: 'Short text' },
  { value: 'YES_NO', label: 'Yes / No' },
  { value: 'LONG_NOTE', label: 'Long note' },
];

/**
 * Admin builder for a campaign's extra report questions (the non-photo steps the
 * Myer-style report adds). Ordered list with per-row label / type / required /
 * N-A, reorder (up-down), and delete; plus an add-question form.
 */
export function CampaignQuestionsDialog({
  campaign,
  onClose,
}: {
  campaign: CampaignSummary | null;
  onClose: () => void;
}) {
  const open = campaign !== null;
  const campaignId = campaign?.id ?? '';
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['studio', 'campaign-questions', campaignId];

  const questionsQ = useQuery({
    queryKey: key,
    queryFn: () => api.campaigns.questions.list(campaignId),
    enabled: open,
  });
  const questions = questionsQ.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (body: { label: string; type: CampaignQuestionType }) =>
      api.campaigns.questions.create(campaignId, body),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.campaigns.questions.reorder(campaignId, ids),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const move = (index: number, dir: -1 | 1) => {
    const next = [...questions];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorder.mutate(next.map((q) => q.id));
  };

  const [newLabel, setNewLabel] = React.useState('');
  const [newType, setNewType] = React.useState<CampaignQuestionType>('SHORT_TEXT');
  React.useEffect(() => {
    if (open) {
      setNewLabel('');
      setNewType('SHORT_TEXT');
    }
  }, [open]);

  const addQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label || create.isPending) return;
    create.mutate(
      { label, type: newType },
      { onSuccess: () => setNewLabel('') },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Report questions</DialogTitle>
          <DialogDescription>
            Extra non-photo questions managers answer when they submit{' '}
            {campaign ? `“${campaign.name}”` : 'this campaign'}’s report. Photo
            steps come from the fixtures.
          </DialogDescription>
        </DialogHeader>

        {questionsQ.isLoading ? (
          <div className="grid h-24 place-items-center">
            <Spinner className="text-xl text-steel" />
          </div>
        ) : (
          <div className="space-y-2">
            {questions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-mist/70 bg-surface/30 px-3 py-4 text-center text-sm text-steel">
                No extra questions yet — managers will just submit the photos.
              </p>
            ) : (
              <ul className="space-y-2">
                {questions.map((q, i) => (
                  <QuestionRow
                    key={q.id}
                    campaignId={campaignId}
                    question={q}
                    isFirst={i === 0}
                    isLast={i === questions.length - 1}
                    onMoveUp={() => move(i, -1)}
                    onMoveDown={() => move(i, 1)}
                    onChanged={invalidate}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Add a question */}
        <form onSubmit={addQuestion} className="mt-1 flex items-end gap-2">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-medium text-graphite">
              New question
            </span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Who completed this task?"
              className={fieldCls}
            />
          </label>
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as CampaignQuestionType)}
            className={`${fieldCls} w-32 shrink-0`}
            aria-label="Question type"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={!newLabel.trim() || create.isPending}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One editable question row: label (save on blur), type, required, N/A, reorder, delete. */
function QuestionRow({
  campaignId,
  question,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onChanged,
}: {
  campaignId: string;
  question: CampaignQuestionDto;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChanged: () => Promise<unknown> | void;
}) {
  const toast = useToast();
  const [label, setLabel] = React.useState(question.label);
  React.useEffect(() => setLabel(question.label), [question.label]);

  const update = useMutation({
    mutationFn: (body: Partial<CampaignQuestionDto>) =>
      api.campaigns.questions.update(campaignId, question.id, {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.required !== undefined ? { required: body.required } : {}),
        ...(body.allowNA !== undefined ? { allowNA: body.allowNA } : {}),
      }),
    onSuccess: () => void onChanged(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => api.campaigns.questions.remove(campaignId, question.id),
    onSuccess: () => void onChanged(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <li className="rounded-lg border border-mist/60 bg-paper p-2.5">
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Move up"
            className="grid h-5 w-5 place-items-center rounded text-steel hover:text-ink disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Move down"
            className="grid h-5 w-5 place-items-center rounded text-steel hover:text-ink disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            const next = label.trim();
            if (next && next !== question.label) update.mutate({ label: next });
            else setLabel(question.label);
          }}
          className={`${fieldCls} flex-1`}
        />
        <select
          value={question.type}
          onChange={(e) =>
            update.mutate({ type: e.target.value as CampaignQuestionType })
          }
          className={`${fieldCls} w-28 shrink-0`}
          aria-label="Type"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          aria-label={`Remove “${question.label}”`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-steel transition-colors hover:bg-fail/10 hover:text-fail disabled:opacity-40"
        >
          {remove.isPending ? <Spinner className="text-sm" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-4 pl-7 text-xs text-graphite">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={question.required}
            onChange={(e) => update.mutate({ required: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-mist accent-graphite"
          />
          Required
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={question.allowNA}
            onChange={(e) => update.mutate({ allowNA: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-mist accent-graphite"
          />
          Allow N/A
        </label>
      </div>
    </li>
  );
}
