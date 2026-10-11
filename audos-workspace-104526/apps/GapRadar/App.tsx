import { useState, useMemo, useEffect, useRef, useCallback, ReactNode } from 'react';
import {
  ListChecks,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Clock,
  Lightbulb,
  Target,
  DollarSign,
  TrendingUp,
  Sparkles,
  Filter,
  X,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Lock,
  Info,
  RotateCcw,
  ClipboardList,
  Download,
  FileText,
  Eye,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
  Send,
  Megaphone,
  Bot,
  Briefcase,
  BellRing,
  Rocket,
  LayoutDashboard,
  FolderOpen,
  User,
  Building2,
  ShieldCheck,
  BarChart3,
  Pencil,
  ChevronRight,
} from 'lucide-react';
import { tw } from '../../lib/colors';
import StageDiagnostic from './StageDiagnostic';
import {
  QUESTIONS,
  TOTAL_QUESTIONS,
  CATEGORY_LABELS,
  computeCategoryScores,
  computeOverallScore,
  computeTopGaps,
  getOptionScore,
} from './questions';
import type { CategoryId, Severity, AnswerMap, TopGap } from './questions';
import {
  generatePackDocumentsAI,
  isCompletePackInput,
  validatePackDocuments,
} from './documents';
import type { PackDocument, PackInput } from './documents';

/* ============================================================================
 * Gap Radar — Funding Readiness assessment + gap tracker for FoundarOS
 *
 * PRIMARY ENTRY EXPERIENCE: a guided, conversational 30-question Funding
 * Readiness assessment (one question at a time, 4 categories). Results seed
 * the existing `funding_gaps` WorkspaceDB table so the gap board below keeps
 * working exactly as before.
 *
 * WorkspaceDB tables:
 *   funding_gaps          — title, category, severity, status, score_impact,
 *                           notes, assessment_ref (the existing gap board)
 *   assessment_sessions   — status, current_index, answers (json),
 *                           overall_score, category_scores (json),
 *                           top_gaps (json), completed_at
 *   onboarding_profiles   — paid founder's five-step onboarding answers
 *   readiness_snapshots   — paid founder's five-area readiness scores
 * ========================================================================== */

type GapStatus = 'open' | 'in_progress' | 'fixed';

interface FundingGap {
  id: number;
  title: string;
  category: CategoryId;
  severity: Severity;
  status: GapStatus;
  score_impact: number;
  notes?: string;
  assessment_ref?: string;
  created_at?: string;
}

interface AssessmentSessionRow {
  id: number;
  status: 'in_progress' | 'completed';
  current_index: number | null;
  answers: unknown;
  overall_score: number | null;
  category_scores: unknown;
  top_gaps: unknown;
  completed_at: string | null;
  created_at?: string;
}

interface ReadinessPackRow {
  id: number;
  stripe_session_id: string | null; // Flutterwave checkout reference (audos_chk_...)
  status: string | null;
  customer_email: string | null;
  amount_cents: number | null;
  overall_score: number | null;
  documents: unknown;
  generated_at: string | null;
  payment_provider?: string | null;
  payment_currency?: string | null;
  provider_tx_id?: string | null;
  paid_at?: string | null;
  created_at?: string;
}

interface PaymentNotice {
  state: 'verifying' | 'generating' | 'success' | 'error';
  message?: string;
}

type PaidScreen = 'payment-success' | 'onboarding' | 'snapshot' | 'dashboard' | 'documents' | 'profile' | 'gap-radar';

type YesNo = '' | 'Yes' | 'No';
type ProgressAnswer = '' | 'Yes' | 'No' | 'In progress';

interface OnboardingAnswers {
  full_name: string;
  country: string;
  linkedin_url: string;
  business_name: string;
  industry: string;
  business_stage: string;
  product_description: string;
  target_customer: string;
  problem_solved: string;
  registered_business: YesNo;
  pitch_deck_status: ProgressAnswer;
  financial_projections_status: ProgressAnswer;
  spoken_to_investors: YesNo;
  needs: string[];
}

interface OnboardingProfileRow extends Omit<OnboardingAnswers, 'needs'> {
  id: number;
  status: string;
  step_completed: number;
  needs: string[] | string | null;
  completed_at: string | null;
  created_at?: string;
  updated_at?: string;
}

interface ReadinessScores {
  business_clarity: number;
  legal_compliance: number;
  pitch_readiness: number;
  investor_readiness: number;
  financial_preparation: number;
  overall_score: number;
  recommendations: string[];
}

interface ReadinessSnapshotRow {
  id: number;
  business_clarity: number;
  legal_compliance: number;
  pitch_readiness: number;
  investor_readiness: number;
  financial_preparation: number;
  overall_score: number;
  recommendations: unknown;
  generated_at: string;
  created_at?: string;
}

interface PaymentConfirmation {
  reference: string;
  paidAt: string;
}

const EMPTY_ONBOARDING: OnboardingAnswers = {
  full_name: '',
  country: '',
  linkedin_url: '',
  business_name: '',
  industry: '',
  business_stage: '',
  product_description: '',
  target_customer: '',
  problem_solved: '',
  registered_business: '',
  pitch_deck_status: '',
  financial_projections_status: '',
  spoken_to_investors: '',
  needs: [],
};

const ONBOARDING_NEEDS = [
  'Understand what investors look for',
  'Build my pitch deck',
  'Create financial projections',
  'Develop my business plan',
  'Find the right investors',
  'Understand my funding readiness score',
];

function profileToAnswers(profile: OnboardingProfileRow | null): OnboardingAnswers {
  if (!profile) return { ...EMPTY_ONBOARDING, needs: [] };
  return {
    full_name: profile.full_name || '',
    country: profile.country || '',
    linkedin_url: profile.linkedin_url || '',
    business_name: profile.business_name || '',
    industry: profile.industry || '',
    business_stage: profile.business_stage || '',
    product_description: profile.product_description || '',
    target_customer: profile.target_customer || '',
    problem_solved: profile.problem_solved || '',
    registered_business: profile.registered_business || '',
    pitch_deck_status: profile.pitch_deck_status || '',
    financial_projections_status: profile.financial_projections_status || '',
    spoken_to_investors: profile.spoken_to_investors || '',
    needs: parseJsonField<string[]>(profile.needs, []),
  };
}

function computeReadinessSnapshot(profile: OnboardingAnswers): ReadinessScores {
  const clarityFields = [
    profile.business_name,
    profile.industry,
    profile.business_stage,
    profile.product_description,
    profile.target_customer,
    profile.problem_solved,
  ];
  const completedClarity = clarityFields.filter((value) => value.trim().length > 0).length;
  const businessClarity = Math.round(20 + (completedClarity / clarityFields.length) * 80);
  const legalCompliance = profile.registered_business === 'Yes' ? 100 : 25;
  const readinessValue = (value: ProgressAnswer) => (value === 'Yes' ? 100 : value === 'In progress' ? 60 : 20);
  const pitchReadiness = Math.round(
    (readinessValue(profile.pitch_deck_status) + readinessValue(profile.financial_projections_status)) / 2,
  );
  const investorReadiness = Math.min(
    100,
    (profile.spoken_to_investors === 'Yes' ? 80 : 35) +
      (profile.needs.includes('Understand my funding readiness score') ? 20 : 5),
  );
  const financialPreparation = readinessValue(profile.financial_projections_status);
  const areaScores = {
    business_clarity: businessClarity,
    legal_compliance: legalCompliance,
    pitch_readiness: pitchReadiness,
    investor_readiness: investorReadiness,
    financial_preparation: financialPreparation,
  };
  const recommendationsByArea: Record<keyof typeof areaScores, string> = {
    business_clarity: 'Sharpen your one-line value proposition, target customer, and problem statement before investor outreach.',
    legal_compliance: 'Register the business and organise core legal records so investors can complete due diligence confidently.',
    pitch_readiness: 'Turn your story and financial assumptions into a concise investor deck with evidence behind every claim.',
    investor_readiness: 'Start ten investor-learning conversations and build a focused list of investors aligned with your stage.',
    financial_preparation: 'Create a three-year financial model covering revenue, costs, runway, and the milestones this raise will fund.',
  };
  const lowestAreas = (Object.entries(areaScores) as Array<[keyof typeof areaScores, number]>)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3);
  return {
    ...areaScores,
    overall_score: Math.round(Object.values(areaScores).reduce((sum, score) => sum + score, 0) / 5),
    recommendations: lowestAreas.map(([area]) => recommendationsByArea[area]),
  };
}

function snapshotRowToScores(row: ReadinessSnapshotRow): ReadinessScores {
  return {
    business_clarity: row.business_clarity,
    legal_compliance: row.legal_compliance,
    pitch_readiness: row.pitch_readiness,
    investor_readiness: row.investor_readiness,
    financial_preparation: row.financial_preparation,
    overall_score: row.overall_score,
    recommendations: parseJsonField<string[]>(row.recommendations, []),
  };
}

interface DbTableApi {
  insert: (row: Record<string, unknown>) => Promise<unknown>;
  update: (id: number, row: Record<string, unknown>) => Promise<unknown>;
  delete: (id: number) => Promise<unknown>;
  orderBy: (column: string, direction: 'asc' | 'desc') => DbTableApi;
  limit: (n: number) => DbTableApi;
  get: () => Promise<{ data: Array<Record<string, unknown>>; total: number }>;
}

declare global {
  interface Window {
    useWorkspaceDB: <T = unknown>(
      table: string,
      options?: {
        shared?: boolean;
        limit?: number;
        offset?: number;
        orderBy?: { column: string; direction: 'asc' | 'desc' };
        filters?: Array<{ column: string; operator: string; value: unknown }>;
      },
    ) => {
      data: T[];
      loading: boolean;
      error: Error | null;
      total: number;
      refresh: () => void;
    };
    __workspaceDb: {
      from: (table: string, options?: { shared?: boolean }) => DbTableApi;
    };
  }
}

const CATEGORIES: {
  id: CategoryId;
  label: string;
  short: string;
  icon: typeof Lightbulb;
}[] = [
  { id: 'idea_clarity', label: 'Idea Clarity', short: 'Idea', icon: Lightbulb },
  { id: 'market_validation', label: 'Market Validation', short: 'Market', icon: Target },
  { id: 'financial_thinking', label: 'Financial Thinking', short: 'Finance', icon: DollarSign },
  { id: 'fundability', label: 'Fundability', short: 'Fund', icon: TrendingUp },
];

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SEVERITY_IMPACT: Record<Severity, number> = {
  critical: 12,
  high: 8,
  medium: 5,
  low: 3,
};

function categoryMeta(id: CategoryId) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const label =
    score >= 80 ? 'Investor-ready' : score >= 60 ? 'Getting close' : score >= 40 ? 'Building momentum' : 'Early stage';

  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--space-border-default)"
          strokeWidth={stroke}
          opacity={0.4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--space-brand-primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${tw.typography.color.brand}`}>{score}</span>
        <span className={`text-[10px] uppercase tracking-wider ${tw.typography.color.tertiary}`}>readiness</span>
      </div>
      <p className={`mt-2 text-xs font-medium ${tw.typography.color.secondary}`}>{label}</p>
    </div>
  );
}

/* ============================================================================
 * INTRO — warm entry screen shown before the first completed assessment
 * ========================================================================== */
function IntroScreen({
  onStart,
  onViewBoard,
  starting,
  hasExistingGaps,
}: {
  onStart: () => void;
  onViewBoard: () => void;
  starting: boolean;
  hasExistingGaps: boolean;
}) {
  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10">
      <div className={`${tw.card.elevated} border border-[var(--space-border-default)] max-w-md w-full p-6 sm:p-8 text-center`}>
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--space-surface-accent-soft)] flex items-center justify-center mb-4">
          <ClipboardList className={`w-7 h-7 ${tw.icon.primary}`} />
        </div>
        <h2 className={`text-xl sm:text-2xl font-bold ${tw.typography.color.brand} mb-2`}>
          Funding Readiness Assessment
        </h2>
        <p className={`text-sm ${tw.typography.color.secondary} leading-relaxed mb-1`}>
          This 5-minute assessment will show you exactly where your idea stands and what investors will ask.
          Let's get started.
        </p>
        <p className={`text-xs ${tw.typography.color.tertiary} mb-6`}>
          30 quick questions · 4 pillars · instant readiness score
        </p>
        <button
          onClick={onStart}
          disabled={starting}
          className={`w-full px-4 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ${tw.button.primary} disabled:opacity-50`}
          data-testid="button-start-assessment"
        >
          {starting ? (
            <div className="w-4 h-4 animate-spin rounded-full border-2 border-[var(--space-border-default)] border-t-[var(--space-text-on-primary)]" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          Start assessment
        </button>
        {hasExistingGaps && (
          <button
            onClick={onViewBoard}
            className={`mt-3 text-xs underline underline-offset-2 ${tw.typography.color.tertiary} hover:text-[var(--space-text-secondary)]`}
          >
            Skip for now — view my gap board
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * ASSESSMENT — one conversational question at a time with progress + back/next
 * ========================================================================== */
function AssessmentScreen({
  index,
  answers,
  onAnswer,
  onBack,
  onNext,
  saving,
}: {
  index: number;
  answers: AnswerMap;
  onAnswer: (questionId: string, value: string) => void;
  onBack: () => void;
  onNext: () => void;
  saving: boolean;
}) {
  const question = QUESTIONS[index];
  const cat = categoryMeta(question.category);
  const CatIcon = cat.icon;
  const answer = answers[question.id] ?? '';
  const isLast = index === TOTAL_QUESTIONS - 1;
  const progressPct = Math.round(((index + 1) / TOTAL_QUESTIONS) * 100);

  const canAdvance =
    question.type === 'choice' ? answer !== '' : true; // free-text questions can be skipped

  return (
    <div className="min-h-full flex flex-col px-4 py-5 sm:py-8">
      <div className="max-w-2xl w-full mx-auto flex-1 flex flex-col">
        {/* Progress */}
        <div className="mb-5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className={`text-xs font-medium ${tw.typography.color.secondary}`}>
              Question {index + 1} of {TOTAL_QUESTIONS} — {cat.label}
            </span>
            <span className={`text-xs ${tw.typography.color.tertiary}`}>{progressPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--space-border-default)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--space-brand-primary)] transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Question card */}
        <div className={`${tw.card.default} p-5 sm:p-6`}>
          <span className={`${tw.badge.default} ${tw.badge.primary} inline-flex items-center gap-1 mb-3`}>
            <CatIcon className="w-3 h-3" />
            {cat.label}
          </span>
          <h3 className={`text-lg sm:text-xl font-semibold ${tw.typography.color.primary} mb-2`}>
            {question.text}
          </h3>
          <p className={`flex items-start gap-1.5 text-xs ${tw.typography.color.tertiary} mb-5`}>
            <Info className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
            <span>{question.why}</span>
          </p>

          {question.type === 'choice' && question.options ? (
            <div className="space-y-2" role="radiogroup" aria-label={question.text}>
              {question.options.map((opt, i) => {
                const selected = answer === String(i);
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onAnswer(question.id, String(i))}
                    className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-all flex items-center gap-3 ${
                      selected
                        ? 'border-[var(--space-brand-primary)] bg-[var(--space-brand-primary-50)] text-[var(--space-text-brand)] font-medium shadow-sm'
                        : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] hover:border-[var(--space-brand-primary-200)] hover:bg-[var(--space-surface-card-hover)]'
                    }`}
                    data-testid={`option-${question.id}-${i}`}
                  >
                    <span
                      className={`w-4 h-4 shrink-0 rounded-full border flex items-center justify-center ${
                        selected
                          ? 'border-[var(--space-brand-primary)]'
                          : 'border-[var(--space-border-strong)]'
                      }`}
                    >
                      {selected && <span className="w-2 h-2 rounded-full bg-[var(--space-brand-primary)]" />}
                    </span>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea
              value={answer}
              onChange={(e) => onAnswer(question.id, e.target.value)}
              placeholder={question.placeholder}
              rows={4}
              autoFocus
              className={`${tw.input.base} ${tw.input.default} text-sm resize-none`}
              data-testid={`input-${question.id}`}
            />
          )}
        </div>

        {/* Back / Next */}
        <div className="flex items-center justify-between gap-3 mt-5">
          <button
            onClick={onBack}
            disabled={index === 0}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1.5 ${tw.button.ghost} disabled:opacity-30`}
            data-testid="button-assessment-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-3">
            {question.type === 'text' && answer.trim() === '' && (
              <span className={`text-[11px] ${tw.typography.color.muted}`}>Optional — you can skip</span>
            )}
            <button
              onClick={onNext}
              disabled={!canAdvance || saving}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tw.button.primary} disabled:opacity-40`}
              data-testid="button-assessment-next"
            >
              {isLast ? 'See my results' : 'Next'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * PAYWALL — one-time unlock on the results screen. LIVE payments.
 *
 * Flutterwave is the only checkout provider for every market and charges
 * exactly $99 USD.
 *
 * The charge is always $99 USD (`amount: 9900, currency: 'usd'`). Do NOT
 * remove the explicit `currency`: without it the platform falls back to the
 * workspace currency and charges the wrong amount/currency.
 *
 * Verification and ALL paid-state writes are server-side. The Flutterwave hook
 * verifies checkout and exclusively writes the protected columns on
 * `readiness_packs` (status, amount_cents, paid_at, provider_tx_id, and
 * payment_provider). Browser inserts are blocked; the app only writes the
 * non-protected documents, overall_score, and generated_at fields after a
 * verified payment. The Flutterwave hook also receives charge.completed
 * webhooks.
 *
 * ⚠️ LIVE keys — there is no test mode on this endpoint and test cards are
 * declined. The founder-only no-charge preview is disabled in production by
 * the PAYMENTS_LIVE flag below and never writes paid state to the database.
 * ========================================================================== */

/** LIVE/TEST PAYMENT FLAG: keep true in production. Set false only for a
 *  controlled founder preview of the no-charge document-generation flow. */
const PAYMENTS_LIVE = true;

const UNLOCK_PRICE_CENTS = 9900; // $99 one-time (corrected from the earlier $49 listing)
const UNLOCK_CURRENCY = 'usd';

// The Flutterwave hook owns ALL paid-state writes on readiness_packs.
const FLUTTERWAVE_PAYMENT_HOOK_URL = '/api/workspaces/104526/hooks/flutterwave-payment/execute';

/** Founder-only no-charge preview. PAYMENTS_LIVE overrides this off in production.
 *  When payments are not live, studio (entrepreneur) mode or founder_test=1
 *  enables a preview button for the post-payment flow (document generation →
 *  download UI) can be tested without charging a card. The simulated purchase
 *  row is scoped to the current visitor session only, so it never unlocks
 *  documents for real customers.
 *
 *  Detection is deliberately forgiving because the app rewrites its own URL
 *  (hash + query cleanup) and may run inside the studio preview iframe:
 *  - matches the flag anywhere in the href, including after the #hash
 *    (e.g. …/site/104526#gap-radar?founder_test=1 works too);
 *  - also checks the parent frame's URL when same-origin (studio preview);
 *  - remembers the flag in sessionStorage for the rest of the tab session,
 *    so later in-app URL rewrites don't turn it off. */
const FOUNDER_TEST_PATTERN = /[?&#]founder_test=1/;

function founderFlagInUrls(): boolean {
  try {
    if (FOUNDER_TEST_PATTERN.test(window.location.href)) return true;
  } catch {
    /* ignore */
  }
  try {
    if (window.top && window.top !== window && FOUNDER_TEST_PATTERN.test(window.top.location.href)) {
      return true;
    }
  } catch {
    /* cross-origin iframe — can't read parent URL */
  }
  return false;
}

// Captured at bundle load, before any component can rewrite the URL.
const FOUNDER_TEST_AT_LOAD = founderFlagInUrls();

function isFounderTestMode(): boolean {
  if (PAYMENTS_LIVE) return false;

  try {
    const w = window as Window & { __SPACE_MODE__?: string };
    if (w.__SPACE_MODE__ === 'entrepreneur') return true;
    if (FOUNDER_TEST_AT_LOAD || founderFlagInUrls()) {
      try {
        sessionStorage.setItem('founder_test_mode', '1');
      } catch {
        /* ignore */
      }
      return true;
    }
    return sessionStorage.getItem('founder_test_mode') === '1';
  } catch {
    return false;
  }
}

function redirectToCheckout(url: string) {
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = url;
      return;
    }
  } catch {
    /* cross-origin iframe — fall through */
  }
  window.location.href = url;
}

function getSessionEmail(): string | null {
  try {
    const w = window as Window & { __SPACE_ID__?: string };
    const spaceId = w.__SPACE_ID__ || '';
    const stored = localStorage.getItem(`space_session_${spaceId}`);
    if (!stored) return null;
    return JSON.parse(stored).email || null;
  } catch {
    return null;
  }
}

/** The visitor's workspace session id (same recovery order as
 *  SpaceRuntimeContext), forwarded to the payment hook as X-Session-Id so the
 *  platform can validate it and stamp row ownership server-side. */
function getSessionId(): string | null {
  try {
    const w = window as Window & { __SPACE_ID__?: string };
    const spaceId = w.__SPACE_ID__ || '';
    const stored = localStorage.getItem(`space_session_${spaceId}`);
    if (stored) {
      const session = JSON.parse(stored);
      const recovered = session.workspaceSessionId || session.sessionId || session.id;
      if (recovered) return String(recovered);
    }
    return sessionStorage.getItem('space_session_id');
  } catch {
    return null;
  }
}

/** POST to the Flutterwave hook, forwarding the visitor session so
 *  server-side row ownership and the shared paid-tier entitlement work. */
async function callPaymentHook(payload: Record<string, unknown>): Promise<{
  httpOk: boolean;
  ok?: boolean;
  code?: string;
  packId?: number | null;
}> {
  const sessionId = getSessionId();
  const res = await fetch(FLUTTERWAVE_PAYMENT_HOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    code?: string;
    packId?: number | null;
  } | null;
  return { httpOk: res.ok, ...(data || {}) };
}

function PaywallCard({
  onSimulateTestPurchase,
  simulating,
}: {
  onSimulateTestPurchase: () => void;
  simulating: boolean;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const busy = state === 'loading';

  const handleUnlock = async () => {
    setState('loading');
    setErrorMessage(null);
    try {
      const w = window as Window & { __APP_ID__?: string; __SPACE_ID__?: string };
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Id': w.__APP_ID__ || w.__SPACE_ID__ || '',
        },
        body: JSON.stringify({
          amount: UNLOCK_PRICE_CENTS,
          // Explicit USD is REQUIRED: without it the platform charges in the
          // workspace currency and uses the wrong currency for this $99 pack.
          currency: UNLOCK_CURRENCY,
          productName: 'FoundarOS Funding Readiness Pack',
          productDescription:
            'Your personalized founder documents, ongoing gap tracker, editable pitch materials, and AI Pitch Coach',
          customerEmail: getSessionEmail() || undefined,
          successUrl:
            window.location.origin +
            window.location.pathname +
            '?payment_success=true&session_id={CHECKOUT_SESSION_ID}&payment_provider=flutterwave' +
            (window.location.hash || '#gap-radar'),
          cancelUrl: window.location.href,
          metadata: { product: 'gap-radar-readiness-pack' },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.checkoutUrl) {
        throw new Error(data?.error || 'Flutterwave checkout is unavailable.');
      }

      if (data.sessionId) {
        try {
          await callPaymentHook({
            action: 'begin',
            sessionId: data.sessionId,
            provider: 'flutterwave',
            email: getSessionEmail() || undefined,
          });
        } catch {
          /* non-blocking: confirm can create the row after payment */
        }
      }
      redirectToCheckout(data.checkoutUrl);
    } catch (error) {
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Flutterwave checkout is unavailable. Please try again.');
    }
  };

  return (
    <div
      className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5 sm:p-6`}
      data-testid="card-paywall"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--space-surface-accent-soft)] flex items-center justify-center">
          <Lock className={`w-5 h-5 ${tw.icon.accent}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h4 className={`text-base font-semibold ${tw.typography.color.primary}`}>
              Turn your diagnosis into a funder-ready action pack
            </h4>
            <span className={`${tw.badge.default} ${tw.badge.warning} text-xs font-bold`} data-testid="text-unlock-price">
              $99 one-time
            </span>
          </div>
          <p className={`text-sm ${tw.typography.color.secondary} mb-4`}>
            Put your evidence roadmap to work with editable funding documents, ongoing gap tracking, and pitch feedback.
          </p>
          <button
            onClick={handleUnlock}
            disabled={busy}
            className={`w-full px-5 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ${tw.button.accent} disabled:opacity-50`}
            data-testid="button-unlock-flutterwave"
          >
            {busy ? (
              <div className="w-4 h-4 animate-spin rounded-full border-2 border-[var(--space-border-default)] border-t-[var(--space-text-on-highlight)]" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            {busy ? 'Opening secure checkout…' : 'Unlock my Funding Readiness Pack — $99'}
          </button>
          <p className={`mt-3 text-xs ${tw.typography.color.tertiary}`}>
            Also includes your personalized Business Plan, editable Pitch Deck, Financial Model, Grant Application Assistant, and AI Pitch Coach.
          </p>
          <p className={`mt-1.5 text-[11px] ${tw.typography.color.muted}`} data-testid="text-processor-caption">
            Secure Flutterwave checkout · $99 USD · unlocks only after verified payment
          </p>
          {errorMessage && (
            <p className={`mt-2 text-xs ${tw.typography.color.secondary}`} role="alert">
              {errorMessage}
            </p>
          )}

          {isFounderTestMode() && (
            <div className="mt-3" data-testid="section-founder-test">
              <button
                onClick={onSimulateTestPurchase}
                disabled={simulating}
                className={`w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-semibold ${tw.button.secondary} disabled:opacity-50`}
                data-testid="button-founder-test-unlock"
              >
                {simulating
                  ? 'Generating preview documents…'
                  : 'Founder preview: generate documents (no charge)'}
              </button>
              <p className={`mt-2 text-xs ${tw.typography.color.tertiary}`}>
                This founder-only preview skips checkout and exercises document generation
                and downloads without charging a card.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * PAYMENT NOTICE — banner shown while a returning payment is verified and the
 * documents are generated (or when something needs the founder's attention).
 * ========================================================================== */
function PaymentNoticeBanner({ notice, onDismiss }: { notice: PaymentNotice; onDismiss: () => void }) {
  const busy = notice.state === 'verifying' || notice.state === 'generating';
  return (
    <div className="px-4 sm:px-5 pt-4">
      <div
        className={`max-w-3xl mx-auto flex items-start gap-3 p-3.5 rounded-lg border ${
          notice.state === 'error'
            ? 'border-[var(--space-semantic-danger)] bg-[var(--space-semantic-danger-100)]'
            : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)]'
        }`}
        data-testid="banner-payment-status"
      >
        {busy ? (
          <div className="w-4 h-4 mt-0.5 shrink-0 animate-spin rounded-full border-2 border-[var(--space-border-default)] border-t-[var(--space-brand-primary)]" />
        ) : notice.state === 'success' ? (
          <CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${tw.icon.success}`} />
        ) : (
          <AlertCircle className={`w-4 h-4 mt-0.5 shrink-0 ${tw.icon.danger}`} />
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${tw.typography.color.primary}`}>
            {notice.state === 'verifying' && 'Verifying your payment…'}
            {notice.state === 'generating' &&
              'Payment confirmed — writing your personalized documents (this can take up to a minute)…'}
            {notice.state === 'success' && 'Your Funding Readiness Pack is ready!'}
            {notice.state === 'error' && 'Payment verification issue'}
          </p>
          {notice.state === 'success' && (
            <p className={`text-xs ${tw.typography.color.tertiary}`}>
              Scroll to “Your Documents” below to view and download all five documents — Business Plan, Pitch Deck, Financial Model, Grant Application, and Action Plan — and try the AI Pitch Coach.
            </p>
          )}
          {notice.message && <p className={`text-xs ${tw.typography.color.secondary}`}>{notice.message}</p>}
        </div>
        {!busy && (
          <button
            onClick={onDismiss}
            className={`p-1 rounded-md shrink-0 ${tw.button.ghost}`}
            aria-label="Dismiss"
            data-testid="button-dismiss-payment-notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * YOUR DOCUMENTS — post-payment deliverables. Shown in place of the paywall
 * once a verified purchase exists: view each document inline or download it.
 *
 * Business Plan, Grant Application, and Action Plan are plain narrative
 * markdown -> converted to real .docx via the `docx` library. Financial
 * Model is markdown with embedded tables -> converted to a real .xlsx via
 * `xlsx` (SheetJS), one sheet per table plus an Overview sheet for the
 * surrounding guidance text. Pitch Deck stays a hand-built .pptx (unchanged
 * below).
 * ========================================================================== */

/** Strip markdown emphasis markers down to plain text (used inside table cells). */
function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}

/** Split a run of inline markdown (**bold**, _italic_, `code`) into docx TextRuns. */
function inlineMarkdownToRuns(docxLib: any, text: string) {
  const { TextRun } = docxLib;
  const runs: any[] = [];
  const regex = /(\*\*(.+?)\*\*|(?<!\w)_(.+?)_(?!\w)|`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) runs.push(new TextRun(text.slice(lastIndex, match.index)));
    if (match[2] !== undefined) runs.push(new TextRun({ text: match[2], bold: true }));
    else if (match[3] !== undefined) runs.push(new TextRun({ text: match[3], italics: true }));
    else if (match[4] !== undefined) runs.push(new TextRun({ text: match[4], font: 'Consolas' }));
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) runs.push(new TextRun(text.slice(lastIndex)));
  return runs.length ? runs : [new TextRun(text)];
}

const MD_TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].trim().startsWith('|') && !!lines[i + 1] && MD_TABLE_SEPARATOR.test(lines[i + 1]);
}

function readTableBlock(lines: string[], start: number): { rows: string[][]; next: number } {
  let j = start;
  const raw: string[] = [];
  while (j < lines.length && lines[j].trim().startsWith('|')) {
    raw.push(lines[j]);
    j++;
  }
  const rows = raw
    .filter((_, idx) => idx !== 1) // drop the |---|---| separator row
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  return { rows, next: j };
}

/** Convert a full markdown document into an array of `docx` section children. */
function markdownToDocxChildren(docxLib: any, markdown: string) {
  const { Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, TextRun } = docxLib;
  const lines = markdown.split('\n');
  const children: any[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const { rows, next } = readTableBlock(lines, i);
      i = next;
      if (rows.length === 0) continue;
      const colCount = rows[0].length;
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (cells, rowIdx) =>
              new TableRow({
                children: Array.from({ length: colCount }, (_, c) => cells[c] ?? '').map(
                  (cellText) =>
                    new TableCell({
                      width: { size: 100 / colCount, type: WidthType.PERCENTAGE },
                      shading: rowIdx === 0 ? { fill: '7C3AED' } : undefined,
                      margins: { top: 80, bottom: 80, left: 100, right: 100 },
                      children: [
                        new Paragraph({
                          children:
                            rowIdx === 0
                              ? [new TextRun({ text: stripMarkdownEmphasis(cellText), bold: true, color: 'FFFFFF' })]
                              : inlineMarkdownToRuns(docxLib, cellText),
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
      children.push(new Paragraph({ text: '', spacing: { after: 150 } }));
      continue;
    }

    if (trimmed.startsWith('# ')) {
      children.push(
        new Paragraph({ text: trimmed.slice(2), heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      children.push(
        new Paragraph({ text: trimmed.slice(3), heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } }),
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      children.push(
        new Paragraph({ text: trimmed.slice(4), heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 110 } }),
      );
      i++;
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      children.push(
        new Paragraph({
          text: '',
          border: { bottom: { color: 'CCCCCC', space: 1, style: BorderStyle.SINGLE, size: 6 } },
          spacing: { after: 200 },
        }),
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      children.push(
        new Paragraph({
          children: inlineMarkdownToRuns(docxLib, trimmed.replace(/^>\s?/, '')),
          indent: { left: 400 },
          border: { left: { color: '7C3AED', space: 8, style: BorderStyle.SINGLE, size: 18 } },
          spacing: { after: 150 },
        }),
      );
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      children.push(
        new Paragraph({
          children: inlineMarkdownToRuns(docxLib, trimmed.replace(/^[-*]\s+/, '')),
          bullet: { level: 0 },
          spacing: { after: 90 },
        }),
      );
      i++;
      continue;
    }

    const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numbered) {
      children.push(
        new Paragraph({
          children: [new TextRun(`${numbered[1]}. `), ...inlineMarkdownToRuns(docxLib, numbered[2])],
          indent: { left: 300 },
          spacing: { after: 90 },
        }),
      );
      i++;
      continue;
    }

    children.push(
      new Paragraph({ children: inlineMarkdownToRuns(docxLib, trimmed), spacing: { after: 150 } }),
    );
    i++;
  }

  return children;
}

async function buildDocxBlob(markdown: string, title: string): Promise<Blob> {
  const docxLib: any = await import('docx');
  const { Document, Packer } = docxLib;
  const doc = new Document({
    creator: 'FoundarOS',
    title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ properties: {}, children: markdownToDocxChildren(docxLib, markdown) }],
  });
  return Packer.toBlob(doc);
}

/** Convert a table cell to a real number when it plainly is one (keeps $/%, strips for math, keeps placeholders like "_[fill in]_" as text). */
function xlsxCellValue(rawText: string): string | number {
  const text = stripMarkdownEmphasis(rawText);
  if (/\[.*\]/.test(text)) return text; // unresolved placeholder — leave editable as text
  const stripped = text.replace(/^\$/, '').replace(/%$/, '').replace(/,/g, '').trim();
  if (stripped !== '' && /^-?\d+(\.\d+)?$/.test(stripped)) return Number(stripped);
  return text;
}

async function buildXlsxBlob(markdown: string, workbookTitle: string): Promise<Blob> {
  const XLSX: any = await import('xlsx');
  const lines = markdown.split('\n');
  const wb = XLSX.utils.book_new();
  const overviewRows: (string | number)[][] = [[workbookTitle], ['']];
  let lastHeading = 'Notes';
  const usedSheetNames = new Set<string>();

  const registerSheetName = (base: string): string => {
    const safeBase = base.replace(/[\\/?*[\]:]/g, '').trim().slice(0, 28) || 'Sheet';
    let candidate = safeBase;
    let n = 2;
    while (usedSheetNames.has(candidate.toLowerCase())) {
      candidate = `${safeBase.slice(0, 24)} (${n})`;
      n++;
    }
    usedSheetNames.add(candidate.toLowerCase());
    return candidate;
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      lastHeading = stripMarkdownEmphasis(trimmed.replace(/^#{1,3}\s+/, ''));
      overviewRows.push([lastHeading]);
      i++;
      continue;
    }

    const boldSubheading = trimmed.match(/^\*\*(.+?):\*\*$/);
    if (boldSubheading) {
      lastHeading = stripMarkdownEmphasis(boldSubheading[1]);
      overviewRows.push([lastHeading]);
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const { rows, next } = readTableBlock(lines, i);
      i = next;
      if (rows.length === 0) continue;
      const aoa = rows.map((row, rowIdx) =>
        row.map((cell) => (rowIdx === 0 ? stripMarkdownEmphasis(cell) : xlsxCellValue(cell))),
      );
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = (rows[0] ?? []).map(() => ({ wch: 26 }));
      const sheetName = registerSheetName(lastHeading);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      overviewRows.push([`↳ Full table on the "${sheetName}" sheet`], ['']);
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      i++;
      continue;
    }

    const cleaned = stripMarkdownEmphasis(
      trimmed.replace(/^>\s?/, '').replace(/^[-*]\s+/, '• ').replace(/^(\d+)\.\s+/, '$1. '),
    );
    overviewRows.push([cleaned]);
    i++;
  }

  const overviewWs = XLSX.utils.aoa_to_sheet(overviewRows);
  overviewWs['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, overviewWs, 'Overview');
  const overviewIdx = wb.SheetNames.indexOf('Overview');
  if (overviewIdx > 0) {
    wb.SheetNames.splice(overviewIdx, 1);
    wb.SheetNames.unshift('Overview');
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** The stored `doc.filename` can be stale for packs generated before this
 * format change (older packs were saved with a .md name). Always derive the
 * real extension from the stable `doc.id` instead of trusting that string. */
function resolvedFilename(doc: PackDocument): string {
  const base = doc.filename.replace(/\.[a-zA-Z0-9]+$/, '');
  if (doc.id === 'pitch-deck') return `${base}.pptx`;
  if (doc.id === 'financial-model') return `${base}.xlsx`;
  return `${base}.docx`;
}

function downloadDocument(doc: PackDocument) {
  if (doc.id === 'pitch-deck') {
    void (async () => {
      try {
        const pptxModule = await import('pptxgenjs');
        const PptxGenJS = pptxModule.default;
        const pptx: any = new PptxGenJS();
        pptx.layout = 'LAYOUT_WIDE';
        pptx.author = 'FoundarOS';
        pptx.company = 'FoundarOS';
        pptx.subject = 'Editable investor pitch deck';
        pptx.title = 'FoundarOS Investor Pitch Deck';
        pptx.lang = 'en-US';

        const rootStyles = getComputedStyle(document.documentElement);
        const themeHex = (token: string, fallback: string) =>
          (rootStyles.getPropertyValue(token).trim() || fallback).replace('#', '').toUpperCase();
        const primary = themeHex('--space-brand-primary', '0284C7');
        const highlight = themeHex('--space-brand-highlight', 'FF6B6B');
        const contrast = themeHex('--space-brand-contrast', '2DD4BF');
        const ink = themeHex('--space-text-primary', '012538');
        const muted = themeHex('--space-text-secondary', '01476B');
        const pale = themeHex('--space-surface-page', 'F2F9FC');
        const shapeType = pptx.ShapeType;

        const slideHeading = /^## Slide (\d+) [—-] (.+)$/gm;
        const matches = [...doc.content.matchAll(slideHeading)];
        if (matches.length !== 8) throw new Error('pitch_deck_slide_count');

        const clean = (value: string) =>
          value
            .replace(/^#{1,6}\s*/, '')
            .replace(/^[-*]\s+/, '• ')
            .replace(/^>\s*/, '')
            .replace(/\*\*/g, '')
            .replace(/^_+|_+$/g, '')
            .replace(/`/g, '')
            .trim();

        matches.forEach((match, index) => {
          const sectionStart = (match.index ?? 0) + match[0].length;
          const sectionEnd = index + 1 < matches.length ? matches[index + 1].index ?? doc.content.length : doc.content.length;
          const section = doc.content.slice(sectionStart, sectionEnd);
          const onSlideStart = section.indexOf('**On the slide:**');
          const speakerStart = section.indexOf('**Speaker notes:**');
          const designStart = section.indexOf('**Design notes:**');
          const onSlide = section.slice(onSlideStart + '**On the slide:**'.length, speakerStart);
          const speakerNotes = clean(
            section.slice(
              speakerStart + '**Speaker notes:**'.length,
              designStart > speakerStart ? designStart : section.length,
            ),
          );
          const rawLines = onSlide
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => !line.toUpperCase().includes('LOGO PLACEHOLDER'));
          const lines = rawLines.map(clean).filter(Boolean);
          const slide = pptx.addSlide();
          slide.background = { color: index === 0 ? primary : 'FFFFFF' };

          if (index === 0) {
            const companyName = clean(rawLines.find((line) => /^#\s/.test(line)) || lines[0] || 'Your Company');
            const tagline = clean(rawLines.find((line) => /^###\s/.test(line)) || lines[1] || 'Your investor-ready one-liner');
            const contact = lines.find((line) => line.includes('[Your name]')) || '[Your name] · [Title] · [Email] · [Date]';
            slide.addShape(shapeType.roundRect, {
              x: 5.35,
              y: 0.75,
              w: 2.65,
              h: 1.25,
              rectRadius: 0.08,
              fill: { color: 'FFFFFF', transparency: 92 },
              line: { color: contrast, width: 1.5, dash: 'dash' },
            });
            slide.addText('INSERT LOGO', {
              x: 5.35,
              y: 1.15,
              w: 2.65,
              h: 0.35,
              fontFace: 'DM Sans',
              fontSize: 15,
              bold: true,
              color: 'FFFFFF',
              align: 'center',
              margin: 0,
            });
            slide.addText(companyName, {
              x: 0.8,
              y: 2.35,
              w: 11.7,
              h: 0.85,
              fontFace: 'DM Sans',
              fontSize: 34,
              bold: true,
              color: 'FFFFFF',
              align: 'center',
              margin: 0,
              breakLine: false,
              fit: 'shrink',
            });
            slide.addText(tagline, {
              x: 1.5,
              y: 3.4,
              w: 10.3,
              h: 0.8,
              fontFace: 'DM Sans',
              fontSize: 21,
              color: 'FFFFFF',
              align: 'center',
              margin: 0,
              fit: 'shrink',
            });
            slide.addShape(shapeType.line, {
              x: 4.85,
              y: 4.55,
              w: 3.65,
              h: 0,
              line: { color: highlight, width: 4 },
            });
            slide.addText(contact, {
              x: 1.2,
              y: 5.15,
              w: 10.9,
              h: 0.4,
              fontFace: 'DM Sans',
              fontSize: 13,
              color: 'FFFFFF',
              align: 'center',
              margin: 0,
            });
          } else {
            slide.addShape(shapeType.rect, {
              x: 0,
              y: 0,
              w: 0.18,
              h: 7.5,
              fill: { color: index % 2 === 0 ? contrast : highlight },
              line: { color: index % 2 === 0 ? contrast : highlight },
            });
            slide.addShape(shapeType.rect, {
              x: 0.18,
              y: 0,
              w: 13.15,
              h: 0.18,
              fill: { color: primary },
              line: { color: primary },
            });
            slide.addText(match[2], {
              x: 0.75,
              y: 0.65,
              w: 11.5,
              h: 0.6,
              fontFace: 'DM Sans',
              fontSize: 27,
              bold: true,
              color: ink,
              margin: 0,
              fit: 'shrink',
            });
            slide.addShape(shapeType.line, {
              x: 0.75,
              y: 1.38,
              w: 1.15,
              h: 0,
              line: { color: index % 2 === 0 ? contrast : highlight, width: 4 },
            });
            const usableLines = lines.slice(0, 9);
            const rowHeight = Math.min(0.68, 4.95 / Math.max(usableLines.length, 1));
            usableLines.forEach((line, lineIndex) => {
              const isBullet = line.startsWith('• ');
              const text = isBullet ? line.slice(2) : line;
              slide.addText(text, {
                x: isBullet ? 1.05 : 0.85,
                y: 1.75 + lineIndex * rowHeight,
                w: isBullet ? 11.1 : 11.45,
                h: Math.max(0.42, rowHeight - 0.06),
                fontFace: 'DM Sans',
                fontSize: lineIndex === 0 && !isBullet ? 20 : 15,
                bold: lineIndex === 0 && !isBullet,
                color: lineIndex === 0 && !isBullet ? primary : ink,
                bullet: isBullet ? { indent: 18 } : undefined,
                margin: 0,
                breakLine: false,
                fit: 'shrink',
                valign: 'mid',
              });
            });
            slide.addShape(shapeType.roundRect, {
              x: 9.65,
              y: 6.52,
              w: 2.75,
              h: 0.36,
              fill: { color: pale },
              line: { color: contrast, transparency: 45 },
            });
            slide.addText('EDITABLE · ADD YOUR EVIDENCE', {
              x: 9.65,
              y: 6.61,
              w: 2.75,
              h: 0.14,
              fontFace: 'DM Sans',
              fontSize: 8,
              bold: true,
              color: muted,
              align: 'center',
              margin: 0,
            });
          }

          slide.addText(`${index + 1} / 8`, {
            x: 11.85,
            y: 7.05,
            w: 0.65,
            h: 0.18,
            fontFace: 'DM Sans',
            fontSize: 8,
            color: index === 0 ? 'FFFFFF' : muted,
            align: 'right',
            margin: 0,
          });
          if (speakerNotes) slide.addNotes(speakerNotes);
        });

        await pptx.writeFile({ fileName: resolvedFilename(doc) });
      } catch (error) {
        console.error('Could not build editable PowerPoint deck', error);
        const fallback = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' });
        const fallbackUrl = URL.createObjectURL(fallback);
        const fallbackLink = document.createElement('a');
        fallbackLink.href = fallbackUrl;
        fallbackLink.download = 'foundaros-pitch-deck-outline.md';
        document.body.appendChild(fallbackLink);
        fallbackLink.click();
        fallbackLink.remove();
        setTimeout(() => URL.revokeObjectURL(fallbackUrl), 1000);
        window.alert('The editable PowerPoint could not be built in this browser, so the slide outline was downloaded instead.');
      }
    })();
    return;
  }

  void (async () => {
    try {
      const isXlsx = doc.id === 'financial-model';
      const blob = isXlsx
        ? await buildXlsxBlob(doc.content, doc.title)
        : await buildDocxBlob(doc.content, doc.title);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resolvedFilename(doc);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error(`Could not build ${doc.filename}`, error);
      const fallbackName = doc.filename.replace(/\.[a-zA-Z0-9]+$/, '.md');
      const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.alert(`The ${formatLabelForFilename(doc)} file could not be built in this browser, so a markdown version was downloaded instead.`);
    }
  })();
}

function formatLabelForFilename(doc: PackDocument): string {
  return doc.id === 'financial-model' ? 'Excel' : 'Word';
}

function DocumentsSection({
  documents,
  generatedAt,
  onRebuild,
  rebuilding,
}: {
  documents: PackDocument[];
  generatedAt: string | null;
  onRebuild: () => void;
  rebuilding: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyDocument = async (doc: PackDocument) => {
    try {
      await navigator.clipboard.writeText(doc.content);
      setCopiedId(doc.id);
      setTimeout(() => setCopiedId((prev) => (prev === doc.id ? null : prev)), 2000);
    } catch {
      /* clipboard unavailable — the download button still works */
    }
  };

  return (
    <div
      className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5 sm:p-6`}
      data-testid="section-your-documents"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--space-semantic-success-100)] flex items-center justify-center">
          <CheckCircle2 className={`w-5 h-5 ${tw.icon.success}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`text-base font-semibold ${tw.typography.color.primary}`}>Your Documents</h4>
          <p className={`text-xs ${tw.typography.color.tertiary}`}>
            Funding Readiness Pack unlocked
            {generatedAt ? ` · generated ${new Date(generatedAt).toLocaleDateString()}` : ''}. View each
            document here or download it to keep and edit.
          </p>
        </div>
      </div>

      {documents.length === 0 ? (
        <div className={`${tw.card.flat} p-4`}>
          <p className={`text-sm font-medium ${tw.typography.color.primary} mb-1`}>Documents not generated yet</p>
          <p className={`text-xs ${tw.typography.color.tertiary} mb-3`}>
            Your purchase is confirmed. Rebuild the pack from your latest assessment results to generate them now.
          </p>
          <button
            onClick={onRebuild}
            disabled={rebuilding}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${tw.button.primary} disabled:opacity-50`}
            data-testid="button-generate-pack"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${rebuilding ? 'animate-spin' : ''}`} />
            {rebuilding ? 'Generating…' : 'Generate my documents'}
          </button>
        </div>
      ) : (
        <>
          {documents.length < 5 && (
            <div className={`${tw.card.flat} p-3 mb-3`} data-testid="banner-new-deliverables">
              <p className={`text-xs ${tw.typography.color.secondary}`}>
                <span className={`font-semibold ${tw.typography.color.primary}`}>Your pack just got bigger — at no extra cost.</span>{' '}
                Hit “Rebuild documents” below to add the new Financial Model, Grant Application
                Assistant, and the upgraded slide-by-slide Pitch Deck to your pack.
              </p>
            </div>
          )}
          <ul className="space-y-2.5">
            {documents.map((doc) => (
              <li key={doc.id} className={`${tw.card.default} overflow-hidden`} data-testid={`row-document-${doc.id}`}>
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <div className="w-9 h-9 shrink-0 rounded-lg bg-[var(--space-surface-accent-soft)] flex items-center justify-center">
                    <FileText className={`w-4 h-4 ${tw.icon.primary}`} />
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>{doc.title}</p>
                    <p className={`text-xs ${tw.typography.color.tertiary}`}>{doc.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setOpenId(openId === doc.id ? null : doc.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${tw.button.secondary}`}
                      data-testid={`button-view-${doc.id}`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {openId === doc.id ? 'Hide' : 'View'}
                    </button>
                    <button
                      onClick={() => copyDocument(doc)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${tw.button.secondary}`}
                      data-testid={`button-copy-${doc.id}`}
                    >
                      {copiedId === doc.id ? (
                        <Check className={`w-3.5 h-3.5 ${tw.icon.success}`} />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copiedId === doc.id ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      onClick={() => downloadDocument(doc)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${tw.button.primary}`}
                      data-testid={`button-download-${doc.id}`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                  </div>
                </div>
                {openId === doc.id && (
                  <div className="border-t border-[var(--space-border-default)] bg-[var(--space-surface-muted)] max-h-96 overflow-y-auto">
                    <pre
                      className={`p-4 text-xs leading-relaxed whitespace-pre-wrap ${tw.typography.color.secondary}`}
                      style={{ fontFamily: 'var(--space-font-family, system-ui, sans-serif)' }}
                    >
                      {doc.content}
                    </pre>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
            <p className={`text-[11px] ${tw.typography.color.muted}`}>
              Retook the assessment? Rebuild the pack from your latest results.
            </p>
            <button
              onClick={onRebuild}
              disabled={rebuilding}
              className={`shrink-0 text-xs font-medium flex items-center gap-1 underline underline-offset-2 ${tw.typography.color.tertiary} hover:text-[var(--space-text-secondary)] disabled:opacity-50`}
              data-testid="button-rebuild-pack"
            >
              <RefreshCw className={`w-3 h-3 ${rebuilding ? 'animate-spin' : ''}`} />
              {rebuilding ? 'Rebuilding…' : 'Rebuild documents'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================================
 * PAID FOUNDER EXPERIENCE — confirmation, onboarding, snapshot and journey
 * ========================================================================== */

function PaidNavigation({ active, onNavigate }: { active: PaidScreen; onNavigate: (screen: PaidScreen) => void }) {
  const items: Array<{ id: PaidScreen; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'documents', label: 'Documents', icon: FolderOpen },
    { id: 'profile', label: 'Profile', icon: User },
  ];
  return (
    <nav className="sticky top-0 z-20 border-b border-[var(--space-border-default)] bg-[var(--space-surface-card)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <button onClick={() => onNavigate('dashboard')} className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[var(--space-brand-primary)] flex items-center justify-center">
            <Rocket className="w-4 h-4 text-[var(--space-text-on-highlight)]" />
          </div>
          <div className="text-left hidden sm:block">
            <p className={`text-sm font-bold ${tw.typography.color.primary}`}>FoundarOS</p>
            <p className={`text-[10px] ${tw.typography.color.tertiary}`}>Fundraising Readiness</p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            const selected = active === item.id || (item.id === 'dashboard' && active === 'snapshot');
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors ${
                  selected ? tw.button.primary : tw.button.ghost
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function PaidPage({ active, onNavigate, children }: { active: PaidScreen; onNavigate: (screen: PaidScreen) => void; children: ReactNode }) {
  return (
    <div className="min-h-full w-full bg-transparent overflow-y-auto">
      <PaidNavigation active={active} onNavigate={onNavigate} />
      {children}
    </div>
  );
}

function PaymentSuccessScreen({ confirmation, onStart }: { confirmation: PaymentConfirmation; onStart: () => void }) {
  const nextSteps = [
    'Complete your 5-step onboarding to personalise your plan',
    'Get your Founder Readiness Snapshot',
    'Access your 7-step fundraising journey',
  ];
  return (
    <div className="min-h-full w-full bg-transparent overflow-y-auto px-4 py-10 sm:py-16">
      <div className="max-w-2xl mx-auto">
        <div className={`${tw.card.elevated} border border-[var(--space-border-default)] p-6 sm:p-9 text-center`} data-testid="screen-payment-confirmed">
          <div className="w-16 h-16 mx-auto rounded-full bg-[var(--space-semantic-success-100)] flex items-center justify-center mb-5">
            <CheckCircle2 className={`w-9 h-9 ${tw.icon.success}`} />
          </div>
          <h1 className={`text-2xl sm:text-3xl font-bold ${tw.typography.color.primary}`}>
            Payment Confirmed — Welcome to FoundarOS Fundraising Readiness
          </h1>
          <p className={`mt-3 text-sm ${tw.typography.color.secondary}`}>
            Your secure $99 purchase is verified. Let’s personalise your fundraising plan.
          </p>
          <dl className={`${tw.card.flat} mt-7 p-4 text-left grid sm:grid-cols-2 gap-4`}>
            <div>
              <dt className={`text-[11px] uppercase tracking-wide ${tw.typography.color.tertiary}`}>Merchant</dt>
              <dd className={`text-sm font-semibold ${tw.typography.color.primary}`}>ALTANATIVEZ HAVEN LIMITED</dd>
            </div>
            <div>
              <dt className={`text-[11px] uppercase tracking-wide ${tw.typography.color.tertiary}`}>Amount</dt>
              <dd className={`text-sm font-semibold ${tw.typography.color.primary}`}>$99 USD</dd>
            </div>
            <div>
              <dt className={`text-[11px] uppercase tracking-wide ${tw.typography.color.tertiary}`}>Transaction reference</dt>
              <dd className={`text-sm font-mono break-all ${tw.typography.color.primary}`}>{confirmation.reference}</dd>
            </div>
            <div>
              <dt className={`text-[11px] uppercase tracking-wide ${tw.typography.color.tertiary}`}>Payment date</dt>
              <dd className={`text-sm ${tw.typography.color.primary}`}>{new Date(confirmation.paidAt).toLocaleString()}</dd>
            </div>
          </dl>
          <div className="mt-7 text-left">
            <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.tertiary}`}>What happens next</p>
            <ol className="mt-3 space-y-3">
              {nextSteps.map((step, index) => (
                <li key={step} className="flex items-center gap-3">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-[var(--space-surface-accent-soft)] flex items-center justify-center text-xs font-bold text-[var(--space-brand-primary)]">
                    {index + 1}
                  </span>
                  <span className={`text-sm ${tw.typography.color.secondary}`}>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <button onClick={onStart} className={`mt-8 w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold ${tw.button.accent}`}>
            Start Your Onboarding →
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, optional, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className={`block text-sm font-medium mb-1.5 ${tw.typography.color.primary}`}>
        {label} {optional && <span className={`font-normal ${tw.typography.color.tertiary}`}>(optional)</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass = 'w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3.5 py-3 text-sm text-[var(--space-text-primary)] outline-none focus:border-[var(--space-brand-primary)]';

function ChoiceButtons({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {options.map((option) => (
        <button
          type="button"
          key={option}
          onClick={() => onChange(option)}
          className={`px-3 py-2.5 rounded-xl border text-sm font-medium ${
            value === option
              ? 'border-[var(--space-brand-primary)] bg-[var(--space-surface-accent-soft)] text-[var(--space-brand-primary)]'
              : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] text-[var(--space-text-secondary)]'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function OnboardingScreen({ initial, saving, error, onSubmit, onCancel }: {
  initial: OnboardingAnswers;
  saving: boolean;
  error: string | null;
  onSubmit: (answers: OnboardingAnswers) => void;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<OnboardingAnswers>(initial);
  const titles = ['About You', 'About Your Business', "What You're Building", 'Where You Are Today', 'What You Need Most'];
  const update = <K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const stepValid = [
    !!form.full_name.trim() && !!form.country.trim(),
    !!form.business_name.trim() && !!form.industry.trim() && !!form.business_stage,
    !!form.product_description.trim() && !!form.target_customer.trim() && !!form.problem_solved.trim(),
    !!form.registered_business && !!form.pitch_deck_status && !!form.financial_projections_status && !!form.spoken_to_investors,
    form.needs.length > 0 && form.needs.length <= 3,
  ][step];
  const toggleNeed = (need: string) => {
    if (form.needs.includes(need)) update('needs', form.needs.filter((item) => item !== need));
    else if (form.needs.length < 3) update('needs', [...form.needs, need]);
  };

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12" data-testid="screen-paid-onboarding">
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className={`text-sm font-semibold ${tw.typography.color.brand}`}>Step {step + 1} of 5</p>
          <p className={`text-xs ${tw.typography.color.tertiary}`}>{Math.round(((step + 1) / 5) * 100)}% complete</p>
        </div>
        <div className="h-2 rounded-full bg-[var(--space-border-default)] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--space-brand-primary)] transition-all" style={{ width: `${((step + 1) / 5) * 100}%` }} />
        </div>
      </div>
      <div className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5 sm:p-8`}>
        <h1 className={`text-2xl font-bold ${tw.typography.color.primary}`}>{titles[step]}</h1>
        <p className={`mt-1 text-sm ${tw.typography.color.tertiary}`}>Your answers personalise your readiness snapshot and fundraising journey.</p>
        <div className="mt-7 space-y-5">
          {step === 0 && <>
            <FormField label="Full name"><input className={inputClass} value={form.full_name} onChange={(e) => update('full_name', e.target.value)} /></FormField>
            <FormField label="Country"><input className={inputClass} value={form.country} onChange={(e) => update('country', e.target.value)} /></FormField>
            <FormField label="LinkedIn profile URL" optional><input type="url" className={inputClass} placeholder="https://linkedin.com/in/..." value={form.linkedin_url} onChange={(e) => update('linkedin_url', e.target.value)} /></FormField>
          </>}
          {step === 1 && <>
            <FormField label="Business name"><input className={inputClass} value={form.business_name} onChange={(e) => update('business_name', e.target.value)} /></FormField>
            <FormField label="Industry / sector"><input className={inputClass} value={form.industry} onChange={(e) => update('industry', e.target.value)} /></FormField>
            <FormField label="Business stage"><ChoiceButtons value={form.business_stage} options={['Idea', 'Pre-revenue', 'Early revenue', 'Scaling']} onChange={(value) => update('business_stage', value)} /></FormField>
          </>}
          {step === 2 && <>
            <FormField label="One-line description of your product or service"><textarea rows={3} className={inputClass} value={form.product_description} onChange={(e) => update('product_description', e.target.value)} /></FormField>
            <FormField label="Target customer"><textarea rows={3} className={inputClass} value={form.target_customer} onChange={(e) => update('target_customer', e.target.value)} /></FormField>
            <FormField label="Problem you solve"><textarea rows={3} className={inputClass} value={form.problem_solved} onChange={(e) => update('problem_solved', e.target.value)} /></FormField>
          </>}
          {step === 3 && <>
            <FormField label="Do you have a registered business?"><ChoiceButtons value={form.registered_business} options={['Yes', 'No']} onChange={(value) => update('registered_business', value as YesNo)} /></FormField>
            <FormField label="Do you have a pitch deck?"><ChoiceButtons value={form.pitch_deck_status} options={['Yes', 'No', 'In progress']} onChange={(value) => update('pitch_deck_status', value as ProgressAnswer)} /></FormField>
            <FormField label="Do you have financial projections?"><ChoiceButtons value={form.financial_projections_status} options={['Yes', 'No', 'In progress']} onChange={(value) => update('financial_projections_status', value as ProgressAnswer)} /></FormField>
            <FormField label="Have you spoken to any investors?"><ChoiceButtons value={form.spoken_to_investors} options={['Yes', 'No']} onChange={(value) => update('spoken_to_investors', value as YesNo)} /></FormField>
          </>}
          {step === 4 && <>
            <p className={`text-sm ${tw.typography.color.secondary}`}>Choose up to 3 priorities ({form.needs.length}/3 selected).</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {ONBOARDING_NEEDS.map((need) => {
                const selected = form.needs.includes(need);
                const disabled = !selected && form.needs.length >= 3;
                return <button type="button" key={need} disabled={disabled} onClick={() => toggleNeed(need)} className={`p-4 rounded-xl border text-left text-sm transition-colors disabled:opacity-40 ${selected ? 'border-[var(--space-brand-primary)] bg-[var(--space-surface-accent-soft)] text-[var(--space-text-primary)]' : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] text-[var(--space-text-secondary)]'}`}>
                  <span className="flex items-center gap-2"><span className={`w-5 h-5 rounded-md border flex items-center justify-center ${selected ? 'bg-[var(--space-brand-primary)] border-[var(--space-brand-primary)]' : 'border-[var(--space-border-default)]'}`}>{selected && <Check className="w-3.5 h-3.5 text-[var(--space-text-on-highlight)]" />}</span>{need}</span>
                </button>;
              })}
            </div>
          </>}
        </div>
        {error && <p className={`mt-5 text-sm ${tw.typography.color.secondary}`} role="alert">{error}</p>}
        <div className="mt-8 flex items-center justify-between gap-3">
          <button type="button" onClick={() => step === 0 ? onCancel?.() : setStep(step - 1)} disabled={step === 0 && !onCancel} className={`px-4 py-2.5 rounded-lg text-sm font-medium ${tw.button.secondary} disabled:opacity-30`}>
            {step === 0 && onCancel ? 'Cancel' : 'Back'}
          </button>
          {step < 4 ? (
            <button type="button" onClick={() => setStep(step + 1)} disabled={!stepValid} className={`px-5 py-2.5 rounded-lg text-sm font-semibold ${tw.button.primary} disabled:opacity-40`}>Continue <ArrowRight className="inline w-4 h-4 ml-1" /></button>
          ) : (
            <button type="button" onClick={() => onSubmit(form)} disabled={!stepValid || saving} className={`px-5 py-3 rounded-lg text-sm font-semibold ${tw.button.accent} disabled:opacity-40`}>
              {saving ? 'Generating your snapshot…' : 'Generate My Readiness Snapshot →'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function ReadinessSnapshotScreen({ scores, onJourney }: { scores: ReadinessScores; onJourney: () => void }) {
  const areas = [
    ['Business Clarity', scores.business_clarity, Building2],
    ['Legal & Compliance', scores.legal_compliance, ShieldCheck],
    ['Pitch Readiness', scores.pitch_readiness, Megaphone],
    ['Investor Readiness', scores.investor_readiness, User],
    ['Financial Preparation', scores.financial_preparation, BarChart3],
  ] as const;
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12" data-testid="screen-readiness-snapshot">
      <div className="text-center max-w-2xl mx-auto">
        <p className={`text-xs font-semibold uppercase tracking-widest ${tw.typography.color.brand}`}>Founder Readiness Snapshot</p>
        <div className="mt-4 flex flex-col items-center">
          <ScoreRing score={scores.overall_score} size={160} />
          <h1 className={`mt-4 text-2xl font-bold ${tw.typography.color.primary}`}>Your Founder Readiness Score</h1>
          <p className={`mt-1 text-sm ${tw.typography.color.tertiary}`}>A personalised baseline for your fundraising journey.</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-8">
        {areas.map(([label, score, Icon]) => (
          <div key={label} className={`${tw.card.elevated} border border-[var(--space-border-default)] p-4`}>
            <div className="flex items-center justify-between gap-2"><Icon className={`w-4 h-4 ${tw.icon.primary}`} /><span className={`text-xl font-bold ${tw.typography.color.primary}`}>{score}</span></div>
            <p className={`mt-3 text-xs font-semibold ${tw.typography.color.secondary}`}>{label}</p>
            <div className="mt-2 h-1.5 rounded-full bg-[var(--space-border-default)] overflow-hidden"><div className="h-full rounded-full bg-[var(--space-brand-primary)]" style={{ width: `${score}%` }} /></div>
          </div>
        ))}
      </div>
      <div className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5 sm:p-6 mt-6`}>
        <h2 className={`text-lg font-semibold ${tw.typography.color.primary}`}>Your priority actions</h2>
        <div className="mt-4 grid md:grid-cols-3 gap-3">
          {scores.recommendations.map((recommendation, index) => (
            <div key={recommendation} className={`${tw.card.flat} p-4`}><span className={`text-xs font-bold ${tw.typography.color.brand}`}>0{index + 1}</span><p className={`mt-2 text-sm leading-relaxed ${tw.typography.color.secondary}`}>{recommendation}</p></div>
          ))}
        </div>
      </div>
      <div className="mt-7 text-center"><button onClick={onJourney} className={`px-6 py-3 rounded-xl text-sm font-semibold ${tw.button.accent}`}>View Your Fundraising Journey →</button></div>
    </main>
  );
}

function JourneyDashboard({ profile, snapshot, documents, onNavigate }: { profile: OnboardingProfileRow | null; snapshot: ReadinessScores | null; documents: PackDocument[]; onNavigate: (screen: PaidScreen) => void }) {
  const hasBusinessPlan = documents.some((doc) => doc.id === 'business-plan');
  const hasPitchDeck = documents.some((doc) => doc.id === 'pitch-deck');
  const steps: Array<{ title: string; description: string; status: string; screen?: PaidScreen }> = [
    { title: 'Understand Your Readiness', description: 'Review your Founder Readiness Snapshot', status: snapshot ? 'Complete' : 'In Progress', screen: 'snapshot' as PaidScreen },
    { title: 'Clarify Your Business Model', description: 'Build and refine your Business Plan', status: hasBusinessPlan ? 'Complete' : 'In Progress', screen: 'documents' as PaidScreen },
    { title: 'Build Your Pitch Deck', description: 'Create your investor-ready story', status: hasPitchDeck ? 'Complete' : 'In Progress', screen: 'documents' as PaidScreen },
    { title: 'Prepare Financial Projections', description: 'Build investor-grade financials', status: 'Locked' },
    { title: 'Identify Target Investors', description: 'Create your focused investor list', status: 'Locked' },
    { title: 'Craft Your Outreach Strategy', description: 'Plan warm introductions and outreach', status: 'Locked' },
    { title: 'Execute & Iterate', description: 'Track conversations and improve your pitch', status: 'Locked' },
  ];
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12" data-testid="screen-paid-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className={`text-sm ${tw.typography.color.brand}`}>Your fundraising journey</p><h1 className={`text-2xl sm:text-3xl font-bold ${tw.typography.color.primary}`}>Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1><p className={`mt-2 text-sm ${tw.typography.color.tertiary}`}>Follow the seven steps from readiness to investor execution.</p></div>
        {snapshot && <button onClick={() => onNavigate('snapshot')} className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${tw.button.secondary}`}>Readiness score: {snapshot.overall_score}</button>}
      </div>
      <div className="mt-8 space-y-3">
        {steps.map((step, index) => {
          const active = index < 3;
          return <button key={step.title} type="button" disabled={!active} onClick={() => step.screen && onNavigate(step.screen)} className={`${tw.card.elevated} border border-[var(--space-border-default)] w-full p-4 sm:p-5 text-left flex items-center gap-4 disabled:opacity-70`}>
            <span className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center font-bold ${active ? 'bg-[var(--space-surface-accent-soft)] text-[var(--space-brand-primary)]' : 'bg-[var(--space-surface-muted)] text-[var(--space-text-muted)]'}`}>{index + 1}</span>
            <span className="flex-1 min-w-0"><span className={`block text-sm font-semibold ${tw.typography.color.primary}`}>{step.title}</span><span className={`block text-xs mt-0.5 ${tw.typography.color.tertiary}`}>{step.description}</span></span>
            <span className={`shrink-0 text-[10px] sm:text-xs font-semibold px-2.5 py-1 rounded-full ${active ? 'bg-[var(--space-semantic-success-100)] text-[var(--space-semantic-success)]' : 'bg-[var(--space-surface-muted)] text-[var(--space-text-muted)]'}`}>{active ? step.status : 'Coming Soon'}</span>
            {active && <ChevronRight className={`w-4 h-4 ${tw.icon.muted}`} />}
          </button>;
        })}
      </div>
      <div className="grid md:grid-cols-2 gap-4 mt-8">
        <div className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5`}><div className="flex items-center justify-between"><span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--space-semantic-success-100)] text-[var(--space-semantic-success)]">Active</span><Target className={`w-5 h-5 ${tw.icon.primary}`} /></div><h2 className={`mt-4 text-lg font-semibold ${tw.typography.color.primary}`}>Fundraising Readiness</h2><p className={`mt-2 text-sm ${tw.typography.color.secondary}`}>Use your assessment, Gap Radar, documents, and pitch coach to prepare for investors.</p><button onClick={() => onNavigate('gap-radar')} className={`mt-4 px-4 py-2 rounded-lg text-xs font-semibold ${tw.button.primary}`}>Open Gap Radar</button></div>
        <div className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5`}><div className="flex items-center justify-between"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--space-surface-muted)] ${tw.typography.color.tertiary}`}>Coming Soon</span><Bot className={`w-5 h-5 ${tw.icon.muted}`} /></div><h2 className={`mt-4 text-lg font-semibold ${tw.typography.color.primary}`}>Business Operations AI</h2><p className={`mt-2 text-sm ${tw.typography.color.secondary}`}>Full AI operating system for running and scaling your business. Launching soon.</p><a href="mailto:hello@foundaros.com?subject=Notify%20me%20about%20Business%20Operations%20AI" className={`inline-block mt-4 px-4 py-2 rounded-lg text-xs font-semibold ${tw.button.secondary}`}>Notify Me</a></div>
      </div>
    </main>
  );
}

function DocumentVaultScreen({ documents, generatedAt, rebuilding, onRebuild }: { documents: PackDocument[]; generatedAt: string | null; rebuilding: boolean; onRebuild: () => void }) {
  const vaultDocuments = [
    { id: 'business-plan', label: 'Business Plan' },
    { id: 'pitch-deck', label: 'Pitch Deck Outline' },
    { id: 'action-plan', label: 'Action Plan' },
  ];
  const hasAny = vaultDocuments.some((item) => documents.some((doc) => doc.id === item.id));
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12" data-testid="screen-document-vault">
      <div><p className={`text-sm ${tw.typography.color.brand}`}>Document Vault</p><h1 className={`text-2xl sm:text-3xl font-bold ${tw.typography.color.primary}`}>Your fundraising documents</h1><p className={`mt-2 text-sm ${tw.typography.color.tertiary}`}>Generate, download, and refresh the working documents built from your assessment.</p></div>
      <div className="mt-8 space-y-3">
        {vaultDocuments.map((item) => {
          const document = documents.find((doc) => doc.id === item.id);
          return <div key={item.id} className={`${tw.card.elevated} border border-[var(--space-border-default)] p-4 sm:p-5 flex flex-wrap items-center gap-4`}>
            <div className="w-11 h-11 rounded-xl bg-[var(--space-surface-accent-soft)] flex items-center justify-center"><FileText className={`w-5 h-5 ${tw.icon.primary}`} /></div>
            <div className="flex-1 min-w-[180px]"><h2 className={`text-sm font-semibold ${tw.typography.color.primary}`}>{item.label}</h2><p className={`text-xs mt-1 ${tw.typography.color.tertiary}`}>{document ? `Generated${generatedAt ? ` · ${new Date(generatedAt).toLocaleDateString()}` : ''}` : 'Pending'}</p></div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${document ? 'bg-[var(--space-semantic-success-100)] text-[var(--space-semantic-success)]' : 'bg-[var(--space-surface-muted)] text-[var(--space-text-muted)]'}`}>{document ? 'Generated' : 'Pending'}</span>
            {document && <div className="flex items-center gap-2"><button onClick={() => downloadDocument(document)} className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${tw.button.primary}`}><Download className="w-3.5 h-3.5" />Download</button><button onClick={onRebuild} disabled={rebuilding} className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${tw.button.secondary} disabled:opacity-50`}><RefreshCw className={`w-3.5 h-3.5 ${rebuilding ? 'animate-spin' : ''}`} />Regenerate</button></div>}
          </div>;
        })}
      </div>
      {!hasAny && <button onClick={onRebuild} disabled={rebuilding} className={`mt-6 px-5 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 ${tw.button.accent} disabled:opacity-50`}><Sparkles className="w-4 h-4" />{rebuilding ? 'Generating documents…' : 'Generate Documents'}</button>}
      {documents.length > 0 && <div className="mt-8"><DocumentsSection documents={documents} generatedAt={generatedAt} onRebuild={onRebuild} rebuilding={rebuilding} /></div>}
    </main>
  );
}

function ProfileScreen({ profile, onEdit }: { profile: OnboardingProfileRow; onEdit: () => void }) {
  const answers = profileToAnswers(profile);
  const fields = [
    ['Full name', answers.full_name], ['Country', answers.country], ['LinkedIn', answers.linkedin_url || 'Not provided'],
    ['Business', answers.business_name], ['Industry', answers.industry], ['Stage', answers.business_stage],
    ['What you are building', answers.product_description], ['Target customer', answers.target_customer], ['Problem solved', answers.problem_solved],
    ['Registered business', answers.registered_business], ['Pitch deck', answers.pitch_deck_status], ['Financial projections', answers.financial_projections_status], ['Investor conversations', answers.spoken_to_investors],
  ];
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12" data-testid="screen-founder-profile">
      <div className="flex items-end justify-between gap-4"><div><p className={`text-sm ${tw.typography.color.brand}`}>Founder Profile</p><h1 className={`text-2xl sm:text-3xl font-bold ${tw.typography.color.primary}`}>Your onboarding answers</h1></div><button onClick={onEdit} className={`px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 ${tw.button.primary}`}><Pencil className="w-4 h-4" />Edit</button></div>
      <div className={`${tw.card.elevated} border border-[var(--space-border-default)] mt-8 overflow-hidden`}>
        <dl className="divide-y divide-[var(--space-border-default)]">{fields.map(([label, value]) => <div key={label} className="grid sm:grid-cols-[180px_1fr] gap-1 sm:gap-5 p-4"><dt className={`text-xs font-semibold ${tw.typography.color.tertiary}`}>{label}</dt><dd className={`text-sm whitespace-pre-wrap ${tw.typography.color.primary}`}>{value}</dd></div>)}</dl>
      </div>
      <div className={`${tw.card.elevated} border border-[var(--space-border-default)] mt-4 p-5`}><h2 className={`text-sm font-semibold ${tw.typography.color.primary}`}>Top priorities</h2><div className="mt-3 flex flex-wrap gap-2">{answers.needs.map((need) => <span key={need} className="px-3 py-1.5 rounded-full text-xs bg-[var(--space-surface-accent-soft)] text-[var(--space-brand-primary)]">{need}</span>)}</div></div>
    </main>
  );
}

/* ============================================================================
 * PITCH COACH — interactive AI feedback on the founder's elevator pitch.
 * Part of the paid tier: shown below "Your Documents" once a purchase exists.
 * Feedback is displayed inline (not a download) and scored across the six
 * dimensions investors actually judge a pitch on.
 * ========================================================================== */

interface PitchDimension {
  key: string;
  label: string;
  score: number | null;
  feedback: string;
}

interface PitchFeedback {
  dimensions: PitchDimension[];
  overallScore: number | null;
  summary: string;
  /** Raw text fallback when the model's JSON could not be parsed. */
  raw?: string;
}

const PITCH_DIMENSIONS: { key: string; label: string }[] = [
  { key: 'clarity', label: 'Clarity' },
  { key: 'investor_appeal', label: 'Investor Appeal' },
  { key: 'problem_articulation', label: 'Problem Articulation' },
  { key: 'solution_strength', label: 'Solution Strength' },
  { key: 'ask', label: 'The Ask' },
];

const PITCH_MIN_WORDS = 30;
const PITCH_MAX_WORDS = 450;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function clampScore(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function parsePitchFeedback(content: string): PitchFeedback | null {
  try {
    // The model is asked for pure JSON, but strip a stray code fence if present.
    const fenced = content.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
    const data = JSON.parse((fenced ? fenced[1] : content).trim());
    const dimensions: PitchDimension[] = PITCH_DIMENSIONS.map(({ key, label }) => {
      const entry = data?.[key] ?? {};
      return {
        key,
        label,
        score: clampScore(entry?.score),
        feedback: typeof entry?.feedback === 'string' ? entry.feedback : '',
      };
    });
    if (dimensions.every((d) => !d.feedback)) return null;
    return {
      dimensions,
      overallScore: clampScore(data?.overall_score),
      summary: typeof data?.summary === 'string' ? data.summary : '',
    };
  } catch {
    return null;
  }
}

function feedbackAsText(fb: PitchFeedback): string {
  if (fb.raw) return fb.raw;
  const lines: string[] = ['FoundarOS Pitch Coach feedback', ''];
  if (fb.overallScore !== null) lines.push(`Overall score: ${fb.overallScore}/10`, '');
  for (const d of fb.dimensions) {
    if (!d.feedback && d.score === null) continue;
    lines.push(`${d.label}${d.score !== null ? ` (${d.score}/10)` : ''}: ${d.feedback}`, '');
  }
  if (fb.summary) lines.push(`Summary: ${fb.summary}`);
  return lines.join('\n');
}

function PitchCoachSection() {
  const [pitch, setPitch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<PitchFeedback | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const words = countWords(pitch);
  const canSubmit = words >= PITCH_MIN_WORDS && words <= PITCH_MAX_WORDS && !submitting;

  const submitPitch = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                'You are the FoundarOS Pitch Coach — a seasoned investor giving a first-time founder structured, honest, encouraging feedback on their elevator pitch.',
                'Respond with ONLY a JSON object of exactly this shape:',
                '{"clarity":{"score":0-10,"feedback":"..."},"investor_appeal":{"score":0-10,"feedback":"..."},"problem_articulation":{"score":0-10,"feedback":"..."},"solution_strength":{"score":0-10,"feedback":"..."},"ask":{"score":0-10,"feedback":"..."},"overall_score":0-10,"summary":"..."}',
                'Rules: 2–3 specific sentences of feedback per dimension, quoting the founder\'s own words where useful. For "ask": if the pitch contains no funding/next-step ask, score it low and say exactly what an ask line would sound like for this pitch. "summary" is 2–3 sentences: the single biggest improvement first, then what already works. Never invent facts about their business.',
              ].join('\n'),
            },
            { role: 'user', content: `Here is my elevator pitch:\n\n${pitch.trim()}` },
          ],
          max_tokens: 900,
          temperature: 0.4,
        }),
      });
      if (!res.ok) throw new Error('coach_unavailable');
      const data = await res.json();
      const content: unknown = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('coach_unavailable');
      const parsed = parsePitchFeedback(content);
      setFeedback(
        parsed ?? {
          dimensions: [],
          overallScore: null,
          summary: '',
          raw: content.trim(),
        },
      );
    } catch {
      setErrorMsg('The Pitch Coach is unavailable right now — your pitch is still in the box above, try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyFeedback = async () => {
    if (!feedback) return;
    try {
      await navigator.clipboard.writeText(feedbackAsText(feedback));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const scoreTone = (score: number | null) =>
    score === null
      ? tw.typography.color.tertiary
      : score >= 8
        ? tw.typography.color.success
        : score >= 5
          ? tw.typography.color.brand
          : tw.typography.color.danger;

  return (
    <div
      className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5 sm:p-6 mt-4`}
      data-testid="section-pitch-coach"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--space-surface-accent-soft)] flex items-center justify-center">
          <Megaphone className={`w-5 h-5 ${tw.icon.accent}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`text-base font-semibold ${tw.typography.color.primary}`}>Pitch Coach</h4>
          <p className={`text-xs ${tw.typography.color.tertiary}`}>
            Paste your elevator pitch (aim for 200–400 words) and get structured investor-style
            feedback — clarity, appeal, problem, solution, your ask, and an overall score out of 10.
          </p>
        </div>
      </div>

      <textarea
        value={pitch}
        onChange={(e) => setPitch(e.target.value)}
        placeholder="Type or paste your elevator pitch here… Cover the problem, your solution, why you, and what you're asking for."
        rows={7}
        className={`${tw.input.base} ${tw.input.default} text-sm resize-y`}
        data-testid="input-pitch-coach"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <span
          className={`text-[11px] ${
            words > PITCH_MAX_WORDS ? tw.typography.color.danger : tw.typography.color.muted
          }`}
        >
          {words} word{words !== 1 ? 's' : ''}
          {words > 0 && words < PITCH_MIN_WORDS && ` · keep going — at least ${PITCH_MIN_WORDS} words for useful feedback`}
          {words > PITCH_MAX_WORDS && ` · trim to under ${PITCH_MAX_WORDS} words — brevity is part of the pitch`}
        </span>
        <button
          onClick={submitPitch}
          disabled={!canSubmit}
          className={`px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tw.button.accent} disabled:opacity-40`}
          data-testid="button-submit-pitch"
        >
          {submitting ? (
            <div className="w-4 h-4 animate-spin rounded-full border-2 border-[var(--space-border-default)] border-t-[var(--space-text-on-highlight)]" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {submitting ? 'Coaching…' : 'Get feedback'}
        </button>
      </div>

      {errorMsg && (
        <p className={`mt-3 text-xs ${tw.typography.color.danger}`} data-testid="text-pitch-error">
          {errorMsg}
        </p>
      )}

      {feedback && (
        <div className="mt-4" data-testid="section-pitch-feedback">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <h5 className={`text-sm font-semibold ${tw.typography.color.primary}`}>Your feedback</h5>
              {feedback.overallScore !== null && (
                <span className={`${tw.badge.default} ${tw.badge.accent}`} data-testid="badge-pitch-overall">
                  Overall: {feedback.overallScore}/10
                </span>
              )}
            </div>
            <button
              onClick={copyFeedback}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${tw.button.secondary}`}
              data-testid="button-copy-pitch-feedback"
            >
              {copied ? <Check className={`w-3.5 h-3.5 ${tw.icon.success}`} /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy feedback'}
            </button>
          </div>

          {feedback.raw ? (
            <div className={`${tw.card.flat} p-4`}>
              <p className={`text-xs whitespace-pre-wrap leading-relaxed ${tw.typography.color.secondary}`}>
                {feedback.raw}
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {feedback.dimensions.map((d) => (
                  <li key={d.key} className={`${tw.card.default} p-3.5`} data-testid={`row-pitch-${d.key}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`text-xs font-semibold ${tw.typography.color.primary}`}>{d.label}</span>
                      <span className={`text-xs font-bold ${scoreTone(d.score)}`}>
                        {d.score !== null ? `${d.score}/10` : '—'}
                      </span>
                    </div>
                    {d.score !== null && (
                      <div className="h-1 rounded-full bg-[var(--space-border-default)] overflow-hidden mb-1.5">
                        <div
                          className="h-full rounded-full bg-[var(--space-brand-primary)] transition-all duration-500"
                          style={{ width: `${d.score * 10}%` }}
                        />
                      </div>
                    )}
                    <p className={`text-xs leading-relaxed ${tw.typography.color.secondary}`}>{d.feedback}</p>
                  </li>
                ))}
              </ul>
              {feedback.summary && (
                <p className={`mt-3 text-xs leading-relaxed ${tw.typography.color.secondary}`}>
                  <span className={`font-semibold ${tw.typography.color.primary}`}>Bottom line: </span>
                  {feedback.summary}
                </p>
              )}
            </>
          )}
          <p className={`mt-2 text-[11px] ${tw.typography.color.muted}`}>
            Revise your pitch above and resubmit as many times as you like — great pitches are rewritten, not written.
          </p>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * COMING SOON — roadmap teaser shown to ALL users after the results/paid
 * section. Pure UI: no backend. The notify CTA is a lightweight placeholder
 * (visitors already leave their email at the gate).
 * ========================================================================== */

const COMING_SOON_OPERATIONS = [
  'Standard Operating Procedures (SOPs)',
  'Procurement Policies',
  'HR Handbook',
  'Employee Contracts',
  'Vendor Agreements',
  'Risk Register',
  'KPI Dashboard',
  'OKRs (Objectives & Key Results)',
  'Board Meeting Templates',
  'Company Policies',
  'Sales Playbooks',
];

const COMING_SOON_COACHES = [
  'CFO AI',
  'CEO Coach',
  'Grant Coach',
  'Operations Manager',
  'HR Manager',
  'Procurement Manager',
  'Marketing Advisor',
  'Legal Document Assistant',
];

const NOTIFY_STORAGE_KEY = 'foundaros_roadmap_notify';

function ComingSoonSection() {
  const [email, setEmail] = useState(() => getSessionEmail() ?? '');
  const [subscribed, setSubscribed] = useState(() => {
    try {
      return localStorage.getItem(NOTIFY_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const handleNotify = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    try {
      localStorage.setItem(NOTIFY_STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setSubscribed(true);
  };

  const itemRow = (label: string) => (
    <li key={label} className="flex items-center justify-between gap-2 py-1.5">
      <span className={`text-xs ${tw.typography.color.secondary}`}>{label}</span>
      <span
        className={`${tw.badge.default} ${tw.badge.neutral} shrink-0 inline-flex items-center gap-1 opacity-80`}
      >
        <Lock className="w-2.5 h-2.5" />
        Soon
      </span>
    </li>
  );

  return (
    <div className="px-4 sm:px-5 py-6 border-b border-[var(--space-border-default)]" data-testid="section-coming-soon">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-5">
          <span className={`${tw.badge.default} ${tw.badge.accent} inline-flex items-center gap-1 mb-2`}>
            <Rocket className="w-3 h-3" />
            Coming Soon — Stay Tuned
          </span>
          <h3 className={`text-lg font-semibold ${tw.typography.color.brand}`}>
            FoundarOS — the AI operating system for every stage of your founder journey
          </h3>
          <p className={`text-xs ${tw.typography.color.tertiary} mt-1 max-w-lg mx-auto`}>
            Funding readiness is live today. Next on the roadmap: Business Support &amp; Operations for
            founders post-incorporation — generate your operating documents in one click — and a bench
            of specialist AI coaches on call.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className={`${tw.card.default} p-4`} data-testid="card-coming-soon-operations">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 shrink-0 rounded-lg bg-[var(--space-surface-accent-soft)] flex items-center justify-center">
                <Briefcase className={`w-4 h-4 ${tw.icon.primary}`} />
              </div>
              <div>
                <h4 className={`text-sm font-semibold ${tw.typography.color.primary}`}>Business Operations</h4>
                <p className={`text-[11px] ${tw.typography.color.tertiary}`}>
                  Generate after incorporation
                </p>
              </div>
            </div>
            <ul className="divide-y divide-[var(--space-border-default)]">
              {COMING_SOON_OPERATIONS.map(itemRow)}
            </ul>
          </div>

          <div className={`${tw.card.default} p-4`} data-testid="card-coming-soon-coaches">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 shrink-0 rounded-lg bg-[var(--space-surface-accent-soft)] flex items-center justify-center">
                <Bot className={`w-4 h-4 ${tw.icon.primary}`} />
              </div>
              <div>
                <h4 className={`text-sm font-semibold ${tw.typography.color.primary}`}>AI Coaches</h4>
                <p className={`text-[11px] ${tw.typography.color.tertiary}`}>
                  Specialist agents for every role
                </p>
              </div>
            </div>
            <ul className="divide-y divide-[var(--space-border-default)]">
              {COMING_SOON_COACHES.map(itemRow)}
            </ul>
          </div>
        </div>

        <div className={`${tw.card.flat} mt-3 p-4`} data-testid="card-coming-soon-notify">
          {subscribed ? (
            <p className={`text-sm font-medium flex items-center justify-center gap-2 ${tw.typography.color.primary}`}>
              <CheckCircle2 className={`w-4 h-4 ${tw.icon.success}`} />
              You're on the list — we'll let you know the moment these launch.
            </p>
          ) : (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <BellRing className={`w-4 h-4 shrink-0 ${tw.icon.accent}`} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleNotify()}
                  placeholder="you@company.com"
                  className={`${tw.input.base} ${tw.input.default} text-sm py-2`}
                  data-testid="input-coming-soon-email"
                />
              </div>
              <button
                onClick={handleNotify}
                disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
                className={`shrink-0 px-4 py-2.5 rounded-lg text-sm font-semibold ${tw.button.primary} disabled:opacity-40`}
                data-testid="button-coming-soon-notify"
              >
                Get notified when these launch
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * RESULTS — score, free teaser, paid gap details, and conversion paywall
 * ========================================================================== */
function ResultsScreen({
  overall,
  categoryScores,
  topGaps,
  hasPaidAccess,
  onRetake,
  upgradeSlot,
}: {
  overall: number;
  categoryScores: Record<CategoryId, number>;
  topGaps: TopGap[];
  hasPaidAccess: boolean;
  onRetake: () => void;
  /** Paywall card (unpaid) or the unlocked "Your Documents" section (paid). */
  upgradeSlot: ReactNode;
}) {
  const severityRank: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  // Free visitors receive only the least-critical finding. Locked findings are
  // deliberately not rendered, so their titles, answers, and actions never
  // appear as readable DOM content before the server-verified paid unlock.
  const displayedGaps = hasPaidAccess
    ? topGaps
    : [...topGaps]
        .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.score_impact - b.score_impact)
        .slice(0, 1);
  const lockedGapCount = hasPaidAccess ? 0 : Math.max(0, topGaps.length - displayedGaps.length);

  return (
    <div className="px-4 sm:px-5 pt-5 pb-6 border-b border-[var(--space-border-default)]">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className={`w-5 h-5 ${tw.icon.primary}`} />
            <h2 className={`text-lg font-semibold ${tw.typography.color.brand}`}>Your Funding Readiness Results</h2>
          </div>
          <button
            onClick={onRetake}
            className={`text-xs font-medium flex items-center gap-1 underline underline-offset-2 ${tw.typography.color.tertiary} hover:text-[var(--space-text-secondary)]`}
            data-testid="button-retake-assessment"
          >
            <RotateCcw className="w-3 h-3" />
            Retake assessment
          </button>
        </div>

        {/* Overall + categories */}
        <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start mb-6">
          <ScoreRing score={overall} size={140} />
          <div className="flex-1 w-full min-w-0">
            <p className={`text-sm ${tw.typography.color.secondary} mb-3`}>
              Here's how investors would see your idea today, across the four pillars of funding readiness.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const score = categoryScores[cat.id] ?? 0;
                return (
                  <div key={cat.id} className={`${tw.card.flat} p-3`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon className={`w-3.5 h-3.5 ${tw.icon.primary}`} />
                      <span className={`text-[11px] font-medium truncate ${tw.typography.color.secondary}`}>
                        {cat.short}
                      </span>
                    </div>
                    <span className={`text-xl font-bold ${tw.typography.color.brand}`}>{score}</span>
                    <div className="mt-1.5 h-1 rounded-full bg-[var(--space-border-default)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--space-brand-primary)] transition-all duration-500"
                        style={{ width: `${score}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Free visitors see one low-severity teaser; paid visitors see every gap. */}
        {topGaps.length > 0 && (
          <div className="mb-6">
            <h3 className={`text-sm font-semibold ${tw.typography.color.primary} mb-1`}>
              {hasPaidAccess
                ? `All ${topGaps.length} gap${topGaps.length !== 1 ? 's' : ''} holding you back`
                : 'One gap you can start working on now'}
            </h3>
            {!hasPaidAccess && (
              <p className={`text-xs ${tw.typography.color.tertiary} mb-2.5`}>
                This is a surface-level preview from your assessment.
              </p>
            )}
            <ul className="space-y-2.5">
              {displayedGaps.map((gap) => {
                const cat = categoryMeta(gap.category);
                const CatIcon = cat.icon;
                const sevClass: Record<Severity, string> = {
                  critical: tw.badge.danger,
                  high: tw.badge.danger,
                  medium: tw.badge.warning,
                  low: tw.badge.neutral,
                };
                return (
                  <li key={gap.question_id} className={`${tw.card.default} p-4`}>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`text-sm font-medium ${tw.typography.color.primary}`}>{gap.title}</span>
                      <span className={`${tw.badge.default} ${sevClass[gap.severity]} capitalize`}>{gap.severity}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1 text-[11px] ${tw.typography.color.tertiary}`}>
                        <CatIcon className="w-3 h-3" />
                        {cat.label}
                      </span>
                      <span className={`text-[11px] ${tw.typography.color.muted}`}>· you answered: “{gap.answer_label}”</span>
                    </div>
                    <p className={`flex items-start gap-1.5 text-xs ${tw.typography.color.secondary}`}>
                      <ArrowRight className={`w-3.5 h-3.5 shrink-0 mt-[1px] ${tw.icon.primary}`} />
                      <span>
                        <span className="font-medium">Do this next:</span> {gap.action}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>

            {lockedGapCount > 0 && (
              <div
                className="relative mt-3 overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] p-4"
                data-testid="card-locked-critical-gaps"
                aria-label={`${lockedGapCount} critical gaps locked`}
              >
                <div className="absolute inset-0 opacity-55 blur-sm" aria-hidden="true">
                  <div className="h-full p-4 space-y-3">
                    <div className="h-3 w-2/3 rounded bg-[var(--space-border-default)]" />
                    <div className="h-2.5 w-full rounded bg-[var(--space-border-default)]" />
                    <div className="h-2.5 w-5/6 rounded bg-[var(--space-border-default)]" />
                  </div>
                </div>
                <div className="relative z-10 flex items-center gap-3 rounded-lg bg-[var(--space-surface-card)] p-3 shadow-sm">
                  <div className="w-10 h-10 shrink-0 rounded-full bg-[var(--space-surface-accent-soft)] flex items-center justify-center">
                    <Lock className={`w-5 h-5 ${tw.icon.primary}`} />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>
                      You have {lockedGapCount} critical gap{lockedGapCount !== 1 ? 's' : ''} that investors will flag
                    </p>
                    <p className={`text-xs ${tw.typography.color.tertiary}`}>
                      Their details and recommended fixes are locked.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {hasPaidAccess && (
              <p className={`text-[11px] ${tw.typography.color.muted} mt-2`}>
                These gaps are available in your gap board so you can track them to “fixed”.
              </p>
            )}
          </div>
        )}

        {upgradeSlot}
      </div>
    </div>
  );
}

/* ============================================================================
 * GAP BOARD — the existing tracker (score ring, filters, log form, list).
 * Functionality unchanged; data is passed in from the orchestrator.
 * ========================================================================== */
function GapBoard({
  gaps,
  loading,
  error,
  refresh,
}: {
  gaps: FundingGap[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filterCategory, setFilterCategory] = useState<CategoryId | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<GapStatus | 'all'>('all');
  const [aiLoadingId, setAiLoadingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [form, setForm] = useState({
    title: '',
    category: 'idea_clarity' as CategoryId,
    severity: 'medium' as Severity,
    score_impact: 5,
    notes: '',
    assessment_ref: '',
  });

  const readinessScore = useMemo(() => {
    const openImpact = (gaps || [])
      .filter((g) => g.status !== 'fixed')
      .reduce((sum, g) => sum + (g.score_impact || 0), 0);
    return Math.max(0, Math.min(100, 100 - openImpact));
  }, [gaps]);

  const stats = useMemo(() => {
    const all = gaps || [];
    const open = all.filter((g) => g.status === 'open').length;
    const inProgress = all.filter((g) => g.status === 'in_progress').length;
    const fixed = all.filter((g) => g.status === 'fixed').length;
    const recoverable = all.filter((g) => g.status !== 'fixed').reduce((s, g) => s + (g.score_impact || 0), 0);
    return { open, inProgress, fixed, total: all.length, recoverable };
  }, [gaps]);

  const categoryScores = useMemo(() => {
    return CATEGORIES.map((cat) => {
      const catGaps = (gaps || []).filter((g) => g.category === cat.id);
      const openImpact = catGaps.filter((g) => g.status !== 'fixed').reduce((s, g) => s + (g.score_impact || 0), 0);
      const score = Math.max(0, Math.min(100, 100 - openImpact));
      const openCount = catGaps.filter((g) => g.status !== 'fixed').length;
      return { ...cat, score, openCount, total: catGaps.length };
    });
  }, [gaps]);

  const filteredGaps = useMemo(() => {
    let list = [...(gaps || [])];
    if (filterCategory !== 'all') list = list.filter((g) => g.category === filterCategory);
    if (filterStatus !== 'all') list = list.filter((g) => g.status === filterStatus);
    list.sort((a, b) => {
      if (a.status === 'fixed' && b.status !== 'fixed') return 1;
      if (a.status !== 'fixed' && b.status === 'fixed') return -1;
      const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sev !== 0) return sev;
      return (b.score_impact || 0) - (a.score_impact || 0);
    });
    return list;
  }, [gaps, filterCategory, filterStatus]);

  const handleAdd = async () => {
    const title = form.title.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await window.__workspaceDb.from('funding_gaps').insert({
        title,
        category: form.category,
        severity: form.severity,
        status: 'open',
        score_impact: form.score_impact,
        notes: form.notes.trim() || null,
        assessment_ref: form.assessment_ref.trim() || null,
      });
      setForm({
        title: '',
        category: 'idea_clarity',
        severity: 'medium',
        score_impact: 5,
        notes: '',
        assessment_ref: '',
      });
      setShowForm(false);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (gap: FundingGap, status: GapStatus) => {
    await window.__workspaceDb.from('funding_gaps').update(gap.id, { status });
    refresh();
  };

  const handleDelete = async (id: number) => {
    await window.__workspaceDb.from('funding_gaps').delete(id);
    refresh();
  };

  const handleSeverityChange = (severity: Severity) => {
    setForm((f) => ({ ...f, severity, score_impact: SEVERITY_IMPACT[severity] }));
  };

  const suggestFix = async (gap: FundingGap) => {
    setAiLoadingId(gap.id);
    try {
      const cat = categoryMeta(gap.category);
      const res = await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a startup advisor for FoundarOS. Give concise, actionable advice (3-4 bullet points) for closing funding-readiness gaps. Be encouraging and specific.',
            },
            {
              role: 'user',
              content: `Gap: "${gap.title}" in category "${cat.label}" (severity: ${gap.severity}). ${gap.notes ? `Notes: ${gap.notes}` : ''} ${gap.assessment_ref ? `From assessment: ${gap.assessment_ref}` : ''}. What concrete steps should the founder take to close this gap before approaching investors?`,
            },
          ],
          max_tokens: 400,
          temperature: 0.7,
        }),
      });
      const data = await res.json();
      const suggestion = data.choices?.[0]?.message?.content || 'Could not generate suggestion.';
      const updatedNotes = gap.notes
        ? `${gap.notes}\n\n--- AI Fix Plan ---\n${suggestion}`
        : `--- AI Fix Plan ---\n${suggestion}`;
      await window.__workspaceDb.from('funding_gaps').update(gap.id, { notes: updatedNotes });
      setExpandedId(gap.id);
      refresh();
    } catch {
      /* silent — AI is optional enhancement */
    } finally {
      setAiLoadingId(null);
    }
  };

  const statusIcon = (status: GapStatus) => {
    if (status === 'fixed') return <CheckCircle2 className={`w-4 h-4 ${tw.icon.success}`} />;
    if (status === 'in_progress') return <Clock className={`w-4 h-4 ${tw.icon.primary}`} />;
    return <Circle className={`w-4 h-4 ${tw.icon.muted}`} />;
  };

  const severityBadge = (severity: Severity) => {
    const map: Record<Severity, string> = {
      critical: tw.badge.danger,
      high: tw.badge.warning,
      medium: tw.badge.primary,
      low: tw.badge.neutral,
    };
    return (
      <span className={`${tw.badge.default} ${map[severity]} capitalize`}>{severity}</span>
    );
  };

  return (
    <div className="flex flex-col w-full bg-transparent">
      {/* Hero: score + category breakdown */}
      <div className="px-5 pt-4 pb-5 border-b border-[var(--space-border-default)]">
        <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
          <ScoreRing score={readinessScore} />

          <div className="flex-1 min-w-0 w-full">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className={`w-5 h-5 ${tw.icon.primary}`} />
              <h2 className={`text-lg font-semibold ${tw.typography.color.brand}`}>Funding Readiness</h2>
            </div>
            <p className={`text-sm ${tw.typography.color.secondary} mb-4 max-w-md`}>
              Close gaps across four pillars to raise your score before investor conversations.
              {stats.recoverable > 0 && (
                <span className={`block mt-1 font-medium ${tw.typography.color.primary}`}>
                  +{stats.recoverable} points recoverable from open gaps
                </span>
              )}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {categoryScores.map((cat) => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setFilterCategory(filterCategory === cat.id ? 'all' : cat.id)}
                    className={`${tw.card.flat} p-3 text-left transition-all hover:shadow-md ${
                      filterCategory === cat.id ? 'ring-2 ring-[var(--space-brand-primary)] ring-offset-1' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon className={`w-3.5 h-3.5 ${tw.icon.primary}`} />
                      <span className={`text-[11px] font-medium truncate ${tw.typography.color.secondary}`}>
                        {cat.short}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-xl font-bold ${tw.typography.color.brand}`}>{cat.score}</span>
                      {cat.openCount > 0 && (
                        <span className={`text-[10px] ${tw.typography.color.tertiary}`}>
                          · {cat.openCount} open
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-[var(--space-border-default)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--space-brand-primary)] transition-all duration-500"
                        style={{ width: `${cat.score}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Stat pills */}
        <div className="flex flex-wrap gap-2 mt-4">
          {[
            { label: 'Open', value: stats.open, filter: 'open' as const },
            { label: 'In progress', value: stats.inProgress, filter: 'in_progress' as const },
            { label: 'Fixed', value: stats.fixed, filter: 'fixed' as const },
          ].map((s) => (
            <button
              key={s.filter}
              onClick={() => setFilterStatus(filterStatus === s.filter ? 'all' : s.filter)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                filterStatus === s.filter
                  ? `${tw.button.primary} shadow-sm`
                  : `${tw.bg.muted} ${tw.typography.color.secondary} hover:brightness-95`
              }`}
            >
              {s.label} · {s.value}
            </button>
          ))}
          {(filterCategory !== 'all' || filterStatus !== 'all') && (
            <button
              onClick={() => {
                setFilterCategory('all');
                setFilterStatus('all');
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 ${tw.button.ghost}`}
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="px-5 py-3 flex items-center justify-between gap-3 border-b border-[var(--space-border-default)]">
        <div className="flex items-center gap-2">
          <Filter className={`w-4 h-4 ${tw.icon.muted}`} />
          <span className={`text-sm ${tw.typography.color.secondary}`}>
            {filteredGaps.length} gap{filteredGaps.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className={`px-3.5 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 ${tw.button.primary}`}
          data-testid="button-add-gap"
        >
          <Plus className="w-4 h-4" />
          Log gap
        </button>
      </div>

      {/* Add gap form */}
      {showForm && (
        <div className={`mx-5 mt-3 p-4 ${tw.card.default} animate-in fade-in slide-in-from-top-2 duration-200`}>
          <div className="space-y-3">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="What's holding you back? e.g. No validated customer interviews"
              className={`${tw.input.base} ${tw.input.default} text-sm py-2.5`}
              data-testid="input-gap-title"
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: cat.id }))}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-all ${
                      form.category === cat.id
                        ? 'border-[var(--space-brand-primary)] bg-[var(--space-brand-primary-50)] text-[var(--space-text-brand)]'
                        : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] hover:border-[var(--space-brand-primary-200)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {cat.short}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => handleSeverityChange(sev)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                    form.severity === sev
                      ? `${tw.button.primary}`
                      : `${tw.bg.muted} ${tw.typography.color.secondary}`
                  }`}
                >
                  {sev} · +{SEVERITY_IMPACT[sev]} pts
                </button>
              ))}
            </div>

            <input
              type="text"
              value={form.assessment_ref}
              onChange={(e) => setForm((f) => ({ ...f, assessment_ref: e.target.value }))}
              placeholder="Assessment question ref (optional)"
              className={`${tw.input.base} ${tw.input.default} text-sm py-2`}
            />

            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Notes from your assessment or what you've tried..."
              rows={2}
              className={`${tw.input.base} ${tw.input.default} text-sm py-2 resize-none`}
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowForm(false)}
                className={`px-3 py-2 rounded-lg text-sm ${tw.button.ghost}`}
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={busy || !form.title.trim()}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${tw.button.primary} disabled:opacity-40`}
                data-testid="button-save-gap"
              >
                Add to board
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gap board */}
      <div className="flex-1 px-5 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-[var(--space-border-default)] border-t-[var(--space-brand-primary)]" />
            <p className={`text-sm ${tw.typography.color.tertiary}`}>Loading your gap board…</p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className={`text-sm ${tw.typography.color.danger}`}>Couldn't load gaps: {error.message}</p>
            <button onClick={refresh} className={`mt-3 px-3 py-1.5 text-sm rounded-lg ${tw.button.secondary}`}>
              Try again
            </button>
          </div>
        ) : filteredGaps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center max-w-sm mx-auto">
            <div className={`w-14 h-14 rounded-2xl ${tw.bg.muted} flex items-center justify-center`}>
              <ListChecks className={`w-7 h-7 ${tw.icon.muted}`} />
            </div>
            <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>
              {stats.total === 0 ? 'No gaps logged yet' : 'No gaps match your filters'}
            </p>
            <p className={`text-xs ${tw.typography.color.tertiary}`}>
              {stats.total === 0
                ? 'After your 30-question assessment, log every gap holding you back from investor readiness.'
                : 'Try clearing filters to see all gaps.'}
            </p>
            {stats.total === 0 && (
              <button
                onClick={() => setShowForm(true)}
                className={`mt-2 px-4 py-2 rounded-lg text-sm font-medium ${tw.button.primary}`}
              >
                Log your first gap
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filteredGaps.map((gap) => {
              const cat = categoryMeta(gap.category);
              const CatIcon = cat.icon;
              const isExpanded = expandedId === gap.id;
              const isFixed = gap.status === 'fixed';

              return (
                <li
                  key={gap.id}
                  className={`group ${tw.card.default} overflow-hidden transition-all duration-200 ${
                    isFixed ? 'opacity-60' : 'hover:shadow-md'
                  }`}
                  data-testid={`row-gap-${gap.id}`}
                >
                  <div className="flex items-start gap-3 p-3.5">
                    {/* Status cycle button */}
                    <button
                      onClick={() => {
                        const next: GapStatus =
                          gap.status === 'open'
                            ? 'in_progress'
                            : gap.status === 'in_progress'
                              ? 'fixed'
                              : 'open';
                        handleStatusChange(gap, next);
                      }}
                      className="mt-0.5 shrink-0 p-0.5 rounded-md hover:bg-[var(--space-surface-muted)] transition-colors"
                      title={`Status: ${gap.status} — click to advance`}
                      data-testid={`button-status-gap-${gap.id}`}
                    >
                      {statusIcon(gap.status)}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className={`text-sm font-medium ${
                            isFixed
                              ? `${tw.typography.color.tertiary} line-through`
                              : tw.typography.color.primary
                          }`}
                        >
                          {gap.title}
                        </span>
                        {severityBadge(gap.severity)}
                        <span className={`${tw.badge.default} ${tw.badge.neutral} flex items-center gap-0.5`}>
                          <ArrowUpRight className="w-3 h-3" />
                          +{gap.score_impact} pts
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 text-[11px] ${tw.typography.color.tertiary}`}>
                          <CatIcon className="w-3 h-3" />
                          {cat.label}
                        </span>
                        {gap.assessment_ref && (
                          <span className={`text-[11px] ${tw.typography.color.muted}`}>
                            · {gap.assessment_ref}
                          </span>
                        )}
                      </div>

                      {gap.notes && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : gap.id)}
                          className={`mt-2 text-left w-full`}
                        >
                          <p
                            className={`text-xs ${tw.typography.color.secondary} ${
                              isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
                            }`}
                          >
                            {gap.notes}
                          </p>
                          {!isExpanded && gap.notes.length > 100 && (
                            <span className={`text-[10px] ${tw.typography.color.tertiary}`}>Show more</span>
                          )}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {!isFixed && (
                        <button
                          onClick={() => suggestFix(gap)}
                          disabled={aiLoadingId === gap.id}
                          className={`p-1.5 rounded-md ${tw.button.ghost} hover:${tw.bg.accent}`}
                          title="Get AI fix plan"
                          data-testid={`button-ai-gap-${gap.id}`}
                        >
                          {aiLoadingId === gap.id ? (
                            <div className="w-4 h-4 animate-spin rounded-full border-2 border-[var(--space-border-default)] border-t-[var(--space-brand-primary)]" />
                          ) : (
                            <Sparkles className={`w-4 h-4 ${tw.icon.accent}`} />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(gap.id)}
                        className={`p-1.5 rounded-md ${tw.button.ghost} hover:text-[var(--space-semantic-danger)]`}
                        aria-label="Delete gap"
                        data-testid={`button-delete-gap-${gap.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * ORCHESTRATOR — decides which surface to show and owns assessment state
 * ========================================================================== */
type View = 'loading' | 'intro' | 'assessment' | 'results' | 'board';

interface AssessmentResult {
  overall: number;
  categoryScores: Record<CategoryId, number>;
  topGaps: TopGap[];
}

export default function GapRadar() {
  const {
    data: gaps,
    loading: gapsLoading,
    error: gapsError,
    refresh: refreshGaps,
  } = window.useWorkspaceDB<FundingGap>('funding_gaps', {
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 200,
  });

  const { data: sessionRows, loading: sessionsLoading } = window.useWorkspaceDB<AssessmentSessionRow>(
    'assessment_sessions',
    {
      orderBy: { column: 'created_at', direction: 'desc' },
      limit: 1,
    },
  );

  // Verified Founder Pack purchases for THIS visitor (session-scoped reads).
  const {
    data: packRows,
    loading: packsLoading,
    refresh: refreshPacks,
  } = window.useWorkspaceDB<ReadinessPackRow>('readiness_packs', {
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 5,
  });

  const {
    data: onboardingRows,
    loading: onboardingLoading,
    refresh: refreshOnboarding,
  } = window.useWorkspaceDB<OnboardingProfileRow>('onboarding_profiles', {
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 1,
  });

  const {
    data: snapshotRows,
    loading: snapshotsLoading,
    refresh: refreshSnapshots,
  } = window.useWorkspaceDB<ReadinessSnapshotRow>('readiness_snapshots', {
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 1,
  });

  const [view, setView] = useState<View>('loading');
  const [rowId, setRowId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [index, setIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const initializedRef = useRef(false);
  const completedRef = useRef(false);

  // Paid Founder Pack state (post-payment verification + generated documents)
  const [paymentNotice, setPaymentNotice] = useState<PaymentNotice | null>(null);
  const [rebuildingPack, setRebuildingPack] = useState(false);
  const [paidScreen, setPaidScreen] = useState<PaidScreen>('dashboard');
  const [paymentConfirmation, setPaymentConfirmation] = useState<PaymentConfirmation | null>(null);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [localSnapshot, setLocalSnapshot] = useState<ReadinessScores | null>(null);
  const paymentCheckRef = useRef(false);
  const paidRouteInitializedRef = useRef(false);

  // Founder-test preview pack, held in browser memory ONLY. Paid state on
  // readiness_packs is server-owned (protected columns + no client inserts),
  // so the simulation never writes to the database — see simulateTestPurchase.
  const [testPack, setTestPack] = useState<{
    documents: PackDocument[];
    generatedAt: string;
    overallScore: number;
  } | null>(null);

  const paidPack = (packRows || []).find((p) => p.status === 'paid') || null;
  const paidAccess = !!(paidPack || testPack || paymentConfirmation);
  const onboardingProfile = (onboardingRows || []).find((profile) => profile.status === 'completed') || null;
  const storedSnapshot = snapshotRows?.[0] ? snapshotRowToScores(snapshotRows[0]) : null;
  const currentSnapshot = localSnapshot || storedSnapshot;
  const packDocuments = useMemo(() => {
    const parsed = paidPack
      ? parseJsonField<unknown>(paidPack.documents, [])
      : testPack
        ? testPack.documents
        : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (doc): doc is PackDocument =>
        !!doc &&
        typeof doc === 'object' &&
        typeof doc.id === 'string' &&
        typeof doc.title === 'string' &&
        typeof doc.description === 'string' &&
        typeof doc.filename === 'string' &&
        typeof doc.content === 'string',
    );
  }, [paidPack, testPack]);

  useEffect(() => {
    if (!paidAccess || paidRouteInitializedRef.current || onboardingLoading || snapshotsLoading || paymentConfirmation) return;
    paidRouteInitializedRef.current = true;
    setPaidScreen(onboardingProfile ? 'dashboard' : 'onboarding');
  }, [paidAccess, onboardingLoading, snapshotsLoading, onboardingProfile, paymentConfirmation]);

  const saveOnboarding = async (profile: OnboardingAnswers) => {
    if (savingOnboarding) return;
    setSavingOnboarding(true);
    setOnboardingError(null);
    const scores = computeReadinessSnapshot(profile);
    const profilePayload = {
      ...profile,
      needs: JSON.stringify(profile.needs),
      status: 'completed',
      step_completed: 5,
      completed_at: new Date().toISOString(),
    };
    const snapshotPayload = {
      overall_score: scores.overall_score,
      business_clarity: scores.business_clarity,
      legal_compliance: scores.legal_compliance,
      pitch_readiness: scores.pitch_readiness,
      investor_readiness: scores.investor_readiness,
      financial_preparation: scores.financial_preparation,
      recommendations: JSON.stringify(scores.recommendations),
      generated_at: new Date().toISOString(),
    };
    try {
      const existingProfile = onboardingRows?.[0];
      if (existingProfile) await window.__workspaceDb.from('onboarding_profiles').update(existingProfile.id, profilePayload);
      else await window.__workspaceDb.from('onboarding_profiles').insert(profilePayload);
      const existingSnapshot = snapshotRows?.[0];
      if (existingSnapshot) await window.__workspaceDb.from('readiness_snapshots').update(existingSnapshot.id, snapshotPayload);
      else await window.__workspaceDb.from('readiness_snapshots').insert(snapshotPayload);
      setLocalSnapshot(scores);
      refreshOnboarding();
      refreshSnapshots();
      setPaidScreen('snapshot');
    } catch {
      setOnboardingError('We could not save your profile. Check your connection and try again.');
    } finally {
      setSavingOnboarding(false);
    }
  };

  // Decide the initial view once the latest assessment session has loaded.
  useEffect(() => {
    if (initializedRef.current || sessionsLoading) return;
    initializedRef.current = true;

    const latest = sessionRows?.[0];
    if (latest && latest.status === 'in_progress') {
      const savedAnswers = parseJsonField<AnswerMap>(latest.answers, {});
      const savedIndex = Math.min(Math.max(latest.current_index ?? 0, 0), TOTAL_QUESTIONS - 1);
      setRowId(latest.id);
      setAnswers(savedAnswers);
      setIndex(savedIndex);
      setView('assessment');
    } else if (latest && latest.status === 'completed') {
      const categoryScores = parseJsonField<Record<CategoryId, number>>(
        latest.category_scores,
        computeCategoryScores(parseJsonField<AnswerMap>(latest.answers, {})),
      );
      setResult({
        overall: latest.overall_score ?? computeOverallScore(categoryScores),
        categoryScores,
        topGaps: parseJsonField<TopGap[]>(latest.top_gaps, []),
      });
      setView('results');
    } else {
      setView('intro');
    }
  }, [sessionsLoading, sessionRows]);

  const persistProgress = useCallback(
    (nextAnswers: AnswerMap, nextIndex: number) => {
      if (!rowId) return;
      window.__workspaceDb
        .from('assessment_sessions')
        .update(rowId, { answers: nextAnswers, current_index: nextIndex })
        .catch(() => {
          /* keep going — answers stay in memory; next save retries */
        });
    },
    [rowId],
  );

  const startAssessment = async () => {
    if (starting) return;
    setStarting(true);
    completedRef.current = false;
    try {
      await window.__workspaceDb.from('assessment_sessions').insert({
        status: 'in_progress',
        current_index: 0,
        answers: {},
      });
      // Reads are session-scoped, so the newest row is this visitor's new session.
      const { data } = await window.__workspaceDb
        .from('assessment_sessions')
        .orderBy('created_at', 'desc')
        .limit(1)
        .get();
      const created = data?.[0] as { id?: number } | undefined;
      setRowId(typeof created?.id === 'number' ? created.id : null);
    } catch {
      // Persistence unavailable — still let the founder take the assessment in-memory.
      setRowId(null);
    } finally {
      setAnswers({});
      setIndex(0);
      setResult(null);
      setView('assessment');
      setStarting(false);
    }
  };

  const handleAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      // Persist choice selections immediately; free text is persisted on Next.
      if (QUESTIONS[index]?.type === 'choice') persistProgress(next, index);
      return next;
    });
  };

  const completeAssessment = async (finalAnswers: AnswerMap) => {
    if (completedRef.current || completing) return;
    completedRef.current = true;
    setCompleting(true);

    const categoryScores = computeCategoryScores(finalAnswers);
    const overall = computeOverallScore(categoryScores);
    const topGaps = computeTopGaps(finalAnswers, categoryScores);
    setResult({ overall, categoryScores, topGaps });

    // WorkspaceDB's JSON write boundary accepts objects directly, but JSON
    // arrays must be serialized or PostgreSQL rejects them as invalid JSON.
    // Keep session completion and board seeding independent: a failed session
    // update must never suppress the founder's free gap board.
    try {
      if (rowId) {
        await window.__workspaceDb.from('assessment_sessions').update(rowId, {
          status: 'completed',
          answers: finalAnswers,
          current_index: TOTAL_QUESTIONS,
          overall_score: overall,
          category_scores: categoryScores,
          top_gaps: JSON.stringify(topGaps),
          completed_at: new Date().toISOString(),
        });
      }
    } catch {
      /* results still show from local state; progress was saved on each step */
    }

    try {
      // Seed the existing gap board with the top gaps so the tracker below is
      // pre-populated and the manual workflow keeps working.
      for (const gap of topGaps) {
        await window.__workspaceDb.from('funding_gaps').insert({
          title: gap.title,
          category: gap.category,
          severity: gap.severity,
          status: 'open',
          score_impact: gap.score_impact,
          notes: `From your assessment (${gap.assessment_ref}) — you answered “${gap.answer_label}”. Recommended action: ${gap.action}`,
          assessment_ref: gap.assessment_ref,
        });
      }
      refreshGaps();
    } catch {
      /* results remain available; individual gaps can still be logged manually */
    } finally {
      setCompleting(false);
      setView('results');
    }
  };

  const handleNext = () => {
    persistProgress(answers, Math.min(index + 1, TOTAL_QUESTIONS - 1));
    if (index >= TOTAL_QUESTIONS - 1) {
      completeAssessment(answers);
    } else {
      setIndex(index + 1);
    }
  };

  const handleBack = () => {
    if (index === 0) return;
    persistProgress(answers, index - 1);
    setIndex(index - 1);
  };

  const handleRetake = () => {
    startAssessment();
  };

  /* --- Paid Founder Pack: payment verification + document generation ------ */

  // Build the generation input from the newest COMPLETED assessment. The
  // in-memory result is a safe fallback before redirect; after a full reload,
  // missing completed data must stop fulfillment rather than create templates.
  const loadLatestAssessmentInput = useCallback(async (): Promise<PackInput> => {
    let completedRow: Record<string, unknown> | null = null;
    try {
      const { data } = await window.__workspaceDb
        .from('assessment_sessions')
        .orderBy('created_at', 'desc')
        .limit(10)
        .get();
      completedRow =
        (data || []).find((row) => (row as { status?: string }).status === 'completed') ?? null;
    } catch {
      completedRow = null;
    }

    const storedAnswers = parseJsonField<AnswerMap>(completedRow?.answers, {});
    const finalAnswers = Object.keys(storedAnswers).length > 0 ? storedAnswers : result ? answers : {};
    const categoryScores = computeCategoryScores(finalAnswers);
    const input: PackInput = {
      answers: finalAnswers,
      categoryScores,
      overallScore: computeOverallScore(categoryScores),
      topGaps: computeTopGaps(finalAnswers, categoryScores),
    };
    if (!isCompletePackInput(input)) {
      throw new Error('assessment_incomplete');
    }
    return input;
  }, [answers, result]);

  // Flutterwave returns with a checkout reference. The app confirms it through
  // the Flutterwave hook before generating documents or granting access.
  useEffect(() => {
    if (paymentCheckRef.current || packsLoading) return;
    const params = new URLSearchParams(window.location.search);
    const checkoutSessionId = params.get('session_id') || params.get('tx_ref');
    const flaggedSuccess = params.get('payment_success') === 'true';
    // Flutterwave appends status/tx_ref/transaction_id to the redirect URL.
    const returnStatus = (params.get('status') || '').toLowerCase();
    if (!checkoutSessionId && !flaggedSuccess && !returnStatus) {
      paymentCheckRef.current = true;
      return;
    }
    paymentCheckRef.current = true;

    const cleanUrl = () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('session_id');
        url.searchParams.delete('payment_success');
        url.searchParams.delete('payment_provider');
        url.searchParams.delete('status');
        url.searchParams.delete('tx_ref');
        url.searchParams.delete('transaction_id');
        window.history.replaceState({}, '', url.toString());
      } catch {
        /* ignore */
      }
    };

    if (returnStatus === 'cancelled' || returnStatus === 'canceled' || returnStatus === 'failed') {
      setPaymentNotice({
        state: 'error',
        message: 'The checkout was not completed and no charge was made. You can unlock the pack any time.',
      });
      cleanUrl();
      return;
    }

    const knownRow = checkoutSessionId
      ? (packRows || []).find((p) => p.stripe_session_id === checkoutSessionId) || null
      : null;

    if (knownRow && knownRow.status === 'paid') {
      setPaymentConfirmation({
        reference: params.get('tx_ref') || knownRow.provider_tx_id || knownRow.stripe_session_id || checkoutSessionId || 'Flutterwave payment',
        paidAt: knownRow.paid_at || new Date().toISOString(),
      });
      setPaidScreen('payment-success');
      cleanUrl();
      return;
    }

    if (!checkoutSessionId) {
      if ((packRows || []).length === 0) {
        setPaymentNotice({
          state: 'error',
          message:
            "We couldn't confirm the payment automatically (the return link is missing the checkout reference). If you were charged, reply in the chat and we'll unlock your documents.",
        });
      }
      cleanUrl();
      return;
    }

    (async () => {
      setPaymentNotice({ state: 'verifying' });
      try {
        // The Flutterwave hook verifies the charge and enforces $99 USD before
        // writing protected paid-state columns. The browser can only write
        // generated documents onto the verified purchase row.
        const confirmation = await callPaymentHook({
          action: 'confirm',
          sessionId: checkoutSessionId,
          transactionId: params.get('transaction_id') || undefined,
        });
        if (!confirmation.httpOk || confirmation.ok !== true) {
          if (confirmation.code === 'amount_mismatch') {
            setPaymentNotice({
              state: 'error',
              message: 'This payment does not match the $99 Funding Readiness Pack. Your documents were not unlocked.',
            });
            cleanUrl();
            return;
          }
          setPaymentNotice({
            state: 'error',
            message:
              confirmation.code === 'not_paid' || confirmation.code === 'webhook_pending'
                ? 'This payment is waiting for the secure provider confirmation. Wait a few seconds and reload this page to retry.'
                : 'We could not verify the payment right now. Your payment is safe — reload this page to retry.',
          });
          return;
        }
        setPaymentConfirmation({
          reference: params.get('tx_ref') || params.get('transaction_id') || checkoutSessionId,
          paidAt: new Date().toISOString(),
        });
        setPaidScreen('payment-success');
        setPaymentNotice({ state: 'generating' });
        const input = await loadLatestAssessmentInput();
        const documents = await generatePackDocumentsAI(input);
        if (!validatePackDocuments(documents, input)) {
          throw new Error('document_validation_failed');
        }
        const packRowId = knownRow?.id ?? confirmation.packId;
        if (!packRowId) throw new Error('verified_pack_missing');
        await window.__workspaceDb.from('readiness_packs').update(packRowId, {
          documents: JSON.stringify(documents),
          overall_score: input.overallScore,
          generated_at: new Date().toISOString(),
        });
        refreshPacks();
        setPaymentNotice(null);
        cleanUrl();
      } catch (error) {
        const assessmentMissing = error instanceof Error && error.message === 'assessment_incomplete';
        setPaymentNotice({
          state: 'error',
          message: assessmentMissing
            ? 'Your payment is confirmed, but a completed assessment was not found. Complete the assessment, then reload this page to build your documents.'
            : 'Something went wrong while preparing your documents. Your payment is safe — reload this page to retry.',
        });
      }
    })();
  }, [packsLoading, packRows, loadLatestAssessmentInput, refreshPacks]);

  // FOUNDER TEST PATH — checkout uses the server-configured Flutterwave key,
  // so this simulation exercises everything AFTER payment success without
  // touching Flutterwave or the database. Paid state is server-only, so
  // the preview pack lives in browser memory for this page visit and is gone
  // on reload. It can never unlock documents for real customers.
  const [simulatingPurchase, setSimulatingPurchase] = useState(false);
  const simulateTestPurchase = async () => {
    if (simulatingPurchase || paidPack || testPack) return;
    setSimulatingPurchase(true);
    setPaymentNotice({ state: 'generating' });
    try {
      const input = await loadLatestAssessmentInput();
      const documents = await generatePackDocumentsAI(input);
      if (!validatePackDocuments(documents, input)) {
        throw new Error('document_validation_failed');
      }
      const generatedAt = new Date().toISOString();
      setTestPack({
        documents,
        generatedAt,
        overallScore: input.overallScore,
      });
      setPaymentConfirmation({ reference: `founder_preview_${Date.now()}`, paidAt: generatedAt });
      setPaidScreen('payment-success');
      setPaymentNotice(null);
    } catch (error) {
      console.error('[GapRadar] Preview document generation failed:', error);
      setPaymentNotice({
        state: 'error',
        message: 'Preview document generation failed. Please try again; if it continues, share this message with support.',
      });
    } finally {
      setSimulatingPurchase(false);
    }
  };

  // Regenerate the pack from the latest assessment results (e.g. after a
  // retake). For a real purchase this updates the row's non-protected document
  // fields; for the founder-test preview it regenerates the in-memory pack.
  const rebuildPack = async () => {
    if ((!paidPack && !testPack) || rebuildingPack) return;
    setRebuildingPack(true);
    try {
      const input = await loadLatestAssessmentInput();
      const documents = await generatePackDocumentsAI(input);
      if (!validatePackDocuments(documents, input)) {
        throw new Error('document_validation_failed');
      }
      if (paidPack) {
        await window.__workspaceDb.from('readiness_packs').update(paidPack.id, {
          documents: JSON.stringify(documents),
          overall_score: input.overallScore,
          generated_at: new Date().toISOString(),
        });
        refreshPacks();
      } else {
        setTestPack({
          documents,
          generatedAt: new Date().toISOString(),
          overallScore: input.overallScore,
        });
      }
    } catch {
      /* keep the previous documents — the founder can retry */
    } finally {
      setRebuildingPack(false);
    }
  };

  // Either provider hook can mark a pack paid before this browser generates
  // documents — for example when a verified webhook arrives after the buyer
  // closes the tab. When a paid pack has no documents, build them once.
  const autoBuildRef = useRef(false);
  useEffect(() => {
    if (autoBuildRef.current || packsLoading || !paidPack || rebuildingPack) return;
    if (packDocuments.length > 0) return;
    if (paymentNotice && (paymentNotice.state === 'verifying' || paymentNotice.state === 'generating')) return;
    autoBuildRef.current = true;
    (async () => {
      setPaymentNotice({ state: 'generating' });
      try {
        const input = await loadLatestAssessmentInput();
        const documents = await generatePackDocumentsAI(input);
        if (!validatePackDocuments(documents, input)) {
          throw new Error('document_validation_failed');
        }
        await window.__workspaceDb.from('readiness_packs').update(paidPack.id, {
          documents: JSON.stringify(documents),
          overall_score: input.overallScore,
          generated_at: new Date().toISOString(),
        });
        refreshPacks();
        setPaymentNotice({ state: 'success' });
      } catch (error) {
        const assessmentMissing = error instanceof Error && error.message === 'assessment_incomplete';
        setPaymentNotice({
          state: 'error',
          message: assessmentMissing
            ? 'Your payment is confirmed, but a completed assessment was not found. Complete the assessment, then reload this page to build your documents.'
            : 'Something went wrong while preparing your documents. Your payment is safe — reload this page to retry.',
        });
      }
    })();
  }, [packsLoading, paidPack, packDocuments, rebuildingPack, paymentNotice, loadLatestAssessmentInput, refreshPacks]);

  if (paidAccess && paidScreen !== 'gap-radar') {
    if (paidScreen === 'payment-success' && paymentConfirmation) {
      return <PaymentSuccessScreen confirmation={paymentConfirmation} onStart={() => setPaidScreen('onboarding')} />;
    }
    const navigatePaid = (screen: PaidScreen) => {
      if (screen === 'profile' && !onboardingProfile) setPaidScreen('onboarding');
      else setPaidScreen(screen);
    };
    if (onboardingLoading || snapshotsLoading) {
      return <div className="min-h-full flex flex-col items-center justify-center py-16 gap-3"><div className="animate-spin rounded-full h-7 w-7 border-2 border-[var(--space-border-default)] border-t-[var(--space-brand-primary)]" /><p className={`text-sm ${tw.typography.color.tertiary}`}>Loading your fundraising workspace…</p></div>;
    }
    return (
      <PaidPage active={paidScreen} onNavigate={navigatePaid}>
        {paidScreen === 'onboarding' && (
          <OnboardingScreen
            key={`${onboardingProfile?.id || 'new'}-${onboardingProfile?.updated_at || ''}`}
            initial={profileToAnswers(onboardingProfile)}
            saving={savingOnboarding}
            error={onboardingError}
            onSubmit={saveOnboarding}
            onCancel={onboardingProfile ? () => setPaidScreen('profile') : undefined}
          />
        )}
        {paidScreen === 'snapshot' && currentSnapshot && <ReadinessSnapshotScreen scores={currentSnapshot} onJourney={() => setPaidScreen('dashboard')} />}
        {paidScreen === 'dashboard' && <JourneyDashboard profile={onboardingProfile} snapshot={currentSnapshot} documents={packDocuments} onNavigate={navigatePaid} />}
        {paidScreen === 'documents' && <DocumentVaultScreen documents={packDocuments} generatedAt={paidPack ? paidPack.generated_at : testPack?.generatedAt || null} rebuilding={rebuildingPack} onRebuild={rebuildPack} />}
        {paidScreen === 'profile' && onboardingProfile && <ProfileScreen profile={onboardingProfile} onEdit={() => setPaidScreen('onboarding')} />}
      </PaidPage>
    );
  }

  // The stage-aware diagnostic is now the primary assessment and report flow.
  // Paid navigation, payment verification, document generation and the existing
  // gap board remain in this orchestrator so verified purchases keep their
  // established fulfillment path.
  if (view !== 'board') {
    return (
      <div className="min-h-full flex flex-col w-full bg-transparent overflow-y-auto">
        {paidAccess && <PaidNavigation active="gap-radar" onNavigate={(screen) => setPaidScreen(screen)} />}
        {paymentNotice && (
          <PaymentNoticeBanner notice={paymentNotice} onDismiss={() => setPaymentNotice(null)} />
        )}
        <StageDiagnostic
          paidAccess={paidAccess}
          onOpenBoard={() => setView('board')}
          upgradeSlot={
            paidPack || testPack ? (
              <>
                <DocumentsSection
                  documents={packDocuments}
                  generatedAt={paidPack ? paidPack.generated_at : testPack ? testPack.generatedAt : null}
                  onRebuild={rebuildPack}
                  rebuilding={rebuildingPack}
                />
                <PitchCoachSection />
              </>
            ) : (
              <PaywallCard
                onSimulateTestPurchase={simulateTestPurchase}
                simulating={simulatingPurchase}
              />
            )
          }
        />
      </div>
    );
  }

  if (view === 'loading') {
    return (
      <div className="min-h-full flex flex-col items-center justify-center py-16 gap-3">
        <div className="animate-spin rounded-full h-7 w-7 border-2 border-[var(--space-border-default)] border-t-[var(--space-brand-primary)]" />
        <p className={`text-sm ${tw.typography.color.tertiary}`}>Loading Gap Radar…</p>
      </div>
    );
  }

  if (view === 'intro') {
    return (
      <IntroScreen
        onStart={startAssessment}
        onViewBoard={() => setView('board')}
        starting={starting}
        hasExistingGaps={paidAccess && (gaps || []).length > 0}
      />
    );
  }

  if (view === 'assessment') {
    return (
      <AssessmentScreen
        index={index}
        answers={answers}
        onAnswer={handleAnswer}
        onBack={handleBack}
        onNext={handleNext}
        saving={completing}
      />
    );
  }

  if (view === 'board') {
    return (
      <div className="min-h-full flex flex-col w-full bg-transparent overflow-y-auto">
        {paidAccess && <PaidNavigation active="gap-radar" onNavigate={(screen) => setPaidScreen(screen)} />}
        {paymentNotice && (
          <PaymentNoticeBanner notice={paymentNotice} onDismiss={() => setPaymentNotice(null)} />
        )}
        <div className="px-5 py-3 border-b border-[var(--space-border-default)] flex flex-wrap items-center justify-between gap-2">
          <span className={`text-xs ${tw.typography.color.secondary}`}>
            Your stage-aware report explains which evidence to build before your next funding milestone.
          </span>
          <button
            onClick={() => setView('results')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${tw.button.primary}`}
            data-testid="button-return-to-stage-report"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Back to report
          </button>
        </div>
        <GapBoard gaps={gaps || []} loading={gapsLoading} error={gapsError} refresh={refreshGaps} />
        <ComingSoonSection />
      </div>
    );
  }

  // Results view: assessment results on top, the live gap board below.
  return (
    <div className="min-h-full flex flex-col w-full bg-transparent overflow-y-auto">
      {paidAccess && <PaidNavigation active="gap-radar" onNavigate={(screen) => setPaidScreen(screen)} />}
      {paymentNotice && (
        <PaymentNoticeBanner notice={paymentNotice} onDismiss={() => setPaymentNotice(null)} />
      )}
      {result && (
        <ResultsScreen
          overall={result.overall}
          categoryScores={result.categoryScores}
          topGaps={result.topGaps}
          hasPaidAccess={paidAccess}
          onRetake={handleRetake}
          upgradeSlot={
            paidPack || testPack ? (
              <>
                <DocumentsSection
                  documents={packDocuments}
                  generatedAt={paidPack ? paidPack.generated_at : testPack ? testPack.generatedAt : null}
                  onRebuild={rebuildPack}
                  rebuilding={rebuildingPack}
                />
                <PitchCoachSection />
              </>
            ) : (
              <PaywallCard
                onSimulateTestPurchase={simulateTestPurchase}
                simulating={simulatingPurchase}
              />
            )
          }
        />
      )}
      <ComingSoonSection />
      {paidAccess && (
        <GapBoard gaps={gaps || []} loading={gapsLoading} error={gapsError} refresh={refreshGaps} />
      )}
    </div>
  );
}
