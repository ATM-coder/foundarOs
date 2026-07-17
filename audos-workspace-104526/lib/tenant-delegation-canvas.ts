/** True when a provider app is embedded via Product Run / tenant agent handoff. */
export function isTenantDelegationCanvas(): boolean {
  if (typeof window === "undefined") return false;
  const layout = new URLSearchParams(window.location.search).get("layout");
  if (layout === "full") return false;
  return (
    !!(window as Window & { __TENANT_DELEGATION__?: unknown }).__TENANT_DELEGATION__ ||
    !!(window as Window & { __TENANT_DELEGATION_CANVAS__?: unknown })
      .__TENANT_DELEGATION_CANVAS__ ||
    layout === "canvas-only"
  );
}

type TenantDelegationData = {
  sessionId?: string;
  taSessionId?: string;
  token?: string;
  delegationToken?: string;
  workspaceSessionId?: string;
  email?: string;
};

export function getTenantDelegationScope(): TenantDelegationData | null {
  if (typeof window === "undefined") return null;
  const injected = (window as Window & {
    __TENANT_DELEGATION__?: TenantDelegationData;
  }).__TENANT_DELEGATION__ || {};
  const params = new URLSearchParams(window.location.search);
  const taSessionId = injected.sessionId || injected.taSessionId || params.get("ta_session") || undefined;
  const delegationToken = injected.token || injected.delegationToken || params.get("delegation_token") || undefined;
  if (!taSessionId && !delegationToken && !injected.workspaceSessionId && !injected.email) return null;
  return { ...injected, taSessionId, delegationToken };
}

export function getDelegationChatRequestExtras(): {
  delegationToken: string;
  taSessionId: string;
} | null {
  const scope = getTenantDelegationScope();
  if (!scope?.delegationToken || !scope.taSessionId) return null;
  return { delegationToken: scope.delegationToken, taSessionId: scope.taSessionId };
}

export function hasTenantDelegationAuth(): boolean {
  return getDelegationChatRequestExtras() !== null;
}

export function scopedSpaceSessionStorageKey(spaceId: string): string {
  const scope = getTenantDelegationScope();
  return scope?.taSessionId && scope.delegationToken
    ? `space_session_${spaceId}_delegation_${encodeURIComponent(scope.taSessionId)}`
    : `space_session_${spaceId}`;
}
