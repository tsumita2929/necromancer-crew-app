/** Package-name rules for both ecosystems. */

const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;
const NPM_RESERVED = new Set(['node_modules', 'favicon.ico']);
const PYPI_NAME = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;

/** True for names the npm registry could hold (legacy upper-case names included). */
export function isValidNpmName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && NPM_NAME.test(name) && !NPM_RESERVED.has(name);
}

/** True for names PyPI accepts (PEP 508 name grammar). */
export function isValidPypiName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && PYPI_NAME.test(name);
}

/** PEP 503: lower-case, and every run of "-", "_" and "." becomes one "-". */
export function normalizePypiName(name: string): string {
  return name.replace(/[-_.]+/g, '-').toLowerCase();
}

/** The name as one URL path segment: "@scope/pkg" becomes "%40scope%2Fpkg". */
export function encodePackageName(name: string): string {
  return encodeURIComponent(name);
}
