import type { DomainKey, DomainReport, Finding, GraphState } from '../state.js';
import { parsePatchHunks } from './patch-hunks.js';

const LOG_PREFIX = '[code-review]';

export function buildFilesPromptSection(state: GraphState): string {
  return (
    state.cleanedInput?.files
      ?.map((file) => {
        const base = file.baseContent
          ? `\n\nBASE (complete old file before this PR, context only):\n${file.baseContent}`
          : '\n\nBASE: none (new file)';
        const diff = file.patch?.trim()
          ? `CHANGED HUNKS (report only on lines marked +):\n${parsePatchHunks(file.patch).rendered}`
          : 'CHANGED HUNKS: no diff available';
        return `\nFILE: ${file.filename}\n\n${diff}${base}\n`;
      })
      .join('\n------------------\n') ?? ''
  );
}

export function buildRelatedContextBlock(state: GraphState): string {
  const formatted = state.relatedContextFormatted?.trim();
  if (!formatted) {
    return '';
  }

  return `\n${formatted}\n\nRelated context is for understanding cross-file impact only. Never report findings on these files; report the defect on the changed line in FILES that causes it.\n`;
}

export function logDomainComplete(domain: DomainKey, report: DomainReport): void {
  console.log(
    `${LOG_PREFIX} ${domain} review complete: rating=${report.rating} findings=${report.findings.length}`,
  );
}

export function extractModelTextContent(response: any): string {
  return typeof response?.content === "string"
    ? response.content
    : Array.isArray(response?.content)
      ? response.content.map((c: any) => c.text ?? "").join("")
      : "";
}

export function parseStrictJson<T>(rawText: string, fallback: T, label = 'review'): T {
  const cleaned = String(rawText)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    console.warn(
      `${LOG_PREFIX} ${label}: failed to parse model JSON (${(error as Error).message}); using fallback. ` +
        `raw[0..200]=${JSON.stringify(cleaned.slice(0, 200))}`,
    );
    return fallback;
  }
}

export function coerceFindings(input: unknown): Finding[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x: any): Finding => {
      const line = Number(x?.line);
      return {
        file: typeof x?.file === "string" ? x.file : "",
        issue: typeof x?.issue === "string" ? x.issue : "",
        severity:
          x?.severity === "low" || x?.severity === "medium" || x?.severity === "high"
            ? x.severity
            : "low",
        suggestion: typeof x?.suggestion === "string" ? x.suggestion : undefined,
        line: Number.isInteger(line) && line > 0 ? line : undefined,
      };
    })
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
