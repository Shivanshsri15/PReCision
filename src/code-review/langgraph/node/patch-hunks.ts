const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Renders a unified diff with new-file line numbers so the model can anchor
 * findings to the exact changed line. `commentableLines` are the new-file
 * lines GitHub accepts inline review comments on (added + context lines).
 */
export function parsePatchHunks(patch: string): {
  rendered: string;
  commentableLines: Set<number>;
} {
  const out: string[] = [];
  const commentableLines = new Set<number>();
  let newLine = 0;
  let inHunk = false;

  for (const raw of patch.split(/\r?\n/)) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      newLine = Number(header[1]);
      inHunk = true;
      out.push(raw);
      continue;
    }
    if (!inHunk || raw.startsWith('\\')) {
      continue;
    }

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === '-') {
      out.push(`      - ${text}`);
      continue;
    }

    commentableLines.add(newLine);
    out.push(`${String(newLine).padStart(5)} ${marker === '+' ? '+' : ' '} ${text}`);
    newLine += 1;
  }

  return { rendered: out.join('\n'), commentableLines };
}
