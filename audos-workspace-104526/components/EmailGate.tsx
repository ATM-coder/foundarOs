import { useState, useEffect } from 'react';
import {
  ArrowRight,
  X,
  Plus,
  Sparkles,
  Lightbulb,
  Users,
  Calculator,
  Rocket,
  ClipboardList,
  Gauge,
  FileText,
  Check,
  Briefcase,
  Bot,
  DollarSign,
  TrendingUp,
  Building2,
} from 'lucide-react';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import type { DesktopThemeTokens } from '../types';

// Version marker for auto-upgrade detection
// Increment this when making breaking changes that stale copies need
export const EMAIL_GATE_VERSION = 109; // v109: fix chatbot "trouble connecting" error — use correct /proxy/openai path (was /api/workspaces/.../proxy, which 404’d)

type ParsedResponseBody = { data: unknown; rawText: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Parses a fetch Response body safely so a 5xx HTML page (proxy timeout,
// memory-crash restart, etc.) does not throw inside `response.json()` and
// get swallowed into the generic "Connection error" copy. Always returns
// an object instead of throwing — callers inspect `response.ok` themselves.
async function parseResponseBody(response: Response): Promise<ParsedResponseBody> {
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    return { data: null, rawText: '' };
  }

  if (!rawText) {
    return { data: null, rawText: '' };
  }

  try {
    return { data: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { data: null, rawText };
  }
}

// Bound every auth request so a hung API call can never hold the login
// modal’s loading state forever (QA replay-bug-msyknsue-nop2). On timeout the
// fetch rejects with an AbortError, which the callers surface as a retryable
// error message via their catch/finally blocks.
const AUTH_REQUEST_TIMEOUT_MS = 20000;

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

// The OTP space config never changes within a page session, but EmailGate can
// mount and re-run checkExistingSession() several times per visit — QA
// replay-bug-msyjgmz9-3gyq counted 5 identical fetches of
// /api/auth/otp/space/config/{workspaceId}. Cache the in-flight promise at
// module level so every caller shares ONE network request; a failed fetch
// clears the cache so transient errors stay retryable.
const otpSpaceConfigCache = new Map<string, Promise<Record<string, any>>>();

function fetchOtpSpaceConfig(workspaceId: string): Promise<Record<string, any>> {
  let cached = otpSpaceConfigCache.get(workspaceId);
  if (!cached) {
    cached = fetch(`/api/auth/otp/space/config/${workspaceId}`)
      .then(async (res) => {
        const data = await res.json();
        return (data.config || data) as Record<string, any>;
      })
      .catch((err) => {
        otpSpaceConfigCache.delete(workspaceId);
        throw err;
      });
    otpSpaceConfigCache.set(workspaceId, cached);
  }
  return cached;
}

// Pick the most informative error message we can show to the user given
// what came back over the wire. Server-provided `error` always wins; for
// unparseable / non-JSON responses we expose the HTTP status so the bug
// is debuggable instead of being hidden behind "Connection error".
function describeResponseFailure(
  response: Response,
  body: unknown,
  rawText: string,
  fallback: string,
): string {
  if (isRecord(body)) {
    const errField = body.error;
    if (typeof errField === 'string' && errField.trim()) return errField;
    const msgField = body.message;
    if (typeof msgField === 'string' && msgField.trim()) return msgField;
  }

  const status = response.status;
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is temporarily unavailable. Please try again in a moment.';
  }
  if (status >= 500) return `Server error (${status}). Please try again.`;
  if (status === 404) return 'This space could not be found. Please contact support.';
  if (status === 403) return 'This email is not authorized to access this space.';
  if (status === 400 && rawText) {
    // Sometimes the server returns a plain text 400; surface a trimmed copy
    const snippet = rawText.trim().slice(0, 140);
    if (snippet) return snippet;
  }

  return fallback;
}

// Snapshot of the JSON envelope returned by /api/space/:spaceId/register.
// All fields are optional because the server has historically added/removed
// keys; the client narrows individually before use.
interface SpaceRegisterResponseBody {
  success?: boolean;
  workspaceSessionId?: string;
  contactId?: string;
  email?: string;
  isReturningUser?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  visitorId?: string | null;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

// Snapshot of the JSON envelope returned by /api/auth/otp/space/{send,verify}.
interface OtpResponseBody {
  success?: boolean;
  resendCooldown?: number;
  attemptsRemaining?: number;
  expiresIn?: number;
}

interface EmailGateProps {
  spaceId: string;
  branding?: {
    name?: string;
    tagline?: string;
    logoUrl?: string;
    heroVideoUrl?: string;
    colors?: Record<string, any>;
    palette?: Record<string, any>;
  };
  themeTokens?: DesktopThemeTokens;
}

type GateStep = 'loading' | 'email' | 'code' | 'complete';

// Derive a usable color set from a single hex primary color
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 3 && clean.length !== 6) return null;
  const normalized =
    clean.length === 3
      ? clean.split('').map((char) => char + char).join('')
      : clean;
  return {
    r: parseInt(normalized.substring(0, 2), 16),
    g: parseInt(normalized.substring(2, 4), 16),
    b: parseInt(normalized.substring(4, 6), 16),
  };
}

function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  return match ? `#${match[1]}` : undefined;
}

function readableTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.58 ? '#111827' : '#ffffff';
}

export default function EmailGate({
  spaceId,
  branding,
  themeTokens,
}: EmailGateProps) {
  const { setSessionId } = useSpaceRuntime();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<GateStep>('loading');
  const [otpEnabled, setOtpEnabled] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMode, setLoginMode] = useState<'assess' | 'login'>('assess');
  const [entered, setEntered] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Feature: floating AI chatbot widget (in-memory only; never persisted)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<
    { role: 'user' | 'assistant'; content: string }[]
  >([]);

  // Feature: cookie consent banner (localStorage-backed)
  const [cookieConsentVisible, setCookieConsentVisible] = useState(false);

  // Get workspaceId from window context
  const workspaceId = (window as any).__WORKSPACE_ID__ || null;
  const gdprEnabled = !!(window as any).__GDPR_ENABLED__;
  // Template previews (genesis-space*) aren’t tied to a workspace, so the
  // normal email/OTP registration can’t complete — always offer guest entry
  // there. Cloned workspaces (workspace-N) keep the flag-gated behavior.
  const isTemplatePreview = spaceId === 'genesis-space' || spaceId.startsWith('genesis-space-');
  const guestModeEnabled = !!(window as any).__GUEST_MODE_ENABLED__ || isTemplatePreview;
  const rawSocialProviders = (window as any).__SOCIAL_PROVIDERS__;
  const socialProviders: string[] = Array.isArray(rawSocialProviders) ? rawSocialProviders : [];

  // Load the workspace’s configured display/body fonts at runtime. The static
  // HTML shell (published-bundle.html) only preloads DM Sans, so without this
  // the `fontFamily: headingFontStack` styles below would silently fall back
  // to the system font. Injected once, keyed by font name, safe to no-op if
  // already present (e.g. across client-side route changes). Placed after
  // `typography` is defined below via a second pass — see the effect near
  // the typography/font-stack declarations.

  useEffect(() => {
    storeAttribution();
    checkExistingSession();
  }, [spaceId]);

  // Pre-fill email from localStorage when loaded inside the onboarding walkthrough
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('walkthrough') === 'true') {
      const storedEmail = localStorage.getItem('user_email');
      if (storedEmail) setEmail(storedEmail);
    }
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Landing hero entrance animation (client-only; defaults visible if JS is slow)
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Floating header: transparent over the hero, solid after the visitor scrolls.
  // The landing page scrolls inside `.eg-root` (not the window), so the listener
  // attaches to that container. Re-runs on step change since eg-root only exists
  // on the main landing screen.
  useEffect(() => {
    const root = document.querySelector('.eg-root');
    if (!root) return;
    const onScroll = () => setScrolled(root.scrollTop > 24);
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener('scroll', onScroll);
  }, [step]);

  // Escape must dismiss the login modal at ALL times — including while a
  // submission is in flight (QA replay-bug-msyknsue-nop2: users were trapped
  // when an auth call hung). Any in-flight request keeps running harmlessly
  // in the background; if it succeeds the session completes as normal.
  useEffect(() => {
    if (!loginOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLoginOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loginOpen]);

  // Cookie consent: show the banner only if the visitor has not decided yet.
  // Runs once after mount so SSR/first-paint never flashes the banner.
  useEffect(() => {
    try {
      if (localStorage.getItem('foundaros_cookie_consent') === null) {
        setCookieConsentVisible(true);
      }
    } catch {
      // localStorage unavailable (private mode / sandbox) — stay hidden
    }
  }, []);

  // Flutterwave’s inline checkout is available to signed-out visitors and does
  // not depend on the FoundarOS login flow.
  useEffect(() => {
    const scriptSrc = 'https://checkout.flutterwave.com/v3.js';
    if (document.querySelector(`script[src="${scriptSrc}"]`)) return;

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const handleCookieConsent = (decision: 'accepted' | 'declined') => {
    try {
      localStorage.setItem('foundaros_cookie_consent', decision);
    } catch {}
    setCookieConsentVisible(false);
  };

  const handlePreseasonCheckout = () => {
    if (typeof (window as any).FlutterwaveCheckout !== 'function') {
      console.error('[EmailGate] Flutterwave checkout is still loading.');
      return;
    }

    (window as any).FlutterwaveCheckout({
      public_key: 'FLWPUBK-9a44fd3b4d219920299765357ae3129a-X',
      tx_ref: 'preseason-' + Date.now(),
      amount: 50,
      currency: 'USD',
      payment_options: 'card,ussd,account',
      customer: { email: '', name: '' },
      customizations: {
        title: 'FoundarOS Preseason Session',
        description: '1-on-1 founder session — Preseason special',
        logo: '',
      },
      callback: function (data: unknown) {
        console.log(data);
      },
      onclose: function () {},
    });
  };

  // Suggested inquiries shown as tappable chips before the visitor has asked
  // anything — lowers the activation energy to start a conversation.
  const chatSuggestions = [
    'Is my idea fundable?',
    'What is Gap Radar?',
    'How long does the assessment take?',
    'What do I get for $99?',
  ];

  // Send a message to the FoundarOS assistant via the Audos OpenAI proxy.
  // Accepts an optional override so suggestion chips can send a preset question.
  const sendChatMessage = async (overrideText?: string) => {
    const trimmed = (overrideText ?? chatInput).trim();
    if (!trimmed || chatLoading) return;

    const nextHistory: { role: 'user' | 'assistant'; content: string }[] = [
      ...conversationHistory,
      { role: 'user', content: trimmed },
    ];
    setConversationHistory(nextHistory);
    setChatInput('');
    setChatLoading(true);

    const systemPrompt =
      "You are the FoundarOS assistant on the marketing landing page. FoundarOS is an AI platform that helps first-time aspiring entrepreneurs find out if their business idea is fundable — before they quit their day job. The core product is Gap Radar: a 15-minute free fundability assessment that shows exactly where an idea stands and what gaps to fix. Pricing: free assessment always available; paid tier is $99 one-time for deeper coaching and a full readiness report. Target user: someone still in their 9-to-5 job with a side idea they haven’t acted on yet. Keep answers short (2–3 sentences), helpful, and encouraging. If you don’t know something, say so honestly and suggest they take the free assessment.";

    try {
      const ws = (window as any).__workspaceDb;
      if (!ws || !ws.token) {
        throw new Error('workspace-db-unavailable');
      }
      const res = await fetch(
        `/proxy/openai/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Workspace-DB-Token': ws.token,
          },
          body: JSON.stringify({
            model: 'gpt-5.6-luna',
            reasoning_effort: 'none',
            max_completion_tokens: 300,
            messages: [{ role: 'system', content: systemPrompt }, ...nextHistory],
          }),
        },
      );

      if (!res.ok) throw new Error(`proxy-${res.status}`);
      const data = await res.json();
      const reply: string =
        data?.choices?.[0]?.message?.content?.trim() ||
        "Sorry, I couldn’t generate a response just now. Try the free 15-minute assessment to see where your idea stands.";
      setConversationHistory((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      console.error('[EmailGate] chatbot error:', err);
      setConversationHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            "I’m having trouble connecting right now. In the meantime, you can take the free 15-minute Gap Radar assessment to see if your idea is fundable.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const checkExistingSession = async () => {
    // `?as=visitor` preview: never adopt a stored session — skip straight to the
    // logged-out email form instead of jumping to the empty 'complete' state.
    const forceVisitor = typeof window !== 'undefined' && (window as any).__AUDOS_FORCE_VISITOR__ === true;
    const sessionKey = `space_session_${spaceId}`;
    const existingSession = forceVisitor ? null : localStorage.getItem(sessionKey);

    if (existingSession) {
      try {
        const session = JSON.parse(existingSession);
        const effectiveSessionId = session.workspaceSessionId || session.id;

        if (effectiveSessionId) {
          if (workspaceId) {
            try {
              const otpConfig = await fetchOtpSpaceConfig(workspaceId);

              if (otpConfig.enabled) {
                setOtpEnabled(true);
                const checkRes = await fetch(`/api/auth/otp/space/check-session?workspaceId=${workspaceId}&sessionUuid=${encodeURIComponent(effectiveSessionId)}`, {
                  credentials: 'include'
                });
                const checkData = await checkRes.json();

                if (checkData.verified) {
                  setSessionId(effectiveSessionId);
                  setStep('complete');
                  return;
                } else {
                  setStep('email');
                  return;
                }
              }
            } catch (e) {
              console.log('[EmailGate] OTP config check failed, using simple mode');
            }
          }

          setSessionId(effectiveSessionId);
          setStep('complete');
          return;
        }
      } catch (e) {
        console.error('Failed to parse session:', e);
      }
    }

    if (workspaceId) {
      try {
        const otpConfig = await fetchOtpSpaceConfig(workspaceId);
        setOtpEnabled(otpConfig.enabled || false);
      } catch (e) {
        setOtpEnabled(false);
      }
    }

    setStep('email');
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const normalizedEmail = email.toLowerCase().trim();

      if (otpEnabled && workspaceId) {
        const attribution = getAttribution();
        const visitorId = getVisitorId();
        const sessionId = `csess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

        const registerRes = await fetchWithTimeout(`/api/space/${spaceId}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: normalizedEmail,
            sessionId,
            visitorId,
            attribution,
            metadata: {},
            workspaceId,
            marketingConsent,
          }),
        });

        const { data: registerResult, rawText: registerRawText } =
          await parseResponseBody(registerRes);

        if (!registerRes.ok) {
          console.error('[EmailGate] register failed', {
            status: registerRes.status,
            body: registerResult ?? registerRawText.slice(0, 200),
          });
          setError(
            describeResponseFailure(
              registerRes,
              registerResult,
              registerRawText,
              'Failed to create session. Please try again.',
            ),
          );
          setLoading(false);
          return;
        }

        if (!isRecord(registerResult)) {
          console.error('[EmailGate] register returned an unparseable body', {
            status: registerRes.status,
            rawText: registerRawText.slice(0, 200),
          });
          setError('The server returned an unexpected response. Please try again.');
          setLoading(false);
          return;
        }

        const registerBody = registerResult as SpaceRegisterResponseBody;
        const wsSessionId = registerBody.workspaceSessionId;
        setPendingSessionId(wsSessionId);

        if (typeof (window as any).fbq === 'function' && (window as any).__META_PIXEL_ID__) {
          (window as any).fbq('init', (window as any).__META_PIXEL_ID__, { em: normalizedEmail.toLowerCase().trim() });
        }
        fireLeadEventWithRetry(normalizedEmail);

        const sessionKey = `space_session_${spaceId}`;
        const pendingSession = {
          id: wsSessionId,
          workspaceSessionId: wsSessionId,
          email: normalizedEmail,
          contactId: registerResult.contactId || null,
          timestamp: Date.now(),
          verified: registerResult.isReturningUser === false,
          isReturningUser: !!registerResult.isReturningUser,
          metadata: registerResult.metadata || {},
        };
        localStorage.setItem(sessionKey, JSON.stringify(pendingSession));

        if (registerResult.isReturningUser === false) {
          try {
            window.dispatchEvent(new CustomEvent('audos:session-established', {
              detail: { workspaceSessionId: wsSessionId, email: normalizedEmail },
            }));
          } catch (e) {}

          setSessionId(wsSessionId);
          completeGateEntry();
          setLoading(false);
          return;
        }

        const response = await fetchWithTimeout('/api/auth/otp/space/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: normalizedEmail, workspaceId, sessionUuid: wsSessionId }),
        });

        const { data: otpResult, rawText: otpRawText } = await parseResponseBody(response);

        if (!response.ok) {
          console.error('[EmailGate] otp send failed', {
            status: response.status,
            body: otpResult ?? otpRawText.slice(0, 200),
          });
          setError(
            describeResponseFailure(
              response,
              otpResult,
              otpRawText,
              'Failed to send code. Please try again.',
            ),
          );
          setLoading(false);
          return;
        }

        const otpBody: OtpResponseBody = isRecord(otpResult) ? otpResult : {};
        setResendCooldown(otpBody.resendCooldown ?? 60);
        setStep('code');
      } else {
        await registerSession();
      }
    } catch (err) {
      console.error('[EmailGate] Network error in handleEmailSubmit:', err);
      setError(
        isAbortError(err)
          ? 'The request timed out. Please try again.'
          : 'Connection error. Please check your internet connection and try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (code.length !== 4) {
      setError('Please enter the 4-digit code');
      return;
    }

    setError('');
    setLoading(true);

    try {
      if (!pendingSessionId) {
        setError('Session expired. Please start over.');
        setStep('email');
        setLoading(false);
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const response = await fetch('/api/auth/otp/space/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail, code, workspaceId, sessionUuid: pendingSessionId }),
      });

      const { data: verifyResult, rawText: verifyRawText } = await parseResponseBody(response);
      const verifyBody: OtpResponseBody = isRecord(verifyResult) ? verifyResult : {};

      if (!response.ok || !verifyBody.success) {
        console.error('[EmailGate] otp verify failed', {
          status: response.status,
          body: verifyResult ?? verifyRawText.slice(0, 200),
        });
        if (typeof verifyBody.attemptsRemaining === 'number') {
          setError(`Invalid code. ${verifyBody.attemptsRemaining} attempts remaining.`);
        } else {
          setError(
            describeResponseFailure(
              response,
              verifyResult,
              verifyRawText,
              'Invalid code. Please try again.',
            ),
          );
        }
        setLoading(false);
        return;
      }

      await completeVerifiedSession();
    } catch (err) {
      console.error('[EmailGate] Network error in handleCodeSubmit:', err);
      setError('Connection error. Please check your internet connection and try again.');
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0 || !pendingSessionId) return;

    setLoading(true);
    setError('');

    try {
      const normalizedEmail = email.toLowerCase().trim();
      const response = await fetch('/api/auth/otp/space/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail, workspaceId, sessionUuid: pendingSessionId }),
      });

      const { data: resendResult, rawText: resendRawText } = await parseResponseBody(response);

      if (response.ok) {
        const resendBody: OtpResponseBody = isRecord(resendResult) ? resendResult : {};
        setResendCooldown(resendBody.resendCooldown ?? 60);
        setCode('');
      } else {
        console.error('[EmailGate] otp resend failed', {
          status: response.status,
          body: resendResult ?? resendRawText.slice(0, 200),
        });
        setError(
          describeResponseFailure(
            response,
            resendResult,
            resendRawText,
            'Failed to resend code. Please try again.',
          ),
        );
      }
    } catch (err) {
      console.error('[EmailGate] Network error in handleResendCode:', err);
      setError('Connection error. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const completeVerifiedSession = async () => {
    const sessionKey = `space_session_${spaceId}`;
    const normalizedEmail = email.toLowerCase().trim();
    let verifiedMetadata: Record<string, unknown> = {};
    try {
      const existingSession = localStorage.getItem(sessionKey);
      if (existingSession) {
        const parsed = JSON.parse(existingSession);
        if (parsed.metadata) verifiedMetadata = parsed.metadata;
      }
    } catch {}
    const session = {
      id: pendingSessionId,
      workspaceSessionId: pendingSessionId,
      email: normalizedEmail,
      timestamp: Date.now(),
      verified: true,
      isReturningUser: true,
      metadata: verifiedMetadata,
    };
    localStorage.setItem(sessionKey, JSON.stringify(session));

    try {
      window.dispatchEvent(new CustomEvent('audos:session-established', {
        detail: {
          workspaceSessionId: pendingSessionId,
          email: normalizedEmail,
        }
      }));
    } catch (e) {}

    setSessionId(pendingSessionId!);
    completeGateEntry();
    setLoading(false);
  };

  const registerSession = async () => {
    const normalizedEmail = email.toLowerCase().trim();

    // Template previews have no workspace, so the server-side register can
    // never succeed ("Could not resolve workspace from space."). Create a
    // local preview session with the entered email instead.
    if (isTemplatePreview) {
      const previewId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const previewSession = {
        id: previewId,
        workspaceSessionId: previewId,
        email: normalizedEmail,
        isGuest: true,
        timestamp: Date.now(),
        verified: true,
        metadata: {},
      };
      localStorage.setItem(`space_session_${spaceId}`, JSON.stringify(previewSession));
      try {
        window.dispatchEvent(new CustomEvent('audos:session-established', {
          detail: { workspaceSessionId: previewId, email: normalizedEmail, isGuest: true },
        }));
      } catch (e) {}
      setSessionId(previewId);
      completeGateEntry();
      setLoading(false);
      return;
    }

    const attribution = getAttribution();
    const visitorId = getVisitorId();
    const sessionId = `csess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const response = await fetchWithTimeout(`/api/space/${spaceId}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        sessionId,
        visitorId,
        attribution,
        metadata: {},
        workspaceId,
        marketingConsent,
      }),
    });

    const { data: registerResult, rawText: registerRawText } = await parseResponseBody(response);

    if (!response.ok) {
      console.error('[EmailGate] registerSession failed', {
        status: response.status,
        body: registerResult ?? registerRawText.slice(0, 200),
      });
      setError(
        describeResponseFailure(
          response,
          registerResult,
          registerRawText,
          'Registration failed. Please try again.',
        ),
      );
      setLoading(false);
      return;
    }

    if (!isRecord(registerResult)) {
      console.error('[EmailGate] registerSession returned an unparseable body', {
        status: response.status,
        rawText: registerRawText.slice(0, 200),
      });
      setError('The server returned an unexpected response. Please try again.');
      setLoading(false);
      return;
    }

    const registerBody = registerResult as SpaceRegisterResponseBody;
    const effectiveSessionId =
      registerBody.workspaceSessionId ||
      `anon_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const sessionKey = `space_session_${spaceId}`;
    const session = {
      id: effectiveSessionId,
      workspaceSessionId: registerBody.workspaceSessionId || effectiveSessionId,
      email: normalizedEmail,
      contactId: registerBody.contactId || null,
      timestamp: Date.now(),
      isReturningUser: !!registerBody.isReturningUser,
      metadata: registerBody.metadata || {},
    };
    localStorage.setItem(sessionKey, JSON.stringify(session));

    try {
      window.dispatchEvent(new CustomEvent('audos:session-established', {
        detail: {
          workspaceSessionId: registerBody.workspaceSessionId,
          email: normalizedEmail,
        }
      }));
    } catch (e) {}

    if (typeof (window as any).fbq === 'function' && (window as any).__META_PIXEL_ID__) {
      (window as any).fbq('init', (window as any).__META_PIXEL_ID__, { em: normalizedEmail.toLowerCase().trim() });
    }
    fireLeadEventWithRetry(normalizedEmail);

    setSessionId(effectiveSessionId);
    completeGateEntry();
    setLoading(false);
  };

  const handleGuestMode = async () => {
    setError('');
    setLoading(true);

    try {
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const sessionKey = `space_session_${spaceId}`;
      const guestSession = {
        id: guestId,
        workspaceSessionId: guestId,
        email: null,
        isGuest: true,
        timestamp: Date.now(),
        verified: true,
        metadata: {},
      };
      localStorage.setItem(sessionKey, JSON.stringify(guestSession));

      try {
        window.dispatchEvent(new CustomEvent('audos:session-established', {
          detail: { workspaceSessionId: guestId, isGuest: true },
        }));
      } catch (e) {}

      setSessionId(guestId);
      completeGateEntry();
    } catch (err) {
      setError('Could not continue as guest. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // `?as=visitor` preview forces the signed-out view even after a real
  // sign-in: the gate would render nothing and the visitor would land on the
  // blank-screen lock instead of the space. The session write is real (only
  // reads are shadowed under the forced-visitor preview), so drop the
  // as=visitor param and reload — the fresh session is adopted and the
  // signed-in space opens.
  const completeGateEntry = () => {
    try {
      if (typeof window !== 'undefined' && (window as any).__AUDOS_FORCE_VISITOR__ === true) {
        const url = new URL(window.location.href);
        url.searchParams.delete('as');
        window.location.replace(url.toString());
        return;
      }
    } catch (e) {}
    setStep('complete');
  };

  const handleSocialLogin = (provider: string) => {
    // Strip the forced-visitor preview flag from the OAuth return URL so the
    // visitor comes back to the signed-in space, not the forced signed-out view.
    let socialReturnTo = window.location.href;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('as');
      socialReturnTo = url.toString();
    } catch (e) {}
    const returnUrl = encodeURIComponent(socialReturnTo);
    const url = workspaceId
      ? `/api/auth/social/${provider}?workspaceId=${workspaceId}&spaceId=${spaceId}&returnUrl=${returnUrl}`
      : `/api/auth/social/${provider}?spaceId=${spaceId}&returnUrl=${returnUrl}`;
    window.location.href = url;
  };

  function getVisitorId(): string {
    const key = 'audos_visitor_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `v_${Math.random().toString(36).substring(2)}_${Date.now()}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  function getAttrCookie(): Record<string, string> | null {
    try {
      const raw = localStorage.getItem('audos_attribution');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setAttrCookie(jsonStr: string) {
    const ATTR_COOKIE_NAME = 'audos_attr';
    const MULTI_LEVEL_TLDS = ['co.uk','co.za','co.in','co.jp','co.kr','co.nz','com.au','com.br','com.cn','com.mx','com.sg','com.hk','com.tw','com.ar','com.co','com.eg','com.my','com.ng','com.pe','com.ph','com.pk','com.tr','com.ua','com.vn','org.uk','org.au','net.au','net.uk','ac.uk','gov.uk','gov.au','edu.au','ne.jp','or.jp'];
    const hostname = window.location.hostname;
    const platformDomains = [
      'replit.dev', 'replit.app', 'repl.co',
      'github.io', 'herokuapp.com', 'netlify.app', 'vercel.app',
      'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
      'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
      'ngrok.io', 'ngrok.app', 'railway.app', 'render.com',
      'fly.dev', 'deno.dev', 'glitch.me'
    ];
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
    let isPlatform = false;
    for (let i = 0; i < platformDomains.length; i++) {
      if (hostname.endsWith('.' + platformDomains[i]) || hostname === platformDomains[i]) {
        isPlatform = true;
        break;
      }
    }
    let domainPart = '';
    if (!isLocalhost && !isIP && !isPlatform) {
      const parts = hostname.split('.');
      const lastTwo = parts.slice(-2).join('.');
      if (MULTI_LEVEL_TLDS.indexOf(lastTwo) !== -1 && parts.length >= 3) {
        domainPart = '; domain=.' + parts.slice(-3).join('.');
      } else if (parts.length >= 2) {
        domainPart = '; domain=.' + parts.slice(-2).join('.');
      }
    }
    const isSecure = window.location.protocol === 'https:';
    const secureFlag = isSecure ? '; Secure' : '';
    document.cookie = ATTR_COOKIE_NAME + '=' + encodeURIComponent(jsonStr) + '; max-age=86400; path=/' + domainPart + '; SameSite=Lax' + secureFlag;
  }

  function storeAttribution() {
    const params = new URLSearchParams(window.location.search);
    const hasUtm = params.has('utm_source') || params.has('utm_medium') || params.has('utm_campaign') || params.has('fbclid') || params.has('gclid') || params.has('ref');
    if (!hasUtm) return;

    const attr: Record<string, string> = { capturedAt: Date.now().toString() };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref'].forEach(p => {
      const v = params.get(p);
      if (v) attr[p === 'ref' ? 'referrer' : p.replace('utm_', 'utm').replace('_', '')] = v;
    });
    if (document.referrer) attr.httpReferrer = document.referrer;

    try {
      localStorage.setItem('audos_attribution', JSON.stringify(attr));
    } catch {}

    const cookieAttr: Record<string, string> = { capturedAt: new Date().toISOString() };
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref'].forEach(p => {
      const v = params.get(p);
      if (v) cookieAttr[p] = v;
    });
    if (document.referrer) cookieAttr.httpReferrer = document.referrer;
    try {
      setAttrCookie(JSON.stringify(cookieAttr));
      console.log('[EmailGate] Attribution stored in cookie:', cookieAttr);
    } catch {}
  }

  async function fireLeadEventWithRetry(emailAddr: string, attempt = 0) {
    const normalizedEmail = emailAddr.toLowerCase().trim();
    // Task #1480: stable conversion id used for both client-side rdt('track','Lead', …)
    // and server-side Reddit CAPI so they dedupe.
    const conversionId = `lead_${spaceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const tryFireFbq = (): boolean => {
      if (typeof (window as any).fbq === 'function') {
        (window as any).fbq('track', 'Lead', {
          content_name: 'Email Capture',
          content_category: 'space',
        }, {
          em: normalizedEmail
        });
        console.log('[EmailGate] Meta Pixel Lead event fired for:', emailAddr);
        return true;
      }
      return false;
    };

    if (!tryFireFbq()) {
      console.log('[EmailGate] fbq not ready, will retry with exponential backoff...');
      const maxRetries = 5;
      const delays = [100, 200, 400, 800, 1600];

      const retryWithBackoff = (retryAttempt: number) => {
        if (retryAttempt >= maxRetries) {
          console.warn('[EmailGate] Failed to fire Lead event - fbq never loaded after 5 retries');
          return;
        }
        setTimeout(() => {
          if (tryFireFbq()) {
            console.log(`[EmailGate] Lead event fired after ${retryAttempt + 1} retries`);
          } else {
            retryWithBackoff(retryAttempt + 1);
          }
        }, delays[retryAttempt]);
      };

      retryWithBackoff(0);
    }

    // Task #1480: Reddit Pixel Lead (parallel to Meta). We call window.rdt
    // directly — the queue stub installed by the injected PageVisit snippet
    // (Task #1456, already live) handles late pixel.js loads, so we don’t
    // need the exponential-backoff retry the Meta path uses. Re-running
    // rdt('init', …, { email, externalId }) propagates advanced matching for
    // the subsequent Lead event (Reddit "Step 3: Set up match keys").
    try {
      const rdt = (window as any).rdt;
      const pixelId = (window as any).__REDDIT_PIXEL_ID__;
      if (typeof rdt === 'function') {
        if (pixelId) {
          rdt('init', pixelId, { email: normalizedEmail, externalId: getVisitorId() });
        }
        rdt('track', 'Lead', { conversionId });
        console.log('[EmailGate] Reddit Pixel Lead event fired (conversionId=' + conversionId + ')');
      }
    } catch (e) {
      console.warn('[EmailGate] Reddit Pixel Lead failed:', e);
    }

    if (!workspaceId) return;
    try {
      await fetch(`/api/space/${spaceId}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'lead',
          sessionId: `lead_${Date.now()}`,
          visitorId: getVisitorId(),
          // Task #1480: include conversionId so server-side Reddit CAPI dedupes
          // with the client-side rdt('track','Lead',…) fired above.
          conversionId,
          metadata: { email: emailAddr, conversionId, ...getAttribution() },
          workspaceId,
        }),
      });
    } catch {
      if (attempt < 2) setTimeout(() => fireLeadEventWithRetry(emailAddr, attempt + 1), 2000);
    }
  }

  const getAttribution = () => {
    const params = new URLSearchParams(window.location.search);

    const urlAttribution: Record<string, string | null> = {};
    if (params.get('utm_source')) urlAttribution.utmSource = params.get('utm_source');
    if (params.get('utm_medium')) urlAttribution.utmMedium = params.get('utm_medium');
    if (params.get('utm_campaign')) urlAttribution.utmCampaign = params.get('utm_campaign');
    if (params.get('utm_content')) urlAttribution.utmContent = params.get('utm_content');
    if (params.get('utm_term')) urlAttribution.utmTerm = params.get('utm_term');
    if (params.get('fbclid')) urlAttribution.fbclid = params.get('fbclid');
    if (params.get('gclid')) urlAttribution.gclid = params.get('gclid');
    if (params.get('ref')) urlAttribution.referrer = params.get('ref');
    if (document.referrer) urlAttribution.httpReferrer = document.referrer;

    const storedAttr = getAttrCookie();

    const merged: Record<string, string | null> = {};
    if (storedAttr) {
      for (const [key, value] of Object.entries(storedAttr)) {
        if (value && key !== 'capturedAt') merged[key] = value;
      }
    }
    for (const [key, value] of Object.entries(urlAttribution)) {
      if (value) merged[key] = value;
    }

    return Object.keys(merged).length > 0 ? merged : null;
  };

  const runtimeConfig = (window as any).__SPACE_CONFIG__;
  const runtimeDesktop = runtimeConfig?.desktop || {};
  const runtimeThemeTokens = runtimeDesktop?.themeTokens || {};
  const runtimeBranding = runtimeDesktop?.branding || {};
  // Founder-selected typography flows through themeTokens.typography (kickoff →
  // compiled __SPACE_CONFIG__). Derive the body/heading font stacks here so the
  // landing renders the chosen fonts instead of a hard-coded system-ui.
  const typography =
    themeTokens?.typography || runtimeThemeTokens?.typography || {};
  const bodyFontStack = typography.bodyFont
    ? `"${typography.bodyFont}", system-ui, -apple-system, sans-serif`
    : 'system-ui, -apple-system, sans-serif';
  const headingFontStack = typography.headingFont
    ? `"${typography.headingFont}", system-ui, -apple-system, sans-serif`
    : bodyFontStack;

  // Load the workspace’s configured fonts at runtime as a FALLBACK. The static
  // HTML shell preloads the workspace’s own fonts in <head>, so first check
  // whether an existing Google Fonts stylesheet already covers every family —
  // injecting a second css2 stylesheet for the same families only re-downloads
  // identical CSS (QA replay-bug-msyk7o99-752u: 8 hits to the css2 endpoint
  // instead of 1–2). When we do inject, compare the resolved `href` PROPERTY
  // rather than getAttribute('href') — the attribute read came back empty on
  // each run, which defeated the old guard — and skip the assignment when the
  // value is unchanged so the browser never refetches the stylesheet.
  useEffect(() => {
    const families = Array.from(
      new Set([typography?.headingFont, typography?.bodyFont].filter(Boolean))
    ) as string[];
    if (families.length === 0) return;
    const id = 'eg-dynamic-font-link';
    const familyParams = families.map(
      (f) => `family=${String(f).replace(/\s+/g, '+')}`
    );
    const href = `https://fonts.googleapis.com/css2?${familyParams
      .map((p) => `${p}:wght@400;500;600;700`)
      .join('&')}&display=swap`;

    const coveredByExistingLink = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[href*="fonts.googleapis.com/css2"]')
    ).some(
      (existing) =>
        existing.id !== id &&
        familyParams.every(
          (p) =>
            existing.href.includes(`${p}:`) ||
            existing.href.includes(`${p}&`) ||
            existing.href.endsWith(p)
        )
    );
    if (coveredByExistingLink) return;

    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== href) {
      link.href = href;
    }
  }, [typography?.headingFont, typography?.bodyFont]);
  // Kickoff stores the manually selected color in palette.primary. Shell accent
  // is derived from palette.highlight and is only a fallback for older spaces.
  const selectedAccentColor = normalizeHexColor(
    themeTokens?.shell?.accentColor ||
      runtimeThemeTokens?.shell?.accentColor ||
      runtimeDesktop?.theme?.accentColor,
  );
  const palette =
    themeTokens?.palette ||
    runtimeThemeTokens?.palette ||
    branding?.palette ||
    runtimeBranding?.palette ||
    branding?.colors ||
    runtimeBranding?.colors ||
    {};
  const palettePrimary = normalizeHexColor(palette?.primary);
  const primaryColor = palettePrimary || selectedAccentColor || '#1e293b';
  const highlightColor = normalizeHexColor(palette?.highlight || palette?.secondary) || primaryColor;
  const contrastColor = palette?.contrast || '#ffffff';
  const accentGreen = palette?.accent || '#10B981';
  // Rotating icon-chip treatment used across the dimension cards, step badges,
  // platform cards, and persona cards — mirrors the pitch deck’s varied
  // purple/teal/amber/green coding instead of one flat accent everywhere.
  const accentCycle = [
    { bg: colorWithAlpha(primaryColor, 0.14), fg: palette?.secondary || primaryColor },
    { bg: colorWithAlpha(highlightColor, 0.14), fg: highlightColor },
    { bg: colorWithAlpha(contrastColor, 0.14), fg: contrastColor },
    { bg: colorWithAlpha(accentGreen, 0.14), fg: accentGreen },
  ];
  const brandName = branding?.name || 'Welcome';
  const tagline = branding?.tagline || 'Get started today.';
  const logoUrl = branding?.logoUrl;
  const bgLight = palette?.surfaces?.page || colorWithAlpha(primaryColor, 0.04);
  const bgMedium = palette?.surfaces?.accentSoft || colorWithAlpha(primaryColor, 0.08);
  const borderColor = palette?.surfaces?.border || colorWithAlpha(primaryColor, 0.15);
  const panelColor = themeTokens?.shell?.panelBackground || palette?.surfaces?.panel || '#ffffff';
  const panelStrongColor =
    themeTokens?.shell?.panelStrongBackground || palette?.surfaces?.panelStrong || '#ffffff';
  const pageBackground = themeTokens?.shell?.pageBackground || palette?.surfaces?.page || '#ffffff';
  const sectionBackground = palette?.surfaces?.muted || '#f9fafb';
  const gateGradient =
    themeTokens?.shell?.gateBackground ||
    `linear-gradient(180deg, ${
      palette?.surfaces?.gradientFrom || bgLight
    } 0%, ${
      palette?.surfaces?.gradientVia || '#ffffff'
    } 55%, ${
      palette?.surfaces?.gradientTo || '#ffffff'
    } 100%)`;
  const textPrimary = palette?.text?.primary || palette?.text?.brand || primaryColor;
  const textMuted = palette?.text?.secondary || colorWithAlpha(primaryColor, 0.55);
  const textSubtle = palette?.text?.muted || colorWithAlpha(primaryColor, 0.35);
  const dangerColor = palette?.semantic?.danger || '#dc2626';
  const selectedAccentOverridesPalette = !palettePrimary && !!selectedAccentColor;
  const onPrimary = selectedAccentOverridesPalette
    ? readableTextColor(primaryColor)
    : palette?.text?.onPrimary || readableTextColor(primaryColor);
  const onHighlight = selectedAccentOverridesPalette
    ? readableTextColor(highlightColor)
    : palette?.text?.onHighlight || onPrimary;
  // Dark, glow-based hero background built from the workspace palette (never
  // hardcoded brand hex): a soft radial bloom of the primary color over the
  // page’s own dark surface, matching the pitch-deck’s moody, instrument-panel
  // aesthetic rather than a loud multi-hue gradient.
  const heroGradient = `radial-gradient(1100px 620px at 82% -8%, ${colorWithAlpha(
    primaryColor,
    0.38
  )}, transparent 62%), radial-gradient(760px 520px at 6% 20%, ${colorWithAlpha(
    contrastColor,
    0.14
  )}, transparent 65%), linear-gradient(180deg, ${pageBackground} 0%, ${
    palette?.surfaces?.pageAlt || pageBackground
  } 100%)`;
  const brandGradient = `linear-gradient(135deg, ${primaryColor} 0%, ${highlightColor} 100%)`;
  // Hero copy + CTAs sit on the gradient/video, so they stay white over a
  // dark scrim. The scrim deepens for light primaries so text stays legible
  // regardless of the workspace palette (contrast may resolve to white).
  const primaryRgb = hexToRgb(primaryColor);
  const primaryIsLight = primaryRgb
    ? (0.2126 * primaryRgb.r + 0.7152 * primaryRgb.g + 0.0722 * primaryRgb.b) / 255 > 0.62
    : false;
  const heroScrim = `linear-gradient(105deg, rgba(0,0,0,${primaryIsLight ? 0.6 : 0.42}) 0%, rgba(0,0,0,${primaryIsLight ? 0.42 : 0.18}) 48%, rgba(0,0,0,0) 88%)`;
  // Hero video intentionally disabled per redesign brief — the hero now runs
  // on the dark gradient + readiness-gauge treatment instead of a video, to
  // match the pitch deck. Kept as `false` (rather than deleted) so any stray
  // `heroHasVideo` references below still resolve safely.
  const heroHasVideo = false;
  const loginPanelId = 'email-gate-login-panel';

  const openLogin = (mode: 'assess' | 'login') => {
    setLoginMode(mode);
    setLoginOpen(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="input-email"]');
      input?.focus();
    }, 0);
  };

  // Landing copy targets the beachhead persona: a 9-to-5 professional with a
  // side idea, researching startup funding, unsure what "ready" even means.
  const scoreCategories = [
    {
      title: 'Idea Clarity',
      desc: 'Can you explain the problem, the fix, and why anyone pays — in two sentences? Investors decide in the first two.',
      index: '01 / IDEA',
      barWidth: '82%',
    },
    {
      title: 'Market Validation',
      desc: 'Evidence that real people want this — beyond your friends saying “cool idea”.',
      index: '02 / MARKET',
      barWidth: '58%',
    },
    {
      title: 'Business Model',
      desc: 'Whether your pricing and numbers survive contact with someone who reads them for a living.',
      index: '03 / MODEL',
      barWidth: '47%',
    },
    {
      title: 'Investor Readiness',
      desc: 'What you’d need in hand before a funding conversation — and how much of it you have today.',
      index: '04 / READY',
      barWidth: '65%',
    },
  ];
  const googledWall = [
    { index: '01 / TOO VAGUE', title: '“Network more. Build traction.”', desc: 'Great. What does that mean for your idea, this week, with a full-time job? Generic advice never comes with a starting point.' },
    { index: '02 / TOO FAR AHEAD', title: 'Written for funded founders', desc: 'Most guides start at “when you meet investors”. You need to know whether it’s worth booking that meeting at all.' },
    { index: '03 / NO YARDSTICK', title: 'Nobody defines “ready”', desc: 'Investors screen against real criteria. If you can’t see the checklist, you can’t tell whether you’re 80% there or 8%.' },
  ];
  const outputs = [
    { title: 'Your Readiness Score', desc: 'One number out of 100, benchmarked against what investors expect from someone at your stage — not from a funded founder three rounds ahead of you.' },
    { title: 'Your gaps, ranked', desc: 'The specific things that would make an investor pass today, in priority order — with why each one matters and how to fix it.' },
    { title: 'What to do next', desc: 'A plain-English action list you can work through on nights and weekends — before you touch your savings or your notice letter.' },
  ];
  // Restored per founder request (Aug 2026): the platform roadmap, persona,
  // and $99 pricing sections. Copy mirrors the live Gap Radar app — its
  // Funding Readiness Pack paywall (UNLOCK_PRICE_CENTS = 9900) and its
  // coming-soon roadmap teaser — so the landing sells what the app ships.
  const platformModules = [
    {
      status: 'live',
      title: 'Idea Discovery',
      desc: "\u0044on\u0027t have an idea yet? We help you find one — from who you already are. Answer a short questionnaire, get a personalised Opportunity Profile, and walk away with a concept worth pursuing.",
      items: [] as string[],
    },
    {
      status: 'live',
      title: 'Gap Radar',
      desc: 'Already have an idea? Score its fundability in 15 minutes. Get your Readiness Score, see every gap investors would flag, and get a step-by-step action plan to fix them.',
      items: [] as string[],
    },
    {
      status: 'soon',
      title: 'Business Operations',
      desc: '',
      items: ['SOPs & policies', 'HR handbook', 'Vendor agreements', 'KPI dashboards'],
    },
    {
      status: 'soon',
      title: 'AI Coaches',
      desc: '',
      items: ['CFO AI', 'Grant Coach', 'Pitch Coach', 'HR Manager'],
    },
    {
      status: 'soon',
      title: 'Funding Marketplace',
      desc: '',
      items: ['Grants & accelerators', 'Angels & VCs', 'Matched by country & stage'],
    },
  ];
  const personas = [
    {
      stage: 'Pre-incorporation',
      title: 'Aspiring entrepreneurs',
      desc: "You\u0027re sitting on an idea — or you haven\u0027t found one yet. Start with Idea Discovery to turn your experience into a real concept, then use Gap Radar to find out if it\u0027s fundable before you make any big moves.",
      soon: false,
    },
    {
      stage: '0–18 months',
      title: 'Early-stage startups',
      desc: 'You’ve validated the idea and now need the documents to move forward — business plan, pitch deck, financial model. Stop Googling templates and start generating.',
      soon: false,
    },
    {
      stage: 'Raising now',
      title: 'Small businesses seeking funding',
      desc: `You’ve been operating but now want to raise. ${brandName} scores your readiness, identifies exactly what investors will challenge, and helps you fix it before the conversation.`,
      soon: false,
    },
    {
      stage: 'Post-investment',
      title: 'Funded & scaling',
      desc: 'You’ve raised your first round. Now build the systems that let you actually run the company — SOPs, HR handbook, vendor agreements, KPI dashboards, and board templates.',
      soon: true,
    },
  ];
  const freeFeatures = [
    'The full 30-question assessment',
    'Your Readiness Score out of 100',
    'One surface-level gap you can work on now',
    'A count of the critical gaps investors will flag',
  ];
  const packDocuments = [
    'Every critical gap, revealed and ranked by priority',
    'Generated Business Plan',
    'Editable, presentation-ready Pitch Deck in your brand',
    '3-year Financial Model',
    'Grant Application Assistant',
    'Step-by-step Action Plan',
    'Interactive AI Pitch Coach — practice with feedback',
  ];
  const conciergeFeatures = [
    'Everything in the Funding Readiness Pack ($99 value)',
    '45-minute 1:1 session with the founder',
    'Live review of your assessment answers and gaps',
    'Personalised action plan discussed on the call',
    'Email follow-up notes and next steps',
  ];
  const faqs = [
    { q: 'Is this a subscription?', a: 'No. FoundarOS Fundraising Readiness is offered as a one-time $99 purchase. There are no recurring charges. Business Operations AI (coming soon) will be a separate optional subscription.' },
    { q: 'What happens after I pay?', a: 'You’ll receive immediate confirmation and access instructions. You’ll then complete a short founder onboarding process before entering your FoundarOS workspace and beginning your fundraising readiness journey.' },
    { q: 'Do I need to be an established business?', a: 'No. FoundarOS can support founders at different stages, including idea-stage and early-stage businesses.' },
    { q: 'Do I need financial or technical expertise?', a: 'No. FoundarOS guides you through the process and helps structure the information you provide.' },
    { q: 'Is FoundarOS an investor or funding platform?', a: 'No. FoundarOS helps you prepare your business and materials; it does not guarantee investment or funding.' },
    { q: 'What is ALTANATIVEZ HAVEN LIMITED?', a: 'ALTANATIVEZ HAVEN LIMITED is the legal entity behind FoundarOS. You may see this name on your bank statement or card receipt when paying via Flutterwave.' },
    { q: 'How long does this take?', a: 'About 10–15 minutes. Thirty focused questions about your idea, your market, and your numbers — no essays, no spreadsheets, no pitch deck required. You can do it on your phone and save your progress if you get pulled away.' },
    { q: 'Is it actually free?', a: 'Yes. The full assessment, your Readiness Score, and one surface-level gap are free — no credit card. Your results also show how many critical gaps investors will flag without revealing those details. A one-time $99 upgrade unlocks every critical gap, a step-by-step action plan, and personalized founder documents; the optional $249 Founder Concierge package also adds a personal 45-minute 1:1 session with the founder.' },
    { q: 'Do I need a business plan or pitch deck first?', a: 'No — that’s the point. You answer questions about the idea as it stands today, and the assessment tells you which of those documents you actually need and what has to be true before they’re worth writing.' },
    { q: 'What if my idea scores badly?', a: 'Then you found out for the cost of 15 minutes instead of your savings. Your free result still gives you a clear score and one practical starting point; unlocking the full report shows every critical weakness, why an investor would care, and the plan to fix it.' },
    { q: 'Is my idea kept private?', a: 'Yes. Your answers and results are private to your account. We don’t share or sell your data, and you can delete your account and everything in it at any time.' },
  ];

  // Presentational icons paired with the content arrays above by index.
  // Kept separate so the copy arrays stay plain for per-workspace rewrites.
  const scoreCategoryIcons = [Lightbulb, Users, Calculator, Rocket];
  const outputIcons = [Gauge, ClipboardList, FileText];
  const platformModuleIcons = [Lightbulb, Gauge, Briefcase, Bot, DollarSign];
  const personaIcons = [Lightbulb, TrendingUp, DollarSign, Building2];

  // A monochrome onboarding mark (path marker ".mono.") can be recolored for
  // contrast; any other logo (legacy colored, knockout, dimensional) is shown
  // as-is on a neutral chip so it keeps working without clashing.
  const logoIsMono =
    typeof logoUrl === 'string' && /\.mono\.[a-z0-9]+(?:[?#].*)?$/i.test(logoUrl);

  // Centralized logo "block/chip": the fill derives from the current theme
  // tokens and the mark auto-picks white/black for contrast, so swapping the
  // brand palette recolors the block without ever regenerating the logo.
  const BrandMark = ({
    size = 40,
    blockColor,
    radiusScale = 0.26,
  }: { size?: number; blockColor?: string; radiusScale?: number }) => {
    const fill = blockColor || primaryColor;
    const markIsLight = readableTextColor(fill) === '#ffffff';
    const inner = Math.round(size * 0.6);
    const blockStyle = {
      width: size,
      height: size,
      borderRadius: Math.round(size * radiusScale),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    } as const;
    if (logoUrl && !logoIsMono) {
      return (
        <div
          style={{ ...blockStyle, backgroundColor: '#ffffff', border: `1px solid ${borderColor}` }}
        >
          <img
            src={logoUrl}
            alt={brandName}
            style={{ width: inner, height: inner, objectFit: 'contain' }}
          />
        </div>
      );
    }
    return (
      <div style={{ ...blockStyle, backgroundColor: fill }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={brandName}
            style={{
              width: inner,
              height: inner,
              objectFit: 'contain',
              filter: markIsLight ? 'brightness(0) invert(1)' : 'brightness(0)',
            }}
          />
        ) : (
          <span
            style={{
              color: markIsLight ? '#ffffff' : '#111827',
              fontWeight: 700,
              fontSize: Math.round(size * 0.42),
              fontFamily: headingFontStack,
            }}
          >
            {brandName.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    );
  };

  const LoginPanel = ({ compact = false }: { compact?: boolean }) => (
    <div
      id={loginPanelId}
      className={compact ? '' : 'rounded-3xl p-6 sm:p-8'}
      style={compact ? undefined : {
        backgroundColor: panelColor,
        boxShadow: `0 24px 48px ${colorWithAlpha(primaryColor, 0.14)}, 0 2px 6px ${colorWithAlpha(primaryColor, 0.06)}`,
        border: `1px solid ${borderColor}`,
      }}
    >
      {!compact && (
        <div className="mb-5 text-center">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ background: brandGradient, color: onPrimary }}
          >
            <Sparkles size={22} strokeWidth={2.4} />
          </div>
          <p className="text-base font-extrabold" style={{ color: textPrimary }}>
            Take the free assessment
          </p>
          <p className="mt-1 text-sm" style={{ color: textMuted }}>
            Enter your email — your score and results are saved to it.
          </p>
        </div>
      )}

      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <div>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            placeholder="Enter your email"
            className="w-full px-4 py-4 text-base rounded-2xl focus:outline-none transition-all"
            style={{
              backgroundColor: sectionBackground,
              border: `2px solid ${error ? dangerColor : borderColor}`,
              color: textPrimary,
            }}
            disabled={loading}
            required
            autoFocus={loginOpen}
            data-testid="input-email"
          />
          {/* Reserved height: an appearing error must not grow the form and
              shift the controls below it (same CLS class as the OTP form). */}
          <div className="mt-2" style={{ minHeight: '16px' }} aria-live="polite">
            {error && (
              <p className="text-xs" style={{ color: dangerColor }} data-testid="text-error">
                {error}
              </p>
            )}
          </div>
        </div>

        {gdprEnabled && (
          <div
            className="space-y-2 rounded-lg px-3 py-2 text-xs"
            style={{
              backgroundColor: bgLight,
              color: textMuted,
            }}
          >
            <p>
              By entering your email, you agree to our{' '}
              <a href="/privacy" className="font-medium underline" style={{ color: textPrimary }}>
                Privacy Policy
              </a>.
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded"
                style={{ borderColor, accentColor: primaryColor }}
              />
              <span>I want to receive marketing emails and updates (optional)</span>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email}
          className="w-full py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
          style={{
            backgroundColor: loading || !email
              ? colorWithAlpha(primaryColor, 0.35)
              : primaryColor,
            color: loading || !email ? 'rgba(255,255,255,0.7)' : onPrimary,
            cursor: loading || !email ? 'not-allowed' : 'pointer',
            boxShadow: loading || !email ? 'none' : `0 10px 24px ${colorWithAlpha(primaryColor, 0.34)}`,
          }}
          data-testid="button-continue"
        >
          {loading ? 'Just a moment...' : 'Take the free assessment'}
          {!loading && <ArrowRight size={18} strokeWidth={2.6} />}
        </button>
      </form>

      {!compact && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-5 text-xs font-medium" style={{ color: textSubtle }}>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />100% free</span>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />No credit card</span>
          <span className="inline-flex items-center gap-1"><Check size={13} strokeWidth={3} />Instant access</span>
        </div>
      )}

      {socialProviders.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ backgroundColor: borderColor }} />
            <span className="text-xs font-medium" style={{ color: textSubtle }}>or continue with</span>
            <div className="flex-1 h-px" style={{ backgroundColor: borderColor }} />
          </div>
          <div className={`grid gap-2 ${socialProviders.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {socialProviders.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => handleSocialLogin(provider)}
                disabled={loading}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold transition-all hover:-translate-y-0.5"
                style={{
                  backgroundColor: panelColor,
                  border: `2px solid ${borderColor}`,
                  color: textPrimary,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="capitalize">{provider}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {guestModeEnabled && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleGuestMode}
            disabled={loading}
            className="text-sm font-semibold transition-colors hover:opacity-70"
            style={{ color: textMuted, cursor: loading ? 'not-allowed' : 'pointer' }}
            data-testid="button-guest-mode"
          >
            Continue as guest
          </button>
        </div>
      )}
    </div>
  );

  if (step === 'loading' || step === 'complete') {
    return null;
  }

  // OTP Code verification screen
  if (step === 'code') {
    return (
      <div
        className="min-h-screen flex flex-col overflow-y-auto"
        style={{ fontFamily: bodyFontStack, background: gateGradient }}
      >
        <main id="main-content" tabIndex={-1} className="flex-1 flex items-center justify-center px-6 py-12" style={{ outline: 'none' }}>
          <div className="w-full max-w-sm">
            <div className="text-center mb-10">
              <div className="flex justify-center mb-4">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: panelColor, border: `1px solid ${borderColor}`, boxShadow: `0 10px 24px ${colorWithAlpha(primaryColor, 0.16)}` }}
                >
                  <BrandMark size={40} />
                </div>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: textPrimary, fontFamily: headingFontStack }}>
                Check your inbox
              </h1>
              <p className="mt-2 text-sm" style={{ color: textMuted }}>
                We sent a 4-digit code to<br />
                <span className="font-medium" style={{ color: textPrimary }}>{email}</span>
              </p>
              <p className="mt-3 text-xs" style={{ color: textSubtle }}>
                can’t find it? Check your spam or junk folder.
              </p>
            </div>

            <form onSubmit={handleCodeSubmit} className="space-y-5">
              <div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={code}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setCode(val);
                    setError('');
                  }}
                  placeholder="0000"
                  className="w-full px-4 py-3.5 text-center text-2xl tracking-[0.5em] font-mono rounded-xl focus:outline-none transition-all"
                  style={{
                    backgroundColor: panelColor,
                    border: `2px solid ${error ? dangerColor : borderColor}`,
                    color: textPrimary,
                  }}
                  disabled={loading}
                  autoFocus
                  data-testid="input-code"
                />
                {/* Height is reserved even while empty so an appearing error
                    cannot grow the form and re-center the flex container
                    (QA replay-bug-msyjjkya-izko: the submit button and help
                    text jumped 12px when the 400 error rendered). */}
                <div className="mt-2" style={{ minHeight: '16px' }} aria-live="polite">
                  {error && (
                    <p className="text-xs" style={{ color: dangerColor }} data-testid="text-error">
                      {error}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || code.length !== 4}
                className="w-full py-3.5 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
                style={{
                  backgroundColor: loading || code.length !== 4 ? colorWithAlpha(primaryColor, 0.3) : primaryColor,
                  color: onPrimary,
                  cursor: loading || code.length !== 4 ? 'not-allowed' : 'pointer',
                  boxShadow: loading || code.length !== 4 ? 'none' : `0 10px 24px ${colorWithAlpha(primaryColor, 0.34)}`,
                }}
                data-testid="button-verify"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
                {!loading && <ArrowRight size={18} strokeWidth={2.6} />}
              </button>
            </form>

            <div className="text-center mt-6 space-x-4">
              <button
                onClick={handleResendCode}
                disabled={resendCooldown > 0 || loading}
                className="text-sm transition-colors"
                style={{ color: resendCooldown > 0 ? textSubtle : textPrimary }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
              <span style={{ color: textSubtle }}>|</span>
              <button
                onClick={() => { setStep('email'); setCode(''); setError(''); }}
                className="text-sm transition-colors"
                style={{ color: textMuted }}
              >
                Change email
              </button>
            </div>
          </div>
        </main>

        <div className="pb-8 text-center">
          <p className="text-xs" style={{ color: textSubtle }}>
            Your data is private and secure
          </p>
        </div>
      </div>
    );
  }

  // Main email entry screen - landing page first, native login panel on CTA.
  return (
    <>
      {/*
        WYSIWYG kickoff: the founder-chosen landing look replaces ONLY the shell
        region between the START/END markers below. Everything outside it — the
        auth hooks/handlers above, and the login modal + <LoginPanel> after END —
        is fixed platform infrastructure and is never LLM-regenerated, so
        sign-in / OTP / registration is guaranteed intact after a variant ships.
        A generated shell may use in-scope brand vars (primaryColor, brandName,
        heroVideoUrl, heroHasVideo, openLogin, BrandMark, colorWithAlpha, the
        lucide icons, …) but must not fetch, register, or duplicate auth.
        See server/services/kickoff-email-gate-variants.service.ts.
      */}
      {/* AUDOS:LANDING_SHELL:START */}
    <div
      className="eg-root h-screen overflow-y-auto"
      style={{ height: '100dvh', WebkitOverflowScrolling: 'touch', fontFamily: bodyFontStack, backgroundColor: pageBackground }}
    >
      {/* WCAG 2.4.1 Bypass Blocks: visually hidden until focused — first Tab reveals it */}
      <a href="#main-content" className="eg-skip-link">
        Skip to main content
      </a>
      <style>{`
        @keyframes eg-blob { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(14px, -20px) scale(1.08); } }
        .eg-blob { animation: eg-blob 9s ease-in-out infinite; }
        .eg-root { scroll-behavior: smooth; }
        .eg-skip-link { position: fixed; top: -100px; left: 16px; z-index: 100; padding: 10px 18px; border-radius: 9999px; font-size: 14px; font-weight: 600; text-decoration: none; background-color: ${primaryColor}; color: ${onPrimary || '#ffffff'}; box-shadow: 0 10px 24px rgba(0,0,0,0.3); transition: top 0.15s ease; }
        .eg-skip-link:focus { top: 16px; outline: 2px solid #ffffff; outline-offset: 2px; }
        .eg-root section[id] { scroll-margin-top: 76px; }
        .eg-root h1, .eg-root h2 { font-family: ${headingFontStack}; }
        .eg-faq summary { list-style: none; }
        .eg-faq summary::-webkit-details-marker { display: none; }
        .eg-faq-icon { transition: transform 0.25s ease; }
        .eg-faq[open] .eg-faq-icon { transform: rotate(45deg); }
        .eg-faq[open] { background: linear-gradient(135deg, ${bgLight}, ${bgMedium}); }
      `}</style>
      <nav
        className="fixed inset-x-0 top-0 z-30 transition-all duration-300"
        style={
          scrolled
            ? {
                backgroundColor: colorWithAlpha(panelColor, 0.92),
                borderBottom: `1px solid ${borderColor}`,
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow: `0 8px 24px ${colorWithAlpha(primaryColor, 0.08)}`,
              }
            : { backgroundColor: 'transparent', borderBottom: '1px solid transparent' }
        }
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <a href="#hero" className="flex min-w-0 items-center gap-3">
            <BrandMark size={36} />
            <div className="min-w-0">
              <p
                className="truncate text-sm font-semibold transition-colors"
                style={{ color: scrolled ? textPrimary : '#ffffff' }}
              >
                {brandName}
              </p>
              <p
                className="truncate text-xs transition-colors"
                style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.75)' }}
              >
                Build a business investors can believe in.
              </p>
            </div>
          </a>
          <div className="hidden items-center gap-6 md:flex">
            <a
              href="#the-wall"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              The problem
            </a>
            <a
              href="#covers"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              What it covers
            </a>
            <a
              href="#outputs"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              What you get
            </a>
            <a
              href="#platform"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              Platform
            </a>
            <a
              href="#pricing"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              FAQ
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => openLogin('login')}
              className="rounded-full border px-3 py-2 text-sm font-semibold transition hover:opacity-80 sm:px-4"
              style={{
                borderColor: scrolled ? borderColor : 'rgba(255,255,255,0.45)',
                backgroundColor: scrolled ? bgLight : 'rgba(255,255,255,0.08)',
                color: scrolled ? textPrimary : '#ffffff',
              }}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => openLogin('assess')}
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition hover:opacity-90 sm:px-4"
              style={{ backgroundColor: primaryColor, color: onPrimary }}
            >
              Take the free assessment
              <ArrowRight size={15} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      </nav>
      {/* WCAG 1.3.1: primary-content landmark — <nav> and <footer> stay outside it */}
      <main id="main-content" tabIndex={-1} style={{ outline: 'none' }}>
      <section
        id="hero"
        className="relative flex min-h-screen min-h-[100svh] items-center overflow-hidden px-6 py-24 sm:py-28"
        style={{ background: heroGradient }}
      >
        <div className="absolute inset-0" style={{ background: heroScrim, opacity: 0.4 }} />
        <div
          className="pointer-events-none absolute -right-40 -top-40 h-[560px] w-[560px] opacity-70 sm:h-[720px] sm:w-[720px]"
          aria-hidden="true"
        >
          <svg viewBox="0 0 900 900" fill="none" className="h-full w-full">
            <circle cx="450" cy="360" r="420" stroke={primaryColor} strokeOpacity="0.22" />
            <circle cx="450" cy="360" r="300" stroke={palette?.secondary || primaryColor} strokeOpacity="0.28" />
            <circle cx="450" cy="360" r="180" stroke={primaryColor} strokeOpacity="0.5" />
          </svg>
        </div>

        <div
          className="relative z-10 mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]"
          style={{
            opacity: entered ? 1 : 0,
            transform: entered ? 'none' : 'translateY(20px)',
            transition: 'opacity 0.7s ease, transform 0.7s ease',
          }}
        >
          <div className="max-w-3xl space-y-5">
            <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
              <span aria-hidden="true" style={{ width: 16, height: 1, backgroundColor: primaryColor, display: 'inline-block' }} />
              Gap Radar — free readiness assessment
            </p>
            <h1
              className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl"
              style={{ color: '#ffffff', fontFamily: headingFontStack }}
            >
              Get Your Business Ready to{' '}
              <span
                style={{
                  backgroundImage: `linear-gradient(100deg, ${palette?.secondary || '#A78BFA'}, ${primaryColor} 60%)`,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                Raise Capital
              </span>
            </h1>
            <p
              className="max-w-2xl text-lg leading-8"
              style={{ color: 'rgba(255,255,255,0.78)' }}
            >
              FoundarOS gives founders a structured system to assess their business, strengthen their fundraising position and build the documents they need to approach investors with clarity and confidence.
            </p>
            <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
              One-time access — $99 · No subscription · No long-term commitment
            </p>
            <button
              type="button"
              onClick={() => openLogin('assess')}
              aria-haspopup="dialog"
              aria-expanded={loginOpen}
              className="group flex w-full max-w-2xl items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-left transition hover:scale-[1.01] hover:bg-white/15"
              style={{
                borderColor: 'rgba(255,255,255,0.3)',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#ffffff',
              }}
              data-testid="button-start-idea-discovery"
            >
              <span className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
                  style={{ backgroundColor: colorWithAlpha(primaryColor, 0.28) }}
                >
                  <Lightbulb size={20} strokeWidth={2.4} />
                </span>
                <span>
                  <span className="block text-sm font-semibold">No idea yet? Start with Idea Discovery</span>
                  <span className="mt-0.5 block text-xs font-medium text-white/65">
                    Turn your experience into a concept worth pursuing.
                  </span>
                </span>
              </span>
              <ArrowRight size={18} strokeWidth={2.6} className="flex-none transition-transform group-hover:translate-x-1" />
            </button>
            <div className="flex flex-col items-start gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() => openLogin('assess')}
                aria-haspopup="dialog"
                aria-expanded={loginOpen}
                className="flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:scale-[1.01]"
                style={{
                  backgroundColor: primaryColor,
                  color: onPrimary || '#ffffff',
                  boxShadow: `0 16px 32px ${colorWithAlpha(primaryColor, 0.4)}`,
                }}
                data-testid="button-open-login"
              >
                Start Your Fundraising Readiness Journey
                <ArrowRight size={18} strokeWidth={2.6} />
              </button>
              <a
                href="#the-wall"
                className="rounded-full px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                style={{ border: '1px solid rgba(255,255,255,0.35)' }}
              >
                Why this beats Googling
              </a>
            </div>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Free · No credit card · No pitch deck required · Works on your phone
            </p>
          </div>

          {/* Readiness gauge panel — a sample of the report the assessment
              produces, so the hero shows the honest output up front. */}
          <div
            className="relative mx-auto w-full max-w-sm rounded-[22px] p-6 backdrop-blur-sm"
            style={{ backgroundColor: 'rgba(12,9,32,0.55)', border: `1px solid rgba(255,255,255,0.14)` }}
          >
            <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">
              Sample report — Readiness Score
            </p>
            <div className="mx-auto mb-1 flex justify-center">
              <svg width="152" height="152" viewBox="0 0 168 168">
                <circle cx="84" cy="84" r="72" stroke="rgba(255,255,255,0.14)" strokeWidth="10" fill="none" />
                <circle
                  cx="84"
                  cy="84"
                  r="72"
                  stroke={primaryColor}
                  strokeWidth="10"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray="452.4"
                  strokeDashoffset={452.4 - (72 / 100) * 452.4}
                  transform="rotate(-90 84 84)"
                />
              </svg>
            </div>
            <p className="-mt-[104px] mb-0 text-center text-[44px] font-bold text-white">72</p>
            <p className="mb-1 mt-9 text-center text-xs text-white/70">/ 100</p>
            <p className="mb-5 text-center text-sm font-semibold" style={{ color: contrastColor }}>
              ● Close — 3 gaps between you and “ready”
            </p>
            <ul className="space-y-2.5 text-sm text-white/90">
              <li className="flex items-center gap-2">
                <span
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px]"
                  style={{ backgroundColor: 'rgba(52,211,153,0.16)', border: '1px solid rgba(52,211,153,0.5)', color: '#34D399' }}
                >
                  ✓
                </span>
                Idea clarity — strong
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px]"
                  style={{ backgroundColor: colorWithAlpha(contrastColor, 0.16), border: `1px solid ${colorWithAlpha(contrastColor, 0.5)}`, color: contrastColor }}
                >
                  !
                </span>
                Market validation — 2 gaps found
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px]"
                  style={{ backgroundColor: colorWithAlpha(contrastColor, 0.16), border: `1px solid ${colorWithAlpha(contrastColor, 0.5)}`, color: contrastColor }}
                >
                  !
                </span>
                Financial assumptions — needs work
              </li>
            </ul>
            <p className="mt-4 text-center text-xs text-white/40">
              A sample result. Yours will be this honest too.
            </p>
          </div>
        </div>
      </section>

      <section id="journey" className="px-6 py-16" style={{ backgroundColor: pageBackground }}>
        <div className="mx-auto max-w-6xl">
          <div
            className="rounded-3xl border p-8 sm:p-10"
            style={{ backgroundColor: panelColor, borderColor }}
          >
            <p className="mb-6 text-center text-sm font-semibold uppercase tracking-[0.2em]" style={{ color: textMuted }}>
              Your Fundraising Readiness Journey — covered in one $99 package
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {['Founder Assessment', 'Business Model', 'Financial Readiness', 'Market Analysis', 'Investor Materials', 'Founder Roadmap'].map((step, i, arr) => (
                <div key={step} className="flex items-center gap-3">
                  <span
                    className="rounded-full border px-4 py-2 text-sm font-medium"
                    style={{ backgroundColor: bgMedium, borderColor, color: textPrimary }}
                  >
                    {step}
                  </span>
                  {i < arr.length - 1 && (
                    <ArrowRight size={16} strokeWidth={2.4} className="flex-shrink-0" style={{ color: primaryColor }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="the-wall"
        className="border-b px-6 py-20"
        style={{ backgroundColor: sectionBackground, borderColor }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: textMuted }}>
              Sound familiar?
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              You’ve done the Googling. It hasn’t helped.
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              Search “how to get funding for a startup” and you hit the same three walls — none of which answer the one question you actually have: is my idea fundable, and what’s missing?
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {googledWall.map((item) => (
              <div
                key={item.index}
                className="rounded-3xl border p-8"
                style={{ backgroundColor: panelColor, borderColor }}
              >
                <p className="mb-3 font-mono text-[11px] tracking-wider" style={{ color: textMuted }}>
                  {item.index}
                </p>
                <h3 className="font-semibold mb-2" style={{ color: textPrimary }}>
                  {item.title}
                </h3>
                <p className="text-sm leading-7" style={{ color: textMuted }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="deliverables" className="px-6 py-20" style={{ backgroundColor: pageBackground }}>
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: textMuted }}>
              Your $99 Founder Readiness Package
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              Everything You Need to Prepare Your Business for Fundraising
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { n: '01', t: 'Founder Readiness Assessment', d: 'Understand where your business stands today.' },
              { n: '02', t: 'Business Model Analysis', d: 'Identify weaknesses, assumptions and opportunities.' },
              { n: '03', t: 'Market & Customer Analysis', d: 'Clarify your target customer, market and competitive position.' },
              { n: '04', t: 'Financial Readiness', d: 'Work through revenue assumptions, costs, projections and key financial metrics.' },
              { n: '05', t: 'Investor Readiness', d: 'Identify what investors will expect and where your business is currently strong or weak.' },
              { n: '06', t: 'Business Documents', d: 'Generate structured founder-ready documents from the information you provide.' },
              { n: '07', t: 'Founder Action Plan', d: 'Know exactly what to work on next.' },
            ].map((item) => (
              <div key={item.n} className="rounded-3xl border p-8" style={{ backgroundColor: panelColor, borderColor }}>
                <p className="mb-3 font-mono text-sm font-semibold" style={{ color: primaryColor }}>{item.n}</p>
                <h3 className="font-semibold mb-2" style={{ color: textPrimary }}>{item.t}</h3>
                <p className="text-sm leading-7" style={{ color: textMuted }}>{item.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-3xl border p-6 sm:p-8" style={{ backgroundColor: accentCycle[0].bg, borderColor: colorWithAlpha(primaryColor, 0.35) }}>
            <p className="text-base font-medium leading-7" style={{ color: textPrimary }}>
              All for a one-time $99 payment. No subscription. No recurring charges.
            </p>
          </div>
        </div>
      </section>

      <section id="before-after" className="border-t px-6 py-20" style={{ backgroundColor: sectionBackground, borderColor }}>
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border p-8" style={{ backgroundColor: panelColor, borderColor: colorWithAlpha(contrastColor, 0.35) }}>
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em]" style={{ color: contrastColor }}>Before</p>
              <h3 className="text-xl font-semibold mb-5" style={{ color: textPrimary }}>“I have an idea, but…”</h3>
              <ul className="space-y-3 text-sm" style={{ color: textMuted }}>
                {['My business model isn’t clear', 'I don’t know if my numbers make sense', 'I need investor materials', 'I don’t know what investors will ask', 'I don’t know what to work on next'].map((entry) => (
                  <li key={entry} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex-shrink-0 font-bold" style={{ color: contrastColor }}>•</span>
                    <span>{entry}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl border p-8" style={{ backgroundColor: panelColor, borderColor: colorWithAlpha(accentGreen, 0.4) }}>
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em]" style={{ color: accentGreen }}>After</p>
              <h3 className="text-xl font-semibold mb-5" style={{ color: textPrimary }}>“I know what I’m building and what I need to do next.”</h3>
              <ul className="space-y-3 text-sm" style={{ color: textMuted }}>
                {['Clearer business model', 'Structured financial assumptions', 'Market positioning', 'Investor-readiness assessment', 'Business documentation', 'Prioritized action plan'].map((entry) => (
                  <li key={entry} className="flex items-start gap-2.5">
                    <Check size={16} strokeWidth={2.8} className="mt-0.5 flex-shrink-0" style={{ color: accentGreen }} />
                    <span>{entry}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section
        id="covers"
        className="px-6 py-20"
        style={{ backgroundColor: pageBackground }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <span
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.3em]"
              style={{ color: textMuted }}
            >
              The straight answer
            </span>
            <h2 className="text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              One free assessment. The four things investors actually check.
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              Gap Radar asks 30 focused questions, then scores your idea across the four areas every investor screens before they’ll take a meeting. No prep, no documents — just honest answers about where your idea stands today.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {scoreCategories.map((item, i) => {
              const accent = accentCycle[i % accentCycle.length];
              const CategoryIcon = scoreCategoryIcons[i] ?? Lightbulb;
              return (
                <div
                  key={item.title}
                  className="rounded-3xl border p-6 shadow-sm transition-transform hover:-translate-y-1"
                  style={{ backgroundColor: panelColor, borderColor }}
                >
                  <div className="mb-4 flex items-center justify-between">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-2xl"
                      style={{ backgroundColor: accent.bg, color: accent.fg }}
                    >
                      <CategoryIcon size={20} strokeWidth={2.2} />
                    </span>
                    <p className="font-mono text-[11px] tracking-wider" style={{ color: textMuted }}>
                      {item.index}
                    </p>
                  </div>
                  <h3 className="text-xl font-semibold mb-2" style={{ color: textPrimary }}>
                    {item.title}
                  </h3>
                  <p className="text-sm leading-7" style={{ color: textMuted }}>
                    {item.desc}
                  </p>
                  <div className="mt-4 h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                    <span className="block h-full rounded-full" style={{ width: item.barWidth, backgroundColor: accent.fg }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="outputs" className="border-t px-6 py-20" style={{ backgroundColor: pageBackground, borderColor }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: textMuted }}>
              What you walk away with
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              Not a pep talk. A report.
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              Fifteen minutes in, you have three things you didn’t have this morning:
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {outputs.map((item, i) => {
              const accent = accentCycle[i % accentCycle.length];
              const OutputIcon = outputIcons[i] ?? FileText;
              return (
                <div
                  key={item.title}
                  className="rounded-3xl border p-8 shadow-sm"
                  style={{ backgroundColor: panelColor, borderColor }}
                >
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: accent.bg, color: accent.fg }}
                  >
                    <OutputIcon size={22} strokeWidth={2.4} />
                  </div>
                  <h3 className="text-lg font-semibold mb-2" style={{ color: textPrimary }}>
                    {item.title}
                  </h3>
                  <p className="text-sm leading-7" style={{ color: textMuted }}>
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>

          <div
            className="mt-8 rounded-3xl border p-6 sm:p-8"
            style={{ backgroundColor: accentCycle[0].bg, borderColor: colorWithAlpha(primaryColor, 0.35) }}
          >
            <p className="text-base font-medium leading-7" style={{ color: textPrimary }}>
              And if your idea isn’t ready? The report says so — plainly — and shows you exactly why. That’s the point. Better to hear it from a free assessment tonight than from an investor after you’ve handed in your notice.
            </p>
          </div>
        </div>
      </section>

      <section id="platform" className="px-6 py-20" style={{ backgroundColor: sectionBackground }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: palette?.text?.accent || textMuted }}>
              — The Platform
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              Build, fund, and grow — with AI at every stage
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              Idea Discovery and Gap Radar are live today. Business Operations and AI Coaches are coming next. {brandName} is built to grow with you — from figuring out your idea to running a funded company.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {platformModules.map((item, i) => {
              const accent = accentCycle[i % accentCycle.length];
              const ModuleIcon = platformModuleIcons[i] ?? Gauge;
              return (
                <div
                  key={item.title}
                  className="rounded-3xl border p-6"
                  style={{ backgroundColor: panelColor, borderColor: colorWithAlpha(accent.fg, 0.45) }}
                >
                  {item.status === 'live' ? (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
                      style={{
                        borderColor: colorWithAlpha(accentGreen, 0.5),
                        backgroundColor: colorWithAlpha(accentGreen, 0.12),
                        color: accentGreen,
                      }}
                    >
                      ● Live
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
                      style={{ borderColor, color: textMuted }}
                    >
                      Coming soon
                    </span>
                  )}
                  <div
                    className="mt-4 mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ backgroundColor: accent.bg, color: accent.fg }}
                  >
                    <ModuleIcon size={20} strokeWidth={2.2} />
                  </div>
                  <h3 className="text-lg font-semibold mb-2" style={{ color: textPrimary }}>
                    {item.title}
                  </h3>
                  {item.desc && (
                    <p className="text-sm leading-6" style={{ color: textMuted }}>
                      {item.desc}
                    </p>
                  )}
                  {item.items.length > 0 && (
                    <ul className="space-y-2 text-sm" style={{ color: textMuted }}>
                      {item.items.map((entry) => (
                        <li key={entry} className="flex items-start gap-2">
                          <ArrowRight size={14} strokeWidth={2.4} className="mt-1 flex-shrink-0" style={{ color: accent.fg }} />
                          <span>{entry}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="who-we-serve" className="px-6 py-20" style={{ backgroundColor: pageBackground }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: palette?.text?.accent || textMuted }}>
              — Who We Serve
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              Built for founders at every stage
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              From your first idea to your first team hire — {brandName} has tools for every stage of the journey.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {personas.map((item, i) => {
              const accent = accentCycle[i % accentCycle.length];
              const PersonaIcon = personaIcons[i] ?? Lightbulb;
              return (
                <div
                  key={item.title}
                  className="rounded-3xl border p-8"
                  style={{
                    backgroundColor: panelColor,
                    borderColor,
                    borderStyle: item.soon ? 'dashed' : 'solid',
                  }}
                >
                  <div
                    className="mb-4 flex h-10 w-10 items-center justify-center rounded-full"
                    style={{ backgroundColor: accent.bg, color: accent.fg }}
                  >
                    <PersonaIcon size={18} strokeWidth={2.2} />
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] mb-1" style={{ color: textSubtle }}>
                    {item.stage}
                  </p>
                  <h3 className="text-lg font-semibold mb-3" style={{ color: textPrimary }}>
                    {item.title}
                  </h3>
                  <p className="text-sm leading-7" style={{ color: textMuted }}>
                    {item.desc}
                  </p>
                  {item.soon && (
                    <span
                      className="mt-4 inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
                      style={{
                        borderColor: colorWithAlpha(contrastColor, 0.5),
                        backgroundColor: colorWithAlpha(contrastColor, 0.12),
                        color: contrastColor,
                      }}
                    >
                      Coming soon
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="trust" className="px-6 py-20" style={{ backgroundColor: sectionBackground }}>
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: textMuted }}>
            Secure Payment
          </p>
          <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
            Secure checkout powered by Flutterwave
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-7" style={{ color: textMuted }}>
            Your payment is processed securely through Flutterwave. FoundarOS does not receive or store your card details.
          </p>
          <div className="mx-auto mt-6 max-w-2xl rounded-3xl border p-6" style={{ backgroundColor: panelColor, borderColor }}>
            <p className="text-sm leading-7" style={{ color: textMuted }}>
              Payments are processed by <span style={{ color: textPrimary, fontWeight: 600 }}>ALTANATIVEZ HAVEN LIMITED</span>, the entity behind FoundarOS. You may see this name on your bank statement or card receipt.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {['Secure payment', 'International cards accepted', 'USD payment', 'Instant confirmation'].map((badge) => (
              <span key={badge} className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium" style={{ backgroundColor: panelColor, borderColor, color: textPrimary }}>
                <Check size={15} strokeWidth={2.8} style={{ color: accentGreen }} />
                {badge}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="border-t px-6 py-20" style={{ backgroundColor: pageBackground, borderColor }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: palette?.text?.accent || textMuted }}>
              — Pricing
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              Start free. Unlock the full pack when you’re ready.
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              The assessment, your Readiness Score, and one surface-level gap are free. One $99 payment — no subscription — reveals every critical gap and gives you a step-by-step plan to fix them before you pitch, with personalized founder documents included.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border p-8" style={{ backgroundColor: panelColor, borderColor }}>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: textMuted }}>
                Free assessment
              </p>
              <div className="mt-3 mb-5 flex items-baseline gap-2">
                <span className="text-4xl font-bold" style={{ color: textPrimary }}>$0</span>
                <span className="text-sm" style={{ color: textSubtle }}>no credit card</span>
              </div>
              <ul className="space-y-3 text-sm" style={{ color: textMuted }}>
                {freeFeatures.map((entry) => (
                  <li key={entry} className="flex items-start gap-2.5">
                    <Check size={16} strokeWidth={2.8} className="mt-0.5 flex-shrink-0" style={{ color: accentGreen }} />
                    <span>{entry}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => openLogin('assess')}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:opacity-90"
                style={{ border: `1px solid ${colorWithAlpha(primaryColor, 0.6)}`, color: textPrimary, backgroundColor: 'transparent' }}
              >
                Take the free assessment
                <ArrowRight size={16} strokeWidth={2.6} />
              </button>
            </div>

            <div
              className="rounded-3xl border p-8"
              style={{
                backgroundColor: panelColor,
                borderColor: colorWithAlpha(primaryColor, 0.6),
                boxShadow: `0 24px 48px ${colorWithAlpha(primaryColor, 0.18)}`,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: palette?.text?.accent || textMuted }}>
                  FoundarOS Fundraising Readiness
                </p>
                <span
                  className="inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{
                    borderColor: colorWithAlpha(primaryColor, 0.5),
                    backgroundColor: colorWithAlpha(primaryColor, 0.12),
                    color: palette?.text?.accent || textPrimary,
                  }}
                >
                  One-time
                </span>
              </div>
              <div className="mt-3 mb-2 flex items-baseline gap-2">
                <span className="text-4xl font-bold" style={{ color: textPrimary }}>$99</span>
                <span className="text-sm" style={{ color: textSubtle }}>once — no subscription</span>
              </div>
              <p className="mb-5 text-sm leading-6" style={{ color: textMuted }}>
                Unlock your critical gaps, action plan, and personalized founder tools:
              </p>
              <ul className="space-y-3 text-sm" style={{ color: textMuted }}>
                {packDocuments.map((entry) => (
                  <li key={entry} className="flex items-start gap-2.5">
                    <Check size={16} strokeWidth={2.8} className="mt-0.5 flex-shrink-0" style={{ color: palette?.text?.accent || primaryColor }} />
                    <span>{entry}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => openLogin('assess')}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:scale-[1.01]"
                style={{ backgroundColor: primaryColor, color: onPrimary, boxShadow: `0 16px 32px ${colorWithAlpha(primaryColor, 0.4)}` }}
              >
                Start with the free assessment
                <ArrowRight size={16} strokeWidth={2.6} />
              </button>
              <p className="mt-3 text-center text-xs" style={{ color: textSubtle }}>
                Unlock from your results screen after you’ve seen your free score and gap preview.
              </p>
              <p className="mt-2 text-center text-xs" style={{ color: textSubtle }}>
                Business Operations AI is a separate optional service and is not included in this purchase.
              </p>
            </div>
          </div>

          {/* Founder Concierge — full-width premium tier */}
          <div
            className="mt-6 rounded-3xl border p-8"
            style={{
              backgroundColor: panelColor,
              borderColor: colorWithAlpha(primaryColor, 0.55),
              boxShadow: `0 24px 48px ${colorWithAlpha(primaryColor, 0.12)}`,
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-8">
              <div className="flex-1 max-w-xl">
                <div className="flex items-center gap-3 mb-3">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: palette?.text?.accent || textMuted }}>
                    Founder Concierge
                  </p>
                  <span
                    className="inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
                    style={{
                      borderColor: colorWithAlpha(primaryColor, 0.5),
                      backgroundColor: colorWithAlpha(primaryColor, 0.12),
                      color: palette?.text?.accent || textPrimary,
                    }}
                  >
                    Limited spots
                  </span>
                </div>
                <h3 className="text-2xl font-semibold mb-2" style={{ color: textPrimary }}>
                  Work through your results with the founder — personally.
                </h3>
                <p className="text-sm leading-6 mb-5" style={{ color: textMuted }}>
                  Take the full assessment and get your Funding Readiness Pack — then spend 45 minutes with me, live, going through exactly what your gaps mean and what to do next. You leave with a clear, personalised path forward, not just a score.
                </p>
                <ul className="space-y-3 text-sm" style={{ color: textMuted }}>
                  {conciergeFeatures.map((entry) => (
                    <li key={entry} className="flex items-start gap-2.5">
                      <Check size={16} strokeWidth={2.8} className="mt-0.5 flex-shrink-0" style={{ color: palette?.text?.accent || primaryColor }} />
                      <span>{entry}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col sm:items-end gap-5 sm:min-w-[200px]">
                <div>
                  <div className="flex items-baseline gap-2 sm:justify-end">
                    <span className="text-4xl font-bold" style={{ color: textPrimary }}>$249</span>
                    <span className="text-sm" style={{ color: textSubtle }}>one-time</span>
                  </div>
                  <p className="mt-1 text-xs text-right" style={{ color: textSubtle }}>Includes the $99 Readiness Pack</p>
                </div>
                <a
                  href="mailto:hello@foundaros.com?subject=Concierge%20Session%20Request"
                  className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:scale-[1.01]"
                  style={{ backgroundColor: primaryColor, color: onPrimary, boxShadow: `0 16px 32px ${colorWithAlpha(primaryColor, 0.4)}` }}
                >
                  Apply for a spot
                  <ArrowRight size={16} strokeWidth={2.6} />
                </a>
                <p className="text-xs text-center sm:text-right" style={{ color: textSubtle }}>Reply within 24 hours</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="business-ops" className="border-t px-6 py-20" style={{ backgroundColor: pageBackground, borderColor }}>
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: palette?.text?.accent || textMuted }}>
            FoundarOS Business Operations AI — Coming Soon
          </p>
          <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
            And we’re building what’s next.
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-7" style={{ color: textMuted }}>
            Getting investment is only one part of the founder journey. FoundarOS Business Operations AI is being developed to help founders manage and grow their businesses after the fundraising stage.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {['Finance', 'Operations', 'Procurement', 'Sales', 'Strategy', 'HR', 'Business Performance', 'Decision Support'].map((area) => (
              <span key={area} className="inline-flex items-center rounded-full border px-4 py-2 text-sm font-medium" style={{ backgroundColor: panelColor, borderColor, color: textPrimary }}>
                {area}
              </span>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-sm leading-7" style={{ color: textSubtle }}>
            FoundarOS Business Operations AI is a separate optional subscription service. It is NOT included in the $99 Fundraising Readiness purchase.
          </p>
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => openLogin('assess')}
              className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:scale-[1.01]"
              style={{ backgroundColor: primaryColor, color: onPrimary, boxShadow: `0 16px 32px ${colorWithAlpha(primaryColor, 0.4)}` }}
            >
              Join the Waitlist
              <ArrowRight size={16} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      </section>

      <section className="px-6 py-16 sm:py-20" style={{ backgroundColor: pageBackground }}>
        <div
          className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] border p-6 sm:p-10 lg:p-12"
          style={{
            background: `linear-gradient(135deg, ${colorWithAlpha('#f59e0b', 0.2)} 0%, ${colorWithAlpha('#f97316', 0.14)} 48%, ${panelColor} 100%)`,
            borderColor: colorWithAlpha('#f59e0b', 0.58),
            boxShadow: `0 28px 70px ${colorWithAlpha(primaryColor, 0.22)}`,
          }}
        >
          <div className="grid items-center gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:gap-12">
            <div>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <span
                  className="inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]"
                  style={{
                    backgroundColor: colorWithAlpha('#f59e0b', 0.18),
                    borderColor: colorWithAlpha('#f59e0b', 0.65),
                    color: textPrimary,
                  }}
                >
                  Limited time
                </span>
                <span
                  className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{ backgroundColor: panelColor, borderColor, color: textPrimary }}
                >
                  2 spots remaining
                </span>
              </div>
              <h2 className="max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl" style={{ color: textPrimary }}>
                Work with the founder, 1-on-1 — at a special price.
              </h2>
              <p className="mt-4 text-lg font-semibold leading-7" style={{ color: textPrimary }}>
                2 spots only at $50 each. Offer closes 5 October 2026.
              </p>
              <p className="mt-4 max-w-3xl text-sm leading-7 sm:text-base" style={{ color: textMuted }}>
                Skip the queue price. For Preseason only, two founders get a personalised session — Gap Radar walkthrough, your specific gaps, a clear next step — at less than half the normal rate. Once both spots are gone, this price is gone.
              </p>
            </div>

            <div
              className="rounded-3xl border p-5 sm:p-6"
              style={{ backgroundColor: panelColor, borderColor }}
            >
              <p className="text-sm font-semibold" style={{ color: textPrimary }}>
                Preseason founder session
              </p>
              <p className="mt-2 text-sm leading-6" style={{ color: textMuted }}>
                Secure your 1-on-1 session directly through Flutterwave.
              </p>
              <button
                type="button"
                onClick={handlePreseasonCheckout}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold transition hover:scale-[1.01] hover:opacity-95"
                style={{
                  backgroundColor: primaryColor,
                  color: onPrimary || '#ffffff',
                  boxShadow: `0 16px 34px ${colorWithAlpha(primaryColor, 0.38)}`,
                }}
              >
                Claim Your Spot — $50
                <ArrowRight size={18} strokeWidth={2.6} />
              </button>
              <p className="mt-3 text-center text-xs font-medium" style={{ color: textMuted }}>
                Offer ends 5 Oct 2026
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="px-6 py-20" style={{ backgroundColor: sectionBackground }}>
        <div className="max-w-6xl mx-auto grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: textMuted }}>
              FAQ
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold" style={{ color: textPrimary }}>
              Fair questions, straight answers
            </h2>
          </div>
          <div className="space-y-3">
            {faqs.map((item) => (
              <details
                key={item.q}
                className="eg-faq rounded-2xl border p-6 shadow-sm transition-all duration-200 hover:shadow-md"
                style={{ backgroundColor: panelColor, borderColor }}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-lg font-semibold" style={{ color: textPrimary }}>
                  {item.q}
                  <span
                    className="eg-faq-icon flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: bgMedium, color: primaryColor }}
                  >
                    <Plus size={18} strokeWidth={2.6} />
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-7" style={{ color: textMuted }}>
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20" style={{ backgroundColor: pageBackground }}>
        <div
          className="relative mx-auto max-w-4xl overflow-hidden rounded-[2rem] px-8 py-16 text-center"
          style={{
            background: `radial-gradient(600px 300px at 20% 0%, ${colorWithAlpha(primaryColor, 0.5)}, transparent 60%), linear-gradient(135deg, ${palette?.primaryScale?.['900'] || '#4C1D95'}, #150B2E)`,
            border: `1px solid ${borderColor}`,
            color: '#ffffff',
          }}
        >
          <div className="relative z-10">
            <div className="flex justify-center mb-6">
              <BrandMark size={48} blockColor="#ffffff" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold mb-4">
              Stop guessing. Find out tonight.
            </h2>
            <p className="mx-auto mb-8 max-w-2xl leading-7 opacity-85">
              Fifteen minutes, free, on your phone. You’ll know exactly where your idea stands and what to fix — before you bet your savings or your notice period on it.
            </p>
            <button
              type="button"
              onClick={() => openLogin('assess')}
              className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:scale-[1.01]"
              style={{ backgroundColor: '#ffffff', color: '#0A0B14', boxShadow: '0 16px 32px rgba(0,0,0,0.18)' }}
            >
              Take the free assessment
              <ArrowRight size={18} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      </section>
      </main>

      <footer className="px-6 py-16" style={{ backgroundColor: palette?.surfaces?.pageAlt || pageBackground || '#05060B', color: 'rgba(255,255,255,0.85)' }}>
        <div className="max-w-6xl mx-auto flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <BrandMark size={28} />
              <span className="text-base font-semibold" style={{ color: '#ffffff' }}>
                {brandName}
              </span>
            </div>
            <p className="mt-3 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
              AI operating system for founders
            </p>
          </div>
          <div className="flex flex-wrap gap-x-16 gap-y-8">
            <div>
              <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: 'rgba(255,255,255,0.65)' }}>
                Product
              </p>
              <nav className="flex flex-col gap-2.5 text-sm">
                <a href="#the-wall" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>The problem</a>
                <a href="#covers" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>What it covers</a>
                <a href="#outputs" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>What you get</a>
                <a href="#platform" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>Platform</a>
                <a href="#pricing" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>Pricing</a>
                <a href="#faq" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>FAQ</a>
              </nav>
            </div>
            <div>
              <p className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: 'rgba(255,255,255,0.65)' }}>
                Company
              </p>
              <nav className="flex flex-col gap-2.5 text-sm">
                <a href="#privacy" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>Privacy Policy</a>
                <a href="mailto:hello@foundaros.com" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>Contact</a>
              </nav>
            </div>
          </div>
        </div>
        <div
          className="max-w-6xl mx-auto mt-12 flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.65)' }}
        >
          <span>© {new Date().getFullYear()} {brandName}. All rights reserved.</span>
          <span>Built for founders in Africa &amp; beyond.</span>
        </div>
      </footer>
    </div>
      {/* AUDOS:LANDING_SHELL:END */}

      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 backdrop-blur-sm"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.6)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-gate-login-title"
          onClick={(event) => {
            // Backdrop dismissal stays enabled even mid-submission — never trap the user
            if (event.target === event.currentTarget) {
              setLoginOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-md relative overflow-hidden rounded-3xl"
            style={{ backgroundColor: panelStrongColor, boxShadow: '0 30px 70px rgba(0,0,0,0.35)' }}
          >
            <button
              type="button"
              onClick={() => setLoginOpen(false)}
              aria-label="Close login"
              className="absolute right-3 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:opacity-80"
              style={{ backgroundColor: bgLight, color: textPrimary }}
            >
              <X size={18} strokeWidth={2.6} />
            </button>
            <div className="p-6 sm:p-8">
              <h2 id="email-gate-login-title" className="text-2xl font-extrabold mb-1" style={{ color: textPrimary }}>
                {loginMode === 'login' ? 'Welcome back' : 'Let’s find out where you stand'}
              </h2>
              <p className="text-sm mb-5" style={{ color: textMuted }}>
                {loginMode === 'login'
                  ? 'Log in to pick up right where you left off.'
                  : 'Enter your email to take the free assessment — your score and results are saved to it. Already taken it? Same door: you’ll pick up right where you left off.'}
              </p>
              <LoginPanel compact />
            </div>
          </div>
        </div>
      )}

      {/* Feature: floating AI chatbot widget (hidden while the login modal is open) */}
      {!loginOpen && (
        <>
          <style>{`
            @keyframes eg-chat-pop { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
            @keyframes eg-typing { 0%, 60%, 100% { opacity: 0.25; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
            .eg-chat-panel { animation: eg-chat-pop 0.26s ease; }
            .eg-typing-dot { display: inline-block; width: 6px; height: 6px; border-radius: 9999px; background: ${textMuted}; margin: 0 2px; animation: eg-typing 1.2s infinite ease-in-out; }
            .eg-typing-dot:nth-child(2) { animation-delay: 0.2s; }
            .eg-typing-dot:nth-child(3) { animation-delay: 0.4s; }
            @keyframes eg-fab-ring { 0% { transform: scale(0.85); opacity: 0.55; } 70% { transform: scale(1.5); opacity: 0; } 100% { transform: scale(1.5); opacity: 0; } }
            @keyframes eg-fab-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
            @keyframes eg-sparkle-twinkle { 0%, 100% { transform: scale(1) rotate(0deg); opacity: 1; } 50% { transform: scale(1.25) rotate(18deg); opacity: 0.75; } }
            .eg-fab { animation: eg-fab-float 3.2s ease-in-out infinite; }
            .eg-fab:hover { animation-play-state: paused; }
            .eg-fab-ring { animation: eg-fab-ring 2.4s ease-out infinite; }
            .eg-fab-sparkle { animation: eg-sparkle-twinkle 2.6s ease-in-out infinite; }
            @media (max-width: 639px) {
              .eg-chat-panel { position: fixed !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100% !important; max-width: 100% !important; border-radius: 18px 18px 0 0 !important; }
            }
          `}</style>

          {chatOpen && (
            <div
              className="eg-chat-panel fixed flex flex-col overflow-hidden"
              style={{
                bottom: 92,
                right: 24,
                width: 300,
                maxHeight: 440,
                height: 440,
                zIndex: 45,
                borderRadius: 18,
                backgroundColor: panelStrongColor,
                border: `1px solid ${borderColor}`,
                boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
                fontFamily: bodyFontStack,
              }}
              role="dialog"
              aria-label="FoundarOS assistant"
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: `1px solid ${borderColor}` }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full"
                    style={{ backgroundColor: colorWithAlpha(primaryColor, 0.18), color: primaryColor }}
                  >
                    <Bot size={16} strokeWidth={2.4} />
                  </span>
                  <span className="text-sm font-bold" style={{ color: textPrimary }}>
                    Ask FoundarOS
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  aria-label="Close chat"
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-opacity hover:opacity-70"
                  style={{ color: textMuted }}
                >
                  <X size={16} strokeWidth={2.6} />
                </button>
              </div>

              {/* Message list */}
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                <div
                  className="max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed"
                  style={{ backgroundColor: bgMedium, color: textPrimary }}
                >
                  Hi! I&apos;m the FoundarOS assistant. Ask me anything about your fundability
                  assessment, pricing, or what to expect.
                </div>
                {conversationHistory.length === 0 && !chatLoading && (
                  <div className="pt-1">
                    <div
                      className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: textMuted }}
                    >
                      Try asking
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {chatSuggestions.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => sendChatMessage(q)}
                          className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
                          style={{
                            backgroundColor: colorWithAlpha(primaryColor, 0.12),
                            color: primaryColor,
                            border: `1px solid ${colorWithAlpha(primaryColor, 0.35)}`,
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {conversationHistory.map((msg, i) => (
                  <div
                    key={i}
                    className="flex"
                    style={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
                  >
                    <div
                      className="max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap"
                      style={
                        msg.role === 'user'
                          ? { backgroundColor: primaryColor, color: onPrimary || '#ffffff' }
                          : { backgroundColor: bgMedium, color: textPrimary }
                      }
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex" style={{ justifyContent: 'flex-start' }}>
                    <div
                      className="rounded-2xl px-3 py-2"
                      style={{ backgroundColor: bgMedium }}
                      aria-label="Assistant is typing"
                    >
                      <span className="eg-typing-dot" />
                      <span className="eg-typing-dot" />
                      <span className="eg-typing-dot" />
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendChatMessage();
                }}
                className="flex items-center gap-2 px-3 py-3"
                style={{ borderTop: `1px solid ${borderColor}` }}
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type your question…"
                  aria-label="Message"
                  className="flex-1 rounded-full px-3 py-2 text-xs outline-none"
                  style={{
                    backgroundColor: bgMedium,
                    color: textPrimary,
                    border: `1px solid ${borderColor}`,
                  }}
                />
                <button
                  type="submit"
                  disabled={chatLoading || !chatInput.trim()}
                  aria-label="Send message"
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
                  style={{ backgroundColor: primaryColor, color: onPrimary || '#ffffff' }}
                >
                  <ArrowRight size={16} strokeWidth={2.6} />
                </button>
              </form>
            </div>
          )}

          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            aria-label={chatOpen ? 'Close assistant' : 'Open assistant'}
            aria-expanded={chatOpen}
            className={`eg-fab fixed flex items-center justify-center rounded-full transition-transform hover:scale-110${
              chatOpen ? ' !animate-none' : ''
            }`}
            style={{
              bottom: 24,
              right: 24,
              width: 60,
              height: 60,
              zIndex: 45,
              color: onPrimary || '#ffffff',
              background: `linear-gradient(145deg, ${colorWithAlpha(
                primaryColor,
                0.95,
              )} 0%, ${primaryColor} 45%, ${colorWithAlpha('#6366f1', 0.95)} 100%)`,
              border: `1px solid ${colorWithAlpha('#ffffff', 0.25)}`,
              boxShadow: `0 14px 34px ${colorWithAlpha(primaryColor, 0.55)}`,
            }}
          >
            {/* Pulsing attention ring (only while closed) */}
            {!chatOpen && (
              <span
                className="eg-fab-ring pointer-events-none absolute inset-0 rounded-full"
                style={{ border: `2px solid ${colorWithAlpha(primaryColor, 0.6)}` }}
                aria-hidden="true"
              />
            )}
            {chatOpen ? (
              <X size={24} strokeWidth={2.6} />
            ) : (
              <span className="relative flex items-center justify-center">
                <Bot size={26} strokeWidth={2.2} />
                <Sparkles
                  size={13}
                  strokeWidth={2.6}
                  className="eg-fab-sparkle absolute"
                  style={{ top: -8, right: -9, color: '#fde047' }}
                  aria-hidden="true"
                />
              </span>
            )}
          </button>
        </>
      )}

      {/* Feature: cookie consent banner */}
      {cookieConsentVisible && (
        <>
          <style>{`
            @keyframes eg-cookie-up { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: translateY(0); } }
            .eg-cookie-banner { animation: eg-cookie-up 0.4s ease; }
          `}</style>
          <div
            className="eg-cookie-banner fixed inset-x-0 bottom-0"
            style={{
              zIndex: 50,
              backgroundColor: panelStrongColor,
              borderTop: `1px solid ${borderColor}`,
              boxShadow: '0 -12px 40px rgba(0,0,0,0.4)',
              fontFamily: bodyFontStack,
            }}
            role="region"
            aria-label="Cookie consent"
          >
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <p className="font-bold" style={{ color: textPrimary }}>
                  We use cookies
                </p>
                <p className="mt-1 leading-relaxed" style={{ color: textMuted }}>
                  We use cookies to improve your experience, understand how visitors use our site,
                  and personalise your journey. You can accept all or decline non-essential cookies.{' '}
                  <a
                    href="#privacy"
                    className="underline underline-offset-2"
                    style={{ color: primaryColor }}
                  >
                    Privacy Policy
                  </a>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => handleCookieConsent('declined')}
                  className="rounded-full px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ backgroundColor: 'transparent', color: textPrimary, border: `1px solid ${borderColor}` }}
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => handleCookieConsent('accepted')}
                  className="rounded-full px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: primaryColor, color: onPrimary || '#ffffff' }}
                >
                  Accept All
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
