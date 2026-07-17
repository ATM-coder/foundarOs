/* ============================================================================
 * Funding Readiness assessment — question bank + deterministic scoring.
 *
 * 30 questions across the 4 gap-board categories (8 + 8 + 7 + 7).
 * 27 are structured multiple-choice (each option scores 0–3) so the 0–100
 * score is fully deterministic; 3 are free-text reflection questions that
 * are stored but never scored.
 * ========================================================================== */

export type CategoryId = 'idea_clarity' | 'market_validation' | 'financial_thinking' | 'fundability';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface ChoiceOption {
  label: string;
  score: 0 | 1 | 2 | 3;
}

export interface Question {
  id: string;
  category: CategoryId;
  text: string;
  /** One-sentence note explaining why investors care about this question. */
  why: string;
  type: 'choice' | 'text';
  options?: ChoiceOption[];
  placeholder?: string;
  /** Gap-board title used when a weak answer to this question becomes a gap. */
  gapTitle?: string;
  /** Specific recommended action shown for that gap. */
  gapAction?: string;
}

/** questionId -> answer. Choice answers store the option index as a string; text answers store the raw text. */
export type AnswerMap = Record<string, string>;

export interface TopGap {
  question_id: string;
  question_number: number;
  title: string;
  category: CategoryId;
  severity: Severity;
  score_impact: number;
  action: string;
  answer_label: string;
  assessment_ref: string;
}

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  idea_clarity: 'Idea Clarity',
  market_validation: 'Market Validation',
  financial_thinking: 'Financial Thinking',
  fundability: 'Fundability',
};

const MAX_OPTION_SCORE = 3;

export const QUESTIONS: Question[] = [
  /* ------------------------------- IDEA CLARITY (8) ------------------------------ */
  {
    id: 'ic_one_liner',
    category: 'idea_clarity',
    text: 'Describe your business idea in one sentence.',
    why: 'Investors hear hundreds of pitches — a crisp one-liner is what they remember and repeat.',
    type: 'text',
    placeholder: 'We help [who] do [what] by [how]…',
  },
  {
    id: 'ic_problem',
    category: 'idea_clarity',
    text: 'How clearly can you state the problem your idea solves?',
    why: 'Investors fund painkillers, not vitamins — a sharply defined problem is your first proof.',
    type: 'choice',
    options: [
      { label: "In one crisp sentence — I've said it many times", score: 3 },
      { label: 'I can explain it, but it takes a couple of minutes', score: 2 },
      { label: "It's more of a feeling than a defined problem", score: 1 },
      { label: "I haven't really defined the problem yet", score: 0 },
    ],
    gapTitle: "Problem statement isn't sharp yet",
    gapAction: "Write a one-sentence problem statement and test it on 5 people this week — if they nod immediately, you've got it.",
  },
  {
    id: 'ic_customer',
    category: 'idea_clarity',
    text: 'Who specifically has this problem?',
    why: "'Everyone' is not a target market — investors want to see a specific first customer.",
    type: 'choice',
    options: [
      { label: 'A specific person I can describe in detail (role, habits, budget)', score: 3 },
      { label: "A general group, like 'small business owners'", score: 2 },
      { label: 'Honestly, almost everyone', score: 1 },
      { label: "I'm not sure yet", score: 0 },
    ],
    gapTitle: 'Target customer is too broad',
    gapAction: 'Define one narrow beachhead customer profile — name the role, the situation they are in, and the budget they control.',
  },
  {
    id: 'ic_different',
    category: 'idea_clarity',
    text: "What makes your approach different from what's already out there?",
    why: "Differentiation is what stops an investor asking 'why won't the incumbent just do this?'",
    type: 'choice',
    options: [
      { label: 'A clear edge I can name — unique insight, tech, or access', score: 3 },
      { label: 'A meaningfully better version of what exists', score: 2 },
      { label: 'Mostly the same, but cheaper or friendlier', score: 1 },
      { label: "I don't actually know what's out there", score: 0 },
    ],
    gapTitle: "Differentiation isn't clear",
    gapAction: "List your top 3 alternatives and write one sentence on why a customer would switch to you — that's your wedge.",
  },
  {
    id: 'ic_simple',
    category: 'idea_clarity',
    text: 'Could you explain your idea to a 10-year-old?',
    why: 'Simple explanations signal deep understanding — complexity usually hides fuzziness.',
    type: 'choice',
    options: [
      { label: "Yes — I've done it and they got it instantly", score: 3 },
      { label: 'Probably, with a bit of effort', score: 2 },
      { label: 'It would take diagrams and a while', score: 1 },
      { label: "No — it's genuinely too complex right now", score: 0 },
    ],
    gapTitle: 'The idea is hard to explain simply',
    gapAction: 'Rewrite your pitch using only words a 10-year-old knows, then test it out loud on someone outside your industry.',
  },
  {
    id: 'ic_stage',
    category: 'idea_clarity',
    text: 'What stage is your idea at?',
    why: 'Stage sets the bar — investors match the proof they expect to where you are.',
    type: 'choice',
    options: [
      { label: 'Launched, with real users or customers', score: 3 },
      { label: 'A working prototype or pilot', score: 2 },
      { label: 'A detailed plan, nothing built yet', score: 1 },
      { label: 'An idea in my head', score: 0 },
    ],
    gapTitle: 'Idea is still pre-prototype',
    gapAction: 'Ship the smallest possible version — a landing page, mockup, or manual pilot — within 30 days to start generating real evidence.',
  },
  {
    id: 'ic_founder',
    category: 'idea_clarity',
    text: 'Why are you the right person to build this?',
    why: 'Founder–market fit is one of the first things investors evaluate — your story is part of the pitch.',
    type: 'choice',
    options: [
      { label: "I've lived this problem and have the skills to solve it", score: 3 },
      { label: "I have relevant skills, but I'm new to this space", score: 2 },
      { label: "I'm passionate and learning as I go", score: 1 },
      { label: "I haven't thought about it", score: 0 },
    ],
    gapTitle: 'Founder story needs work',
    gapAction: 'Write your 30-second founder story: the moment you met this problem, and the unfair advantage you bring to solving it.',
  },
  {
    id: 'ic_whynow',
    category: 'idea_clarity',
    text: 'Why is now the right time for this idea?',
    why: "'Why now?' is a favorite investor question — the best answers name a recent shift.",
    type: 'choice',
    options: [
      { label: 'A clear recent change makes this possible or urgent now', score: 3 },
      { label: "Timing helps, but it isn't the core of the story", score: 2 },
      { label: 'It could have been built years ago', score: 1 },
      { label: "I haven't considered timing", score: 0 },
    ],
    gapTitle: "No clear 'why now' answer",
    gapAction: 'Identify one recent shift (technology, regulation, behavior) that makes this idea newly possible — and build it into your pitch.',
  },

  /* ---------------------------- MARKET VALIDATION (8) ---------------------------- */
  {
    id: 'mv_interviews',
    category: 'market_validation',
    text: 'Have you spoken to potential customers about this?',
    why: "Nothing builds investor confidence faster than evidence you've talked to real customers.",
    type: 'choice',
    options: [
      { label: 'Yes — 10 or more real conversations', score: 3 },
      { label: 'Yes — a handful', score: 2 },
      { label: 'Only friends and family', score: 1 },
      { label: 'Not yet', score: 0 },
    ],
    gapTitle: 'No real customer interviews yet',
    gapAction: 'Book 10 conversations with people who match your target customer — ask about their problem, not your solution.',
  },
  {
    id: 'mv_size',
    category: 'market_validation',
    text: 'How many people or businesses do you think need this?',
    why: "Investors need the market to be big enough to matter — show them you've done the math.",
    type: 'choice',
    options: [
      { label: "I've sized it with real numbers (TAM/SAM style)", score: 3 },
      { label: 'I have a rough estimate from research', score: 2 },
      { label: "It feels big, but I haven't checked", score: 1 },
      { label: 'I have no idea', score: 0 },
    ],
    gapTitle: 'Market size is unquantified',
    gapAction: 'Spend one afternoon sizing your market bottom-up: number of target customers × what each would pay per year.',
  },
  {
    id: 'mv_competitors',
    category: 'market_validation',
    text: 'Who are your competitors?',
    why: "'We have no competitors' usually means no market — investors want you to know the landscape cold.",
    type: 'choice',
    options: [
      { label: 'I can name them and their weaknesses', score: 3 },
      { label: 'I know a few names', score: 2 },
      { label: "I don't think I have competitors", score: 1 },
      { label: "I haven't looked yet", score: 0 },
    ],
    gapTitle: 'Competitive landscape unknown',
    gapAction: 'Build a simple table of your top 5 competitors/alternatives: what they charge, who they serve, and where they fall short.',
  },
  {
    id: 'mv_statusquo',
    category: 'market_validation',
    text: 'How do people solve this problem today?',
    why: "The status quo — even a spreadsheet or 'doing nothing' — is your real competitor.",
    type: 'choice',
    options: [
      { label: 'I know the exact alternatives and what they cost', score: 3 },
      { label: 'I have a general idea of the alternatives', score: 2 },
      { label: 'They mostly just live with the problem', score: 1 },
      { label: "I'm not sure", score: 0 },
    ],
    gapTitle: "Status quo alternatives aren't mapped",
    gapAction: "Ask 5 target customers exactly how they handle this today — including the cost of 'doing nothing'.",
  },
  {
    id: 'mv_pricing_signal',
    category: 'market_validation',
    text: "What have potential customers told you they'd pay?",
    why: 'Willingness-to-pay evidence from real conversations beats any spreadsheet projection.',
    type: 'choice',
    options: [
      { label: 'Real numbers from real conversations', score: 3 },
      { label: 'Hints and reactions, but no hard numbers', score: 2 },
      { label: "I've guessed based on similar products", score: 1 },
      { label: "I haven't asked anyone", score: 0 },
    ],
    gapTitle: 'No willingness-to-pay evidence',
    gapAction: "In your next 5 customer conversations, ask: 'What would this be worth to you per month?' and write down the numbers.",
  },
  {
    id: 'mv_channels',
    category: 'market_validation',
    text: 'How will people find out about you?',
    why: 'A great product with no distribution plan is invisible — investors always probe channels.',
    type: 'choice',
    options: [
      { label: "I've tested channels and have early results", score: 3 },
      { label: 'I have a clear plan, not yet tested', score: 2 },
      { label: 'Word of mouth, hopefully', score: 1 },
      { label: "I haven't thought about it", score: 0 },
    ],
    gapTitle: 'No tested acquisition channel',
    gapAction: 'Pick your 2 most likely channels and run a small test in each (e.g. 10 outreach messages, one ad, one post) to see what bites.',
  },
  {
    id: 'mv_proof',
    category: 'market_validation',
    text: 'What proof do you have that people want this?',
    why: 'Demand proof is the strongest card in your deck — investors weight it above almost everything.',
    type: 'choice',
    options: [
      { label: 'Paying customers or signed commitments', score: 3 },
      { label: 'A waitlist, pre-orders, or strong signals', score: 2 },
      { label: 'Positive comments and encouragement', score: 1 },
      { label: 'Nothing concrete yet', score: 0 },
    ],
    gapTitle: 'No concrete demand proof',
    gapAction: 'Create one lightweight commitment ask — a waitlist, pre-order, or letter of intent — and get your first 10 signups.',
  },
  {
    id: 'mv_first_customer',
    category: 'market_validation',
    text: 'Describe your ideal first customer in one or two sentences.',
    why: "Specificity here shows investors you know exactly who you're building for first.",
    type: 'text',
    placeholder: 'e.g. Solo physiotherapists in the UK who spend 5+ hours a week on admin…',
  },

  /* --------------------------- FINANCIAL THINKING (7) ---------------------------- */
  {
    id: 'ft_model',
    category: 'financial_thinking',
    text: 'How do you plan to make money?',
    why: "A clear revenue model shows investors you're building a business, not just a product.",
    type: 'choice',
    options: [
      { label: 'One clear revenue model I can defend', score: 3 },
      { label: 'A main model, with some open questions', score: 2 },
      { label: 'A few possibilities, nothing decided', score: 1 },
      { label: "I haven't figured that out yet", score: 0 },
    ],
    gapTitle: 'Revenue model is undecided',
    gapAction: 'Pick ONE primary revenue model and write down the 3 assumptions it depends on — then test the riskiest one first.',
  },
  {
    id: 'ft_price',
    category: 'financial_thinking',
    text: 'What would you charge?',
    why: 'Investors want to see you understand your pricing and value.',
    type: 'choice',
    options: [
      { label: "A specific price I've tested with real customers", score: 3 },
      { label: 'A researched estimate based on the market', score: 2 },
      { label: 'A gut-feel number', score: 1 },
      { label: 'No idea yet', score: 0 },
    ],
    gapTitle: 'Pricing is untested',
    gapAction: 'Set a provisional price anchored to the value you create, then test it in 5 real conversations before adjusting.',
  },
  {
    id: 'ft_costs',
    category: 'financial_thinking',
    text: 'Do you know what it costs to deliver your product or service?',
    why: 'Unit costs are the foundation of every other number in your plan.',
    type: 'choice',
    options: [
      { label: "Yes — I've mapped my per-unit costs", score: 3 },
      { label: 'A rough estimate', score: 2 },
      { label: 'Only the big-ticket items', score: 1 },
      { label: 'No, not really', score: 0 },
    ],
    gapTitle: 'Delivery costs unknown',
    gapAction: 'List every cost of serving ONE customer for one month — tools, time, materials — to get your true unit cost.',
  },
  {
    id: 'ft_breakeven',
    category: 'financial_thinking',
    text: 'How many customers do you need to break even?',
    why: 'Knowing your break-even point shows investors you understand the path to sustainability.',
    type: 'choice',
    options: [
      { label: "I've calculated it", score: 3 },
      { label: 'I have a rough ballpark', score: 2 },
      { label: "I could work it out, but haven't", score: 1 },
      { label: "I wouldn't know where to start", score: 0 },
    ],
    gapTitle: 'Break-even point not calculated',
    gapAction: 'Divide your monthly fixed costs by your profit per customer — that single number is your break-even customer count.',
  },
  {
    id: 'ft_expenses',
    category: 'financial_thinking',
    text: 'What are your biggest expenses going to be?',
    why: 'Investors check whether you know where the money actually goes.',
    type: 'choice',
    options: [
      { label: 'Mapped out in a simple budget', score: 3 },
      { label: 'I know the big ones off the top of my head', score: 2 },
      { label: 'A vague idea', score: 1 },
      { label: "I haven't looked at expenses yet", score: 0 },
    ],
    gapTitle: 'No expense budget',
    gapAction: 'Draft a simple 12-month budget with your top 5 expense lines — it takes an hour and answers half of investor due diligence.',
  },
  {
    id: 'ft_year1',
    category: 'financial_thinking',
    text: 'How much revenue could you realistically make in year one?',
    why: 'The number matters less than whether the assumptions behind it hold up.',
    type: 'choice',
    options: [
      { label: "I've modeled it with assumptions I can defend", score: 3 },
      { label: 'An estimate based on similar businesses', score: 2 },
      { label: 'A hopeful guess', score: 1 },
      { label: 'I have no idea', score: 0 },
    ],
    gapTitle: 'Year-one revenue not modeled',
    gapAction: 'Build a one-tab model: customers per month × price × 12. Keep the assumptions visible so you can defend each one.',
  },
  {
    id: 'ft_margins',
    category: 'financial_thinking',
    text: 'Do you know your margins?',
    why: 'Margins tell investors whether the business gets stronger or weaker as it grows.',
    type: 'choice',
    options: [
      { label: 'Yes — gross and net, at least roughly', score: 3 },
      { label: 'Roughly, for my main product', score: 2 },
      { label: 'I know the concept, not my numbers', score: 1 },
      { label: 'Not really', score: 0 },
    ],
    gapTitle: 'Margins unknown',
    gapAction: 'Calculate gross margin on your core offer: (price − direct cost) ÷ price. Investors will ask for this number early.',
  },

  /* -------------------------------- FUNDABILITY (7) ------------------------------ */
  {
    id: 'fu_ask',
    category: 'fundability',
    text: 'How much money do you need to launch?',
    why: "A precise ask backed by a budget signals you've done the work — vague asks get vague answers.",
    type: 'choice',
    options: [
      { label: 'A specific number with a budget behind it', score: 3 },
      { label: 'A realistic range', score: 2 },
      { label: 'A rough guess', score: 1 },
      { label: "I haven't worked it out", score: 0 },
    ],
    gapTitle: 'Funding ask is undefined',
    gapAction: 'Work backwards from your next milestone: what it costs to reach it + a 20% buffer. That is your ask.',
  },
  {
    id: 'fu_sources',
    category: 'fundability',
    text: 'Have you looked into grants, loans, or investors?',
    why: 'Knowing your funding options — and which fit your stage — makes every conversation easier.',
    type: 'choice',
    options: [
      { label: "Yes — I've shortlisted specific options", score: 3 },
      { label: "I've done some research", score: 2 },
      { label: "I know they exist, that's about it", score: 1 },
      { label: 'Not yet', score: 0 },
    ],
    gapTitle: 'Funding sources unexplored',
    gapAction: 'Shortlist 5 funding options that match your stage (grants, angels, revenue-based) and note the requirements for each.',
  },
  {
    id: 'fu_team',
    category: 'fundability',
    text: 'Do you have co-founders or advisors?',
    why: 'Investors bet on teams — even solo founders need people who challenge and support them.',
    type: 'choice',
    options: [
      { label: 'Committed co-founder(s) and/or active advisors', score: 3 },
      { label: 'Informal mentors or helpers', score: 2 },
      { label: "I'm looking for the right people", score: 1 },
      { label: 'Just me, no support network yet', score: 0 },
    ],
    gapTitle: 'No advisors or support network',
    gapAction: 'Recruit 2 advisors who have built or funded something similar — a monthly 30-minute call is enough to start.',
  },
  {
    id: 'fu_skin',
    category: 'fundability',
    text: 'How much of your own money or time have you put in?',
    why: 'Skin in the game shows investors you believe in this before asking them to.',
    type: 'choice',
    options: [
      { label: 'Significant — real money and consistent time', score: 3 },
      { label: 'Meaningful time, some money', score: 2 },
      { label: 'A little of either, so far', score: 1 },
      { label: 'Nothing yet', score: 0 },
    ],
    gapTitle: 'Limited skin in the game',
    gapAction: 'Commit a fixed weekly time block (and a starter budget, however small) — consistency is the signal investors read.',
  },
  {
    id: 'fu_useoffunds',
    category: 'fundability',
    text: "If someone invested today, do you know exactly what you'd spend it on?",
    why: 'A line-item use of funds is one of the fastest ways to look investor-ready.',
    type: 'choice',
    options: [
      { label: 'Yes — a line-item plan', score: 3 },
      { label: 'My top 2–3 priorities', score: 2 },
      { label: 'General ideas', score: 1 },
      { label: 'Not really', score: 0 },
    ],
    gapTitle: 'No use-of-funds plan',
    gapAction: "Draft a use-of-funds table: 4–6 line items, each tied to a milestone it unlocks. Investors love seeing 'this money buys that progress'.",
  },
  {
    id: 'fu_traction',
    category: 'fundability',
    text: 'What traction can you show right now?',
    why: 'Traction converts your story from a promise into evidence.',
    type: 'choice',
    options: [
      { label: 'Revenue or active users', score: 3 },
      { label: 'A waitlist, pilots, or letters of intent', score: 2 },
      { label: 'Social proof and interest', score: 1 },
      { label: 'Nothing yet', score: 0 },
    ],
    gapTitle: 'No traction to show',
    gapAction: 'Define the ONE traction metric that matters for your model (signups, pilots, revenue) and set a 30-day target for it.',
  },
  {
    id: 'fu_vision',
    category: 'fundability',
    text: "What's your long-term vision for this business?",
    why: 'Investors back big destinations — paint the picture of where this goes in 5–10 years.',
    type: 'text',
    placeholder: 'In 5 years, we will be…',
  },
];

export const TOTAL_QUESTIONS = QUESTIONS.length;

export function getOptionScore(question: Question, answer: string | undefined): number | null {
  if (question.type !== 'choice' || !question.options || answer === undefined || answer === '') return null;
  const idx = Number(answer);
  if (!Number.isInteger(idx) || idx < 0 || idx >= question.options.length) return null;
  return question.options[idx].score;
}

/** 0–100 subscore per category, computed only from structured (choice) answers. */
export function computeCategoryScores(answers: AnswerMap): Record<CategoryId, number> {
  const totals: Record<CategoryId, { earned: number; possible: number }> = {
    idea_clarity: { earned: 0, possible: 0 },
    market_validation: { earned: 0, possible: 0 },
    financial_thinking: { earned: 0, possible: 0 },
    fundability: { earned: 0, possible: 0 },
  };
  for (const q of QUESTIONS) {
    if (q.type !== 'choice') continue;
    totals[q.category].possible += MAX_OPTION_SCORE;
    const score = getOptionScore(q, answers[q.id]);
    if (score !== null) totals[q.category].earned += score;
  }
  const result = {} as Record<CategoryId, number>;
  (Object.keys(totals) as CategoryId[]).forEach((cat) => {
    const { earned, possible } = totals[cat];
    result[cat] = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  });
  return result;
}

/** Overall Funding Readiness Score 0–100 (mean of the four category subscores). */
export function computeOverallScore(categoryScores: Record<CategoryId, number>): number {
  const values = Object.values(categoryScores);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

const SEVERITY_FOR_SCORE: Record<number, { severity: Severity; impact: number }> = {
  0: { severity: 'high', impact: 8 },
  1: { severity: 'medium', impact: 5 },
  2: { severity: 'low', impact: 3 },
};

/**
 * The top 3 gaps holding the founder back: the weakest structured answers,
 * tie-broken by the weakest category, in question order.
 */
export function computeTopGaps(
  answers: AnswerMap,
  categoryScores: Record<CategoryId, number>,
): TopGap[] {
  const candidates: Array<{ q: Question; qNumber: number; score: number }> = [];
  QUESTIONS.forEach((q, i) => {
    if (q.type !== 'choice') return;
    const score = getOptionScore(q, answers[q.id]);
    const effective = score === null ? 0 : score;
    if (effective <= 2) candidates.push({ q, qNumber: i + 1, score: effective });
  });

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const catDiff = categoryScores[a.q.category] - categoryScores[b.q.category];
    if (catDiff !== 0) return catDiff;
    return a.qNumber - b.qNumber;
  });

  return candidates.slice(0, 3).map(({ q, qNumber, score }) => {
    const { severity, impact } = SEVERITY_FOR_SCORE[score] ?? SEVERITY_FOR_SCORE[2];
    const idx = Number(answers[q.id]);
    const answerLabel =
      q.options && Number.isInteger(idx) && idx >= 0 && idx < q.options.length
        ? q.options[idx].label
        : 'Not answered';
    return {
      question_id: q.id,
      question_number: qNumber,
      title: q.gapTitle ?? q.text,
      category: q.category,
      severity,
      score_impact: impact,
      action: q.gapAction ?? 'Revisit this question and strengthen your answer before talking to investors.',
      answer_label: answerLabel,
      assessment_ref: `Assessment · Q${qNumber}`,
    };
  });
}
