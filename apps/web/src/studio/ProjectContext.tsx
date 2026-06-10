import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProjectDto } from '@wally/sdk';

import { api } from '../lib/api';

/**
 * The project an admin is working in (Myer retail, Ambiente tradeshow…). The
 * selected project's active campaign scopes the whole studio — its venues,
 * floor plans, money map, and setup status all read from `campaignId`.
 */
interface ProjectValue {
  projects: ProjectDto[];
  project: ProjectDto | undefined;
  projectId: string | undefined;
  /** The selected project's active guide campaign. */
  campaignId: string | undefined;
  setProjectId: (id: string) => void;
  isLoading: boolean;
}

const Ctx = React.createContext<ProjectValue | null>(null);

// The picked project survives reloads and deep links. Without this, any full
// page load silently reset the studio to the first project (Myer) while the
// user thought they were still in Ambiente — every project-scoped module
// (fixtures, gallery, stores, money map) then showed the wrong data.
const STORAGE_KEY = 'studio:project';

export function readPersistedProject(): string | undefined {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const projectsQ = useQuery({
    queryKey: ['studio', 'projects'],
    queryFn: () => api.projects.list(),
  });
  const projects = projectsQ.data ?? [];

  const [picked, setPicked] = React.useState<string | undefined>(readPersistedProject);
  const pick = React.useCallback((id: string) => {
    setPicked(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode etc. — selection still works for this session */
    }
  }, []);
  // Default to the first project (retail leads the sort), but honour a pick.
  // A stale persisted id (project deleted/archived) falls back gracefully.
  const projectId =
    picked && projects.some((p) => p.id === picked)
      ? picked
      : projects[0]?.id;
  const project = projects.find((p) => p.id === projectId);

  const value = React.useMemo<ProjectValue>(
    () => ({
      projects,
      project,
      projectId,
      campaignId: project?.campaignId ?? undefined,
      setProjectId: pick,
      isLoading: projectsQ.isLoading,
    }),
    [projects, project, projectId, pick, projectsQ.isLoading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    return {
      projects: [],
      project: undefined,
      projectId: undefined,
      campaignId: undefined,
      setProjectId: () => {},
      isLoading: false,
    };
  }
  return ctx;
}
