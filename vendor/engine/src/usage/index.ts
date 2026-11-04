import type {
  DependencyUsage,
  MemberUsage,
  SourceFile,
  UsageImport,
  UsageTarget,
} from '../types.js';
import { errorMessage } from '../util/guards.js';
import { type RawUse, scanJs } from './scan-js.js';
import { pythonImportNames, scanPython } from './scan-py.js';

export { PY_IMPORT_NAMES, pythonImportNames } from './scan-py.js';

const JS_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const PY_EXT = /\.py$/i;
/** Files larger than this are skipped, so one generated bundle cannot stall the scan. */
export const MAX_SOURCE_CHARS = 2_000_000;
const MAX_SITES = 50;

function emptyUsage(target: UsageTarget, problem?: string): DependencyUsage {
  return {
    ecosystem: target?.ecosystem === 'pypi' ? 'pypi' : 'npm',
    name: typeof target?.name === 'string' ? target.name : '',
    filesScanned: 0,
    filesUsing: [],
    imports: [],
    members: [],
    neverCalled: false,
    unresolvedDynamicImports: 0,
    problems: problem ? [problem] : [],
  };
}

/**
 * How the given source files use one dependency. Never throws.
 * JavaScript and TypeScript files are matched by package name, Python files by import name.
 */
export function scanUsage(files: SourceFile[], target: UsageTarget): DependencyUsage {
  try {
    if (!target || typeof target.name !== 'string' || target.name === '') {
      return emptyUsage(target, 'No dependency name was given.');
    }
    const usage = emptyUsage(target);
    const imports: UsageImport[] = [];
    const uses: RawUse[] = [];
    const using = new Set<string>();
    const py =
      target.ecosystem === 'pypi' ? pythonImportNames(target.name, target.importNames) : undefined;
    for (const file of Array.isArray(files) ? files : []) {
      try {
        if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
        const isJs = JS_EXT.test(file.path);
        const isPy = PY_EXT.test(file.path);
        if ((target.ecosystem === 'npm' && !isJs) || (target.ecosystem === 'pypi' && !isPy))
          continue;
        if (file.content.length > MAX_SOURCE_CHARS) {
          usage.problems.push(
            `${file.path} is larger than ${MAX_SOURCE_CHARS / 1_000_000} MB and was not read.`,
          );
          continue;
        }
        usage.filesScanned++;
        if (py) {
          const r = scanPython(file.path, file.content, py);
          imports.push(...r.imports);
          uses.push(...r.uses);
          if (r.imports.length > 0) using.add(file.path);
        } else {
          const r = scanJs(file.path, file.content, target.name);
          imports.push(...r.imports);
          uses.push(...r.uses);
          usage.unresolvedDynamicImports += r.unresolvedDynamic;
          if (r.imports.some((i) => !i.typeOnly)) using.add(file.path);
        }
      } catch (error) {
        usage.problems.push(
          `${typeof file?.path === 'string' ? file.path : '(unnamed)'} could not be read (${errorMessage(error)}).`,
        );
      }
    }
    usage.imports = imports;
    usage.filesUsing = [...using];
    const byMember = new Map<string, MemberUsage>();
    for (const { member, site } of uses) {
      let m = byMember.get(member);
      if (!m) {
        m = {
          member,
          calls: 0,
          accesses: 0,
          references: 0,
          argCounts: [],
          keywords: [],
          sites: [],
        };
        byMember.set(member, m);
      }
      if (site.kind === 'call') {
        m.calls++;
        if (site.args !== undefined && !m.argCounts.includes(site.args))
          m.argCounts.push(site.args);
        for (const k of site.keywords ?? []) if (!m.keywords.includes(k)) m.keywords.push(k);
      } else if (site.kind === 'access') m.accesses++;
      else if (site.kind === 'reference') m.references++;
      if (m.sites.length < MAX_SITES) m.sites.push(site);
    }
    const members = [...byMember.values()].sort((a, b) =>
      a.member < b.member ? -1 : a.member > b.member ? 1 : 0,
    );
    for (const m of members) {
      m.argCounts.sort((a, b) => a - b);
      m.keywords.sort();
    }
    usage.members = members;
    const runtime = imports.some((i) => !i.typeOnly && i.form !== 'side-effect');
    usage.neverCalled = runtime && members.every((m) => m.calls === 0);
    return usage;
  } catch (error) {
    return emptyUsage(target, `The scan stopped (${errorMessage(error)}).`);
  }
}
