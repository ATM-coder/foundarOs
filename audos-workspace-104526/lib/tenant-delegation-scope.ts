export interface TenantDelegationScope {
  taSessionId: string | null;
  delegationToken: string | null;
  workspaceSessionId?: string;
  email?: string;
}

type InjectedTenantDelegation = {
  sessionId?: unknown;
  taSessionId?: unknown;
  token?: unknown;
  delegationToken?: unknown;
  workspaceSessionId?: unknown;
  email?: unknown;
};

const asNonEmptyString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/**
 * Reads tenant delegation credentials injected by the host, with query-string
 * values as a fallback for direct Product Run handoffs.
 */
export const getTenantDelegationScope = (): TenantDelegationScope | null => {
  if (typeof window === 'undefined') return null;

  const injected = (window as Window & {
    __TENANT_DELEGATION__?: InjectedTenantDelegation;
  }).__TENANT_DELEGATION__;
  const params = new URLSearchParams(window.location.search);
  const taSessionId =
    asNonEmptyString(injected?.sessionId) ||
    asNonEmptyString(injected?.taSessionId) ||
    asNonEmptyString(params.get('ta_session'));
  const delegationToken =
    asNonEmptyString(injected?.token) ||
    asNonEmptyString(injected?.delegationToken) ||
    asNonEmptyString(params.get('delegation_token'));
  const workspaceSessionId = asNonEmptyString(injected?.workspaceSessionId);
  const email = asNonEmptyString(injected?.email);

  if (!taSessionId && !delegationToken && !workspaceSessionId && !email) return null;

  return {
    taSessionId,
    delegationToken,
    ...(workspaceSessionId ? { workspaceSessionId } : {}),
    ...(email ? { email } : {}),
  };
};

export const getDelegationChatRequestExtras = (): {
  delegationToken: string;
  taSessionId: string;
} | null => {
  const scope = getTenantDelegationScope();
  if (!scope?.delegationToken || !scope.taSessionId) return null;
  return {
    delegationToken: scope.delegationToken,
    taSessionId: scope.taSessionId,
  };
};

export const hasTenantDelegationAuth = (): boolean => {
  return getDelegationChatRequestExtras() !== null;
};

/** Keep delegated consumer sessions isolated from ordinary workspace sessions. */
export const scopedSpaceSessionStorageKey = (spaceId: string): string => {
  const scope = getTenantDelegationScope();
  if (!scope?.taSessionId || !scope.delegationToken) {
    return `space_session_${spaceId}`;
  }
  return `space_session_${spaceId}_delegation_${encodeURIComponent(scope.taSessionId)}`;
};
