/**
 * Gathers facts from the sources and turns them into diagnoses.
 * Orchestration only: thresholds are in signals.ts, verdict rules in verdict.ts.
 */

import { Http } from './net/http.js';
import { type ResolvedTuning } from './options.js';
import * as signals from './signals.js';
import { getNpmPackage, getProject, getVersionRepo, type ProjectInfo } from './sources/depsdev.js';
import { getGithubRepo, getLatestCommit, type GithubRepo } from './sources/github.js';
import { getHeldPackage } from './sources/repo-package.js';
import { findMovedNotice } from './sources/moved.js';
import { findMaintainerStatement, getReadme, type MaintainerStatement } from './sources/readme.js';
import { getNpmEngines, getNpmLatest } from './sources/npm.js';
import { osvKey, queryOsv, type OsvQuery } from './sources/osv.js';
import { getPypiProject, getPypiReleaseRepo } from './sources/pypi.js';
import { describeLink, nameMatchesRepo, type RepoLink } from './sources/pypi-repo.js';
import { repoKey, repoUrl, type RepoRef } from './sources/repo.js';
import { loadReplacements, type ReplacementIndex } from './sources/replacements.js';
import type { Fetched } from './sources/result.js';
import { findSuccessors } from './successors.js';
import type {
  DependencyRef,
  Diagnosis,
  Evidence,
  EngineOptions,
  SourceId,
  Verdict,
} from './types.js';
import { VERDICTS } from './types.js';
import { errorMessage } from './util/guards.js';
import { resolveVersionInUse } from './versions/resolve.js';
import { upgradeChoice } from './versions/upgrade.js';
import { classOf, decide } from './verdict.js';

interface VersionInfo {
  version: string;
  date?: string;
  deprecated?: string;
  yanked?: boolean;
  yankedReason?: string;
}

/** What the registries said about one package, source-neutral. */
interface PackageFacts {
  ecosystem: DependencyRef['ecosystem'];
  name: string;
  notFound?: SourceId;
  /** At least one registry answered with data. */
  gotData: boolean;
  latest?: { version: string; date?: string };
  deprecatedLatest?: { message: string; source: SourceId };
  versions: VersionInfo[];
  inactive: boolean;
  latestYanked?: { reason?: string };
  repo?: RepoRef;
  /** PyPI: where in the metadata the repository was found, and what else the record names. */
  repoLink?: RepoLink;
  /** PyPI: the metadata names its source at a host the engine does not read. */
  sourceElsewhere?: boolean;
  /** PyPI: the repository came from the metadata of this older release, because the latest names none. */
  repoFromRelease?: string;
  registrySource: SourceId;
  /** Evidence from registry data alone. */
  base: Evidence[];
  /** Filled in phase C. */
  repoLookedUp: boolean;
  scorecard?: ProjectInfo | null;
  github?: GithubRepo;
  /** An archived repository whose README says the project moved: where to (QA: moved repositories). */
  movedTo?: string;
  /** The repository was renamed to a name that is another package: its activity is not this package's (round 5). */
  otherPackage?: { name: string; repo: string };
  /** npm: `engines.node` of releases that are upgrade targets, by version (null: none declared). */
  engines?: Map<string, string | null>;
  /** The README says the project itself is deprecated or no longer maintained (round 5). */
  readmeStatement?: MaintainerStatement;
  /** The default branch's newest commit; null when the repository has none. */
  commit?: { date: string } | null;
  /** Why the commit date was not read, when it was wanted. */
  commitWhy?: string;
  /** How the latest release was dated, when the registry gives several dates (PyPI). */
  latestDating?: string;
  failures: string[];
}

export interface RunReport {
  unavailable: Map<SourceId, { reason: string; count: number }>;
}

export function newRun(): RunReport {
  return { unavailable: new Map() };
}

export function unavailableList(run: RunReport): Array<{ source: SourceId; reason: string }> {
  return [...run.unavailable.entries()].map(([source, v]) => ({
    source,
    reason: v.count > 1 ? `${v.reason} (${v.count} requests affected)` : v.reason,
  }));
}

function note(run: RunReport, source: SourceId, reason: string): void {
  const existing = run.unavailable.get(source);
  if (existing) existing.count++;
  else run.unavailable.set(source, { reason, count: 1 });
}

async function guard<T>(task: () => Promise<Fetched<T>>): Promise<Fetched<T>> {
  try {
    return await task();
  } catch (error) {
    return { ok: false, kind: 'unavailable', reason: errorMessage(error) };
  }
}

const GITHUB_POOL = 3;

/** Names compared by their letters and digits only: `PyPDF2` is `pypdf2`, `@scope/foo-bar` is `foobar`. */
const sameName = (a: string, b: string): boolean => {
  const strict = (n: string): string =>
    (n.split('/').pop() ?? n).toLowerCase().replace(/[^a-z0-9]/g, '');
  return strict(a) === strict(b);
};

const pkgKey = (d: Pick<DependencyRef, 'ecosystem' | 'name'>): string => `${d.ecosystem}:${d.name}`;

export class Core {
  readonly http: Http;
  private githubRequested = new Set<string>();
  private githubWindowStart = 0;
  private githubBlockedUntil = 0;
  private replacements: Promise<ReplacementIndex> | undefined;

  constructor(
    fetch: EngineOptions['fetch'],
    private readonly now: () => Date,
    private readonly tuning: ResolvedTuning,
  ) {
    this.http = new Http(fetch, tuning);
  }

  async diagnose(deps: readonly DependencyRef[], run: RunReport): Promise<Diagnosis[]> {
    // Phase A: registry facts, once per package.
    const unique = new Map<string, DependencyRef>();
    for (const dep of deps) if (!unique.has(pkgKey(dep))) unique.set(pkgKey(dep), dep);
    const facts = new Map<string, PackageFacts>();
    await Promise.all(
      [...unique.entries()].map(async ([key, dep]) => {
        facts.set(key, await this.registryFacts(dep, run));
      }),
    );

    // Phase B: version in use, then one batch of advisory queries.
    const inUse = deps.map((dep) => {
      const f = facts.get(pkgKey(dep));
      if (!f || f.notFound) return undefined;
      const available = f.versions.map((v) => v.version);
      if (dep.ecosystem === 'pypi' && !dep.resolved) {
        // PEP 592: an installer skips yanked releases unless the specifier pins one with "==" or no
        // other release satisfies it. A range must not pick a release that pip would never install.
        const usable = f.versions.filter((v) => !v.yanked).map((v) => v.version);
        const pick = resolveVersionInUse(dep, usable, f.latest?.version);
        if (pick) return pick.version;
      }
      return resolveVersionInUse(dep, available, f.latest?.version)?.version;
    });
    const queries: OsvQuery[] = [];
    deps.forEach((dep, i) => {
      const version = inUse[i];
      if (version) queries.push({ ecosystem: dep.ecosystem, name: dep.name, version });
    });
    const osv = await this.guardedOsv(queries, run);

    // Phase B2: a deprecated version whose way out is another major version: say what that release needs.
    // Only npm declares `engines.node`; one small request per (package, release), shared by every dependency.
    const engineRequests = new Map<string, Promise<void>>();
    deps.forEach((dep, i) => {
      const f = facts.get(pkgKey(dep));
      const version = inUse[i];
      if (dep.ecosystem !== 'npm' || !f || !version || f.deprecatedLatest) return;
      if (!f.versions.find((v) => v.version === version)?.deprecated) return;
      const choice = upgradeChoice('npm', f.versions, version, dep.spec);
      if (choice?.tier !== 'next-major') return;
      const target = choice.target.version;
      const key = `${f.name}@${target}`;
      if (engineRequests.has(key)) return;
      engineRequests.set(
        key,
        (async () => {
          const r = await guard(() => getNpmEngines(this.http, f.name, target));
          if (r.ok) (f.engines ??= new Map()).set(target, r.value);
        })(),
      );
    });
    await Promise.all(engineRequests.values());

    // Phase C: repository facts for packages that are not obviously fresh.
    // A package with an advisory against the version in use is always worth a repository
    // check, even when its latest release is fresh: an archived repository plus an advisory
    // is a zombie.
    const withAdvisory = new Set<string>();
    deps.forEach((dep, i) => {
      const version = inUse[i];
      if (
        version &&
        (osv.advisories.get(osvKey({ ecosystem: dep.ecosystem, name: dep.name, version }))
          ?.length ?? 0) > 0
      ) {
        withAdvisory.add(pkgKey(dep));
      }
    });
    await this.repositoryFacts([...facts.values()], deps, inUse, withAdvisory, run);

    // Phase D: verdicts and successors.
    const needsSuccessors = new Set<number>();
    const prepared = deps.map((dep, i) => {
      try {
        const f = facts.get(pkgKey(dep));
        if (!f) throw new Error('missing facts');
        const version = inUse[i];
        const osvId = version
          ? osvKey({ ecosystem: dep.ecosystem, name: dep.name, version })
          : undefined;
        const advisories = osvId ? (osv.advisories.get(osvId) ?? []) : [];
        const advisoryAliases = osvId ? osv.aliases.get(osvId) : undefined;
        const decision = this.verdictFor(f, version, advisories, dep.spec);
        if (decision.verdict !== 'alive') needsSuccessors.add(i);
        return { dep, f, version, advisories, advisoryAliases, decision };
      } catch (error) {
        note(run, dep.ecosystem, `internal error: ${errorMessage(error)}`);
        return undefined;
      }
    });

    let index: ReplacementIndex | undefined;
    if ([...needsSuccessors].some((i) => deps[i]?.ecosystem === 'npm')) {
      index = await this.loadIndex(run);
    }

    return Promise.all(
      prepared.map(async (p, i): Promise<Diagnosis> => {
        const dep = deps[i] as DependencyRef;
        if (!p) {
          return {
            dependency: dep,
            verdict: 'alive',
            evidence: [signals.unchecked(dep.ecosystem, ['an internal error stopped the check'])],
            advisories: [],
            successors: [],
          };
        }
        const { f, decision, advisories, advisoryAliases } = p;
        let successors: Diagnosis['successors'] = [];
        if (decision.verdict !== 'alive') {
          try {
            successors = await findSuccessors({
              ecosystem: dep.ecosystem,
              name: dep.name,
              ...(f.deprecatedLatest
                ? {
                    deprecation: f.deprecatedLatest.message,
                    deprecationSource: f.deprecatedLatest.source,
                  }
                : f.readmeStatement
                  ? { deprecation: f.readmeStatement.window, deprecationSource: 'readme' as const }
                  : {}),
              replacements: index && dep.ecosystem === 'npm' ? index.lookup(dep.name) : [],
              ...(f.otherPackage
                ? {
                    known: [
                      {
                        name: f.otherPackage.name,
                        ecosystem: dep.ecosystem,
                        kind: 'package' as const,
                        reason: `The repository of ${dep.name} was renamed to ${f.otherPackage.repo} and now holds ${f.otherPackage.name}.`,
                        source: 'github' as const,
                        url:
                          dep.ecosystem === 'npm'
                            ? `https://www.npmjs.com/package/${f.otherPackage.name}`
                            : `https://pypi.org/project/${f.otherPackage.name}/`,
                      },
                    ],
                  }
                : {}),
              ...(this.tuning.verifySuccessors
                ? { verifyPackage: (n: string) => this.packageIsAlive(n) }
                : {}),
            });
          } catch (error) {
            note(run, 'module-replacements', `successor lookup failed: ${errorMessage(error)}`);
          }
        }
        const out: Diagnosis = {
          dependency: dep,
          verdict: decision.verdict,
          evidence: decision.evidence,
          advisories,
          successors,
        };
        if (decision.basis) out.basis = decision.basis;
        if (p.version && decision.evidence.some((e) => classOf(e.code) === 'notice')) {
          const choice = upgradeChoice(f.ecosystem, f.versions, p.version, dep.spec);
          if (choice) out.upgradeTo = choice.target;
        }
        if (advisoryAliases) out.advisoryAliases = advisoryAliases;
        if (f.notFound) out.notFound = true;
        if (f.latest) out.latest = f.latest;
        return out;
      }),
    );
  }

  // --- Phase A ------------------------------------------------------------------------------

  private async registryFacts(dep: DependencyRef, run: RunReport): Promise<PackageFacts> {
    const facts: PackageFacts = {
      ecosystem: dep.ecosystem,
      name: dep.name,
      gotData: false,
      versions: [],
      inactive: false,
      registrySource: dep.ecosystem === 'npm' ? 'npm' : 'pypi',
      base: [],
      repoLookedUp: false,
      failures: [],
    };
    const fail = (source: SourceId, reason: string): void => {
      facts.failures.push(`${source}: ${reason}`);
      note(run, source, reason);
    };

    if (dep.ecosystem === 'pypi') {
      const r = await guard(() => getPypiProject(this.http, dep.name));
      if (!r.ok) {
        if (r.kind === 'not-found') facts.notFound = 'pypi';
        else fail('pypi', r.reason);
        return facts;
      }
      const p = r.value;
      facts.gotData = true;
      facts.versions = p.releases.map((rel) => ({
        version: rel.version,
        ...(rel.date ? { date: rel.date } : {}),
        yanked: rel.yanked,
        ...(rel.yankedReason ? { yankedReason: rel.yankedReason } : {}),
      }));
      const latestRelease = p.releases.find((x) => x.version === p.latest);
      facts.latest = {
        version: p.latest,
        ...(latestRelease?.date ? { date: latestRelease.date } : {}),
      };
      if (latestRelease?.date && latestRelease.firstDate) {
        const spread = signals.ageInDays(
          latestRelease.firstDate,
          new Date(Date.parse(latestRelease.date)),
        );
        if (spread !== undefined && spread > 30) {
          facts.latestDating = `Dated by its newest file, uploaded ${signals.isoDay(latestRelease.date)}; its first file was uploaded ${signals.isoDay(latestRelease.firstDate)}.`;
        }
      }
      facts.inactive = p.inactive;
      if (p.latestYanked) facts.latestYanked = p.yankedReason ? { reason: p.yankedReason } : {};
      if (p.repo) facts.repo = p.repo;
      if (p.repoLink) facts.repoLink = p.repoLink;
      if (p.sourceElsewhere) facts.sourceElsewhere = true;
      return facts;
    }

    const [latestResult, listResult] = await Promise.all([
      guard(() => getNpmLatest(this.http, dep.name)),
      guard(() => getNpmPackage(this.http, dep.name)),
    ]);
    if (latestResult.ok) {
      facts.gotData = true;
      facts.latest = { version: latestResult.value.version };
      if (latestResult.value.deprecated) {
        facts.deprecatedLatest = { message: latestResult.value.deprecated, source: 'npm' };
      }
      if (latestResult.value.repo) facts.repo = latestResult.value.repo;
    } else if (latestResult.kind === 'not-found') {
      facts.notFound = 'npm';
    } else {
      fail('npm', latestResult.reason);
    }
    if (listResult.ok) {
      facts.gotData = true;
      facts.versions = listResult.value.versions.map((v) => ({
        version: v.version,
        ...(v.date ? { date: v.date } : {}),
        ...(v.deprecated ? { deprecated: v.deprecated } : {}),
      }));
      const defaultVersion = listResult.value.defaultVersion;
      if (!facts.latest && defaultVersion) {
        facts.latest = { version: defaultVersion };
        const dv = facts.versions.find((v) => v.version === defaultVersion);
        if (dv?.deprecated) facts.deprecatedLatest = { message: dv.deprecated, source: 'deps.dev' };
      }
    } else if (listResult.kind === 'not-found') {
      if (!latestResult.ok && latestResult.kind !== 'not-found') facts.notFound = 'deps.dev';
    } else {
      fail('deps.dev', listResult.reason);
    }
    if (facts.latest && !facts.latest.date) {
      const date = facts.versions.find((v) => v.version === facts.latest?.version)?.date;
      if (date) facts.latest.date = date;
    }
    return facts;
  }

  // --- Phase B ------------------------------------------------------------------------------

  private async guardedOsv(queries: OsvQuery[], run: RunReport) {
    try {
      const outcome = await queryOsv(this.http, queries);
      if (outcome.failure) note(run, 'osv', outcome.failure);
      return outcome;
    } catch (error) {
      note(run, 'osv', errorMessage(error));
      return {
        advisories: new Map<string, string[]>(),
        aliases: new Map<string, Record<string, string[]>>(),
        missing: new Set<string>(),
        unmerged: new Set<string>(),
      };
    }
  }

  // --- Phase C ------------------------------------------------------------------------------

  /** The repository's last push is more than 30 days older than the latest release. */
  private predatesLatest(f: PackageFacts): boolean {
    if (f.github?.state !== 'ok' || !f.github.pushedAt) return false;
    const pushed = Date.parse(f.github.pushedAt);
    const released = Date.parse(f.latest?.date ?? '');
    return (
      Number.isFinite(pushed) &&
      Number.isFinite(released) &&
      pushed < released - 30 * signals.DAY_MS
    );
  }

  private isFresh(f: PackageFacts, withAdvisory: ReadonlySet<string>): boolean {
    if (withAdvisory.has(pkgKey(f))) return false;
    if (f.deprecatedLatest || f.inactive || f.latestYanked || f.notFound) return false;
    const age = signals.ageInDays(f.latest?.date, this.now());
    return age !== undefined && age < signals.THRESHOLDS.freshDays;
  }

  private registryEvidence(f: PackageFacts, inUse: string | undefined, spec?: string): Evidence[] {
    const out: Evidence[] = [];
    const now = this.now();
    if (f.notFound) out.push(signals.registryNotFound(f.notFound, f.name));
    if (f.deprecatedLatest) {
      out.push(
        signals.npmDeprecated(
          f.deprecatedLatest.message,
          f.deprecatedLatest.source,
          f.name,
          f.latest?.date,
        ),
      );
    } else if (inUse) {
      // A deprecated or yanked version in use of a package that is itself fine: an upgrade notice. It
      // never makes the package dying (the verdict reads signals about the package, not the version).
      const used = f.versions.find((v) => v.version === inUse);
      const yanked = used?.yanked === true && !f.latestYanked;
      if (used && (used.deprecated || yanked)) {
        const choice = upgradeChoice(f.ecosystem, f.versions, inUse, spec);
        if (used.deprecated)
          out.push(
            signals.versionDeprecated(
              used.deprecated,
              inUse,
              f.registrySource === 'npm' ? 'deps.dev' : f.registrySource,
              f.name,
              choice,
              choice ? f.engines?.get(choice.target.version) : undefined,
            ),
          );
        if (yanked) out.push(signals.versionYanked(f.name, inUse, used.yankedReason, choice));
      }
    }
    if (f.repoLink && f.repo) {
      const how = describeLink(
        f.repoLink,
        f.repoFromRelease ? { kind: 'oldest-release', version: f.repoFromRelease } : undefined,
      );
      if (how) out.push(signals.repoLinkNote(how, f.repo));
    }
    if (f.inactive) out.push(signals.pypiInactive(f.name));
    if (f.latestYanked && f.latest)
      out.push(signals.pypiYanked(f.name, f.latest.version, f.latestYanked.reason));
    if (f.latest) {
      const url =
        f.ecosystem === 'npm'
          ? `https://www.npmjs.com/package/${f.name}`
          : `https://pypi.org/project/${f.name}/`;
      const age = signals.releaseAge(
        f.latest.version,
        f.latest.date,
        now,
        f.registrySource,
        url,
        f.latestDating,
      );
      if (age) out.push(age);
    }
    return out;
  }

  private async repositoryFacts(
    all: PackageFacts[],
    deps: readonly DependencyRef[],
    inUse: Array<string | undefined>,
    withAdvisory: ReadonlySet<string>,
    run: RunReport,
  ): Promise<void> {
    const versionByPackage = new Map<string, string | undefined>();
    deps.forEach((dep, i) => {
      if (!versionByPackage.has(pkgKey(dep))) versionByPackage.set(pkgKey(dep), inUse[i]);
    });
    const candidates = all.filter(
      (f) => f.gotData && !f.notFound && !this.isFresh(f, withAdvisory),
    );

    // Repository link and Scorecard (deps.dev has no hard limit; GitHub does).
    await Promise.all(
      candidates.map(async (f) => {
        // PyPI: the latest release names no repository. An older release's metadata may (darglint dropped the
        // link when it changed its build tool). Only the oldest release is read, and only a repository whose
        // name matches the package is taken, so a name that changed hands is not followed.
        if (!f.repo && !f.sourceElsewhere && f.ecosystem === 'pypi' && f.versions.length > 0) {
          const oldest = [...f.versions].sort((a, b) =>
            (a.date ?? '~').localeCompare(b.date ?? '~'),
          )[0];
          if (oldest && oldest.version !== f.latest?.version) {
            const r = await guard(() => getPypiReleaseRepo(this.http, f.name, oldest.version));
            if (r.ok && r.value && nameMatchesRepo(f.name, r.value.repo.name)) {
              f.repo = r.value.repo;
              f.repoLink = r.value;
              f.repoFromRelease = oldest.version;
            } else if (!r.ok && r.kind !== 'not-found') {
              note(run, 'pypi', `release ${oldest.version}: ${r.reason}`);
            }
          }
        }
        if (!f.repo && f.ecosystem === 'npm' && f.latest) {
          const r = await guard(() => getVersionRepo(this.http, f.name, f.latest?.version ?? ''));
          if (r.ok) {
            if (r.value) f.repo = r.value;
            else f.repoLookedUp = true;
          } else if (r.kind !== 'not-found') {
            note(run, 'deps.dev', r.reason);
          }
        } else {
          f.repoLookedUp = true;
        }
        if (f.repo) {
          f.repoLookedUp = true;
          const p = await guard(() => getProject(this.http, f.repo as RepoRef));
          if (p.ok) f.scorecard = p.value;
          else note(run, 'deps.dev', p.reason);
        }
      }),
    );

    // GitHub, only for packages that already look unhealthy, worst first, within the budget.
    // A Scorecard score alone does not decide a verdict, but it is still a reason to look.
    const rank = (f: PackageFacts): number => {
      const evidence = [
        ...this.registryEvidence(f, versionByPackage.get(pkgKey(f))),
        ...this.scorecardEvidence(f),
      ];
      const verdictRank = VERDICTS.indexOf(decide(evidence, []).verdict);
      // A deprecated or yanked version in use no longer makes a package dying, but the repository is
      // still read for it: an archived or abandoned package is found the same way as before.
      const notice = evidence.some((e) => classOf(e.code) === 'notice');
      return notice ? Math.max(verdictRank, VERDICTS.indexOf('dying')) : verdictRank;
    };
    const wanted = candidates
      .filter((f) => f.repo?.host === 'github.com')
      .map((f) => ({ f, rank: rank(f) }))
      .filter(
        (x) =>
          x.rank > 0 ||
          withAdvisory.has(pkgKey(x.f)) ||
          (x.f.scorecard?.maintained !== undefined &&
            x.f.scorecard.maintained <= signals.THRESHOLDS.scorecardLow),
      )
      .sort((a, b) => b.rank - a.rank);
    // GitHub counts calls per hour, so the budget is per hour too. Every distinct request counts.
    if (this.now().getTime() - this.githubWindowStart >= 3_600_000) {
      this.githubRequested = new Set<string>();
      this.githubWindowStart = this.now().getTime();
    }
    let skippedRepos = 0;
    let skippedCommits = 0;
    const take = (key: string): 'ok' | 'blocked' | 'budget' => {
      if (this.now().getTime() < this.githubBlockedUntil) return 'blocked'; // already reported
      if (this.githubRequested.has(key)) return 'ok';
      if (this.githubRequested.size >= this.tuning.githubBudget) return 'budget';
      this.githubRequested.add(key);
      return 'ok';
    };
    // A small pool, so a refusal from GitHub stops the calls that have not started yet.
    const pool = async <T>(items: T[], work: (item: T) => Promise<void>): Promise<void> => {
      const queue = [...items];
      const worker = async (): Promise<void> => {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) await work(next);
      };
      await Promise.all(Array.from({ length: Math.min(GITHUB_POOL, queue.length) }, worker));
    };
    const refused = (g: { kind: string; reason: string }): void => {
      if (g.kind === 'rate-limited') this.githubBlockedUntil = this.now().getTime() + 3_600_000;
      note(run, 'github', g.reason);
    };

    await pool(wanted, async ({ f }) => {
      const repo = f.repo as RepoRef;
      const gate = take(`repo:${repoKey(repo)}`);
      if (gate === 'blocked') return;
      if (gate === 'budget') {
        skippedRepos++;
        return;
      }
      const g = await guard(() => getGithubRepo(this.http, repo));
      if (g.ok) f.github = g.value;
      else refused(g);
    });

    // A repository taken from an older release's metadata is a weaker claim than one in the latest
    // release, so it is kept only when GitHub confirmed it: it answered (the package looked unhealthy
    // enough to be read, and the budget allowed it), it is not a fork, and it was not last pushed to more
    // than 30 days before the latest release (the release cannot have been built from it: pep8's first home,
    // idle since 2009). Gone, a fork, too old, a host the engine does not read, or never read: drop it, and
    // the package is back where it was before (no repository link), never a ghost.
    for (const f of all) {
      if (f.repoFromRelease === undefined) continue;
      const confirmed =
        f.github?.state === 'ok' && f.github.fork !== true && !this.predatesLatest(f);
      if (confirmed) continue;
      delete f.github;
      delete f.repo;
      delete f.repoLink;
      delete f.repoFromRelease;
      delete f.scorecard;
    }

    // A repository that was renamed to another package's name (py-pdf/PyPDF2 became py-pdf/pypdf) no longer
    // speaks for this package. The manifest at its head names the package it holds now; when that is a
    // different package that exists on the registry and is alive, the repository's activity, archive state and
    // Scorecard are that package's, not this one's.
    const renamed = wanted
      .map(({ f }) => f)
      .filter(
        (f) =>
          f.repo?.host === 'github.com' &&
          f.github?.state === 'ok' &&
          f.github.renamedTo !== undefined &&
          !sameName(f.github.renamedTo.split('/')[1] ?? '', f.repo.name) &&
          !sameName(f.github.renamedTo.split('/')[1] ?? '', f.name),
      );
    await pool(renamed, async (f) => {
      const slug = (f.github?.state === 'ok' ? f.github.renamedTo : undefined) as string;
      const held = await guard(() => getHeldPackage(this.http, f.ecosystem, slug));
      if (!held.ok) {
        note(run, 'github', `manifest of ${slug}: ${held.reason}`);
        return;
      }
      const other = held.value?.name;
      if (!other || sameName(other, f.name)) return;
      const exists =
        f.ecosystem === 'npm'
          ? await this.packageIsAlive(other)
          : await this.pypiProjectIsAlive(other);
      if (exists) f.otherPackage = { name: other, repo: slug };
    });

    // The README, from raw.githubusercontent.com (not the GitHub REST API: no GitHub budget), for the
    // packages that look unhealthy enough to be read at all. It is read for two things:
    //  - an archived repository may be archived because the project moved, which its README says at the top;
    //  - a README that says the project itself is deprecated or no longer maintained is the maintainers' own
    //    word, a hard signal (round 5).
    // Not needed when the registry already ends the package's life (deprecated, inactive, yanked).
    const readable = wanted
      .map(({ f }) => f)
      .filter(
        (f) =>
          f.repo?.host === 'github.com' &&
          f.github?.state !== 'gone' &&
          !f.otherPackage &&
          !f.deprecatedLatest &&
          !f.inactive &&
          !f.latestYanked,
      );
    await pool(readable, async (f) => {
      const repo = f.repo as RepoRef;
      const r = await guard(() => getReadme(this.http, repo));
      if (!r.ok) {
        note(run, 'github', `README of ${repoKey(repo)}: ${r.reason}`);
        return;
      }
      if (!r.value) return;
      if (f.github?.state === 'ok' && f.github.archived) {
        const moved = findMovedNotice(r.value);
        if (moved) f.movedTo = moved;
      }
      if (!f.movedTo) {
        const statement = findMaintainerStatement(r.value, [f.name, repo.name]);
        if (statement) f.readmeStatement = statement;
      }
    });

    // The default branch's latest commit. Where the repository was pushed to within the year, the
    // commit date decides whether the package is alive, so those come first; where it was not, the
    // commit date only makes the evidence exact, so those use what budget is left.
    const jobs = wanted
      .map(({ f }) => f)
      .filter(
        (f) =>
          f.github?.state === 'ok' &&
          !f.github.archived &&
          !f.otherPackage &&
          !withAdvisory.has(pkgKey(f)),
      )
      .map((f) => {
        const decision = this.verdictFor(f, versionByPackage.get(pkgKey(f)), []);
        // A Scorecard score alone leaves a package alive, but a repository whose default branch has
        // been quiet for a year is a stronger sign than the score: its commit date can settle it.
        const scoreOnly =
          decision.verdict === 'alive' &&
          f.scorecard?.maintained !== undefined &&
          f.scorecard.maintained <= signals.THRESHOLDS.scorecardLow;
        return {
          f,
          soft: scoreOnly || (decision.verdict !== 'alive' && decision.basis === 'heuristic'),
        };
      })
      .filter((x) => x.soft)
      .map((x) => {
        const pushed = x.f.github?.state === 'ok' ? x.f.github.pushedAt : undefined;
        const days = signals.ageInDays(pushed, this.now());
        return { f: x.f, decisive: days === undefined || days < signals.THRESHOLDS.activeDays };
      })
      .sort((a, b) => Number(b.decisive) - Number(a.decisive));
    await pool(jobs, async ({ f }) => {
      const repo = f.repo as RepoRef;
      const gate = take(`commits:${repoKey(repo)}`);
      if (gate === 'blocked') {
        f.commitWhy = 'GitHub refused further calls';
        return;
      }
      if (gate === 'budget') {
        skippedCommits++;
        f.commitWhy = 'the GitHub budget for this scan was used up';
        return;
      }
      const c = await guard(() => getLatestCommit(this.http, repo));
      if (c.ok) f.commit = c.value;
      else {
        f.commitWhy = c.reason;
        refused(c);
      }
    });
    if (skippedRepos > 0 || skippedCommits > 0) {
      const parts: string[] = [];
      if (skippedRepos > 0) {
        parts.push(
          `${skippedRepos} ${skippedRepos === 1 ? 'repository was' : 'repositories were'} not checked`,
        );
      }
      if (skippedCommits > 0) {
        parts.push(
          `${skippedCommits} commit ${skippedCommits === 1 ? 'date was' : 'dates were'} not read`,
        );
      }
      note(
        run,
        'github',
        `GitHub budget reached (${this.tuning.githubBudget} calls per scan, limit is 60 per hour): ${parts.join(', ')}`,
      );
    }
  }

  private scorecardEvidence(f: PackageFacts): Evidence[] {
    const out: Evidence[] = [];
    const maintained = f.scorecard?.maintained;
    if (maintained !== undefined) {
      const e = signals.lowMaintenance(maintained, f.scorecard?.scorecardDate);
      if (e) out.push(e);
    }
    return out;
  }

  // --- Phase D ------------------------------------------------------------------------------

  private verdictFor(
    f: PackageFacts,
    version: string | undefined,
    advisories: string[],
    spec?: string,
  ) {
    const now = this.now();
    const evidence = [
      ...this.registryEvidence(f, version, spec),
      ...(f.otherPackage ? [] : this.scorecardEvidence(f)),
    ];
    let pushedAt: string | undefined;
    if (f.otherPackage && f.repo) {
      // The repository holds another package now: say so, and read nothing else from it.
      evidence.push(
        signals.repoHoldsOtherPackage(
          repoUrl(f.repo),
          f.otherPackage.repo,
          f.otherPackage.name,
          f.name,
        ),
      );
    } else if (f.github?.state === 'ok') {
      const url = f.repo ? repoUrl(f.repo) : '';
      pushedAt = f.github.pushedAt;
      if (f.github.renamedTo) {
        evidence.push(signals.repoMoved(url, f.github.renamedTo, 'renamed'));
      }
      if (f.github.archived) {
        // Archived because the project moved elsewhere is not an end of life: say where it went.
        evidence.push(
          f.movedTo
            ? signals.repoMoved(url, f.movedTo, 'readme')
            : signals.repoArchived(url, f.github.pushedAt),
        );
      } else if (f.commit) {
        // The default branch's own commits decide; a push to another branch or tag does not.
        const alive = signals.recentActivity(url, f.commit.date, now);
        if (alive) evidence.push(alive);
        else {
          const quiet = signals.repoInactive(url, { kind: 'commit', date: f.commit.date }, now);
          if (quiet) evidence.push(quiet);
        }
      } else if (f.github.pushedAt) {
        const quiet = signals.repoInactive(url, { kind: 'push', date: f.github.pushedAt }, now);
        if (quiet) evidence.push(quiet);
      }
    } else if (f.github?.state === 'gone' && f.repo) {
      evidence.push(signals.repoGone(repoUrl(f.repo), f.github.reason));
    }
    if (f.readmeStatement && f.repo) {
      evidence.push(signals.readmeUnmaintained(f.readmeStatement.sentence, repoUrl(f.repo)));
    }
    if (f.repoLookedUp && !f.repo && f.gotData)
      evidence.push(signals.noRepository(f.registrySource));
    if (advisories.length > 0 && version)
      evidence.push(signals.advisoryEvidence(advisories, version));
    if (f.notFound) {
      // Nothing was examined, so nothing is claimed: alive, marked "Not checked" (QA-07).
      evidence.push(
        signals.unchecked(f.registrySource, ['the registry has no record of this package']),
      );
    }
    if (!f.gotData && !f.notFound) {
      evidence.push(
        signals.unchecked(
          f.registrySource,
          f.failures.length ? f.failures : ['no source answered'],
        ),
      );
    }
    const decision = decide(evidence, advisories);
    // A staleness verdict, a repository pushed to within the year, and no commit date: say so. The
    // verdict is the one without commit data; it was not moved by the missing data.
    if (
      decision.verdict !== 'alive' &&
      decision.basis === 'heuristic' &&
      advisories.length === 0 &&
      f.github?.state === 'ok' &&
      !f.github.archived &&
      f.commit === undefined &&
      f.commitWhy !== undefined &&
      pushedAt !== undefined &&
      (signals.ageInDays(pushedAt, now) ?? Infinity) < signals.THRESHOLDS.activeDays
    ) {
      const url = f.repo ? repoUrl(f.repo) : '';
      return decide(
        [...evidence, signals.activityUnchecked(url, pushedAt, now, f.commitWhy)],
        advisories,
      );
    }
    return decision;
  }

  // --- helpers ------------------------------------------------------------------------------

  private loadIndex(run: RunReport): Promise<ReplacementIndex> {
    const loading = (this.replacements ??= loadReplacements(this.http));
    return loading.then((index) => {
      // A partial load is not kept, so the next scan tries again.
      if (index.failures.length > 0 && this.replacements === loading) this.replacements = undefined;
      for (const f of index.failures)
        note(run, 'module-replacements', `${f.manifest}: ${f.reason}`);
      return index;
    });
  }

  private async pypiProjectIsAlive(name: string): Promise<boolean> {
    const r = await guard(() => getPypiProject(this.http, name));
    return r.ok && !r.value.inactive && !r.value.latestYanked;
  }

  private async packageIsAlive(name: string): Promise<boolean> {
    const r = await guard(() => getNpmPackage(this.http, name));
    if (!r.ok) return false;
    const def = r.value.versions.find((v) => v.isDefault);
    return def !== undefined && !def.deprecated;
  }
}

export function emptySummary(): Record<Verdict, number> {
  return { alive: 0, dying: 0, dead: 0, ghost: 0, zombie: 0 };
}
