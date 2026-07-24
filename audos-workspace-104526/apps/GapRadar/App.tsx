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
} from 'lucide-react';
import { tw } from '../../lib/colors';
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
  stripe_session_id: string | null;
  status: string | null;
  customer_email: string | null;
  amount_cents: number | null;
  overall_score: number | null;
  documents: unknown;
  generated_at: string | null;
  created_at?: string;
}

interface PaymentNotice {
  state: 'verifying' | 'generating' | 'success' | 'error';
  message?: string;
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
 * PAYWALL — one-time unlock on the results screen.
 *
 * Uses the platform Stripe integration (`POST /api/payments/checkout`) by
 * default, or a Stripe Payment Link when STRIPE_PAYMENT_LINK_URL is set.
 *
 * ⚠️ KEY MODE (re-verified 2026-07-16): the platform payments API runs LIVE
 * Stripe keys — checkout sessions come back as `cs_live_...`, the 4242 test
 * card is DECLINED, and real cards ARE charged. There are NO sk_live_ /
 * pk_live_ keys anywhere in this codebase to swap for sk_test_ / pk_test_
 * ones: this app never touches Stripe directly. All payments are proxied
 * through the Audos platform (`/api/payments/*`) and the keys live
 * server-side on the platform — no workspace file, config value, request
 * flag, or header can switch them (probed testMode / mode / livemode flags
 * on 2026-07-16; every session still came back `cs_live_...`). Switching the
 * PLATFORM Stripe account to test mode is an Audos platform-side change, not
 * a workspace change.
 *
 * ✅ STRIPE TEST MODE (STRIPE_TEST_MODE = true, current state):
 * While the switch below is on, the LIVE platform checkout is disabled — the
 * unlock button never opens a live-mode session, so the 4242 card can't be
 * rejected and no real card can be charged. To run the full end-to-end test
 * checkout with card 4242 4242 4242 4242:
 * 1. In your Stripe dashboard, toggle to TEST mode and create a $49 Payment
 *    Link: https://dashboard.stripe.com/test/payment-links
 * 2. Under "After payment", choose "Don't show confirmation page" and set
 *    the redirect URL to your app's URL with this query appended:
 *      ?payment_success=true&session_id={CHECKOUT_SESSION_ID}
 * 3. Paste the link (starts with https://buy.stripe.com/test_...) into
 *    STRIPE_PAYMENT_LINK_URL below and publish.
 * The unlock button then opens Stripe's TEST checkout (4242 is accepted) and,
 * on return, the app completes the unlock + document generation. Test-mode
 * sessions (`cs_test_...`) can't be verified through the live-mode platform
 * API, so they are trusted while STRIPE_TEST_MODE is true — safe only
 * because live checkout is disabled in test mode.
 *
 * Alternative (no Stripe at all): while STRIPE_TEST_MODE is true, use the
 * "Generate test documents" button shown on the paywall. After test mode is
 * turned off, append ?founder_test=1 to expose the founder-only simulation.
 * It exercises the complete post-payment flow (purchase record → document
 * generation → downloads).
 *
 * 🚀 BEFORE REAL SALES: set STRIPE_TEST_MODE = false and either clear
 * STRIPE_PAYMENT_LINK_URL (to use the built-in platform checkout) or replace
 * it with a LIVE Payment Link (https://buy.stripe.com/... without `test_`).
 * ========================================================================== */

// TEST MODE SWITCH — while true, the live platform checkout is disabled (no
// real card can be charged, the 4242 test card is never sent to a live-mode
// session) and returns from a TEST-mode Payment Link unlock the documents.
// TODO(founder): set to false before selling for real.
const STRIPE_TEST_MODE = true;

// TODO(founder): paste your Stripe TEST-mode Payment Link here (create it at
// https://dashboard.stripe.com/test/payment-links — the URL starts with
// https://buy.stripe.com/test_...) to test checkout with card 4242 4242 4242
// 4242. Later, with STRIPE_TEST_MODE = false, a LIVE link
// ("https://buy.stripe.com/...") can be used for real sales, or leave this
// empty to use the built-in platform checkout.
const STRIPE_PAYMENT_LINK_URL = '';
const UNLOCK_PRICE_CENTS = 4900; // $49 one-time — TODO(founder): confirm pricing

function getStripePaymentLinkUrl(): string | null {
  const rawUrl = STRIPE_PAYMENT_LINK_URL.trim();
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const isStripePaymentLink = url.protocol === 'https:' && url.hostname === 'buy.stripe.com';
    const isTestLink = url.pathname.startsWith('/test_');
    if (!isStripePaymentLink || isTestLink !== STRIPE_TEST_MODE) {
      console.error('[GapRadar] Stripe Payment Link does not match the active Stripe mode.');
      return null;
    }
    return url.toString();
  } catch {
    console.error('[GapRadar] Stripe Payment Link is not a valid URL.');
    return null;
  }
}

/** Founder-only safe test mode: true in studio (entrepreneur) mode or when
 *  founder_test=1 appears anywhere in the URL. Enables a "simulate successful
 *  payment" button so the full post-payment flow (document generation →
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

function PaywallCard({
  onSimulateTestPurchase,
  simulating,
}: {
  onSimulateTestPurchase: () => void;
  simulating: boolean;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'unavailable' | 'testmode'>(() =>
    STRIPE_TEST_MODE && !getStripePaymentLinkUrl() ? 'testmode' : 'idle',
  );

  const handleUnlock = async () => {
    const paymentLinkUrl = getStripePaymentLinkUrl();
    if (paymentLinkUrl) {
      redirectToCheckout(paymentLinkUrl);
      return;
    }
    // Test mode without a valid Payment Link: block the LIVE platform checkout so
    // the 4242 test card is never rejected by a live-mode session and no real
    // card can be charged while payment testing is in progress.
    if (STRIPE_TEST_MODE) {
      setState('testmode');
      return;
    }
    setState('loading');
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
          productName: 'FoundarOS Funding Readiness Pack',
          productDescription: 'Five downloadable founder documents, including an editable PowerPoint pitch deck, plus the AI Pitch Coach',
          customerEmail: getSessionEmail() || undefined,
          // {CHECKOUT_SESSION_ID} is a Stripe template literal — Stripe replaces
          // it with the real Checkout session id on redirect, so the app can
          // verify the payment via GET /api/payments/status/:sessionId.
          successUrl:
            window.location.origin +
            window.location.pathname +
            '?payment_success=true&session_id={CHECKOUT_SESSION_ID}' +
            (window.location.hash || '#gap-radar'),
          cancelUrl: window.location.href,
        }),
      });
      const data = await res.json();
      if (res.ok && data?.checkoutUrl) {
        redirectToCheckout(data.checkoutUrl);
      } else {
        setState('unavailable');
      }
    } catch {
      setState('unavailable');
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
          <h4 className={`text-base font-semibold ${tw.typography.color.primary} mb-1`}>
            Ready to close your gaps faster?
          </h4>
          <p className={`text-sm ${tw.typography.color.secondary} mb-4`}>
            Unlock five downloadable documents plus AI coaching, all built from your assessment answers: a generated Business Plan, a
            full Pitch Deck — an editable, presentation-ready deck pre-populated with your brand name
            and preferred colours, with room to drop in your own logo — a 3-year Financial Model, a
            Grant Application Assistant, a step-by-step Action Plan, plus the interactive AI Pitch
            Coach for pitch practice with feedback.
          </p>
          {state === 'testmode' ? (
            <div className={`${tw.card.flat} p-3`} data-testid="notice-test-mode">
              <p className={`text-sm font-medium ${tw.typography.color.primary}`}>Payments are in test mode</p>
              <p className={`text-xs ${tw.typography.color.tertiary}`}>
                Live checkout is disabled and no cards are charged. Use the test button below to
                generate the full document pack and verify every download.
              </p>
            </div>
          ) : state === 'unavailable' ? (
            <div className={`${tw.card.flat} p-3`}>
              <p className={`text-sm font-medium ${tw.typography.color.primary}`}>Coming soon</p>
              <p className={`text-xs ${tw.typography.color.tertiary}`}>
                Payment setup is pending — check back shortly. Your results are saved.
              </p>
            </div>
          ) : (
            <button
              onClick={handleUnlock}
              disabled={state === 'loading'}
              className={`w-full sm:w-auto px-5 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ${tw.button.accent} disabled:opacity-50`}
              data-testid="button-unlock-plan"
            >
              {state === 'loading' ? (
                <div className="w-4 h-4 animate-spin rounded-full border-2 border-[var(--space-border-default)] border-t-[var(--space-text-on-highlight)]" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Unlock for ${(UNLOCK_PRICE_CENTS / 100).toFixed(0)} — one-time
            </button>
          )}

          {(STRIPE_TEST_MODE || isFounderTestMode()) && (
            <div className="mt-3" data-testid="section-founder-test">
              <button
                onClick={onSimulateTestPurchase}
                disabled={simulating}
                className={`w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-semibold ${tw.button.secondary} disabled:opacity-50`}
                data-testid="button-founder-test-unlock"
              >
                {simulating
                  ? 'Generating test documents…'
                  : STRIPE_TEST_MODE
                    ? 'Generate test documents (no charge)'
                    : 'Founder test: simulate successful payment (no charge)'}
              </button>
              <p className={`mt-2 text-xs ${tw.typography.color.tertiary}`}>
                {STRIPE_TEST_MODE
                  ? 'This skips Stripe and exercises the complete post-payment flow: document generation, saved access, and downloads. Test data is limited to this visitor session.'
                  : 'This founder-only simulation skips Stripe and tests document generation and downloads without charging a card.'}
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

        await pptx.writeFile({ fileName: doc.filename });
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
      const isXlsx = doc.filename.endsWith('.xlsx');
      const blob = isXlsx
        ? await buildXlsxBlob(doc.content, doc.title)
        : await buildDocxBlob(doc.content, doc.title);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error(`Could not build ${doc.filename}`, error);
      const fallbackName = doc.filename.replace(/\.(docx|xlsx)$/, '.md');
      const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.alert(`The ${formatLabelForFilename(doc.filename)} file could not be built in this browser, so a markdown version was downloaded instead.`);
    }
  })();
}

function formatLabelForFilename(filename: string): string {
  return filename.endsWith('.xlsx') ? 'Excel' : 'Word';
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
 * RESULTS — overall score, category breakdown, top 3 gaps, paywall
 * ========================================================================== */
function ResultsScreen({
  overall,
  categoryScores,
  topGaps,
  onRetake,
  upgradeSlot,
}: {
  overall: number;
  categoryScores: Record<CategoryId, number>;
  topGaps: TopGap[];
  onRetake: () => void;
  /** Paywall card (unpaid) or the unlocked "Your Documents" section (paid). */
  upgradeSlot: ReactNode;
}) {
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

        {/* Top gaps */}
        {topGaps.length > 0 && (
          <div className="mb-6">
            <h3 className={`text-sm font-semibold ${tw.typography.color.primary} mb-2.5`}>
              Top {topGaps.length} gap{topGaps.length !== 1 ? 's' : ''} holding you back
            </h3>
            <ul className="space-y-2.5">
              {topGaps.map((gap) => {
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
            <p className={`text-[11px] ${tw.typography.color.muted} mt-2`}>
              These gaps were added to your gap board below so you can track them to “fixed”.
            </p>
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
  const paymentCheckRef = useRef(false);

  const paidPack = (packRows || []).find((p) => p.status === 'paid') || null;
  const packDocuments = useMemo(() => {
    const parsed = paidPack ? parseJsonField<unknown>(paidPack.documents, []) : [];
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
  }, [paidPack]);

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

  // On return from Stripe Checkout: verify the session server-side, generate
  // the three documents from the stored assessment, and record the purchase.
  useEffect(() => {
    if (paymentCheckRef.current || packsLoading) return;
    const params = new URLSearchParams(window.location.search);
    const stripeSessionId = params.get('session_id');
    const flaggedSuccess = params.get('payment_success') === 'true';
    if (!stripeSessionId && !flaggedSuccess) {
      paymentCheckRef.current = true;
      return;
    }
    paymentCheckRef.current = true;

    const cleanUrl = () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('session_id');
        url.searchParams.delete('payment_success');
        window.history.replaceState({}, '', url.toString());
      } catch {
        /* ignore */
      }
    };

    // Already recorded (e.g. reload after a verified purchase) — nothing to do.
    if (stripeSessionId && (packRows || []).some((p) => p.stripe_session_id === stripeSessionId)) {
      cleanUrl();
      return;
    }

    if (!stripeSessionId) {
      // Legacy redirect without the Stripe session id — cannot verify server-side.
      if ((packRows || []).length === 0) {
        setPaymentNotice({
          state: 'error',
          message:
            "We couldn't confirm the payment automatically (the return link is missing the Stripe session id). If you were charged, reply in the chat and we'll unlock your documents.",
        });
      }
      cleanUrl();
      return;
    }

    (async () => {
      setPaymentNotice({ state: 'verifying' });
      try {
        // TEST MODE: `cs_test_...` sessions come from the founder's own
        // TEST-mode Payment Link and cannot be verified through the live-mode
        // platform API, so they are trusted while STRIPE_TEST_MODE is true.
        // This cannot unlock an unpaid live purchase because the live
        // checkout is disabled whenever STRIPE_TEST_MODE is on.
        if (STRIPE_TEST_MODE && stripeSessionId.startsWith('cs_test_')) {
          setPaymentNotice({ state: 'generating' });
          const input = await loadLatestAssessmentInput();
          const documents = await generatePackDocumentsAI(input);
          if (!validatePackDocuments(documents, input)) {
            throw new Error('document_validation_failed');
          }
          await window.__workspaceDb.from('readiness_packs').insert({
            stripe_session_id: stripeSessionId,
            status: 'paid',
            customer_email: getSessionEmail() || null,
            amount_cents: 0, // test-mode purchase — no real charge
            overall_score: input.overallScore,
            documents: JSON.stringify(documents),
            generated_at: new Date().toISOString(),
          });
          refreshPacks();
          setPaymentNotice({ state: 'success' });
          cleanUrl();
          return;
        }
        const res = await fetch(`/api/payments/status/${encodeURIComponent(stripeSessionId)}`);
        const status = await res.json().catch(() => null);
        if (!res.ok || !status || status.paymentStatus !== 'paid') {
          // Keep the URL params so a delayed Stripe confirmation can be retried.
          setPaymentNotice({
            state: 'error',
            message:
              'This payment session is not confirmed as paid yet. If you just completed checkout, wait a few seconds and reload this page to retry.',
          });
          return;
        }
        // A paid session for another product must never unlock this $49 pack.
        if (status.amountTotal !== UNLOCK_PRICE_CENTS || String(status.currency || '').toLowerCase() !== 'usd') {
          setPaymentNotice({
            state: 'error',
            message: 'This payment does not match the $49 Funding Readiness Pack. Your documents were not unlocked.',
          });
          cleanUrl();
          return;
        }
        setPaymentNotice({ state: 'generating' });
        const input = await loadLatestAssessmentInput();
        // AI-personalized via the platform OpenAI proxy; any document whose AI
        // call fails keeps its deterministic template version.
        const documents = await generatePackDocumentsAI(input);
        if (!validatePackDocuments(documents, input)) {
          throw new Error('document_validation_failed');
        }
        await window.__workspaceDb.from('readiness_packs').insert({
          stripe_session_id: stripeSessionId,
          status: 'paid',
          customer_email: (status && status.customerEmail) || getSessionEmail() || null,
          amount_cents: status && typeof status.amountTotal === 'number' ? status.amountTotal : null,
          overall_score: input.overallScore,
          documents: JSON.stringify(documents),
          generated_at: new Date().toISOString(),
        });
        refreshPacks();
        setPaymentNotice({ state: 'success' });
        cleanUrl();
      } catch (error) {
        // Keep the URL params so fulfillment can be retried after the problem is resolved.
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

  // FOUNDER TEST PATH — the platform Stripe integration runs LIVE keys
  // (re-verified 2026-07-16: /api/payments/checkout returns cs_live_...
  // sessions), which is why its checkout is disabled while STRIPE_TEST_MODE
  // is true. This simulation
  // exercises everything AFTER payment success — recording the purchase,
  // generating the documents, and the download UI — without touching Stripe.
  // Pack rows are visitor-session-scoped, so a simulated purchase never
  // unlocks documents for real customers.
  const [simulatingPurchase, setSimulatingPurchase] = useState(false);
  const simulateTestPurchase = async () => {
    if (simulatingPurchase || paidPack) return;
    setSimulatingPurchase(true);
    setPaymentNotice({ state: 'generating' });
    try {
      const input = await loadLatestAssessmentInput();
      const documents = await generatePackDocumentsAI(input);
      if (!validatePackDocuments(documents, input)) {
        throw new Error('document_validation_failed');
      }
      await window.__workspaceDb.from('readiness_packs').insert({
        stripe_session_id: `founder_test_${Date.now()}`,
        status: 'paid',
        customer_email: getSessionEmail() || null,
        amount_cents: 0,
        overall_score: input.overallScore,
        documents: JSON.stringify(documents),
        generated_at: new Date().toISOString(),
      });
      await refreshPacks();
      setPaymentNotice({ state: 'success' });
    } catch (error) {
      console.error('[GapRadar] Test document generation failed:', error);
      setPaymentNotice({
        state: 'error',
        message: 'Test document generation failed. Please try again; if it continues, share this message with support.',
      });
    } finally {
      setSimulatingPurchase(false);
    }
  };

  // Regenerate the pack from the latest assessment results (e.g. after a retake).
  const rebuildPack = async () => {
    if (!paidPack || rebuildingPack) return;
    setRebuildingPack(true);
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
    } catch {
      /* keep the previous documents — the founder can retry */
    } finally {
      setRebuildingPack(false);
    }
  };

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
        hasExistingGaps={(gaps || []).length > 0}
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
        {paymentNotice && (
          <PaymentNoticeBanner notice={paymentNotice} onDismiss={() => setPaymentNotice(null)} />
        )}
        <div className="px-5 py-3 border-b border-[var(--space-border-default)] flex flex-wrap items-center justify-between gap-2">
          <span className={`text-xs ${tw.typography.color.secondary}`}>
            Take the 5-minute assessment to get your Funding Readiness Score.
          </span>
          <button
            onClick={startAssessment}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${tw.button.primary}`}
            data-testid="button-start-assessment-banner"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Start assessment
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
      {paymentNotice && (
        <PaymentNoticeBanner notice={paymentNotice} onDismiss={() => setPaymentNotice(null)} />
      )}
      {result && (
        <ResultsScreen
          overall={result.overall}
          categoryScores={result.categoryScores}
          topGaps={result.topGaps}
          onRetake={handleRetake}
          upgradeSlot={
            paidPack ? (
              <>
                <DocumentsSection
                  documents={packDocuments}
                  generatedAt={paidPack.generated_at}
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
      <GapBoard gaps={gaps || []} loading={gapsLoading} error={gapsError} refresh={refreshGaps} />
    </div>
  );
}
