import type { Overall } from '@wally/types';

// The status a fixture can carry in a report: the four scored bands, plus the
// two non-scored states (not submitted / not applicable).
export type ReportFixtureStatus = Overall | 'not_submitted' | 'not_applicable';

// One flagged criterion on a fixture — a fail or an unsure, with its evidence.
export interface ReportFlag {
  criterionId: string;
  verdict: 'fail' | 'unsure';
  confidence: number;
  evidence: string;
}

export interface ReportFixture {
  fixtureKey: string;
  label: string;
  status: ReportFixtureStatus;
  confidence?: number;
  rubricVersion?: string;
  flags?: ReportFlag[];
}

// The whole payload the renderer turns into a PDF.
export interface ReportData {
  generatedAt: Date;
  store: {
    id: string;
    name: string;
    brand: string;
    externalRef: string | null;
  };
  campaign: { id: string; key: string; name: string };
  // Store-level band: the four scored bands plus "incomplete" (nothing scored).
  overall: Overall | 'incomplete';
  submitted: number;
  expected: number;
  fixtures: ReportFixture[];
  rubricVersions: string[];
}
