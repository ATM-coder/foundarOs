import { useState, useMemo, useEffect, useRef, type ReactNode, type Ref } from 'react';
import {
  Compass,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Loader2,
  Check,
  Rocket,
  MessageCircle,
  Printer,
  ArrowUpRight,
  Gauge,
  Info,
  Copy,
  RefreshCw,
  Target,
  Plus,
  Star,
  ClipboardList,
} from 'lucide-react';
import { tw } from '../../lib/colors';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';

/* ============================================================================
 * FoundarOS — Idea Discovery (simplified flow)
 *
 * The pre-idea path of the FoundarOS founder journey (DISCOVER → VALIDATE →
 * BUILD → ASSESS → FUND → OPERATE). Separate from Gap Radar: it never scores
 * fundability and never tells an idea-less founder they are "unfundable".
 *
 * Flow (4 screens + 1 loading wait, down from 12 phases / 4 AI waits):
 *   home → questions (3 short steps) → results (3 ideas) → plan → build
 *
 *   0. home       First-time users see a short welcome. Returning users see
 *                 "My ideas": every run, idea and plan they have saved, so
 *                 nothing is lost when they open another feature or log out.
 *   1. questions  8 questions (4 required) across 3 steps, mostly tap-to-answer.
 *   2. results    ONE AI call returns a short founder snapshot + 3 distinct
 *                 ideas. "Show me different ideas" regenerates; "Edit my
 *                 answers" goes back.
 *   3. plan       The chosen idea + its 14-day test plan (loads inline, no
 *                 full-screen wait) with two clear next steps: Build on Audos
 *                 or test with Gap Radar.
 *
 * Data model (WorkspaceDB, session-scoped, reads via useWorkspaceDB / writes
 * via window.__workspaceDb). Column sets are unchanged from the previous
 * version so existing rows stay compatible:
 *   idea_discovery_profiles          — questionnaire responses (one per run)
 *   idea_discovery_concepts          — generated business concepts
 *   idea_discovery_validation_plans  — 14-day validation plan for the concept
 * (idea_discovery_territories is no longer written: territories were removed
 *  as a separate step.)
 *
 * Persistence: everything above is WRITTEN as the user goes AND READ BACK on
 * open. Rows are scoped to the user's workspace session, so the same person
 * logging in again (which resumes their session) sees the same ideas. Never
 * switch these reads to `shared: true`: that would show one founder's ideas
 * to every other founder.
 * ========================================================================== */

const IDEA_COUNT = 3;

const STARTABILITY_LABELS = ['Easy to test', 'Moderate to test', 'Requires significant resources'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// 'welcome' is the home screen: the welcome pitch for new users, "My ideas" for
// anyone who has saved work.
type Phase = 'welcome' | 'questions' | 'loading' | 'results' | 'plan' | 'build-brief' | 'build-transition';

type AnswerValue = string | string[] | number;
type AnswerMap = Record<string, AnswerValue>;

type QuestionType = 'textarea' | 'tags' | 'multiselect' | 'radio' | 'scale' | 'currency';

interface Question {
  id: string;
  label: string;
  helper?: string;
  type: QuestionType;
  options?: string[];
  optional?: boolean;
  maxTags?: number;
  placeholder?: string;
}

interface Step {
  title: string;
  intro?: string;
  questions: Question[];
}

interface Snapshot {
  summary: string;
  strengths: string[];
}

interface Concept {
  id?: number;
  name: string;
  pitch: string;
  problem: string;
  targetCustomer: string;
  solution: string;
  businessModel: string;
  founderFit: string;
  founderAdvantage: string;
  assumptions: string[];
  validationExperiment: string;
  startability: string;
  // Set when the concept comes from (or has been written to) the database.
  selected?: boolean;
  createdAt?: string;
}

// One saved discovery: the answers plus every idea generated from them.
interface SavedRun {
  id: number;
  createdAt: string;
  answers: AnswerMap;
  concepts: Concept[];
}

interface DiscoveryResult {
  snapshot: Snapshot;
  concepts: Concept[];
  usedFallback: boolean;
}

interface ValidationPlan {
  days_1_3: string;
  days_4_7: string;
  days_8_10: string;
  days_11_12: string;
  days_13_14: string;
  interviewQuestions: string[];
}

type BuildPartner = {
  id: string;
  name: string;
  configTable: string;
  referralTable: string;
};

type ReferralAttributes = {
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  source?: string;
};

// Where "Build on Audos" goes when the owner has not set a referral link.
const DEFAULT_AUDOS_URL = 'https://audos.com';

const BUILD_PARTNERS: Record<string, BuildPartner> = {
  audos: {
    id: 'audos',
    name: 'Audos',
    configTable: 'audos_referral_config',
    referralTable: 'audos_referrals',
  },
};

// ---------------------------------------------------------------------------
// Questionnaire — 3 short steps. Only 4 questions are required.
// ---------------------------------------------------------------------------
const INTEREST_AREAS = [
  'Technology', 'AI', 'Finance', 'Education', 'Healthcare', 'Agriculture', 'Food', 'Fashion',
  'Logistics', 'Energy', 'Real estate', 'Beauty', 'Family & parenting', 'Travel', 'Entertainment',
  'Professional services', 'Retail & e-commerce', 'Manufacturing', 'Sustainability', 'Media/content', 'Other',
];

const ACCESS_GROUPS = [
  'Professionals', 'Small business owners', 'Students', 'Parents', 'Teachers', 'Healthcare workers',
  'Engineers', 'Traders', 'Importers/exporters', 'Farmers', 'Creatives', 'Fashion professionals',
  'Technology professionals', 'Corporate employees', 'Government/public-sector workers', 'Community groups',
  'Religious/community organizations', 'Other',
];

const STEPS: Step[] = [
  {
    title: 'About you',
    intro: 'Start with what you already know. Short answers are fine.',
    questions: [
      { id: 'experience_current', type: 'textarea', label: 'What do you do, or know really well?', helper: 'Your job, your business, or something people always ask you about.', placeholder: 'e.g. I manage operations for a logistics company…' },
      { id: 'skills', type: 'tags', optional: true, label: 'Your top skills', helper: 'Up to 3. Press Enter after each one.', maxTags: 3, placeholder: 'e.g. sales, design, bookkeeping…' },
    ],
  },
  {
    title: 'What needs fixing',
    intro: 'Good ideas usually start with a problem you keep noticing.',
    questions: [
      { id: 'problems_frustrations', type: 'textarea', label: 'What problem do you keep noticing — at work, in your community, or in your own life?', helper: 'Something that wastes time or money, or that people complain about.', placeholder: 'e.g. Small shops keep running out of stock because they track it on paper…' },
      { id: 'interests_areas', type: 'multiselect', optional: true, label: 'Any areas you would enjoy working in?', helper: 'Pick a few, or skip.', options: INTEREST_AREAS },
    ],
  },
  {
    title: 'Your situation',
    intro: 'Who you can reach and how much time you have shape which ideas are realistic.',
    questions: [
      { id: 'access_groups', type: 'multiselect', label: 'Who could you easily talk to about a business idea?', helper: 'Pick all that apply.', options: ACCESS_GROUPS },
      { id: 'goals_time_per_week', type: 'radio', label: 'How much time can you give this each week?', options: ['Less than 3 hours', '3–5 hours', '5–10 hours', '10–20 hours', '20+ hours'] },
      { id: 'goals_capital', type: 'currency', optional: true, label: 'How much could you invest to get started?' },
      { id: 'goals_business_type', type: 'radio', optional: true, label: 'What kind of business appeals to you?', options: ['Service business', 'Digital product', 'Software/SaaS', 'Marketplace', 'E-commerce', 'Physical product', 'Consultancy', 'Local/offline business', 'Not sure'] },
    ],
  },
];

const CURRENCIES = ['$', '₦', '£', '€', 'KSh', 'GH₵', 'R'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function asText(v: AnswerValue | undefined): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function openApp(appId: string, intent?: string) {
  if (intent) {
    try { window.localStorage.setItem('foundaros:gap-radar-intent', intent); } catch { /* noop */ }
  }
  try { window.dispatchEvent(new CustomEvent('openApp', { detail: { appId } })); } catch { /* noop */ }
}

function openGapRadar() {
  openApp('gap-radar');
}

function readReferralAttributes(): ReferralAttributes {
  try {
    return JSON.parse(window.sessionStorage.getItem('foundaros:referral_attrs') || '{}') as ReferralAttributes;
  } catch {
    return {};
  }
}

function sanitizeStartability(label: string | undefined): string {
  const match = STARTABILITY_LABELS.find((l) => l.toLowerCase() === String(label || '').toLowerCase());
  return match || 'Moderate to test';
}

function responseToJson(content: string): any {
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}

async function callDiscoveryAI(system: string, user: string, maxTokens: number): Promise<any> {
  const ws = (window as any).__workspaceDb;
  if (!ws?.token) throw new Error('Workspace token unavailable');
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': ws.token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error?.message || detail?.error || `AI request failed (${response.status})`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI returned no content');
  return responseToJson(content);
}

const GUARDRAIL_LANGUAGE =
  'Ground every claim in the founder\u2019s actual answers — never invent facts. ' +
  'Never use the words best idea, guaranteed, definitely profitable, or high probability of success. ' +
  'Prefer phrases like worth exploring, strong founder fit, promising starting point, and requires validation. ' +
  'This founder is at the pre-idea stage: never score fundability, never mention a traction or readiness score, ' +
  'and never imply they are unfundable. Be premium, intelligent, encouraging and founder-focused.';

// ---------------------------------------------------------------------------
// AI generators (with deterministic fallbacks so the flow never dead-ends)
// ---------------------------------------------------------------------------
function answersDigest(answers: AnswerMap): string {
  const lines: string[] = [];
  STEPS.forEach((step) => {
    step.questions.forEach((q) => {
      const val = asText(answers[q.id]);
      if (val.trim()) lines.push(`- ${q.label} => ${val}`);
    });
  });
  return lines.join('\n');
}

function normalizeConcept(c: any): Concept {
  const solution = String(c?.solution || '').trim();
  return {
    name: String(c?.name || 'Business concept').trim(),
    pitch: String(c?.pitch || '').trim() || solution,
    problem: String(c?.problem || '').trim(),
    targetCustomer: String(c?.targetCustomer || '').trim(),
    solution,
    businessModel: String(c?.businessModel || '').trim(),
    founderFit: String(c?.founderFit || '').trim(),
    founderAdvantage: String(c?.founderAdvantage || '').trim(),
    assumptions: Array.isArray(c?.assumptions) ? c.assumptions.map(String).filter(Boolean) : [],
    validationExperiment: String(c?.validationExperiment || '').trim(),
    startability: sanitizeStartability(c?.startability),
  };
}

// ---------------------------------------------------------------------------
// Reading saved work back from the database. Array columns can come back as
// real arrays or as JSON strings depending on the column type, so every read
// goes through parseJson.
// ---------------------------------------------------------------------------
function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function asStringList(value: unknown): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
}

function rowToConcept(row: any): Concept {
  return {
    ...normalizeConcept({
      name: row?.name,
      problem: row?.problem,
      targetCustomer: row?.target_customer,
      solution: row?.solution,
      businessModel: row?.business_model,
      founderFit: row?.founder_fit,
      founderAdvantage: row?.founder_advantage,
      assumptions: asStringList(row?.assumptions),
      validationExperiment: row?.validation_experiment,
      startability: row?.startability,
    }),
    id: typeof row?.id === 'number' ? row.id : undefined,
    selected: row?.selected === true || row?.selected === 'true' || row?.selected === 1,
    createdAt: row?.created_at ? String(row.created_at) : undefined,
  };
}

function rowToAnswers(row: any): AnswerMap {
  const out: AnswerMap = {};
  const text = (key: string, col: string = key) => {
    const v = row?.[col];
    if (typeof v === 'string' && v.trim()) out[key] = v;
  };
  const list = (key: string) => {
    const v = asStringList(row?.[key]);
    if (v.length) out[key] = v;
  };
  text('experience_current');
  text('problems_frustrations');
  text('goals_time_per_week');
  text('goals_capital');
  text('goals_business_type');
  list('skills');
  list('interests_areas');
  list('access_groups');
  return out;
}

function rowToPlan(row: any): ValidationPlan {
  const fb = fallbackPlanShape();
  return {
    days_1_3: String(row?.days_1_3 || '').trim() || fb.days_1_3,
    days_4_7: String(row?.days_4_7 || '').trim() || fb.days_4_7,
    days_8_10: String(row?.days_8_10 || '').trim() || fb.days_8_10,
    days_11_12: String(row?.days_11_12 || '').trim() || fb.days_11_12,
    days_13_14: String(row?.days_13_14 || '').trim() || fb.days_13_14,
    interviewQuestions: asStringList(row?.interview_questions),
  };
}

function fallbackPlanShape(): ValidationPlan {
  return { days_1_3: '', days_4_7: '', days_8_10: '', days_11_12: '', days_13_14: '', interviewQuestions: [] };
}

function formatDate(value: string | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ONE call replaces the old profile → territories → concepts chain.
async function generateIdeas(answers: AnswerMap, avoidNames: string[]): Promise<DiscoveryResult> {
  const system = [
    'You are FoundarOS Idea Discovery. From a founder’s short answers, do two things:',
    '1) write a brief snapshot of what stands out about them;',
    `2) suggest exactly ${IDEA_COUNT} distinct business concepts worth exploring.`,
    'The concepts must differ from each other (different customer or different business model), and at least one must be easy to test with the founder’s existing network.',
    'Use plain, simple language and short sentences. No jargon. Do NOT rank the concepts or pick a winner. These are concepts worth exploring, not validated businesses.',
    avoidNames.length ? `Do NOT repeat or closely resemble these earlier concepts: ${avoidNames.join('; ')}.` : '',
    GUARDRAIL_LANGUAGE,
    'Return ONLY valid JSON of this exact shape:',
    '{"snapshot":{"summary":"2 sentences on what stands out about this founder, grounded in their answers","strengths":["up to 4 short phrases"]},"concepts":[{"name":"concept name","pitch":"ONE sentence: what it is and who it is for","problem":"the problem it solves","targetCustomer":"who would pay","solution":"what the business provides","businessModel":"how it makes money","founderFit":"ONE sentence tied to their answers","founderAdvantage":"experience, skill, relationship or access they already have","assumptions":["2 key things to prove"],"validationExperiment":"smallest practical experiment, one sentence","startability":"one of: Easy to test | Moderate to test | Requires significant resources"}]}',
  ].filter(Boolean).join('\n');
  const user = `Founder answers:\n${answersDigest(answers)}`;
  try {
    const raw = await callDiscoveryAI(system, user, 3200);
    const list = Array.isArray(raw.concepts) ? raw.concepts : [];
    const concepts = list.slice(0, IDEA_COUNT).map(normalizeConcept);
    if (!concepts.length) throw new Error('No concepts returned');
    const fb = fallbackSnapshot(answers);
    return {
      snapshot: {
        summary: String(raw?.snapshot?.summary || '').trim() || fb.summary,
        strengths: Array.isArray(raw?.snapshot?.strengths) && raw.snapshot.strengths.length
          ? raw.snapshot.strengths.map(String).slice(0, 4)
          : fb.strengths,
      },
      concepts,
      usedFallback: false,
    };
  } catch (error) {
    console.warn('[IdeaDiscovery] idea generation unavailable, using rubric.', error);
    return { snapshot: fallbackSnapshot(answers), concepts: fallbackConcepts(answers), usedFallback: true };
  }
}

function fallbackSnapshot(answers: AnswerMap): Snapshot {
  const skills = Array.isArray(answers.skills) ? (answers.skills as string[]) : [];
  return {
    summary: 'These ideas sit where your experience, the problems you notice and the people you can reach overlap.',
    strengths: skills.slice(0, 4),
  };
}

function fallbackConcepts(answers: AnswerMap): Concept[] {
  const groups = Array.isArray(answers.access_groups) ? (answers.access_groups as string[]) : [];
  const skills = Array.isArray(answers.skills) ? (answers.skills as string[]) : [];
  const group = groups[0] || 'people in your network';
  const group2 = groups[1] || group;
  const problem = asText(answers.problems_frustrations) || 'A recurring problem you have noticed';
  const know = asText(answers.experience_current) || 'What you already know well';
  const skill = skills[0] || 'your expertise';
  return [
    {
      name: `Done-for-you service for ${group}`,
      pitch: `A simple paid service that takes this problem off the plate of ${group}.`,
      problem,
      targetCustomer: group,
      solution: 'You personally deliver the fix as a small, clearly priced service.',
      businessModel: 'Fixed fee per job, or a monthly retainer.',
      founderFit: 'Built on what you already know and the people you can already reach.',
      founderAdvantage: know,
      assumptions: ['They feel this problem strongly enough to pay', 'You can reach enough of them directly'],
      validationExperiment: 'Offer the service to 5 people you know at a small starter price.',
      startability: 'Easy to test',
    },
    {
      name: `Coaching or training from ${skill}`,
      pitch: `Teach ${group2} how to solve this problem themselves.`,
      problem,
      targetCustomer: group2,
      solution: 'A short workshop, course or coaching programme based on your experience.',
      businessModel: 'Paid workshop, cohort or one-to-one sessions.',
      founderFit: 'Turns what people already ask you about into something they pay for.',
      founderAdvantage: know,
      assumptions: ['People want to learn this rather than outsource it', 'Your experience is credible to them'],
      validationExperiment: 'Run one small paid session with a handful of people.',
      startability: 'Moderate to test',
    },
    {
      name: `Simple tool or template kit for ${group}`,
      pitch: `A ready-made tool that removes the same problem for many people at once.`,
      problem,
      targetCustomer: group,
      solution: 'A lightweight digital tool, template or checklist that solves the core problem.',
      businessModel: 'One-time purchase or small monthly subscription.',
      founderFit: 'Packages your know-how so it can reach more people than you can serve one by one.',
      founderAdvantage: know,
      assumptions: ['A self-serve version is good enough for them', 'They will pay without a personal service'],
      validationExperiment: 'Share a mock-up with 10 people and ask who would pay for it.',
      startability: 'Moderate to test',
    },
  ];
}

async function generateValidationPlan(answers: AnswerMap, concept: Concept): Promise<ValidationPlan> {
  const system = [
    'You are FoundarOS Idea Discovery, generating a personalized 14-day validation plan for a chosen business concept.',
    GUARDRAIL_LANGUAGE,
    'The plan must follow this cadence: Days 1-3 identify 10 potential customers; Days 4-7 conduct customer interviews; Days 8-10 test the proposed solution; Days 11-12 test willingness to pay; Days 13-14 review evidence and decide whether to continue, modify or discard.',
    'Also generate 5-10 non-leading customer interview questions.',
    'Return ONLY valid JSON of this shape:',
    '{"days_1_3":"specific actions","days_4_7":"specific actions","days_8_10":"specific actions","days_11_12":"specific actions","days_13_14":"specific actions","interviewQuestions":["non-leading question"]}',
  ].join('\n');
  const user = `Concept: ${concept.name}\nProblem: ${concept.problem}\nTarget customer: ${concept.targetCustomer}\nSolution: ${concept.solution}\nBusiness model: ${concept.businessModel}\nKey assumptions: ${concept.assumptions.join('; ')}\nFounder access: ${asText(answers.access_groups)}`;
  try {
    const raw = await callDiscoveryAI(system, user, 2600);
    return {
      days_1_3: String(raw.days_1_3 || '').trim() || fallbackPlan(concept).days_1_3,
      days_4_7: String(raw.days_4_7 || '').trim() || fallbackPlan(concept).days_4_7,
      days_8_10: String(raw.days_8_10 || '').trim() || fallbackPlan(concept).days_8_10,
      days_11_12: String(raw.days_11_12 || '').trim() || fallbackPlan(concept).days_11_12,
      days_13_14: String(raw.days_13_14 || '').trim() || fallbackPlan(concept).days_13_14,
      interviewQuestions: Array.isArray(raw.interviewQuestions) && raw.interviewQuestions.length ? raw.interviewQuestions.map(String) : fallbackPlan(concept).interviewQuestions,
    };
  } catch (error) {
    console.warn('[IdeaDiscovery] validation plan AI unavailable, using rubric.', error);
    return fallbackPlan(concept);
  }
}

function fallbackPlan(concept: Concept): ValidationPlan {
  return {
    days_1_3: `List 10 potential customers who fit “${concept.targetCustomer}”. Use your existing network, communities and referrals.`,
    days_4_7: 'Reach out and hold short interviews. Listen for how they solve the problem today and what it costs them.',
    days_8_10: `Show a rough version of “${concept.solution}” and watch how they react. Note what excites or confuses them.`,
    days_11_12: 'Make a small, real ask for money (a pre-order, deposit or paid pilot) to test genuine willingness to pay.',
    days_13_14: 'Review the evidence honestly and decide: continue, modify the concept, or discard it and explore another.',
    interviewQuestions: [
      'How do you currently solve this problem?',
      'What is the most frustrating part of that process?',
      'How often does this happen?',
      'What does this problem currently cost you?',
      'Have you ever paid for a solution?',
      'What have you tried?',
      'What would make you change your current approach?',
    ],
  };
}

// ---------------------------------------------------------------------------
// Small UI primitives
// ---------------------------------------------------------------------------
function StartBadge({ label }: { label: string }) {
  const tone =
    label === 'Easy to test'
      ? 'var(--space-semantic-success)'
      : label === 'Requires significant resources'
        ? 'var(--space-semantic-warning)'
        : 'var(--space-brand-highlight-500)';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        color: tone,
        background: `color-mix(in srgb, ${tone} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 40%, transparent)`,
      }}
    >
      <Gauge className="w-3 h-3" /> {label}
    </span>
  );
}

function PrimaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm ${tw.button.primary} ${disabled ? tw.button.disabled : ''}`}
    >
      {children}
    </button>
  );
}

function StepLoader({ label, hint = 'Grounding everything in your own answers. This takes a few moments.' }: { label: string; hint?: string }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-4 py-24 text-center px-6">
      <div className="relative">
        <span className="absolute inset-0 rounded-full blur-xl" style={{ background: 'color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)' }} />
        <Loader2 className={`relative w-10 h-10 animate-spin ${tw.icon.primary}`} />
      </div>
      <p className={`text-base font-semibold ${tw.typography.color.primary}`}>{label}</p>
      <p className={`text-sm ${tw.typography.color.muted} max-w-sm`}>{hint}</p>
    </div>
  );
}

// Module-level so the subtree is NOT remounted on every keystroke (which would
// otherwise steal focus from the textareas mid-typing).
function Shell({ children, innerRef }: { children: ReactNode; innerRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={innerRef} className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function IdeaDiscovery() {
  const { sessionId, visitorId } = useSpaceRuntime();
  // Reads (session-scoped, deliberately NOT shared): the user's saved runs,
  // ideas and plans. These power the "My ideas" home screen.
  const dbOrder = { column: 'created_at', direction: 'desc' };
  const { data: profileRows, loading: profilesLoading, error: profilesError, refresh: refreshProfiles } = (window as any).useWorkspaceDB('idea_discovery_profiles', {
    orderBy: dbOrder,
    limit: 25,
  }) as { data: any[]; loading: boolean; error?: unknown; refresh?: () => unknown };
  const { data: conceptRows, loading: conceptsLoading, error: conceptsError, refresh: refreshConcepts } = (window as any).useWorkspaceDB('idea_discovery_concepts', {
    orderBy: dbOrder,
    limit: 200,
  }) as { data: any[]; loading: boolean; error?: unknown; refresh?: () => unknown };
  const { data: planRows, refresh: refreshPlans } = (window as any).useWorkspaceDB('idea_discovery_validation_plans', {
    orderBy: dbOrder,
    limit: 200,
  }) as { data: any[]; refresh?: () => unknown };
  const { data: referralConfigRows, loading: referralConfigLoading } = (window as any).useWorkspaceDB('audos_referral_config', {
    shared: true,
    limit: 10,
  }) as { data: any[]; loading: boolean };

  const [phase, setPhase] = useState<Phase>('welcome');
  const [loadingLabel, setLoadingLabel] = useState('Finding ideas that fit you…');
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [profileId, setProfileId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selectedConceptIndex, setSelectedConceptIndex] = useState<number | null>(null);
  const [plan, setPlan] = useState<ValidationPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [buildBriefText, setBuildBriefText] = useState('');
  const [referralUrl, setReferralUrl] = useState('');
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // True when the current ideas could not be written to the database. Those
  // ideas exist only on screen, so we say so rather than letting them vanish.
  const [saveFailed, setSaveFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const planRequestRef = useRef(0);

  const refreshSaved = () => {
    [refreshProfiles, refreshConcepts, refreshPlans].forEach((fn) => {
      try { void fn?.(); } catch { /* noop */ }
    });
  };

  // Saved work, rebuilt from the database rows: newest run first.
  const savedRuns = useMemo<SavedRun[]>(() => {
    const profiles = Array.isArray(profileRows) ? profileRows : [];
    const concepts = Array.isArray(conceptRows) ? conceptRows : [];
    return profiles
      .filter((p) => typeof p?.id === 'number')
      .map((p) => ({
        id: p.id as number,
        createdAt: p.created_at ? String(p.created_at) : '',
        answers: rowToAnswers(p),
        concepts: concepts
          .filter((c) => c?.profile_id === p.id)
          .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
          .map(rowToConcept),
      }))
      .filter((run) => run.concepts.length > 0);
  }, [profileRows, conceptRows]);

  // Newest saved plan per idea (rows arrive newest first).
  const savedPlans = useMemo(() => {
    const byConcept = new Map<number, ValidationPlan>();
    (Array.isArray(planRows) ? planRows : []).forEach((row) => {
      const cid = row?.concept_id;
      if (typeof cid === 'number' && !byConcept.has(cid)) byConcept.set(cid, rowToPlan(row));
    });
    return byConcept;
  }, [planRows]);

  const savedLoading = Boolean(profilesLoading || conceptsLoading);
  const savedLoadFailed = Boolean(profilesError || conceptsError);

  const buildBriefDraft = useMemo(() => {
    if (selectedConceptIndex === null) return null;
    const c = concepts[selectedConceptIndex];
    if (!c) return null;
    const valueProposition = c.founderAdvantage || c.founderFit || 'To be sharpened through validation.';
    const marketContext = [asText(answers.access_groups), asText(answers.access_network_size)]
      .filter(Boolean)
      .join(' · ');
    const coreFeatures = c.solution
      .split(/[.;]\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);
    const suggestedMvp = [
      c.validationExperiment,
      ...coreFeatures.map((feature) => `Initial capability: ${feature}`),
    ].filter(Boolean);
    const validationInsights = plan
      ? [plan.days_1_3, plan.days_4_7, plan.days_8_10, plan.days_11_12, plan.days_13_14].filter(Boolean).join(' ')
      : 'Complete the 14-day validation plan to add evidence from customer conversations and willingness-to-pay tests.';
    const lines = [
      'FoundarOS Build Brief',
      '',
      `Idea: ${c.name}`,
      `Problem: ${c.problem}`,
      `Target users: ${c.targetCustomer}`,
      `Solution: ${c.solution}`,
      `Key value proposition: ${valueProposition}`,
      ...(marketContext ? [`Market/geographic context: ${marketContext}`] : []),
      'Core features:',
      ...coreFeatures.map((feature) => `• ${feature}`),
      'Suggested MVP:',
      ...suggestedMvp.map((item) => `• ${item}`),
      'Important assumptions:',
      ...c.assumptions.map((assumption) => `• ${assumption}`),
      `Validation insights: ${validationInsights}`,
    ];
    return { c, valueProposition, marketContext, coreFeatures, suggestedMvp, validationInsights, text: lines.join('\n') };
  }, [answers.access_groups, answers.access_network_size, concepts, plan, selectedConceptIndex]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const captured: ReferralAttributes = {};
      (['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'source'] as const).forEach((key) => {
        const value = params.get(key);
        if (value) captured[key] = value;
      });
      if (Object.keys(captured).length > 0) {
        window.sessionStorage.setItem(
          'foundaros:referral_attrs',
          JSON.stringify({ ...readReferralAttributes(), ...captured }),
        );
      }
    } catch { /* storage or URL access unavailable */ }
  }, []);

  useEffect(() => {
    if (phase === 'build-brief' && buildBriefDraft) {
      setBuildBriefText(buildBriefDraft.text);
      setReferralError(null);
    }
  }, [buildBriefDraft, phase]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  }, [phase, stepIndex]);

  const step = STEPS[stepIndex];
  const totalSteps = STEPS.length;

  const setAnswer = (id: string, value: AnswerValue) => setAnswers((prev) => ({ ...prev, [id]: value }));

  const isQuestionAnswered = (q: Question): boolean => {
    if (q.optional) return true;
    const v = answers[q.id];
    if (q.type === 'multiselect' || q.type === 'tags') return Array.isArray(v) && v.length > 0;
    if (q.type === 'scale') return typeof v === 'number' && v >= 1;
    return asText(v).trim().length > 0;
  };

  const stepComplete = step ? step.questions.every(isQuestionAnswered) : false;

  // -- persistence helpers (best-effort; UI is driven by state) -------------
  const persistProfile = async (): Promise<number | null> => {
    try {
      const db = (window as any).__workspaceDb;
      const payload = {
        experience_current: asText(answers.experience_current),
        experience_other: asText(answers.experience_other),
        skills: Array.isArray(answers.skills) ? answers.skills : [],
        skills_help: asText(answers.skills_help),
        skills_knowledge: asText(answers.skills_knowledge),
        interests_topics: asText(answers.interests_topics),
        interests_areas: Array.isArray(answers.interests_areas) ? answers.interests_areas : [],
        interests_work: asText(answers.interests_work),
        problems_frustrations: asText(answers.problems_frustrations),
        problems_others: asText(answers.problems_others),
        problems_better_way: asText(answers.problems_better_way),
        problems_personal: asText(answers.problems_personal),
        access_groups: Array.isArray(answers.access_groups) ? answers.access_groups : [],
        access_network_size: asText(answers.access_network_size),
        goals_motivation: Array.isArray(answers.goals_motivation) ? answers.goals_motivation : [],
        goals_time_per_week: asText(answers.goals_time_per_week),
        goals_business_type: asText(answers.goals_business_type),
        goals_capital: asText(answers.goals_capital),
        goals_risk_tolerance: typeof answers.goals_risk_tolerance === 'number' ? answers.goals_risk_tolerance : null,
        goals_completion_vision: asText(answers.goals_completion_vision),
        context_additional: asText(answers.context_additional),
        context_success_definition: asText(answers.context_success_definition),
        status: 'completed',
      };
      await db.from('idea_discovery_profiles').insert(payload);
      const res = await db.from('idea_discovery_profiles').orderBy('created_at', 'desc').limit(1).get();
      const id = res?.data?.[0]?.id;
      return typeof id === 'number' ? id : null;
    } catch (error) {
      console.warn('[IdeaDiscovery] could not persist profile.', error);
      return null;
    }
  };

  const persistConcepts = async (pid: number | null, list: Concept[]): Promise<Concept[]> => {
    if (!pid) return list;
    try {
      const db = (window as any).__workspaceDb;
      for (const c of list) {
        await db.from('idea_discovery_concepts').insert({
          profile_id: pid,
          territory_id: null,
          name: c.name,
          problem: c.problem,
          target_customer: c.targetCustomer,
          solution: c.solution,
          business_model: c.businessModel,
          founder_fit: c.founderFit,
          founder_advantage: c.founderAdvantage,
          assumptions: c.assumptions,
          validation_experiment: c.validationExperiment,
          startability: c.startability,
          selected: false,
        });
      }
      const res = await db.from('idea_discovery_concepts').orderBy('created_at', 'desc').limit(list.length).get();
      const rows: any[] = Array.isArray(res?.data) ? res.data : [];
      return list.map((c) => {
        const match = rows.find((r) => r.name === c.name && r.profile_id === pid);
        return match ? { ...c, id: match.id } : c;
      });
    } catch (error) {
      console.warn('[IdeaDiscovery] could not persist concepts.', error);
      return list;
    }
  };

  const persistValidationPlan = async (pid: number | null, conceptId: number | null, built: ValidationPlan) => {
    if (!pid) return;
    try {
      const db = (window as any).__workspaceDb;
      await db.from('idea_discovery_validation_plans').insert({
        profile_id: pid,
        concept_id: conceptId,
        days_1_3: built.days_1_3,
        days_4_7: built.days_4_7,
        days_8_10: built.days_8_10,
        days_11_12: built.days_11_12,
        days_13_14: built.days_13_14,
        interview_questions: built.interviewQuestions,
      });
    } catch (error) {
      console.warn('[IdeaDiscovery] could not persist validation plan.', error);
    }
  };

  // -- flow transitions -----------------------------------------------------
  const applyResult = async (result: DiscoveryResult, pid: number | null) => {
    const withIds = await persistConcepts(pid, result.concepts);
    planRequestRef.current += 1; // cancel any in-flight plan request
    setSaveFailed(!pid || withIds.some((c) => typeof c.id !== 'number'));
    refreshSaved();
    setSnapshot(result.snapshot);
    setConcepts(withIds);
    setSelectedConceptIndex(null);
    setPlan(null);
    setPlanLoading(false);
    setNotice(
      result.usedFallback
        ? 'We couldn’t reach the idea generator, so these are starter ideas built from your answers. Tap “Show me different ideas” to try again.'
        : null,
    );
    setPhase('results');
  };

  const finishQuestionnaire = async () => {
    setLoadingLabel('Finding ideas that fit you…');
    setPhase('loading');
    const [result, pid] = await Promise.all([generateIdeas(answers, []), persistProfile()]);
    setProfileId(pid);
    await applyResult(result, pid);
  };

  const showDifferentIdeas = async () => {
    setLoadingLabel('Looking for different ideas…');
    setPhase('loading');
    const result = await generateIdeas(answers, concepts.map((c) => c.name));
    await applyResult(result, profileId);
  };

  // Choosing an idea opens the plan screen immediately. A plan that was saved
  // earlier is reused as-is (no AI call); otherwise the 14-day plan loads inline
  // so there is no full-screen wait, and is saved for next time.
  // `list`, `ctxAnswers` and `ctxProfileId` default to the current run; they are
  // passed explicitly when opening a saved run, whose state has not applied yet.
  const chooseConcept = (
    idx: number,
    list: Concept[] = concepts,
    ctxAnswers: AnswerMap = answers,
    ctxProfileId: number | null = profileId,
  ) => {
    const chosen = list[idx];
    if (!chosen) return;
    if (list === concepts && selectedConceptIndex === idx && plan) {
      setPhase('plan');
      return;
    }
    const requestId = planRequestRef.current + 1;
    planRequestRef.current = requestId;
    setSelectedConceptIndex(idx);
    setConcepts((prev) => prev.map((c, i) => (i === idx ? { ...c, selected: true } : c)));
    setPhase('plan');

    const markSelected = async () => {
      if (typeof chosen.id !== 'number' || chosen.selected) return;
      try {
        const db = (window as any).__workspaceDb;
        await db.from('idea_discovery_concepts').update(chosen.id, { selected: true });
        refreshSaved();
      } catch { /* noop */ }
    };

    const saved = typeof chosen.id === 'number' ? savedPlans.get(chosen.id) : undefined;
    if (saved) {
      setPlan(saved);
      setPlanLoading(false);
      void markSelected();
      return;
    }

    setPlan(null);
    setPlanLoading(true);
    void (async () => {
      await markSelected();
      const built = await generateValidationPlan(ctxAnswers, chosen);
      if (planRequestRef.current !== requestId) return;
      setPlan(built);
      setPlanLoading(false);
      await persistValidationPlan(ctxProfileId, chosen.id ?? null, built);
      refreshSaved();
    })();
  };

  // Reopen a saved discovery (optionally straight into one of its ideas).
  const openRun = (run: SavedRun, ideaIndex?: number) => {
    planRequestRef.current += 1;
    setProfileId(run.id);
    setAnswers(run.answers);
    setSnapshot(null);
    setConcepts(run.concepts);
    setSaveFailed(false);
    setNotice(null);
    setSelectedConceptIndex(null);
    setPlan(null);
    setPlanLoading(false);
    if (typeof ideaIndex === 'number') chooseConcept(ideaIndex, run.concepts, run.answers, run.id);
    else setPhase('results');
  };

  const copyBuildBrief = async () => {
    const text = buildBriefText || buildBriefDraft?.text || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setReferralError('Your browser could not copy the brief. Select the brief text and copy it manually.');
    }
  };

  const beginAudosReferral = () => {
    const chosen = buildBriefDraft?.c;
    const brief = buildBriefText || buildBriefDraft?.text || '';
    if (!chosen || !brief) return;
    setReferralLoading(true);
    setReferralError(null);
    try {
      const db = (window as any).__workspaceDb;
      if (!db) throw new Error('Workspace database unavailable');
      if (referralConfigLoading) {
        setReferralError('Referral settings are still loading. Please try again in a moment.');
        return;
      }
      const partner = BUILD_PARTNERS.audos;
      const rows = Array.isArray(referralConfigRows) ? referralConfigRows : [];
      const config = rows.find((row: any) => row.id === 'default') || rows[0];
      const configuredUrl = String(config?.referral_url || '').trim();

      // Use the owner's referral link from the Audos Referral settings. If none
      // is set (or it is not a valid web address) users are still sent to
      // Audos.com rather than hitting a dead end that only an admin could fix.
      // In that case the referral is not credited to the owner, so the settings
      // screen warns them (see AudosConfig).
      const parseWebUrl = (value: string): URL | null => {
        try {
          const parsed = new URL(value);
          return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
        } catch {
          return null;
        }
      };
      let url = configuredUrl ? parseWebUrl(configuredUrl) : null;
      if (!url) {
        if (configuredUrl) console.warn('[IdeaDiscovery] configured referral URL is invalid; sending users to Audos.com without it.');
        url = new URL(DEFAULT_AUDOS_URL);
      }

      const refId = String(config?.referral_id || '').trim();
      const source = String(config?.referral_source_in_app || 'foundaros_idea_discovery').trim();
      if (refId) url.searchParams.set('ref', refId);
      url.searchParams.set('source', source);
      const attrs = readReferralAttributes();
      if (attrs.utm_campaign) url.searchParams.set('utm_campaign', attrs.utm_campaign);

      const now = new Date().toISOString();
      const eventId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `audos_ref_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const userId = sessionId || visitorId || null;
      const event = {
        id: eventId,
        user_id: userId,
        idea_id: chosen.id !== undefined ? String(chosen.id) : chosen.name,
        idea_name: chosen.name,
        source,
        status: 'BUILD_CTA_CLICKED',
        referral_owner: String(config?.referral_owner || 'Nkechi'),
        referral_url_used: url.toString(),
        campaign_source: attrs.utm_source || attrs.source || null,
        campaign_medium: attrs.utm_medium || null,
        campaign_name: attrs.utm_campaign || null,
        original_ref_param: attrs.ref || null,
        build_brief_text: brief,
        click_timestamp: now,
        created_at: now,
      };

      void db.from(partner.referralTable).insert(event).catch((error: unknown) => {
        console.warn('[IdeaDiscovery] could not persist Audos referral event.', error);
      });
      try {
        db.analytics?.track?.('audos_build_cta_clicked', {
          referral_id: eventId,
          idea_name: chosen.name,
          source,
        });
      } catch { /* direct referral record remains the source of truth */ }

      setReferralUrl(url.toString());
      setPhase('build-transition');
    } catch (error) {
      console.warn('[IdeaDiscovery] could not start Audos referral.', error);
      setReferralError('Referral settings could not be loaded. Please try again.');
    } finally {
      setReferralLoading(false);
    }
  };

  // Clear the on-screen run. Saved work stays in the database and in "My ideas".
  const resetRun = () => {
    planRequestRef.current += 1;
    setAnswers({});
    setStepIndex(0);
    setProfileId(null);
    setSnapshot(null);
    setConcepts([]);
    setSelectedConceptIndex(null);
    setPlan(null);
    setPlanLoading(false);
    setNotice(null);
    setSaveFailed(false);
    setBuildBriefText('');
    setReferralUrl('');
    setReferralError(null);
    setCopied(false);
  };

  // Back to the home screen ("My ideas" if the user has saved work).
  const restart = () => {
    resetRun();
    refreshSaved();
    setPhase('welcome');
  };

  const startNew = () => {
    resetRun();
    setPhase('questions');
  };

  const handoffToGapRadar = () => {
    const chosen = selectedConceptIndex !== null ? concepts[selectedConceptIndex] : null;
    if (chosen) {
      try {
        window.localStorage.setItem(
          'foundaros:idea-handoff',
          JSON.stringify({ concept: chosen.name, problem: chosen.problem, targetCustomer: chosen.targetCustomer, solution: chosen.solution, businessModel: chosen.businessModel, createdAt: new Date().toISOString() }),
        );
      } catch { /* noop */ }
    }
    openGapRadar();
  };

  // =========================================================================
  // RENDER
  // =========================================================================
  if (phase === 'loading') {
    return (
      <div className="h-full overflow-y-auto">
        <StepLoader label={loadingLabel} />
      </div>
    );
  }

  if (phase === 'welcome' && savedLoading && savedRuns.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <StepLoader label="Loading your ideas…" hint="Fetching what you’ve saved so far." />
      </div>
    );
  }

  // Returning users: "My ideas" — everything they have saved, ready to reopen.
  if (phase === 'welcome' && savedRuns.length > 0) {
    const totalIdeas = savedRuns.reduce((n, r) => n + r.concepts.length, 0);
    // Most recently chosen idea, to offer "pick up where you left off".
    let resume: { run: SavedRun; index: number } | null = null;
    savedRuns.forEach((run) => {
      run.concepts.forEach((c, index) => {
        if (c.selected && (!resume || (c.id ?? 0) > (resume.run.concepts[resume.index].id ?? 0))) resume = { run, index };
      });
    });
    const resumeIdea = resume ? (resume as { run: SavedRun; index: number }) : null;
    const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as const;

    return (
      <Shell innerRef={scrollRef}>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <div>
            <span className={`text-xs font-medium ${tw.typography.color.accent}`}>FoundarOS · Idea Discovery</span>
            <h1 className={`mt-1 text-2xl sm:text-3xl font-bold tracking-tight ${tw.typography.color.primary}`}>My ideas</h1>
            <p className={`mt-2 text-sm ${tw.typography.color.secondary}`}>
              {totalIdeas} saved {totalIdeas === 1 ? 'idea' : 'ideas'} from {savedRuns.length} {savedRuns.length === 1 ? 'discovery' : 'discoveries'}. Pick one up where you left off.
            </p>
          </div>
          <PrimaryButton onClick={startNew}>
            <Plus className="w-4 h-4" /> Find new ideas
          </PrimaryButton>
        </div>

        {savedLoadFailed && (
          <div className="mb-4 flex items-start gap-2.5 p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--space-semantic-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--space-semantic-warning) 40%, transparent)' }}>
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--space-semantic-warning)' }} />
            <p className={`text-xs leading-5 ${tw.typography.color.secondary}`}>We couldn’t refresh your saved ideas just now, so this list may be out of date. Reopen Idea Discovery to try again.</p>
          </div>
        )}

        {resumeIdea && (
          <div
            className="mb-5 p-5 rounded-2xl"
            style={{ background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)' }}
          >
            <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>Pick up where you left off</p>
            <h2 className={`mt-1 text-lg font-bold ${tw.typography.color.primary}`}>{resumeIdea.run.concepts[resumeIdea.index].name}</h2>
            <p className={`mt-1 text-sm ${tw.typography.color.secondary}`} style={clamp2}>{resumeIdea.run.concepts[resumeIdea.index].pitch}</p>
            <div className="mt-3">
              <PrimaryButton onClick={() => openRun(resumeIdea.run, resumeIdea.index)}>
                Continue with this idea <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {savedRuns.map((run) => {
            const context = asText(run.answers.experience_current);
            return (
              <div key={run.id} className={`${tw.card.glass} p-5`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className={`text-sm font-semibold ${tw.typography.color.primary}`}>Discovery{formatDate(run.createdAt) ? ` · ${formatDate(run.createdAt)}` : ''}</h3>
                  <span className={`text-xs ${tw.typography.color.muted}`}>{run.concepts.length} {run.concepts.length === 1 ? 'idea' : 'ideas'}</span>
                </div>
                {context && <p className={`mt-1 text-xs ${tw.typography.color.muted}`} style={{ ...clamp2, WebkitLineClamp: 1 }}>{context}</p>}
                <ul className="mt-3 divide-y divide-[var(--space-border-default)]">
                  {run.concepts.map((c, i) => (
                    <li key={c.id ?? i} className="py-3 first:pt-0 last:pb-0">
                      <button
                        onClick={() => openRun(run, i)}
                        className="w-full text-left flex items-start justify-between gap-3 group"
                        aria-label={`Open ${c.name}`}
                      >
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className={`text-sm font-semibold ${tw.typography.color.primary}`}>{c.name}</span>
                            {c.selected && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)]">
                                <Star className="w-3 h-3" /> Chosen
                              </span>
                            )}
                            {typeof c.id === 'number' && savedPlans.has(c.id) && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]">
                                <ClipboardList className="w-3 h-3" /> Plan ready
                              </span>
                            )}
                          </span>
                          <span className={`mt-1 block text-xs ${tw.typography.color.secondary}`} style={clamp2}>{c.pitch}</span>
                        </span>
                        <ArrowRight className={`w-4 h-4 mt-1 flex-shrink-0 transition-transform group-hover:translate-x-1 ${tw.icon.muted}`} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 text-right">
                  <button onClick={() => openRun(run)} className={`text-xs font-medium ${tw.typography.color.accent} hover:underline`}>
                    Compare all {run.concepts.length} ideas
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Shell>
    );
  }

  if (phase === 'welcome') {
    return (
      <Shell innerRef={scrollRef}>
        <div className="flex flex-col items-center text-center pt-6 sm:pt-12">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6 bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)]">
            <Compass className="w-3.5 h-3.5" /> FoundarOS · Idea Discovery
          </span>
          <h1 className={`text-3xl sm:text-4xl font-bold tracking-tight ${tw.typography.color.primary} max-w-2xl`}>
            You don’t need a business idea to start.
          </h1>
          <p className={`mt-5 text-base sm:text-lg leading-7 ${tw.typography.color.secondary} max-w-xl`}>
            Tell us what you know, what bugs you and who you can reach. We’ll suggest {IDEA_COUNT} ideas that fit you — and a 14-day plan to test the one you like.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <PrimaryButton onClick={() => setPhase('questions')}>
              <Sparkles className="w-4 h-4" /> Find my ideas
            </PrimaryButton>
            <span className={`text-xs ${tw.typography.color.muted}`}>About 3 minutes · 3 short steps</span>
          </div>
          <ol className="mt-12 grid sm:grid-cols-3 gap-3 w-full max-w-2xl text-left">
            {[
              { n: 1, t: 'Answer a few questions', d: 'Mostly taps. Four short written answers.' },
              { n: 2, t: `Get ${IDEA_COUNT} ideas`, d: 'Based only on what you tell us.' },
              { n: 3, t: 'Pick one to test', d: 'With a 14-day plan, then build or validate.' },
            ].map((f) => (
              <li key={f.n} className={`${tw.card.flat} p-4 flex gap-3`}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)]">{f.n}</span>
                <div>
                  <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>{f.t}</p>
                  <p className={`text-xs mt-1 ${tw.typography.color.muted}`}>{f.d}</p>
                </div>
              </li>
            ))}
          </ol>
          {savedLoadFailed && (
            <p className={`mt-8 text-xs ${tw.typography.color.muted} max-w-sm`}>
              We couldn’t load any ideas you’ve saved before. If you expected to see some, reopen Idea Discovery to try again.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  if (phase === 'questions') {
    return (
      <Shell innerRef={scrollRef}>
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-medium ${tw.typography.color.accent}`}>Step {stepIndex + 1} of {totalSteps}</span>
            <span className={`text-xs ${tw.typography.color.muted}`}>{step.title}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-[var(--space-surface-muted)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%`, background: 'var(--space-brand-primary)' }}
            />
          </div>
        </div>

        <div className={`${tw.card.glass} p-5 sm:p-7`}>
          <h2 className={`text-xl font-bold ${tw.typography.color.primary}`}>{step.title}</h2>
          {step.intro && <p className={`mt-1.5 text-sm ${tw.typography.color.secondary}`}>{step.intro}</p>}
          <div className="mt-6 space-y-7">
            {step.questions.map((q) => (
              <QuestionField
                key={q.id}
                q={q}
                value={answers[q.id]}
                onChange={(val) => setAnswer(q.id, val)}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => (stepIndex === 0 ? setPhase(concepts.length ? 'results' : 'welcome') : setStepIndex((i) => i - 1))}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm ${tw.button.ghost}`}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          {stepIndex < totalSteps - 1 ? (
            <PrimaryButton onClick={() => setStepIndex((i) => i + 1)} disabled={!stepComplete}>
              Continue <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={finishQuestionnaire} disabled={!stepComplete}>
              <Sparkles className="w-4 h-4" /> Show me my ideas
            </PrimaryButton>
          )}
        </div>
        {!stepComplete && (
          <p className={`mt-3 text-right text-xs ${tw.typography.color.muted}`}>Fill in the questions without “(optional)” to continue.</p>
        )}
      </Shell>
    );
  }

  if (phase === 'results' && concepts.length > 0) {
    return (
      <Shell innerRef={scrollRef}>
        <Header
          eyebrow="Your ideas"
          title={`${concepts.length} ideas worth exploring`}
          subtitle={snapshot?.summary || 'Built from your answers. Pick the one you want to test first.'}
        />
        {snapshot && snapshot.strengths.length > 0 && (
          <div className="-mt-2 mb-5 flex flex-wrap gap-2">
            {snapshot.strengths.map((s, i) => (
              <span key={i} className="px-2.5 py-1 rounded-full text-xs bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] border border-[var(--space-border-default)]">{s}</span>
            ))}
          </div>
        )}
        {notice && (
          <div
            className="mb-4 flex items-start gap-2.5 p-3 rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--space-semantic-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--space-semantic-warning) 40%, transparent)' }}
          >
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--space-semantic-warning)' }} />
            <p className={`text-xs leading-5 ${tw.typography.color.secondary}`}>{notice}</p>
          </div>
        )}
        {saveFailed && <SaveFailedNotice />}

        <div className="space-y-4">
          {concepts.map((c, i) => (
            <div key={i} className={`${tw.card.glass} p-5 sm:p-6`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className={`text-lg font-bold ${tw.typography.color.primary}`}>{c.name}</h3>
                <StartBadge label={c.startability} />
              </div>
              <p className={`mt-2 text-sm leading-6 ${tw.typography.color.secondary}`}>{c.pitch}</p>
              {c.founderFit && (
                <p className={`mt-3 text-sm leading-6 ${tw.typography.color.secondary}`}>
                  <span className={`font-semibold ${tw.typography.color.primary}`}>Why it fits you: </span>{c.founderFit}
                </p>
              )}
              <details className="mt-4">
                <summary className={`cursor-pointer select-none text-xs font-medium ${tw.typography.color.accent}`}>See the full idea</summary>
                <div className="mt-4 grid sm:grid-cols-2 gap-4">
                  <ConceptRow label="The problem" value={c.problem} />
                  <ConceptRow label="Who would pay" value={c.targetCustomer} />
                  <ConceptRow label="What you’d offer" value={c.solution} />
                  <ConceptRow label="How it earns" value={c.businessModel} />
                </div>
                {c.assumptions.length > 0 && (
                  <div className="mt-4">
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${tw.typography.color.accent}`}>To prove first</p>
                    <ul className="space-y-1">
                      {c.assumptions.map((a, ai) => (
                        <li key={ai} className={`text-sm flex gap-1.5 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.validationExperiment && (
                  <div className="mt-4 p-3 rounded-lg bg-[var(--space-surface-muted)]">
                    <p className={`text-xs font-semibold ${tw.typography.color.primary}`}>Smallest first test</p>
                    <p className={`text-xs mt-1 ${tw.typography.color.secondary}`}>{c.validationExperiment}</p>
                  </div>
                )}
              </details>
              <div className="mt-5 flex justify-end">
                <PrimaryButton onClick={() => chooseConcept(i)}>
                  Explore this idea <ArrowRight className="w-4 h-4" />
                </PrimaryButton>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            onClick={() => { setStepIndex(0); setPhase('questions'); }}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm ${tw.button.ghost}`}
          >
            <ArrowLeft className="w-4 h-4" /> Edit my answers
          </button>
          <button
            onClick={showDifferentIdeas}
            className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm ${tw.button.secondary}`}
          >
            <RefreshCw className="w-4 h-4" /> Show me different ideas
          </button>
        </div>
        {savedRuns.length > 0 && (
          <div className="mt-4 text-center">
            <button onClick={restart} className={`text-xs font-medium ${tw.typography.color.accent} hover:underline`}>
              See all my saved ideas
            </button>
          </div>
        )}
        <p className={`mt-6 text-center text-xs ${tw.typography.color.muted}`}>These are concepts worth exploring, not validated businesses.</p>
      </Shell>
    );
  }

  if (phase === 'plan' && selectedConceptIndex !== null && concepts[selectedConceptIndex]) {
    const c = concepts[selectedConceptIndex];
    const days = plan
      ? [
          { range: 'Days 1–3', title: 'Find 10 potential customers', body: plan.days_1_3 },
          { range: 'Days 4–7', title: 'Talk to them', body: plan.days_4_7 },
          { range: 'Days 8–10', title: 'Show your idea', body: plan.days_8_10 },
          { range: 'Days 11–12', title: 'Ask for a small payment', body: plan.days_11_12 },
          { range: 'Days 13–14', title: 'Review and decide', body: plan.days_13_14 },
        ]
      : [];
    return (
      <Shell innerRef={scrollRef}>
        <div className="flex items-center justify-between gap-3 mb-4 print:hidden">
          <button onClick={() => setPhase('results')} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm ${tw.button.ghost}`}>
            <ArrowLeft className="w-4 h-4" /> Back to ideas
          </button>
          <button onClick={() => window.print()} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs ${tw.button.secondary}`}>
            <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
          </button>
        </div>

        <Header eyebrow="Your idea" title={c.name} subtitle={c.pitch} />
        {saveFailed && <SaveFailedNotice />}

        <div className={`${tw.card.glass} p-5 sm:p-6`}>
          <div className="grid sm:grid-cols-3 gap-4">
            <ConceptRow label="The problem" value={c.problem} />
            <ConceptRow label="Who would pay" value={c.targetCustomer} />
            <ConceptRow label="How it earns" value={c.businessModel} />
          </div>
          {c.assumptions.length > 0 && (
            <div className="mt-4">
              <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${tw.typography.color.accent}`}>To prove first</p>
              <ul className="space-y-1">
                {c.assumptions.map((a, ai) => (
                  <li key={ai} className={`text-sm flex gap-1.5 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <h2 className={`mt-8 mb-3 text-lg font-bold ${tw.typography.color.primary}`}>Your 14-day test plan</h2>
        {planLoading || !plan ? (
          <div className={`${tw.card.glass} p-5 flex items-center gap-3`}>
            <Loader2 className={`w-5 h-5 animate-spin ${tw.icon.primary}`} />
            <p className={`text-sm ${tw.typography.color.secondary}`}>Building your plan…</p>
          </div>
        ) : (
          <>
            <ol className="space-y-3">
              {days.map((d, i) => (
                <li key={i} className={`${tw.card.glass} p-4`}>
                  <p className={`text-xs font-semibold ${tw.typography.color.accent}`}>{d.range}</p>
                  <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>{d.title}</p>
                  <p className={`text-sm mt-1 ${tw.typography.color.secondary}`}>{d.body}</p>
                </li>
              ))}
            </ol>
            <details className={`${tw.card.glass} p-5 mt-3`}>
              <summary className={`cursor-pointer select-none flex items-center gap-2 text-sm font-semibold ${tw.typography.color.primary}`}>
                <MessageCircle className={`w-4 h-4 ${tw.icon.primary}`} /> Customer interview questions
              </summary>
              <ul className="mt-3 space-y-2">
                {plan.interviewQuestions.map((q, i) => (
                  <li key={i} className={`text-sm flex gap-2 ${tw.typography.color.secondary}`}>
                    <span className={`font-semibold ${tw.typography.color.accent}`}>{i + 1}.</span>{q}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}

        <div
          className="mt-8 p-6 rounded-2xl print:hidden"
          style={{ background: 'color-mix(in srgb, var(--space-brand-primary-500) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)' }}
        >
          <h3 className={`text-lg font-bold ${tw.typography.color.primary}`}>What would you like to do next?</h3>
          <div className="mt-4 grid sm:grid-cols-2 gap-4">
            <div className={`${tw.card.flat} p-4 flex flex-col`}>
              <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>Build it</p>
              <p className={`text-xs mt-1 mb-4 flex-1 ${tw.typography.color.muted}`}>Turn this idea into a first version with AI on Audos. Your idea is packaged into a brief for you.</p>
              <PrimaryButton onClick={() => setPhase('build-brief')}>
                Build this on Audos <ArrowRight className="w-4 h-4" />
              </PrimaryButton>
            </div>
            <div className={`${tw.card.flat} p-4 flex flex-col`}>
              <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>Test it first</p>
              <p className={`text-xs mt-1 mb-4 flex-1 ${tw.typography.color.muted}`}>See what evidence you already have and what to prove next, using Gap Radar.</p>
              <button onClick={handoffToGapRadar} className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm ${tw.button.secondary}`}>
                <Target className="w-4 h-4" /> Test with Gap Radar <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-5 print:hidden">
          <button onClick={restart} className={`text-xs font-medium ${tw.typography.color.accent} hover:underline`}>My ideas</button>
          <button onClick={startNew} className={`text-xs ${tw.typography.color.muted} hover:underline`}>Start a new discovery</button>
        </div>
      </Shell>
    );
  }

  if (phase === 'build-brief' && selectedConceptIndex !== null && buildBriefDraft) {
    const brief = buildBriefDraft;
    return (
      <Shell innerRef={scrollRef}>
        <Header eyebrow="Build brief" title="Your Audos Build Brief" subtitle="Compiled from your Idea Discovery — no re-entry needed." />
        <div className={`${tw.card.glass} p-5 sm:p-6`}>
          <div className="grid sm:grid-cols-2 gap-5">
            <ConceptRow label="Idea" value={brief.c.name} />
            <ConceptRow label="Problem" value={brief.c.problem} />
            <ConceptRow label="Target users" value={brief.c.targetCustomer} />
            <ConceptRow label="Solution" value={brief.c.solution} />
            <ConceptRow label="Key value proposition" value={brief.valueProposition} />
            <ConceptRow label="Market / geographic context" value={brief.marketContext} />
          </div>
          <div className="mt-5 grid sm:grid-cols-2 gap-5">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>Core features</p>
              <ul className="mt-2 space-y-1.5">
                {brief.coreFeatures.map((feature, index) => (
                  <li key={index} className={`text-sm flex gap-2 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{feature}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>Suggested MVP</p>
              <ul className="mt-2 space-y-1.5">
                {brief.suggestedMvp.map((item, index) => (
                  <li key={index} className={`text-sm flex gap-2 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-5">
            <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>Important assumptions</p>
            <ul className="mt-2 space-y-1.5">
              {brief.c.assumptions.map((assumption, index) => (
                <li key={index} className={`text-sm flex gap-2 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{assumption}</li>
              ))}
            </ul>
          </div>
          <div className="mt-5"><ConceptRow label="Validation insights" value={brief.validationInsights} /></div>
        </div>

        {referralError && (
          <div className="mt-4 p-3 rounded-xl text-sm text-[var(--space-semantic-warning)]" style={{ background: 'color-mix(in srgb, var(--space-semantic-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--space-semantic-warning) 35%, transparent)' }}>
            {referralError}
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <button onClick={() => setPhase('plan')} className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm ${tw.button.ghost}`}>
            <ArrowLeft className="w-4 h-4" /> Back to your plan
          </button>
          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={copyBuildBrief} className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm ${tw.button.secondary}`}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied!' : 'Copy Build Brief'}
            </button>
            <PrimaryButton onClick={beginAudosReferral} disabled={referralLoading || referralConfigLoading}>
              {(referralLoading || referralConfigLoading) ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Build on Audos <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'build-transition' && referralUrl) {
    return (
      <Shell innerRef={scrollRef}>
        <div className="min-h-[70vh] flex items-center justify-center">
          <div className={`${tw.card.glass} p-6 sm:p-9 max-w-2xl w-full text-center`}>
            <span className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center bg-[var(--space-surface-accent-soft)]">
              <Rocket className={`w-7 h-7 ${tw.icon.primary}`} />
            </span>
            <h1 className={`mt-5 text-2xl sm:text-3xl font-bold ${tw.typography.color.primary}`}>You’re ready for the next step</h1>
            <p className={`mt-3 text-sm sm:text-base leading-7 ${tw.typography.color.secondary}`}>
              Your idea has been prepared for building. You’ll now continue on Audos where you can use AI to build your product from the ground up.
            </p>
            <div className="mt-7 flex flex-col items-center gap-3">
              <PrimaryButton onClick={() => { window.open(referralUrl, '_blank', 'noopener,noreferrer'); setPhase('plan'); }}>
                Open Audos &amp; Start Building <ArrowUpRight className="w-4 h-4" />
              </PrimaryButton>
              <button onClick={copyBuildBrief} className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm ${tw.button.secondary}`}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied!' : 'Copy My Build Brief'}
              </button>
            </div>
            <p className={`mt-6 text-xs ${tw.typography.color.muted}`}>After building your MVP on Audos, return to FoundarOS to assess your fundability.</p>
            <button onClick={() => openApp('founder-journey')} className={`mt-4 text-sm ${tw.typography.color.accent} hover:underline`}>
              ← Return to FoundarOS
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // Fallback (shouldn't happen): reset to welcome.
  return (
    <Shell innerRef={scrollRef}>
      <div className="py-24 text-center">
        <p className={`text-sm ${tw.typography.color.secondary}`}>{notice || 'Let’s begin your discovery.'}</p>
        <div className="mt-4 flex justify-center"><PrimaryButton onClick={restart}>Start Idea Discovery</PrimaryButton></div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
// Shown when the ideas on screen could not be written to the database. Without
// this the user would only find out later, when "My ideas" came up empty.
function SaveFailedNotice() {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 p-3 rounded-lg"
      style={{ background: 'color-mix(in srgb, var(--space-semantic-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--space-semantic-warning) 40%, transparent)' }}
    >
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--space-semantic-warning)' }} />
      <p className={`text-xs leading-5 ${tw.typography.color.secondary}`}>
        <span className={`font-semibold ${tw.typography.color.primary}`}>These ideas aren’t saved yet. </span>
        We couldn’t save them to your account, so they won’t appear in “My ideas” later. Open the idea you like and use “Print / Save as PDF” to keep a copy.
      </p>
    </div>
  );
}

function Header({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <span className={`text-xs font-medium ${tw.typography.color.accent}`}>{eyebrow}</span>
      <h1 className={`mt-1 text-2xl sm:text-3xl font-bold tracking-tight ${tw.typography.color.primary}`}>{title}</h1>
      <p className={`mt-2 text-sm ${tw.typography.color.secondary} max-w-2xl`}>{subtitle}</p>
    </div>
  );
}

function ConceptRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>{label}</p>
      <p className={`text-sm mt-0.5 ${tw.typography.color.secondary}`}>{value || '—'}</p>
    </div>
  );
}

// -- question field renderer -------------------------------------------------
function QuestionField({ q, value, onChange }: { q: Question; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void }) {
  return (
    <div>
      <label className={`block text-sm font-semibold ${tw.typography.color.primary}`}>
        {q.label}{q.optional && <span className={`ml-1.5 text-xs font-normal ${tw.typography.color.muted}`}>(optional)</span>}
      </label>
      {q.helper && <p className={`mt-1 text-xs ${tw.typography.color.muted}`}>{q.helper}</p>}
      <div className="mt-2.5">
        {q.type === 'textarea' && (
          <textarea
            value={asText(value)}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder={q.placeholder || 'Share as much or as little as feels true.'}
            className={`${tw.input.base} ${tw.input.default} resize-y text-sm leading-6`}
          />
        )}
        {q.type === 'tags' && <TagInput value={Array.isArray(value) ? value : []} onChange={onChange} max={q.maxTags || 5} placeholder={q.placeholder} />}
        {q.type === 'multiselect' && (
          <div className="flex flex-wrap gap-2">
            {(q.options || []).map((opt) => {
              const arr = Array.isArray(value) ? value : [];
              const active = arr.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => onChange(active ? arr.filter((x) => x !== opt) : [...arr, opt])}
                  className={`px-3 py-1.5 rounded-full text-xs transition-all border ${active ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] border-transparent' : 'bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] border-[var(--space-border-default)] hover:brightness-110'}`}
                >
                  {active ? <Check className="w-3 h-3 inline mr-1" /> : null}{opt}
                </button>
              );
            })}
          </div>
        )}
        {q.type === 'radio' && (
          <div className="flex flex-wrap gap-2">
            {(q.options || []).map((opt) => {
              const active = value === opt;
              return (
                <button
                  key={opt}
                  onClick={() => onChange(opt)}
                  className={`px-4 py-2 rounded-lg text-sm transition-all border ${active ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] border-transparent' : 'bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] border-[var(--space-border-default)] hover:brightness-110'}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}
        {q.type === 'scale' && (
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => {
              const active = value === n;
              return (
                <button
                  key={n}
                  onClick={() => onChange(n)}
                  className={`w-11 h-11 rounded-xl text-sm font-semibold transition-all border ${active ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] border-transparent' : 'bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] border-[var(--space-border-default)] hover:brightness-110'}`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        )}
        {q.type === 'currency' && <CurrencyInput value={asText(value)} onChange={onChange} />}
      </div>
    </div>
  );
}

function TagInput({ value, onChange, max, placeholder }: { value: string[]; onChange: (v: string[]) => void; max: number; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t || value.length >= max || value.includes(t)) { setDraft(''); return; }
    onChange([...value, t]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)]">
            {t}
            <button onClick={() => onChange(value.filter((x) => x !== t))} className="hover:opacity-70">×</button>
          </span>
        ))}
      </div>
      {value.length < max && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={placeholder || 'Type a skill and press Enter'}
          className={`${tw.input.base} ${tw.input.default} text-sm`}
        />
      )}
      <p className={`mt-1 text-xs ${tw.typography.color.muted}`}>{value.length}/{max}</p>
    </div>
  );
}

function CurrencyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const initialCur = CURRENCIES.find((c) => value.startsWith(c)) || CURRENCIES[0];
  const [cur, setCur] = useState(initialCur);
  const [amount, setAmount] = useState(value.replace(initialCur, '').trim());
  const emit = (c: string, a: string) => onChange(a.trim() ? `${c}${a.trim()}` : '');
  return (
    <div className="flex gap-2">
      <select
        value={cur}
        onChange={(e) => { setCur(e.target.value); emit(e.target.value, amount); }}
        className={`${tw.input.base} ${tw.input.default} text-sm w-24 flex-shrink-0`}
      >
        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input
        value={amount}
        onChange={(e) => { setAmount(e.target.value); emit(cur, e.target.value); }}
        inputMode="numeric"
        placeholder="e.g. 5,000"
        className={`${tw.input.base} ${tw.input.default} text-sm`}
      />
    </div>
  );
}
