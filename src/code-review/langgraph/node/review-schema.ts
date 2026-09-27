import type { DomainKey } from '../state.js';

const DOMAIN_SCOPE: Record<DomainKey, string> = {
  security:
    'injection (SQL/NoSQL/command/path), hardcoded secrets, secret exposure, missing authentication/authorization, open redirects, SSRF, missing validation of untrusted input',
  performance:
    'N+1 queries, algorithmic complexity, blocking I/O on request paths, unbounded queries, excessive memory use',
  bugDetection:
    'logic errors, wrong operators, null/undefined dereferences, off-by-one errors, race conditions, unhandled errors',
  quality: 'naming, dead code, duplicated logic, API design, maintainability',
};

export function buildReviewRules(domain: DomainKey): string {
  const others = (Object.keys(DOMAIN_SCOPE) as DomainKey[])
    .filter((d) => d !== domain)
    .map((d) => `${d}: ${DOMAIN_SCOPE[d]}`)
    .join('\n  ');

  return `
Rules:
- Report only defects on lines marked "+" in CHANGED HUNKS. BASE (the old file) and RELATED CODEBASE CONTEXT are for understanding only; never report issues that already existed in BASE.
- "file" must be one of the FILES shown; "line" must be the "+" line number where the defect is.
- Your scope: ${DOMAIN_SCOPE[domain]}.
- Other reviewers own these; do not report them:
  ${others}
- One finding per distinct defect. If the same defect spans several lines or routes, report it once and mention the others in the suggestion.
- Zero findings is a valid answer. Never pad. Max 5 findings, highest severity first.
- Review as if shipping to production. Do not comment on the PR's purpose, its test/lab nature, or whether it should be merged.
`;
}

export const FINDING_SCHEMA = `Return ONLY this JSON structure:
{
  "rating": 1,
  "summary": "string",
  "weakAreas": ["string"],
  "findings": [
    {
      "file": "string",
      "line": 1,
      "issue": "string",
      "severity": "low | medium | high",
      "suggestion": "string"
    }
  ]
}
If there are no real defects in your scope, return "findings": [].`;
