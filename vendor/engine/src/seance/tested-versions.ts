// Written by scripts/run-seance-versions.mjs from test/fixtures/seance-versions/*.json. Do not edit.

export interface TestedVersions {
  /** The old package. */
  package: string;
  ecosystem: 'npm' | 'pypi';
  /** The date of the runs. */
  checkedOn: string;
  /** Versions run for real where the real replacement passed and every mutant failed. */
  pass: string[];
  /** Versions run where it did not, with the reason. */
  fail: Array<{ version: string; why: string }>;
  /** Published versions that were not run. */
  untested: string[];
  /** The successor package and the versions run, when the successor is a package. */
  successor?: { package: string; pass: string[] };
}

export const TESTED_VERSIONS: Record<string, TestedVersions> = {
  'is-odd': {
    package: 'is-odd',
    ecosystem: 'npm',
    checkedOn: '2026-11-04',
    pass: ['3.0.0', '3.0.1'],
    fail: [
      {
        version: '0.1.2',
        why: 'it throws a RangeError for a non-integer where the séance expects an Error.',
      },
      {
        version: '1.0.0',
        why: 'it throws a RangeError for a non-integer where the séance expects an Error.',
      },
      {
        version: '2.0.0',
        why: 'it throws a RangeError for a non-integer where the séance expects an Error.',
      },
    ],
    untested: ['0.1.0', '0.1.1'],
  },
  'left-pad': {
    package: 'left-pad',
    ecosystem: 'npm',
    checkedOn: '2026-11-04',
    pass: ['1.1.0', '1.1.1', '1.1.2', '1.1.3', '1.2.0', '1.3.0'],
    fail: [
      {
        version: '1.0.0',
        why: 'the run did not finish and was killed (this version of the old package loops or allocates without end)',
      },
      {
        version: '1.0.1',
        why: 'the run did not finish and was killed (this version of the old package loops or allocates without end)',
      },
      {
        version: '1.0.2',
        why: 'the run did not finish and was killed (this version of the old package loops or allocates without end)',
      },
    ],
    untested: ['0.0.0', '0.0.1', '0.0.2', '0.0.3', '0.0.4', '0.0.9'],
  },
  mkdirp: {
    package: 'mkdirp',
    ecosystem: 'npm',
    checkedOn: '2026-11-04',
    pass: [
      '0.5.0',
      '0.5.1',
      '0.5.2',
      '0.5.3',
      '0.5.4',
      '0.5.5',
      '0.5.6',
      '1.0.0',
      '1.0.1',
      '1.0.2',
      '1.0.3',
      '1.0.4',
      '2.0.0',
      '2.1.0',
      '2.1.1',
      '2.1.2',
      '2.1.3',
      '2.1.4',
      '2.1.5',
      '2.1.6',
      '3.0.0',
      '3.0.1',
    ],
    fail: [],
    untested: [
      '0.0.1',
      '0.0.2',
      '0.0.3',
      '0.0.4',
      '0.0.5',
      '0.0.6',
      '0.0.7',
      '0.1.0',
      '0.2.0',
      '0.2.1',
      '0.2.2',
      '0.3.0',
      '0.3.1',
      '0.3.2',
      '0.3.3',
      '0.3.4',
      '0.3.5',
      '0.4.0',
      '0.4.1',
      '0.4.2',
    ],
  },
  pep8: {
    package: 'pep8',
    ecosystem: 'pypi',
    checkedOn: '2026-11-04',
    pass: ['1.6.2', '1.7.0', '1.7.1'],
    fail: [
      {
        version: '1.5.7',
        why: 'its report differs from the successor on the séance cases.',
      },
      {
        version: '1.6.0',
        why: 'its report differs from the successor on the séance cases.',
      },
      {
        version: '1.6.1',
        why: 'its report differs from the successor on the séance cases.',
      },
    ],
    untested: [
      '0.3.1',
      '0.4',
      '0.4.1',
      '0.4.2',
      '0.5.0',
      '0.6.0',
      '0.6.1',
      '0.7.0',
      '1.0',
      '1.0.1',
      '1.1',
      '1.2',
      '1.3',
      '1.3.1',
      '1.3.2',
      '1.3.3',
      '1.3.4',
      '1.4',
      '1.4.1',
      '1.4.2',
      '1.4.3',
      '1.4.4',
      '1.4.5',
      '1.4.6',
      '1.5.0',
      '1.5.1',
      '1.5.2',
      '1.5.3',
      '1.5.4',
      '1.5.5',
      '1.5.6',
    ],
    successor: {
      package: 'pycodestyle',
      pass: ['2.14.0', '2.15.0'],
    },
  },
  querystring: {
    package: 'querystring',
    ecosystem: 'npm',
    checkedOn: '2026-11-04',
    pass: ['0.2.1'],
    fail: [
      {
        version: '0.1.0',
        why: 'its parse and stringify answer differently from the successor on the séance cases.',
      },
      {
        version: '0.2.0',
        why: 'its parse and stringify answer differently from the successor on the séance cases.',
      },
    ],
    untested: ['0.0.1', '0.0.4'],
  },
  toml: {
    package: 'toml',
    ecosystem: 'pypi',
    checkedOn: '2026-11-04',
    pass: ['0.10.1', '0.10.2'],
    fail: [
      {
        version: '0.9.4',
        why: 'it parses some documents differently from the successor on the séance cases.',
      },
      {
        version: '0.9.6',
        why: 'it parses some documents differently from the successor on the séance cases.',
      },
      {
        version: '0.10.0',
        why: 'it parses some documents differently from the successor on the séance cases.',
      },
    ],
    untested: [
      '0.6.0',
      '0.6.5',
      '0.7.0',
      '0.7.1',
      '0.8.0',
      '0.8.1',
      '0.8.2',
      '0.9.0',
      '0.9.1',
      '0.9.2',
      '0.9.3',
    ],
    successor: {
      package: 'tomli',
      pass: ['2.5.0'],
    },
  },
};
