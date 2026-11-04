/**
 * Necromancer shared contract.
 *
 * Every package and app codes against these types. Owner: packages/engine.
 * A change needs the lead's agreement first (see .kiro/steering/structure.md).
 */

/** Package ecosystems Necromancer understands. */
export type Ecosystem = 'npm' | 'pypi';

/** Manifest formats the engine parses. */
export type ManifestKind =
  'package.json' | 'package-lock.json' | 'requirements.txt' | 'pyproject.toml';

/** A manifest file handed to the engine. */
export interface ManifestFile {
  kind: ManifestKind;
  /** Path inside the scanned project, e.g. "apps/api/package.json". */
  path: string;
  content: string;
}

/** One dependency as the scanned project declares it. */
export interface DependencyRef {
  ecosystem: Ecosystem;
  /** Package name: npm as published, PyPI normalised per PEP 503. */
  name: string;
  /** Range or pin exactly as written, e.g. "^2.88.0" or "==1.3.7". Empty when none. */
  spec: string;
  /** Exact version when a lockfile provides one. */
  resolved?: string;
  /** true when the project declares it, false when it is only transitive. */
  direct: boolean;
  scope: 'main' | 'dev' | 'optional' | 'peer';
  /** Manifest path that declared it. */
  declaredIn: string;
}

/** What parsing one manifest produced. */
export interface ParseResult {
  dependencies: DependencyRef[];
  /** Why parts of the file were skipped, in plain English. Empty when all of it was read. */
  problems: string[];
}

/**
 * Verdict scale, healthiest first. The order is part of the contract:
 * adding evidence of death never moves a dependency to an earlier entry.
 *
 * - alive:  no blocking signal found. A package the registry does not know, or that could not be
 *           checked, is also "alive" and carries an "unchecked" evidence line.
 * - dying:  stale signals (no release for a long time, a quiet repository). Always `basis`
 *           "heuristic". A deprecated or yanked version in use does not make a package dying: it is an
 *           upgrade notice on the verdict the package itself earns (see `Diagnosis.upgradeTo`).
 * - dead:   a hard end-of-life signal (deprecated, archived, yanked, inactive, or a README that says
 *           the project is no longer maintained) or, with `basis` "heuristic", the abandoned guess:
 *           a very old release and nothing that shows care.
 * - ghost:  dead, and its source repository is gone or unreachable.
 * - zombie: dead or ghost, and a known advisory affects the version in use. Its `basis` is the basis
 *           of the death, not of the advisory.
 */
export const VERDICTS = ['alive', 'dying', 'dead', 'ghost', 'zombie'] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * Public sources the engine reads. "readme" is a notice in the dead project's README or a migration
 * guide that names the way out; the `url` of the successor says which.
 */
export type SourceId =
  | 'npm'
  | 'pypi'
  | 'deps.dev'
  | 'osv'
  | 'scorecard'
  | 'github'
  | 'module-replacements'
  | 'curated'
  | 'readme';

/** One signal behind a verdict. Rendered as an epitaph line. */
export interface Evidence {
  /** Stable machine code, e.g. "npm-deprecated", "repo-archived", "no-release", "osv-advisory". */
  code: string;
  /** One plain English sentence for people. */
  message: string;
  source: SourceId;
  url?: string;
  /** ISO-8601 date the signal refers to, when there is one. */
  date?: string;
}

/** A way out for a dead dependency. */
export interface Successor {
  /** Package name, or the platform API for kind "native" (e.g. "String.prototype.padStart"). */
  name: string;
  ecosystem: Ecosystem;
  /**
   * - package: switch to another maintained package.
   * - native:  use a built-in platform API instead of any package.
   * - raise:   rebuild the dead package as a modern drop-in the project owns.
   */
  kind: 'package' | 'native' | 'raise';
  /** One sentence: why this successor. */
  reason: string;
  source: SourceId;
  url?: string;
  /**
   * How sure the mapping is, for researched successors. "low" is a plausible fit with a different API or
   * scope: show it as a suggestion, not as the answer. Absent for other sources.
   */
  confidence?: 'high' | 'medium' | 'low';
}

/** The engine's finding for one dependency. */
export interface Diagnosis {
  dependency: DependencyRef;
  verdict: Verdict;
  /** Most important first. Never empty unless the verdict is "alive". */
  evidence: Evidence[];
  /**
   * OSV ids affecting the version in use, one per distinct vulnerability: records that name each other
   * (a GHSA, a PYSEC and a CVE record of one flaw) are merged. The id shown for a vulnerability is its
   * GHSA id, else its CVE id, else the first of the others; the list is sorted.
   */
  advisories: string[];
  /** For each id in `advisories` that has other names: the other ids of the same vulnerability. */
  advisoryAliases?: Record<string, string[]>;
  /** Best first. Empty when none is known. */
  successors: Successor[];
  latest?: { version: string; date?: string };
  /**
   * What a verdict other than "alive" rests on.
   * - "hard": a fact from a source that ends the package's life: deprecated, archived, inactive,
   *   yanked (the latest release), gone, or the maintainers' own README statement that the project
   *   is no longer maintained. For a zombie it is "hard" only when such a fact is among the evidence
   *   of the death; the advisory, which makes it a zombie, is a hard fact but does not set the basis.
   * - "heuristic": a guess from staleness: an old release, a quiet repository, and the "abandoned"
   *   rule that joins them. Show it as such.
   * Absent for "alive". A package the registry does not know, an advisory on the version in use and
   * a deprecated or yanked version in use are all "alive" (the last with an upgrade notice).
   */
  basis?: 'hard' | 'heuristic';
  /**
   * Present when the version in use is deprecated (npm) or yanked (PyPI): the release to move to. A
   * deprecated or yanked version in use is an upgrade notice (evidence `version-deprecated` or
   * `version-yanked`), never a reason for a verdict other than "alive" by itself. Absent when the version
   * in use is fine, or when no newer release is both stable and not deprecated or yanked.
   */
  upgradeTo?: UpgradeTarget;
  /**
   * True when the registry has no package of this name (removed, private or misspelled; the engine
   * cannot tell which). The verdict is then "alive" with an "unchecked" line: nothing was examined,
   * so nothing is claimed.
   */
  notFound?: boolean;
}

/** The release to upgrade to (see `Diagnosis.upgradeTo`). */
export interface UpgradeTarget {
  /** The newest stable release that is not deprecated or yanked, in the same major version as the one in use when there is one. */
  version: string;
  /** True when it has the same major version as the one in use (the smaller step, preferred when there is one). */
  sameMajor: boolean;
  /** True (and only then present) when the target is older than the version in use, because no newer stable release is free of deprecation or yanking. */
  older?: true;
}

/** A whole scan. */
export interface AutopsyReport {
  /** What was scanned, e.g. "github:expressjs/express" or "upload:package.json". */
  subject: string;
  /** ISO-8601. */
  scannedAt: string;
  manifests: Array<{ kind: ManifestKind; path: string }>;
  diagnoses: Diagnosis[];
  /** Manifest parts that could not be read. */
  problems: Array<{ path: string; message: string }>;
  /** Sources that could not be reached. The report is partial for them. */
  unavailable: Array<{ source: SourceId; reason: string }>;
  /** Count per verdict; every verdict key is present. */
  summary: Record<Verdict, number>;
}

/** The three files of a Kiro spec. */
export interface KiroSpec {
  'requirements.md': string;
  'design.md': string;
  'tasks.md': string;
}

/** Minimal fetch shape, injected so the engine runs offline in tests. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface EngineOptions {
  fetch: FetchLike;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

// ---------------------------------------------------------------------------------------
// Usage scan and séance (round 2). Additive: new types and optional members only.
// ---------------------------------------------------------------------------------------

/** A source file handed to the usage scan. */
export interface SourceFile {
  /** Path inside the project, e.g. "src/pad.ts". The extension picks the language. */
  path: string;
  content: string;
}

/** How a dependency is imported. */
export type ImportForm =
  | 'default'
  | 'named'
  | 'namespace'
  | 'side-effect'
  | 'require'
  | 'import-equals'
  | 'dynamic'
  | 're-export'
  | 're-export-all'
  | 'python-import'
  | 'python-from'
  | 'python-star';

/** One import statement of the dependency. */
export interface UsageImport {
  file: string;
  /** 1-based. */
  line: number;
  /** The module specifier as written, e.g. "lodash/fp/get" or "toml". */
  specifier: string;
  form: ImportForm;
  /** The local name bound by the import, when there is one. */
  local?: string;
  /** The exported name imported (named, from-import). */
  member?: string;
  /** The part of the specifier after the package, e.g. "fp/get". */
  subpath?: string;
  /** `import type` and `import { type A }`: erased at run time. */
  typeOnly: boolean;
  /** Python: the import sits inside try/except, a function, or an if block. */
  guarded?: boolean;
}

/** A literal argument seen at a call site. */
export interface LiteralArg {
  kind: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'other';
  /** Source text of the literal (clipped), absent for "other". */
  text?: string;
}

/** One place a member is used. */
export interface UsageSite {
  file: string;
  line: number;
  column: number;
  kind: 'call' | 'access' | 'reference' | 're-export';
  /** Positional argument count of a call. */
  args?: number;
  /** A call with a spread argument (`f(...xs)`): `args` is then a minimum. */
  spread?: boolean;
  /** Python keyword argument names. */
  keywords?: string[];
  /** One entry per positional argument. */
  literals?: LiteralArg[];
}

/** Everything the project does with one member of the dependency. */
export interface MemberUsage {
  /**
   * The exported name ("padStart"), a dotted path ("decoder.TomlDecodeError"), "default" for the
   * module itself or its default export, or "*" for a namespace used as a value.
   */
  member: string;
  calls: number;
  accesses: number;
  references: number;
  /** Distinct positional argument counts seen, ascending. */
  argCounts: number[];
  keywords: string[];
  /** At most 50 sites. */
  sites: UsageSite[];
}

/** How a project uses one dependency. */
export interface DependencyUsage {
  ecosystem: Ecosystem;
  name: string;
  filesScanned: number;
  filesUsing: string[];
  imports: UsageImport[];
  members: MemberUsage[];
  /** Imported at run time but no member is ever called. */
  neverCalled: boolean;
  /** `import(x)` with a specifier that is not a string literal. */
  unresolvedDynamicImports: number;
  /** Why parts of the input were skipped, in plain English. */
  problems: string[];
}

/** What the usage scan needs to know about the dependency. */
export interface UsageTarget {
  ecosystem: Ecosystem;
  /** The package name as in the manifest. */
  name: string;
  /** Python import names when they differ from the distribution name. */
  importNames?: string[];
}

/** One file of a generated séance. */
export interface SeanceFile {
  /** Path relative to the project root, e.g. "seance/left-pad/seance.test.mjs". */
  path: string;
  content: string;
  role: 'test' | 'replacement' | 'readme' | 'helper';
}

/** A difference between the old package and its successor that a recipe knows about. */
export interface KnownDifference {
  /** The input, as code. */
  input: string;
  /** What the old package answers. */
  old: string;
  /** What the naive replacement answers. */
  naive: string;
  /** How the generated replacement handles it. */
  handled: string;
}

/** A runnable differential property-based test for one migration. */
export interface SeanceBundle {
  language: 'javascript' | 'python';
  /** Curated recipe id, or null for the generic template. */
  recipe: string | null;
  title: string;
  files: SeanceFile[];
  /** Commands that install what the séance needs. */
  install: string[];
  /** The command that runs it. */
  run: string;
  /** What it compares, and what it ignores (the normalisations). */
  compares: string[];
  knownDifferences: KnownDifference[];
  /** Members covered by the séance. */
  members: string[];
  /** Number of `TODO(necromancer)` markers left in the files. */
  todos: number;
  /** Which versions of the old package this séance was run against, and whether the one in use is among them. */
  oldVersions?: SeanceVersions;
}

/**
 * The versions of the old package a séance was checked against (round 4b). A curated recipe was run for
 * real against each version listed in `testedAgainst`: the real replacement passed and every deliberately
 * wrong replacement failed. A version outside the list may behave differently, so the bundle says so.
 */
export interface SeanceVersions {
  /** The old package. */
  package: string;
  /** Versions the recipe was run against and fits. Empty for the generic template. */
  testedAgainst: string[];
  /** Versions it was run against that it does not fit, with the reason. */
  doesNotFit?: Array<{ version: string; why: string }>;
  /** The version in use as far as the diagnosis knows: a lockfile version, a range, or absent. */
  inUse?: string;
  /** Where `inUse` comes from: the lockfile, the declared range, or nowhere. */
  inUseFrom: 'lockfile' | 'range' | 'unknown';
  /** True when the version in use is covered; false when it is outside; absent when it is not known. */
  covered?: boolean;
  /** Successor versions the recipe was run against (when the successor is a package). */
  successor?: { package: string; testedAgainst: string[] };
  /** The date the runs were made. */
  testedOn?: string;
  /** One or two plain sentences, also written into the README and the spec. */
  note: string;
}

/** The engine's public surface. */
export interface Engine {
  /** Never throws, whatever the content. */
  parseManifest(file: ManifestFile): ParseResult;
  diagnose(deps: DependencyRef[]): Promise<Diagnosis[]>;
  autopsy(input: { subject: string; files: ManifestFile[] }): Promise<AutopsyReport>;
  /**
   * A Kiro spec for moving the project off one dead dependency onto one successor. With a usage
   * it also describes the séance for that project. Without a successor it uses the diagnosis's
   * first, else builds a `raise` successor from the dependency. `project.testRunner` names the
   * project's own test runner in the spec.
   */
  resurrectionSpec(
    diagnosis: Diagnosis,
    successor?: Successor,
    options?: { usage?: DependencyUsage; project?: { testRunner?: string } },
  ): KiroSpec;
  /** How the given source files use a dependency. Never throws. */
  scanUsage?(files: SourceFile[], target: UsageTarget): DependencyUsage;
  /** The differential property-based test for a migration. Never throws. */
  seance?(diagnosis: Diagnosis, successor: Successor, usage?: DependencyUsage): SeanceBundle;
}

/** Factory every consumer uses. */
export type CreateEngine = (options: EngineOptions) => Engine;
