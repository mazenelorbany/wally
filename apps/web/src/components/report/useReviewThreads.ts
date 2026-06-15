import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateReviewThreadBody, ReviewThreadDto } from '@wally/sdk';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';

/**
 * The review-thread data layer for one store × campaign report. `storeId` is
 * omitted on manager surfaces (the API resolves their own store).
 */
export function useReviewThreads(campaignId?: string, storeId?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['review-threads', campaignId, storeId];
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const threadsQ = useQuery({
    queryKey: key,
    queryFn: () => api.reviewThreads.list(campaignId!, storeId),
    enabled: Boolean(campaignId),
  });

  const create = useMutation({
    mutationFn: (body: CreateReviewThreadBody) => api.reviewThreads.create(body),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reply = useMutation({
    mutationFn: (v: { threadId: string; body: string }) =>
      api.reviewThreads.reply(v.threadId, v.body),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resolve = useMutation({
    mutationFn: (threadId: string) => api.reviewThreads.resolve(threadId),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reopen = useMutation({
    mutationFn: (threadId: string) => api.reviewThreads.reopen(threadId),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const threads: ReviewThreadDto[] = threadsQ.data ?? [];
  return {
    threads,
    create,
    reply,
    resolve,
    reopen,
    busy:
      create.isPending || reply.isPending || resolve.isPending || reopen.isPending,
  };
}
