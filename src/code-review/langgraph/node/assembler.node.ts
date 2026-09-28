import {
  DOMAIN_KEYS,
  type DomainKey,
  type DomainReport,
  type Finding,
  type GraphState,
} from '../state.js';

const LOG_PREFIX = '[code-review]';

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Bug detection runs alongside the others, so drop its findings on a line (±1) another reviewer already flagged. */
function withoutDuplicateBugs(
  reports: Partial<Record<DomainKey, DomainReport>>,
): Partial<Record<DomainKey, DomainReport>> {
  const bug = reports.bugDetection;
  if (!bug) return reports;

  const flagged = DOMAIN_KEYS.filter(
    (domain) => domain !== 'bugDetection',
  ).flatMap((domain) => reports[domain]?.findings ?? []);
  const isDuplicate = (finding: Finding) =>
    flagged.some(
      (other) =>
        other.file === finding.file &&
        (finding.line === undefined || other.line === undefined
          ? other.issue.toLowerCase() === finding.issue.toLowerCase()
          : Math.abs(other.line - finding.line) <= 1),
    );

  const findings = bug.findings.filter((finding) => !isDuplicate(finding));
  return { ...reports, bugDetection: { ...bug, findings } };
}

export const assemblerNode = (state: GraphState): Partial<GraphState> => {
  const domainReports = state.domainReports ?? {};
  let reports: Partial<Record<DomainKey, DomainReport>> = {};

  for (const domain of DOMAIN_KEYS) {
    const report = domainReports[domain];
    if (report) {
      reports[domain] = report;
    }
  }
  reports = withoutDuplicateBugs(reports);

  const findings: Finding[] = DOMAIN_KEYS.flatMap((domain) =>
    (reports[domain]?.findings ?? []).map((finding) => ({
      ...finding,
      domain,
    })),
  ).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const severityCounts = findings.reduce(
    (acc, finding) => {
      acc[finding.severity] += 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 } as Record<'low' | 'medium' | 'high', number>,
  );

  const domainCounts = DOMAIN_KEYS.reduce(
    (acc, domain) => {
      acc[domain] = reports[domain]?.findings?.length ?? 0;
      return acc;
    },
    {} as Record<DomainKey, number>,
  );

  const overallSummary =
    `Found ${findings.length} issues ` +
    `(high: ${severityCounts.high}, medium: ${severityCounts.medium}, low: ${severityCounts.low}).`;

  console.log(
    `${LOG_PREFIX} assembler node: PR #${state.input.prId} ` +
      `findings=${findings.length} domains=${JSON.stringify(domainCounts)}`,
  );

  const relatedContextCount = state.relatedContext?.length ?? 0;
  const relatedContextPaths =
    state.relatedContext?.slice(0, 12).map((chunk) => chunk.path) ?? [];

  return {
    finalReport: {
      prId: state.input.prId,
      overallSummary,
      summary: overallSummary,
      domainReports: reports,
      findings,
      counts: {
        severity: severityCounts,
        domain: domainCounts,
      },
      extraPromptApplied: state.input.extraPrompt ?? '',
      bugDetectionPromptAddendum: state.bugDetectionPromptAddendum ?? '',
      relatedContextCount,
      relatedContextPaths,
    },
  };
};
