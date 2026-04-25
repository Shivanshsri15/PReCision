import type { DomainKey, DomainReport, Finding } from "../state.js";

export function extractModelTextContent(response: any): string {
  return typeof response?.content === "string"
    ? response.content
    : Array.isArray(response?.content)
      ? response.content.map((c: any) => c.text ?? "").join("")
      : "";
}

export function parseStrictJson<T>(rawText: string, fallback: T): T {
  const cleaned = String(rawText)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

export function coerceFindings(input: unknown): Finding[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x: any) => ({
      file: typeof x?.file === "string" ? x.file : "",
      issue: typeof x?.issue === "string" ? x.issue : "",
      severity:
        x?.severity === "low" || x?.severity === "medium" || x?.severity === "high"
          ? x.severity
          : "low",
      suggestion: typeof x?.suggestion === "string" ? x.suggestion : undefined,
    }))
    .filter((f) => f.file && f.issue);
}

export function coerceRating(input: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = typeof input === "number" ? input : Number(input);
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n;
  return 3;
}

export function coerceWeakAreas(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const areas = input
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, 10);
  return areas.length ? areas : undefined;
}

export function buildDomainReport(params: {
  domain: DomainKey;
  parsed: any;
  fallbackSummary: string;
}): DomainReport {
  const summary =
    typeof params.parsed?.summary === "string" && params.parsed.summary.trim()
      ? params.parsed.summary.trim()
      : params.fallbackSummary;

  return {
    domain: params.domain,
    rating: coerceRating(params.parsed?.rating),
    summary,
    weakAreas: coerceWeakAreas(params.parsed?.weakAreas),
    findings: coerceFindings(params.parsed?.findings),
  };
}

