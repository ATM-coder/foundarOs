import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FileSearch,
  Gauge,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { tw } from '../../lib/colors';
import { useSpaceRuntime } from '../../SpaceRuntimeContext';
import questionBank from '../../data/gap-radar.json';

type FounderStage = 'idea' | 'validation' | 'early_venture' | 'operating_fundraising';
type EvidenceStatus = 'Demonstrated' | 'Emerging' | 'Unproven' | 'Not Yet Applicable';
type FundingStatus =
  | 'BUILD EVIDENCE FIRST'
  | 'VALIDATE THEN EXPLORE FUNDING'
  | 'BEGIN FUNDING PREPARATION'
  | 'ACTIVELY PREPARE FOR FUNDING';
type Phase = 'stage' | 'questions' | 'scoring' | 'report';
type AnswerMap = Record<string, string>;

type Choice = { label: string; score: number };
type StageQuestion = {
  id: string;
  dimension: string;
  type: 'text' | 'choice';
  prompt: string;
  help?: string;
  options?: Choice[];
};
type Dimension = {
  id: string;
  label: string;
  weight: number;
  why: string;
  strengthen: string[];
  proof: string;
};
type StageDefinition = {
  id: FounderStage;
  letter: string;
  name: string;
  description: string;
  scoreName: string;
  journey: string;
  recommendedStatus: FundingStatus;
  nextMilestone: string;
  focusMessage: string;
  radarLabels: string[];
  notYetApplicable: string[];
  dimensions: Dimension[];
  questions: StageQuestion[];
};
type RoadmapItem = { week: number; title: string; action: string; proof: string };
type DimensionResult = {
  id: string;
  label: string;
  score: number;
  evidenceStatus: EvidenceStatus;
  whyThisMatters: string;
  strengthen: string[];
  nextProofPoint: string;
  priority: 'high' | 'medium' | 'low';
};
type Analysis = {
  dimensions: DimensionResult[];
  overallScore: number;
  evidenceStrength: Exclude<EvidenceStatus, 'Not Yet Applicable'>;
  fundingStatus: FundingStatus;
  nextProofPoint: string;
  recommendations: string[];
  roadmap: RoadmapItem[];
};
type FacilitatorAdjustment = {
  score?: number;
  evidenceStatus?: EvidenceStatus;
  priority?: 'high' | 'medium' | 'low';
};
type FacilitatorReview = {
  confirmed?: boolean;
  adjustments?: Record<string, FacilitatorAdjustment>;
  observations?: string;
  founderVisible?: boolean;
  reviewedAt?: string;
};
type SessionRow = {
  id: number;
  status: 'in_progress' | 'completed';
  current_index: number | null;
  answers: unknown;
  overall_score: number | null;
  category_scores: unknown;
  top_gaps: unknown;
  completed_at: string | null;
  founder_stage?: FounderStage | null;
  dimension_scores?: unknown;
  evidence_statuses?: unknown;
  ai_explanations?: unknown;
  facilitator_adjustments?: unknown;
  facilitator_notes?: string | null;
  founder_visible_notes?: string | null;
  funding_status?: FundingStatus | null;
  roadmap?: unknown;
  assessment_version?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
};

type Props = {
  paidAccess: boolean;
  upgradeSlot: ReactNode;
  onOpenBoard?: () => void;
};

const STAGES = questionBank.stages as StageDefinition[];
const ASSESSMENT_VERSION = '2.0';
const ALLOWED_FUNDING_STATUSES: FundingStatus[] = [
  'BUILD EVIDENCE FIRST',
  'VALIDATE THEN EXPLORE FUNDING',
  'BEGIN FUNDING PREPARATION',
  'ACTIVELY PREPARE FOR FUNDING',
];
const LEGACY_CHOICE_IDS = [
  'ic_problem', 'ic_customer', 'ic_different', 'ic_simple', 'ic_stage', 'ic_founder', 'ic_whynow',
  'mv_interviews', 'mv_size', 'mv_competitors', 'mv_statusquo', 'mv_pricing_signal', 'mv_channels', 'mv_proof',
  'ft_model', 'ft_price', 'ft_costs', 'ft_breakeven', 'ft_expenses', 'ft_year1', 'ft_margins',
  'fu_ask', 'fu_sources', 'fu_team', 'fu_skin', 'fu_useoffunds', 'fu_traction',
];

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function stageById(id: FounderStage | null): StageDefinition | null {
  return STAGES.find((stage) => stage.id === id) || null;
}

function evidenceForScore(score: number): EvidenceStatus {
  if (score >= 75) return 'Demonstrated';
  if (score >= 50) return 'Emerging';
  return 'Unproven';
}

function evidenceStrength(results: DimensionResult[]): Analysis['evidenceStrength'] {
  const demonstrated = results.filter((item) => item.evidenceStatus === 'Demonstrated').length;
  const emerging = results.filter((item) => item.evidenceStatus === 'Emerging').length;
  if (demonstrated >= Math.ceil(results.length / 2)) return 'Demonstrated';
  if (demonstrated + emerging >= Math.ceil(results.length / 2)) return 'Emerging';
  return 'Unproven';
}

function classifyFunding(stage: FounderStage, score: number, results: DimensionResult[]): FundingStatus {
  const unproven = results.filter((item) => item.evidenceStatus === 'Unproven').length;
  if (score < 45 || unproven >= 5) return 'BUILD EVIDENCE FIRST';
  if (score < 64 || unproven >= 3) return 'VALIDATE THEN EXPLORE FUNDING';
  if (stage === 'operating_fundraising' && score >= 78 && unproven <= 1) return 'ACTIVELY PREPARE FOR FUNDING';
  return 'BEGIN FUNDING PREPARATION';
}

function scoreText(answer: string): number {
  const text = answer.trim().toLowerCase();
  if (!text) return 15;
  let score = text.length >= 220 ? 68 : text.length >= 130 ? 58 : text.length >= 70 ? 48 : 35;
  if (/customer|interview|pilot|paid|revenue|retention|tested|data|research|quote|loi|pre-order|conversion|margin|runway/.test(text)) score += 10;
  if (/\d/.test(text)) score += 8;
  if (/not yet|none|no evidence|haven't|have not|don't know|do not know/.test(text)) score -= 18;
  return clamp(score, 15, 88);
}

function fallbackRoadmap(stage: StageDefinition, results: DimensionResult[]): RoadmapItem[] {
  if (stage.id === 'idea') {
    return [
      { week: 1, title: 'Understand the customer', action: 'Interview target customers about the problem and their current behaviour.', proof: 'Five interview notes with direct customer language.' },
      { week: 2, title: 'Validate the problem', action: 'Identify recurring pain points, urgency and the alternatives customers use today.', proof: 'A ranked pattern summary across interviews.' },
      { week: 3, title: 'Test the solution', action: 'Create a simple prototype, concept or concierge test and observe reactions.', proof: 'Three target customers complete a structured concept test.' },
      { week: 4, title: 'Test willingness to pay', action: 'Make an actual offer through a pre-order, pilot, LOI or other meaningful demand signal.', proof: 'At least one customer makes a concrete commitment.' },
    ];
  }
  const gaps = [...results].sort((a, b) => a.score - b.score);
  return [0, 1, 2, 3].map((weekIndex) => {
    const gap = gaps[weekIndex % Math.max(gaps.length, 1)] || results[0];
    return {
      week: weekIndex + 1,
      title: weekIndex === 0 ? `Diagnose ${gap.label}` : weekIndex === 3 ? 'Package the evidence' : `Strengthen ${gap.label}`,
      action: gap.strengthen[weekIndex % gap.strengthen.length] || gap.nextProofPoint,
      proof: weekIndex === 3 ? `Compile the evidence created this month and update the ${stage.scoreName}.` : gap.nextProofPoint,
    };
  });
}

function deterministicAnalysis(stage: StageDefinition, answers: AnswerMap): Analysis {
  const dimensions = stage.dimensions.map((dimension) => {
    const questions = stage.questions.filter((question) => question.dimension === dimension.id);
    const scores = questions.map((question) => {
      const answer = answers[question.id] || '';
      if (question.type === 'choice') {
        const selected = question.options?.[Number(answer)];
        return selected ? (selected.score / 3) * 100 : 0;
      }
      return scoreText(answer);
    });
    const score = clamp(scores.reduce((sum, value) => sum + value, 0) / Math.max(scores.length, 1));
    return {
      id: dimension.id,
      label: dimension.label,
      score,
      evidenceStatus: evidenceForScore(score),
      whyThisMatters: dimension.why,
      strengthen: dimension.strengthen,
      nextProofPoint: dimension.proof,
      priority: score < 45 ? 'high' : score < 70 ? 'medium' : 'low',
    } as DimensionResult;
  });
  const overallScore = clamp(dimensions.reduce((sum, item) => {
    const weight = stage.dimensions.find((dimension) => dimension.id === item.id)?.weight || 0;
    return sum + item.score * (weight / 100);
  }, 0));
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  return {
    dimensions,
    overallScore,
    evidenceStrength: evidenceStrength(dimensions),
    fundingStatus: classifyFunding(stage.id, overallScore, dimensions),
    nextProofPoint: weakest?.nextProofPoint || stage.nextMilestone,
    recommendations: [stage.focusMessage, ...(weakest?.strengthen || []).slice(0, 2)],
    roadmap: fallbackRoadmap(stage, dimensions),
  };
}

function normalizeAnalysis(raw: unknown, stage: StageDefinition, fallback: Analysis): Analysis {
  const input = raw && typeof raw === 'object' ? raw as Partial<Analysis> : {};
  const byId = new Map((Array.isArray(input.dimensions) ? input.dimensions : []).map((item) => [item?.id, item]));
  const dimensions = fallback.dimensions.map((base) => {
    const candidate = byId.get(base.id) as Partial<DimensionResult> | undefined;
    const score = Number.isFinite(candidate?.score) ? clamp(Number(candidate?.score)) : base.score;
    const status = ['Demonstrated', 'Emerging', 'Unproven', 'Not Yet Applicable'].includes(String(candidate?.evidenceStatus))
      ? candidate?.evidenceStatus as EvidenceStatus
      : evidenceForScore(score);
    return {
      ...base,
      score,
      evidenceStatus: status,
      whyThisMatters: typeof candidate?.whyThisMatters === 'string' && candidate.whyThisMatters.trim() ? candidate.whyThisMatters.trim() : base.whyThisMatters,
      strengthen: Array.isArray(candidate?.strengthen) && candidate!.strengthen!.length > 0
        ? candidate!.strengthen!.filter((item): item is string => typeof item === 'string').slice(0, 4)
        : base.strengthen,
      nextProofPoint: typeof candidate?.nextProofPoint === 'string' && candidate.nextProofPoint.trim() ? candidate.nextProofPoint.trim() : base.nextProofPoint,
      priority: ['high', 'medium', 'low'].includes(String(candidate?.priority)) ? candidate?.priority as DimensionResult['priority'] : base.priority,
    };
  });
  const overallScore = clamp(dimensions.reduce((sum, item) => {
    const weight = stage.dimensions.find((dimension) => dimension.id === item.id)?.weight || 0;
    return sum + item.score * weight / 100;
  }, 0));
  const fundingStatus = ALLOWED_FUNDING_STATUSES.includes(input.fundingStatus as FundingStatus)
    ? input.fundingStatus as FundingStatus
    : classifyFunding(stage.id, overallScore, dimensions);
  const strength = ['Demonstrated', 'Emerging', 'Unproven'].includes(String(input.evidenceStrength))
    ? input.evidenceStrength as Analysis['evidenceStrength']
    : evidenceStrength(dimensions);
  const roadmap = Array.isArray(input.roadmap) && input.roadmap.length === 4
    ? input.roadmap.map((item, index) => ({
        week: index + 1,
        title: typeof item?.title === 'string' ? item.title : `Week ${index + 1}`,
        action: typeof item?.action === 'string' ? item.action : fallback.roadmap[index].action,
        proof: typeof item?.proof === 'string' ? item.proof : fallback.roadmap[index].proof,
      }))
    : fallback.roadmap;
  return {
    dimensions,
    overallScore,
    evidenceStrength: strength,
    fundingStatus,
    nextProofPoint: typeof input.nextProofPoint === 'string' && input.nextProofPoint.trim() ? input.nextProofPoint.trim() : fallback.nextProofPoint,
    recommendations: Array.isArray(input.recommendations)
      ? input.recommendations.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : fallback.recommendations,
    roadmap,
  };
}

function responseTextToJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

async function scoreWithAI(stage: StageDefinition, answers: AnswerMap, fallback: Analysis): Promise<Analysis> {
  const ws = (window as any).__workspaceDb;
  if (!ws?.token) throw new Error('Workspace token unavailable');
  const answerSummary = stage.questions.map((question) => {
    const raw = answers[question.id] || '';
    const answer = question.type === 'choice' ? question.options?.[Number(raw)]?.label || 'Not answered' : raw;
    return { dimension: question.dimension, question: question.prompt, answer };
  });
  const prompt = {
    founderStage: stage.name,
    scoreName: stage.scoreName,
    weights: stage.dimensions.map(({ id, label, weight }) => ({ id, label, weight })),
    dimensions: stage.dimensions,
    answers: answerSummary,
    rules: [
      'Return valid JSON only.',
      'Score each listed dimension from 0 to 100 using only the evidence in the answers.',
      'Evidence status must be Demonstrated, Emerging, or Unproven.',
      'For Idea Stage, never penalize missing revenue, customers, MVP, pitch deck, projections or traction; these are expected later-stage items.',
      'Use encouraging, direct language. Never say the idea is weak, the founder is not fundable, or they scored poorly.',
      'Use phrases such as this assumption needs validation, evidence is currently limited, highest-priority gap, and what would strengthen your case.',
      'Provide four roadmap weeks. Make each proof item observable and stage-appropriate.',
      'Funding status must be one of the four allowed labels supplied.',
    ],
    allowedFundingStatuses: ALLOWED_FUNDING_STATUSES,
    outputShape: {
      dimensions: [{ id: 'dimension id', score: 0, evidenceStatus: 'Emerging', whyThisMatters: 'string', strengthen: ['action'], nextProofPoint: 'specific evidence', priority: 'high' }],
      evidenceStrength: 'Emerging',
      fundingStatus: 'VALIDATE THEN EXPLORE FUNDING',
      nextProofPoint: 'specific action',
      recommendations: ['stage-specific recommendation'],
      roadmap: [{ week: 1, title: 'string', action: 'string', proof: 'string' }],
    },
  };
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': ws.token },
    body: JSON.stringify({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'none',
      max_completion_tokens: 5000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are FoundarOS, an evidence-led and stage-aware fundability diagnostic. Be candid, encouraging and precise. Evaluate evidence, not founder worth.' },
        { role: 'user', content: JSON.stringify(prompt) },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error?.message || detail?.error || `AI scoring failed (${response.status})`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI scoring returned no content');
  return normalizeAnalysis(responseTextToJson(content), stage, fallback);
}

function scoreToLegacyChoiceIndex(score: number): string {
  return score >= 75 ? '0' : score >= 50 ? '1' : score >= 25 ? '2' : '3';
}

function legacyCategoryForDimension(id: string): 'idea_clarity' | 'market_validation' | 'financial_thinking' | 'fundability' {
  if (/customer|market|validation|traction|evidence/.test(id)) return 'market_validation';
  if (/financial|business_model|revenue/.test(id)) return 'financial_thinking';
  if (/funding|team|documentation|pathway|execution/.test(id)) return 'fundability';
  return 'idea_clarity';
}

function legacyPayload(stage: StageDefinition, answers: AnswerMap, analysis: Analysis) {
  const average = analysis.overallScore;
  const legacyAnswers: AnswerMap = { founder_stage: stage.id, ...answers };
  LEGACY_CHOICE_IDS.forEach((id) => { legacyAnswers[id] = scoreToLegacyChoiceIndex(average); });
  const textAnswers = stage.questions.filter((question) => question.type === 'text').map((question) => answers[question.id]).filter(Boolean);
  legacyAnswers.ic_one_liner = textAnswers[0] || `${stage.name}: venture assessment`;
  legacyAnswers.mv_first_customer = textAnswers[1] || textAnswers[0] || 'Target customer described in the stage-aware assessment.';
  legacyAnswers.fu_vision = textAnswers[textAnswers.length - 1] || stage.nextMilestone;
  const buckets: Record<string, number[]> = { idea_clarity: [], market_validation: [], financial_thinking: [], fundability: [] };
  analysis.dimensions.forEach((dimension) => buckets[legacyCategoryForDimension(dimension.id)].push(dimension.score));
  const categoryScores = Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, values.length ? clamp(values.reduce((sum, value) => sum + value, 0) / values.length) : average]));
  const topGaps = [...analysis.dimensions].sort((a, b) => a.score - b.score).slice(0, 3).map((dimension, index) => ({
    question_id: dimension.id,
    question_number: index + 1,
    title: `${dimension.label}: evidence needs strengthening`,
    category: legacyCategoryForDimension(dimension.id),
    severity: dimension.score < 35 ? 'high' : dimension.score < 65 ? 'medium' : 'low',
    score_impact: dimension.score < 35 ? 8 : dimension.score < 65 ? 5 : 3,
    action: dimension.nextProofPoint,
    answer_label: dimension.evidenceStatus,
    assessment_ref: `${stage.name} · ${dimension.label}`,
  }));
  return { legacyAnswers, categoryScores, topGaps };
}

function statusStyle(status: EvidenceStatus): string {
  if (status === 'Demonstrated') return 'border-[color-mix(in_srgb,var(--space-semantic-success)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-success)_12%,transparent)] text-[var(--space-semantic-success)]';
  if (status === 'Emerging') return 'border-[color-mix(in_srgb,var(--space-semantic-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-warning)_12%,transparent)] text-[var(--space-semantic-warning)]';
  if (status === 'Unproven') return 'border-[color-mix(in_srgb,var(--space-semantic-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger)_12%,transparent)] text-[var(--space-semantic-danger)]';
  return 'border-[var(--space-border-default)] bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]';
}

function statusDot(status: EvidenceStatus): string {
  return status === 'Demonstrated' ? '🟢' : status === 'Emerging' ? '🟡' : status === 'Unproven' ? '🔴' : '⚪';
}

function weightedScore(stage: StageDefinition, dimensions: DimensionResult[]): number {
  return clamp(dimensions.reduce((sum, item) => {
    const weight = stage.dimensions.find((dimension) => dimension.id === item.id)?.weight || 0;
    return sum + item.score * weight / 100;
  }, 0));
}

function applyReview(stage: StageDefinition, analysis: Analysis, review: FacilitatorReview): Analysis {
  const adjustments = review.adjustments || {};
  const dimensions = analysis.dimensions.map((dimension) => ({ ...dimension, ...(adjustments[dimension.id] || {}) }));
  const overallScore = weightedScore(stage, dimensions);
  return {
    ...analysis,
    dimensions,
    overallScore,
    evidenceStrength: evidenceStrength(dimensions),
    fundingStatus: classifyFunding(stage.id, overallScore, dimensions),
    nextProofPoint: [...dimensions].sort((a, b) => a.score - b.score)[0]?.nextProofPoint || analysis.nextProofPoint,
  };
}

function RadarChart({ stage, results }: { stage: StageDefinition; results: DimensionResult[] }) {
  const center = 210;
  const radius = 132;
  const count = results.length;
  const point = (index: number, scale: number) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / count);
    return [center + Math.cos(angle) * radius * scale, center + Math.sin(angle) * radius * scale];
  };
  const polygon = (scale: number) => results.map((_, index) => point(index, scale).join(',')).join(' ');
  const scorePolygon = results.map((item, index) => point(index, item.score / 100).join(',')).join(' ');
  return (
    <div className={`${tw.card.flat} p-3 sm:p-5 overflow-hidden`}>
      <svg viewBox="0 0 420 420" className="w-full max-w-[460px] mx-auto" role="img" aria-label={`${stage.name} radar chart`}>
        {[0.25, 0.5, 0.75, 1].map((scale) => <polygon key={scale} points={polygon(scale)} fill="none" stroke="var(--space-border-default)" strokeWidth="1" />)}
        {results.map((_, index) => {
          const [x, y] = point(index, 1);
          return <line key={index} x1={center} y1={center} x2={x} y2={y} stroke="var(--space-border-default)" strokeWidth="1" />;
        })}
        <polygon points={scorePolygon} fill="color-mix(in srgb, var(--space-brand-primary) 22%, transparent)" stroke="var(--space-brand-primary)" strokeWidth="3" />
        {results.map((item, index) => {
          const [x, y] = point(index, item.score / 100);
          return <circle key={item.id} cx={x} cy={y} r="4" fill="var(--space-brand-highlight)" stroke="var(--space-surface-page)" strokeWidth="2" />;
        })}
        {stage.radarLabels.map((label, index) => {
          const [x, y] = point(index, 1.28);
          return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="var(--space-text-secondary)" fontSize="10" fontWeight="600">{label.length > 20 ? `${label.slice(0, 19)}…` : label}</text>;
        })}
      </svg>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 48;
  return (
    <div className="relative w-32 h-32 shrink-0" aria-label={`Score ${score} out of 100`}>
      <svg viewBox="0 0 112 112" className="w-full h-full -rotate-90">
        <circle cx="56" cy="56" r="48" fill="none" stroke="var(--space-border-default)" strokeWidth="8" />
        <circle cx="56" cy="56" r="48" fill="none" stroke="var(--space-brand-primary)" strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${tw.typography.color.brand}`}>{score}</span>
        <span className={`text-[11px] ${tw.typography.color.muted}`}>out of 100</span>
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return <div className="min-h-full flex flex-col items-center justify-center gap-3 py-16"><Loader2 className={`w-8 h-8 animate-spin ${tw.icon.primary}`} /><p className={`text-sm ${tw.typography.color.secondary}`}>{label}</p></div>;
}

export default function StageDiagnostic({ paidAccess, upgradeSlot, onOpenBoard }: Props) {
  const { userRole } = useSpaceRuntime();
  const canFacilitate = userRole === 'facilitator' || userRole === 'admin';
  const { data: sessionRows, loading, refresh } = (window as any).useWorkspaceDB('assessment_sessions', {
    orderBy: { column: 'created_at', direction: 'desc' },
    limit: 20,
  }) as { data: SessionRow[]; loading: boolean; refresh: () => void };
  const [phase, setPhase] = useState<Phase>('stage');
  const [selectedStage, setSelectedStage] = useState<FounderStage | null>(null);
  const [rowId, setRowId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [index, setIndex] = useState(0);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [review, setReview] = useState<FacilitatorReview>({ adjustments: {} });
  const [internalNotes, setInternalNotes] = useState('');
  const [observations, setObservations] = useState('');
  const [founderVisible, setFounderVisible] = useState(false);
  const [founderVisibleNotes, setFounderVisibleNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const initialized = useRef(false);

  const stage = stageById(selectedStage);
  const effectiveAnalysis = useMemo(() => stage && analysis ? applyReview(stage, analysis, review) : analysis, [stage, analysis, review]);

  useEffect(() => {
    if (loading || initialized.current) return;
    initialized.current = true;
    const latest = (sessionRows || []).find((row) => row.assessment_version === ASSESSMENT_VERSION && row.founder_stage);
    if (!latest) return;
    const selected = latest.founder_stage || null;
    setSelectedStage(selected);
    setRowId(latest.id);
    setAnswers(parseJson<AnswerMap>(latest.answers, {}));
    setIndex(Math.max(0, latest.current_index || 0));
    setInternalNotes(latest.facilitator_notes || '');
    setFounderVisibleNotes(latest.founder_visible_notes || '');
    const storedReview = parseJson<FacilitatorReview>(latest.facilitator_adjustments, { adjustments: {} });
    setReview(storedReview);
    setObservations(storedReview.observations || '');
    setFounderVisible(storedReview.founderVisible === true);
    const selectedDefinition = stageById(selected);
    if (latest.status === 'completed' && selectedDefinition) {
      const storedDimensions = parseJson<DimensionResult[]>(latest.dimension_scores, []);
      const ai = parseJson<Partial<Analysis>>(latest.ai_explanations, {});
      const fallback = deterministicAnalysis(selectedDefinition, parseJson<AnswerMap>(latest.answers, {}));
      setAnalysis(normalizeAnalysis({
        ...ai,
        dimensions: storedDimensions.length ? storedDimensions : ai.dimensions,
        fundingStatus: latest.funding_status || ai.fundingStatus,
        roadmap: parseJson<RoadmapItem[]>(latest.roadmap, ai.roadmap || []),
      }, selectedDefinition, fallback));
      setPhase('report');
    } else {
      setPhase('questions');
    }
  }, [loading, sessionRows]);

  const beginAssessment = async () => {
    if (!stage || saving) return;
    setSaving(true);
    const initialAnswers: AnswerMap = { founder_stage: stage.id };
    try {
      await (window as any).__workspaceDb.from('assessment_sessions').insert({
        status: 'in_progress',
        current_index: 0,
        answers: initialAnswers,
        founder_stage: stage.id,
        assessment_version: ASSESSMENT_VERSION,
      });
      const result = await (window as any).__workspaceDb.from('assessment_sessions').orderBy('created_at', 'desc').limit(1).get();
      setRowId(typeof result?.data?.[0]?.id === 'number' ? result.data[0].id : null);
    } catch {
      setRowId(null);
    } finally {
      setAnswers(initialAnswers);
      setIndex(0);
      setAnalysis(null);
      setReview({ adjustments: {} });
      setPhase('questions');
      setSaving(false);
    }
  };

  const persistProgress = async (nextAnswers: AnswerMap, nextIndex: number) => {
    if (!rowId) return;
    try {
      await (window as any).__workspaceDb.from('assessment_sessions').update(rowId, { answers: nextAnswers, current_index: nextIndex });
    } catch { /* keep the in-memory assessment available */ }
  };

  const answerQuestion = (questionId: string, value: string) => {
    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    if (stage?.questions[index]?.type === 'choice') void persistProgress(next, index);
  };

  const completeAssessment = async () => {
    if (!stage || saving) return;
    setSaving(true);
    setPhase('scoring');
    const fallback = deterministicAnalysis(stage, answers);
    let scored = fallback;
    try {
      scored = await scoreWithAI(stage, answers, fallback);
      setAiNotice(null);
    } catch (error) {
      console.warn('[GapRadar] AI scoring unavailable; using evidence rubric.', error);
      setAiNotice('Your report was completed with the FoundarOS evidence rubric because AI scoring was temporarily unavailable. You can retake later for refreshed narrative guidance.');
    }
    const legacy = legacyPayload(stage, answers, scored);
    const evidenceStatuses = Object.fromEntries(scored.dimensions.map((item) => [item.id, item.evidenceStatus]));
    const completedAt = new Date().toISOString();
    try {
      if (rowId) {
        await (window as any).__workspaceDb.from('assessment_sessions').update(rowId, {
          status: 'completed',
          current_index: stage.questions.length,
          answers: legacy.legacyAnswers,
          overall_score: scored.overallScore,
          category_scores: legacy.categoryScores,
          top_gaps: legacy.topGaps,
          completed_at: completedAt,
          founder_stage: stage.id,
          dimension_scores: scored.dimensions,
          evidence_statuses: evidenceStatuses,
          ai_explanations: scored,
          funding_status: scored.fundingStatus,
          roadmap: scored.roadmap,
          assessment_version: ASSESSMENT_VERSION,
        });
      }
    } catch { /* keep the complete report in memory */ }
    setAnswers(legacy.legacyAnswers);
    setAnalysis(scored);
    setPhase('report');
    setSaving(false);
    refresh();
  };

  const nextQuestion = async () => {
    if (!stage) return;
    const nextIndex = index + 1;
    await persistProgress(answers, nextIndex);
    if (nextIndex >= stage.questions.length) await completeAssessment();
    else setIndex(nextIndex);
  };

  const updateAdjustment = (dimensionId: string, patch: FacilitatorAdjustment) => {
    setReview((current) => ({
      ...current,
      adjustments: {
        ...(current.adjustments || {}),
        [dimensionId]: { ...(current.adjustments?.[dimensionId] || {}), ...patch },
      },
    }));
    setReviewSaved(false);
  };

  const saveFacilitatorReview = async () => {
    if (!rowId || !stage || !analysis || !effectiveAnalysis) return;
    setReviewSaving(true);
    const reviewedAt = new Date().toISOString();
    const nextReview: FacilitatorReview = { ...review, confirmed: true, observations, founderVisible, reviewedAt };
    const legacy = legacyPayload(stage, answers, effectiveAnalysis);
    try {
      await (window as any).__workspaceDb.from('assessment_sessions').update(rowId, {
        overall_score: effectiveAnalysis.overallScore,
        category_scores: legacy.categoryScores,
        top_gaps: legacy.topGaps,
        dimension_scores: effectiveAnalysis.dimensions,
        evidence_statuses: Object.fromEntries(effectiveAnalysis.dimensions.map((item) => [item.id, item.evidenceStatus])),
        funding_status: effectiveAnalysis.fundingStatus,
        facilitator_adjustments: nextReview,
        facilitator_notes: internalNotes,
        founder_visible_notes: founderVisible ? observations : null,
        reviewed_at: reviewedAt,
      });
      setReview(nextReview);
      setFounderVisibleNotes(founderVisible ? observations : '');
      setReviewSaved(true);
      refresh();
    } finally {
      setReviewSaving(false);
    }
  };

  const restart = () => {
    setSelectedStage(null);
    setRowId(null);
    setAnswers({});
    setIndex(0);
    setAnalysis(null);
    setReview({ adjustments: {} });
    setInternalNotes('');
    setObservations('');
    setFounderVisible(false);
    setFounderVisibleNotes('');
    setPhase('stage');
  };

  if (loading) return <LoadingState label="Loading your Gap Radar…" />;

  if (phase === 'stage') {
    return (
      <main className="min-h-full overflow-y-auto px-4 py-7 sm:px-6 sm:py-10">
        <div className="max-w-5xl mx-auto">
          <div className="max-w-3xl mx-auto text-center mb-7">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--space-surface-accent-soft)] flex items-center justify-center"><Route className={`w-7 h-7 ${tw.icon.primary}`} /></div>
            <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${tw.typography.color.accent}`}>Stage-aware Gap Radar</p>
            <h1 className={`mt-2 text-2xl sm:text-3xl font-bold ${tw.typography.color.brand}`}>Where are you currently on your founder journey?</h1>
            <p className={`mt-3 text-sm sm:text-base leading-6 ${tw.typography.color.secondary}`}>{questionBank.positioning}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {STAGES.map((option) => {
              const selected = selectedStage === option.id;
              return (
                <button key={option.id} type="button" onClick={() => setSelectedStage(option.id)} className={`text-left p-5 rounded-2xl border transition-all ${selected ? 'border-[var(--space-brand-primary)] bg-[var(--space-surface-accent-soft)] shadow-lg' : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] hover:border-[var(--space-border-strong)] hover:bg-[var(--space-surface-card-hover)]'}`} aria-pressed={selected}>
                  <div className="flex items-start gap-3">
                    <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center font-bold ${selected ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)]' : 'bg-[var(--space-surface-muted)] text-[var(--space-text-brand)]'}`}>{option.letter}</span>
                    <span><span className={`block text-sm font-bold tracking-wide ${tw.typography.color.primary}`}>{option.name}</span><span className={`block mt-1 text-sm leading-6 ${tw.typography.color.secondary}`}>{option.description}</span></span>
                    {selected && <CheckCircle2 className="ml-auto w-5 h-5 text-[var(--space-brand-primary)] shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex flex-col items-center gap-2">
            <button type="button" onClick={beginAssessment} disabled={!selectedStage || saving} className={`px-6 py-3 rounded-xl inline-flex items-center gap-2 ${tw.button.primary} disabled:opacity-40`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Continue with this stage
            </button>
            <p className={`text-xs ${tw.typography.color.muted}`}>You can change your selection until you continue.</p>
          </div>
        </div>
      </main>
    );
  }

  if (phase === 'scoring') {
    return (
      <main className="min-h-full flex items-center justify-center px-4 py-12">
        <div className={`${tw.card.elevated} border border-[var(--space-border-default)] max-w-lg w-full p-7 text-center`}>
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--space-surface-accent-soft)] flex items-center justify-center"><Sparkles className={`w-7 h-7 animate-pulse ${tw.icon.primary}`} /></div>
          <h2 className={`mt-4 text-xl font-bold ${tw.typography.color.brand}`}>Turning your answers into evidence</h2>
          <p className={`mt-2 text-sm leading-6 ${tw.typography.color.secondary}`}>FoundarOS is scoring the dimensions that matter at your stage and building your next-proof roadmap.</p>
          <div className="mt-5 h-1.5 rounded-full overflow-hidden bg-[var(--space-border-default)]"><div className="h-full w-2/3 rounded-full bg-[var(--space-brand-primary)] animate-pulse" /></div>
        </div>
      </main>
    );
  }

  if (phase === 'questions' && stage) {
    const question = stage.questions[Math.min(index, stage.questions.length - 1)];
    const dimension = stage.dimensions.find((item) => item.id === question.dimension)!;
    const answer = answers[question.id] || '';
    const valid = question.type === 'choice' ? answer !== '' : answer.trim().length >= 8;
    return (
      <main className="min-h-full overflow-y-auto px-4 py-6 sm:px-6 sm:py-9">
        <div className="max-w-3xl mx-auto">
          <div className="mb-5">
            <div className="flex flex-wrap justify-between gap-2 mb-2"><span className={`text-xs font-semibold ${tw.typography.color.secondary}`}>{stage.name} · {dimension.label}</span><span className={`text-xs ${tw.typography.color.muted}`}>Question {index + 1} of {stage.questions.length}</span></div>
            <div className="h-1.5 rounded-full overflow-hidden bg-[var(--space-border-default)]"><div className="h-full rounded-full bg-[var(--space-brand-primary)] transition-all" style={{ width: `${((index + 1) / stage.questions.length) * 100}%` }} /></div>
          </div>
          <section className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5 sm:p-8`}>
            <div className="flex items-center justify-between gap-3 mb-4"><span className={`${tw.badge.default} ${tw.badge.primary}`}>{dimension.weight}% of {stage.scoreName}</span><span className={`text-xs ${tw.typography.color.muted}`}>{stage.journey}</span></div>
            <h1 className={`text-xl sm:text-2xl font-bold leading-tight ${tw.typography.color.primary}`}>{question.prompt}</h1>
            {question.help && <p className={`mt-2 text-sm leading-6 ${tw.typography.color.secondary}`}>{question.help}</p>}
            <div className="mt-6">
              {question.type === 'choice' ? (
                <div className="space-y-2" role="radiogroup" aria-label={question.prompt}>
                  {question.options?.map((option, optionIndex) => {
                    const checked = answer === String(optionIndex);
                    return <button key={option.label} type="button" role="radio" aria-checked={checked} onClick={() => answerQuestion(question.id, String(optionIndex))} className={`w-full text-left px-4 py-3 rounded-xl border flex items-start gap-3 transition-all ${checked ? 'border-[var(--space-brand-primary)] bg-[var(--space-surface-accent-soft)] text-[var(--space-text-primary)]' : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)] text-[var(--space-text-secondary)] hover:border-[var(--space-border-strong)]'}`}><span className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${checked ? 'border-[var(--space-brand-primary)]' : 'border-[var(--space-border-strong)]'}`}>{checked && <span className="w-2 h-2 rounded-full bg-[var(--space-brand-primary)]" />}</span><span className="text-sm leading-6">{option.label}</span></button>;
                  })}
                </div>
              ) : (
                <><textarea value={answer} onChange={(event) => answerQuestion(question.id, event.target.value)} rows={7} autoFocus placeholder="Share the clearest evidence you have today. It is okay if some of it is still an assumption." className={`${tw.input.base} ${tw.input.default} resize-y text-sm leading-6`} /><div className="mt-2 flex justify-between"><span className={`text-xs ${tw.typography.color.muted}`}>Specific examples create a more useful report.</span><span className={`text-xs ${answer.trim().length >= 8 ? tw.typography.color.success : tw.typography.color.muted}`}>{answer.trim().length} characters</span></div></>
              )}
            </div>
          </section>
          <div className="mt-5 flex justify-between gap-3">
            <button type="button" onClick={() => { if (index === 0) setPhase('stage'); else setIndex(index - 1); }} className={`px-4 py-2.5 rounded-xl inline-flex items-center gap-2 ${tw.button.ghost}`}><ArrowLeft className="w-4 h-4" />{index === 0 ? 'Change stage' : 'Back'}</button>
            <button type="button" onClick={nextQuestion} disabled={!valid || saving} className={`px-5 py-2.5 rounded-xl inline-flex items-center gap-2 ${tw.button.primary} disabled:opacity-40`}>{index === stage.questions.length - 1 ? 'Build my report' : 'Next'}<ArrowRight className="w-4 h-4" /></button>
          </div>
        </div>
      </main>
    );
  }

  if (!stage || !effectiveAnalysis) return <LoadingState label="Preparing your stage-aware report…" />;

  const strongest = [...effectiveAnalysis.dimensions].sort((a, b) => b.score - a.score)[0];
  const weakest = [...effectiveAnalysis.dimensions].sort((a, b) => a.score - b.score)[0];

  return (
    <main className="min-h-full overflow-y-auto bg-transparent">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-9 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className={`text-xs font-semibold uppercase tracking-[0.18em] ${tw.typography.color.accent}`}>{stage.journey}</p><h1 className={`mt-1 text-2xl sm:text-3xl font-bold ${tw.typography.color.brand}`}>Your stage-aware fundability report</h1></div>
          <div className="flex flex-wrap gap-2">{paidAccess && onOpenBoard && <button type="button" onClick={onOpenBoard} className={`px-3.5 py-2 rounded-lg text-xs inline-flex items-center gap-1.5 ${tw.button.secondary}`}><Target className="w-3.5 h-3.5" />Open gap board</button>}<button type="button" onClick={restart} className={`px-3.5 py-2 rounded-lg text-xs inline-flex items-center gap-1.5 ${tw.button.ghost}`}><RefreshCw className="w-3.5 h-3.5" />Retake assessment</button></div>
        </div>

        {aiNotice && <div className="rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-warning)_10%,transparent)] p-4 text-sm text-[var(--space-text-secondary)]">{aiNotice}</div>}

        <section className={`${tw.card.elevated} border border-[var(--space-border-default)] overflow-hidden`}>
          <div className="p-5 sm:p-7 border-b border-[var(--space-border-default)] bg-[var(--space-surface-accent-soft)]">
            <div className="flex flex-col lg:flex-row gap-6 lg:items-center">
              <ScoreRing score={effectiveAnalysis.overallScore} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-2 mb-3"><span className={`${tw.badge.default} ${tw.badge.primary}`}>Founder Stage: {stage.name}</span><span className={`${tw.badge.default} ${tw.badge.neutral}`}>{effectiveAnalysis.evidenceStrength} evidence</span>{review.confirmed && <span className={`${tw.badge.default} ${tw.badge.success} inline-flex items-center gap-1`}><ShieldCheck className="w-3 h-3" />Facilitator reviewed</span>}</div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.muted}`}>Fundability Status</p>
                <h2 className={`mt-1 text-xl sm:text-2xl font-bold ${tw.typography.color.primary}`}>{effectiveAnalysis.fundingStatus}</h2>
                <p className={`mt-2 text-sm ${tw.typography.color.secondary}`}><span className="font-semibold">{stage.scoreName}:</span> {effectiveAnalysis.overallScore}/100</p>
                <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
                  <div className={`${tw.card.flat} p-3`}><span className={`block text-xs ${tw.typography.color.muted}`}>Your strongest area</span><span className={`font-semibold ${tw.typography.color.primary}`}>{strongest.label} — {strongest.score}</span></div>
                  <div className={`${tw.card.flat} p-3`}><span className={`block text-xs ${tw.typography.color.muted}`}>Your highest-priority gap</span><span className={`font-semibold ${tw.typography.color.primary}`}>{weakest.label} — {weakest.score}</span></div>
                  <div className={`${tw.card.flat} p-3 sm:col-span-2`}><span className={`block text-xs ${tw.typography.color.muted}`}>Your next proof point</span><span className={`font-medium ${tw.typography.color.primary}`}>{effectiveAnalysis.nextProofPoint}</span></div>
                  <div className={`${tw.card.flat} p-3 sm:col-span-2`}><span className={`block text-xs ${tw.typography.color.muted}`}>Your next milestone</span><span className={`font-medium ${tw.typography.color.primary}`}>{stage.nextMilestone}</span></div>
                </div>
              </div>
            </div>
          </div>
          <div className="p-4 sm:px-7 text-xs leading-5 text-[var(--space-text-muted)]">Your FoundarOS score is a diagnostic of your current funding readiness and evidence. It is not a prediction or guarantee of funding.</div>
        </section>

        <section className="grid lg:grid-cols-[1.05fr_0.95fr] gap-5">
          <RadarChart stage={stage} results={effectiveAnalysis.dimensions} />
          <div className={`${tw.card.default} p-5 sm:p-6`}>
            <div className="flex items-center gap-2"><Gauge className={`w-5 h-5 ${tw.icon.primary}`} /><h2 className={`text-lg font-bold ${tw.typography.color.primary}`}>What your evidence indicates</h2></div>
            <p className={`mt-3 text-sm leading-6 ${tw.typography.color.secondary}`}>{stage.focusMessage}</p>
            <div className="mt-5 space-y-3">{effectiveAnalysis.recommendations.map((recommendation, index) => <div key={`${recommendation}-${index}`} className="flex gap-3"><span className="w-6 h-6 shrink-0 rounded-full bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)] flex items-center justify-center text-xs font-bold">{index + 1}</span><p className={`text-sm leading-6 ${tw.typography.color.secondary}`}>{recommendation}</p></div>)}</div>
            {founderVisibleNotes && <div className="mt-5 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] p-4"><p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.muted}`}>Facilitator observation</p><p className={`mt-2 text-sm leading-6 ${tw.typography.color.secondary}`}>{founderVisibleNotes}</p></div>}
          </div>
        </section>

        {stage.notYetApplicable.length > 0 && (
          <section className={`${tw.card.default} p-5 sm:p-6`}>
            <div className="flex items-center gap-2"><Eye className={`w-5 h-5 ${tw.icon.neutral}`} /><h2 className={`text-base font-bold ${tw.typography.color.primary}`}>Evidence still needed later — not scored now</h2></div>
            <p className={`mt-2 text-sm ${tw.typography.color.secondary}`}>These are expected gaps at {stage.name.toLowerCase()}. They are marked Not Yet Applicable and do not reduce your score.</p>
            <div className="mt-4 flex flex-wrap gap-2">{stage.notYetApplicable.map((item) => <span key={item} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${statusStyle('Not Yet Applicable')}`}>⚪ {item} · Not Yet Applicable</span>)}</div>
          </section>
        )}

        <section>
          <div className="flex items-center gap-2 mb-4"><BarChart3 className={`w-5 h-5 ${tw.icon.primary}`} /><h2 className={`text-xl font-bold ${tw.typography.color.primary}`}>Dimension breakdown</h2></div>
          <div className="space-y-3">
            {effectiveAnalysis.dimensions.map((dimension) => (
              <details key={dimension.id} className={`${tw.card.default} group overflow-hidden`} open={dimension.id === weakest.id}>
                <summary className="list-none cursor-pointer p-4 sm:p-5 flex flex-wrap items-center gap-3">
                  <div className="min-w-[180px] flex-1"><p className={`font-semibold ${tw.typography.color.primary}`}>{dimension.label}</p><p className={`mt-1 text-xs ${tw.typography.color.muted}`}>Weight: {stage.dimensions.find((item) => item.id === dimension.id)?.weight}%</p></div>
                  <div className="w-28"><div className="flex justify-between text-xs mb-1"><span className={tw.typography.color.muted}>Score</span><span className={`font-bold ${tw.typography.color.primary}`}>{dimension.score}/100</span></div><div className="h-1.5 rounded-full overflow-hidden bg-[var(--space-border-default)]"><div className="h-full rounded-full bg-[var(--space-brand-primary)]" style={{ width: `${dimension.score}%` }} /></div></div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyle(dimension.evidenceStatus)}`}>{statusDot(dimension.evidenceStatus)} {dimension.evidenceStatus}</span>
                  <ChevronDown className={`w-4 h-4 transition-transform group-open:rotate-180 ${tw.icon.muted}`} />
                </summary>
                <div className="border-t border-[var(--space-border-default)] p-4 sm:p-5 grid md:grid-cols-2 gap-5 bg-[var(--space-surface-muted)]">
                  <div><h3 className={`text-sm font-semibold ${tw.typography.color.primary}`}>Why This Matters</h3><p className={`mt-2 text-sm leading-6 ${tw.typography.color.secondary}`}>{dimension.whyThisMatters}</p>{dimension.score < 70 && <p className={`mt-2 text-sm leading-6 ${tw.typography.color.secondary}`}>Your current evidence indicates this assumption needs more validation. This gap may weaken your funding case, but it is specific and testable.</p>}</div>
                  <div><h3 className={`text-sm font-semibold ${tw.typography.color.primary}`}>What would strengthen this?</h3><ul className="mt-2 space-y-2">{dimension.strengthen.map((item) => <li key={item} className={`flex gap-2 text-sm ${tw.typography.color.secondary}`}><Check className="w-4 h-4 mt-0.5 shrink-0 text-[var(--space-brand-highlight)]" />{item}</li>)}</ul></div>
                  <div className="md:col-span-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4"><p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.muted}`}>Next Proof Point</p><p className={`mt-1 text-sm font-medium ${tw.typography.color.primary}`}>{dimension.nextProofPoint}</p></div>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className={`${tw.card.elevated} border border-[var(--space-border-default)] p-5 sm:p-7`}>
          <div className="flex items-center gap-2"><ClipboardCheck className={`w-5 h-5 ${tw.icon.primary}`} /><h2 className={`text-xl font-bold ${tw.typography.color.primary}`}>Your 30-Day Next Step Roadmap</h2></div>
          <div className="mt-5 grid md:grid-cols-2 gap-3">{effectiveAnalysis.roadmap.map((item) => <div key={item.week} className={`${tw.card.flat} p-4`}><div className="flex items-center gap-2"><span className="w-8 h-8 rounded-xl bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] flex items-center justify-center text-xs font-bold">W{item.week}</span><h3 className={`font-semibold ${tw.typography.color.primary}`}>{item.title}</h3></div><p className={`mt-3 text-sm leading-6 ${tw.typography.color.secondary}`}>{item.action}</p><div className="mt-3 pt-3 border-t border-[var(--space-border-default)]"><p className={`text-xs font-semibold ${tw.typography.color.muted}`}>Proof to capture</p><p className={`mt-1 text-xs leading-5 ${tw.typography.color.secondary}`}>{item.proof}</p></div></div>)}</div>
        </section>

        {canFacilitate && (
          <section className="rounded-2xl border border-[color-mix(in_srgb,var(--space-brand-highlight)_40%,transparent)] bg-[color-mix(in_srgb,var(--space-brand-highlight)_7%,var(--space-surface-card))] overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-[var(--space-border-default)] flex items-start gap-3"><div className="w-10 h-10 rounded-xl bg-[var(--space-surface-accent-soft)] flex items-center justify-center"><LockKeyhole className={`w-5 h-5 ${tw.icon.primary}`} /></div><div><p className={`text-xs font-semibold uppercase tracking-[0.16em] ${tw.typography.color.accent}`}>Internal only</p><h2 className={`mt-1 text-xl font-bold ${tw.typography.color.primary}`}>Facilitator Review</h2><p className={`mt-1 text-sm ${tw.typography.color.secondary}`}>Confirm the assessment or adjust scores, evidence and gap priority. Internal notes never appear in the founder report.</p></div></div>
            <div className="p-5 sm:p-6 space-y-4">
              {effectiveAnalysis.dimensions.map((dimension) => {
                const base = analysis?.dimensions.find((item) => item.id === dimension.id)!;
                return <div key={dimension.id} className={`${tw.card.flat} p-4 grid lg:grid-cols-[1fr_150px_180px_140px] gap-3 items-end`}><div><p className={`text-sm font-semibold ${tw.typography.color.primary}`}>{dimension.label}</p><p className={`text-xs ${tw.typography.color.muted}`}>AI: {base.score}/100 · {base.evidenceStatus}</p></div><label className={`text-xs ${tw.typography.color.secondary}`}>Adjusted score<input type="number" min={0} max={100} value={dimension.score} onChange={(event) => updateAdjustment(dimension.id, { score: clamp(Number(event.target.value)) })} className={`${tw.input.base} ${tw.input.default} mt-1 py-2 text-sm`} /></label><label className={`text-xs ${tw.typography.color.secondary}`}>Evidence status<select value={dimension.evidenceStatus} onChange={(event) => updateAdjustment(dimension.id, { evidenceStatus: event.target.value as EvidenceStatus })} className={`${tw.input.base} ${tw.input.default} mt-1 py-2 text-sm`}><option>Demonstrated</option><option>Emerging</option><option>Unproven</option><option>Not Yet Applicable</option></select></label><label className={`text-xs ${tw.typography.color.secondary}`}>Gap priority<select value={dimension.priority} onChange={(event) => updateAdjustment(dimension.id, { priority: event.target.value as DimensionResult['priority'] })} className={`${tw.input.base} ${tw.input.default} mt-1 py-2 text-sm`}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div>;
              })}
              <div className="grid md:grid-cols-2 gap-4"><label className={`text-sm font-medium ${tw.typography.color.primary}`}>Internal notes<textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} rows={5} placeholder="Private context, concerns or follow-up notes…" className={`${tw.input.base} ${tw.input.default} mt-2 resize-y text-sm`} /><span className={`block mt-1 text-xs ${tw.typography.color.muted}`}>Never shown to the founder.</span></label><label className={`text-sm font-medium ${tw.typography.color.primary}`}>Founder-specific observations<textarea value={observations} onChange={(event) => setObservations(event.target.value)} rows={5} placeholder="Add context tailored to this founder…" className={`${tw.input.base} ${tw.input.default} mt-2 resize-y text-sm`} /><span className="mt-2 flex items-center gap-2"><input type="checkbox" checked={founderVisible} onChange={(event) => setFounderVisible(event.target.checked)} className="rounded border-[var(--space-border-strong)]" /><span className={`text-xs ${tw.typography.color.secondary}`}>Show these observations in the founder report</span></span></label></div>
              <div className="flex flex-wrap items-center justify-between gap-3"><p className={`text-xs ${tw.typography.color.muted}`}>Reviewed score: {effectiveAnalysis.overallScore}/100 · {effectiveAnalysis.fundingStatus}</p><button type="button" onClick={saveFacilitatorReview} disabled={reviewSaving} className={`px-5 py-2.5 rounded-xl inline-flex items-center gap-2 ${tw.button.accent} disabled:opacity-50`}>{reviewSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : reviewSaved ? <CheckCircle2 className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}{reviewSaved ? 'Review saved' : 'Confirm reviewed assessment'}</button></div>
            </div>
          </section>
        )}

        <section>{upgradeSlot}</section>
        <footer className={`pb-5 text-center text-xs ${tw.typography.color.muted}`}>FoundarOS measures the evidence your venture has today — and helps you decide what to prove next.</footer>
      </div>
    </main>
  );
}
