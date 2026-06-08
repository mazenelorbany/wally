// react-query data hooks over the SDK. Route components consume these, never
// the SDK directly — so caching, invalidation, and loading states are uniform.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CampaignSummary,
  FixtureCompliance,
  FixtureComplianceDetail,
  OverrideCaptureBody,
} from '@wally/sdk';
import type { StoreScore } from '@wally/types';

import { api } from './api';
import { qk } from './queryKeys';

export function useCampaigns(): UseQueryResult<CampaignSummary[]> {
  return useQuery({
    queryKey: qk.campaigns,
    queryFn: () => api.campaigns.list(),
  });
}

/**
 * The reviewer queue for a campaign. Enqueues scoring for pending submissions
 * and returns current store scores. Refetches on focus so the reviewer always
 * sees freshly-scored rows. Disabled until a campaign is selected.
 */
export function useQueue(
  campaignId: string | undefined,
): UseQueryResult<StoreScore[]> {
  return useQuery({
    queryKey: campaignId ? qk.queue(campaignId) : ['queue', 'none'],
    queryFn: () => api.campaigns.queue(campaignId as string),
    enabled: Boolean(campaignId),
    refetchOnWindowFocus: true,
    // Scoring is durable + async on the server; poll while work is in flight.
    refetchInterval: (q) => {
      const data = q.state.data as StoreScore[] | undefined;
      const pending = data?.some((s) => s.needsReview || s.submitted < s.expected);
      return pending ? 8_000 : false;
    },
  });
}

export function useStoreScore(
  storeId: string | undefined,
  campaignId: string | undefined,
): UseQueryResult<StoreScore> {
  return useQuery({
    queryKey:
      storeId && campaignId
        ? qk.storeScore(storeId, campaignId)
        : ['store-score', 'none'],
    queryFn: () => api.stores.storeScore(storeId as string, campaignId as string),
    enabled: Boolean(storeId && campaignId),
  });
}

/* -------------------------------------------------------------------------- */
/* FIXTURE-CAPTURE compliance — the canonical reviewer path (replaces the      */
/* legacy Submission/Verdict drill-down). Keyed the same way as the manager    */
/* floor loop (store/GuideView) so a console action and a floor action         */
/* invalidate each other's caches.                                             */
/* -------------------------------------------------------------------------- */

/** Every fixture's compliance for a store (reviewer passes the storeId). */
export function useCompliance(
  storeId: string | undefined,
): UseQueryResult<FixtureCompliance[]> {
  return useQuery({
    queryKey: ['manager', 'compliance', storeId],
    queryFn: () => api.manager.compliance(storeId),
    enabled: Boolean(storeId),
  });
}

/** One fixture's full compliance sheet (reference, photo, verdict, attempts). */
export function useFixtureCompliance(
  fixtureId: string | undefined,
  storeId: string | undefined,
): UseQueryResult<FixtureComplianceDetail> {
  return useQuery({
    queryKey: ['manager', 'fixture-compliance', storeId, fixtureId],
    queryFn: () => api.manager.fixtureCompliance(fixtureId as string, storeId),
    enabled: Boolean(fixtureId && storeId),
  });
}

/** All the capture caches a reviewer action touches (one store + its fixtures). */
function invalidateCapture(qc: ReturnType<typeof useQueryClient>, storeId?: string) {
  void qc.invalidateQueries({ queryKey: ['manager', 'compliance', storeId] });
  void qc.invalidateQueries({ queryKey: ['manager', 'fixture-compliance', storeId] });
  void qc.invalidateQueries({ queryKey: ['manager', 'home', storeId] });
  // The reviewer queue is FixtureCapture-based; keep it fresh too.
  void qc.invalidateQueries({ queryKey: ['queue'] });
}

/**
 * REVIEWER/ADMIN: override a fixture-capture's AI verdict with a human decision.
 * The effective verdict then supersedes the AI everywhere (queue, floor, UI).
 */
export function useOverrideCapture(
  storeId: string | undefined,
): UseMutationResult<
  FixtureComplianceDetail,
  unknown,
  { fixtureId: string; body: OverrideCaptureBody }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fixtureId, body }) =>
      api.manager.overrideCapture(fixtureId, body, storeId),
    onSuccess: () => invalidateCapture(qc, storeId),
  });
}

/** REVIEWER/ADMIN: re-request a photo for a fixture ("redo this"). */
export function useRequestCapturePhoto(
  storeId: string | undefined,
): UseMutationResult<FixtureComplianceDetail, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fixtureId) => api.manager.requestCapturePhoto(fixtureId, storeId),
    onSuccess: () => invalidateCapture(qc, storeId),
  });
}
