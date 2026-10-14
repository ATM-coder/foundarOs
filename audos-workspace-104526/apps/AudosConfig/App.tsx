import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  BarChart3,
  Check,
  Clock3,
  ExternalLink,
  RefreshCw,
  Save,
  Settings2,
  Share2,
  Users,
} from 'lucide-react';
import { tw } from '../../lib/colors';

type Tab = 'configuration' | 'analytics';

type ReferralStatus =
  | 'DISCOVERED'
  | 'BUILD_CTA_CLICKED'
  | 'AUDOS_VISITED'
  | 'AUDOS_SIGNED_UP'
  | 'BUILD_STARTED'
  | 'QUALIFIED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'PENDING';

interface ReferralConfig {
  id: string;
  referral_url: string;
  referral_owner: string;
  referral_id: string;
  referral_source_in_app: string;
  payout_amount: string;
  payout_currency: string;
  qualification_rule: string;
  updated_at?: string | null;
}

interface ReferralEvent {
  id: string;
  user_id: string | null;
  idea_id: string | null;
  idea_name: string | null;
  source: string;
  status: ReferralStatus;
  referral_owner: string;
  referral_url_used: string | null;
  campaign_source: string | null;
  campaign_medium: string | null;
  campaign_name: string | null;
  original_ref_param: string | null;
  build_brief_text: string | null;
  click_timestamp: string | null;
  created_at: string | null;
}

const EMPTY_CONFIG: ReferralConfig = {
  id: 'default',
  referral_url: '',
  referral_owner: 'Nkechi',
  referral_id: '',
  referral_source_in_app: 'foundaros_idea_discovery',
  payout_amount: '25',
  payout_currency: 'USD',
  qualification_rule: '',
};

const STATUSES: ReferralStatus[] = [
  'DISCOVERED',
  'BUILD_CTA_CLICKED',
  'AUDOS_VISITED',
  'AUDOS_SIGNED_UP',
  'BUILD_STARTED',
  'PENDING',
  'QUALIFIED',
  'CONFIRMED',
  'REJECTED',
];

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function humanizeStatus(status: string) {
  return status.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: ReferralStatus) {
  if (status === 'CONFIRMED' || status === 'QUALIFIED') {
    return 'text-[var(--space-semantic-success)] bg-[color-mix(in_srgb,var(--space-semantic-success)_12%,transparent)] border-[color-mix(in_srgb,var(--space-semantic-success)_35%,transparent)]';
  }
  if (status === 'REJECTED') {
    return 'text-[var(--space-semantic-danger)] bg-[color-mix(in_srgb,var(--space-semantic-danger)_12%,transparent)] border-[color-mix(in_srgb,var(--space-semantic-danger)_35%,transparent)]';
  }
  if (status === 'PENDING') {
    return 'text-[var(--space-semantic-warning)] bg-[color-mix(in_srgb,var(--space-semantic-warning)_12%,transparent)] border-[color-mix(in_srgb,var(--space-semantic-warning)_35%,transparent)]';
  }
  return 'text-[var(--space-text-accent)] bg-[var(--space-surface-accent-soft)] border-[var(--space-border-strong)]';
}

function referralPreview(config: ReferralConfig) {
  if (!config.referral_url.trim()) {
    return 'No referral link set. “Build on Audos” sends users to https://audos.com without your referral, so signups are not credited to you. Paste your Audos referral link above and save.';
  }
  try {
    const url = new URL(config.referral_url.trim());
    if (config.referral_id.trim()) url.searchParams.set('ref', config.referral_id.trim());
    url.searchParams.set('source', config.referral_source_in_app.trim() || 'foundaros_idea_discovery');
    return url.toString();
  } catch {
    return 'Enter a valid absolute referral URL to see the preview.';
  }
}

function MetricCard({ label, value, note, icon: Icon }: { label: string; value: string | number; note?: string; icon: any }) {
  return (
    <div className={`${tw.card.glass} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-medium ${tw.typography.color.muted}`}>{label}</p>
        <Icon className={`w-4 h-4 ${tw.icon.primary}`} />
      </div>
      <p className={`mt-2 text-2xl font-bold ${tw.typography.color.primary}`}>{value}</p>
      {note && <p className={`mt-1 text-xs ${tw.typography.color.muted}`}>{note}</p>}
    </div>
  );
}

export default function AudosConfig() {
  const [tab, setTab] = useState<Tab>('configuration');
  const [form, setForm] = useState<ReferralConfig>(EMPTY_CONFIG);
  const [configHydrated, setConfigHydrated] = useState(false);
  const [configExists, setConfigExists] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selectedReferralId, setSelectedReferralId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<ReferralStatus>('PENDING');
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusSaved, setStatusSaved] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const configQuery = (window as any).useWorkspaceDB('audos_referral_config', {
    shared: true,
    limit: 10,
  }) as { data: ReferralConfig[]; loading: boolean; error: Error | null; refresh: () => void };

  const referralQuery = (window as any).useWorkspaceDB('audos_referrals', {
    shared: true,
    orderBy: { column: 'click_timestamp', direction: 'desc' },
    limit: 1000,
  }) as { data: ReferralEvent[]; loading: boolean; error: Error | null; refresh: () => void };

  const configRow = useMemo(
    () => (configQuery.data || []).find((row) => row.id === 'default') || configQuery.data?.[0] || null,
    [configQuery.data],
  );

  useEffect(() => {
    if (configQuery.loading || configHydrated) return;
    setForm(configRow ? { ...EMPTY_CONFIG, ...configRow, id: 'default' } : EMPTY_CONFIG);
    setConfigExists(Boolean(configRow));
    setConfigHydrated(true);
  }, [configHydrated, configQuery.loading, configRow]);

  const rows = useMemo(() => {
    return [...(referralQuery.data || [])].sort((a, b) => {
      const left = new Date(a.click_timestamp || a.created_at || 0).getTime();
      const right = new Date(b.click_timestamp || b.created_at || 0).getTime();
      return right - left;
    });
  }, [referralQuery.data]);

  const statusCounts = useMemo(() => {
    return rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});
  }, [rows]);

  const uniqueUsers = useMemo(
    () => new Set(rows.map((row) => row.user_id).filter(Boolean)).size,
    [rows],
  );
  const pending = statusCounts.PENDING || 0;
  const qualified = statusCounts.QUALIFIED || 0;
  const confirmed = statusCounts.CONFIRMED || 0;
  const conversionRate = confirmed > 0 ? `${((confirmed / Math.max(rows.length, 1)) * 100).toFixed(1)}%` : 'Awaiting qualification rules';
  const payoutAmount = Number(form.payout_amount);
  const confirmedPayout = confirmed > 0 && Number.isFinite(payoutAmount)
    ? `${form.payout_currency} ${(confirmed * payoutAmount).toLocaleString()}`
    : undefined;

  const funnel = useMemo(() => {
    const atOrBeyondVisited = ['AUDOS_VISITED', 'AUDOS_SIGNED_UP', 'BUILD_STARTED', 'QUALIFIED', 'CONFIRMED']
      .reduce((sum, status) => sum + (statusCounts[status] || 0), 0);
    const builders = ['BUILD_STARTED', 'QUALIFIED', 'CONFIRMED']
      .reduce((sum, status) => sum + (statusCounts[status] || 0), 0);
    return [
      { label: 'Idea Discovery Users', value: uniqueUsers },
      { label: 'Ideas Completed', value: rows.filter((row) => Boolean(row.idea_name)).length },
      { label: 'Build on Audos CTA Clicks', value: rows.length },
      { label: 'Audos Referrals', value: atOrBeyondVisited },
      { label: 'Builders Started', value: builders },
      { label: 'Qualified', value: qualified + confirmed },
      { label: 'Confirmed', value: confirmed },
    ];
  }, [confirmed, qualified, rows, statusCounts, uniqueUsers]);

  const setField = (field: keyof ReferralConfig, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setConfigSaved(false);
  };

  const saveConfiguration = async (event: FormEvent) => {
    event.preventDefault();
    setSavingConfig(true);
    setConfigSaved(false);
    setConfigError(null);
    try {
      const db = (window as any).__workspaceDb;
      const payload = { ...form, id: 'default', updated_at: new Date().toISOString() };
      if (configRow || configExists) {
        await db.from('audos_referral_config').update('default', {
          referral_url: payload.referral_url,
          referral_owner: payload.referral_owner,
          referral_id: payload.referral_id,
          referral_source_in_app: payload.referral_source_in_app,
          payout_amount: payload.payout_amount,
          payout_currency: payload.payout_currency,
          qualification_rule: payload.qualification_rule,
          updated_at: payload.updated_at,
        });
      } else {
        await db.from('audos_referral_config').insert(payload);
      }
      setForm(payload);
      setConfigExists(true);
      setConfigSaved(true);
      configQuery.refresh();
      window.setTimeout(() => setConfigSaved(false), 2500);
    } catch (error) {
      console.warn('[AudosConfig] configuration save failed.', error);
      setConfigError('Configuration could not be saved. Please try again.');
    } finally {
      setSavingConfig(false);
    }
  };

  const updateReferralStatus = async () => {
    if (!selectedReferralId) return;
    setSavingStatus(true);
    setStatusSaved(false);
    setStatusError(null);
    try {
      const db = (window as any).__workspaceDb;
      await db.from('audos_referrals').update(selectedReferralId, { status: selectedStatus });
      setStatusSaved(true);
      referralQuery.refresh();
      window.setTimeout(() => setStatusSaved(false), 2500);
    } catch (error) {
      console.warn('[AudosConfig] referral status update failed.', error);
      setStatusError('Status could not be updated. Please try again.');
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <span className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>Internal · Build Partners</span>
            <h1 className={`mt-1 text-2xl sm:text-3xl font-bold ${tw.typography.color.primary}`}>Audos Referral</h1>
          </div>
          <div className="inline-flex rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] p-1 self-start">
            <button
              type="button"
              onClick={() => setTab('configuration')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${tab === 'configuration' ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)]' : tw.typography.color.secondary}`}
            >
              <Settings2 className="w-4 h-4" /> Configuration
            </button>
            <button
              type="button"
              onClick={() => setTab('analytics')}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${tab === 'analytics' ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)]' : tw.typography.color.secondary}`}
            >
              <BarChart3 className="w-4 h-4" /> Analytics
            </button>
          </div>
        </div>

        {tab === 'configuration' ? (
          <section className="mt-7">
            <h2 className={`text-xl font-bold ${tw.typography.color.primary}`}>Audos Referral Configuration</h2>
            <p className={`mt-1 text-sm ${tw.typography.color.secondary}`}>Configure your referral attribution settings. These values power the Build with Audos CTA across FoundarOS.</p>

            <form onSubmit={saveConfiguration} className={`${tw.card.glass} mt-5 p-5 sm:p-6`}>
              {configQuery.loading && !configHydrated ? (
                <div className={`flex items-center gap-2 text-sm ${tw.typography.color.muted}`}><RefreshCw className="w-4 h-4 animate-spin" /> Loading configuration…</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-5">
                  <Field label="Audos Referral URL" note="Your unique referral link supplied by Audos.">
                    <input value={form.referral_url} onChange={(e) => setField('referral_url', e.target.value)} placeholder="Paste your unique Audos referral link" className={`${tw.input.base} ${tw.input.default} text-sm`} />
                  </Field>
                  <Field label="Referral Owner">
                    <input value={form.referral_owner} onChange={(e) => setField('referral_owner', e.target.value)} className={`${tw.input.base} ${tw.input.default} text-sm`} />
                  </Field>
                  <Field label="Referral Identifier" note="For example, a value that becomes ref=your-id.">
                    <input value={form.referral_id} onChange={(e) => setField('referral_id', e.target.value)} placeholder="nkechi" className={`${tw.input.base} ${tw.input.default} text-sm`} />
                  </Field>
                  <Field label="Source (in-app)" note="How FoundarOS identifies itself in attribution.">
                    <input value={form.referral_source_in_app} onChange={(e) => setField('referral_source_in_app', e.target.value)} className={`${tw.input.base} ${tw.input.default} text-sm`} />
                  </Field>
                  <Field label="Referral Payout Amount">
                    <input value={form.payout_amount} onChange={(e) => setField('payout_amount', e.target.value)} inputMode="decimal" className={`${tw.input.base} ${tw.input.default} text-sm`} />
                  </Field>
                  <Field label="Currency">
                    <select value={form.payout_currency} onChange={(e) => setField('payout_currency', e.target.value)} className={`${tw.input.base} ${tw.input.default} text-sm`}>
                      {['USD', 'GBP', 'EUR', 'NGN'].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                    </select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Qualification Rule">
                      <textarea value={form.qualification_rule} onChange={(e) => setField('qualification_rule', e.target.value)} rows={4} placeholder="To be confirmed by Audos" className={`${tw.input.base} ${tw.input.default} resize-y text-sm`} />
                    </Field>
                  </div>
                </div>
              )}

              {configError && <p className="mt-4 text-sm text-[var(--space-semantic-danger)]">{configError}</p>}
              <div className="mt-6 flex items-center gap-3">
                <button type="submit" disabled={savingConfig || configQuery.loading} className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm ${tw.button.primary} ${(savingConfig || configQuery.loading) ? tw.button.disabled : ''}`}>
                  {savingConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : configSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {configSaved ? 'Configuration Saved' : 'Save Configuration'}
                </button>
              </div>
            </form>

            <div className={`${tw.card.flat} mt-5 p-4`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${tw.typography.color.accent}`}>Current referral URL preview</p>
              <p className={`mt-2 text-sm break-all ${form.referral_url.trim() ? tw.typography.color.secondary : tw.typography.color.muted}`}>{referralPreview(form)}</p>
            </div>
          </section>
        ) : (
          <section className="mt-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className={`text-xl font-bold ${tw.typography.color.primary}`}>Audos Referral Performance</h2>
                <p className={`mt-1 text-sm ${tw.typography.color.secondary}`}>Track how many founders FoundarOS is sending to Audos.</p>
              </div>
              <button type="button" onClick={referralQuery.refresh} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${tw.button.secondary}`}>
                <RefreshCw className={`w-4 h-4 ${referralQuery.loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <MetricCard label="Total Referral Clicks" value={rows.length} icon={Share2} />
              <MetricCard label="Unique Users Referred" value={uniqueUsers} icon={Users} />
              <MetricCard label="Conversion Rate" value={conversionRate} icon={BarChart3} />
              <MetricCard label="Pending Referrals" value={pending} icon={Clock3} />
              <MetricCard label="Qualified Referrals" value={qualified} icon={Check} />
              <MetricCard label="Confirmed Referrals" value={confirmed} note={confirmedPayout ? `Confirmed payout: ${confirmedPayout}` : undefined} icon={ExternalLink} />
            </div>

            <div className={`${tw.card.glass} mt-5 p-5`}>
              <h3 className={`text-base font-bold ${tw.typography.color.primary}`}>Referral Funnel</h3>
              <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-7 gap-2">
                {funnel.map((stage, index) => (
                  <div key={stage.label} className="relative rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)] p-3">
                    <p className={`text-[11px] leading-4 ${tw.typography.color.muted}`}>{stage.label}</p>
                    <p className={`mt-2 text-xl font-bold ${tw.typography.color.primary}`}>{stage.value > 0 ? stage.value : '—'}</p>
                    {index < funnel.length - 1 && <span className={`hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 z-10 ${tw.typography.color.accent}`}>→</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className={`${tw.card.glass} mt-5 overflow-hidden`}>
              <div className="p-5 border-b border-[var(--space-border-default)]">
                <h3 className={`text-base font-bold ${tw.typography.color.primary}`}>Referral Events</h3>
              </div>
              {referralQuery.loading && rows.length === 0 ? (
                <div className={`p-8 flex items-center justify-center gap-2 text-sm ${tw.typography.color.muted}`}><RefreshCw className="w-4 h-4 animate-spin" /> Loading referrals…</div>
              ) : referralQuery.error ? (
                <div className="p-5 text-sm text-[var(--space-semantic-danger)]">Referral events could not be loaded: {referralQuery.error.message}</div>
              ) : rows.length === 0 ? (
                <div className={`p-8 text-center text-sm ${tw.typography.color.muted}`}>No referrals recorded yet. The first click on 'Build with Audos' will appear here.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[900px] w-full text-left text-xs">
                    <thead className="bg-[var(--space-surface-muted)]">
                      <tr className={tw.typography.color.muted}>
                        <th className="px-4 py-3 font-medium">Idea Name</th>
                        <th className="px-4 py-3 font-medium">Source</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Referral Owner</th>
                        <th className="px-4 py-3 font-medium">Click Time</th>
                        <th className="px-4 py-3 font-medium">Campaign Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--space-border-default)]">
                      {rows.map((row) => (
                        <tr key={row.id} className="hover:bg-[var(--space-surface-card-hover)]">
                          <td className={`px-4 py-3 font-medium ${tw.typography.color.primary}`}>{row.idea_name || '—'}</td>
                          <td className={`px-4 py-3 ${tw.typography.color.secondary}`}>{row.source || '—'}</td>
                          <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${statusClass(row.status)}`}>{humanizeStatus(row.status)}</span></td>
                          <td className={`px-4 py-3 ${tw.typography.color.secondary}`}>{row.referral_owner || '—'}</td>
                          <td className={`px-4 py-3 whitespace-nowrap ${tw.typography.color.secondary}`}>{formatDate(row.click_timestamp)}</td>
                          <td className={`px-4 py-3 ${tw.typography.color.secondary}`}>{row.campaign_source || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className={`${tw.card.glass} mt-5 p-5`}>
              <h3 className={`text-base font-bold ${tw.typography.color.primary}`}>Status Update</h3>
              <p className={`mt-1 text-sm ${tw.typography.color.secondary}`}>Manually update referral progress until automatic Audos status updates are available.</p>
              <div className="mt-4 grid sm:grid-cols-[1fr_220px_auto] gap-3 items-end">
                <Field label="Referral">
                  <select value={selectedReferralId} onChange={(e) => setSelectedReferralId(e.target.value)} className={`${tw.input.base} ${tw.input.default} text-sm`}>
                    <option value="">Select a referral</option>
                    {rows.map((row) => <option key={row.id} value={row.id}>{row.idea_name || 'Unnamed idea'} · {formatDate(row.click_timestamp)}</option>)}
                  </select>
                </Field>
                <Field label="New status">
                  <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value as ReferralStatus)} className={`${tw.input.base} ${tw.input.default} text-sm`}>
                    {STATUSES.map((status) => <option key={status} value={status}>{humanizeStatus(status)}</option>)}
                  </select>
                </Field>
                <button type="button" onClick={updateReferralStatus} disabled={!selectedReferralId || savingStatus} className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm ${tw.button.primary} ${(!selectedReferralId || savingStatus) ? tw.button.disabled : ''}`}>
                  {savingStatus ? <RefreshCw className="w-4 h-4 animate-spin" /> : statusSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {statusSaved ? 'Status Saved' : 'Save Status'}
                </button>
              </div>
              {statusError && <p className="mt-3 text-sm text-[var(--space-semantic-danger)]">{statusError}</p>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={`block text-sm font-medium ${tw.typography.color.primary}`}>{label}</span>
      {note && <span className={`block mt-1 text-xs ${tw.typography.color.muted}`}>{note}</span>}
      <span className="block mt-2">{children}</span>
    </label>
  );
}
