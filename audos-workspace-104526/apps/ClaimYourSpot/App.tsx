import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  Loader2,
  LockKeyhole,
  Sparkles,
  Users,
} from 'lucide-react';

const FLW_PUBLIC_KEY = 'FLWPUBK-9a44fd3b4d219920299765357ae3129a-X';
const PRICE_USD = 50;
const FLUTTERWAVE_SCRIPT = 'https://checkout.flutterwave.com/v3.js';

interface ClaimRow {
  id: number;
  name: string;
  email: string;
  paid_at: string;
  flw_tx_ref: string;
}

interface SpotCount {
  total: number;
  claimed: number;
  remaining: number;
  soldOut: boolean;
}

interface FlutterwaveResponse {
  status?: string;
  transaction_id?: number;
  tx_ref?: string;
}

interface FlutterwaveModal {
  close?: () => void;
}

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getSessionId(): string | null {
  try {
    const spaceId = (window as any).__SPACE_ID__ || '';
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

export default function ClaimYourSpot() {
  const { data: myClaims, loading: claimsLoading, error: claimsError, refresh } =
    (window as any).useWorkspaceDB('preseason_spots', {
      orderBy: { column: 'created_at', direction: 'desc' },
      limit: 2,
    });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [spots, setSpots] = useState<SpotCount | null>(null);
  const [countError, setCountError] = useState('');
  const [scriptReady, setScriptReady] = useState(Boolean((window as any).FlutterwaveCheckout));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmedClaim, setConfirmedClaim] = useState<ClaimRow | null>(null);
  const completedRef = useRef(false);

  const loadSpotCount = useCallback(async () => {
    try {
      const workspaceRef = (window as any).__workspaceDb?.workspaceId || 'workspace-104526';
      const response = await fetch(
        `/api/hooks/execute/${encodeURIComponent(workspaceRef)}/preseason-spot-count`,
        { credentials: 'include' },
      );
      const payload = await response.json();
      if (!response.ok || typeof payload?.remaining !== 'number') {
        throw new Error(payload?.error || 'The live spot count is unavailable.');
      }
      const next = payload as SpotCount;
      setSpots(next);
      setCountError('');
      return next;
    } catch (error) {
      setCountError(messageFromError(error, 'Could not load the live spot count. Please try again.'));
      return null;
    }
  }, []);

  useEffect(() => {
    void loadSpotCount();
  }, [loadSpotCount]);

  useEffect(() => {
    if ((window as any).FlutterwaveCheckout) {
      setScriptReady(true);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${FLUTTERWAVE_SCRIPT}"]`);
    const script = existing || document.createElement('script');
    const handleLoad = () => setScriptReady(true);
    const handleError = () => setFormError('Checkout could not load. Check your connection and try again.');

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    if (!existing) {
      script.src = FLUTTERWAVE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }

    return () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
  }, []);

  useEffect(() => {
    if (!confirmedClaim && myClaims.length > 0) {
      setConfirmedClaim(myClaims[0]);
    }
  }, [confirmedClaim, myClaims]);

  const handlePayment = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanName.length < 2) {
      setFormError('Please enter your name.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (!scriptReady || !(window as any).FlutterwaveCheckout) {
      setFormError('Checkout is still loading. Please try again in a moment.');
      return;
    }

    setSubmitting(true);
    const latest = await loadSpotCount();
    if (!latest) {
      setSubmitting(false);
      return;
    }
    if (latest.remaining <= 0) {
      setSubmitting(false);
      return;
    }

    const txRef = `preseason-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    completedRef.current = false;
    let modal: FlutterwaveModal | undefined;

    try {
      modal = (window as any).FlutterwaveCheckout({
        public_key: FLW_PUBLIC_KEY,
        tx_ref: txRef,
        amount: PRICE_USD,
        currency: 'USD',
        payment_options: 'card,ussd,banktransfer',
        customer: { name: cleanName, email: cleanEmail },
        customizations: {
          title: 'FoundarOS Preseason',
          description: 'Fundability Session — 1 of 2 spots',
        },
        callback: async (payment: FlutterwaveResponse) => {
          const paid = payment?.status === 'successful' || payment?.status === 'completed';
          if (!paid || completedRef.current) return;
          completedRef.current = true;

          try {
            const finalCount = await loadSpotCount();
            if (!finalCount || finalCount.remaining <= 0) {
              throw new Error('The final spot was claimed moments ago. Please keep your payment reference and contact Nkechi.');
            }

            const sessionId = getSessionId();
            if (!sessionId) {
              throw new Error('Your payment succeeded, but your signed-in session could not be verified.');
            }

            const workspaceRef = (window as any).__workspaceDb?.workspaceId || 'workspace-104526';
            const claimResponse = await fetch(
              `/api/hooks/execute/${encodeURIComponent(workspaceRef)}/preseason-claim-spot`,
              {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Session-Id': sessionId,
                },
                body: JSON.stringify({
                  name: cleanName,
                  email: cleanEmail,
                  txRef: payment.tx_ref || txRef,
                }),
              },
            );
            const claimPayload = await claimResponse.json().catch(() => null);
            if (!claimResponse.ok || !claimPayload?.ok) {
              if (claimPayload?.code === 'sold_out') {
                throw new Error('The final spot was claimed moments ago. Please keep your payment reference and contact Nkechi.');
              }
              throw new Error('Your payment succeeded, but we could not save your spot.');
            }

            const claim: ClaimRow = {
              id: payment.transaction_id || Date.now(),
              name: cleanName,
              email: cleanEmail,
              paid_at: new Date().toISOString(),
              flw_tx_ref: payment.tx_ref || txRef,
            };
            setConfirmedClaim(claim);
            refresh();
            await loadSpotCount();
            modal?.close?.();
          } catch (error) {
            setFormError(
              `${messageFromError(error, 'Your payment succeeded, but we could not save your spot.')} Reference: ${payment.tx_ref || txRef}`,
            );
          } finally {
            setSubmitting(false);
          }
        },
        onclose: () => {
          if (!completedRef.current) setSubmitting(false);
        },
      });
    } catch (error) {
      setFormError(messageFromError(error, 'Checkout could not start. Please try again.'));
      setSubmitting(false);
    }
  };

  if (confirmedClaim) {
    return (
      <main className="h-full overflow-y-auto bg-[var(--space-surface-page)] text-[var(--space-text-primary)]">
        <div className="mx-auto flex min-h-full w-full max-w-2xl items-center px-5 py-10 sm:px-8">
          <section className="w-full rounded-[28px] border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-6 shadow-2xl sm:p-10">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--space-semantic-success)_16%,transparent)] text-[var(--space-semantic-success)]">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--space-text-accent)]">Spot confirmed</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">You&apos;re in! Check your email for next steps.</h1>
            <p className="mt-5 text-lg text-[var(--space-text-secondary)]">
              Welcome, <span className="font-semibold text-[var(--space-text-primary)]">{confirmedClaim.name}</span>.
              Nkechi will reach out within 24 hours to schedule your session.
            </p>
            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-4 text-sm text-[var(--space-text-secondary)]">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--space-text-accent)]" />
              <span>Session delivered via video call. Booking link sent within 24 hours of payment.</span>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const loading = claimsLoading || spots === null;
  const soldOut = Boolean(spots?.soldOut || spots?.remaining === 0);

  return (
    <main className="h-full overflow-y-auto bg-[var(--space-surface-page)] text-[var(--space-text-primary)]">
      <div className="relative isolate min-h-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--space-brand-primary)_30%,transparent),transparent_68%)]" />
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-9 sm:px-8 sm:py-14 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-12 lg:py-20">
          <section>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--space-text-accent)]">
              <Sparkles className="h-3.5 w-3.5" /> FoundarOS Preseason
            </div>
            <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-[-0.04em] sm:text-5xl lg:text-6xl">
              Get your idea fundable — before you quit your day job
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--space-text-secondary)] sm:text-xl">
              A private 1:1 fundability session with Nkechi. Just 2 spots. Just $50.
            </p>

            <div className="mt-7 inline-flex items-center gap-2 rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-4 py-3 text-sm font-semibold">
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin text-[var(--space-text-accent)]" /> Checking live availability…</>
              ) : soldOut ? (
                <><span aria-hidden="true">🔴</span> 0 of 2 spots remaining</>
              ) : (
                <><span aria-hidden="true">🟢</span> {spots?.remaining} of 2 spots remaining</>
              )}
            </div>

            <div className="mt-8 grid max-w-xl gap-3 text-sm text-[var(--space-text-secondary)] sm:grid-cols-3">
              <div className="flex items-center gap-2"><Users className="h-4 w-4 text-[var(--space-text-accent)]" /> Private 1:1</div>
              <div className="flex items-center gap-2"><Check className="h-4 w-4 text-[var(--space-semantic-success)]" /> Clear next gap</div>
              <div className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-[var(--space-text-accent)]" /> Secure checkout</div>
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--space-border-strong)] bg-[var(--space-surface-panel)] p-5 shadow-2xl sm:p-7">
            {soldOut ? (
              <div className="py-6 text-center sm:py-10">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--space-semantic-danger)_14%,transparent)] text-[var(--space-semantic-danger)]">
                  <Users className="h-7 w-7" />
                </div>
                <h2 className="text-2xl font-bold">Sold Out — Join the Waitlist</h2>
                <p className="mx-auto mt-3 max-w-sm leading-7 text-[var(--space-text-secondary)]">
                  🔴 Both spots are taken. Drop your email to be first when a new cohort opens.
                </p>
                <p className="mt-6 text-sm text-[var(--space-text-muted)]">
                  You&apos;re already signed in to FoundarOS, so Nkechi can keep you posted about the next opening.
                </p>
              </div>
            ) : (
              <form onSubmit={handlePayment} noValidate>
                <div className="mb-6 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[var(--space-text-secondary)]">One private session</p>
                    <p className="mt-1 text-3xl font-bold">$50 <span className="text-sm font-normal text-[var(--space-text-muted)]">USD</span></p>
                  </div>
                  <div className="rounded-2xl bg-[color-mix(in_srgb,var(--space-brand-primary)_16%,transparent)] p-3 text-[var(--space-text-accent)]">
                    <CreditCard className="h-6 w-6" />
                  </div>
                </div>

                <label className="block text-sm font-medium" htmlFor="claim-name">Your name</label>
                <input
                  id="claim-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  placeholder="Ada Okafor"
                  className="mt-2 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-4 py-3.5 text-[var(--space-text-primary)] outline-none transition focus:border-[var(--space-brand-primary)]"
                />

                <label className="mt-4 block text-sm font-medium" htmlFor="claim-email">Email address</label>
                <input
                  id="claim-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="mt-2 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-4 py-3.5 text-[var(--space-text-primary)] outline-none transition focus:border-[var(--space-brand-primary)]"
                />

                {(formError || claimsError || countError) && (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger)_10%,transparent)] p-3 text-sm text-[var(--space-text-primary)]" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--space-semantic-danger)]" />
                    <span>{formError || claimsError?.message || countError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || submitting}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--space-brand-primary)] px-5 py-4 text-base font-bold text-[var(--space-text-on-primary)] shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? <><Loader2 className="h-5 w-5 animate-spin" /> Opening secure checkout…</> : <>Claim Your Spot — $50 <ArrowRight className="h-5 w-5" /></>}
                </button>

                <p className="mt-4 text-center text-xs leading-5 text-[var(--space-text-muted)]">
                  Session delivered via video call. Booking link sent within 24 hours of payment.
                </p>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
