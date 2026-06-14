import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  Image as ImageIcon,
  ListChecks,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
  cn,
} from '@wally/ui';
import type { CampaignFixtureSummary, CampaignQuestionDto, Fixture } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { sqk } from '../lib/queryKeys';
import { ErrorState } from '../../components/states';
import { useSetStudioTopBar } from '../components/StudioContext';
import { FixtureDetailPanel } from '../components/FixtureDetailPanel';
import { CampaignQuestionsDialog } from './CampaignQuestionsDialog';
import { SendTaskDialog } from './TasksView';

const QTYPE_LABEL: Record<string, string> = {
  SHORT_TEXT: 'Short text',
  YES_NO: 'Yes / No',
  LONG_NOTE: 'Long note',
};

/**
 * Build a task in one place: its Questions (asked to every store) and its photo
 * requests — each fixture with its reference image, instructions and checklist.
 * Reached from a Task card; "Send to stores" lives at the bottom so authoring
 * and assigning happen on the same page (no Store-directory / floor-plan detour).
 */
export function TaskBuildView() {
  const { campaignId = '' } = useParams();
  const qc = useQueryClient();

  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  const task = campaignsQ.data?.find((c) => c.id === campaignId);

  useSetStudioTopBar({ guideName: 'Tasks', guideKey: task?.key, stores: [] });

  const questionsQ = useQuery({
    queryKey: ['studio', 'campaign-questions', campaignId],
    queryFn: () => api.campaigns.questions.list(campaignId),
    enabled: Boolean(campaignId),
  });

  const fixturesQ = useQuery({
    queryKey: ['studio', 'task-fixtures', campaignId],
    queryFn: () => api.guideFixtures.list(campaignId),
    enabled: Boolean(campaignId),
  });

  const [editingQuestions, setEditingQuestions] = React.useState(false);
  const [editingFixtureId, setEditingFixtureId] = React.useState<string | null>(null);
  const [addingFixture, setAddingFixture] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  const questions = questionsQ.data ?? [];
  const fixtures = fixturesQ.data ?? [];

  const toast = useToast();
  const removeRequest = useMutation({
    mutationFn: (fixtureId: string) =>
      api.guideFixtures.removeRequest(campaignId, fixtureId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['studio', 'task-fixtures', campaignId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        to="/studio/tasks"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-steel transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> All tasks
      </Link>

      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-brand text-steel">Build task</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          {task?.name ?? 'Task'}{' '}
          {task ? <span className="text-steel">· {task.key}</span> : null}
        </h1>
        <p className="mt-1 text-sm text-steel">
          Set the questions and what each store should photograph, then send it
          out.
        </p>
      </header>

      {/* ---- Questions ---------------------------------------------------- */}
      <section className="mb-7">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-brand text-steel">
            <HelpCircle className="h-3.5 w-3.5" /> Questions ({questions.length})
          </h2>
          <Button size="sm" variant="outline" onClick={() => setEditingQuestions(true)}>
            <Pencil className="h-3.5 w-3.5" /> Add / edit
          </Button>
        </div>
        {questionsQ.isLoading ? (
          <RowSkeleton />
        ) : questions.length === 0 ? (
          <EmptyRow
            icon={HelpCircle}
            text="No questions yet — add text, yes/no, or note prompts every store answers."
          />
        ) : (
          <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
            {questions.map((q) => (
              <QuestionRow key={q.id} question={q} />
            ))}
          </ul>
        )}
      </section>

      {/* ---- Photo requests (fixtures) ------------------------------------ */}
      <section className="mb-8">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-brand text-steel">
            <Boxes className="h-3.5 w-3.5" /> Photo requests ({fixtures.length})
          </h2>
          <Button size="sm" variant="outline" onClick={() => setAddingFixture(true)}>
            <Plus className="h-3.5 w-3.5" /> Add fixture
          </Button>
        </div>
        {fixturesQ.isLoading ? (
          <RowSkeleton />
        ) : fixturesQ.isError ? (
          <ErrorState
            error={fixturesQ.error}
            onRetry={() => fixturesQ.refetch()}
            title="Couldn't load this task's fixtures"
          />
        ) : fixtures.length === 0 ? (
          <EmptyRow
            icon={Boxes}
            text="No photo requests yet — add a fixture from the library and every store will be asked to photograph it."
          />
        ) : (
          <ul className="divide-y divide-mist/50 overflow-hidden rounded-lg border border-mist/60 bg-paper">
            {fixtures.map((f) => (
              <FixtureRow
                key={f.fixtureId}
                fixture={f}
                onOpen={() => setEditingFixtureId(f.fixtureId)}
                onRemove={() => removeRequest.mutate(f.fixtureId)}
                removing={
                  removeRequest.isPending &&
                  removeRequest.variables === f.fixtureId
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---- Send --------------------------------------------------------- */}
      <div className="flex items-center justify-end gap-3 border-t border-mist/60 pt-5">
        <Button size="lg" onClick={() => setSending(true)} disabled={!task}>
          <Send className="h-4 w-4" /> Send to stores
        </Button>
      </div>

      {/* Editors (reused from the studio) */}
      <CampaignQuestionsDialog
        campaign={editingQuestions ? (task ?? null) : null}
        onClose={() => setEditingQuestions(false)}
      />

      <AddPhotoRequestDialog
        campaignId={campaignId}
        open={addingFixture}
        onClose={() => setAddingFixture(false)}
        requestedFixtureIds={fixtures.map((f) => f.fixtureId)}
      />

      <Dialog
        open={editingFixtureId != null}
        onOpenChange={(o) => {
          if (!o) {
            setEditingFixtureId(null);
            // Counts (reference / instructions / checklist) may have changed.
            void qc.invalidateQueries({
              queryKey: ['studio', 'task-fixtures', campaignId],
            });
          }
        }}
      >
        <DialogContent
          hideClose
          aria-describedby={undefined}
          className="flex h-[min(88vh,860px)] w-[min(1040px,95vw)] max-w-none flex-col overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">Fixture instructions</DialogTitle>
          {editingFixtureId ? (
            <FixtureDetailPanel
              campaignId={campaignId}
              fixtureId={editingFixtureId}
              onClose={() => {
                setEditingFixtureId(null);
                void qc.invalidateQueries({
                  queryKey: ['studio', 'task-fixtures', campaignId],
                });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <SendTaskDialog
        task={sending ? (task ?? null) : null}
        onClose={() => setSending(false)}
      />
    </div>
  );
}

function QuestionRow({ question: q }: { question: CampaignQuestionDto }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{q.label}</span>
      {q.required ? (
        <Badge variant="muted" className="shrink-0 text-fail">
          Required
        </Badge>
      ) : null}
      <Badge variant="muted" className="shrink-0 text-steel">
        {QTYPE_LABEL[q.type] ?? q.type}
      </Badge>
    </li>
  );
}

function FixtureRow({
  fixture: f,
  onOpen,
  onRemove,
  removing,
}: {
  fixture: CampaignFixtureSummary;
  onOpen: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <li className="flex items-center">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface/50"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface text-graphite">
          <Boxes className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{f.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-steel">
            <Chip
              ok={f.hasReference}
              icon={ImageIcon}
              label={f.hasReference ? 'Reference' : 'No reference'}
            />
            <Chip
              ok={f.instructionCount > 0}
              icon={ListChecks}
              label={`${f.instructionCount} instruction${f.instructionCount === 1 ? '' : 's'}`}
            />
            <Chip
              ok={f.checklistCount > 0}
              icon={CheckCircle2}
              label={`${f.checklistCount} checklist`}
            />
            <span className="text-steel/80">
              {f.storeCount} store{f.storeCount === 1 ? '' : 's'}
            </span>
          </span>
        </span>
        <Pencil className="h-4 w-4 shrink-0 text-mist" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Remove “${f.name}” photo request`}
        className="mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-md text-steel transition-colors hover:bg-fail/10 hover:text-fail disabled:opacity-40"
      >
        {removing ? <Spinner className="text-sm" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </li>
  );
}

/**
 * Pick a fixture from the library to request a photo of. Adding places it on
 * every store this task reaches; already-requested fixtures show as added.
 */
function AddPhotoRequestDialog({
  campaignId,
  open,
  onClose,
  requestedFixtureIds,
}: {
  campaignId: string;
  open: boolean;
  onClose: () => void;
  requestedFixtureIds: string[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = React.useState('');
  React.useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const libraryQ = useQuery({
    queryKey: sqk.fixturesList(),
    queryFn: () => api.fixtures.list(),
    enabled: open,
  });
  const library = libraryQ.data ?? [];
  const requested = new Set(requestedFixtureIds);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return library;
    return library.filter((f) =>
      `${f.name} ${f.kind} ${f.department ?? ''}`.toLowerCase().includes(q),
    );
  }, [library, search]);

  const add = useMutation({
    mutationFn: (fixtureId: string) =>
      api.guideFixtures.addRequest(campaignId, fixtureId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['studio', 'task-fixtures', campaignId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add photo request</DialogTitle>
          <DialogDescription>
            Every store this task is sent to will be asked to photograph the
            fixture.
          </DialogDescription>
        </DialogHeader>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fixtures by name, kind, department…"
          aria-label="Search fixtures"
          className="w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none"
        />

        {libraryQ.isLoading ? (
          <div className="grid h-32 place-items-center">
            <Spinner className="text-2xl text-steel" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-md border border-dashed border-mist/70 bg-surface/30 px-3 py-4 text-center text-sm text-steel">
            {library.length === 0
              ? 'The fixture library is empty — create fixtures in Studio → Fixtures first.'
              : 'No fixtures match that search.'}
          </p>
        ) : (
          <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-mist/70 bg-paper p-1">
            {filtered.map((f: Fixture) => {
              const added = requested.has(f.id);
              const adding = add.isPending && add.variables === f.id;
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{f.name}</span>
                    <span className="block text-[11px] capitalize text-steel">
                      {f.kind}
                      {f.department ? ` · ${f.department}` : ''}
                    </span>
                  </span>
                  {added ? (
                    <Badge variant="muted" className="shrink-0 text-steel">
                      Added
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={adding}
                      onClick={() => add.mutate(f.id)}
                    >
                      {adding ? <Spinner className="text-sm" /> : <Plus className="h-3.5 w-3.5" />}{' '}
                      Add
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A tiny "filled / empty" indicator: ✓ tinted when present, dim when not. */
function Chip({
  ok,
  icon: Icon,
  label,
}: {
  ok: boolean;
  icon: typeof ImageIcon;
  label: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', ok ? 'text-graphite' : 'text-steel/70')}>
      {ok ? (
        <Icon className="h-3 w-3" />
      ) : (
        <CircleDashed className="h-3 w-3" />
      )}
      {label}
    </span>
  );
}

function EmptyRow({
  icon: Icon,
  text,
}: {
  icon: typeof Boxes;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-mist/70 bg-surface/30 px-4 py-5 text-sm text-steel">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-mist" />
      <p>{text}</p>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="grid h-20 place-items-center rounded-lg border border-mist/60 bg-paper">
      <Spinner className="text-xl text-steel" />
    </div>
  );
}
