import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Spinner } from '@wally/ui';

import { api } from '../../lib/api';
import { ErrorState } from '../../components/states';
import { ReportDocument } from '../../components/report/ReportDocument';
import { useManagerStore } from '../ManagerStoreContext';

/** The manager's read-only submitted report (the rendered document). */
export function ReportDocumentView() {
  const { storeId } = useManagerStore();
  const docQ = useQuery({
    queryKey: ['manager', 'report-document', storeId],
    queryFn: () => api.manager.getReportDocument(storeId),
  });

  return (
    <div className="space-y-4">
      <Link
        to="/store/report"
        className="inline-flex items-center gap-1.5 text-sm text-steel hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to report
      </Link>
      {docQ.isLoading ? (
        <div className="grid h-64 place-items-center">
          <Spinner className="text-2xl text-steel" />
        </div>
      ) : docQ.isError ? (
        <ErrorState
          error={docQ.error}
          onRetry={() => docQ.refetch()}
          title="Couldn't load your report"
        />
      ) : docQ.data ? (
        <ReportDocument doc={docQ.data} />
      ) : null}
    </div>
  );
}
