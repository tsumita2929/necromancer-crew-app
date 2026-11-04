import type { ManifestFile, ParseResult } from '../types.js';
import { errorMessage } from '../util/guards.js';
import { parsePackageJson } from './package-json.js';
import { parsePackageLock } from './package-lock.js';
import { parsePyproject } from './pyproject.js';
import { parseRequirementsTxt } from './requirements-txt.js';

/** Upper bound on content the parsers accept, so one huge paste cannot freeze a tab. */
export const MAX_MANIFEST_CHARS = 20_000_000;

/** Parse one manifest. Never throws: any failure becomes a problem. */
export function parseManifest(file: ManifestFile): ParseResult {
  try {
    const rawContent = typeof file.content === 'string' ? file.content : '';
    const content = rawContent.charCodeAt(0) === 0xfeff ? rawContent.slice(1) : rawContent;
    const path = typeof file.path === 'string' ? file.path : '(unnamed)';
    if (content.length > MAX_MANIFEST_CHARS) {
      return {
        dependencies: [],
        problems: [`${path} is larger than ${MAX_MANIFEST_CHARS / 1_000_000} MB and was not read.`],
      };
    }
    const safe: ManifestFile = { kind: file.kind, path, content };
    let result: ParseResult;
    switch (file.kind) {
      case 'package.json':
        result = parsePackageJson(safe);
        break;
      case 'package-lock.json':
        result = parsePackageLock(safe);
        break;
      case 'requirements.txt':
        result = parseRequirementsTxt(safe);
        break;
      case 'pyproject.toml':
        result = parsePyproject(safe);
        break;
      default:
        result = { dependencies: [], problems: [`${path}: unknown manifest kind.`] };
    }
    return result;
  } catch (error) {
    const path = typeof file?.path === 'string' ? file.path : '(unnamed)';
    return { dependencies: [], problems: [`${path} could not be read (${errorMessage(error)}).`] };
  }
}
