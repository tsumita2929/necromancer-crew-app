/**
 * A small hand-picked list of well-known dead packages and where to go instead.
 * Each entry says why. Names for PyPI are PEP 503 normalised.
 */

import { RESEARCHED } from './researched.js';
import type { Ecosystem, Successor } from './types.js';

type Entry = Omit<Successor, 'ecosystem' | 'source'>;

interface Curated {
  ecosystem: Ecosystem;
  name: string;
  successors: Entry[];
}

const pkg = (name: string, reason: string, url?: string): Entry => ({
  name,
  kind: 'package',
  reason,
  ...(url ? { url } : {}),
});
const native = (name: string, reason: string, url?: string): Entry => ({
  name,
  kind: 'native',
  reason,
  ...(url ? { url } : {}),
});

export const CURATED: readonly Curated[] = [
  {
    ecosystem: 'npm',
    name: 'request',
    successors: [
      native(
        'fetch',
        'Node 18+ and every browser ship fetch, so most uses need no package.',
        'https://developer.mozilla.org/docs/Web/API/Fetch_API',
      ),
      pkg(
        'undici',
        'The HTTP client that powers fetch in Node, maintained by the Node.js project.',
        'https://github.com/nodejs/undici',
      ),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'request-promise',
    successors: [
      native('fetch', 'Built-in fetch returns promises, which is all request-promise added.'),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'request-promise-native',
    successors: [
      native(
        'fetch',
        'Built-in fetch returns promises, which is all request-promise-native added.',
      ),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'node-sass',
    successors: [
      pkg(
        'sass',
        'Dart Sass is the reference Sass implementation and the one the Sass team maintains.',
        'https://sass-lang.com/dart-sass',
      ),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'tslint',
    successors: [
      pkg(
        'eslint',
        'TSLint was retired in favour of ESLint with typescript-eslint.',
        'https://eslint.org/',
      ),
      pkg(
        'typescript-eslint',
        'Provides the TypeScript parser and rules that replace TSLint rules.',
        'https://typescript-eslint.io/',
      ),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'left-pad',
    successors: [
      native(
        'String.prototype.padStart',
        'padStart is built into every supported JavaScript runtime.',
        'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String/padStart',
      ),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'babel-eslint',
    successors: [
      pkg('@babel/eslint-parser', 'babel-eslint was renamed and moved under the @babel scope.'),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'node-uuid',
    successors: [
      pkg('uuid', 'node-uuid was merged into uuid, which is maintained.'),
      native('crypto.randomUUID', 'Version 4 UUIDs are built into Node 14.17+ and browsers.'),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'istanbul',
    successors: [
      pkg('c8', 'Native V8 coverage, no instrumentation step.', 'https://github.com/bcoe/c8'),
      pkg('nyc', 'The maintained command line for Istanbul coverage.'),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'phantomjs-prebuilt',
    successors: [
      pkg('playwright', 'A maintained headless browser driver.', 'https://playwright.dev/'),
      pkg('puppeteer', 'A maintained headless Chrome driver.', 'https://pptr.dev/'),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'phantomjs',
    successors: [
      pkg('playwright', 'A maintained headless browser driver.', 'https://playwright.dev/'),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'coffee-script',
    successors: [pkg('coffeescript', 'The compiler moved to the coffeescript package name.')],
  },
  { ecosystem: 'npm', name: 'jade', successors: [pkg('pug', 'Jade was renamed to Pug.')] },
  {
    ecosystem: 'npm',
    name: 'mkdirp',
    successors: [native('fs.mkdir', 'fs.mkdir with { recursive: true } does what mkdirp does.')],
  },
  {
    ecosystem: 'npm',
    name: 'rimraf',
    successors: [
      native('fs.rm', 'fs.rm with { recursive: true, force: true } does what rimraf does.'),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'querystring',
    successors: [
      native(
        'URLSearchParams',
        'URLSearchParams is the standard way to parse and build query strings.',
      ),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'gulp-util',
    successors: [
      pkg(
        'fancy-log',
        'gulp-util was split up; log with fancy-log and use the other small packages it names.',
      ),
    ],
  },
  {
    ecosystem: 'npm',
    name: 'bower',
    successors: [pkg('npm', 'Bower recommends moving to npm or yarn.')],
  },
  {
    ecosystem: 'npm',
    name: 'core-js-pure',
    successors: [pkg('core-js', 'Use core-js; version 3 is the maintained line.')],
  },
  {
    ecosystem: 'pypi',
    name: 'nose',
    successors: [
      pkg(
        'pytest',
        'nose is unmaintained and breaks on Python 3.10+; pytest runs nose-style tests.',
        'https://docs.pytest.org/',
      ),
    ],
  },
  {
    ecosystem: 'pypi',
    name: 'pycrypto',
    successors: [
      pkg(
        'pycryptodome',
        'A maintained drop-in fork of PyCrypto with the same module layout.',
        'https://www.pycryptodome.org/',
      ),
    ],
  },
  {
    ecosystem: 'pypi',
    name: 'pep8',
    successors: [pkg('pycodestyle', 'pep8 was renamed to pycodestyle.')],
  },
  {
    ecosystem: 'pypi',
    name: 'mock',
    successors: [
      native('unittest.mock', 'The mock library lives in the standard library since Python 3.3.'),
    ],
  },
  {
    ecosystem: 'pypi',
    name: 'distribute',
    successors: [pkg('setuptools', 'distribute was merged back into setuptools.')],
  },
  {
    ecosystem: 'pypi',
    name: 'pil',
    successors: [pkg('pillow', 'Pillow is the maintained fork of PIL.')],
  },
  {
    ecosystem: 'pypi',
    name: 'sklearn',
    successors: [
      pkg('scikit-learn', 'The sklearn package is a deprecated alias; install scikit-learn.'),
    ],
  },
  {
    ecosystem: 'pypi',
    name: 'enum34',
    successors: [native('enum', 'enum is in the standard library since Python 3.4.')],
  },
  {
    ecosystem: 'pypi',
    name: 'futures',
    successors: [
      native(
        'concurrent.futures',
        'concurrent.futures is in the standard library since Python 3.2.',
      ),
    ],
  },
  {
    ecosystem: 'pypi',
    name: 'unittest2',
    successors: [
      native('unittest', 'The standard library unittest has every feature unittest2 backported.'),
    ],
  },
  {
    ecosystem: 'pypi',
    name: 'toml',
    successors: [
      native('tomllib', 'tomllib reads TOML in the standard library since Python 3.11.'),
      pkg('tomli', 'The backport of tomllib for older Python versions.'),
    ],
  },
  {
    ecosystem: 'pypi',
    name: 'pytest-runner',
    successors: [pkg('pytest', 'Run pytest directly; pytest-runner is deprecated.')],
  },
  {
    ecosystem: 'pypi',
    name: 'dataclasses',
    successors: [native('dataclasses', 'dataclasses is in the standard library since Python 3.7.')],
  },
];

const INDEX = new Map<string, Entry[]>(
  CURATED.map((c) => [`${c.ecosystem}:${c.name}`, c.successors]),
);

/** The researched ways out (`docs/research/successors.json`), by dependency. */
const RESEARCHED_INDEX = new Map(RESEARCHED.map((r) => [`${r.ecosystem}:${r.name}`, r]));

/**
 * Curated successors for a dependency, best first: the hand-picked list, then the researched one
 * (each researched way out carries its source and its confidence).
 */
export function curatedSuccessors(ecosystem: Ecosystem, name: string): Successor[] {
  const picked = (INDEX.get(`${ecosystem}:${name}`) ?? []).map((e) => ({
    ...e,
    ecosystem,
    source: 'curated' as const,
  }));
  const researched = RESEARCHED_INDEX.get(`${ecosystem}:${name}`);
  const more: Successor[] = (researched?.successors ?? []).map((s) => ({
    ...s,
    ecosystem,
    confidence: researched?.confidence ?? 'medium',
  }));
  return [...picked, ...more];
}
