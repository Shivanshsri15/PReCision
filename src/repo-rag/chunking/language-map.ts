import type { SupportedTextSplitterLanguage } from '@langchain/textsplitters';

const EXTENSION_LANGUAGE_MAP: Record<string, SupportedTextSplitterLanguage> = {
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.scala': 'scala',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.md': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.kt': 'java',
};

export function getLanguageForExtension(
  filePath: string,
): SupportedTextSplitterLanguage | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) {
    return undefined;
  }

  const ext = filePath.slice(dot).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext];
}

export function isTypeScriptOrJavaScript(filePath: string): boolean {
  return /\.(tsx?|jsx?)$/i.test(filePath);
}
