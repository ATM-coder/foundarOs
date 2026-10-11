import { useState } from 'react';
import {
  Compass,
  Lightbulb,
  Building2,
  ArrowRight,
  Sparkles,
  MessageCircle,
} from 'lucide-react';
import { tw } from '../../lib/colors';

/* ============================================================================
 * FoundarOS — Founder Journey (home / path selector)
 *
 * The first screen a logged-in founder sees. It asks “Where are you on your
 * founder journey?” and offers three premium paths BEFORE routing anyone into
 * a module. It does NOT force anyone through Gap Radar:
 *   1. No idea yet     → Idea Discovery (new pre-idea module)
 *   2. I have an idea  → Gap Radar (Idea Validation)
 *   3. I have a business → Gap Radar (funding readiness)
 *
 * Cross-app navigation uses the shell’s openApp CustomEvent contract, exactly
 * like the in-space agent deep links.
 * ========================================================================== */

function openApp(appId: string) {
  try {
    window.dispatchEvent(new CustomEvent('openApp', { detail: { appId } }));
  } catch {
    /* noop */
  }
}

type PathCard = {
  id: string;
  stage: string;
  icon: typeof Compass;
  label: string;
  sub: string;
  target: string;
  targetName: string;
  deepLink?: string;
};

const PATHS: PathCard[] = [
  {
    id: 'discover',
    stage: "I don't have an idea yet",
    icon: Compass,
    label: 'Explore Idea Discovery',
    sub: 'Help me identify business opportunities based on who I am, what I know and what I have access to.',
    target: 'idea-discovery',
    targetName: 'Idea Discovery',
  },
  {
    id: 'validate',
    stage: 'I have an idea',
    icon: Lightbulb,
    label: 'Explore Idea Validation',
    sub: 'Help me understand whether my idea is worth pursuing.',
    target: 'gap-radar',
    targetName: 'Gap Radar',
  },
  {
    id: 'business',
    stage: 'I have a business',
    icon: Building2,
    label: 'Explore Gap Radar',
    sub: 'Help me understand my current funding readiness.',
    target: 'gap-radar',
    targetName: 'Gap Radar',
    deepLink: 'funding-readiness',
  },
];

const STAGES = ['Discover', 'Validate', 'Build', 'Assess', 'Fund', 'Operate'];

export default function FounderJourney() {
  const [hovered, setHovered] = useState<string | null>(null);

  const choose = (card: PathCard) => {
    if (card.deepLink) {
      try {
        window.localStorage.setItem('foundaros:gap-radar-intent', card.deepLink);
      } catch {
        /* noop */
      }
    }
    openApp(card.target);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-14">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-6 bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)]">
            <Sparkles className="w-3.5 h-3.5" /> FoundarOS
          </span>
          <h1 className={`text-3xl sm:text-4xl font-bold tracking-tight ${tw.typography.color.primary}`}>
            Where are you on your founder journey?
          </h1>
          <p className={`mt-4 text-base sm:text-lg leading-7 ${tw.typography.color.secondary} max-w-2xl mx-auto`}>
            Choose where you are today. FoundarOS meets you at the right step — whether you’re still looking for an idea,
            testing one, or already building a business.
          </p>
        </div>

        <div className="mt-10 grid md:grid-cols-3 gap-5">
          {PATHS.map((card) => {
            const Icon = card.icon;
            const isHovered = hovered === card.id;
            return (
              <button
                key={card.id}
                onMouseEnter={() => setHovered(card.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => choose(card)}
                className={`group relative text-left ${tw.card.glass} p-6 flex flex-col transition-all duration-300 hover:-translate-y-1`}
                style={
                  isHovered
                    ? { boxShadow: '0 20px 60px -20px var(--space-shell-shadow-strong)', borderColor: 'var(--space-border-strong)' }
                    : undefined
                }
              >
                <span
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
                  style={{
                    background: 'color-mix(in srgb, var(--space-brand-primary-500) 18%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)',
                  }}
                >
                  <Icon className={`w-6 h-6 ${tw.icon.primary}`} />
                </span>
                <span className={`text-xs font-medium ${tw.typography.color.accent}`}>{card.stage}</span>
                <h2 className={`mt-1 text-xl font-bold ${tw.typography.color.primary}`}>{card.label}</h2>
                <p className={`mt-2 text-sm leading-6 ${tw.typography.color.secondary} flex-1`}>{card.sub}</p>
                <span className={`mt-5 inline-flex items-center gap-1.5 text-sm font-semibold ${tw.typography.color.brand}`}>
                  {card.target === 'idea-discovery' ? 'Start discovering' : 'Continue'}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            );
          })}
        </div>

        {/* Journey rail */}
        <div className="mt-12">
          <div className="flex items-center justify-center flex-wrap gap-2">
            {STAGES.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <span
                  className={`px-3 py-1.5 rounded-full text-xs font-medium ${i === 0 ? 'bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)]' : 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]'}`}
                >
                  {s}
                </span>
                {i < STAGES.length - 1 && <ArrowRight className={`w-3.5 h-3.5 ${tw.icon.muted}`} />}
              </div>
            ))}
          </div>
          <p className={`mt-4 text-center text-xs ${tw.typography.color.muted}`}>
            Your FoundarOS path: DISCOVER → VALIDATE → BUILD → ASSESS → FUND → OPERATE
          </p>
        </div>

        {/* Talk to assistant hint */}
        <div className="mt-10 flex items-center justify-center">
          <span className={`inline-flex items-center gap-2 text-xs ${tw.typography.color.muted}`}>
            <MessageCircle className="w-3.5 h-3.5" /> Not sure? Tap the Assistant to talk it through first.
          </span>
        </div>
      </div>
    </div>
  );
}
