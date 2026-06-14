export function chunkTextToLineRange(
  content: string,
  chunkText: string,
): { startLine: number; endLine: number } {
  const index = content.indexOf(chunkText);
  if (index === -1) {
    return { startLine: 1, endLine: 1 };
  }

  const before = content.slice(0, index);
  const startLine = before.split('\n').length;
  const endLine = startLine + chunkText.split('\n').length - 1;
  return { startLine, endLine };
}

export function capChunkText(text: string, maxChars = 3000): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

export function chunkByLineWindow(
  path: string,
  content: string,
  windowSize = 80,
  overlap = 20,
) {
  const lines = content.split('\n');
  const chunks: Array<{
    path: string;
    startLine: number;
    endLine: number;
    text: string;
  }> = [];

  if (lines.length === 0) {
    return chunks;
  }

  const step = Math.max(1, windowSize - overlap);
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + windowSize);
    const text = capChunkText(lines.slice(start, end).join('\n'));
    chunks.push({
      path,
      startLine: start + 1,
      endLine: end,
      text,
    });
    if (end >= lines.length) {
      break;
    }
  }

  return chunks;
}
