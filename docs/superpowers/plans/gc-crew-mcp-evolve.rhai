// GC Crew MCP Evolve — durable phase workflow for SDD domains A/B/C
// Repo path: docs/superpowers/plans/gc-crew-mcp-evolve.rhai
// Preferred install path: ~/.grok/workflows/ (currently root-owned — sudo cp; see GC_CREW_MCP_EVOLVE_RUNBOOK.md)
// Uses x402-aware evolve path; no live fund movement in default dry-run

let meta = #{
    name: "gc-crew-mcp-evolve",
    description: "Sense ambient health, validate MCP trust + crew topology, dry-run evolve_hook metrics, check runbooks",
    when_to_use: "After gc-crew-mcp-bridge changes or when re-validating the three evolve domains",
    phases: [
        #{ title: "Sense", detail: "ambient + retrainer health" },
        #{ title: "TrustScan", detail: "is_trusted_url + allowlists" },
        #{ title: "TopologyValidate", detail: "roster domains non-conflicting" },
        #{ title: "MetricsDryRun", detail: "evolve_hook mock transport" },
        #{ title: "RunbookCheck", detail: "Revenue + Launch + Incomplete Goals pointers" },
    ],
    agent_budget: 16,
};

fn sense() {
    agent(#{
        prompt: "Read-only: curl -sS -m 10 https://optimization-inversion.genesisconductor.io/health and report ok/fail. Do not pay x402. Return JSON {ok,url,status}.",
        description: "Sense ambient health",
    })
}

fn trust_scan() {
    agent(#{
        prompt: "In worktree /Users/igorholt/.worktrees/feat-gc-crew-mcp-evolve/gc-workers/gc-crew-mcp-bridge if present, run unit tests for trust. Else report missing package. No network tool installs.",
        description: "Trust unit scan",
    })
}

fn topology_validate() {
    agent(#{
        prompt: "Validate crew_topology roster has unique domains RESEARCH/PAYMENT/OPS/EVOLVE and no blocked tools in allowed_tools. Report validate_roster().",
        description: "Topology validate",
    })
}

fn metrics_dry_run() {
    agent(#{
        prompt: "Dry-run evolve_hook.submit_metrics with mock transport returning 402 then 200. Assert payment_required and ok. No real USDC payment.",
        description: "Metrics dry run",
    })
}

fn runbook_check() {
    agent(#{
        prompt: "Confirm docs exist: docs/superpowers/plans/GC_CREW_MCP_EVOLVE_RUNBOOK.md, INCOMPLETE_GOALS_RUNBOOK.md; note REVENUE_RUNBOOK + LAUNCH_PLAN paths under gc-workers (facilitator mode=cdp prerequisite for real pay). Summarize no-fund-move rule. Note sudo cp of gc-crew-mcp-evolve.rhai into ~/.grok/workflows/.",
        description: "Runbook check",
    })
}

let s = sense();
let t = trust_scan();
let top = topology_validate();
let m = metrics_dry_run();
let r = runbook_check();

#{ sense: s, trust: t, topology: top, metrics: m, runbook: r }
