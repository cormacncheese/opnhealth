// Supervisor: keeps the pipelines within budget and stops them when their
// output looks unreliable. Rule-based on purpose: the thing that can pause
// the agents should not itself depend on a model.

export const SUPERVISOR_VERSION = "supervisor@1";

export interface PipelineHealth {
  pipeline: string;
  paused: boolean;
  pausedReason: string | null;
  dailyBudgetUsd: number;
  spentTodayUsd: number;
}

export interface QualitySignals {
  /** Latest eval run recorded by CI, if any. */
  latestEvalPassed: boolean | null;
  /** Agent publish decisions over the window. */
  agentPublishes: number;
  /** Of those, later withdrawn after a dispute or maintainer review. */
  publishesOverturned: number;
  /** Runs over the window, and how many failed. */
  runs: number;
  runsFailed: number;
}

export interface SupervisorAction {
  pipeline: string;
  action: "pause" | "resume";
  reason: string;
}

/** Reasons the supervisor sets itself, and may therefore lift itself. */
export const AUTO_REASONS = {
  budget: "daily_budget_reached",
  evals: "eval_regression",
  overturned: "publish_decisions_overturned",
  failures: "run_failure_rate",
} as const;

const MIN_SAMPLE = 20;
const MAX_OVERTURN_RATE = 0.1;
const MAX_FAILURE_RATE = 0.5;

function qualityProblem(q: QualitySignals): string | null {
  if (q.latestEvalPassed === false) return AUTO_REASONS.evals;
  if (q.agentPublishes >= MIN_SAMPLE && q.publishesOverturned / q.agentPublishes > MAX_OVERTURN_RATE) {
    return AUTO_REASONS.overturned;
  }
  if (q.runs >= MIN_SAMPLE && q.runsFailed / q.runs > MAX_FAILURE_RATE) return AUTO_REASONS.failures;
  return null;
}

/**
 * Decides which pipelines to pause or resume. Quality signals describe the
 * COA pipeline only; budgets apply to each pipeline separately. A pause set
 * by a maintainer (any other reason) is never lifted here.
 */
export function planSupervision(
  pipelines: PipelineHealth[],
  quality: QualitySignals,
): SupervisorAction[] {
  const actions: SupervisorAction[] = [];
  const auto = new Set<string>(Object.values(AUTO_REASONS));

  for (const p of pipelines) {
    const overBudget = p.spentTodayUsd >= p.dailyBudgetUsd;
    const problem =
      (p.pipeline === "coa" ? qualityProblem(quality) : null) ??
      (overBudget ? AUTO_REASONS.budget : null);

    if (problem && !p.paused) {
      actions.push({ pipeline: p.pipeline, action: "pause", reason: problem });
    } else if (!problem && p.paused && p.pausedReason !== null && auto.has(p.pausedReason)) {
      actions.push({ pipeline: p.pipeline, action: "resume", reason: `${p.pausedReason}_cleared` });
    }
  }
  return actions;
}

/** Errors worth one more automatic try after the normal retries ran out. */
export function isTransientError(message: string): boolean {
  return /timeout|timed out|rate.?limit|429|502|503|504|overloaded|ECONNRESET|fetch failed|network/i.test(
    message,
  );
}
