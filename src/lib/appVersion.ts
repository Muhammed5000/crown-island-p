import pkg from '../../package.json';

/** App version, sourced from package.json (single source of truth). */
export const APP_VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';
