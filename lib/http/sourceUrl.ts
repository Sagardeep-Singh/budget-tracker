const UPSTREAM_SOURCE_URL = 'https://github.com/Sagardeep-Singh/budget-tracker';

/**
 * Where users can get this deployment's source code, for the AGPLv3 section 13
 * "Source code" link. A modified deployment must point this at its own
 * modified source, so it is configurable via `SOURCE_CODE_URL`; unset, it
 * falls back to the upstream repository.
 */
export const sourceCodeUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  env.SOURCE_CODE_URL?.trim() || UPSTREAM_SOURCE_URL;
