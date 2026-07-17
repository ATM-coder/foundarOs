/* ============================================================================
 * Founder Pack — document generation for the paid $49 upgrade.
 *
 * Two generation paths for the five deliverables, both built entirely from
 * the founder's stored assessment data (answers + category scores + top gaps):
 *
 *   1. generatePackDocumentsAI (preferred) — personalized documents written
 *      by GPT via the platform openai-text-generation integration
 *      (POST /proxy/openai/v1/chat/completions; the API key stays
 *      server-side on the platform).
 *   2. generatePackDocuments (deterministic fallback) — instant, offline
 *      template generation from the same data. Used automatically for any
 *      document whose AI call fails, times out, or returns unusable output,
 *      so a verified buyer ALWAYS receives all five documents.
 *
 * The five deliverables:
 *   business-plan     — 11-section business plan draft
 *   pitch-deck        — full slide-by-slide investor deck (editable template)
 *   financial-model   — 3-year revenue projections, costs, break-even, metrics
 *   grant-application — grant readiness summary, eligibility checklist,
 *                       problem statement draft, recommended grant sources
 *   action-plan       — readiness scores, top gaps, 30/60/90-day plan
 * ========================================================================== */

import { QUESTIONS, CATEGORY_LABELS, getOptionScore } from './questions';
import type { AnswerMap, CategoryId, Question, TopGap } from './questions';

export interface PackDocument {
  id: 'business-plan' | 'pitch-deck' | 'financial-model' | 'grant-application' | 'action-plan';
  title: string;
  description: string;
  filename: string;
  /** Full markdown source of the document. */
  content: string;
}

export interface PackInput {
  answers: AnswerMap;
  categoryScores: Record<CategoryId, number>;
  overallScore: number;
  topGaps: TopGap[];
}

/** A paid pack must come from a finished assessment, never an empty template. */
export function isCompletePackInput(input: PackInput): boolean {
  const choiceQuestions = QUESTIONS.filter((q) => q.type === 'choice');
  const hasEveryChoice = choiceQuestions.every((q) => getOptionScore(q, input.answers[q.id]) !== null);
  const scoresAreValid =
    Number.isFinite(input.overallScore) &&
    input.overallScore >= 0 &&
    input.overallScore <= 100 &&
    (Object.keys(CATEGORY_LABELS) as CategoryId[]).every((category) => {
      const score = input.categoryScores[category];
      return Number.isFinite(score) && score >= 0 && score <= 100;
    });
  return hasEveryChoice && scoresAreValid;
}

function readinessLabel(score: number): string {
  return score >= 80
    ? 'Investor-ready'
    : score >= 60
      ? 'Getting close'
      : score >= 40
        ? 'Building momentum'
        : 'Early stage';
}

interface Answer {
  q: Question | null;
  /** Chosen option label (choice) or trimmed free text (text). */
  label: string | null;
  /** 0–3 for answered choice questions, null otherwise. */
  score: number | null;
}

function getAnswer(answers: AnswerMap, id: string): Answer {
  const q = QUESTIONS.find((x) => x.id === id) ?? null;
  if (!q) return { q: null, label: null, score: null };
  const raw = answers[q.id];
  if (q.type === 'text') {
    const text = (raw ?? '').trim();
    return { q, label: text || null, score: null };
  }
  const score = getOptionScore(q, raw);
  const idx = Number(raw);
  const label =
    q.options && Number.isInteger(idx) && idx >= 0 && idx < q.options.length
      ? q.options[idx].label
      : null;
  return { q, label, score };
}

/**
 * Standard block for one assessment answer: bolded heading, a quoted line
 * showing where the founder stands, and (for weak choice answers) the
 * specific recommended next step from the question bank.
 */
function answerBlock(answers: AnswerMap, id: string, heading?: string): string {
  const a = getAnswer(answers, id);
  if (!a.q) return '';
  const lines: string[] = [];
  lines.push(`**${heading ?? a.q.text}**`);
  if (a.q.type === 'text') {
    lines.push(
      a.label
        ? `> In your words: “${a.label}”`
        : `> _Not answered yet — write this in your own words before sharing._`,
    );
  } else if (a.label === null) {
    lines.push(`> _Not answered — revisit this question in the assessment._`);
  } else {
    lines.push(`> Where you stand: “${a.label}”`);
  }
  if (a.q.type === 'choice' && (a.score ?? 0) <= 1 && a.q.gapAction) {
    lines.push('', `**Priority next step:** ${a.q.gapAction}`);
  }
  lines.push('');
  return lines.join('\n');
}

function pillarExtreme(input: PackInput, kind: 'max' | 'min'): string {
  const entries = Object.entries(input.categoryScores) as [CategoryId, number][];
  if (entries.length === 0) return '—';
  const sorted = [...entries].sort((a, b) => a[1] - b[1]);
  const [cat, score] = kind === 'min' ? sorted[0] : sorted[sorted.length - 1];
  return `${CATEGORY_LABELS[cat]} (${score}/100)`;
}

function docHeader(title: string, input: PackInput): string {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return [
    `# ${title}`,
    '',
    `**FoundarOS Funding Readiness Pack** · Generated ${date}`,
    '',
    `Overall Funding Readiness Score: **${input.overallScore}/100** (${readinessLabel(input.overallScore)})`,
    '',
    '---',
    '',
  ].join('\n');
}

function categorySnapshot(input: PackInput): string {
  const order: CategoryId[] = [
    'idea_clarity',
    'market_validation',
    'financial_thinking',
    'fundability',
  ];
  return order
    .map((cat) => `- **${CATEGORY_LABELS[cat]}:** ${input.categoryScores[cat] ?? 0}/100`)
    .join('\n');
}

/**
 * Best-effort brand name from the founder's one-liner (the assessment has no
 * dedicated brand-name question). Falls back to an explicit placeholder so
 * documents never silently guess a name.
 */
const NAME_PLACEHOLDER = '[Your Company Name]';
const PRONOUN_STARTS = new Set(['We', 'I', 'Our', 'My', 'The', 'A', 'An', 'It', 'This', 'They', 'You']);

export function ventureName(answers: AnswerMap): string {
  const oneLiner = (answers['ic_one_liner'] ?? '').trim();
  const m = oneLiner.match(
    /^([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})\s+(?:is|helps|makes|lets|enables|empowers|provides|offers|connects|builds|turns|gives|delivers)\b/,
  );
  if (!m) return NAME_PLACEHOLDER;
  const candidate = m[1].trim();
  const words = candidate.split(/\s+/);
  if (words.length === 1 && PRONOUN_STARTS.has(words[0])) return NAME_PLACEHOLDER;
  return candidate;
}

/* ============================================================================
 * DOCUMENT 1 — Business Plan draft
 * ========================================================================== */
export function generateBusinessPlan(input: PackInput): string {
  const { answers } = input;
  const oneLiner = getAnswer(answers, 'ic_one_liner').label;
  const firstCustomer = getAnswer(answers, 'mv_first_customer').label;
  const vision = getAnswer(answers, 'fu_vision').label;
  const stage = getAnswer(answers, 'ic_stage');

  const out: string[] = [docHeader('Business Plan Draft', input)];

  out.push(
    `_This draft is assembled from your own assessment answers. Quoted lines show where you stand today; “priority next step” notes flag the sections investors will probe hardest. Replace the placeholders with your specifics and this becomes a working plan._`,
    '',
    '## 1. Executive Summary',
    '',
    oneLiner
      ? `**The business in one sentence:** ${oneLiner}`
      : `**The business in one sentence:** _Write your one-liner: “We help [who] do [what] by [how].”_`,
    '',
    stage.label ? `**Current stage:** ${stage.label}` : `**Current stage:** _Not specified yet._`,
    '',
    `**Funding readiness today:** ${input.overallScore}/100 (${readinessLabel(input.overallScore)}). Strongest pillar: ${pillarExtreme(input, 'max')}. Weakest pillar: ${pillarExtreme(input, 'min')} — the sections flagged below close that gap.`,
    '',
    '## 2. The Problem',
    '',
    answerBlock(answers, 'ic_problem', 'Problem clarity'),
    answerBlock(answers, 'mv_statusquo', 'How people cope today (the status quo)'),
    '**Draft it:** In 2–3 sentences, describe the specific pain, who feels it, how often it hits, and what it costs them when it goes unsolved. That paragraph is the anchor of this whole plan.',
    '',
    '## 3. The Solution & Why Now',
    '',
    answerBlock(answers, 'ic_different', 'Differentiation'),
    answerBlock(answers, 'ic_simple', 'Simplicity of the story'),
    answerBlock(answers, 'ic_whynow', 'Timing (“why now?”)'),
    '**Draft it:** State what you build, the one clear edge that stops an incumbent copying you, and the recent shift (tech, regulation, behavior) that makes this newly possible.',
    '',
    '## 4. Target Market',
    '',
    answerBlock(answers, 'ic_customer', 'Who has this problem'),
    firstCustomer
      ? `**Your ideal first customer, in your words:**\n> ${firstCustomer}\n`
      : `**Your ideal first customer:** _Describe one narrow beachhead profile — role, situation, budget._\n`,
    answerBlock(answers, 'mv_size', 'Market size'),
    '**Bottom-up sizing worksheet:** number of target customers you can actually reach × what each would pay per year = your serviceable market. Show the math, not just the total.',
    '',
    '## 5. Competition',
    '',
    answerBlock(answers, 'mv_competitors', 'Competitive landscape'),
    '**Fill in for your top 5 alternatives (including “do nothing”):**',
    '- Who they serve',
    '- What they charge',
    '- Where they fall short',
    '- Why a customer would switch to you (your wedge)',
    '',
    '## 6. Validation & Traction',
    '',
    answerBlock(answers, 'mv_interviews', 'Customer conversations'),
    answerBlock(answers, 'mv_pricing_signal', 'Willingness-to-pay evidence'),
    answerBlock(answers, 'mv_proof', 'Demand proof'),
    answerBlock(answers, 'fu_traction', 'Traction you can show'),
    '',
    '## 7. Go-To-Market',
    '',
    answerBlock(answers, 'mv_channels', 'Acquisition channels'),
    '**Channel test plan:** pick your 2 most likely channels and run a small, cheap test in each (10 outreach messages, one ad, one post). Record cost per response — that number belongs in this section.',
    '',
    '## 8. Business Model & Financial Plan',
    '',
    answerBlock(answers, 'ft_model', 'Revenue model'),
    answerBlock(answers, 'ft_price', 'Pricing'),
    answerBlock(answers, 'ft_costs', 'Cost to deliver'),
    answerBlock(answers, 'ft_margins', 'Margins'),
    answerBlock(answers, 'ft_breakeven', 'Break-even point'),
    answerBlock(answers, 'ft_expenses', 'Biggest expenses'),
    answerBlock(answers, 'ft_year1', 'Year-one revenue'),
    '**One-tab model:** customers per month × price × 12, minus your top 5 expense lines. Keep every assumption visible so you can defend each one in the room.',
    '',
    '## 9. Team',
    '',
    answerBlock(answers, 'ic_founder', 'Founder–market fit'),
    answerBlock(answers, 'fu_team', 'Co-founders & advisors'),
    answerBlock(answers, 'fu_skin', 'Skin in the game'),
    '',
    '## 10. Funding Ask & Use of Funds',
    '',
    answerBlock(answers, 'fu_ask', 'The ask'),
    answerBlock(answers, 'fu_useoffunds', 'Use of funds'),
    answerBlock(answers, 'fu_sources', 'Funding sources explored'),
    '**Use-of-funds table (fill in):** 4–6 line items, each tied to the milestone it unlocks. Work backwards from your next milestone: what it costs to reach it + a 20% buffer = your ask.',
    '',
    '## 11. Long-Term Vision',
    '',
    vision
      ? `> ${vision}`
      : '> _Paint the 5–10 year picture: what does the world look like if this works?_',
    '',
    '---',
    '',
    '## Appendix — Readiness Snapshot',
    '',
    categorySnapshot(input),
    '',
    '_Track the gaps behind these scores on your Gap Radar board — fixing them raises your readiness score._',
    '',
  );

  return out.join('\n');
}

/* ============================================================================
 * DOCUMENT 2 — Pitch Deck (full slide-by-slide editable template)
 * ========================================================================== */

export const PITCH_DECK_TEMPLATE_NOTE =
  '> **This is an editable PowerPoint deck.** Download the `.pptx`, open it in PowerPoint, Keynote, or Google Slides, then replace the logo slot and refine the pre-applied brand palette if needed.';
export const LOGO_PLACEHOLDER = '[INSERT YOUR LOGO HERE]';
const BRAND_COLOURS_NOTE = '[FoundarOS palette pre-applied in the PowerPoint download — replace with your own colours if needed]';

export function generatePitchDeck(input: PackInput): string {
  const { answers } = input;
  const name = ventureName(answers);
  const oneLiner = getAnswer(answers, 'ic_one_liner').label;
  const firstCustomer = getAnswer(answers, 'mv_first_customer').label;
  const vision = getAnswer(answers, 'fu_vision').label;
  const stage = getAnswer(answers, 'ic_stage').label;

  const quoted = (id: string): string => {
    const a = getAnswer(answers, id);
    return a.label ? `“${a.label}”` : '_(not answered — revisit this in the assessment)_';
  };

  const fixNote = (id: string): string => {
    const a = getAnswer(answers, id);
    if (a.q?.type === 'choice' && (a.score ?? 0) <= 1 && a.q.gapAction) {
      return `**Fix before presenting:** ${a.q.gapAction}\n`;
    }
    return '';
  };

  const out: string[] = [docHeader('Investor Pitch Deck', input)];

  out.push(
    PITCH_DECK_TEMPLATE_NOTE,
    '',
    `_An eight-slide investor deck for **${name}**, written from your own assessment answers. Each slide gives you the actual copy to put on screen ("On the slide"), what to say while it's up ("Speaker notes"), and how to lay it out ("Design notes"). Where your assessment flagged weak material, a "Fix before presenting" line tells you what to strengthen first._`,
    '',
    '---',
    '',
    /* ------------------------------ SLIDE 1 ------------------------------ */
    '## Slide 1 — Cover',
    '',
    `${LOGO_PLACEHOLDER}`,
    '',
    '**On the slide:**',
    '',
    `# ${name}`,
    '',
    oneLiner
      ? `### ${oneLiner}`
      : '### _[Your one-liner: “We help [who] do [what] by [how].”]_',
    '',
    `_[Your name] · [Title] · [Email] · [Date]_`,
    '',
    `**Speaker notes:** Ten seconds, maximum. Say the company name, your one-liner, and stop. The cover's only job is to set the frame: who you help and the outcome you deliver. Resist the urge to explain — the next seven slides do that.`,
    '',
    `**Design notes:** ${BRAND_COLOURS_NOTE} — a single strong background colour or full-bleed image, logo centred, one line of type. Nothing else.`,
    '',
    /* ------------------------------ SLIDE 2 ------------------------------ */
    '## Slide 2 — The Problem',
    '',
    '**On the slide:**',
    '',
    '### The problem is real, painful, and expensive',
    '',
    `- Your problem clarity today: ${quoted('ic_problem')}`,
    `- Who feels it: ${quoted('ic_customer')}`,
    `- How they cope today: ${quoted('mv_statusquo')}`,
    '',
    '_[Rewrite the three lines above as three short, punchy statements: the pain, who feels it and how often, and what it costs them when it goes unsolved.]_',
    '',
    `**Speaker notes:** Make the investor nod before you ever mention your product. Tell one concrete story of a person or business hitting this problem — names and numbers beat adjectives. The status quo (even “they just live with it”) is your real competitor; say what it costs.`,
    '',
    fixNote('ic_problem'),
    fixNote('mv_statusquo'),
    `**Design notes:** Dark background, one oversized statistic or quote. This is the emotional peak of the deck's first half.`,
    '',
    /* ------------------------------ SLIDE 3 ------------------------------ */
    '## Slide 3 — The Solution',
    '',
    '**On the slide:**',
    '',
    `### How ${name} solves it`,
    '',
    `- What makes you different: ${quoted('ic_different')}`,
    `- How simply you can tell it: ${quoted('ic_simple')}`,
    `- Why now: ${quoted('ic_whynow')}`,
    '',
    '_[Replace with: one sentence on what the product does, one on your unfair edge, one on the recent shift that makes this newly possible.]_',
    '',
    `**Speaker notes:** One sentence on what you build — simple enough for a 10-year-old. Then your wedge: the unique insight, tech, or access that stops an incumbent copying you. Close with “why now”: the recent change in technology, regulation, or behaviour that opens this window.`,
    '',
    fixNote('ic_different'),
    fixNote('ic_whynow'),
    `**Design notes:** Product screenshot, demo frame, or a simple before/after diagram. Show, don't describe.`,
    '',
    /* ------------------------------ SLIDE 4 ------------------------------ */
    '## Slide 4 — Market Size',
    '',
    '**On the slide:**',
    '',
    '### A market big enough to matter',
    '',
    `- Your sizing evidence today: ${quoted('mv_size')}`,
    firstCustomer
      ? `- Your beachhead, in your words: “${firstCustomer}”`
      : '- Your beachhead: _[describe one narrow first-customer profile — role, situation, budget]_',
    '',
    '_[Build the slide around bottom-up math: reachable customers × annual value per customer = serviceable market. Three stacked numbers (TAM / SAM / SOM) with your sources.]_',
    '',
    `**Speaker notes:** Investors trust arithmetic over adjectives. Walk the bottom-up math out loud: how many target customers you can actually reach, what each is worth per year, and the beachhead segment you win first. Name how you expand from that beachhead.`,
    '',
    fixNote('mv_size'),
    `**Design notes:** Three concentric circles or three stacked bars (TAM/SAM/SOM). Sources in small type at the bottom — investors check.`,
    '',
    /* ------------------------------ SLIDE 5 ------------------------------ */
    '## Slide 5 — Business Model',
    '',
    '**On the slide:**',
    '',
    `### How ${name} makes money`,
    '',
    `- Revenue model: ${quoted('ft_model')}`,
    `- Pricing: ${quoted('ft_price')}`,
    `- Margins: ${quoted('ft_margins')}`,
    '',
    '_[Replace with: your ONE primary revenue model, the price point, and gross margin on the core offer — (price − direct cost) ÷ price.]_',
    '',
    `**Speaker notes:** One primary model, stated with confidence. Give the price, who pays it, and the gross margin. If you've tested pricing in real conversations, say so — willingness-to-pay evidence beats any benchmark. The question you're answering: does this machine get stronger as it grows?`,
    '',
    fixNote('ft_model'),
    fixNote('ft_price'),
    `**Design notes:** A simple money-flow diagram: customer → ${name} → cost of delivery. One price, one margin number, large.`,
    '',
    /* ------------------------------ SLIDE 6 ------------------------------ */
    '## Slide 6 — Traction & Roadmap',
    '',
    '**On the slide:**',
    '',
    '### Where we are — and what ships next',
    '',
    `- Stage today: ${stage ? `“${stage}”` : '_(not answered)_'}`,
    `- Demand proof: ${quoted('mv_proof')}`,
    `- Customer conversations: ${quoted('mv_interviews')}`,
    `- Traction you can show: ${quoted('fu_traction')}`,
    '',
    '_[Lead with your single strongest number (revenue, users, waitlist, pilots). Then a 3-milestone roadmap: shipped → next 90 days → next 12 months.]_',
    '',
    `**Speaker notes:** Traction converts your story from a promise into evidence. Lead with the strongest proof you have and give its trajectory (“up X% month over month” beats a static number). Then the roadmap: what's shipped, what ships in 90 days, what the next 12 months unlock. Every milestone should map to the funding ask on slide 8.`,
    '',
    fixNote('mv_proof'),
    fixNote('fu_traction'),
    `**Design notes:** Left half: one big traction number or a simple up-and-right chart. Right half: three-step timeline.`,
    '',
    /* ------------------------------ SLIDE 7 ------------------------------ */
    '## Slide 7 — Team',
    '',
    '**On the slide:**',
    '',
    `### Why this team wins`,
    '',
    `- Founder–market fit: ${quoted('ic_founder')}`,
    `- Co-founders & advisors: ${quoted('fu_team')}`,
    `- Skin in the game: ${quoted('fu_skin')}`,
    '',
    '_[Replace with: photo, name, and one line per person — the credential or lived experience that makes them unfairly suited to THIS problem. Add advisors with one-line credentials.]_',
    '',
    `**Speaker notes:** Investors bet on teams. Tell your 30-second founder story — the moment you met this problem — and the unfair advantage you bring. Name what you've already put in (time, money, focus): commitment is a signal investors read carefully. If there are gaps in the team, name them and say who you're hiring first; self-awareness beats bravado.`,
    '',
    fixNote('ic_founder'),
    fixNote('fu_team'),
    `**Design notes:** Headshots in brand-coloured frames (${BRAND_COLOURS_NOTE}), names large, credentials in one line each. _[Add your photo and team photos here.]_`,
    '',
    /* ------------------------------ SLIDE 8 ------------------------------ */
    '## Slide 8 — The Ask & Use of Funds',
    '',
    '**On the slide:**',
    '',
    '### The ask',
    '',
    `- Your ask today: ${quoted('fu_ask')}`,
    `- Use of funds: ${quoted('fu_useoffunds')}`,
    `- Sources explored: ${quoted('fu_sources')}`,
    '',
    '_[Replace with: the amount, the runway it buys, the milestone it reaches, and a 4–6 line use-of-funds table — each line tied to the milestone it unlocks.]_',
    '',
    vision ? `> Long-term vision, in your words: “${vision}”` : '> _[Close with your 5–10 year vision — the destination this round moves you toward.]_',
    '',
    `**Speaker notes:** Be precise: “We're raising [amount] to reach [milestone] in [timeframe].” Walk the use-of-funds table line by line — investors love seeing “this money buys that progress”. Close with the long-term vision so the room leaves holding the destination, not just the next step. Then stop talking and take questions; questions are where deals happen.`,
    '',
    fixNote('fu_ask'),
    fixNote('fu_useoffunds'),
    `**Design notes:** The amount in the largest type on any slide in the deck. Use-of-funds as a simple horizontal bar split by category, in your brand colours.`,
    '',
    '---',
    '',
    '## Delivery Tips',
    '',
    '- One idea per slide, 20-point font minimum, numbers over adjectives.',
    '- Rehearse the whole deck in under 4 minutes — the meeting is won in the Q&A.',
    `- Keep every claim traceable to evidence; anything you can't defend, cut.`,
    '- Send the deck as a PDF after the meeting, never before — you are the pitch, the deck is the prop.',
    '',
    '## Appendix — Readiness Snapshot',
    '',
    categorySnapshot(input),
    '',
    '_Slides built from weak answers carry a “Fix before presenting” note — close those gaps on your Gap Radar board before you book investor meetings._',
    '',
  );

  return out.join('\n');
}

/* ============================================================================
 * DOCUMENT 3 — Financial Model
 * ========================================================================== */
export function generateFinancialModel(input: PackInput): string {
  const { answers } = input;
  const name = ventureName(answers);
  const ftScore = input.categoryScores['financial_thinking'] ?? 0;

  const maturityNote =
    ftScore >= 80
      ? 'Your Financial Thinking score suggests you already have real numbers — use this model to pressure-test them and present them in the format investors expect.'
      : ftScore >= 50
        ? 'Your Financial Thinking score suggests you have partial numbers. Fill the placeholders below with your best current estimates — a defensible rough model beats a missing one.'
        : 'Your Financial Thinking score flags this as your biggest exposure in investor conversations. Work through this model top to bottom; every placeholder you fill closes a due-diligence hole.';

  const out: string[] = [docHeader('Financial Model', input)];

  out.push(
    `_A structured, investor-ready financial model for **${name}**, built from your assessment answers. Quoted lines show what you told us; italic placeholders show exactly which number to plug in. Copy the tables into a spreadsheet and keep every assumption visible — investors probe assumptions, not totals._`,
    '',
    `${maturityNote}`,
    '',
    '## 1. Model Foundations (from your assessment)',
    '',
    answerBlock(answers, 'ft_model', 'Revenue model'),
    answerBlock(answers, 'ft_price', 'Pricing'),
    answerBlock(answers, 'ft_costs', 'Cost to deliver'),
    answerBlock(answers, 'ft_year1', 'Year-one revenue thinking'),
    '## 2. Core Assumptions',
    '',
    'Every number downstream flows from these five inputs. Write them down first and defend each one:',
    '',
    '| # | Assumption | Your number | How to estimate it |',
    '|---|------------|-------------|--------------------|',
    '| 1 | Price per customer per month | _[fill in]_ | Anchor to the value you create; test in 5 real conversations |',
    '| 2 | Direct cost to serve one customer / month | _[fill in]_ | Tools + time + materials for ONE customer for one month |',
    '| 3 | New customers per month (start) | _[fill in]_ | What your tested channels can actually produce, not what you hope |',
    '| 4 | Monthly customer growth rate | _[fill in]_ % | Early-stage: 5–15% monthly is credible; justify anything higher |',
    '| 5 | Monthly churn rate | _[fill in]_ % | If unknown, model 3–5% monthly and tighten with real data |',
    '',
    '## 3. Revenue Projections — 3-Year Outlook',
    '',
    'Build three scenarios so investors see you understand the range of outcomes. The formula for each year:',
    '',
    '> **Annual revenue = average paying customers that year × price × 12**',
    '',
    '| Scenario | Year 1 | Year 2 | Year 3 | Growth logic |',
    '|----------|--------|--------|--------|--------------|',
    '| Conservative | _[fill in]_ | _[≈ Year 1 × 2]_ | _[≈ Year 2 × 1.8]_ | Only channels already tested; churn at the high end |',
    '| Base case | _[fill in]_ | _[≈ Year 1 × 2.5]_ | _[≈ Year 2 × 2]_ | Current plan executes; one new channel comes online in Y2 |',
    '| Ambitious | _[fill in]_ | _[≈ Year 1 × 3.5]_ | _[≈ Year 2 × 2.5]_ | Funding lands, hiring plan executes, channels compound |',
    '',
    '**How to fill Year 1:** take assumption #3 (new customers/month), grow it by assumption #4, subtract churn (#5), multiply average customers by price × 12. Show the month-by-month build in your spreadsheet — investors always ask for the monthly view of year one.',
    '',
    '**Rules that keep projections credible:**',
    '- Tie every growth jump to a cause (new channel, new hire, product launch) — hockey sticks without causes get discounted to zero.',
    '- Year 3 revenue more than ~10× Year 1 needs extraordinary evidence.',
    '- State revenue recognition simply: when do you actually get paid?',
    '',
    '## 4. Cost Assumptions',
    '',
    answerBlock(answers, 'ft_expenses', 'Your expense visibility today'),
    'Split costs into the two lines investors read first:',
    '',
    '**Direct (variable) costs — scale with each customer:**',
    '',
    '| Cost line | Monthly amount | Notes |',
    '|-----------|----------------|-------|',
    '| Delivery / hosting / materials per customer | _[fill in]_ | From assumption #2 |',
    '| Payment processing (~3%) | _[fill in]_ | Price × 0.03 |',
    '| Support time per customer | _[fill in]_ | Hours × your hourly cost |',
    '',
    '**Fixed (operating) costs — the burn, paid regardless of customers:**',
    '',
    '| Cost line | Monthly amount | Notes |',
    '|-----------|----------------|-------|',
    '| Founder pay / contractors | _[fill in]_ | Even $0 should be stated deliberately |',
    '| Software & tools | _[fill in]_ | List the top 5 subscriptions |',
    '| Marketing & customer acquisition | _[fill in]_ | Tie to the channel tests in your plan |',
    '| Legal, accounting, insurance | _[fill in]_ | Annual cost ÷ 12 |',
    '| Workspace / other | _[fill in]_ | |',
    '| **Total monthly fixed costs** | _[sum]_ | This number drives break-even below |',
    '',
    '## 5. Break-Even Analysis',
    '',
    answerBlock(answers, 'ft_breakeven', 'Where you stand on break-even'),
    'Three steps, one afternoon:',
    '',
    '1. **Contribution per customer** = price − direct cost per customer (assumptions #1 − #2) = _[fill in]_',
    '2. **Break-even customer count** = total monthly fixed costs ÷ contribution per customer = _[fill in]_',
    '3. **Break-even date** = the month your customer projection (Section 3, base case) crosses that count = _[fill in]_',
    '',
    '> Investors rarely expect an early-stage company to be at break-even — they expect you to know exactly how far away it is and what moves it.',
    '',
    '## 6. Margins & Unit Economics',
    '',
    answerBlock(answers, 'ft_margins', 'Your margin visibility today'),
    '| Metric | Formula | Your number |',
    '|--------|---------|-------------|',
    '| Gross margin | (price − direct cost) ÷ price | _[fill in]_ % |',
    '| Customer acquisition cost (CAC) | Total sales & marketing spend ÷ new customers won | _[fill in]_ |',
    '| Customer lifetime (months) | 1 ÷ monthly churn rate | _[fill in]_ |',
    '| Lifetime value (LTV) | contribution per customer × customer lifetime | _[fill in]_ |',
    '| LTV : CAC ratio | LTV ÷ CAC — investors want to see a path to 3:1+ | _[fill in]_ |',
    '',
    '## 7. Key Investor-Readiness Metrics',
    '',
    'The numbers investors will ask for in the first meeting — know them cold:',
    '',
    '- **Monthly recurring revenue (MRR)** and its month-over-month growth rate — the headline of every update.',
    '- **Burn rate** — total monthly fixed costs minus gross profit; how much cash the business consumes per month.',
    '- **Runway** — cash in the bank ÷ burn rate, in months. Your funding ask should buy 18–24 months.',
    '- **Break-even customer count** — from Section 5; the single number that proves you understand your model.',
    '- **Gross margin** — from Section 6; tells investors whether the business gets stronger as it grows.',
    '- **LTV : CAC** — from Section 6; the engine-efficiency number. Below 1:1 the machine loses money on every customer.',
    '',
    '## 8. Funding Ask, Grounded in the Model',
    '',
    answerBlock(answers, 'fu_ask', 'Your current ask'),
    answerBlock(answers, 'fu_useoffunds', 'Use of funds'),
    '**Tie the ask to the model:** ask = (monthly burn × months to your next fundable milestone) + 20% buffer. Present it as a use-of-funds table where each line item names the milestone it unlocks.',
    '',
    '---',
    '',
    '## Appendix — Readiness Snapshot',
    '',
    categorySnapshot(input),
    '',
    '_Rebuild this pack after closing gaps on your Gap Radar board — your model gets sharper as your answers do._',
    '',
  );

  return out.join('\n');
}

/* ============================================================================
 * DOCUMENT 4 — Grant Application Assistant
 * ========================================================================== */

interface GrantCriterion {
  label: string;
  met: boolean;
  note: string;
}

function grantChecklist(input: PackInput): GrantCriterion[] {
  const s = (id: string): number => getAnswer(input.answers, id).score ?? 0;
  const has = (id: string): boolean => !!getAnswer(input.answers, id).label;
  return [
    {
      label: 'Clearly articulated problem',
      met: s('ic_problem') >= 2,
      note:
        s('ic_problem') >= 2
          ? 'Your problem statement is strong enough to lead a grant narrative.'
          : 'Sharpen a one-sentence problem statement first — every grant application opens with it.',
    },
    {
      label: 'Defined target beneficiary / customer',
      met: s('ic_customer') >= 2 || has('mv_first_customer'),
      note:
        s('ic_customer') >= 2 || has('mv_first_customer')
          ? 'You can name who benefits — grant reviewers score this heavily.'
          : 'Define one specific beneficiary group; “everyone” fails grant scoring rubrics.',
    },
    {
      label: 'Innovative / differentiated approach',
      met: s('ic_different') >= 2,
      note:
        s('ic_different') >= 2
          ? 'Your differentiation gives reviewers the "innovation" hook most grants require.'
          : 'Name the one thing that is new about your approach — innovation is a scored criterion on most grants.',
    },
    {
      label: 'Evidence of demand / early validation',
      met: s('mv_proof') >= 2 || s('mv_interviews') >= 2,
      note:
        s('mv_proof') >= 2 || s('mv_interviews') >= 2
          ? 'You have validation evidence to cite — quantify it in the application.'
          : 'Gather demand evidence (interviews, waitlist, pilots) — unsupported claims are the top reason applications score low.',
    },
    {
      label: 'Credible budget / financial plan',
      met: s('ft_expenses') >= 2 && s('ft_costs') >= 2,
      note:
        s('ft_expenses') >= 2 && s('ft_costs') >= 2
          ? 'Your cost visibility supports the line-item budget grants demand.'
          : 'Draft a 12-month budget — every grant requires a line-item budget, and reviewers check it against the ask.',
    },
    {
      label: 'Specific use of funds tied to outcomes',
      met: s('fu_useoffunds') >= 2,
      note:
        s('fu_useoffunds') >= 2
          ? 'You can already map money to milestones — the core of a fundable grant proposal.'
          : 'Build a use-of-funds table where each line names the outcome it buys; grants fund outcomes, not activities.',
    },
    {
      label: 'Team capability to deliver',
      met: s('ic_founder') >= 2 || s('fu_team') >= 2,
      note:
        s('ic_founder') >= 2 || s('fu_team') >= 2
          ? 'Your founder story / support network covers the “capacity to deliver” criterion.'
          : 'Recruit at least one credible advisor and write your founder-fit story — reviewers must believe you can execute.',
    },
    {
      label: 'Demonstrated commitment (skin in the game)',
      met: s('fu_skin') >= 2,
      note:
        s('fu_skin') >= 2
          ? 'Your own investment of time/money strengthens match-funding and commitment questions.'
          : 'Document the time and money you have put in — many grants ask for evidence of applicant commitment or match funding.',
    },
    {
      label: 'Traction / progress to date',
      met: s('fu_traction') >= 2 || s('ic_stage') >= 2,
      note:
        s('fu_traction') >= 2 || s('ic_stage') >= 2
          ? 'You have progress to report — lead with it in the "project status" section.'
          : 'Ship the smallest demonstrable version (landing page, pilot, prototype) — “idea-only” applications rarely win competitive grants.',
    },
  ];
}

export function generateGrantApplication(input: PackInput): string {
  const { answers } = input;
  const name = ventureName(answers);
  const oneLiner = getAnswer(answers, 'ic_one_liner').label;
  const firstCustomer = getAnswer(answers, 'mv_first_customer').label;
  const stageScore = getAnswer(answers, 'ic_stage').score ?? 0;
  const stageLabel = getAnswer(answers, 'ic_stage').label;
  const problemLabel = getAnswer(answers, 'ic_problem').label;
  const statusQuoLabel = getAnswer(answers, 'mv_statusquo').label;
  const checklist = grantChecklist(input);
  const metCount = checklist.filter((c) => c.met).length;

  const stageGrantAdvice =
    stageScore >= 3
      ? [
          'You are launched with real users — target **growth and scale-up funding**:',
          '- **Growth / expansion grants** from regional development agencies (job creation and revenue growth are your strongest angles).',
          '- **Export / market-access programs** if you can serve customers beyond your home market.',
          '- **Industry-specific innovation funds** (health, climate, education, agriculture) that fund deployment, not just R&D.',
          '- **Government-backed growth loans** — often easier than equity at this stage and non-dilutive.',
        ]
      : stageScore === 2
        ? [
            'You have a working prototype or pilot — target **innovation and commercialization funding**:',
            '- **R&D / innovation grants** (e.g. SBIR-style programs, national innovation agencies) — prototypes with pilot evidence score well.',
            '- **Proof-of-concept and commercialization funds** attached to universities, accelerators, and economic development bodies.',
            '- **Pilot-partnership grants** where a public body or corporate funds your pilot as first customer.',
            '- **Industry challenge prizes** — your working prototype is exactly what challenge competitions want to see.',
          ]
        : [
            'You are pre-prototype — target **early-stage and ecosystem funding**:',
            '- **Local startup / small-business grants** from city and regional programs (typically smaller checks, lighter evidence requirements).',
            '- **Innovation vouchers** — small grants to buy expertise (design, legal, technical feasibility) rather than cash for operations.',
            '- **Incubator and accelerator stipends** — funding plus the structure to reach prototype stage.',
            '- **Founder-demographic programs** (youth, women, veteran, minority-founder funds) where applicable — often the least competitive early money.',
          ];

  const out: string[] = [docHeader('Grant Application Assistant', input)];

  out.push(
    `_Everything you need to start applying for grants for **${name}**: a business summary written for grant reviewers, an eligibility checklist scored against your own assessment, a draft problem statement you can paste into applications, and the grant types that fit your stage. Grants are non-dilutive — often the smartest first money for a ${readinessLabel(input.overallScore).toLocaleLowerCase()} venture._`,
    '',
    '## 1. Business Summary (for grant applications)',
    '',
    '_Use this as the "project summary" section most applications open with. Tighten to the word limit each grant specifies._',
    '',
    oneLiner
      ? `> ${oneLiner}`
      : '> _[Write your one-liner first: “We help [who] do [what] by [how].” Every grant summary opens with it.]_',
    '',
    `${name} is currently at the stage: ${stageLabel ? `**“${stageLabel}”**` : '_[state your stage]_'}. ${
      firstCustomer
        ? `The venture serves a clearly defined beneficiary group — in the founder's words: “${firstCustomer}”.`
        : 'The next step is defining the specific beneficiary group the project serves — grant reviewers score specificity heavily.'
    }`,
    '',
    '_Extend this summary with: (1) the measurable outcome the grant would fund, (2) the timeframe, and (3) why your team can deliver it. Keep it under 250 words unless the application allows more._',
    '',
    '## 2. Grant Eligibility Checklist',
    '',
    `Scored against your assessment answers: **${metCount} of ${checklist.length} common criteria already covered**. Every unticked box below is also a Gap Radar item — fixing it improves both your grant odds and your readiness score.`,
    '',
    ...checklist.map((c) => `- [${c.met ? 'x' : ' '}] **${c.label}** — ${c.note}`),
    '',
    '## 3. Draft Problem Statement',
    '',
    '_The problem statement is the most-read paragraph of any grant application. Here is your draft, built from your assessment — edit the bracketed parts and make every claim specific:_',
    '',
    `> ${
      problemLabel
        ? `The founder's problem clarity today: “${problemLabel}”.`
        : '_[State the problem in one sentence.]_'
    } _[Name the affected group]_ face _[the specific pain]_ — ${
      statusQuoLabel
        ? `today they cope as follows: “${statusQuoLabel}”.`
        : '_[describe how they cope today, including “doing nothing”]_.'
    } This costs them _[time / money / opportunity — quantify it]_ every _[week / month]_. Without intervention, _[state the consequence of inaction]_. ${name} addresses this by _[one sentence on your approach]_, with the grant funding _[the specific, measurable outcome this money buys]_.`,
    '',
    '**Make it score:** grant reviewers reward (1) a quantified problem, (2) a named beneficiary group, (3) evidence the problem is real (cite your customer conversations), and (4) a direct line from the funded activity to a measurable outcome.',
    '',
    '## 4. Recommended Grant Types for Your Stage',
    '',
    ...stageGrantAdvice,
    '',
    '**How to build your shortlist this week:**',
    '1. Search your national/regional business-support portal and your city\'s economic development site for the categories above.',
    '2. Ask one accelerator or small-business advisor which grants ventures like yours actually won in the last 12 months.',
    '3. Shortlist 5, note each one\'s deadline, check size, and eligibility criteria, and work them as items on your Gap Radar board.',
    '',
    answerBlock(answers, 'fu_sources', 'Where you stand on funding-source research'),
    '## 5. Application Tips That Win',
    '',
    '- **Answer the question asked.** Reviewers score against a rubric — mirror the application\'s own language in your answers.',
    '- **Quantify everything.** “10 customer interviews, 3 pilot commitments” beats “strong early interest”.',
    '- **Budget honestly.** Reviewers know what things cost; padded budgets fail diligence, tight ones build trust.',
    '- **Match funding matters.** Your own invested time and money (however small) counts — state it.',
    '- **Reuse this pack.** Your Business Plan covers the “project description”, the Financial Model covers the budget section, and the problem statement above slots into nearly every application.',
    '',
    '---',
    '',
    '## Appendix — Readiness Snapshot',
    '',
    categorySnapshot(input),
    '',
    '_Every unticked eligibility box above maps to a gap on your Gap Radar board — close them and rebuild this pack before your first application deadline._',
    '',
  );

  return out.join('\n');
}

/* ============================================================================
 * DOCUMENT 5 — Action Plan & Executive Summary
 * ========================================================================== */
export function generateActionPlan(input: PackInput): string {
  const { answers, overallScore, topGaps } = input;

  const meaning =
    overallScore >= 80
      ? 'You are in investor-ready territory. Your job now is packaging and momentum: tighten the story, assemble the evidence, and start conversations while your metrics are moving up and to the right.'
      : overallScore >= 60
        ? 'You are getting close. A focused push on your weakest pillar — usually 2–4 specific gaps — moves you into investor-ready territory. Close the priority gaps below before booking investor meetings.'
        : overallScore >= 40
          ? 'You are building momentum. The foundations are forming, but investors would still find easy holes. Work the 30/60/90 plan below in order: evidence first, financial thinking second, fundraising mechanics last.'
          : 'You are early — and that is fine. Do not pitch investors yet; spend the next 90 days on the plan below to build the proof and clarity that make funding conversations productive instead of premature.';

  // Every structured answer that scored 0–2, weakest first, in question order —
  // this is the raw material for the 30/60/90 plan.
  const weak = QUESTIONS.map((q, i) => ({
    q,
    i,
    score: q.type === 'choice' ? (getOptionScore(q, answers[q.id]) ?? 0) : null,
  }))
    .filter((x): x is { q: Question; i: number; score: number } => x.score !== null && x.score <= 2)
    .sort((a, b) => a.score - b.score || a.i - b.i);

  const first30 = weak.slice(0, 3);
  const days60 = weak.slice(3, 7);
  const days90 = weak.slice(7, 11);

  const workItem = (x: { q: Question }) =>
    `- **${x.q.gapTitle ?? x.q.text}** — ${x.q.gapAction ?? 'Revisit this question and strengthen your answer before talking to investors.'}`;

  const out: string[] = [docHeader('Action Plan & Executive Summary', input)];

  out.push(
    '## Your Readiness Snapshot',
    '',
    `- **Overall: ${overallScore}/100 — ${readinessLabel(overallScore)}**`,
    categorySnapshot(input),
    '',
    '## What Your Score Means',
    '',
    meaning,
    '',
    '## The Top Gaps Holding You Back',
    '',
  );

  if (topGaps.length > 0) {
    topGaps.forEach((gap, i) => {
      out.push(
        `${i + 1}. **${gap.title}** _(${gap.severity} · ${CATEGORY_LABELS[gap.category]})_`,
        `   You answered: “${gap.answer_label}”`,
        `   **Do this:** ${gap.action}`,
        '',
      );
    });
  } else {
    out.push('No major gaps detected — even your weakest answers were solid. Skip straight to the fundraising execution steps below.', '');
  }

  out.push('## Your 30 / 60 / 90-Day Plan', '', '### Next 30 days — close the critical gaps', '');
  if (first30.length > 0) {
    for (const x of first30) out.push(workItem(x));
  } else {
    out.push('- Your structured answers are all strong — move straight to fundraising execution below.');
  }

  out.push('', '### Days 31–60 — strengthen the evidence', '');
  if (days60.length > 0) {
    for (const x of days60) out.push(workItem(x));
  } else {
    out.push('- Deepen what is working: 10 more customer conversations, and turn interest into commitments (waitlist, pre-orders, letters of intent).');
  }

  out.push('', '### Days 61–90 — get fundraise-ready', '');
  for (const x of days90) out.push(workItem(x));
  out.push(
    '- Draft your investor deck using the Pitch Deck template in this pack.',
    '- Assemble a lightweight data room: this plan, your Financial Model, and your customer evidence.',
    '- Shortlist 5 funding sources that match your stage (the Grant Application Assistant in this pack maps the grant options) and start warming up introductions.',
    '',
    '## Investor-Readiness Checklist',
    '',
    '- [ ] One-sentence problem statement that gets an immediate nod',
    '- [ ] Narrow beachhead customer profile (role, situation, budget)',
    '- [ ] 10+ real customer conversations logged',
    '- [ ] Concrete demand proof (waitlist, pre-orders, pilots, or revenue)',
    '- [ ] One primary revenue model with a tested price',
    '- [ ] Break-even math and a 12-month budget',
    '- [ ] A specific ask with a line-item use of funds',
    '- [ ] 30-second founder story and 2 active advisors',
    '',
    '## Keep Score',
    '',
    'Every gap above lives on your Gap Radar board. Work them to “fixed” and your readiness score climbs with you — retake the assessment after a big push and rebuild this pack to see the difference.',
    '',
  );

  return out.join('\n');
}

/** Generate all five Founder Pack deliverables. */
export function generatePackDocuments(input: PackInput): PackDocument[] {
  if (!isCompletePackInput(input)) {
    throw new Error('assessment_incomplete');
  }
  return [
    {
      id: 'business-plan',
      title: 'Business Plan Draft',
      description: 'A structured 11-section business plan built from your assessment answers.',
      filename: 'foundaros-business-plan.md',
      content: generateBusinessPlan(input),
    },
    {
      id: 'pitch-deck',
      title: 'Pitch Deck (Editable PowerPoint)',
      description: 'A full eight-slide investor deck with editable on-slide copy, speaker notes, brand colours, and a logo-insertable cover slot. Downloads as a real PowerPoint file.',
      filename: 'foundaros-pitch-deck.pptx',
      content: generatePitchDeck(input),
    },
    {
      id: 'financial-model',
      title: 'Financial Model',
      description: '3-year revenue projections, cost assumptions, break-even analysis, and the investor metrics you need to know cold.',
      filename: 'foundaros-financial-model.md',
      content: generateFinancialModel(input),
    },
    {
      id: 'grant-application',
      title: 'Grant Application Assistant',
      description: 'A grant-ready business summary, eligibility checklist scored from your answers, a draft problem statement, and grant sources for your stage.',
      filename: 'foundaros-grant-application.md',
      content: generateGrantApplication(input),
    },
    {
      id: 'action-plan',
      title: 'Action Plan & Executive Summary',
      description: 'Your readiness scores, top gaps, and a step-by-step 30/60/90-day plan.',
      filename: 'foundaros-action-plan.md',
      content: generateActionPlan(input),
    },
  ];
}

const REQUIRED_DOCUMENT_IDS: PackDocument['id'][] = [
  'business-plan',
  'pitch-deck',
  'financial-model',
  'grant-application',
  'action-plan',
];

/** Exact source values that can prove a generated document used this assessment. */
function assessmentEvidence(input: PackInput): string[] {
  const values = QUESTIONS.map((q) => getAnswer(input.answers, q.id).label)
    .filter((value): value is string => typeof value === 'string' && value.trim().length >= 4)
    .map((value) => value.trim().slice(0, 600));
  return [...new Set(values)];
}

function documentIsGrounded(doc: PackDocument, input: PackInput): boolean {
  if (!doc.content || doc.content.trim().length < 800) return false;
  if (!doc.content.includes(`${input.overallScore}/100`)) return false;
  const normalized = doc.content.toLocaleLowerCase();
  const evidenceMatches = assessmentEvidence(input).filter((value) =>
    normalized.includes(value.toLocaleLowerCase()),
  ).length;
  const hasFullScoreSnapshot = (Object.keys(CATEGORY_LABELS) as CategoryId[]).every((category) => {
    const plain = `${CATEGORY_LABELS[category]}: ${input.categoryScores[category]}/100`;
    const bold = `${CATEGORY_LABELS[category]}:** ${input.categoryScores[category]}/100`;
    return doc.content.includes(plain) || doc.content.includes(bold);
  });
  return evidenceMatches >= 2 || hasFullScoreSnapshot;
}

/** Per-document markers that MUST survive AI generation (falls back otherwise). */
const REQUIRED_MARKERS: Partial<Record<PackDocument['id'], string[]>> = {
  'pitch-deck': [LOGO_PLACEHOLDER],
};

/** Runtime fulfillment invariant checked before any paid pack is persisted. */
export function validatePackDocuments(documents: PackDocument[], input: PackInput): boolean {
  if (!isCompletePackInput(input) || documents.length !== REQUIRED_DOCUMENT_IDS.length) return false;
  const ids = new Set(documents.map((doc) => doc.id));
  return (
    REQUIRED_DOCUMENT_IDS.every((id) => ids.has(id)) &&
    documents.every((doc) => {
      const hasExpectedFileType =
        doc.id === 'pitch-deck'
          ? doc.filename.endsWith('.pptx')
          : doc.filename.endsWith('.md');
      return (
        !!doc.title.trim() &&
        !!doc.description.trim() &&
        hasExpectedFileType &&
        documentIsGrounded(doc, input) &&
        (REQUIRED_MARKERS[doc.id] ?? []).every((marker) => doc.content.includes(marker))
      );
    })
  );
}

/* ============================================================================
 * AI-PERSONALIZED GENERATION — the preferred path for the paid deliverables.
 *
 * One chat-completion call per document, run in parallel, each fed the
 * founder's full assessment digest (scores, top gaps, and every answer in
 * their own words). Grounding rules in the system prompt stop the model from
 * inventing traction or market facts the founder never stated.
 * ========================================================================== */

const AI_MODEL = 'gpt-4o-mini';
const AI_TIMEOUT_MS = 90_000;

const AI_SYSTEM_PROMPT = [
  'You are a senior startup advisor at FoundarOS writing part of a paid "Funding Readiness Pack" for a first-time founder.',
  "You are given the founder's full 30-question Funding Readiness assessment: their scores, their top gaps, and every answer in their own words.",
  'Rules:',
  "- Ground EVERYTHING in the founder's actual answers. Include at least three of their answer values verbatim in the document so the source data is auditable; paraphrase elsewhere where useful.",
  '- NEVER invent facts the founder did not state (no made-up traction, revenue, customer names, or market figures).',
  '- Where required information is missing or weak, insert a clearly marked italic placeholder telling the founder exactly what to write or do, e.g. _[Fill in: your break-even customer count — monthly fixed costs ÷ profit per customer.]_',
  '- Tone: encouraging, plain-spoken, specific. Write for a first-time founder, not an MBA.',
  '- Output pure markdown. No code fences. Do NOT include a top-level `# Title` heading — start directly with the first `##` section (or the required template note when instructed).',
].join('\n');

/** Everything the model needs, in one compact plain-text block. */
function buildAssessmentDigest(input: PackInput): string {
  const order: CategoryId[] = [
    'idea_clarity',
    'market_validation',
    'financial_thinking',
    'fundability',
  ];
  const name = ventureName(input.answers);
  const lines: string[] = [
    `OVERALL FUNDING READINESS SCORE: ${input.overallScore}/100 (${readinessLabel(input.overallScore)})`,
    `BRAND NAME: ${name === NAME_PLACEHOLDER ? `not stated — always refer to the venture with the literal placeholder ${NAME_PLACEHOLDER}` : `${name} (derived from the founder's one-liner — weave it through the content)`}`,
    'CATEGORY SCORES:',
    ...order.map((c) => `- ${CATEGORY_LABELS[c]}: ${input.categoryScores[c] ?? 0}/100`),
    '',
    'TOP GAPS (computed from the weakest answers):',
    ...(input.topGaps.length > 0
      ? input.topGaps.map(
          (g, i) =>
            `${i + 1}. ${g.title} (${g.severity} · ${CATEGORY_LABELS[g.category]}) — the founder answered “${g.answer_label}”. Recommended action: ${g.action}`,
        )
      : ['(none — all structured answers were strong)']),
    '',
    "FULL ASSESSMENT (question → the founder's answer):",
  ];
  QUESTIONS.forEach((q, i) => {
    const raw = input.answers[q.id];
    let answerText: string;
    if (q.type === 'text') {
      const text = (raw ?? '').trim();
      answerText = text ? `“${text.slice(0, 600)}”` : '(not answered)';
    } else {
      const score = getOptionScore(q, raw);
      const idx = Number(raw);
      const label =
        q.options && Number.isInteger(idx) && idx >= 0 && idx < q.options.length
          ? q.options[idx].label
          : null;
      answerText = label
        ? `“${label}” (scored ${score}/3)`
        : '(not answered — treat as the weakest possible answer)';
    }
    lines.push(`Q${i + 1} [${CATEGORY_LABELS[q.category]}] ${q.text} → ${answerText}`);
  });
  return lines.join('\n');
}

const AI_DOC_SPECS: Record<PackDocument['id'], { instructions: string; maxTokens: number }> = {
  'business-plan': {
    maxTokens: 3800,
    instructions: [
      "Write the founder's BUSINESS PLAN DRAFT with exactly these 11 `##` sections, in this order:",
      '1. Executive Summary · 2. The Problem · 3. The Solution & Why Now · 4. Target Market · 5. Competition · 6. Validation & Traction · 7. Go-To-Market · 8. Business Model & Financial Plan · 9. Team · 10. Funding Ask & Use of Funds · 11. Long-Term Vision.',
      "For each section: write 1–3 substantive paragraphs (or a tight bullet list where clearer) that turn the founder's answers into real plan prose — then, only where their answers were weak or missing, add a short **Priority next step:** line with the single most useful concrete action.",
      'Open the Executive Summary with their one-liner if they wrote one. End section 11 with their long-term vision in their own words if provided.',
    ].join('\n'),
  },
  'pitch-deck': {
    maxTokens: 3800,
    instructions: [
      "Write the founder's full PITCH DECK as a slide-by-slide editable template — a real deck, not an outline of bullet points.",
      'Use exactly 8 slides with these `##` headings, in this order: Slide 1 — Cover; Slide 2 — The Problem; Slide 3 — The Solution; Slide 4 — Market Size; Slide 5 — Business Model; Slide 6 — Traction & Roadmap; Slide 7 — Team; Slide 8 — The Ask & Use of Funds.',
      `MANDATORY: Slide 1 (Cover) must contain the literal line "${LOGO_PLACEHOLDER}", the brand name, and the founder's one-liner as the headline.`,
      'For each slide include three labelled parts: **On the slide:** — the actual finished copy to put on screen (headline + supporting lines), written from the founder\'s answers, weaving the brand name through the content; **Speaker notes:** — 2–4 sentences of what to say while the slide is up; **Design notes:** — one line on layout/visuals, referencing "[FoundarOS palette pre-applied in the PowerPoint download — replace with your own colours if needed]" where colour choices arise (the assessment did not capture brand colours).',
      'Where the founder\'s material for a slide is weak, add a one-line **Fix before presenting:** note with the single most concrete action.',
      'Close with a short `## Delivery Tips` section.',
    ].join('\n'),
  },
  'financial-model': {
    maxTokens: 3600,
    instructions: [
      "Write the founder's FINANCIAL MODEL document with exactly these `##` sections, in this order:",
      '1. Model Foundations — 1–2 paragraphs grounding the model in their actual revenue-model, pricing, and cost answers (quote them).',
      '2. Core Assumptions — a markdown table of the 5 driving inputs (price, direct cost per customer, starting customers/month, monthly growth %, monthly churn %) with the founder\'s stated values where they gave them and italic _[fill in]_ placeholders with estimation guidance where they did not.',
      '3. Revenue Projections — 3-Year Outlook — a markdown table with Conservative / Base / Ambitious scenario rows across Year 1–3, the annual-revenue formula, and rules that keep projections credible. NEVER invent revenue numbers the founder did not state — use placeholders with multiplier guidance.',
      '4. Cost Assumptions — direct (variable) vs fixed (operating) cost tables grounded in their expense answers.',
      '5. Break-Even Analysis — the 3-step calculation (contribution per customer → break-even count → break-even date) using their answers where available.',
      '6. Margins & Unit Economics — gross margin, CAC, lifetime, LTV, LTV:CAC as a table with formulas.',
      '7. Key Investor-Readiness Metrics — MRR, burn rate, runway, break-even count, gross margin, LTV:CAC, each with one line on why investors ask for it, tailored to this founder\'s weak spots.',
      '8. Funding Ask, Grounded in the Model — connect their stated ask and use-of-funds to the burn/runway math.',
    ].join('\n'),
  },
  'grant-application': {
    maxTokens: 3200,
    instructions: [
      "Write the founder's GRANT APPLICATION ASSISTANT document with exactly these `##` sections, in this order:",
      '1. Business Summary (for grant applications) — a 150–250 word summary of the venture written in grant-reviewer language, built strictly from their answers, opening with their one-liner.',
      '2. Grant Eligibility Checklist — 8–10 markdown checkboxes for common grant criteria (clear problem, defined beneficiary, innovation, demand evidence, credible budget, use of funds, team capability, commitment, traction). Tick `- [x]` ONLY criteria their answers actually support; leave `- [ ]` with a one-line action otherwise.',
      '3. Draft Problem Statement — a 100–150 word problem statement usable in applications, quoting their own words where possible and using italic bracketed placeholders for anything they have not stated (never invent statistics).',
      '4. Recommended Grant Types for Your Stage — grant categories that genuinely fit their stated stage and progress (e.g. innovation vouchers and local startup grants pre-prototype; SBIR-style R&D and proof-of-concept funds at prototype; growth/export programs post-launch), each with one line on why it fits and how to find it. Generic but useful; no invented program names presented as guaranteed matches.',
      '5. Application Tips That Win — 4–6 concrete tips tied to their weak spots.',
    ].join('\n'),
  },
  'action-plan': {
    maxTokens: 2800,
    instructions: [
      "Write the founder's ACTION PLAN & EXECUTIVE SUMMARY with these `##` sections, in this order:",
      '1. Your Readiness Snapshot — overall + category scores as a bullet list.',
      '2. What Your Score Means — one honest, encouraging paragraph tailored to their score and weakest pillar.',
      '3. The Top Gaps Holding You Back — the top gaps listed above, each with what they answered and the single most concrete next step.',
      '4. Your 30 / 60 / 90-Day Plan — three `###` phases (Next 30 days / Days 31–60 / Days 61–90) with 3–4 specific, checkable tasks each, prioritized from their weakest answers: evidence first, financial thinking second, fundraising mechanics last.',
      '5. Investor-Readiness Checklist — 8–10 markdown checkboxes (`- [ ]`) tailored to what they are missing.',
    ].join('\n'),
  },
};

/** One guarded chat-completion call; null on any failure so callers fall back. */
async function aiGenerateMarkdown(user: string, maxTokens: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.5,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    let text = content.trim();
    const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
    if (fence) text = fence[1].trim();
    // A too-short response is a truncated/failed generation — the deterministic
    // fallback is a better deliverable than a stub.
    return text.length >= 400 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate all five Founder Pack deliverables, personalized by GPT.
 * Per-document fallback: any document whose AI call fails keeps its
 * deterministic template version, so the buyer always gets a complete pack.
 */
export async function generatePackDocumentsAI(input: PackInput): Promise<PackDocument[]> {
  const fallback = generatePackDocuments(input);
  const digest = buildAssessmentDigest(input);
  const documents = await Promise.all(
    fallback.map(async (doc) => {
      const spec = AI_DOC_SPECS[doc.id];
      const ai = await aiGenerateMarkdown(`${digest}\n\n---\n\nYOUR TASK:\n${spec.instructions}`, spec.maxTokens);
      if (!ai) return doc;
      // The pitch deck's editable-template note is a hard product requirement,
      // so it is prepended in code rather than trusted to the model.
      const prefix = doc.id === 'pitch-deck' ? `${PITCH_DECK_TEMPLATE_NOTE}\n\n` : '';
      const candidate = { ...doc, content: docHeader(doc.title, input) + prefix + ai + '\n' };
      // Reject plausible-looking but generic AI output (or output missing a
      // required marker) and keep the deterministic, assessment-grounded
      // version instead.
      const markersOk = (REQUIRED_MARKERS[doc.id] ?? []).every((marker) =>
        candidate.content.includes(marker),
      );
      return markersOk && documentIsGrounded(candidate, input) ? candidate : doc;
    }),
  );
  if (!validatePackDocuments(documents, input)) {
    throw new Error('document_validation_failed');
  }
  return documents;
}
