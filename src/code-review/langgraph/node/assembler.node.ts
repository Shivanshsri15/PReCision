import type { DomainKey, DomainReport, Finding, GraphState } from "../state.js";

export const assemblerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const domainReports = state.domainReports ?? {};

  const domains: DomainKey[] = ["quality", "security", "performance", "bugDetection"];
  const reports: Partial<Record<DomainKey, DomainReport>> = {};

  for (const d of domains) {
    const r = domainReports[d];
    if (r) {
      reports[d] = r;
    }
  }

  const allFindings: Finding[] = [];
  for (const d of domains) {
    const r = reports[d];
    if (r?.findings?.length) {
      allFindings.push(...r.findings);
    }
  }

  const dedupedMap = new Map<string, Finding>();
  for (const f of allFindings) {
    const key = `${f.file}::${f.issue}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, f);
    }
  }
  const dedupedFindings = Array.from(dedupedMap.values());

  const severityCounts = dedupedFindings.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 } as Record<"low" | "medium" | "high", number>,
  );

  const domainCounts = domains.reduce(
    (acc, d) => {
      acc[d] = reports[d]?.findings?.length ?? 0;
      return acc;
    },
    {} as Record<DomainKey, number>,
  );

  const overallSummary =
    `Found ${dedupedFindings.length} issues ` +
    `(high: ${severityCounts.high}, medium: ${severityCounts.medium}, low: ${severityCounts.low}).`;

  return {
    finalReport: {
      prId: state.input.prId,
      overallSummary,
      domainReports: reports,
      allFindings: dedupedFindings,
      counts: {
        severity: severityCounts,
        domain: domainCounts,
      },
      extraPromptApplied: state.input.extraPrompt ?? "",
      bugDetectionPromptAddendum: state.bugDetectionPromptAddendum ?? "",
    },
  };
};