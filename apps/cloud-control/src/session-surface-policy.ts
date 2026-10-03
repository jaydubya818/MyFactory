import type { SessionSurfaceKind } from '@factory/contracts/session-surface';

/** No SessionSurfaceProvider is constructed or called by productive cloud Work. */
export const cloudSessionSurface = 'HEADLESS' satisfies SessionSurfaceKind;
