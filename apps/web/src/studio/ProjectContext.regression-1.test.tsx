// Regression: ISSUE-002 — project selection reset to the first project (Myer)
// on every full page load / deep link, silently flipping all project-scoped
// modules (fixtures, gallery, stores, money map) back to the wrong project.
// Found by /qa on 2026-06-09
// Report: .gstack/qa-reports/qa-report-localhost-5173-2026-06-09.md
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ProjectProvider, useProject, readPersistedProject } from './ProjectContext';

const PROJECTS = [
  { id: 'proj-myer', name: 'Myer', slug: 'myer', kind: 'RETAIL', campaignId: 'camp-1', venueCount: 64 },
  { id: 'proj-ambiente', name: 'Ambiente', slug: 'ambiente', kind: 'TRADESHOW', campaignId: 'camp-2', venueCount: 2 },
];

vi.mock('../lib/api', () => ({
  api: { projects: { list: () => Promise.resolve(PROJECTS) } },
}));

function Probe() {
  const { project, setProjectId } = useProject();
  return (
    <div>
      <span data-testid="active">{project?.name ?? 'none'}</span>
      <button onClick={() => setProjectId('proj-ambiente')}>pick ambiente</button>
    </div>
  );
}

function renderWithProvider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <Probe />
      </ProjectProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('ProjectContext persistence (ISSUE-002)', () => {
  it('defaults to the first project when nothing is persisted', async () => {
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Myer'));
  });

  it('persists the pick so a remount (= full page load) keeps the project', async () => {
    renderWithProvider();
    await screen.findByTestId('active');
    fireEvent.click(screen.getByText('pick ambiente'));
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Ambiente'));
    expect(window.localStorage.getItem('studio:project')).toBe('proj-ambiente');

    // Simulate the full page load that used to lose the selection.
    cleanup();
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Ambiente'));
  });

  it('falls back to the first project when the persisted id is stale', async () => {
    window.localStorage.setItem('studio:project', 'proj-deleted');
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Myer'));
    expect(readPersistedProject()).toBe('proj-deleted'); // kept, harmless
  });
});
