import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CampaignSummary } from '@wally/sdk';

import { api } from '../../lib/api';
import { useProject } from '../ProjectContext';

// =============================================================================
// useProjectCampaign — resolve the campaign the studio analytics/authoring views
// should show, SCOPED TO THE SELECTED PROJECT.
//
// The studio is project-scoped (the top-left switcher picks Myer / Ambiente /…),
// and each project runs its own active campaign. Several views used to grab the
// org-wide newest-ACTIVE campaign (`campaigns.find(ACTIVE) ?? [0]`), which is the
// WRONG project's campaign whenever two projects are concurrently active — e.g.
// with the switcher on "Myer" the Gallery/Insights/Leaderboard/Rubrics headers
// read "AMBIENTE-SS26". This hook fixes that: it prefers the selected project's
// own campaign (ProjectContext.campaignId), and only falls back to the active/
// newest campaign when the project has none — so single-project orgs are
// unaffected.
// =============================================================================

export interface ProjectCampaign {
  /** The full campaign summary to drive queries + the header (undefined while loading or if none). */
  campaign: CampaignSummary | undefined;
  /** All campaigns (for any view that still needs the full list, e.g. a picker). */
  campaigns: CampaignSummary[];
  isLoading: boolean;
  /** The underlying campaigns query — for views that gate on its error/refetch. */
  campaignsQ: UseQueryResult<CampaignSummary[]>;
}

export function useProjectCampaign(): ProjectCampaign {
  const { campaignId: projectCampaignId } = useProject();
  const campaignsQ = useQuery({
    queryKey: ['studio', 'campaigns'],
    queryFn: () => api.campaigns.list(),
  });
  const campaigns = campaignsQ.data ?? [];

  // 1) the selected project's own campaign (correct in a multi-project org),
  // 2) fall back to the org-wide active/newest (single-project orgs, or a
  //    project that has no campaign of its own yet).
  const campaign =
    (projectCampaignId
      ? campaigns.find((c) => c.id === projectCampaignId)
      : undefined) ??
    campaigns.find((c) => c.status === 'ACTIVE') ??
    campaigns[0];

  return { campaign, campaigns, isLoading: campaignsQ.isLoading, campaignsQ };
}
