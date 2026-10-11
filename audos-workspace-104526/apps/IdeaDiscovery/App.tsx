import { useState, useMemo, useEffect, useRef, type ReactNode, type Ref } from 'react';
import {
  Compass,
  Lightbulb,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Loader2,
  CheckCircle2,
  Check,
  Users,
  Briefcase,
  Brain,
  Target,
  AlertTriangle,
  Rocket,
  Map as MapIcon,
  ClipboardList,
  MessageCircle,
  CalendarDays,
  Printer,
  ArrowUpRight,
  Layers,
  Gauge,
  Wallet,
  Clock,
  Star,
  Info,
  Copy,
} from 'lucide-react';
import { tw } from '../../lib/colors';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';

/* ============================================================================
 * FoundarOS — Idea Discovery
 *
 * The pre-idea path of the FoundarOS founder journey (DISCOVER → VALIDATE →
 * BUILD → ASSESS → FUND → OPERATE). This module is completely SEPARATE from
 * Gap Radar: it never scores fundability, never shows a traction score, and
 * never tells an idea-less founder they are "unfundable". It helps a founder
 * uncover opportunities from who they are, what they know and who they can
 * reach, then hands a chosen concept to Gap Radar for validation.
 *
 * Data model (WorkspaceDB, session-scoped, reads via useWorkspaceDB / writes
 * via window.__workspaceDb):
 *   idea_discovery_profiles          — questionnaire responses
 *   idea_discovery_territories       — generated opportunity territories
 *   idea_discovery_concepts          — generated business concepts
 *   idea_discovery_validation_plans  — 14-day validation plan for the concept
 * ========================================================================== */

// ---------------------------------------------------------------------------
// Tier architecture — configurable, no hardcoded prices. For the MVP every
// user defaults to 'paid' (all features open). The gating knobs exist for
// future monetization, not to lock anything out today.
// ---------------------------------------------------------------------------
const PAID_TIER = {
  founderProfile: true,
  opportunityTerritories: 4,
  conceptPreview: true,
  conceptsUnlocked: 6,
  validationPlan: true,
  opportunityMap: true,
} as const;

const TIER_CONFIG = {
  free: {
    founderProfile: true,
    opportunityTerritories: 3,
    conceptPreview: true,
    conceptsUnlocked: 0,
    validationPlan: false,
    opportunityMap: false,
  },
  paid: PAID_TIER,
  premium: {
    ...PAID_TIER,
    humanSession: true,
  },
} as const;

type TierName = keyof typeof TIER_CONFIG;
// MVP: everyone gets full access. Flip this (or make it session-driven) later.
const ACTIVE_TIER: TierName = 'paid';
const tier = TIER_CONFIG[ACTIVE_TIER];

const FIT_LABELS = ['Worth exploring', 'Strong founder fit', 'Promising starting point', 'Requires validation'] as const;
const STARTABILITY_LABELS = ['Easy to test', 'Moderate to test', 'Requires significant resources'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Phase =
  | 'welcome'
  | 'questions'
  | 'loading'
  | 'profile'
  | 'territories'
  | 'concepts'
  | 'compare'
  | 'summary'
  | 'validation'
  | 'map'
  | 'build-brief'
  | 'build-transition';

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

interface Section {
  title: string;
  intro?: string;
  critical?: boolean;
  criticalNote?: string;
  questions: Question[];
}

interface FounderProfile {
  experienceStrengths: string;
  coreSkills: string[];
  knowledgeAdvantage: string;
  problemSensitivity: string;
  accessAdvantage: string;
  founderGoal: string;
  resourceProfile: { time: string; capital: string; assets: string };
  opportunityPattern: string;
}

interface Territory {
  id?: number;
  name: string;
  description: string;
  whyItFits: string[];
  potentialCustomers: string;
  problemsToExplore: string[];
  fitLabel: string;
  selected?: boolean;
}

interface ConceptComparison {
  founderFit: string;
  problemClarity: string;
  customerClarity: string;
  access: string;
  startability: string;
  businessModel: string;
  validationDifficulty: string;
}

interface Concept {
  id?: number;
  territoryName: string;
  name: string;
  problem: string;
  targetCustomer: string;
  solution: string;
  businessModel: string;
  founderFit: string;
  founderAdvantage: string;
  assumptions: string[];
  validationExperiment: string;
  startability: string;
  comparison: ConceptComparison;
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

const BUILD_PARTNERS: Record<string, BuildPartner> = {
  audos: {
    id: 'audos',
    name: 'Audos',
    configTable: 'audos_referral_config',
    referralTable: 'audos_referrals',
  },
};

// ---------------------------------------------------------------------------
// Questionnaire definition (6 sections, one section at a time)
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

const GOAL_MOTIVATIONS = [
  'Generate additional income', 'Build a side business', 'Eventually replace my salary',
  'Build a scalable startup', 'Solve a problem I care about', 'Create employment',
  'Build something I can eventually sell', 'Gain more independence', 'Other',
];

const SECTIONS: Section[] = [
  {
    title: 'Your Experience',
    intro: 'Start with what you already carry. There are no wrong answers here.',
    questions: [
      { id: 'experience_current', type: 'textarea', label: 'What do you currently do?', helper: 'Tell us about your current job, profession, business or primary activity.' },
      { id: 'experience_other', type: 'textarea', label: 'What other roles, industries or experiences have you had?' },
      { id: 'skills', type: 'tags', label: 'What are your strongest skills?', helper: 'Add up to 5. Press Enter after each one.', maxTags: 5, placeholder: 'e.g. sales, operations, design…' },
      { id: 'skills_help', type: 'textarea', label: 'What do people usually come to you for help with?' },
      { id: 'skills_knowledge', type: 'textarea', label: 'What do you know unusually well?', helper: 'This could be an industry, process, profession, community, technical skill or personal experience.' },
    ],
  },
  {
    title: 'Your Interests',
    intro: 'Energy matters. The right business is one you can sustain.',
    questions: [
      { id: 'interests_topics', type: 'textarea', label: 'What topics could you spend hours learning about without being forced?' },
      { id: 'interests_areas', type: 'multiselect', label: 'Which areas interest you most?', helper: 'Select all that apply.', options: INTEREST_AREAS },
      { id: 'interests_work', type: 'textarea', label: 'What kind of work would you enjoy doing even if you had to start very small?' },
    ],
  },
  {
    title: 'Problem Discovery',
    critical: true,
    criticalNote: 'This is where business ideas really come from. Take your time here — the sharper your answers, the sharper your opportunities.',
    questions: [
      { id: 'problems_frustrations', type: 'textarea', label: 'What regularly frustrates you about the way things are currently done?' },
      { id: 'problems_others', type: 'textarea', label: 'What do people around you frequently complain about?' },
      { id: 'problems_better_way', type: 'textarea', label: "Have you ever thought, 'There should be an easier or better way to do this'? If yes, describe it." },
      { id: 'problems_personal', type: 'textarea', label: 'What problem have you personally experienced that you believe other people experience too?' },
    ],
  },
  {
    title: 'Access Advantage',
    intro: 'Who you can already reach is one of your biggest unfair advantages.',
    questions: [
      { id: 'access_groups', type: 'multiselect', label: 'Which groups of people do you already have easy access to?', helper: 'Select all that apply.', options: ACCESS_GROUPS },
      { id: 'access_network_size', type: 'radio', label: 'Approximately how many people within these groups could you realistically speak to about a potential business idea?', options: ['1–10', '11–25', '26–50', '51–100', '100+'] },
    ],
  },
  {
    title: 'Founder Goals',
    intro: 'What does a win look like for you? This shapes the kind of business that fits.',
    questions: [
      { id: 'goals_motivation', type: 'multiselect', label: 'Why do you want to start a business?', helper: 'Select all that apply.', options: GOAL_MOTIVATIONS },
      { id: 'goals_time_per_week', type: 'radio', label: 'How much time can you realistically dedicate each week?', options: ['Less than 3 hours', '3–5 hours', '5–10 hours', '10–20 hours', '20+ hours'] },
      { id: 'goals_business_type', type: 'radio', label: 'What type of business interests you most?', options: ['Service business', 'Digital product', 'Software/SaaS', 'Marketplace', 'E-commerce', 'Physical product', 'Consultancy', 'Agency', 'Local/offline business', 'Not sure'] },
      { id: 'goals_capital', type: 'currency', label: 'How much are you realistically prepared to invest initially?' },
      { id: 'goals_risk_tolerance', type: 'scale', label: 'How comfortable are you with uncertainty while building something new?', helper: '1 = I prefer certainty · 5 = I thrive in the unknown' },
    ],
  },
  {
    title: 'Starting Point',
    intro: 'A few final prompts to anchor your discovery.',
    questions: [
      { id: 'goals_completion_vision', type: 'textarea', label: 'Complete this sentence:', helper: '“If I could build a business that solved one problem in my world, I would want it to solve…”', placeholder: 'If I could build a business that solved one problem in my world, I would want it to solve…' },
      { id: 'context_additional', type: 'textarea', label: 'Is there anything else about your experience, personality, interests or circumstances that could help us identify the right opportunity for you?', optional: true },
      { id: 'context_success_definition', type: 'textarea', label: 'What would make this Idea Discovery experience successful for you?' },
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

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
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

function sanitizeFit(label: string | undefined): string {
  const match = FIT_LABELS.find((l) => l.toLowerCase() === String(label || '').toLowerCase());
  return match || 'Worth exploring';
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
  SECTIONS.forEach((section) => {
    section.questions.forEach((q) => {
      const val = asText(answers[q.id]);
      if (val.trim()) lines.push(`- ${q.label} => ${val}`);
    });
  });
  return lines.join('\n');
}

async function generateProfile(answers: AnswerMap): Promise<FounderProfile> {
  const system = [
    'You are FoundarOS Idea Discovery, generating a FOUNDER OPPORTUNITY PROFILE from a founder\u2019s discovery answers.',
    'Do NOT generate business ideas at this stage — only interpret who this founder is.',
    GUARDRAIL_LANGUAGE,
    'Return ONLY valid JSON of this exact shape:',
    '{"experienceStrengths":"2-4 sentences","coreSkills":["skill"],"knowledgeAdvantage":"2-3 sentences","problemSensitivity":"2-3 sentences","accessAdvantage":"2-3 sentences","founderGoal":"one of: side income | full-time | scalable startup | service | digital","resourceProfile":{"time":"string","capital":"string","assets":"string"},"opportunityPattern":"2-3 sentence human-readable interpretation"}',
  ].join('\n');
  const user = `Founder discovery answers:\n${answersDigest(answers)}`;
  try {
    const raw = await callDiscoveryAI(system, user, 2200);
    return {
      experienceStrengths: String(raw.experienceStrengths || '').trim() || fallbackProfile(answers).experienceStrengths,
      coreSkills: Array.isArray(raw.coreSkills) && raw.coreSkills.length ? raw.coreSkills.map(String) : fallbackProfile(answers).coreSkills,
      knowledgeAdvantage: String(raw.knowledgeAdvantage || '').trim() || fallbackProfile(answers).knowledgeAdvantage,
      problemSensitivity: String(raw.problemSensitivity || '').trim() || fallbackProfile(answers).problemSensitivity,
      accessAdvantage: String(raw.accessAdvantage || '').trim() || fallbackProfile(answers).accessAdvantage,
      founderGoal: String(raw.founderGoal || '').trim() || fallbackProfile(answers).founderGoal,
      resourceProfile: {
        time: String(raw?.resourceProfile?.time || '').trim() || asText(answers.goals_time_per_week) || 'Not specified',
        capital: String(raw?.resourceProfile?.capital || '').trim() || asText(answers.goals_capital) || 'Not specified',
        assets: String(raw?.resourceProfile?.assets || '').trim() || fallbackProfile(answers).resourceProfile.assets,
      },
      opportunityPattern: String(raw.opportunityPattern || '').trim() || fallbackProfile(answers).opportunityPattern,
    };
  } catch (error) {
    console.warn('[IdeaDiscovery] profile AI unavailable, using rubric.', error);
    return fallbackProfile(answers);
  }
}

function fallbackProfile(answers: AnswerMap): FounderProfile {
  const skills = Array.isArray(answers.skills) ? (answers.skills as string[]) : [];
  return {
    experienceStrengths: asText(answers.experience_current) || 'Your experience is the foundation we will build from as you complete more of your discovery.',
    coreSkills: skills.length ? skills : ['Add your strongest skills to sharpen this'],
    knowledgeAdvantage: asText(answers.skills_knowledge) || 'The areas you know unusually well point to where you can move faster than most.',
    problemSensitivity: asText(answers.problems_frustrations) || asText(answers.problems_personal) || 'The frustrations you notice are early signals of problems worth exploring.',
    accessAdvantage: asText(answers.access_groups) || 'The communities you can already reach are a real advantage for early conversations.',
    founderGoal: asText(answers.goals_business_type) ? 'service' : 'side income',
    resourceProfile: {
      time: asText(answers.goals_time_per_week) || 'Not specified',
      capital: asText(answers.goals_capital) || 'Not specified',
      assets: asText(answers.skills_help) || 'Your reputation and the people who trust your judgement.',
    },
    opportunityPattern: 'Your responses point to a promising starting point. As you explore territories below, look for problems that sit where your experience, your access and your energy overlap — those are worth exploring first.',
  };
}

async function generateTerritories(answers: AnswerMap, profile: FounderProfile, count: number): Promise<Territory[]> {
  const system = [
    'You are FoundarOS Idea Discovery, generating OPPORTUNITY TERRITORIES.',
    'These are NOT business ideas — they are broad areas worth exploring, connected to the founder\u2019s specific answers.',
    'Do NOT rank them and do NOT crown one as best.',
    GUARDRAIL_LANGUAGE,
    `Generate exactly ${count} territories. Return ONLY valid JSON of this shape:`,
    '{"territories":[{"name":"e.g. SME Operations","description":"1 sentence","whyItFits":["bullet tied to a specific answer"],"potentialCustomers":"who","problemsToExplore":["3-4 problems"],"fitLabel":"one of: Worth exploring | Strong founder fit | Promising starting point | Requires validation"}]}',
  ].join('\n');
  const user = `Founder answers:\n${answersDigest(answers)}\n\nFounder opportunity pattern: ${profile.opportunityPattern}`;
  try {
    const raw = await callDiscoveryAI(system, user, 2600);
    const list = Array.isArray(raw.territories) ? raw.territories : [];
    const mapped = list.slice(0, count).map((t: any) => ({
      name: String(t.name || 'Opportunity area').trim(),
      description: String(t.description || '').trim(),
      whyItFits: Array.isArray(t.whyItFits) ? t.whyItFits.map(String).filter(Boolean) : [],
      potentialCustomers: String(t.potentialCustomers || '').trim(),
      problemsToExplore: Array.isArray(t.problemsToExplore) ? t.problemsToExplore.map(String).filter(Boolean) : [],
      fitLabel: sanitizeFit(t.fitLabel),
      selected: false,
    }));
    if (mapped.length) return mapped;
    throw new Error('No territories returned');
  } catch (error) {
    console.warn('[IdeaDiscovery] territories AI unavailable, using rubric.', error);
    return fallbackTerritories(answers).slice(0, count);
  }
}

function fallbackTerritories(answers: AnswerMap): Territory[] {
  const areas = Array.isArray(answers.interests_areas) ? (answers.interests_areas as string[]) : [];
  const groups = Array.isArray(answers.access_groups) ? (answers.access_groups as string[]) : [];
  const base: Territory[] = [
    {
      name: areas[0] ? `${areas[0]} Solutions` : 'Operational Problem-Solving',
      description: 'An area where your interests and everyday frustrations overlap.',
      whyItFits: [asText(answers.problems_frustrations) || 'You noticed friction here', asText(answers.skills_knowledge) || 'You know this space'].filter(Boolean),
      potentialCustomers: groups[0] || 'People in your immediate network',
      problemsToExplore: ['A recurring frustration you described', 'A task people around you complain about', 'A process that feels harder than it should'],
      fitLabel: 'Worth exploring',
      selected: false,
    },
    {
      name: groups[0] ? `Services for ${groups[0]}` : 'Knowledge Services',
      description: 'Turning what you know unusually well into help others will pay for.',
      whyItFits: [asText(answers.skills_help) || 'People already come to you for help', asText(answers.access_network_size) ? `You can reach ${asText(answers.access_network_size)} people` : ''].filter(Boolean),
      potentialCustomers: groups[1] || groups[0] || 'A community you can already reach',
      problemsToExplore: ['A problem this group repeatedly faces', 'Something they currently pay too much for', 'A gap between what they need and what exists'],
      fitLabel: 'Strong founder fit',
      selected: false,
    },
    {
      name: areas[1] ? `${areas[1]} Opportunities` : 'Adjacent Opportunities',
      description: 'A promising starting point just outside your current lane.',
      whyItFits: [asText(answers.interests_topics) || 'You are drawn to this topic'].filter(Boolean),
      potentialCustomers: groups[2] || 'Early adopters in your interest area',
      problemsToExplore: ['An unmet need you keep noticing', 'A workaround people rely on today', 'A trend creating new problems'],
      fitLabel: 'Promising starting point',
      selected: false,
    },
  ];
  return base;
}

async function generateConcepts(answers: AnswerMap, profile: FounderProfile, territories: Territory[], maxConcepts: number): Promise<Concept[]> {
  const perTerritory = territories.length === 1 ? 3 : Math.max(1, Math.floor(maxConcepts / territories.length));
  const system = [
    'You are FoundarOS Idea Discovery, generating personalized BUSINESS CONCEPTS for the selected opportunity territories.',
    `Generate ${perTerritory} concepts per territory. Never exceed ${maxConcepts} concepts total.`,
    'These are concepts worth exploring, NOT validated businesses. Do NOT rank them or pick a winner.',
    GUARDRAIL_LANGUAGE,
    'For "comparison", use short 1-3 word qualitative labels (e.g. Strong, Clear, Moderate, Emerging, Easy, Requires work).',
    'Return ONLY valid JSON of this shape:',
    '{"concepts":[{"territoryName":"matches a selected territory","name":"concept name","problem":"what it solves","targetCustomer":"who would pay","solution":"what the business provides","businessModel":"how it makes money","founderFit":"tied to their answers","founderAdvantage":"experience/skill/relationship/access","assumptions":["2-4 key assumptions"],"validationExperiment":"smallest practical experiment","startability":"one of: Easy to test | Moderate to test | Requires significant resources","comparison":{"founderFit":"label","problemClarity":"label","customerClarity":"label","access":"label","startability":"label","businessModel":"label","validationDifficulty":"label"}}]}',
  ].join('\n');
  const territoryText = territories.map((t) => `Territory: ${t.name} — ${t.description} (customers: ${t.potentialCustomers})`).join('\n');
  const user = `Founder answers:\n${answersDigest(answers)}\n\nSelected territories:\n${territoryText}`;
  try {
    const raw = await callDiscoveryAI(system, user, 4000);
    const list = Array.isArray(raw.concepts) ? raw.concepts : [];
    const mapped = list.slice(0, maxConcepts).map((c: any) => normalizeConcept(c, territories));
    if (mapped.length) return mapped;
    throw new Error('No concepts returned');
  } catch (error) {
    console.warn('[IdeaDiscovery] concepts AI unavailable, using rubric.', error);
    return fallbackConcepts(territories, perTerritory).slice(0, maxConcepts);
  }
}

function normalizeConcept(c: any, territories: Territory[]): Concept {
  const territoryName = String(c.territoryName || territories[0]?.name || '').trim();
  const cmp = c.comparison || {};
  return {
    territoryName,
    name: String(c.name || 'Business concept').trim(),
    problem: String(c.problem || '').trim(),
    targetCustomer: String(c.targetCustomer || '').trim(),
    solution: String(c.solution || '').trim(),
    businessModel: String(c.businessModel || '').trim(),
    founderFit: String(c.founderFit || '').trim(),
    founderAdvantage: String(c.founderAdvantage || '').trim(),
    assumptions: Array.isArray(c.assumptions) ? c.assumptions.map(String).filter(Boolean) : [],
    validationExperiment: String(c.validationExperiment || '').trim(),
    startability: sanitizeStartability(c.startability),
    comparison: {
      founderFit: String(cmp.founderFit || 'Moderate'),
      problemClarity: String(cmp.problemClarity || 'Emerging'),
      customerClarity: String(cmp.customerClarity || 'Emerging'),
      access: String(cmp.access || 'Moderate'),
      startability: String(cmp.startability || 'Moderate'),
      businessModel: String(cmp.businessModel || 'Emerging'),
      validationDifficulty: String(cmp.validationDifficulty || 'Moderate'),
    },
  };
}

function fallbackConcepts(territories: Territory[], perTerritory: number): Concept[] {
  const out: Concept[] = [];
  territories.forEach((t) => {
    for (let i = 0; i < perTerritory; i += 1) {
      out.push({
        territoryName: t.name,
        name: `${t.name} concept ${i + 1}`,
        problem: t.problemsToExplore[i] || t.problemsToExplore[0] || 'A problem worth exploring in this territory.',
        targetCustomer: t.potentialCustomers || 'A specific group you can reach',
        solution: 'A focused first offering that addresses the problem directly.',
        businessModel: 'Start with a simple paid service or product, then expand.',
        founderFit: t.whyItFits[0] || 'Connected to your experience and access.',
        founderAdvantage: 'The relationships and knowledge you already have in this space.',
        assumptions: ['Customers feel this problem strongly enough to pay', 'You can reach enough of them affordably'],
        validationExperiment: 'Talk to 10 potential customers and offer a small paid pilot.',
        startability: 'Moderate to test',
        comparison: { founderFit: 'Strong', problemClarity: 'Emerging', customerClarity: 'Clear', access: 'Strong', startability: 'Moderate', businessModel: 'Emerging', validationDifficulty: 'Moderate' },
      });
    }
  });
  return out;
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
function FitBadge({ label }: { label: string }) {
  const tone =
    label === 'Strong founder fit'
      ? 'var(--space-semantic-success)'
      : label === 'Requires validation'
        ? 'var(--space-semantic-warning)'
        : 'var(--space-brand-primary-500)';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        color: tone,
        background: `color-mix(in srgb, ${tone} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 40%, transparent)`,
      }}
    >
      <Star className="w-3 h-3" /> {label}
    </span>
  );
}

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

function SectionCard({ icon: Icon, title, children }: { icon: any; title: string; children: ReactNode }) {
  return (
    <div className={`${tw.card.glass} p-5`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-[var(--space-surface-accent-soft)]">
          <Icon className={`w-4 h-4 ${tw.icon.primary}`} />
        </span>
        <h3 className={`text-sm font-semibold ${tw.typography.color.primary}`}>{title}</h3>
      </div>
      <div className={`text-sm leading-6 ${tw.typography.color.secondary}`}>{children}</div>
    </div>
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

function StepLoader({ label }: { label: string }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-4 py-24 text-center px-6">
      <div className="relative">
        <span className="absolute inset-0 rounded-full blur-xl" style={{ background: 'color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)' }} />
        <Loader2 className={`relative w-10 h-10 animate-spin ${tw.icon.primary}`} />
      </div>
      <p className={`text-base font-semibold ${tw.typography.color.primary}`}>{label}</p>
      <p className={`text-sm ${tw.typography.color.muted} max-w-sm`}>Grounding everything in your own answers. This takes a few moments.</p>
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
  // Reads (session-scoped) — used to offer a resume into a saved run.
  const { data: profileRows } = (window as any).useWorkspaceDB('idea_discovery_profiles', {
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 1,
  }) as { data: any[] };
  const { data: referralConfigRows, loading: referralConfigLoading } = (window as any).useWorkspaceDB('audos_referral_config', {
    shared: true,
    limit: 10,
  }) as { data: any[]; loading: boolean };

  const [phase, setPhase] = useState<Phase>('welcome');
  const [loadingLabel, setLoadingLabel] = useState('Analysing your profile…');
  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [profileId, setProfileId] = useState<number | null>(null);
  const [profile, setProfile] = useState<FounderProfile | null>(null);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selectedConceptIndex, setSelectedConceptIndex] = useState<number | null>(null);
  const [plan, setPlan] = useState<ValidationPlan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [buildBriefText, setBuildBriefText] = useState('');
  const [referralUrl, setReferralUrl] = useState('');
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const hasSavedRun = Array.isArray(profileRows) && profileRows.length > 0 && profileRows[0]?.status === 'completed';

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
  }, [phase, sectionIndex]);

  const section = SECTIONS[sectionIndex];
  const totalSections = SECTIONS.length;

  const setAnswer = (id: string, value: AnswerValue) => setAnswers((prev) => ({ ...prev, [id]: value }));

  const isQuestionAnswered = (q: Question): boolean => {
    if (q.optional) return true;
    const v = answers[q.id];
    if (q.type === 'multiselect' || q.type === 'tags') return Array.isArray(v) && v.length > 0;
    if (q.type === 'scale') return typeof v === 'number' && v >= 1;
    return asText(v).trim().length > 0;
  };

  const sectionComplete = section ? section.questions.every(isQuestionAnswered) : false;

  // -- persistence helpers (best-effort; UI is driven by state) -------------
  const persistProfile = async (built: FounderProfile): Promise<number | null> => {
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

  const persistTerritories = async (pid: number | null, list: Territory[]): Promise<Territory[]> => {
    if (!pid) return list;
    try {
      const db = (window as any).__workspaceDb;
      for (const t of list) {
        await db.from('idea_discovery_territories').insert({
          profile_id: pid,
          name: t.name,
          description: t.description,
          why_it_fits: t.whyItFits,
          potential_customers: t.potentialCustomers,
          problems_to_explore: t.problemsToExplore,
          fit_label: t.fitLabel,
          selected: false,
        });
      }
      const res = await db.from('idea_discovery_territories').orderBy('created_at', 'desc').limit(list.length).get();
      const rows: any[] = Array.isArray(res?.data) ? res.data : [];
      return list.map((t) => {
        const match = rows.find((r) => r.name === t.name && r.profile_id === pid);
        return match ? { ...t, id: match.id } : t;
      });
    } catch (error) {
      console.warn('[IdeaDiscovery] could not persist territories.', error);
      return list;
    }
  };

  const persistConcepts = async (pid: number | null, list: Concept[], terr: Territory[]): Promise<Concept[]> => {
    if (!pid) return list;
    try {
      const db = (window as any).__workspaceDb;
      for (const c of list) {
        const territoryId = terr.find((t) => t.name === c.territoryName)?.id ?? null;
        await db.from('idea_discovery_concepts').insert({
          profile_id: pid,
          territory_id: territoryId,
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
  const finishQuestionnaire = async () => {
    setLoadingLabel('Analysing your profile…');
    setPhase('loading');
    const built = await generateProfile(answers);
    setProfile(built);
    const pid = await persistProfile(built);
    setProfileId(pid);
    setPhase('profile');
  };

  const goToTerritories = async () => {
    if (!profile) return;
    setLoadingLabel('Mapping your opportunity territories…');
    setPhase('loading');
    const built = await generateTerritories(answers, profile, tier.opportunityTerritories);
    const withIds = await persistTerritories(profileId, built);
    setTerritories(withIds);
    setPhase('territories');
  };

  const toggleTerritory = (idx: number) => {
    setTerritories((prev) => {
      const selectedCount = prev.filter((t) => t.selected).length;
      return prev.map((t, i) => {
        if (i !== idx) return t;
        if (!t.selected && selectedCount >= 2) return t; // max 2
        return { ...t, selected: !t.selected };
      });
    });
  };

  const selectedTerritories = useMemo(() => territories.filter((t) => t.selected), [territories]);

  const goToConcepts = async () => {
    if (!profile || selectedTerritories.length === 0) return;
    // persist selection state (best-effort)
    try {
      const db = (window as any).__workspaceDb;
      for (const t of selectedTerritories) if (t.id) await db.from('idea_discovery_territories').update(t.id, { selected: true });
    } catch { /* noop */ }
    setLoadingLabel('Generating business concepts for you…');
    setPhase('loading');
    const built = await generateConcepts(answers, profile, selectedTerritories, tier.conceptsUnlocked || 6);
    const withIds = await persistConcepts(profileId, built, territories);
    setConcepts(withIds);
    setPhase('concepts');
  };

  const chooseConcept = async (idx: number) => {
    setSelectedConceptIndex(idx);
    const chosen = concepts[idx];
    try {
      const db = (window as any).__workspaceDb;
      if (chosen?.id) await db.from('idea_discovery_concepts').update(chosen.id, { selected: true });
    } catch { /* noop */ }
    setPhase('summary');
  };

  const goToValidation = async () => {
    if (selectedConceptIndex === null) return;
    const chosen = concepts[selectedConceptIndex];
    setLoadingLabel('Building your 14-day validation plan…');
    setPhase('loading');
    const built = await generateValidationPlan(answers, chosen);
    setPlan(built);
    await persistValidationPlan(profileId, chosen?.id ?? null, built);
    setPhase('validation');
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
      if (!configuredUrl) {
        setReferralError('Referral URL not yet configured — visit Audos Referral settings to add your link.');
        return;
      }

      let url: URL;
      try {
        url = new URL(configuredUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
      } catch {
        setReferralError('The configured referral URL is invalid — visit Audos Referral settings to correct it.');
        return;
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

  const restart = () => {
    setAnswers({});
    setSectionIndex(0);
    setProfile(null);
    setProfileId(null);
    setTerritories([]);
    setConcepts([]);
    setSelectedConceptIndex(null);
    setPlan(null);
    setNotice(null);
    setBuildBriefText('');
    setReferralUrl('');
    setReferralError(null);
    setCopied(false);
    setPhase('welcome');
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
          <p className={`mt-5 text-base sm:text-lg leading-7 ${tw.typography.color.secondary} max-w-2xl`}>
            Your experience, skills, interests, frustrations and connections may already contain the clues to your next
            business. FoundarOS helps you uncover them.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <PrimaryButton onClick={() => setPhase('questions')}>
              <Sparkles className="w-4 h-4" /> Start Idea Discovery
            </PrimaryButton>
            <span className={`text-xs ${tw.typography.color.muted}`}>Estimated time: 10–15 minutes</span>
          </div>
          {hasSavedRun && (
            <p className={`mt-8 text-xs ${tw.typography.color.muted}`}>
              You have a previous discovery saved. Starting again creates a fresh profile.
            </p>
          )}
          <div className="mt-12 grid sm:grid-cols-3 gap-3 w-full max-w-2xl text-left">
            {[
              { icon: Brain, t: 'Understand your edge', d: 'A profile built only from your real answers.' },
              { icon: Layers, t: 'Explore territories', d: 'Broad areas worth exploring — never ranked for you.' },
              { icon: Rocket, t: 'Leave with a plan', d: 'A concept to test and a 14-day validation plan.' },
            ].map((f) => (
              <div key={f.t} className={`${tw.card.flat} p-4`}>
                <f.icon className={`w-5 h-5 mb-2 ${tw.icon.primary}`} />
                <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>{f.t}</p>
                <p className={`text-xs mt-1 ${tw.typography.color.muted}`}>{f.d}</p>
              </div>
            ))}
          </div>
          <p className={`mt-10 text-xs ${tw.typography.color.muted} max-w-md`}>
            DISCOVER → VALIDATE → BUILD → ASSESS → FUND → OPERATE. You are at the very first step.
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === 'questions') {
    return (
      <Shell innerRef={scrollRef}>
        {/* progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-medium ${tw.typography.color.accent}`}>Section {sectionIndex + 1} of {totalSections}</span>
            <span className={`text-xs ${tw.typography.color.muted}`}>{section.title}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-[var(--space-surface-muted)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${((sectionIndex + 1) / totalSections) * 100}%`, background: 'var(--space-brand-primary)' }}
            />
          </div>
        </div>

        <div className={`${tw.card.glass} p-5 sm:p-7`}>
          <h2 className={`text-xl font-bold ${tw.typography.color.primary}`}>{section.title}</h2>
          {section.intro && <p className={`mt-1.5 text-sm ${tw.typography.color.secondary}`}>{section.intro}</p>}
          {section.critical && (
            <div
              className="mt-4 flex items-start gap-2.5 p-3 rounded-lg"
              style={{
                background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)',
              }}
            >
              <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tw.icon.primary}`} />
              <p className={`text-xs leading-5 ${tw.typography.color.secondary}`}>
                <span className={`font-semibold ${tw.typography.color.primary}`}>Most important section. </span>
                {section.criticalNote}
              </p>
            </div>
          )}

          <div className="mt-6 space-y-7">
            {section.questions.map((q, qi) => (
              <QuestionField
                key={q.id}
                q={q}
                index={qi}
                value={answers[q.id]}
                onChange={(val) => setAnswer(q.id, val)}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => (sectionIndex === 0 ? setPhase('welcome') : setSectionIndex((i) => i - 1))}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm ${tw.button.ghost}`}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          {sectionIndex < totalSections - 1 ? (
            <PrimaryButton onClick={() => setSectionIndex((i) => i + 1)} disabled={!sectionComplete}>
              Continue <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={finishQuestionnaire} disabled={!sectionComplete}>
              <Sparkles className="w-4 h-4" /> Analyse my profile
            </PrimaryButton>
          )}
        </div>
        {!sectionComplete && (
          <p className={`mt-3 text-right text-xs ${tw.typography.color.muted}`}>Answer each question to continue (optional ones can be skipped).</p>
        )}
      </Shell>
    );
  }

  if (phase === 'profile' && profile) {
    return (
      <Shell innerRef={scrollRef}>
        <Header eyebrow="Step 3 · Founder Opportunity Profile" title="Your Founder Opportunity Profile" subtitle="A personalized strategic assessment — grounded only in what you told us. No ideas yet." />
        <div
          className="mb-6 p-5 rounded-2xl"
          style={{
            background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className={`w-4 h-4 ${tw.icon.primary}`} />
            <h3 className={`text-sm font-semibold ${tw.typography.color.primary}`}>Founder Opportunity Pattern</h3>
          </div>
          <p className={`text-sm leading-6 ${tw.typography.color.secondary}`}>{profile.opportunityPattern}</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <SectionCard icon={Briefcase} title="Experience Strengths">{profile.experienceStrengths}</SectionCard>
          <SectionCard icon={Sparkles} title="Core Skills">
            <div className="flex flex-wrap gap-2">
              {profile.coreSkills.map((s, i) => (
                <span key={i} className="px-2.5 py-1 rounded-full text-xs bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)] border border-[var(--space-border-default)]">{s}</span>
              ))}
            </div>
          </SectionCard>
          <SectionCard icon={Brain} title="Knowledge Advantage">{profile.knowledgeAdvantage}</SectionCard>
          <SectionCard icon={AlertTriangle} title="Problem Sensitivity">{profile.problemSensitivity}</SectionCard>
          <SectionCard icon={Users} title="Access Advantage">{profile.accessAdvantage}</SectionCard>
          <SectionCard icon={Target} title="Founder Goal">
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)] capitalize">{profile.founderGoal}</span>
          </SectionCard>
          <div className="sm:col-span-2">
            <SectionCard icon={Wallet} title="Resource Profile">
              <div className="grid sm:grid-cols-3 gap-3">
                <ResourceItem icon={Clock} label="Time" value={profile.resourceProfile.time} />
                <ResourceItem icon={Wallet} label="Capital" value={profile.resourceProfile.capital} />
                <ResourceItem icon={Star} label="Relevant assets" value={profile.resourceProfile.assets} />
              </div>
            </SectionCard>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button onClick={restart} className={`text-xs ${tw.typography.color.muted} hover:underline`}>Start over</button>
          <PrimaryButton onClick={goToTerritories}>
            See your opportunity territories <ArrowRight className="w-4 h-4" />
          </PrimaryButton>
        </div>
      </Shell>
    );
  }

  if (phase === 'territories') {
    return (
      <Shell innerRef={scrollRef}>
        <Header eyebrow="Steps 4–5 · Opportunity Territories" title="Which opportunity would you like to explore?" subtitle="These are broad areas worth exploring — not business ideas, and never ranked. Select 1–2 to go deeper." />
        <div className="space-y-4">
          {territories.map((t, i) => {
            const disabled = !t.selected && selectedTerritories.length >= 2;
            return (
              <button
                key={i}
                onClick={() => toggleTerritory(i)}
                disabled={disabled}
                className={`w-full text-left ${tw.card.glass} p-5 transition-all ${t.selected ? 'ring-2' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'}`}
                style={t.selected ? { boxShadow: '0 0 0 2px var(--space-brand-primary)' } : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ border: '2px solid var(--space-brand-primary)', background: t.selected ? 'var(--space-brand-primary)' : 'transparent' }}>
                      {t.selected ? <Check className="w-3.5 h-3.5 text-[var(--space-text-on-primary)]" /> : null}
                    </span>
                    <h3 className={`text-lg font-bold ${tw.typography.color.primary}`}>{t.name}</h3>
                  </div>
                  <FitBadge label={t.fitLabel} />
                </div>
                <p className={`mt-2 text-sm ${tw.typography.color.secondary}`}>{t.description}</p>
                <div className="mt-4 grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${tw.typography.color.accent}`}>Why it emerged</p>
                    <ul className="space-y-1">
                      {t.whyItFits.map((w, wi) => (
                        <li key={wi} className={`text-xs flex gap-1.5 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{w}</li>
                      ))}
                    </ul>
                    <p className={`mt-3 text-xs ${tw.typography.color.muted}`}><span className="font-semibold">Potential customers: </span>{t.potentialCustomers}</p>
                  </div>
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${tw.typography.color.accent}`}>Problems worth exploring</p>
                    <ul className="space-y-1">
                      {t.problemsToExplore.map((p, pi) => (
                        <li key={pi} className={`text-xs flex gap-1.5 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{p}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-8 flex items-center justify-between">
          <span className={`text-xs ${tw.typography.color.muted}`}>{selectedTerritories.length}/2 selected</span>
          <PrimaryButton onClick={goToConcepts} disabled={selectedTerritories.length === 0}>
            Explore selected territories <ArrowRight className="w-4 h-4" />
          </PrimaryButton>
        </div>
      </Shell>
    );
  }

  if (phase === 'concepts') {
    return (
      <Shell innerRef={scrollRef}>
        <Header eyebrow="Step 6 · Business Concepts" title="Personalized business concepts" subtitle="Concepts worth exploring, generated from your profile and chosen territories." />
        <Disclaimer />
        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          {concepts.map((c, i) => (
            <div key={i} className={`${tw.card.glass} p-5 flex flex-col`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`text-xs ${tw.typography.color.muted}`}>{c.territoryName}</span>
                  <h3 className={`text-lg font-bold ${tw.typography.color.primary}`}>{c.name}</h3>
                </div>
                <StartBadge label={c.startability} />
              </div>
              <div className="mt-3 space-y-2.5 text-sm">
                <ConceptRow label="The problem" value={c.problem} />
                <ConceptRow label="Target customer" value={c.targetCustomer} />
                <ConceptRow label="Proposed solution" value={c.solution} />
                <ConceptRow label="Business model" value={c.businessModel} />
                <ConceptRow label="Why it fits you" value={c.founderFit} />
                <ConceptRow label="Founder advantage" value={c.founderAdvantage} />
              </div>
              <div className="mt-3">
                <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${tw.typography.color.accent}`}>What needs to be proven</p>
                <ul className="space-y-1">
                  {c.assumptions.map((a, ai) => (
                    <li key={ai} className={`text-xs flex gap-1.5 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{a}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-3 p-3 rounded-lg bg-[var(--space-surface-muted)]">
                <p className={`text-xs font-semibold ${tw.typography.color.primary}`}>First validation experiment</p>
                <p className={`text-xs mt-1 ${tw.typography.color.secondary}`}>{c.validationExperiment}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-end">
          <PrimaryButton onClick={() => setPhase('compare')}>
            Compare concepts <ArrowRight className="w-4 h-4" />
          </PrimaryButton>
        </div>
      </Shell>
    );
  }

  if (phase === 'compare') {
    const criteria: { key: keyof ConceptComparison; label: string }[] = [
      { key: 'founderFit', label: 'Founder Fit' },
      { key: 'problemClarity', label: 'Problem Clarity' },
      { key: 'customerClarity', label: 'Customer Clarity' },
      { key: 'access', label: 'Access' },
      { key: 'startability', label: 'Startability' },
      { key: 'businessModel', label: 'Business Model' },
      { key: 'validationDifficulty', label: 'Validation Difficulty' },
    ];
    return (
      <Shell innerRef={scrollRef}>
        <Header eyebrow="Step 7 · Compare" title="Compare your concepts" subtitle="Weigh them side by side. There is no automatic winner — you decide which one to investigate." />
        <div className="overflow-x-auto rounded-2xl border border-[var(--space-border-default)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="text-left p-3 sticky left-0 bg-[var(--space-surface-panel-strong)] z-10">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.muted}`}>Criteria</span>
                </th>
                {concepts.map((c, i) => (
                  <th key={i} className="p-3 text-left min-w-[160px] bg-[var(--space-surface-panel)]">
                    <span className={`text-sm font-bold ${tw.typography.color.primary}`}>{c.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {criteria.map((crit) => (
                <tr key={crit.key} className="border-t border-[var(--space-border-default)]">
                  <td className="p-3 sticky left-0 bg-[var(--space-surface-panel-strong)] z-10">
                    <span className={`text-xs font-medium ${tw.typography.color.secondary}`}>{crit.label}</span>
                  </td>
                  {concepts.map((c, i) => (
                    <td key={i} className={`p-3 ${tw.typography.color.primary}`}>{c.comparison[crit.key]}</td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-[var(--space-border-default)]">
                <td className="p-3 sticky left-0 bg-[var(--space-surface-panel-strong)] z-10" />
                {concepts.map((c, i) => (
                  <td key={i} className="p-3">
                    <button onClick={() => chooseConcept(i)} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs ${tw.button.primary}`}>
                      Investigate <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button onClick={() => setPhase('concepts')} className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm ${tw.button.ghost}`}>
            <ArrowLeft className="w-4 h-4" /> Back to concepts
          </button>
        </div>
      </Shell>
    );
  }

  if (phase === 'summary' && selectedConceptIndex !== null) {
    const c = concepts[selectedConceptIndex];
    return (
      <Shell innerRef={scrollRef}>
        <Header eyebrow="Step 8 · Your Idea to Explore" title="Your idea to explore" subtitle="The concept you chose to investigate next." />
        <div className={`${tw.card.glass} p-6`}>
          <h2 className={`text-2xl font-bold ${tw.typography.color.primary}`}>{c.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2"><StartBadge label={c.startability} /><span className={`text-xs ${tw.typography.color.muted} self-center`}>{c.territoryName}</span></div>
          <div className="mt-5 grid sm:grid-cols-2 gap-4 text-sm">
            <ConceptRow label="Problem" value={c.problem} />
            <ConceptRow label="Target customer" value={c.targetCustomer} />
            <ConceptRow label="Proposed solution" value={c.solution} />
            <ConceptRow label="Business model" value={c.businessModel} />
            <ConceptRow label="Founder fit" value={c.founderFit} />
            <ConceptRow label="Founder advantage" value={c.founderAdvantage} />
          </div>
          <div className="mt-4">
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${tw.typography.color.accent}`}>Key assumptions</p>
            <ul className="space-y-1">
              {c.assumptions.map((a, ai) => (
                <li key={ai} className={`text-sm flex gap-1.5 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{a}</li>
              ))}
            </ul>
          </div>
          <div
            className="mt-5 flex items-start gap-2.5 p-3 rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--space-semantic-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--space-semantic-warning) 40%, transparent)' }}
          >
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--space-semantic-warning)' }} />
            <p className={`text-xs leading-5 ${tw.typography.color.secondary}`}>This is a concept worth exploring, not a validated business yet.</p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button onClick={() => setPhase('compare')} className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm ${tw.button.ghost}`}>
            <ArrowLeft className="w-4 h-4" /> Compare again
          </button>
          <PrimaryButton onClick={goToValidation}>
            <ClipboardList className="w-4 h-4" /> Build my 14-day validation plan
          </PrimaryButton>
        </div>
      </Shell>
    );
  }

  if (phase === 'validation' && plan && selectedConceptIndex !== null) {
    const c = concepts[selectedConceptIndex];
    const days = [
      { range: 'Days 1–3', title: 'Identify 10 potential customers', body: plan.days_1_3 },
      { range: 'Days 4–7', title: 'Conduct customer interviews', body: plan.days_4_7 },
      { range: 'Days 8–10', title: 'Test the proposed solution', body: plan.days_8_10 },
      { range: 'Days 11–12', title: 'Test willingness to pay', body: plan.days_11_12 },
      { range: 'Days 13–14', title: 'Review evidence & decide', body: plan.days_13_14 },
    ];
    return (
      <Shell innerRef={scrollRef}>
        <Header eyebrow="Step 9 · Validation Plan" title={`Your 14-day validation plan`} subtitle={`A practical plan to test “${c.name}” before you build anything.`} />
        <div className="space-y-3">
          {days.map((d, i) => (
            <div key={i} className={`${tw.card.glass} p-4 flex gap-4`}>
              <div className="flex flex-col items-center">
                <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--space-surface-accent-soft)]">
                  <CalendarDays className={`w-4 h-4 ${tw.icon.primary}`} />
                </span>
                {i < days.length - 1 && <span className="w-px flex-1 mt-1" style={{ background: 'var(--space-border-default)' }} />}
              </div>
              <div className="pb-1">
                <p className={`text-xs font-semibold ${tw.typography.color.accent}`}>{d.range}</p>
                <p className={`text-sm font-semibold ${tw.typography.color.primary}`}>{d.title}</p>
                <p className={`text-sm mt-1 ${tw.typography.color.secondary}`}>{d.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className={`${tw.card.glass} p-5 mt-5`}>
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className={`w-4 h-4 ${tw.icon.primary}`} />
            <h3 className={`text-sm font-semibold ${tw.typography.color.primary}`}>Customer interview questions</h3>
          </div>
          <ul className="space-y-2">
            {plan.interviewQuestions.map((q, i) => (
              <li key={i} className={`text-sm flex gap-2 ${tw.typography.color.secondary}`}>
                <span className={`font-semibold ${tw.typography.color.accent}`}>{i + 1}.</span>{q}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-6 flex items-center justify-end">
          <PrimaryButton onClick={() => setPhase('map')}>
            <MapIcon className="w-4 h-4" /> See your Opportunity Map
          </PrimaryButton>
        </div>
      </Shell>
    );
  }

  if (phase === 'build-brief' && selectedConceptIndex !== null && buildBriefDraft) {
    const brief = buildBriefDraft;
    return (
      <Shell innerRef={scrollRef}>
        <Header eyebrow="Step 11 · Audos Build Brief" title="Your Audos Build Brief" subtitle="Compiled from your Idea Discovery — no re-entry needed." />
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
          <button onClick={() => setPhase('map')} className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm ${tw.button.ghost}`}>
            <ArrowLeft className="w-4 h-4" /> Back to Opportunity Map
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
              <PrimaryButton onClick={() => { window.open(referralUrl, '_blank', 'noopener,noreferrer'); setPhase('map'); }}>
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

  if (phase === 'map' && profile) {
    const chosen = selectedConceptIndex !== null ? concepts[selectedConceptIndex] : null;
    return (
      <Shell innerRef={scrollRef}>
        <div className="flex items-center justify-between gap-3 mb-2 print:mb-6">
          <span className={`text-xs font-medium ${tw.typography.color.accent}`}>Step 10 · Founder Opportunity Map</span>
          <button onClick={() => window.print()} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs ${tw.button.secondary} print:hidden`}>
            <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
          </button>
        </div>
        <h1 className={`text-2xl sm:text-3xl font-bold tracking-tight ${tw.typography.color.primary}`}>FoundarOS Founder Opportunity Map</h1>
        <p className={`mt-2 text-sm ${tw.typography.color.secondary}`}>Your personalized strategic document — built entirely from your own answers.</p>

        <MapBlock icon={Brain} title="Your Founder Profile">
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <ConceptRow label="Experience" value={profile.experienceStrengths} />
            <ConceptRow label="Skills" value={profile.coreSkills.join(', ')} />
            <ConceptRow label="Knowledge" value={profile.knowledgeAdvantage} />
            <ConceptRow label="Interests" value={asText(answers.interests_areas) || asText(answers.interests_topics)} />
            <ConceptRow label="Access" value={profile.accessAdvantage} />
            <ConceptRow label="Goals" value={profile.founderGoal} />
            <ConceptRow label="Resources" value={`Time: ${profile.resourceProfile.time} · Capital: ${profile.resourceProfile.capital}`} />
          </div>
        </MapBlock>

        <MapBlock icon={Layers} title="Your Opportunity Territories">
          <div className="flex flex-wrap gap-2">
            {territories.map((t, i) => (
              <span key={i} className={`px-3 py-1.5 rounded-lg text-xs ${t.selected ? 'bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)] font-semibold' : 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]'}`}>
                {t.name}{t.selected ? ' ✓' : ''}
              </span>
            ))}
          </div>
        </MapBlock>

        <MapBlock icon={Lightbulb} title="Concepts Explored">
          <div className="flex flex-wrap gap-2">
            {concepts.map((c, i) => (
              <span key={i} className={`px-3 py-1.5 rounded-lg text-xs ${chosen && c.name === chosen.name ? 'bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)] font-semibold' : 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]'}`}>{c.name}</span>
            ))}
          </div>
        </MapBlock>

        {chosen && (
          <>
            <MapBlock icon={Rocket} title="Selected Concept">
              <h3 className={`text-lg font-bold ${tw.typography.color.primary}`}>{chosen.name}</h3>
              <div className="mt-2 grid sm:grid-cols-2 gap-3 text-sm">
                <ConceptRow label="Problem" value={chosen.problem} />
                <ConceptRow label="Target customer" value={chosen.targetCustomer} />
                <ConceptRow label="Solution" value={chosen.solution} />
                <ConceptRow label="Business model" value={chosen.businessModel} />
              </div>
            </MapBlock>
            <MapBlock icon={Target} title="Why It Fits You">{chosen.founderFit} {chosen.founderAdvantage}</MapBlock>
            <MapBlock icon={AlertTriangle} title="What Needs to Be Proven">
              <ul className="space-y-1">
                {chosen.assumptions.map((a, ai) => (
                  <li key={ai} className={`text-sm flex gap-1.5 ${tw.typography.color.secondary}`}><span className={tw.typography.color.accent}>•</span>{a}</li>
                ))}
              </ul>
            </MapBlock>
          </>
        )}

        {plan && (
          <MapBlock icon={ClipboardList} title="14-Day Validation Plan">
            <div className="space-y-2 text-sm">
              <ConceptRow label="Days 1–3" value={plan.days_1_3} />
              <ConceptRow label="Days 4–7" value={plan.days_4_7} />
              <ConceptRow label="Days 8–10" value={plan.days_8_10} />
              <ConceptRow label="Days 11–12" value={plan.days_11_12} />
              <ConceptRow label="Days 13–14" value={plan.days_13_14} />
            </div>
          </MapBlock>
        )}

        {/* Step 11 — handoff */}
        <div
          className="mt-8 p-6 rounded-2xl text-center print:hidden"
          style={{ background: 'color-mix(in srgb, var(--space-brand-primary-500) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)' }}
        >
          <h3 className={`text-lg font-bold ${tw.typography.color.primary}`}>Ready to test whether this idea has real potential?</h3>
          <p className={`mt-2 text-sm ${tw.typography.color.secondary} max-w-lg mx-auto`}>Take your chosen concept into Idea Validation with Gap Radar and see what evidence you already have and what to prove next.</p>
          <div className="mt-4 flex flex-col items-center gap-3">
            <PrimaryButton onClick={handoffToGapRadar}>
              Continue to Idea Validation <ArrowUpRight className="w-4 h-4" />
            </PrimaryButton>
            <button onClick={() => setShowBooking((s) => !s)} className={`text-xs ${tw.typography.color.accent} hover:underline`}>
              Want a human to help you work through your opportunities?
            </button>
            {showBooking && (
              <div className={`text-xs ${tw.typography.color.muted} max-w-sm`}>
                <span className={`font-semibold ${tw.typography.color.secondary}`}>Book a FoundarOS Idea Discovery Session</span> — live facilitated sessions are coming soon. Ask the assistant to add you to the waitlist.
              </div>
            )}
          </div>
        </div>

        <div className={`${tw.card.glass} p-5 sm:p-6 mt-5 print:hidden`}>
          <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>What’s Next?</p>
          <h3 className={`mt-1 text-lg font-bold ${tw.typography.color.primary}`}>Your Founder Journey</h3>
          <div className="mt-5 space-y-4">
            {[
              { step: 1, title: 'Discover', description: 'Find an idea worth exploring.', complete: true, action: null },
              { step: 2, title: 'Validate', description: 'Understand the problem, customer and opportunity.', complete: false, action: () => openApp('gap-radar'), label: '→ Continue in FoundarOS' },
              { step: 3, title: 'Build', description: 'Turn your idea into an MVP.', complete: false, action: () => setPhase('build-brief'), label: '→ Build with Audos' },
              { step: 4, title: 'Fund', description: 'Prepare your venture for funding.', complete: false, action: () => openApp('gap-radar', 'funding-readiness'), label: '→ FoundarOS Fundability' },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-3">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
                  style={item.complete ? { color: 'var(--space-semantic-success)', background: 'color-mix(in srgb, var(--space-semantic-success) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--space-semantic-success) 40%, transparent)' } : { color: 'var(--space-text-accent)', background: 'var(--space-surface-muted)', border: '1px solid var(--space-border-default)' }}
                >
                  {item.complete ? <Check className="w-4 h-4" /> : item.step}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className={`text-sm font-semibold ${tw.typography.color.primary}`}>{item.title}</h4>
                    {item.complete && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium text-[var(--space-semantic-success)]" style={{ background: 'color-mix(in srgb, var(--space-semantic-success) 12%, transparent)' }}>✓ Completed</span>
                    )}
                  </div>
                  <p className={`mt-0.5 text-sm ${tw.typography.color.secondary}`}>{item.description}</p>
                  {item.action && (
                    <button onClick={item.action} className={`mt-1.5 text-sm font-medium ${tw.typography.color.accent} hover:underline`}>{item.label}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="mt-5 p-6 rounded-2xl print:hidden"
          style={{ background: 'color-mix(in srgb, var(--space-brand-primary-500) 18%, var(--space-surface-panel))', border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 45%, transparent)' }}
        >
          <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>Ready to build?</p>
          <h3 className={`mt-1 text-xl font-bold ${tw.typography.color.primary}`}>Your idea is ready to build</h3>
          <p className={`mt-2 text-sm leading-6 ${tw.typography.color.secondary} max-w-2xl`}>
            You’ve identified an opportunity. Now turn your idea into something real. Audos lets founders use AI to build and develop their product — from concept to MVP.
          </p>
          <div className="mt-5 flex flex-col items-start gap-3">
            <PrimaryButton onClick={() => setPhase('build-brief')}>
              Build This Idea on Audos <ArrowRight className="w-4 h-4" />
            </PrimaryButton>
            <button onClick={() => openApp('gap-radar')} className={`text-sm ${tw.typography.color.accent} hover:underline`}>Continue exploring in FoundarOS</button>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center print:hidden">
          <button onClick={restart} className={`text-xs ${tw.typography.color.muted} hover:underline`}>Start a new discovery</button>
        </div>
        <p className={`mt-6 text-center text-xs ${tw.typography.color.muted}`}>DISCOVER → VALIDATE → BUILD → ASSESS → FUND → OPERATE</p>
      </Shell>
    );
  }

  // Fallback (shouldn't happen): reset to welcome.
  return (
    <Shell innerRef={scrollRef}>
      <div className="py-24 text-center">
        <p className={`text-sm ${tw.typography.color.secondary}`}>{notice || 'Let\u2019s begin your discovery.'}</p>
        <div className="mt-4 flex justify-center"><PrimaryButton onClick={restart}>Start Idea Discovery</PrimaryButton></div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function Header({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <span className={`text-xs font-medium ${tw.typography.color.accent}`}>{eyebrow}</span>
      <h1 className={`mt-1 text-2xl sm:text-3xl font-bold tracking-tight ${tw.typography.color.primary}`}>{title}</h1>
      <p className={`mt-2 text-sm ${tw.typography.color.secondary} max-w-2xl`}>{subtitle}</p>
    </div>
  );
}

function Disclaimer() {
  return (
    <div
      className="flex items-start gap-2.5 p-3 rounded-lg"
      style={{ background: 'color-mix(in srgb, var(--space-semantic-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--space-semantic-warning) 40%, transparent)' }}
    >
      <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--space-semantic-warning)' }} />
      <p className={`text-xs leading-5 ${tw.typography.color.secondary}`}>These are concepts worth exploring, not validated businesses.</p>
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

function ResourceItem({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--space-surface-muted)]">
      <div className="flex items-center gap-1.5 mb-1"><Icon className={`w-3.5 h-3.5 ${tw.icon.primary}`} /><span className={`text-xs font-semibold ${tw.typography.color.primary}`}>{label}</span></div>
      <p className={`text-xs ${tw.typography.color.secondary}`}>{value}</p>
    </div>
  );
}

function MapBlock({ icon: Icon, title, children }: { icon: any; title: string; children: ReactNode }) {
  return (
    <div className={`${tw.card.glass} p-5 mt-4`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-[var(--space-surface-accent-soft)]"><Icon className={`w-4 h-4 ${tw.icon.primary}`} /></span>
        <h2 className={`text-base font-bold ${tw.typography.color.primary}`}>{title}</h2>
      </div>
      <div className={`text-sm leading-6 ${tw.typography.color.secondary}`}>{children}</div>
    </div>
  );
}

// -- question field renderer -------------------------------------------------
function QuestionField({ q, index, value, onChange }: { q: Question; index: number; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void }) {
  return (
    <div>
      <label className={`block text-sm font-semibold ${tw.typography.color.primary}`}>
        <span className={tw.typography.color.accent}>Q{index + 1}. </span>{q.label}{q.optional && <span className={`ml-1.5 text-xs font-normal ${tw.typography.color.muted}`}>(optional)</span>}
      </label>
      {q.helper && <p className={`mt-1 text-xs ${tw.typography.color.muted}`}>{q.helper}</p>}
      <div className="mt-2.5">
        {q.type === 'textarea' && (
          <textarea
            value={asText(value)}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
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
