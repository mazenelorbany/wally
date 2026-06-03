// Centralised react-query cache keys. One place to keep them consistent so
// invalidations (e.g. after a review or an upload) always hit the right entry.

export const qk = {
  me: ['me'] as const,
  campaigns: ['campaigns'] as const,
  queue: (campaignId: string) => ['queue', campaignId] as const,
  storeScore: (storeId: string) => ['store-score', storeId] as const,
  submission: (submissionId: string) => ['submission', submissionId] as const,
};
