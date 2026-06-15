import type {
  CampaignQuestionType,
  Overall,
  StoreReportStatus,
} from '@wally/types';

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
  /** Who took the most recent shot (name or email). */
  completedBy?: string | null;
}

// One extra-question answer in the report (the non-photo steps).
export interface ReportExtraAnswer {
  label: string;
  type: CampaignQuestionType;
  valueText?: string | null;
  valueBool?: boolean | null;
  isNA: boolean;
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
  // Store-report envelope (optional — present once a report exists / on submit).
  status?: StoreReportStatus;
  submittedAt?: Date | null;
  submittedByName?: string | null;
  totalScore?: number | null;
  aiSummary?: string | null;
  extraAnswers?: ReportExtraAnswer[];
}
