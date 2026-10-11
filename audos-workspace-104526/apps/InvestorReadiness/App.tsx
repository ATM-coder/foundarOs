import { useState, useMemo, useEffect, useRef } from 'react';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import {
  ShieldCheck,
  Target,
  TrendingUp,
  Landmark,
  Megaphone,
  FileCheck2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Rocket,
  User,
  Search,
  ChevronDown,
  Check,
  Lock,
  AlertCircle,
  Printer,
  RotateCcw,
  Sparkles,
  Award,
  Flag,
} from 'lucide-react';

/* ============================================================================
 * Are You Investor-Ready? — The Founder Investor Readiness Scorecard
 * A premium, production-ready lead-magnet mini-app for FoundarOS.
 *
 * 7-step flow: Intro -> Founder Info -> Assessment (5 categories) ->
 * Lead Capture Gate -> Results -> FoundarOS Conversion.
 *
 * Persistence: completed assessments are saved to the WorkspaceDB table
 * `investor_readiness_leads` via window.__workspaceDb on lead capture.
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// SCORE INTERPRETATION (configurable constants)
// ---------------------------------------------------------------------------
type ScoreBand = { min: number; max: number; label: string; summary: string };

const SCORE_BANDS: ScoreBand[] = [
  { min: 0, max: 39, label: 'Early Stage', summary: 'You have important foundations to build before actively fundraising.' },
  { min: 40, max: 59, label: 'Developing', summary: 'You have some investor-ready elements, but significant gaps remain.' },
  { min: 60, max: 74, label: 'Fundraising Ready', summary: 'You have a credible foundation, but several areas should be strengthened before approaching serious investors.' },
  { min: 75, max: 89, label: 'Investor Ready', summary: 'You have many of the foundations investors expect. Focus on refining your story and execution.' },
  { min: 90, max: 100, label: 'Highly Investor Ready', summary: 'Your business appears highly prepared for investor conversations. Continue validating your assumptions and maintaining your investor materials.' },
];

function bandForScore(score: number): ScoreBand {
  return SCORE_BANDS.find((b) => score >= b.min && score <= b.max) || SCORE_BANDS[0];
}

const DISCLAIMER =
  'This assessment is an educational readiness diagnostic. It does not guarantee fundraising success or represent investment advice.';

const FOUNDAROS_URL = 'https://www.foundaros.com';

// ---------------------------------------------------------------------------
// CATEGORIES & QUESTIONS
// ---------------------------------------------------------------------------
type CategoryId = 'business' | 'traction' | 'financial' | 'fundraising' | 'diligence';

type CategoryMeta = {
  id: CategoryId;
  label: string;
  short: string;
  weight: number;
  icon: typeof Target;
  qids: string[];
  scoreField: string;
};

const CATEGORIES: CategoryMeta[] = [
  { id: 'business', label: 'Business Readiness', short: 'Business', weight: 0.25, icon: Target, qids: ['q1', 'q2', 'q3', 'q4', 'q5'], scoreField: 'business_score' },
  { id: 'traction', label: 'Market & Traction', short: 'Traction', weight: 0.25, icon: TrendingUp, qids: ['q6', 'q7', 'q8', 'q9', 'q10'], scoreField: 'traction_score' },
  { id: 'financial', label: 'Financial Readiness', short: 'Financial', weight: 0.2, icon: Landmark, qids: ['q11', 'q12', 'q13', 'q14', 'q15'], scoreField: 'financial_score' },
  { id: 'fundraising', label: 'Fundraising Readiness', short: 'Fundraising', weight: 0.2, icon: Megaphone, qids: ['q16', 'q17', 'q18', 'q19', 'q20'], scoreField: 'fundraising_score' },
  { id: 'diligence', label: 'Due Diligence Readiness', short: 'Due Diligence', weight: 0.1, icon: FileCheck2, qids: ['q21', 'q22', 'q23', 'q24', 'q25'], scoreField: 'diligence_score' },
];

const STEPPER = ['Business', 'Traction', 'Financial', 'Fundraising', 'Due Diligence', 'Results'];

type Question = { id: string; category: CategoryId; text: string };

const QUESTIONS: Question[] = [
  // Business Readiness
  { id: 'q1', category: 'business', text: 'Can you clearly explain the specific problem your business solves and who experiences it?' },
  { id: 'q2', category: 'business', text: 'Have you clearly defined your target customer \u2014 their profile, needs and behaviour?' },
  { id: 'q3', category: 'business', text: 'Can you articulate a compelling value proposition that differentiates you from existing alternatives?' },
  { id: 'q4', category: 'business', text: 'Do you have a clear, validated business model that explains how your startup will generate sustainable revenue?' },
  { id: 'q5', category: 'business', text: 'Do you understand your competitive landscape and can you explain your differentiated position?' },
  // Market & Traction
  { id: 'q6', category: 'traction', text: 'Have you validated that your target customers experience this problem and would pay to solve it?' },
  { id: 'q7', category: 'traction', text: 'How would you describe your current revenue or revenue evidence (pre-orders, LOIs, pilots, waitlist)?' },
  { id: 'q8', category: 'traction', text: 'Do you have evidence of customer growth or growing interest over the past 6 months?' },
  { id: 'q9', category: 'traction', text: 'Can you demonstrate customer retention, repeat engagement or product stickiness?' },
  { id: 'q10', category: 'traction', text: 'Have you sized your addressable market with credible data or reasoning?' },
  // Financial Readiness
  { id: 'q11', category: 'financial', text: 'Do you have a clear, defensible revenue model that explains how you will generate money?' },
  { id: 'q12', category: 'financial', text: 'Do you understand your key cost drivers and how your cost structure evolves at scale?' },
  { id: 'q13', category: 'financial', text: 'Do you know your unit economics \u2014 such as CAC, LTV or contribution margin?' },
  { id: 'q14', category: 'financial', text: 'Do you know exactly how much capital you need to raise and what the capital will be used to achieve?' },
  { id: 'q15', category: 'financial', text: 'Have you built financial projections for at least 3 years that you can explain and defend?' },
  // Fundraising Readiness
  { id: 'q16', category: 'fundraising', text: 'Do you have a pitch deck that tells a clear, compelling investor narrative from problem to ask?' },
  { id: 'q17', category: 'fundraising', text: 'Can you explain why your company is an attractive investment opportunity \u2014 not just why it is a good business?' },
  { id: 'q18', category: 'fundraising', text: 'Do you have a clear, justified view on your valuation or funding rationale?' },
  { id: 'q19', category: 'fundraising', text: 'Have you identified the type of investors you are targeting (stage, sector, check size, geography)?' },
  { id: 'q20', category: 'fundraising', text: 'Do you have a structured fundraising strategy \u2014 outreach plan, pipeline tracking, timeline?' },
  // Due Diligence Readiness
  { id: 'q21', category: 'diligence', text: 'Are your core corporate documents (articles, shareholder agreements, board minutes) organized and accessible?' },
  { id: 'q22', category: 'diligence', text: 'Do you have at least 12 months of financial records \u2014 bank statements, P&L, management accounts \u2014 ready to share?' },
  { id: 'q23', category: 'diligence', text: 'Do you have signed contracts with key customers, suppliers or partners organized and shareable?' },
  { id: 'q24', category: 'diligence', text: 'Have you documented your intellectual property \u2014 patents, trademarks, proprietary technology or trade secrets?' },
  { id: 'q25', category: 'diligence', text: 'Do you have a clean, up-to-date cap table and a clear understanding of your current ownership structure?' },
];

const SCALE = [
  { value: 1, label: 'Not yet' },
  { value: 2, label: 'Partially' },
  { value: 3, label: 'Mostly' },
  { value: 4, label: 'Clearly' },
  { value: 5, label: 'Very clearly' },
];

// Dynamic per-category insight sentences by score band
const CATEGORY_INSIGHTS: Record<CategoryId, { low: string; mid: string; high: string }> = {
  business: {
    low: 'Investors will probe your problem clarity and target customer definition. Sharpening these foundations will significantly strengthen your pitch.',
    mid: 'You have a relatively clear problem definition and customer proposition. Refine your competitive positioning and value proposition further.',
    high: 'You have strong business fundamentals. Ensure your competitive moat is clearly articulated.',
  },
  traction: {
    low: 'Your traction story needs strengthening. Even early-stage evidence \u2014 interviews, waitlist signups or pilots \u2014 signals investor demand.',
    mid: 'You have some market validation. Build stronger evidence of customer demand and a credible market size narrative.',
    high: 'You have solid traction evidence. Continue demonstrating customer growth and retention as key proof points.',
  },
  financial: {
    low: 'You may need stronger financial projections, unit economics and clarity around your funding requirement before investor conversations.',
    mid: 'Your financial picture is developing. Stress-test your projections and clarify your use of funds with precision.',
    high: 'You have a solid financial foundation. Ensure your projections are defensible and your use of funds is milestone-linked.',
  },
  fundraising: {
    low: 'Your fundraising materials and strategy need work before approaching investors. Focus on your pitch narrative and investor targeting first.',
    mid: 'You have the beginnings of a fundraising strategy. Sharpen your investor narrative and valuation rationale.',
    high: 'Your fundraising readiness is strong. Refine your pitch for your specific investor targets.',
  },
  diligence: {
    low: 'Investors will request documents quickly after initial meetings. Begin organizing your corporate documents, financials and cap table now.',
    mid: 'Your due diligence preparation is in progress. Prioritize your cap table and financial records.',
    high: 'You are well-prepared for due diligence. Maintain your documents and ensure they are investor-ready at all times.',
  },
};

function insightForCategory(cat: CategoryId, score: number): string {
  const band = score < 50 ? 'low' : score < 75 ? 'mid' : 'high';
  return CATEGORY_INSIGHTS[cat][band];
}

// Specific priority action per question when scored 1 or 2
const ACTION_MAP: Record<string, string> = {
  q1: 'Write a crisp one-sentence problem statement: who has it, what it is, and why it matters now.',
  q2: 'Define your target customer precisely \u2014 their profile, needs and buying behaviour \u2014 so investors see who you serve.',
  q3: 'Sharpen your value proposition into a single line that shows why you win against existing alternatives.',
  q4: 'Define your revenue model clearly \u2014 how you charge, who pays, and what your pricing rationale is.',
  q5: 'Map your competitive landscape and articulate your differentiated, defensible position.',
  q6: 'Run customer validation \u2014 interviews or a willingness-to-pay test \u2014 to prove the problem is real and painful.',
  q7: 'Gather concrete revenue evidence \u2014 pre-orders, letters of intent, pilots or a waitlist \u2014 to demonstrate demand.',
  q8: 'Track and present a clear growth trend \u2014 users, revenue or interest \u2014 over the last 6 months.',
  q9: 'Measure retention or repeat engagement so you can show product stickiness, not just first-time interest.',
  q10: 'Build a credible market sizing \u2014 TAM, SAM, SOM \u2014 using public data or bottoms-up reasoning.',
  q11: 'Document a defensible revenue model that explains exactly how the business makes money.',
  q12: 'Identify your key cost drivers and show how your cost structure changes as you scale.',
  q13: 'Define your unit economics \u2014 at minimum your Customer Acquisition Cost (CAC) and Lifetime Value (LTV).',
  q14: 'Build a precise funding requirement: X amount to achieve Y milestones in Z months.',
  q15: 'Build 3-year financial projections you can explain and defend line by line.',
  q16: 'Create or refine your pitch deck \u2014 ensure it follows the standard investor narrative arc: Problem \u2192 Solution \u2192 Market \u2192 Traction \u2192 Team \u2192 Ask.',
  q17: 'Frame the investment case \u2014 why your company is an attractive opportunity, not just a good business.',
  q18: 'Prepare a justified valuation or funding rationale you can defend with comparables or logic.',
  q19: 'Build a target investor list by stage, sector, check size and geography.',
  q20: 'Design a structured fundraising strategy \u2014 outreach plan, pipeline tracking and timeline.',
  q21: 'Organize your corporate documents \u2014 articles of incorporation, shareholder agreements and board minutes \u2014 into a secure, shareable data room.',
  q22: 'Assemble at least 12 months of financial records \u2014 bank statements, P&L and management accounts \u2014 ready to share.',
  q23: 'Collect and organize signed contracts with key customers, suppliers and partners for quick sharing.',
  q24: 'Document your intellectual property \u2014 patents, trademarks, proprietary technology or trade secrets.',
  q25: 'Prepare a clean, up-to-date cap table. Investors will request this early in due diligence.',
};

// Category-level fallback actions (used when few/no questions scored 1-2)
const CATEGORY_FALLBACK_ACTION: Record<CategoryId, string> = {
  business: 'Tighten your core business narrative \u2014 problem, customer, value proposition and differentiation \u2014 into a single coherent story.',
  traction: 'Strengthen your traction evidence with validation data, a growth trend and a credible market size.',
  financial: 'Firm up your financial model \u2014 unit economics, cost drivers, projections and a precise funding ask.',
  fundraising: 'Polish your fundraising package \u2014 pitch deck, investment case, valuation rationale and investor targeting.',
  diligence: 'Get due-diligence-ready by organizing corporate documents, financial records and an up-to-date cap table.',
};

// ---------------------------------------------------------------------------
// FORM OPTIONS
// ---------------------------------------------------------------------------
const INDUSTRIES = ['Technology', 'Healthcare', 'Fintech', 'EdTech', 'E-commerce', 'SaaS', 'Consumer', 'Deep Tech', 'Other'];
const STARTUP_STAGES = ['Idea', 'Pre-launch', 'MVP', 'Early revenue', 'Growth', 'Scaling'];
const FUNDING_STAGES = ['Not currently fundraising', 'Preparing to raise', 'Currently fundraising', 'Previously raised funding'];

const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
  'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada',
  'Cape Verde', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba',
  'Cyprus', 'Czechia', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Estonia',
  'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana',
  'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland',
  'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan',
  'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia',
  'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Mauritania', 'Mauritius', 'Mexico', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
  'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Macedonia', 'Norway', 'Oman',
  'Pakistan', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
  'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Somalia',
  'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sudan', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
  'Tanzania', 'Thailand', 'Togo', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Uganda', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe', 'Other',
];

// ---------------------------------------------------------------------------
// ANALYTICS
// ---------------------------------------------------------------------------
function fireAnalytics(event: string, props: Record<string, any> = {}) {
  try {
    const w = window as any;
    const payload = { app: 'investor-readiness-scorecard', ...props };
    if (typeof w.audosAnalytics?.track === 'function') w.audosAnalytics.track(event, payload);
    else if (typeof w.audosAnalytics === 'function') w.audosAnalytics(event, payload);
    else if (typeof w.analytics?.track === 'function') w.analytics.track(event, payload);
    else if (typeof w.__audos?.track === 'function') w.__audos.track(event, payload);
    if (typeof w.dispatchEvent === 'function') {
      w.dispatchEvent(new CustomEvent('audos:analytics', { detail: { event, props: payload } }));
    }
  } catch {
    /* analytics must never break the experience */
  }
}

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------
type View = 'intro' | 'founder' | 'assessment' | 'gate' | 'results';
type AnswerMap = Record<string, number>;

type FounderInfo = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  industry: string;
  country: string;
  startupStage: string;
  fundingStage: string;
  fundingTarget: string;
  annualRevenue: string;
  numCustomers: string;
};

const EMPTY_FOUNDER: FounderInfo = {
  firstName: '', lastName: '', email: '', company: '', industry: '', country: '',
  startupStage: '', fundingStage: '', fundingTarget: '', annualRevenue: '', numCustomers: '',
};

type ScoreResult = {
  overall: number;
  categories: Record<CategoryId, number>;
  label: string;
  summary: string;
  strength: { cat: CategoryMeta; score: number; insight: string };
  gap: { cat: CategoryMeta; score: number; insight: string };
  actions: string[];
};

// ---------------------------------------------------------------------------
// SCORING ENGINE
// ---------------------------------------------------------------------------
function computeScores(answers: AnswerMap, startupStage: string): ScoreResult {
  const isEarly = startupStage === 'Idea' || startupStage === 'Pre-launch';
  const categories = {} as Record<CategoryId, number>;

  CATEGORIES.forEach((cat) => {
    const sum = cat.qids.reduce((acc, q) => acc + (answers[q] || 0), 0);
    let pct = (sum / (cat.qids.length * 5)) * 100;
    if (cat.id === 'traction' && isEarly) pct = Math.min(100, pct + 5);
    categories[cat.id] = Math.round(pct);
  });

  const overallRaw = CATEGORIES.reduce((acc, cat) => acc + cat.weight * categories[cat.id], 0);
  const overall = Math.round(overallRaw);
  const band = bandForScore(overall);

  const sorted = [...CATEGORIES].sort((a, b) => categories[b.id] - categories[a.id]);
  const strengthCat = sorted[0];
  const gapCat = sorted[sorted.length - 1];

  return {
    overall,
    categories,
    label: band.label,
    summary: band.summary,
    strength: { cat: strengthCat, score: categories[strengthCat.id], insight: insightForCategory(strengthCat.id, categories[strengthCat.id]) },
    gap: { cat: gapCat, score: categories[gapCat.id], insight: insightForCategory(gapCat.id, categories[gapCat.id]) },
    actions: buildActions(answers, categories),
  };
}

function buildActions(answers: AnswerMap, categories: Record<CategoryId, number>): string[] {
  const weightOf = (qid: string) => {
    const cat = CATEGORIES.find((c) => c.qids.includes(qid))!;
    return cat.weight;
  };
  const lowQuestions = QUESTIONS.filter((q) => (answers[q.id] || 0) <= 2)
    .map((q) => ({ qid: q.id, weight: weightOf(q.id), score: answers[q.id] || 0 }))
    .sort((a, b) => b.weight - a.weight || a.score - b.score);

  const actions: string[] = [];
  for (const item of lowQuestions) {
    const text = ACTION_MAP[item.qid];
    if (text && !actions.includes(text)) actions.push(text);
    if (actions.length >= 5) break;
  }

  // Ensure at least 3 actions using lowest-scoring categories as fallback
  if (actions.length < 3) {
    const catsByScore = [...CATEGORIES].sort((a, b) => categories[a.id] - categories[b.id]);
    for (const cat of catsByScore) {
      const text = CATEGORY_FALLBACK_ACTION[cat.id];
      if (!actions.includes(text)) actions.push(text);
      if (actions.length >= 3) break;
    }
  }

  return actions.slice(0, 5);
}

function computeLeadStatus(fundingStage: string, startupStage: string, overall: number): string {
  if (overall >= 75 && (fundingStage === 'Preparing to raise' || fundingStage === 'Currently fundraising')) return 'High-intent lead';
  if (fundingStage === 'Currently fundraising') return 'Currently fundraising';
  if (fundingStage === 'Preparing to raise' && overall >= 60) return 'Fundraising soon';
  if (overall >= 75) return 'Investor-ready';
  if (startupStage === 'Idea' || startupStage === 'Pre-launch' || startupStage === 'MVP') return 'Early founder';
  return 'Lead';
}

// ---------------------------------------------------------------------------
// SMALL UI PRIMITIVES
// ---------------------------------------------------------------------------
const cardCls =
  'bg-[var(--space-surface-card)] border border-[var(--space-border-default)] rounded-2xl';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] font-semibold px-6 py-3.5 transition-all hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed';
const ghostBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--space-border-strong)] text-[var(--space-text-primary)] font-semibold px-6 py-3.5 transition-all hover:bg-[var(--space-surface-card-hover)]';
const inputCls =
  'w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] text-[var(--space-text-primary)] placeholder:text-[var(--space-text-muted)] px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--space-brand-primary)] focus:border-transparent transition-all';
const labelCls = 'block text-sm font-medium text-[var(--space-text-primary)] mb-1.5';

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--space-semantic-success)';
  if (score >= 50) return 'var(--space-brand-highlight)';
  if (score >= 40) return 'var(--space-semantic-warning)';
  return 'var(--space-semantic-danger)';
}

function Field({ label, optional, error, children }: { label: string; optional?: boolean; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {optional && <span className="ml-1.5 text-xs font-normal text-[var(--space-text-muted)]">Optional</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-[var(--space-semantic-danger)] flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</p>}
    </div>
  );
}

// Searchable country dropdown
function CountrySelect({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} flex items-center justify-between text-left ${error ? 'ring-2 ring-[var(--space-semantic-danger)]' : ''}`}
      >
        <span className={value ? '' : 'text-[var(--space-text-muted)]'}>{value || 'Select country'}</span>
        <ChevronDown className="w-4 h-4 text-[var(--space-text-muted)] shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-[var(--space-border-strong)] bg-[var(--space-surface-panel-strong)] shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-[var(--space-border-default)]">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--space-text-muted)]" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search countries..."
                className="w-full rounded-lg bg-[var(--space-surface-muted)] text-[var(--space-text-primary)] placeholder:text-[var(--space-text-muted)] pl-9 pr-3 py-2 text-sm focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <div className="px-4 py-3 text-sm text-[var(--space-text-muted)]">No matches</div>}
            {filtered.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); setQuery(''); }}
                className="w-full text-left px-4 py-2.5 text-sm text-[var(--space-text-primary)] hover:bg-[var(--space-surface-card-hover)] flex items-center justify-between"
              >
                {c}
                {value === c && <Check className="w-4 h-4 text-[var(--space-brand-highlight)]" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Progress stepper
function Stepper({ activeIndex }: { activeIndex: number }) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center gap-1 sm:gap-2 min-w-max px-1">
        {STEPPER.map((label, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <div key={label} className="flex items-center gap-1 sm:gap-2">
              <div
                className={`flex items-center gap-1.5 rounded-full px-2.5 sm:px-3 py-1.5 text-xs sm:text-[13px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)]'
                    : done
                    ? 'bg-[color-mix(in_srgb,var(--space-brand-highlight-500)_18%,transparent)] text-[var(--space-text-primary)]'
                    : 'bg-[var(--space-surface-card)] text-[var(--space-text-muted)]'
                }`}
              >
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : active ? <Circle className="w-3.5 h-3.5 fill-current" /> : <Circle className="w-3.5 h-3.5" />}
                {label}
              </div>
              {i < STEPPER.length - 1 && <div className="w-3 sm:w-6 h-px bg-[var(--space-border-default)]" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Circular score badge
function ScoreBadge({ score, label }: { score: number; label: string }) {
  const radius = 84;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <div className="relative w-52 h-52 mx-auto">
      <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--space-surface-card)" strokeWidth="14" />
        <circle
          cx="100" cy="100" r={radius} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-bold text-[var(--space-text-primary)] leading-none">{score}</div>
        <div className="text-sm text-[var(--space-text-muted)] mt-1">out of 100</div>
        <div className="mt-2 text-sm font-bold text-center px-3" style={{ color }}>{label}</div>
      </div>
    </div>
  );
}

// Horizontal category bar
function CategoryBar({ label, score }: { label: string; score: number }) {
  const color = scoreColor(score);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-[var(--space-text-primary)]">{label}</span>
        <span className="text-sm font-bold" style={{ color }}>{score}</span>
      </div>
      <div className="h-2.5 rounded-full bg-[var(--space-surface-card)] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------
export default function InvestorReadiness() {
  const [view, setView] = useState<View>('intro');
  const [catIndex, setCatIndex] = useState(0);
  const [founder, setFounder] = useState<FounderInfo>(EMPTY_FOUNDER);
  const [founderErrors, setFounderErrors] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [gate, setGate] = useState({ name: '', email: '', company: '', whatsapp: '', consent: false });
  const [gateErrors, setGateErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [assessedAt, setAssessedAt] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageViewFired = useRef(false);

  // SEO / meta tags
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Are You Investor-Ready? | Free Founder Investor Readiness Assessment | FoundarOS';
    const meta = document.querySelector('meta[name="description"]') || document.createElement('meta');
    meta.setAttribute('name', 'description');
    const prevDesc = meta.getAttribute('content');
    meta.setAttribute('content', "Find out how investor-ready your startup is with FoundarOS's free Founder Investor Readiness Scorecard. Identify fundraising gaps and get actionable next steps.");
    if (!meta.parentNode) document.head.appendChild(meta);
    return () => {
      document.title = prevTitle;
      if (prevDesc !== null) meta.setAttribute('content', prevDesc);
    };
  }, []);

  // Print isolation styles (scoped to this app's print report)
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-ir-print', 'true');
    style.textContent = `
      .ir-print-only { display: none; }
      @media print {
        body * { visibility: hidden !important; }
        .ir-print-only { display: block !important; position: absolute; left: 0; top: 0; width: 100%; padding: 32px; background: #ffffff; color: #0A0B14; }
        .ir-print-only, .ir-print-only * { visibility: visible !important; }
        .ir-no-print { display: none !important; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  // Analytics: page view on intro
  useEffect(() => {
    if (view === 'intro' && !pageViewFired.current) {
      pageViewFired.current = true;
      fireAnalytics('assessment_page_view');
    }
  }, [view]);

  const scrollTop = () => { if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  useEffect(() => { scrollTop(); }, [view, catIndex]);

  // ---- Founder form validation ----
  function validateFounder(): boolean {
    const e: Record<string, string> = {};
    if (!founder.firstName.trim()) e.firstName = 'Required';
    if (!founder.lastName.trim()) e.lastName = 'Required';
    if (!founder.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(founder.email.trim())) e.email = 'Enter a valid email';
    if (!founder.company.trim()) e.company = 'Required';
    if (!founder.industry) e.industry = 'Required';
    if (!founder.country) e.country = 'Required';
    if (!founder.startupStage) e.startupStage = 'Select your stage';
    if (!founder.fundingStage) e.fundingStage = 'Select your funding stage';
    setFounderErrors(e);
    return Object.keys(e).length === 0;
  }

  function startAssessment() {
    fireAnalytics('assessment_started');
    setView('founder');
  }

  function submitFounder() {
    if (!validateFounder()) return;
    setGate((g) => ({
      ...g,
      name: `${founder.firstName} ${founder.lastName}`.trim(),
      email: founder.email,
      company: founder.company,
    }));
    setView('assessment');
    setCatIndex(0);
  }

  const currentCategory = CATEGORIES[catIndex];
  const currentQuestions = useMemo(() => QUESTIONS.filter((q) => q.category === currentCategory.id), [currentCategory.id]);
  const categoryComplete = currentQuestions.every((q) => answers[q.id]);

  function setAnswer(qid: string, value: number) {
    setAnswers((a) => ({ ...a, [qid]: value }));
  }

  function nextCategory() {
    if (!categoryComplete) return;
    fireAnalytics('category_completed', { category: currentCategory.label, index: catIndex + 1 });
    if (catIndex < CATEGORIES.length - 1) {
      setCatIndex((i) => i + 1);
    } else {
      fireAnalytics('assessment_completed');
      setView('gate');
    }
  }

  function prevCategory() {
    if (catIndex > 0) setCatIndex((i) => i - 1);
    else setView('founder');
  }

  // ---- Lead capture gate ----
  function validateGate(): boolean {
    const e: Record<string, string> = {};
    if (!gate.name.trim()) e.name = 'Required';
    if (!gate.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gate.email.trim())) e.email = 'Enter a valid email';
    if (!gate.company.trim()) e.company = 'Required';
    setGateErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submitGate() {
    if (!validateGate()) return;
    const computed = computeScores(answers, founder.startupStage);
    const now = new Date();
    setResult(computed);
    setAssessedAt(now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
    fireAnalytics('lead_captured', { funding_stage: founder.fundingStage, overall_score: computed.overall });

    setSaving(true);
    setSaveError(null);
    try {
      await saveLead(computed);
    } catch (err: any) {
      // Never block the founder from seeing results if the save fails
      setSaveError('We could not save your report to your account, but your results are ready below.');
    } finally {
      setSaving(false);
      setView('results');
      fireAnalytics('results_viewed', { overall_score: computed.overall, score_label: computed.label });
    }
  }

  async function saveLead(computed: ScoreResult) {
    const db = (window as any).__workspaceDb;
    if (!db || typeof db.from !== 'function') return;
    const leadStatus = computeLeadStatus(founder.fundingStage, founder.startupStage, computed.overall);
    const nameParts = gate.name.trim().split(/\s+/);
    const row = {
      first_name: founder.firstName || nameParts[0] || '',
      last_name: founder.lastName || nameParts.slice(1).join(' ') || '',
      email: gate.email || founder.email || '',
      company_name: gate.company || founder.company || '',
      industry: founder.industry || '',
      country: founder.country || '',
      startup_stage: founder.startupStage || '',
      funding_stage: founder.fundingStage || '',
      funding_target: founder.fundingTarget || null,
      annual_revenue: founder.annualRevenue || null,
      num_customers: founder.numCustomers || null,
      whatsapp: gate.whatsapp || null,
      email_consent: !!gate.consent,
      answers: answers,
      overall_score: computed.overall,
      business_score: computed.categories.business,
      traction_score: computed.categories.traction,
      financial_score: computed.categories.financial,
      fundraising_score: computed.categories.fundraising,
      diligence_score: computed.categories.diligence,
      score_label: computed.label,
      lead_status: leadStatus,
    };
    await db.from('investor_readiness_leads').insert(row);
  }

  function handlePrint() {
    fireAnalytics('report_printed');
    window.print();
  }

  function handleFoundarosCta() {
    fireAnalytics('foundaros_cta_clicked');
    window.open(FOUNDAROS_URL, '_blank', 'noopener,noreferrer');
  }

  function retake() {
    fireAnalytics('assessment_retaken');
    setView('intro');
    setCatIndex(0);
    setFounder(EMPTY_FOUNDER);
    setFounderErrors({});
    setAnswers({});
    setGate({ name: '', email: '', company: '', whatsapp: '', consent: false });
    setGateErrors({});
    setResult(null);
    setSaveError(null);
    pageViewFired.current = false;
  }

  const activeStepIndex =
    view === 'intro' || view === 'founder' ? -1 : view === 'assessment' ? catIndex : view === 'gate' ? 4 : 5;

  const answeredCount = Object.keys(answers).filter((k) => answers[k]).length;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-transparent text-[var(--space-text-primary)]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Stepper (hidden on print) */}
        <div className="ir-no-print mb-6 sm:mb-8">
          <Stepper activeIndex={activeStepIndex < 0 ? 0 : activeStepIndex} />
        </div>

        {view === 'intro' && <IntroScreen onStart={startAssessment} />}
        {view === 'founder' && (
          <FounderScreen
            founder={founder}
            setFounder={setFounder}
            errors={founderErrors}
            onBack={() => setView('intro')}
            onSubmit={submitFounder}
          />
        )}
        {view === 'assessment' && (
          <AssessmentScreen
            category={currentCategory}
            catIndex={catIndex}
            questions={currentQuestions}
            answers={answers}
            setAnswer={setAnswer}
            answeredCount={answeredCount}
            complete={categoryComplete}
            onBack={prevCategory}
            onNext={nextCategory}
          />
        )}
        {view === 'gate' && (
          <GateScreen
            gate={gate}
            setGate={setGate}
            errors={gateErrors}
            saving={saving}
            onBack={() => { setView('assessment'); setCatIndex(CATEGORIES.length - 1); }}
            onSubmit={submitGate}
          />
        )}
        {view === 'results' && result && (
          <ResultsScreen
            result={result}
            founder={founder}
            company={gate.company || founder.company}
            assessedAt={assessedAt}
            saveError={saveError}
            onPrint={handlePrint}
            onCta={handleFoundarosCta}
            onRetake={retake}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN 1 — INTRO
// ---------------------------------------------------------------------------
function IntroScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium mb-6 border border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_14%,transparent)] text-[var(--space-text-primary)]">
        <ShieldCheck className="w-3.5 h-3.5 text-[var(--space-brand-highlight)]" />
        Founder Investor Readiness Scorecard
      </div>
      <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[var(--space-text-primary)]">Are You Investor-Ready?</h1>
      <p className="mt-4 text-lg sm:text-xl text-[var(--space-text-secondary)] max-w-2xl mx-auto">
        Find out how prepared your startup really is before you start pitching investors.
      </p>
      <p className="mt-4 text-sm sm:text-base text-[var(--space-text-muted)] max-w-2xl mx-auto leading-relaxed">
        Most founders prepare their pitch deck before preparing the business behind it. This free assessment helps you
        identify the gaps investors are likely to question.
      </p>

      <div className="mt-8">
        <button className={primaryBtn + ' text-base px-8 py-4'} onClick={onStart}>
          Check My Investor Readiness <ArrowRight className="w-5 h-5" />
        </button>
        <p className="mt-3 text-xs text-[var(--space-text-muted)]">Free • Takes about 5 minutes</p>
      </div>

      <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
        {[
          { icon: Target, title: '25 diagnostic questions', body: 'Across five categories investors care about most.' },
          { icon: Award, title: 'Personalized score', body: 'A weighted 0\u2013100 readiness score with clear interpretation.' },
          { icon: Rocket, title: 'Actionable next steps', body: 'Prioritized recommendations tailored to your gaps.' },
        ].map((f) => (
          <div key={f.title} className={`${cardCls} p-5`}>
            <f.icon className="w-6 h-6 text-[var(--space-brand-highlight)]" />
            <div className="mt-3 font-semibold text-[var(--space-text-primary)]">{f.title}</div>
            <div className="mt-1 text-sm text-[var(--space-text-secondary)]">{f.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN 2 — FOUNDER INFORMATION
// ---------------------------------------------------------------------------
function FounderScreen({
  founder, setFounder, errors, onBack, onSubmit,
}: {
  founder: FounderInfo;
  setFounder: Dispatch<SetStateAction<FounderInfo>>;
  errors: Record<string, string>;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const set = (k: keyof FounderInfo) => (v: string) => setFounder((f) => ({ ...f, [k]: v }));
  return (
    <div>
      <ScreenHeader
        icon={User}
        title="Tell us about you and your startup"
        subtitle="A few details so we can tailor your readiness report. This takes under a minute."
      />
      <div className={`${cardCls} p-5 sm:p-7 space-y-5`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First name" error={errors.firstName}>
            <input className={inputCls} value={founder.firstName} onChange={(e) => set('firstName')(e.target.value)} placeholder="Jane" />
          </Field>
          <Field label="Last name" error={errors.lastName}>
            <input className={inputCls} value={founder.lastName} onChange={(e) => set('lastName')(e.target.value)} placeholder="Doe" />
          </Field>
        </div>
        <Field label="Email" error={errors.email}>
          <input type="email" className={inputCls} value={founder.email} onChange={(e) => set('email')(e.target.value)} placeholder="jane@startup.com" />
        </Field>
        <Field label="Startup / company name" error={errors.company}>
          <input className={inputCls} value={founder.company} onChange={(e) => set('company')(e.target.value)} placeholder="Acme Inc." />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Industry" error={errors.industry}>
            <div className="relative">
              <select
                className={`${inputCls} appearance-none pr-10 ${founder.industry ? '' : 'text-[var(--space-text-muted)]'}`}
                value={founder.industry}
                onChange={(e) => set('industry')(e.target.value)}
              >
                <option value="" disabled>Select industry</option>
                {INDUSTRIES.map((i) => <option key={i} value={i} className="text-[var(--space-text-primary)] bg-[var(--space-surface-panel-strong)]">{i}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[var(--space-text-muted)] pointer-events-none" />
            </div>
          </Field>
          <Field label="Country" error={errors.country}>
            <CountrySelect value={founder.country} onChange={set('country')} error={!!errors.country} />
          </Field>
        </div>

        <Field label="Startup stage" error={errors.startupStage}>
          <ChipGroup options={STARTUP_STAGES} value={founder.startupStage} onChange={set('startupStage')} />
        </Field>
        <Field label="Funding stage" error={errors.fundingStage}>
          <ChipGroup options={FUNDING_STAGES} value={founder.fundingStage} onChange={set('fundingStage')} />
        </Field>

        <div className="pt-2 border-t border-[var(--space-border-default)]">
          <p className="text-xs text-[var(--space-text-muted)] mb-4">The fields below are optional — share only what you're comfortable with. We never require sensitive financial information.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Funding target ($)" optional>
              <input className={inputCls} inputMode="numeric" value={founder.fundingTarget} onChange={(e) => set('fundingTarget')(e.target.value)} placeholder="e.g. 500,000" />
            </Field>
            <Field label="Annual revenue ($)" optional>
              <input className={inputCls} inputMode="numeric" value={founder.annualRevenue} onChange={(e) => set('annualRevenue')(e.target.value)} placeholder="e.g. 120,000" />
            </Field>
            <Field label="Number of customers" optional>
              <input className={inputCls} inputMode="numeric" value={founder.numCustomers} onChange={(e) => set('numCustomers')(e.target.value)} placeholder="e.g. 40" />
            </Field>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-6">
        <button className={ghostBtn} onClick={onBack}><ArrowLeft className="w-4 h-4" /> Back</button>
        <button className={primaryBtn} onClick={onSubmit}>Start assessment <ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

function ChipGroup({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium border transition-all ${
              active
                ? 'border-transparent bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)]'
                : 'border-[var(--space-border-default)] bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function ScreenHeader({ icon: Icon, title, subtitle }: { icon: typeof User; title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--space-brand-primary-500)_18%,transparent)]">
          <Icon className="w-5 h-5 text-[var(--space-brand-highlight)]" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-[var(--space-text-primary)]">{title}</h2>
      </div>
      {subtitle && <p className="mt-2 text-sm text-[var(--space-text-secondary)]">{subtitle}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN 3 — ASSESSMENT
// ---------------------------------------------------------------------------
function AssessmentScreen({
  category, catIndex, questions, answers, setAnswer, answeredCount, complete, onBack, onNext,
}: {
  category: CategoryMeta;
  catIndex: number;
  questions: Question[];
  answers: AnswerMap;
  setAnswer: (qid: string, value: number) => void;
  answeredCount: number;
  complete: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const Icon = category.icon;
  const isEarlyNote = category.id === 'traction';
  const progressPct = Math.round((answeredCount / QUESTIONS.length) * 100);
  const startNum = catIndex * 5;
  return (
    <div>
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--space-brand-primary-500)_18%,transparent)]">
              <Icon className="w-5 h-5 text-[var(--space-brand-highlight)]" />
            </div>
            <div>
              <div className="text-xs font-medium text-[var(--space-text-muted)] uppercase tracking-wide">Category {catIndex + 1} of {CATEGORIES.length}</div>
              <h2 className="text-xl sm:text-2xl font-bold text-[var(--space-text-primary)]">{category.label}</h2>
            </div>
          </div>
          <div className="text-sm font-semibold text-[var(--space-text-secondary)]">{answeredCount}/{QUESTIONS.length}</div>
        </div>
        <div className="h-2 rounded-full bg-[var(--space-surface-card)] overflow-hidden">
          <div className="h-full rounded-full bg-[var(--space-brand-primary)] transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {isEarlyNote && (
        <NoteAboutEarlyStage />
      )}

      <div className="space-y-4">
        {questions.map((q, idx) => (
          <div key={q.id} className={`${cardCls} p-5`}>
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-lg bg-[var(--space-surface-muted)] flex items-center justify-center text-sm font-bold text-[var(--space-text-accent)]">{startNum + idx + 1}</div>
              <p className="text-[15px] sm:text-base text-[var(--space-text-primary)] leading-relaxed">{q.text}</p>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-1.5 sm:gap-2">
              {SCALE.map((s) => {
                const active = answers[q.id] === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setAnswer(q.id, s.value)}
                    className={`flex flex-col items-center justify-center rounded-xl border px-1 py-2.5 transition-all ${
                      active
                        ? 'border-transparent bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)]'
                        : 'border-[var(--space-border-default)] bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]'
                    }`}
                    aria-label={`${s.value} - ${s.label}`}
                  >
                    <span className="text-base font-bold">{s.value}</span>
                    <span className="text-[10px] sm:text-[11px] leading-tight text-center mt-0.5 opacity-90">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-6">
        <button className={ghostBtn} onClick={onBack}><ArrowLeft className="w-4 h-4" /> Back</button>
        <button className={primaryBtn} onClick={onNext} disabled={!complete}>
          {catIndex < CATEGORIES.length - 1 ? 'Next category' : 'See my results'} <ArrowRight className="w-4 h-4" />
        </button>
      </div>
      {!complete && <p className="mt-3 text-center text-xs text-[var(--space-text-muted)]">Answer all {questions.length} questions to continue.</p>}
    </div>
  );
}

function NoteAboutEarlyStage() {
  return (
    <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--space-brand-highlight-500)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-brand-highlight-500)_10%,transparent)] p-4 flex gap-3">
      <Sparkles className="w-5 h-5 text-[var(--space-brand-highlight)] shrink-0" />
      <p className="text-sm text-[var(--space-text-secondary)]">
        These questions assess evidence of demand — answer based on your research and early validation. Idea and
        pre-launch founders are not penalized for having no revenue yet.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN 4 — LEAD CAPTURE GATE
// ---------------------------------------------------------------------------
function GateScreen({
  gate, setGate, errors, saving, onBack, onSubmit,
}: {
  gate: { name: string; email: string; company: string; whatsapp: string; consent: boolean };
  setGate: Dispatch<SetStateAction<{ name: string; email: string; company: string; whatsapp: string; consent: boolean }>>;
  errors: Record<string, string>;
  saving: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[color-mix(in_srgb,var(--space-brand-primary-500)_18%,transparent)] mb-4">
          <Lock className="w-6 h-6 text-[var(--space-brand-highlight)]" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-[var(--space-text-primary)]">Your Investor Readiness Report is ready.</h2>
        <p className="mt-2 text-[var(--space-text-secondary)]">Enter your details below to unlock your personalized score and recommendations.</p>
      </div>

      <div className={`${cardCls} p-5 sm:p-7 space-y-5`}>
        <Field label="Name" error={errors.name}>
          <input className={inputCls} value={gate.name} onChange={(e) => setGate((g) => ({ ...g, name: e.target.value }))} placeholder="Jane Doe" />
        </Field>
        <Field label="Email" error={errors.email}>
          <input type="email" className={inputCls} value={gate.email} onChange={(e) => setGate((g) => ({ ...g, email: e.target.value }))} placeholder="jane@startup.com" />
        </Field>
        <Field label="Company" error={errors.company}>
          <input className={inputCls} value={gate.company} onChange={(e) => setGate((g) => ({ ...g, company: e.target.value }))} placeholder="Acme Inc." />
        </Field>
        <Field label="WhatsApp number" optional>
          <input className={inputCls} inputMode="tel" value={gate.whatsapp} onChange={(e) => setGate((g) => ({ ...g, whatsapp: e.target.value }))} placeholder="+1 555 123 4567" />
        </Field>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={gate.consent}
            onChange={(e) => setGate((g) => ({ ...g, consent: e.target.checked }))}
            className="mt-0.5 w-5 h-5 rounded accent-[var(--space-brand-primary)]"
          />
          <span className="text-sm text-[var(--space-text-secondary)]">I agree to receive updates and insights from FoundarOS.</span>
        </label>
      </div>

      <div className="flex items-center justify-between mt-6">
        <button className={ghostBtn} onClick={onBack} disabled={saving}><ArrowLeft className="w-4 h-4" /> Back</button>
        <button className={primaryBtn} onClick={onSubmit} disabled={saving}>
          {saving ? 'Preparing your report...' : 'Show My Investor Readiness Score'} {!saving && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN 5 + 6 — RESULTS & CONVERSION
// ---------------------------------------------------------------------------
function ResultsScreen({
  result, founder, company, assessedAt, saveError, onPrint, onCta, onRetake,
}: {
  result: ScoreResult;
  founder: FounderInfo;
  company: string;
  assessedAt: string;
  saveError: string | null;
  onPrint: () => void;
  onCta: () => void;
  onRetake: () => void;
}) {
  return (
    <div>
      {/* On-screen results */}
      <div className="ir-no-print">
        {saveError && (
          <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-warning)_10%,transparent)] p-3 text-sm text-[var(--space-text-secondary)]">
            {saveError}
          </div>
        )}

        <div className={`${cardCls} p-6 sm:p-8 text-center`}>
          <div className="text-sm font-medium text-[var(--space-text-muted)]">Founder Investor Readiness Report{company ? ` \u2014 ${company}` : ''}</div>
          <div className="mt-6"><ScoreBadge score={result.overall} label={result.label} /></div>
          <p className="mt-5 text-[var(--space-text-secondary)] max-w-lg mx-auto">{result.summary}</p>
          <p className="mt-4 text-xs text-[var(--space-text-muted)] max-w-xl mx-auto">{DISCLAIMER}</p>
        </div>

        <div className={`${cardCls} p-6 sm:p-8 mt-5`}>
          <h3 className="text-lg font-bold text-[var(--space-text-primary)] mb-5">Category breakdown</h3>
          <div className="space-y-4">
            {CATEGORIES.map((cat) => (
              <CategoryBar key={cat.id} label={cat.label} score={result.categories[cat.id]} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-5">
          <div className={`${cardCls} p-6`}>
            <div className="flex items-center gap-2 text-[var(--space-semantic-success)] font-semibold"><TrendingUp className="w-5 h-5" /> Your biggest strength</div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-lg font-bold text-[var(--space-text-primary)]">{result.strength.cat.label}</span>
              <span className="text-sm font-bold" style={{ color: scoreColor(result.strength.score) }}>{result.strength.score}/100</span>
            </div>
            <p className="mt-2 text-sm text-[var(--space-text-secondary)]">{result.strength.insight}</p>
          </div>
          <div className={`${cardCls} p-6`}>
            <div className="flex items-center gap-2 text-[var(--space-semantic-warning)] font-semibold"><Flag className="w-5 h-5" /> Your biggest gap</div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-lg font-bold text-[var(--space-text-primary)]">{result.gap.cat.label}</span>
              <span className="text-sm font-bold" style={{ color: scoreColor(result.gap.score) }}>{result.gap.score}/100</span>
            </div>
            <p className="mt-2 text-sm text-[var(--space-text-secondary)]">{result.gap.insight}</p>
          </div>
        </div>

        <div className={`${cardCls} p-6 sm:p-8 mt-5`}>
          <h3 className="text-lg font-bold text-[var(--space-text-primary)] mb-1">Your priority actions</h3>
          <p className="text-sm text-[var(--space-text-muted)] mb-5">The highest-impact moves to strengthen your readiness first.</p>
          <ol className="space-y-3">
            {result.actions.map((a, i) => (
              <li key={i} className="flex gap-3">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] flex items-center justify-center text-sm font-bold">{i + 1}</div>
                <p className="text-sm text-[var(--space-text-secondary)] leading-relaxed pt-0.5">{a}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* SCREEN 6 — Conversion */}
        <div className="mt-6 rounded-2xl p-6 sm:p-8 border border-[var(--space-border-strong)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--space-brand-primary-600)_30%,transparent),color-mix(in_srgb,var(--space-brand-primary-900)_45%,transparent))]">
          <h3 className="text-2xl sm:text-3xl font-bold text-[var(--space-text-primary)]">Don't just know your gaps. Fix them.</h3>
          <p className="mt-3 text-[var(--space-text-secondary)] max-w-2xl leading-relaxed">
            FoundarOS helps founders become more investor-ready by turning fragmented business information, fundraising
            preparation and founder workflows into a structured operating system for getting ready to raise. This
            scorecard shows you the gaps. FoundarOS helps you close them.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button className={primaryBtn} onClick={onCta}>Get Investor-Ready with FoundarOS <ArrowRight className="w-4 h-4" /></button>
            <button className={ghostBtn} onClick={onRetake}><RotateCcw className="w-4 h-4" /> Retake assessment</button>
            <button className={ghostBtn} onClick={onPrint}><Printer className="w-4 h-4" /> Download my report (Print)</button>
          </div>
        </div>
      </div>

      {/* Print-only report */}
      <PrintReport result={result} company={company} assessedAt={assessedAt} />
    </div>
  );
}

function PrintReport({ result, company, assessedAt }: { result: ScoreResult; company: string; assessedAt: string }) {
  return (
    <div className="ir-print-only" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ borderBottom: '2px solid #7C3AED', paddingBottom: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0A0B14' }}>
          Founder Investor Readiness Report{company ? ` \u2014 ${company}` : ''}
        </h1>
        <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>Date: {assessedAt}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 44, fontWeight: 700, color: '#0A0B14' }}>{result.overall}/100</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#7C3AED' }}>{result.label}</div>
      </div>
      <p style={{ fontSize: 13, color: '#333', marginBottom: 20 }}>{result.summary}</p>

      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0A0B14', marginBottom: 8 }}>Category scores</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
        <tbody>
          {CATEGORIES.map((cat) => (
            <tr key={cat.id} style={{ borderBottom: '1px solid #e5e5e5' }}>
              <td style={{ padding: '8px 0', fontSize: 13, color: '#0A0B14' }}>{cat.label}</td>
              <td style={{ padding: '8px 0', fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#0A0B14' }}>{result.categories[cat.id]}/100</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0A0B14', margin: '0 0 4px' }}>Biggest strength</h3>
          <div style={{ fontSize: 13, color: '#333' }}>{result.strength.cat.label} ({result.strength.score}/100)</div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{result.strength.insight}</div>
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0A0B14', margin: '0 0 4px' }}>Biggest gap</h3>
          <div style={{ fontSize: 13, color: '#333' }}>{result.gap.cat.label} ({result.gap.score}/100)</div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{result.gap.insight}</div>
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0A0B14', marginBottom: 8 }}>Priority actions</h2>
      <ol style={{ paddingLeft: 18, margin: '0 0 20px' }}>
        {result.actions.map((a, i) => (
          <li key={i} style={{ fontSize: 13, color: '#333', marginBottom: 6 }}>{a}</li>
        ))}
      </ol>

      <p style={{ fontSize: 11, color: '#777', borderTop: '1px solid #e5e5e5', paddingTop: 12 }}>{DISCLAIMER}</p>
      <p style={{ fontSize: 12, color: '#7C3AED', fontWeight: 600, marginTop: 8 }}>Generated by FoundarOS — www.foundaros.com</p>
    </div>
  );
}
