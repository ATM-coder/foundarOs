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
  Heart,
  Check,
  Building2,
  Landmark,
  Lock,
  Bot,
  Briefcase,
} from 'lucide-react';
import { useSpaceRuntime } from '../SpaceRuntimeContext';
import type { DesktopThemeTokens } from '../types';

// Version marker for auto-upgrade detection
// Increment this when making breaking changes that stale copies need
export const EMAIL_GATE_VERSION = 101; // v101: Landing-page shell aligned with legacy landing generation structure

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
  const [entered, setEntered] = useState(false);
  const [scrolled, setScrolled] = useState(false);

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
              const configRes = await fetch(`/api/auth/otp/space/config/${workspaceId}`);
              const configData = await configRes.json();
              const otpConfig = configData.config || configData;

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
        const configRes = await fetch(`/api/auth/otp/space/config/${workspaceId}`);
        const configData = await configRes.json();
        const otpConfig = configData.config || configData;
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

        const registerRes = await fetch(`/api/space/${spaceId}/register`, {
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

        const response = await fetch('/api/auth/otp/space/send', {
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
      setError('Connection error. Please check your internet connection and try again.');
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

    const response = await fetch(`/api/space/${spaceId}/register`, {
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
  // Vibrant hero gradient built from the workspace palette (never hardcoded
  // brand hex) so every generated space gets its own energetic look.
  const heroGradient = `linear-gradient(135deg, ${primaryColor} 0%, ${highlightColor} 55%, ${contrastColor} 115%)`;
  const brandGradient = `linear-gradient(135deg, ${primaryColor} 0%, ${highlightColor} 100%)`;
  // Hero copy + CTAs sit on the gradient/video, so they stay white over a
  // dark scrim. The scrim deepens for light primaries so text stays legible
  // regardless of the workspace palette (contrast may resolve to white).
  const primaryRgb = hexToRgb(primaryColor);
  const primaryIsLight = primaryRgb
    ? (0.2126 * primaryRgb.r + 0.7152 * primaryRgb.g + 0.0722 * primaryRgb.b) / 255 > 0.62
    : false;
  const heroScrim = `linear-gradient(105deg, rgba(0,0,0,${primaryIsLight ? 0.6 : 0.42}) 0%, rgba(0,0,0,${primaryIsLight ? 0.42 : 0.18}) 48%, rgba(0,0,0,0) 88%)`;
  const heroVideoUrl =
    branding?.heroVideoUrl ||
    runtimeBranding.heroVideoUrl ||
    (window as any).__WORKSPACE_HERO_VIDEO_URL__ ||
    '';
  const heroHasVideo = typeof heroVideoUrl === 'string' && heroVideoUrl.trim().length > 0;
  const loginPanelId = 'email-gate-login-panel';

  const openLogin = () => {
    setLoginOpen(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="input-email"]');
      input?.focus();
    }, 0);
  };

  const scoreCategories = [
    {
      title: 'Idea Clarity',
      desc: 'Is your idea sharp and well-defined?',
    },
    {
      title: 'Market Validation',
      desc: 'Have you proven people actually want this?',
    },
    {
      title: 'Financial Thinking',
      desc: 'Do the numbers add up?',
    },
    {
      title: 'Fundability',
      desc: 'Are you ready for investor conversations?',
    },
  ];
  const howItWorks = [
    { step: '1', title: 'Take the assessment', desc: 'Answer 30 focused questions about your idea, market, and numbers. No prep, no documents required.' },
    { step: '2', title: 'See your score and gaps', desc: 'Get your Funding Readiness Score and an honest read on exactly where investors would push back.' },
    { step: '3', title: 'Unlock your next steps', desc: 'Upgrade once ($49) to generate five downloadable documents — including a real editable PowerPoint Pitch Deck — plus the AI Pitch Coach.' },
  ];
  const whoWeServe = [
    { title: 'Aspiring entrepreneurs', desc: 'You have an idea and want to turn it into a viable business. Start with an honest read on where it stands before you go all in.' },
    { title: 'Early-stage startups', desc: 'You are building and validating your model. Find the gaps investors would flag and close them while you still have time.' },
    { title: 'Small businesses seeking funding', desc: 'You need capital to grow. Prepare a fundable case — the plan, deck, and financial model lenders and investors expect.' },
    { title: 'Founders preparing for grants, accelerators & investors', desc: 'The pitch is coming. Get pitch-ready with grant application support and AI-powered pitch practice before the big conversations.' },
  ];
  const faqs = [
    { q: 'How long does the assessment take?', a: 'About 5–10 minutes. It is 30 focused questions about your idea, market, and numbers — no documents or prep required.' },
    { q: 'Is it free?', a: 'Yes. The assessment, your Funding Readiness Score, your category breakdown, and your top gaps with recommended actions are all free. A $49 one-time upgrade unlocks five downloadable documents — a Business Plan, editable PowerPoint Pitch Deck, Financial Model, Grant Application Assistant, and Action Plan — plus the AI Pitch Coach.' },
    { q: 'What do I get at the end?', a: 'Your overall Funding Readiness Score, a breakdown across Idea Clarity, Market Validation, Financial Thinking, and Fundability, and a clear view of the gaps investors would push back on — with the option to unlock the full document pack and AI pitch coaching, built from your own answers.' },
    { q: 'Who is this for?', a: 'Founders at every stage: aspiring entrepreneurs turning ideas into viable businesses, early-stage startups building and validating their model, small businesses preparing a fundable case, and founders getting pitch-ready for grants, accelerators, and investors.' },
    { q: 'What is coming next?', a: 'Business Support & Operations for founders post-incorporation — SOPs, HR handbook, employee contracts, vendor agreements, policies, KPI dashboards, and more — plus a bench of specialist AI coaches, from CFO AI to Grant Coach. Funding readiness is live today; these are next on the roadmap.' },
  ];
  const readinessFree = [
    '30-question readiness assessment',
    'Funding Readiness Score with category breakdown',
    'Top gaps and recommended actions',
  ];
  const readinessPaid = [
    'Business Plan — a generated, investor-ready document',
    'Pitch Deck — a full PPT-format deck in your brand name and colours, delivered as an editable file so you can add your logo',
    'Financial Model generation',
    'Grant Application Assistant',
    'Action Plan & Executive Summary',
    'Pitch Coach — AI-powered pitch practice with feedback',
  ];
  const comingSoonOps = [
    'SOPs',
    'Procurement policies',
    'HR handbook',
    'Employee contracts',
    'Vendor agreements',
    'Risk Register',
    'KPI dashboard',
    'OKRs',
    'Board meeting templates',
    'Company policies',
    'Sales playbooks',
  ];
  const comingSoonCoaches = [
    'CFO AI',
    'CEO Coach',
    'Grant Coach',
    'Operations Manager',
    'HR Manager',
    'Procurement Manager',
    'Marketing Advisor',
    'Legal Document Assistant',
  ];

  // Presentational icons paired with the content arrays above by index.
  // Kept separate so the copy arrays stay plain for per-workspace rewrites.
  const scoreCategoryIcons = [Lightbulb, Users, Calculator, Rocket];
  const howItWorksIcons = [ClipboardList, Gauge, FileText];
  const whoWeServeIcons = [Lightbulb, Rocket, Building2, Landmark];

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
            Start your free assessment
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
          {error && (
            <p className="mt-2 text-xs" style={{ color: dangerColor }} data-testid="text-error">
              {error}
            </p>
          )}
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
          {loading ? 'Just a moment...' : 'Start my free assessment'}
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
        <div className="flex-1 flex items-center justify-center px-6 py-12">
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
                {error && (
                  <p className="mt-2 text-xs" style={{ color: dangerColor }} data-testid="text-error">
                    {error}
                  </p>
                )}
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
        </div>

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
      <style>{`
        @keyframes eg-blob { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(14px, -20px) scale(1.08); } }
        .eg-blob { animation: eg-blob 9s ease-in-out infinite; }
        .eg-root { scroll-behavior: smooth; }
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
                {tagline}
              </p>
            </div>
          </a>
          <div className="hidden items-center gap-6 md:flex">
            <a
              href="#platform"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              Platform
            </a>
            <a
              href="#who-we-serve"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              Who we serve
            </a>
            <a
              href="#faq"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: scrolled ? textMuted : 'rgba(255,255,255,0.82)' }}
            >
              FAQ
            </a>
          </div>
          <button
            type="button"
            onClick={openLogin}
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition hover:opacity-90"
            style={{ backgroundColor: highlightColor, color: onHighlight }}
          >
            Start free assessment
            <ArrowRight size={15} strokeWidth={2.6} />
          </button>
        </div>
      </nav>
      <section
        id="hero"
        className="relative flex min-h-screen min-h-[100svh] items-center overflow-hidden px-6 py-24 sm:py-28"
        style={{ background: heroHasVideo ? '#0f172a' : heroGradient }}
      >
        {heroHasVideo && (
          <video
            src={heroVideoUrl}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-slate-950/65" />
        {!heroHasVideo && <div className="absolute inset-0" style={{ background: heroScrim, opacity: 0.65 }} />}

        <div
          className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-8"
          style={{
            opacity: entered ? 1 : 0,
            transform: entered ? 'none' : 'translateY(20px)',
            transition: 'opacity 0.7s ease, transform 0.7s ease',
          }}
        >
          <div className="max-w-3xl space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/70">
              {brandName}
            </p>
            <h1
              className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl"
              style={{ color: '#ffffff' }}
            >
              Your AI co-founder, from first idea to funded business.
            </h1>
            <p
              className="max-w-2xl text-lg leading-8"
              style={{ color: 'rgba(255,255,255,0.78)' }}
            >
              {brandName} is the AI operating system for every stage of your founder journey. Start with the free Funding Readiness assessment — then generate your business plan, pitch deck, and financial model, and practice your pitch with AI coaching.
            </p>
            <div className="flex flex-col items-start gap-4 sm:flex-row">
              <button
                type="button"
                onClick={openLogin}
                aria-controls={loginPanelId}
                className="flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:scale-[1.01]"
                style={{ backgroundColor: '#ffffff', color: textPrimary, boxShadow: '0 16px 32px rgba(0,0,0,0.18)' }}
                data-testid="button-open-login"
              >
                Start the free assessment
                <ArrowRight size={18} strokeWidth={2.6} />
              </button>
              <a
                href="#how-it-works"
                className="rounded-full px-6 py-3 text-sm font-semibold text-white/75 transition hover:text-white"
              >
                See how it works
              </a>
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="border-b px-6 py-20"
        style={{ backgroundColor: sectionBackground, borderColor }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: textMuted }}>
              How it works
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              From idea to investor-ready in three steps
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              No prep required — take the assessment and {brandName} shows you exactly what to do next.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {howItWorks.map((item, i) => {
              const StepIcon = howItWorksIcons[i] ?? Sparkles;
              return (
                <div
                  key={item.step}
                  className="relative overflow-hidden rounded-3xl border p-8"
                  style={{ backgroundColor: panelColor, borderColor }}
                >
                  <StepIcon
                    size={72}
                    strokeWidth={1.5}
                    className="pointer-events-none absolute -right-3 -top-3 opacity-10"
                    style={{ color: primaryColor }}
                  />
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-semibold"
                    style={{ backgroundColor: highlightColor, color: onHighlight }}
                  >
                    {item.step}
                  </div>
                  <h3 className="font-semibold mb-2" style={{ color: textPrimary }}>
                    {item.title}
                  </h3>
                  <p className="text-sm leading-7" style={{ color: textMuted }}>
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="features"
        className="px-6 py-20"
        style={{ backgroundColor: pageBackground }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <span
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-[0.3em]"
              style={{ color: textMuted }}
            >
              The free assessment
            </span>
            <h2 className="text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              Your Funding Readiness Score, across four categories
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              The assessment scores your idea in the four areas investors actually evaluate, so you know what is strong and what needs work before you pitch.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {scoreCategories.map((item, i) => {
              const CardIcon = scoreCategoryIcons[i] ?? Sparkles;
              return (
                <div
                  key={item.title}
                  className="rounded-3xl border p-6 shadow-sm"
                  style={{ backgroundColor: panelColor, borderColor }}
                >
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: highlightColor, color: onHighlight }}
                  >
                    <CardIcon size={22} strokeWidth={2.4} />
                  </div>
                  <h3 className="text-xl font-semibold mb-2" style={{ color: textPrimary }}>
                    {item.title}
                  </h3>
                  <p className="text-sm leading-7" style={{ color: textMuted }}>
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="platform" className="border-t px-6 py-20" style={{ backgroundColor: pageBackground, borderColor }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: textMuted }}>
              The platform
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              Build, fund, and grow — with AI at every stage
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              Investment &amp; Funding Readiness is live today. Business operations tools and specialist AI coaches are next — {brandName} grows with you from first idea to running the company.
            </p>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-3">
            <div className="rounded-3xl border-2 p-6 sm:p-8" style={{ backgroundColor: panelColor, borderColor: primaryColor }}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: highlightColor, color: onHighlight }}
              >
                <Sparkles size={13} strokeWidth={2.6} />
                Live now
              </span>
              <h3 className="mt-4 text-xl font-semibold" style={{ color: textPrimary }}>
                Investment &amp; Funding Readiness
              </h3>
              <p className="mt-1 text-sm leading-6" style={{ color: textMuted }}>
                Know exactly where you stand — then generate what investors ask for.
              </p>
              <p className="mt-5 text-xs font-semibold uppercase tracking-wider" style={{ color: textSubtle }}>
                Free
              </p>
              <ul className="mt-2 space-y-2">
                {readinessFree.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm leading-6" style={{ color: textMuted }}>
                    <Check size={16} strokeWidth={2.8} className="mt-1 shrink-0" style={{ color: primaryColor }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs font-semibold uppercase tracking-wider" style={{ color: textSubtle }}>
                $49 one-time upgrade unlocks
              </p>
              <ul className="mt-2 space-y-2">
                {readinessPaid.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm leading-6" style={{ color: textMuted }}>
                    <Sparkles size={16} strokeWidth={2.4} className="mt-1 shrink-0" style={{ color: highlightColor }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={openLogin}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition hover:opacity-90"
                style={{ backgroundColor: primaryColor, color: onPrimary }}
              >
                Start free assessment
                <ArrowRight size={16} strokeWidth={2.6} />
              </button>
            </div>

            <div className="rounded-3xl border p-6 sm:p-8" style={{ backgroundColor: panelColor, borderColor }}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: bgMedium, color: textMuted }}
              >
                <Lock size={12} strokeWidth={2.6} />
                Coming soon
              </span>
              <div className="mt-4 flex items-center gap-2">
                <Briefcase size={20} strokeWidth={2.2} style={{ color: primaryColor }} />
                <h3 className="text-xl font-semibold" style={{ color: textPrimary }}>
                  Business Support &amp; Operations
                </h3>
              </div>
              <p className="mt-1 text-sm leading-6" style={{ color: textMuted }}>
                Once you incorporate, generate the documents that run the company:
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {comingSoonOps.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border px-3 py-1 text-xs font-medium"
                    style={{ borderColor, color: textMuted, backgroundColor: sectionBackground }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border p-6 sm:p-8" style={{ backgroundColor: panelColor, borderColor }}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: bgMedium, color: textMuted }}
              >
                <Lock size={12} strokeWidth={2.6} />
                Coming soon
              </span>
              <div className="mt-4 flex items-center gap-2">
                <Bot size={20} strokeWidth={2.2} style={{ color: primaryColor }} />
                <h3 className="text-xl font-semibold" style={{ color: textPrimary }}>
                  AI Coaches
                </h3>
              </div>
              <p className="mt-1 text-sm leading-6" style={{ color: textMuted }}>
                Specialist AI agents on call for every role you can’t hire yet:
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {comingSoonCoaches.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border px-3 py-1 text-xs font-medium"
                    style={{ borderColor, color: textMuted, backgroundColor: sectionBackground }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="who-we-serve" className="border-y px-6 py-20" style={{ backgroundColor: sectionBackground, borderColor }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: textMuted }}>
              Who we serve
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-semibold mb-3" style={{ color: textPrimary }}>
              Built for founders at every stage
            </h2>
            <p className="max-w-2xl text-base leading-7" style={{ color: textMuted }}>
              Wherever you are on the journey, {brandName} meets you there.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {whoWeServe.map((item, i) => {
              const WhoIcon = whoWeServeIcons[i] ?? Heart;
              return (
                <div
                  key={item.title}
                  className="relative overflow-hidden rounded-3xl border p-6 shadow-sm"
                  style={{ backgroundColor: panelColor, borderColor }}
                >
                  <WhoIcon size={64} strokeWidth={1.5} className="pointer-events-none absolute -right-2 -top-2 opacity-10" style={{ color: primaryColor }} />
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: highlightColor, color: onHighlight }}
                  >
                    <WhoIcon size={22} strokeWidth={2.4} />
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
        </div>
      </section>

      <section id="faq" className="px-6 py-20" style={{ backgroundColor: sectionBackground }}>
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-semibold mb-10" style={{ color: textPrimary }}>
            Frequently asked questions
          </h2>
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

      <section className="px-6 py-20" style={{ backgroundColor: primaryColor }}>
        <div
          className="relative mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-white/10 px-8 py-16 text-center"
          style={{ backgroundColor: 'rgba(15,23,42,0.2)', color: onPrimary }}
        >
          <div className="relative z-10">
            <div className="flex justify-center mb-6">
              <BrandMark size={48} blockColor="#ffffff" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold mb-4">
              Wherever you are in the journey, start here
            </h2>
            <p className="mx-auto mb-8 max-w-2xl leading-7 opacity-85">
              The free Funding Readiness assessment is live today. Get your score in minutes — then let {brandName} help you build, fund, and grow from there. No credit card required.
            </p>
            <button
              type="button"
              onClick={openLogin}
              className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition hover:scale-[1.01]"
              style={{ backgroundColor: '#ffffff', color: textPrimary, boxShadow: '0 16px 32px rgba(0,0,0,0.18)' }}
            >
              Start the free assessment
              <ArrowRight size={18} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      </section>

      <footer className="px-6 py-12" style={{ backgroundColor: palette?.text?.primary || '#012538', color: 'rgba(255,255,255,0.85)' }}>
        <div className="max-w-6xl mx-auto flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <BrandMark size={28} />
              <span className="text-base font-semibold" style={{ color: '#ffffff' }}>
                {brandName}
              </span>
            </div>
            <p className="mt-3 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
              {tagline}
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <a href="#how-it-works" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>How it works</a>
            <a href="#platform" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>Platform</a>
            <a href="#who-we-serve" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>Who we serve</a>
            <a href="#faq" className="transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>FAQ</a>
          </nav>
        </div>
        <div
          className="max-w-6xl mx-auto mt-8 border-t pt-6 text-xs"
          style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.45)' }}
        >
          © {new Date().getFullYear()} {brandName}. All rights reserved.
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
            if (event.target === event.currentTarget && !loading) {
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
              disabled={loading}
              aria-label="Close login"
              className="absolute right-3 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:opacity-80"
              style={{ backgroundColor: bgLight, color: textPrimary }}
            >
              <X size={18} strokeWidth={2.6} />
            </button>
            <div className="p-6 sm:p-8">
              <h2 id="email-gate-login-title" className="text-2xl font-extrabold mb-1" style={{ color: textPrimary }}>
                Welcome to {brandName}
              </h2>
              <p className="text-sm mb-5" style={{ color: textMuted }}>
                Enter your email to start your free assessment. Already taken it? Same door — you’ll pick up right where you left off.
              </p>
              <LoginPanel compact />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
