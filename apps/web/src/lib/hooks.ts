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
  ReviewBody,
  ReviewResult,
  Submission,
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

export function useSubmission(
  submissionId: string | undefined,
): UseQueryResult<Submission> {
  return useQuery({
    queryKey: submissionId ? qk.submission(submissionId) : ['submission', 'none'],
    queryFn: () => api.submissions.get(submissionId as string),
    enabled: Boolean(submissionId),
  });
}

/**
 * Submit a reviewer's decision on a verdict. On success we invalidate the
 * broad queue + store caches so the affected store row re-scores everywhere.
 */
export function useReview(): UseMutationResult<
  ReviewResult,
  unknown,
  { verdictId: string; body: ReviewBody }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ verdictId, body }) => api.verdicts.review(verdictId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['store-score'] });
      void qc.invalidateQueries({ queryKey: ['submission'] });
    },
  });
}

/**
 * Re-open a FAILED (or stuck) photo for scoring. On success we invalidate the
 * submission + queue caches so the photo flips back to UPLOADED and re-scores.
 */
export function useRescore(): UseMutationResult<
  { id: string; status: string },
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId) => api.photos.rescore(photoId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submission'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['store-score'] });
    },
  });
}
