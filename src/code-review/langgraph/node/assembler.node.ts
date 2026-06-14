import {
  DOMAIN_KEYS,
  type DomainKey,
  type DomainReport,
  type Finding,
  type GraphState,
} from '../state.js';

const LOG_PREFIX = '[code-review]';

export const assemblerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const domainReports = state.domainReports ?? {};
  const reports: Partial<Record<DomainKey, DomainReport>> = {};

  for (const domain of DOMAIN_KEYS) {
    const report = domainReports[domain];
    if (report) {
      reports[domain] = report;
    }
  }

  const allFindings: Finding[] = [];
  for (const domain of DOMAIN_KEYS) {
    const report = reports[domain];
    if (report?.findings?.length) {
      allFindings.push(...report.findings);
    }
  }

  const dedupedMap = new Map<string, Finding>();
  for (const finding of allFindings) {
    const key = `${finding.file}::${finding.issue}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, finding);
    }
  }
  const dedupedFindings = Array.from(dedupedMap.values());

  const severityCounts = dedupedFindings.reduce(
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
    `Found ${dedupedFindings.length} issues ` +
    `(high: ${severityCounts.high}, medium: ${severityCounts.medium}, low: ${severityCounts.low}).`;

  console.log(
    `${LOG_PREFIX} assembler node: PR #${state.input.prId} ` +
      `findings=${dedupedFindings.length} domains=${JSON.stringify(domainCounts)}`,
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
      allFindings: dedupedFindings,
      findings: dedupedFindings,
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
