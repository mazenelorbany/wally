import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Building2,
  Check,
  FolderKanban,
  Pencil,
  Plus,
  Store as TradeshowIcon,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@wally/ui';
import type { ProjectDto, ProjectKind } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { useProject } from '../ProjectContext';

const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-graphite focus:outline-none';

export function ProjectsView() {
  const { projects, isLoading, setProjectId } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';
  const [creating, setCreating] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const [editing, setEditing] = React.useState<ProjectDto | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ProjectDto | null>(
    null,
  );

  // The full list (incl. archived) only when the admin toggles it on — its own
  // cache key so it never disturbs the working list the rest of the studio reads.
  const allQ = useQuery({
    queryKey: ['studio', 'projects', 'all'],
    queryFn: () => api.projects.list(true),
    enabled: isAdmin && showArchived,
  });

  // What to render: the active list by default, the full list when the toggle is
  // on (so archived projects appear, badged, with an Unarchive action).
  const shown = showArchived ? allQ.data ?? [] : projects;
  const loading = showArchived ? allQ.isLoading : isLoading;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['studio', 'projects'] });
  };

  const create = useMutation({
    mutationFn: (body: { name: string; kind: ProjectKind }) =>
      api.projects.create(body),
    onSuccess: (p) => {
      invalidate();
      setCreating(false);
      setProjectId(p.id);
      toast.success(`Project “${p.name}” created`);
      // A fresh tradeshow stand starts in the layout builder.
      navigate('/studio');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const archive = useMutation({
    mutationFn: (p: ProjectDto) => api.projects.archive(p.id),
    onSuccess: (_r, p) => {
      invalidate();
      toast.success(`Project “${p.name}” archived`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const unarchive = useMutation({
    mutationFn: (p: ProjectDto) => api.projects.unarchive(p.id),
    onSuccess: (_r, p) => {
      invalidate();
      toast.success(`Project “${p.name}” restored`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const open = (p: ProjectDto) => {
    setProjectId(p.id);
    navigate('/studio');
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-steel">Workspace</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Projects
          </h1>
          <p className="mt-1 text-sm text-steel">
            Each project is a layout to set up and verify — a retail campaign or a
            tradeshow stand.
          </p>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <label className="flex select-none items-center gap-1.5 text-xs text-steel">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-mist text-ink focus:ring-0"
              />
              Show archived
            </label>
            <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'outline' : undefined}>
              {creating ? 'Cancel' : (<><Plus className="h-4 w-4" /> New project</>)}
            </Button>
          </div>
        ) : null}
      </header>

      {creating ? <NewProjectForm onCreate={create.mutate} pending={create.isPending} /> : null}

      {loading ? (
        <div className="grid h-48 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              isAdmin={isAdmin}
              onOpen={() => open(p)}
              onEdit={() => setEditing(p)}
              onArchive={() => archive.mutate(p)}
              onUnarchive={() => unarchive.mutate(p)}
              onDelete={() => setPendingDelete(p)}
              busy={archive.isPending || unarchive.isPending}
            />
          ))}
        </div>
      )}

      <EditProjectDialog
        project={editing}
        onClose={() => setEditing(null)}
        onSaved={invalidate}
      />
      <DeleteProjectDialog
        project={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={invalidate}
      />
    </div>
  );
}

function ProjectCard({
  project,
  isAdmin,
  onOpen,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  busy,
}: {
  project: ProjectDto;
  isAdmin: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const trade = project.kind === 'TRADESHOW';
  const archived = Boolean(project.archivedAt);
  const pct = project.fixturesTotal
    ? Math.round((project.fixturesCaptured / project.fixturesTotal) * 100)
    : 0;
  return (
    <Card
      className={`group relative flex flex-col p-5 transition-shadow hover:shadow-lift ${
        archived ? 'opacity-75' : ''
      }`}
    >
      {/* Admin corner actions — edit + archive/unarchive + delete. */}
      {isAdmin ? (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {archived ? (
            <button
              type="button"
              onClick={onUnarchive}
              disabled={busy}
              aria-label={`Restore ${project.name}`}
              className="rounded-md p-1.5 text-steel transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
            >
              <ArchiveRestore className="h-4 w-4" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                aria-label={`Edit ${project.name}`}
                className="rounded-md p-1.5 text-steel transition-colors hover:bg-surface hover:text-ink"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onArchive}
                disabled={busy}
                aria-label={`Archive ${project.name}`}
                className="rounded-md p-1.5 text-steel transition-colors hover:bg-surface hover:text-ink disabled:opacity-50"
              >
                <Archive className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Remove ${project.name}`}
            className="rounded-md p-1.5 text-steel transition-colors hover:bg-surface hover:text-fail"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <button type="button" onClick={onOpen} className="flex-1 text-left">
        <div className="mb-3 flex items-center justify-between">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-ink text-paper">
            {trade ? <TradeshowIcon className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
          </span>
          <span className="flex items-center gap-1.5">
            {archived ? (
              <span className="rounded-full border border-mist/70 bg-surface px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-brand text-steel">
                Archived
              </span>
            ) : null}
            <span className="rounded-full border border-mist/70 bg-surface px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-brand text-steel">
              {trade ? 'Tradeshow' : 'Retail'}
            </span>
          </span>
        </div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
          {project.name}
        </h2>
        <p className="mt-0.5 text-sm text-steel">
          {project.venueCount} {trade ? (project.venueCount === 1 ? 'venue' : 'venues') : 'stores'}
          {project.campaignName ? ` · ${project.campaignName}` : ''}
        </p>

        {/* Setup progress */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[11px] text-steel">
            <span>Setup captured</span>
            <span className="tabular-nums">
              {project.fixturesCaptured}/{project.fixturesTotal}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-mist/40">
            <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-medium text-graphite hover:text-ink"
      >
        Open project <ArrowRight className="h-4 w-4" />
      </button>
    </Card>
  );
}

function NewProjectForm({
  onCreate,
  pending,
}: {
  onCreate: (body: { name: string; kind: ProjectKind }) => void;
  pending: boolean;
}) {
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<ProjectKind>('TRADESHOW');

  return (
    <Card className="mb-5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-[11px] uppercase tracking-brand text-steel">
            Project name
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ambiente Frankfurt 2026"
            className="field"
          />
        </label>
        <div>
          <span className="mb-1 block text-[11px] uppercase tracking-brand text-steel">
            Type
          </span>
          <div className="inline-flex overflow-hidden rounded-md border border-mist">
            {(['RETAIL', 'TRADESHOW'] as ProjectKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-3 py-2 text-sm ${
                  kind === k ? 'bg-ink text-paper' : 'bg-paper text-graphite hover:bg-surface'
                }`}
              >
                {k === 'TRADESHOW' ? 'Tradeshow' : 'Retail'}
              </button>
            ))}
          </div>
        </div>
        <Button
          onClick={() => name.trim() && onCreate({ name: name.trim(), kind })}
          disabled={!name.trim()}
          loading={pending}
        >
          <Check className="h-4 w-4" /> Create
        </Button>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-steel">
        <FolderKanban className="h-3.5 w-3.5" /> You'll build its layout next, then crews
        verify each wall/bay/table.
      </p>
    </Card>
  );
}

/** Rename a project / change its kind. The slug is the stable key — never edited. */
function EditProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<ProjectKind>('RETAIL');

  const update = useMutation({
    mutationFn: (body: { name: string; kind: ProjectKind }) =>
      api.projects.update(project!.id, body),
    onSuccess: (p) => {
      onSaved();
      toast.success(`Project “${p.name}” updated`);
      onClose();
    },
  });

  // Seed the form whenever a different project opens.
  React.useEffect(() => {
    if (project) {
      setName(project.name);
      setKind(project.kind);
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    const trimmed = name.trim();
    if (!trimmed || update.isPending) return;
    update.mutate({ name: trimmed, kind });
  };

  return (
    <Dialog
      open={Boolean(project)}
      onOpenChange={(o) => {
        if (!o && !update.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Rename the project or change its type. RETAIL vs TRADESHOW drives the
            venue model and how it sorts.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="mt-2 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-graphite">
              Name
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className={fieldCls}
            />
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-graphite">
              Type
            </span>
            <div className="inline-flex overflow-hidden rounded-md border border-mist">
              {(['RETAIL', 'TRADESHOW'] as ProjectKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`px-3 py-2 text-sm ${
                    kind === k
                      ? 'bg-ink text-paper'
                      : 'bg-paper text-graphite hover:bg-surface'
                  }`}
                >
                  {k === 'TRADESHOW' ? 'Tradeshow' : 'Retail'}
                </button>
              ))}
            </div>
          </div>

          {update.isError ? (
            <p className="text-sm text-fail">{errorMessage(update.error)}</p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={update.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Remove a project. Archive is the recommended, reversible move (keeps the
 * project's campaigns/stores/bulletins). A permanent delete is only allowed for
 * an EMPTY project — the server returns a 409 otherwise, surfaced here as the
 * error message that steers the admin back to archive.
 */
function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: ProjectDto | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [showDelete, setShowDelete] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState('');
  const nameMatches =
    Boolean(project) && confirmName.trim() === project!.name;

  const archive = useMutation({
    mutationFn: () => api.projects.archive(project!.id),
    onSuccess: () => {
      onDeleted();
      toast.success(`Project “${project!.name}” archived`);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.projects.remove(project!.id),
    onSuccess: () => {
      onDeleted();
      toast.success(`Project “${project!.name}” deleted`);
      onClose();
    },
  });
  const busy = archive.isPending || remove.isPending;

  React.useEffect(() => {
    setShowDelete(false);
    setConfirmName('');
    archive.reset();
    remove.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const archived = Boolean(project?.archivedAt);

  return (
    <Dialog
      open={Boolean(project)}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove “{project?.name}”?</DialogTitle>
          <DialogDescription>
            Archiving hides it from the working list but keeps its stores,
            campaigns, and bulletins intact — the recommended, reversible option.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 rounded-md border border-mist/60 bg-surface/40 p-3 text-sm text-graphite">
          <p>
            <b className="text-ink">{project?.venueCount ?? 0}</b>{' '}
            {project?.venueCount === 1 ? 'venue' : 'venues'}
            {project?.campaignName ? (
              <>
                {' '}
                · active guide{' '}
                <b className="text-ink">{project.campaignName}</b>
              </>
            ) : null}
          </p>
        </div>

        {/* Hard-delete zone — gated behind a disclosure + an exact-name confirm.
            The server still enforces the empty-check (409); this is the front
            door, and the 409 message surfaces below if the project isn't empty. */}
        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="self-start text-xs font-medium text-steel underline-offset-2 hover:text-fail hover:underline"
          >
            Delete permanently instead…
          </button>
        ) : (
          <div className="space-y-2 rounded-md border border-fail/40 bg-fail/5 p-3">
            <p className="text-xs text-graphite">
              This permanently removes the project. Only an empty project (no
              stores, campaigns, or bulletins) can be deleted — otherwise it's
              refused. To confirm, type its name{' '}
              <b className="text-ink">{project?.name}</b>.
            </p>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={project?.name}
              aria-label="Type the project name to confirm deletion"
              className={fieldCls}
            />
          </div>
        )}

        {archive.isError ? (
          <p className="text-sm text-fail">{errorMessage(archive.error)}</p>
        ) : null}
        {remove.isError ? (
          <p className="text-sm text-fail">{errorMessage(remove.error)}</p>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="ghost" type="button" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          {showDelete ? (
            <Button
              variant="signal"
              onClick={() => remove.mutate()}
              disabled={busy || !nameMatches}
            >
              {remove.isPending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          ) : archived ? null : (
            <Button onClick={() => archive.mutate()} disabled={busy}>
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
