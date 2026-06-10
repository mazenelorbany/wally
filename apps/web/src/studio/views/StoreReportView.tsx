import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { Spinner } from '@wally/ui';

import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { ErrorState } from '../../components/states';
import { ReportDocument } from '../../components/report/ReportDocument';
import { useSetStudioTopBar } from '../components/StudioContext';

/** Admin/reviewer view of one store's report (the rendered document + PDF). */
export function StoreReportView() {
  const { campaignId = '', storeId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  useSetStudioTopBar({ guideName: 'Store report', stores: [] });

  const key = ['studio', 'report-document', campaignId, storeId];
  const docQ = useQuery({
    queryKey: key,
    queryFn: () => api.reports.document(storeId, campaignId),
    enabled: Boolean(campaignId && storeId),
  });

  const regen = useMutation({
    mutationFn: () => api.reports.summary(storeId, campaignId),
    onSuccess: (doc) => {
      qc.setQueryData(key, doc);
      if (!doc.aiSummary) toast.error('AI summary is unavailable right now');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          to={`/studio/tasks/${campaignId}`}
          className="inline-flex items-center gap-1.5 text-sm text-steel hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Submissions
        </Link>
        <a
          href={api.reports.pdfUrl(storeId, campaignId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-mist/70 bg-paper px-3 py-1.5 text-sm font-medium text-graphite transition-colors hover:bg-surface/60"
        >
          <Download className="h-4 w-4" /> Download PDF
        </a>
      </div>

      {docQ.isLoading ? (
        <div className="grid h-64 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : docQ.isError ? (
        <ErrorState
          error={docQ.error}
          onRetry={() => docQ.refetch()}
          title="Couldn't load this report"
        />
      ) : docQ.data ? (
        <ReportDocument
          doc={docQ.data}
          onRegenerateSummary={() => regen.mutate()}
          regenerating={regen.isPending}
        />
      ) : null}
    </div>
  );
}
