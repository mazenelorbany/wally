import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Building2,
  Check,
  FolderKanban,
  Plus,
  Store as TradeshowIcon,
} from 'lucide-react';
import { Button, Card, Spinner } from '@wally/ui';
import type { ProjectDto, ProjectKind } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { useProject } from '../ProjectContext';

export function ProjectsView() {
  const { projects, isLoading, setProjectId } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';
  const [creating, setCreating] = React.useState(false);

  const open = (p: ProjectDto) => {
    setProjectId(p.id);
    navigate('/studio');
  };

  const create = useMutation({
    mutationFn: (body: { name: string; kind: ProjectKind }) =>
      api.projects.create(body),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['studio', 'projects'] });
      setCreating(false);
      setProjectId(p.id);
      toast.success(`Project “${p.name}” created`);
      // A fresh tradeshow stand starts in the layout builder.
      navigate('/studio');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

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
          <Button onClick={() => setCreating((v) => !v)} variant={creating ? 'outline' : undefined}>
            {creating ? 'Cancel' : (<><Plus className="h-4 w-4" /> New project</>)}
          </Button>
        ) : null}
      </header>

      {creating ? <NewProjectForm onCreate={create.mutate} pending={create.isPending} /> : null}

      {isLoading ? (
        <div className="grid h-48 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => open(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectDto; onOpen: () => void }) {
  const trade = project.kind === 'TRADESHOW';
  const pct = project.fixturesTotal
    ? Math.round((project.fixturesCaptured / project.fixturesTotal) * 100)
    : 0;
  return (
    <Card className="flex flex-col p-5 transition-shadow hover:shadow-lift">
      <button type="button" onClick={onOpen} className="flex-1 text-left">
        <div className="mb-3 flex items-center justify-between">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-ink text-paper">
            {trade ? <TradeshowIcon className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
          </span>
          <span className="rounded-full border border-mist/70 bg-surface px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-brand text-steel">
            {trade ? 'Tradeshow' : 'Retail'}
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
