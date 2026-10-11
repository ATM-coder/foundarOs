import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Webhook } from 'lucide-react';

interface WebhookLog {
  id: number;
  received_at: string;
  tx_ref: string | null;
  status: 'successful' | 'ignored' | 'error' | string;
  routed_to: string | null;
  customer_email: string | null;
  amount: number | string | null;
  currency: string | null;
  raw_payload: unknown;
  routing_error: string | null;
}

declare global {
  interface Window {
    useWorkspaceDB: <T = any>(
      table: string,
      options?: {
        shared?: boolean;
        limit?: number;
        offset?: number;
        orderBy?: { column: string; direction: 'asc' | 'desc' };
        filters?: Array<{ column: string; operator: string; value: any }>;
      },
    ) => {
      data: T[];
      loading: boolean;
      error: Error | null;
      total: number;
      refresh: () => void;
    };
    __workspaceDb: any;
  }
}

const badgeStyles: Record<string, string> = {
  successful:
    'text-[var(--space-semantic-success)] bg-[color-mix(in_srgb,var(--space-semantic-success)_14%,transparent)] border-[color-mix(in_srgb,var(--space-semantic-success)_35%,transparent)]',
  ignored:
    'text-[var(--space-text-secondary)] bg-[color-mix(in_srgb,var(--space-text-secondary)_12%,transparent)] border-[color-mix(in_srgb,var(--space-text-secondary)_28%,transparent)]',
  error:
    'text-[var(--space-semantic-danger)] bg-[color-mix(in_srgb,var(--space-semantic-danger)_14%,transparent)] border-[color-mix(in_srgb,var(--space-semantic-danger)_35%,transparent)]',
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || '—' : date.toLocaleString();
}

function formatAmount(amount: WebhookLog['amount'], currency: string | null) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const numeric = Number(amount);
  const formatted = Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : String(amount);
  return currency ? `${formatted} ${currency.toUpperCase()}` : formatted;
}

function payloadJson(payload: unknown) {
  try {
    if (typeof payload === 'string') {
      try {
        return JSON.stringify(JSON.parse(payload), null, 2);
      } catch {
        return payload;
      }
    }
    return JSON.stringify(payload, null, 2) || 'null';
  } catch {
    return '[Unable to serialize payload]';
  }
}

export default function WebhookAdmin() {
  const { data, loading, error, total, refresh } = window.useWorkspaceDB<WebhookLog>(
    'webhook_logs',
    {
      shared: true,
      orderBy: { column: 'received_at', direction: 'desc' },
      limit: 50,
    },
  );
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh();
      setLastRefreshedAt(new Date());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const rows = useMemo(() => data || [], [data]);

  const handleRefresh = () => {
    refresh();
    setLastRefreshedAt(new Date());
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent text-[var(--space-text-primary)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--space-border-default)] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--space-surface-accent-soft)]">
            <Webhook className="h-5 w-5 text-[var(--space-text-accent)]" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Flutterwave events</h2>
            <p className="text-xs text-[var(--space-text-muted)]">
              Latest {Math.min(rows.length, 50)} of {total} logged events · refreshes every 30 seconds
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-2 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-card)] px-3 py-2 text-xs font-medium text-[var(--space-text-secondary)] transition-colors hover:bg-[var(--space-surface-card-hover)] hover:text-[var(--space-text-primary)]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading && rows.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center gap-3 text-sm text-[var(--space-text-muted)]">
            <RefreshCw className="h-5 w-5 animate-spin" /> Loading webhook events…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger)_10%,transparent)] p-4 text-sm text-[var(--space-semantic-danger)]">
            <p className="font-medium">Webhook events could not be loaded.</p>
            <p className="mt-1 text-xs">{error.message}</p>
            <button type="button" onClick={handleRefresh} className="mt-3 underline">
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
            <Webhook className="mb-3 h-8 w-8 text-[var(--space-text-muted)]" />
            <p className="text-sm font-medium">No webhooks received yet</p>
            <p className="mt-1 text-xs text-[var(--space-text-muted)]">
              New Flutterwave events will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)]">
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-left text-xs">
                <thead className="bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]">
                  <tr>
                    <th className="w-10 px-3 py-3" aria-label="Expand" />
                    <th className="px-3 py-3 font-medium">Timestamp</th>
                    <th className="px-3 py-3 font-medium">tx_ref</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Routed To</th>
                    <th className="px-3 py-3 font-medium">Customer Email</th>
                    <th className="px-3 py-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--space-border-default)]">
                  {rows.map((row) => {
                    const expanded = expandedId === row.id;
                    const badgeClass = badgeStyles[row.status] || badgeStyles.ignored;
                    return (
                      <Fragment key={row.id}>
                        <tr
                          onClick={() => setExpandedId(expanded ? null : row.id)}
                          className="cursor-pointer transition-colors hover:bg-[var(--space-surface-card-hover)]"
                        >
                          <td className="px-3 py-3 text-[var(--space-text-muted)]">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-[var(--space-text-secondary)]">
                            {formatTimestamp(row.received_at)}
                          </td>
                          <td className="max-w-64 truncate px-3 py-3 font-mono text-[var(--space-text-primary)]" title={row.tx_ref || ''}>
                            {row.tx_ref || '—'}
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex rounded-full border px-2 py-1 font-medium capitalize ${badgeClass}`}>
                              {row.status || 'ignored'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-[var(--space-text-secondary)]">{row.routed_to || '—'}</td>
                          <td className="px-3 py-3 text-[var(--space-text-secondary)]">{row.customer_email || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-[var(--space-text-secondary)]">
                            {formatAmount(row.amount, row.currency)}
                          </td>
                        </tr>
                        {expanded && (
                          <tr key={`payload-${row.id}`}>
                            <td colSpan={7} className="bg-[var(--space-surface-muted)] px-4 py-4">
                              {row.routing_error && (
                                <div className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--space-semantic-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--space-semantic-danger)]">
                                  {row.routing_error}
                                </div>
                              )}
                              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">
                                Raw payload
                              </div>
                              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 font-mono text-[11px] leading-5 text-[var(--space-text-secondary)]">
                                {payloadJson(row.raw_payload)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--space-border-default)] px-5 py-2 text-[11px] text-[var(--space-text-muted)]">
        Last refreshed {lastRefreshedAt.toLocaleTimeString()}
      </div>
    </div>
  );
}
