export const UPDATE_STATE_STORAGE_KEY = 'flippah:update-state:v1';
export const UPDATE_CHECK_STALE_MS = 2 * 60 * 1000;

export type UpdateCheckPhase = 'idle' | 'checking' | 'current' | 'available' | 'ready' | 'throttled' | 'unsupported' | 'error';

export interface ExtensionUpdateState {
  schemaVersion: 1;
  phase: UpdateCheckPhase;
  currentVersion: string;
  candidateVersion: string | null;
  checkedAt: number | null;
  message: string;
}

export interface RuntimeUpdateCheckResultLike {
  status: 'throttled' | 'no_update' | 'update_available' | string;
  version?: string;
}

function versionParts(value: string): number[] | null {
  const parts = value.trim().split('.');
  if (!parts.length || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.map(Number);
}

export function compareChromeVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return left.localeCompare(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function idleUpdateState(currentVersion: string): ExtensionUpdateState {
  return {
    schemaVersion: 1,
    phase: 'idle',
    currentVersion,
    candidateVersion: null,
    checkedAt: null,
    message: '',
  };
}

export function checkingUpdateState(currentVersion: string, checkedAt = Date.now()): ExtensionUpdateState {
  return {
    schemaVersion: 1,
    phase: 'checking',
    currentVersion,
    candidateVersion: null,
    checkedAt,
    message: 'Checking the Chrome Web Store...',
  };
}

export function runtimeResultUpdateState(
  result: RuntimeUpdateCheckResultLike,
  currentVersion: string,
  checkedAt = Date.now(),
): ExtensionUpdateState {
  if (result.status === 'no_update') {
    return {
      schemaVersion: 1,
      phase: 'current',
      currentVersion,
      candidateVersion: null,
      checkedAt,
      message: `Flippah v${currentVersion} is up to date.`,
    };
  }
  if (result.status === 'throttled') {
    return {
      schemaVersion: 1,
      phase: 'throttled',
      currentVersion,
      candidateVersion: null,
      checkedAt,
      message: 'Chrome checked recently. Try again in a few minutes.',
    };
  }
  if (result.status === 'update_available') {
    const candidateVersion = String(result.version || '').trim() || null;
    return {
      schemaVersion: 1,
      phase: 'available',
      currentVersion,
      candidateVersion,
      checkedAt,
      message: candidateVersion
        ? `Flippah v${candidateVersion} is downloading. Close this popup when it finishes.`
        : 'A Flippah update is downloading. Close this popup when it finishes.',
    };
  }
  return {
    schemaVersion: 1,
    phase: 'error',
    currentVersion,
    candidateVersion: null,
    checkedAt,
    message: 'Chrome returned an unknown update status.',
  };
}

export function readyUpdateState(candidateVersion: string, currentVersion: string, checkedAt = Date.now()): ExtensionUpdateState {
  const version = String(candidateVersion || '').trim();
  return {
    schemaVersion: 1,
    phase: 'ready',
    currentVersion,
    candidateVersion: version || null,
    checkedAt,
    message: version
      ? `Flippah v${version} is ready. Close this popup, then refresh the auction page.`
      : 'A Flippah update is ready. Close this popup, then refresh the auction page.',
  };
}

export function unsupportedUpdateState(currentVersion: string): ExtensionUpdateState {
  return {
    schemaVersion: 1,
    phase: 'unsupported',
    currentVersion,
    candidateVersion: null,
    checkedAt: Date.now(),
    message: 'Update checks are available in the Chrome Web Store edition.',
  };
}

export function failedUpdateState(currentVersion: string): ExtensionUpdateState {
  return {
    schemaVersion: 1,
    phase: 'error',
    currentVersion,
    candidateVersion: null,
    checkedAt: Date.now(),
    message: 'Chrome could not check for updates. Try again later.',
  };
}

export function normalizeStoredUpdateState(value: unknown, currentVersion: string, now = Date.now()): ExtensionUpdateState {
  if (!value || typeof value !== 'object') return idleUpdateState(currentVersion);
  const source = value as Partial<ExtensionUpdateState>;
  const phases: UpdateCheckPhase[] = ['idle', 'checking', 'current', 'available', 'ready', 'throttled', 'unsupported', 'error'];
  if (source.schemaVersion !== 1 || !phases.includes(source.phase as UpdateCheckPhase)) return idleUpdateState(currentVersion);
  const candidateVersion = typeof source.candidateVersion === 'string' && source.candidateVersion.trim()
    ? source.candidateVersion.trim()
    : null;
  const checkedAt = Number.isFinite(source.checkedAt) ? Number(source.checkedAt) : null;
  if (source.phase === 'checking' && (checkedAt === null || now - checkedAt > UPDATE_CHECK_STALE_MS)) {
    return idleUpdateState(currentVersion);
  }
  if (candidateVersion && compareChromeVersions(candidateVersion, currentVersion) <= 0) {
    return idleUpdateState(currentVersion);
  }
  return {
    schemaVersion: 1,
    phase: source.phase as UpdateCheckPhase,
    currentVersion,
    candidateVersion,
    checkedAt,
    message: typeof source.message === 'string' ? source.message.slice(0, 240) : '',
  };
}
