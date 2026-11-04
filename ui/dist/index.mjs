import { jsxs as i, jsx as s, Fragment as $ } from "react/jsx-runtime";
import { useAppApi as z, useAppInfo as G, useChatLauncher as P } from "@kirocrew/app-sdk";
import { StatCard as R, Card as _, CardTitle as H, Badge as v, PageHeader as V } from "@kirocrew/app-sdk/ui";
import { useState as N, useRef as W, useCallback as q, useEffect as B, useMemo as U } from "react";
const y = (e, t) => `${e}:${t}`, K = {
  [y("npm", "left-pad")]: {
    verdict: "dead",
    basis: "hard",
    evidence: [
      {
        code: "npm-deprecated",
        message: "Deprecated by its maintainer: use String.prototype.padStart.",
        source: "npm",
        url: "https://www.npmjs.com/package/left-pad",
        date: "2018-04-01"
      },
      {
        code: "no-release",
        message: "No release since 2018.",
        source: "npm",
        date: "2018-04-01"
      }
    ],
    advisories: [],
    successors: [
      {
        name: "String.prototype.padStart",
        ecosystem: "npm",
        kind: "native",
        reason: "Built into every supported JavaScript runtime.",
        source: "module-replacements"
      }
    ],
    latest: { version: "1.3.0", date: "2018-04-01" }
  },
  [y("npm", "request")]: {
    verdict: "zombie",
    basis: "hard",
    evidence: [
      {
        code: "npm-deprecated",
        message: "Deprecated: request has been fully deprecated and will receive no more fixes.",
        source: "npm",
        date: "2020-02-11"
      },
      {
        code: "osv-advisory",
        message: "A known advisory affects the version in use and will not be patched.",
        source: "osv",
        url: "https://osv.dev/vulnerability/GHSA-p8p7-x288-28g6"
      }
    ],
    advisories: ["GHSA-p8p7-x288-28g6"],
    successors: [
      {
        name: "fetch",
        ecosystem: "npm",
        kind: "native",
        reason: "Global fetch ships with Node 18 and later.",
        source: "module-replacements"
      },
      {
        name: "got",
        ecosystem: "npm",
        kind: "package",
        reason: "Maintained HTTP client with a similar feature set.",
        source: "curated"
      }
    ],
    latest: { version: "2.88.2", date: "2020-03-14" }
  },
  [y("npm", "moment")]: {
    verdict: "dying",
    basis: "heuristic",
    evidence: [
      {
        code: "maintenance-mode",
        message: "The project is in maintenance mode and accepts no new features.",
        source: "github"
      }
    ],
    advisories: [],
    successors: [
      {
        name: "date-fns",
        ecosystem: "npm",
        kind: "package",
        reason: "Maintained, tree-shakeable date utilities.",
        source: "module-replacements"
      }
    ],
    latest: { version: "2.30.1", date: "2023-12-27" }
  },
  [y("npm", "fixture-ghost-lib")]: {
    verdict: "ghost",
    basis: "hard",
    evidence: [
      {
        code: "repo-gone",
        message: "The source repository no longer exists.",
        source: "github"
      },
      {
        code: "no-release",
        message: "No release for more than five years.",
        source: "npm"
      }
    ],
    advisories: [],
    successors: [
      {
        name: "fixture-ghost-lib",
        ecosystem: "npm",
        kind: "raise",
        reason: "No successor exists; rebuild the small utility as code the project owns.",
        source: "curated"
      }
    ]
  },
  [y("pypi", "nose")]: {
    verdict: "dead",
    basis: "hard",
    evidence: [
      {
        code: "project-inactive",
        message: "The project is no longer maintained and fails on current Python versions.",
        source: "pypi"
      }
    ],
    advisories: [],
    successors: [
      {
        name: "pytest",
        ecosystem: "pypi",
        kind: "package",
        reason: "The maintained test runner that nose pointed its users to.",
        source: "curated"
      }
    ],
    latest: { version: "1.3.7", date: "2015-06-02" }
  }
};
function X(e) {
  const t = K[y(e.ecosystem, e.name)];
  return t ? {
    dependency: e,
    verdict: t.verdict,
    basis: t.basis,
    evidence: t.evidence.map((o) => ({ ...o })),
    advisories: [...t.advisories],
    successors: t.successors.map((o) => ({ ...o })),
    ...t.latest ? { latest: { ...t.latest } } : {}
  } : { dependency: e, verdict: "alive", evidence: [], advisories: [], successors: [] };
}
const A = ["alive", "dying", "dead", "ghost", "zombie"];
function b(e) {
  return A.indexOf(e);
}
function S(e) {
  return `${e.ecosystem}:${e.name}`;
}
const T = {
  alive: { symbol: "✓", label: "Alive" },
  dying: { symbol: "◐", label: "Dying" },
  dead: { symbol: "✝", label: "Dead" },
  ghost: { symbol: "◌", label: "Ghost" },
  zombie: { symbol: "☣", label: "Zombie" }
};
function h(e, t, o, a) {
  return { ecosystem: e, name: t, spec: o, direct: !0, scope: "main", declaredIn: a };
}
function F(e, t, o) {
  const a = o.map(X), c = { alive: 0, dying: 0, dead: 0, ghost: 0, zombie: 0 };
  for (const r of a) c[r.verdict] += 1;
  const l = {
    subject: `demo:${t}`,
    scannedAt: "2026-11-03T03:00:00.000Z",
    manifests: [],
    diagnoses: a,
    problems: [],
    unavailable: [],
    summary: c
  };
  return {
    id: e,
    path: t,
    addedAt: "2026-11-01T00:00:00.000Z",
    lastScanAt: l.scannedAt,
    status: "ok",
    snapshot: Object.fromEntries(a.map((r) => [S(r.dependency), r.verdict])),
    report: l
  };
}
function Y() {
  const e = F("demo-web-shop", "~/demo/web-shop", [
    h("npm", "express", "^4.19.0", "package.json"),
    h("npm", "request", "^2.88.2", "package.json"),
    h("npm", "left-pad", "1.3.0", "package.json"),
    h("npm", "moment", "^2.30.1", "package.json")
  ]), t = F("demo-data-jobs", "~/demo/data-jobs", [
    h("pypi", "requests", ">=2.31", "requirements.txt"),
    h("pypi", "nose", "==1.3.7", "requirements.txt"),
    h("npm", "fixture-ghost-lib", "^0.4.0", "package.json")
  ]);
  return { version: 1, projects: { [e.id]: e, [t.id]: t } };
}
const Z = "Not found on the registry (removed, private or misspelled). It was not checked; this is not the same as alive.", J = "Suggestion, low confidence: a plausible fit with a different API or scope, not a drop-in. Ask the person before using it.";
function I(e) {
  return e?.confidence === "low";
}
function Q(e) {
  const t = I(e);
  return {
    ...e,
    isSuggestion: t,
    advice: t ? J : e.kind === "raise" ? "No maintained replacement is known: rebuild the small utility as code the project owns." : `${e.kind === "native" ? "Built into the platform" : "A maintained package"}${e.confidence ? ` (${e.confidence} confidence)` : ""}.`
  };
}
function ee(e) {
  return e.advisories.map((t) => ({ id: t, also: e.advisoryAliases?.[t] ?? [] }));
}
function O(e) {
  const t = e.evidence.find((o) => o.code === "repo-moved");
  return t ? { message: t.message, ...t.url ? { url: t.url } : {} } : void 0;
}
function D(e) {
  if (e.notFound || e.verdict !== "alive") return;
  const t = e.evidence.find((l) => l.code === "version-deprecated" || l.code === "version-yanked");
  if (!t) return;
  const o = t.code === "version-yanked" ? "yanked" : "deprecated", a = e.upgradeTo;
  if (!a) return { kind: o, text: "No newer stable release that is not deprecated or yanked is known." };
  const c = a.sameMajor ? "same major version" : "another major version";
  return {
    kind: o,
    version: a.version,
    sameMajor: a.sameMajor,
    ...a.older ? { older: !0 } : {},
    text: a.older ? `Use ${a.version} (${c}). It is older than the version in use: no newer stable release is free of deprecation or yanking.` : `Upgrade to ${a.version} (${c}).`
  };
}
function E() {
  return { alive: 0, dying: 0, dead: 0, ghost: 0, zombie: 0 };
}
function j(e, t) {
  const o = e.evidence[0], a = e.successors[0], c = O(e), l = ee(e), r = D(e), d = t === "not-found" ? Z : t === "notice" ? [
    l.length > 0 ? `Maintained, but ${l.length} known ${l.length === 1 ? "vulnerability affects" : "vulnerabilities affect"} the version in use.` : "",
    c ? "The repository moved; that is not an end of life." : "",
    r ? `The package is maintained, but the version in use is ${r.kind}. ${r.text}` : ""
  ].filter(Boolean).join(" ") : o ? o.message : `Marked ${e.verdict} with no recorded evidence.`;
  return {
    key: S(e.dependency),
    name: e.dependency.name,
    ecosystem: e.dependency.ecosystem,
    spec: e.dependency.spec,
    verdict: e.verdict,
    kind: t,
    notFound: t === "not-found",
    epitaph: d,
    advisories: e.advisories,
    advisoryList: l,
    ...a ? { successor: a, suggestion: I(a), successorAdvice: Q(a).advice } : {},
    ...c ? { moved: c.message } : {},
    ...r && t === "notice" ? { upgrade: r } : {},
    ...e.basis && t === "verdict" ? { basis: e.basis } : {}
  };
}
function te(e) {
  const t = E();
  let o = 0;
  return { projects: Object.values(e.projects).sort((c, l) => c.path.localeCompare(l.path)).map((c) => {
    const l = E(), r = /* @__PURE__ */ new Map();
    for (const n of c.report?.diagnoses ?? []) {
      const p = S(n.dependency), u = r.get(p);
      (!u || b(n.verdict) > b(u.verdict) || n.notFound && !u.notFound && b(n.verdict) === b(u.verdict)) && r.set(p, n);
    }
    let d = 0;
    for (const n of r.values()) {
      if (n.notFound) {
        d += 1, o += 1;
        continue;
      }
      l[n.verdict] += 1, t[n.verdict] += 1;
    }
    const m = [...r.values()], f = (n, p) => n.name.localeCompare(p.name), x = m.filter((n) => !n.notFound && n.verdict !== "alive").map((n) => j(n, "verdict")).sort((n, p) => b(p.verdict) - b(n.verdict) || f(n, p)), w = m.filter((n) => n.notFound).map((n) => j(n, "not-found")).sort(f), g = m.filter((n) => !n.notFound && n.verdict === "alive" && (n.advisories.length > 0 || O(n) || D(n))).map((n) => j(n, "notice")).sort(f), k = [...x, ...w, ...g];
    return {
      id: c.id,
      path: c.path,
      status: c.status,
      message: c.message,
      lastScanAt: c.lastScanAt,
      baselineOnly: c.snapshot === void 0,
      counts: l,
      notFound: d,
      tombstones: k,
      heuristicCount: x.filter((n) => n.basis === "heuristic").length,
      unavailable: (c.report?.unavailable ?? []).map((n) => n.source)
    };
  }), totals: t, notFound: o };
}
const se = {
  alive: "ok",
  dying: "warn",
  dead: "err",
  ghost: "muted",
  zombie: "err"
}, ne = `
.necro-fade { animation: necro-in .35s ease-out both; }
@keyframes necro-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .necro-fade { animation: none; } }
.necro-btn { border: 1px solid var(--border, #444); border-radius: 9999px; padding: 4px 12px; font-size: 12px;
  background: transparent; color: inherit; cursor: pointer; }
.necro-btn:hover:not(:disabled) { background: var(--bg-hover, rgba(127,127,127,.15)); }
.necro-btn:disabled { opacity: .5; cursor: default; }
.necro-btn:focus-visible, .necro-head:focus-visible { outline: 2px solid var(--accent, #7c3aed); outline-offset: 2px; }
.necro-head { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: block; }
`;
function M({ verdict: e }) {
  const t = T[e];
  return /* @__PURE__ */ i(v, { variant: se[e], title: `Verdict: ${t.label}`, children: [
    /* @__PURE__ */ s("span", { "aria-hidden": "true", children: t.symbol }),
    /* @__PURE__ */ s("span", { children: t.label })
  ] });
}
const ae = {
  hard: "Hard signal: a fact from a source (deprecated, archived, advisory, yanked or gone).",
  heuristic: "Heuristic: a guess from staleness (an old release or a quiet repository), not a hard signal."
};
function oe({ basis: e }) {
  return /* @__PURE__ */ i("p", { className: "text-xs text-muted mt-1 flex flex-wrap items-center gap-1.5", "data-testid": `basis-${e}`, children: [
    e === "heuristic" && /* @__PURE__ */ s(v, { variant: "muted", children: "Heuristic" }),
    /* @__PURE__ */ s("span", { children: ae[e] })
  ] });
}
function re(e) {
  if (!e) return "never scanned";
  const t = new Date(e);
  return Number.isNaN(t.getTime()) ? "unknown time" : t.toLocaleString();
}
function ie(e) {
  return e.slice(0, 3).map((o) => o.also.length > 0 ? `${o.id} (also ${o.also.slice(0, 4).join(", ")}${o.also.length > 4 ? ", ..." : ""})` : o.id).join("; ") + (e.length > 3 ? `; and ${e.length - 3} more` : "");
}
function ce({
  t: e,
  onRaise: t
}) {
  return /* @__PURE__ */ i("li", { className: "necro-fade py-3 border-t border-border first:border-t-0", "data-testid": "tombstone", "data-kind": e.kind, children: [
    /* @__PURE__ */ i("div", { className: "flex flex-wrap items-center gap-2", children: [
      e.kind === "not-found" ? /* @__PURE__ */ i(v, { variant: "warn", title: "The registry does not know this package", children: [
        /* @__PURE__ */ s("span", { "aria-hidden": "true", children: "?" }),
        /* @__PURE__ */ s("span", { children: "Not found" })
      ] }) : /* @__PURE__ */ s(M, { verdict: e.verdict }),
      e.upgrade && /* @__PURE__ */ i(v, { variant: "aim", title: "The version in use is deprecated or yanked; the package itself is maintained", children: [
        /* @__PURE__ */ s("span", { "aria-hidden": "true", children: "↑" }),
        /* @__PURE__ */ s("span", { children: "Upgrade" })
      ] }),
      /* @__PURE__ */ s("span", { className: "font-mono text-sm font-semibold", children: e.name }),
      e.spec && /* @__PURE__ */ s("span", { className: "font-mono text-xs text-muted", children: e.spec }),
      /* @__PURE__ */ s("span", { className: "text-xs text-muted", children: e.ecosystem }),
      /* @__PURE__ */ s("span", { className: "flex-1" }),
      e.kind === "verdict" && /* @__PURE__ */ s(
        "button",
        {
          type: "button",
          className: "necro-btn",
          onClick: () => t(e),
          "aria-label": `Raise the dead: ${e.name}. Opens a chat draft with the Necromancer agent.`,
          children: "Raise the dead"
        }
      )
    ] }),
    /* @__PURE__ */ i("p", { className: "text-sm mt-1.5 italic", children: [
      "“",
      e.epitaph,
      "”"
    ] }),
    e.kind === "not-found" && /* @__PURE__ */ s("p", { className: "text-xs text-muted mt-1", "data-testid": "not-found-note", children: "Nothing to migrate: check the name, or whether the package is private. It is not counted as alive." }),
    e.upgrade && /* @__PURE__ */ i("p", { className: "text-xs text-muted mt-1", "data-testid": "upgrade-note", children: [
      "The version in use is ",
      e.upgrade.kind,
      "; the package is still maintained. ",
      e.upgrade.text,
      " Nothing to migrate."
    ] }),
    e.basis && /* @__PURE__ */ s(oe, { basis: e.basis }),
    e.moved && /* @__PURE__ */ i("p", { className: "text-xs text-muted mt-1", "data-testid": "moved-note", children: [
      "Repository moved: ",
      e.moved
    ] }),
    e.advisoryList.length > 0 && /* @__PURE__ */ i("p", { className: "text-xs text-muted mt-1", "data-testid": "advisories", children: [
      "Known ",
      e.advisoryList.length === 1 ? "vulnerability" : "vulnerabilities",
      ": ",
      ie(e.advisoryList)
    ] }),
    e.kind === "verdict" && (e.successor ? /* @__PURE__ */ i("p", { className: "text-xs text-muted mt-1", "data-testid": e.suggestion ? "successor-suggestion" : "successor", children: [
      e.suggestion ? /* @__PURE__ */ i($, { children: [
        /* @__PURE__ */ s(v, { variant: "aim", children: "Suggestion" }),
        " "
      ] }) : "Way out: ",
      /* @__PURE__ */ s("span", { className: "font-mono", children: e.successor.name }),
      " (",
      e.successor.kind,
      "). ",
      e.successor.reason,
      e.suggestion && ` ${e.successorAdvice ?? ""}`
    ] }) : /* @__PURE__ */ s("p", { className: "text-xs text-muted mt-1", children: "No successor is known." }))
  ] });
}
function de({
  p: e,
  startOpen: t,
  onRaise: o
}) {
  const [a, c] = N(t), l = `necro-panel-${e.id}`;
  return /* @__PURE__ */ i(_, { className: "mb-3", "data-testid": "project", children: [
    /* @__PURE__ */ i(
      "button",
      {
        type: "button",
        className: "necro-head",
        "aria-expanded": a,
        "aria-controls": l,
        onClick: () => c(!a),
        children: [
          /* @__PURE__ */ i("div", { className: "flex flex-wrap items-center gap-2", children: [
            /* @__PURE__ */ s("span", { "aria-hidden": "true", children: a ? "▾" : "▸" }),
            /* @__PURE__ */ s(H, { className: "font-mono !m-0 break-all", children: e.path }),
            /* @__PURE__ */ s("span", { className: "flex-1" }),
            A.filter((r) => e.counts[r] > 0).map((r) => /* @__PURE__ */ i("span", { className: "inline-flex items-center gap-1", children: [
              /* @__PURE__ */ s(M, { verdict: r }),
              /* @__PURE__ */ s("span", { className: "font-mono text-xs", "aria-label": `${e.counts[r]} ${r}`, children: e.counts[r] })
            ] }, r)),
            e.notFound > 0 && /* @__PURE__ */ i("span", { className: "inline-flex items-center gap-1", "data-testid": "project-not-found", children: [
              /* @__PURE__ */ i(v, { variant: "warn", children: [
                /* @__PURE__ */ s("span", { "aria-hidden": "true", children: "?" }),
                /* @__PURE__ */ s("span", { children: "Not found" })
              ] }),
              /* @__PURE__ */ s("span", { className: "font-mono text-xs", "aria-label": `${e.notFound} not found`, children: e.notFound })
            ] })
          ] }),
          /* @__PURE__ */ i("div", { className: "text-xs text-muted mt-1", children: [
            "Last scan: ",
            re(e.lastScanAt),
            e.baselineOnly && e.status === "ok" ? " · waiting for the first Night Watch run" : ""
          ] })
        ]
      }
    ),
    /* @__PURE__ */ i("div", { id: l, hidden: !a, children: [
      e.status !== "ok" && /* @__PURE__ */ i("p", { className: "text-sm mt-2", role: "status", children: [
        /* @__PURE__ */ s(v, { variant: "warn", children: e.status === "missing" ? "Missing" : "Error" }),
        " ",
        e.message ?? "This project could not be scanned."
      ] }),
      e.unavailable.length > 0 && /* @__PURE__ */ i("p", { className: "text-xs text-muted mt-2", role: "status", children: [
        "Partial scan: could not reach ",
        e.unavailable.join(", "),
        ". Verdicts may be milder than the truth."
      ] }),
      e.tombstones.length === 0 ? /* @__PURE__ */ i("p", { className: "text-sm mt-2", children: [
        /* @__PURE__ */ s("span", { "aria-hidden": "true", children: "✓ " }),
        "No dead dependencies here."
      ] }) : /* @__PURE__ */ s("ul", { className: "mt-2 list-none p-0", children: e.tombstones.map((r) => /* @__PURE__ */ s(ce, { t: r, onRaise: (d) => o(e, d) }, r.key)) })
    ] })
  ] });
}
function le({ graveyard: e, demo: t, loading: o, error: a, onRaise: c, onAskToWatch: l }) {
  return /* @__PURE__ */ i("div", { className: "px-4 md:px-6 pb-8 overflow-y-auto flex-1 min-h-0", children: [
    /* @__PURE__ */ s("style", { children: ne }),
    /* @__PURE__ */ i($, { children: [
      a && /* @__PURE__ */ i("div", { role: "alert", className: "mb-3 p-3 rounded border border-border text-sm", "data-testid": "error", children: [
        "Could not load your graveyard: ",
        a,
        ". Showing the demo graveyard below."
      ] }),
      t && /* @__PURE__ */ i("div", { className: "mb-3 p-3 rounded border border-border text-sm", role: "note", "data-testid": "demo-banner", children: [
        /* @__PURE__ */ s("strong", { children: "Demo data." }),
        " ",
        a ? "" : "Nothing is watched yet. ",
        "These projects are examples, not yours. Ask the Necromancer agent to watch a project and Night Watch will fill this page.",
        " ",
        /* @__PURE__ */ s("button", { type: "button", className: "necro-btn ml-1", onClick: l, children: "Ask the Necromancer to watch a project" })
      ] })
    ] }),
    /* @__PURE__ */ i(
      "div",
      {
        className: "grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(130px,1fr))] mb-6",
        role: "group",
        "aria-label": "Totals by verdict",
        children: [
          A.map((d) => /* @__PURE__ */ s(
            R,
            {
              label: `${T[d].symbol} ${T[d].label}`,
              value: o ? "…" : e.totals[d],
              accent: d === "zombie" || d === "dead"
            },
            d
          )),
          /* @__PURE__ */ s(R, { label: "? Not found", value: o ? "…" : e.notFound })
        ]
      }
    ),
    /* @__PURE__ */ i("p", { className: "text-xs text-muted mb-4", "data-testid": "basis-legend", children: [
      "Each verdict says what it rests on. A ",
      /* @__PURE__ */ s("strong", { children: "hard signal" }),
      " is a fact from a source. A ",
      /* @__PURE__ */ s("strong", { children: "heuristic" }),
      " is a guess from staleness and is labelled; treat it as a hint to look, not as proof.",
      e.projects.some((d) => d.heuristicCount > 0) && ` ${e.projects.reduce((d, m) => d + m.heuristicCount, 0)} of the verdicts below are heuristic.`
    ] }),
    e.projects.map((d, m) => /* @__PURE__ */ s(de, { p: d, startOpen: m === 0, onRaise: c }, d.id))
  ] });
}
const ue = "/apps/necromancer/api/graveyard", L = "necromancer", me = 6e4;
function ge() {
  const e = z(), { active: t } = G(), { openChat: o } = P(), [a, c] = N(null), [l, r] = N(null), [d, m] = N(!0), [f, x] = N(!1), w = W(e);
  w.current = e;
  const g = q(async () => {
    try {
      const u = await w.current.get(ue);
      c(u.state), r(u.problem);
    } catch (u) {
      c(null), r(u.message || "the app backend did not answer");
    } finally {
      m(!1), x(!1);
    }
  }, []);
  B(() => {
    if (g(), t === !1) return;
    const u = setInterval(() => {
      g();
    }, me);
    return () => clearInterval(u);
  }, [g, t]);
  const k = a !== null && Object.keys(a.projects).length > 0, n = !d && !k, p = U(() => te(k && a ? a : Y()), [k, a]);
  return /* @__PURE__ */ i($, { children: [
    /* @__PURE__ */ s(
      V,
      {
        title: "Graveyard",
        subtitle: "Dead dependencies in the projects Night Watch guards.",
        actions: /* @__PURE__ */ s(
          "button",
          {
            type: "button",
            className: "necro-btn",
            disabled: f,
            onClick: () => {
              x(!0), g();
            },
            children: f ? "Refreshing…" : "Refresh"
          }
        )
      }
    ),
    /* @__PURE__ */ s(
      le,
      {
        graveyard: p,
        demo: n,
        loading: d,
        error: l,
        onAskToWatch: () => (
          // An unsent draft: the user reads it, adds the path and sends it.
          o({
            agent: L,
            autoSend: !1,
            message: "Watch this project with Night Watch: /absolute/path/to/your/project"
          })
        ),
        onRaise: (u, C) => o({
          agent: L,
          autoSend: !1,
          message: `Raise the dead: in ${u.path}, ${C.name} is ${C.verdict}. Use the resurrection skill to write the Kiro spec and the differential test, migrate on a local branch, and do not push.`
        })
      }
    )
  ] });
}
export {
  L as AGENT,
  ue as GRAVEYARD_PATH,
  ge as default
};
