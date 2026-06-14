import ts from 'typescript';
import { isTypeScriptOrJavaScript } from './language-map.js';

const REGEX_SYMBOL_PATTERNS = [
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
  /class\s+(\w+)/g,
  /(?:export\s+)?(?:const|let|var)\s+([A-Z]\w+)\s*=/g,
];

function isModuleLevel(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isSourceFile(parent)) {
    return true;
  }
  return ts.isModuleBlock(parent) && ts.isModuleDeclaration(parent.parent);
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function isUsefulSymbol(name: string): boolean {
  if (name.length < 3) {
    return false;
  }
  if (/^[A-Z]/.test(name)) {
    return true;
  }
  return /^[a-z]+[A-Z]/.test(name) && name.length >= 5;
}

export function extractSymbols(path: string, content: string, max = 12): string[] {
  const symbols = new Set<string>();

  if (isTypeScriptOrJavaScript(path)) {
    try {
      const scriptKind = path.endsWith('.tsx')
        ? ts.ScriptKind.TSX
        : path.endsWith('.jsx')
          ? ts.ScriptKind.JSX
          : path.endsWith('.js')
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;
      const sourceFile = ts.createSourceFile(
        path,
        content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind,
      );

      const visit = (node: ts.Node) => {
        if (
          (ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isEnumDeclaration(node)) &&
          node.name &&
          ts.isIdentifier(node.name) &&
          (isModuleLevel(node) || hasExportModifier(node))
        ) {
          symbols.add(node.name.text);
        }

        if (
          ts.isMethodDeclaration(node) &&
          node.name &&
          ts.isIdentifier(node.name) &&
          hasExportModifier(node.parent)
        ) {
          symbols.add(node.name.text);
        }

        if (ts.isVariableStatement(node) && hasExportModifier(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && /^[A-Z]/.test(decl.name.text)) {
              symbols.add(decl.name.text);
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch {
      // fall through to regex
    }
  }

  if (symbols.size < max && !isTypeScriptOrJavaScript(path)) {
    for (const pattern of REGEX_SYMBOL_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1] && isUsefulSymbol(match[1])) {
          symbols.add(match[1]);
        }
        if (symbols.size >= max) {
          break;
        }
      }
    }
  }

  return Array.from(symbols).filter(isUsefulSymbol).slice(0, max);
}

const IMPORT_PATTERN =
  /(?:import\s+(?:[\w*\s{},$]+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

export function extractImportPaths(content: string): string[] {
  const imports = new Set<string>();
  IMPORT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    const value = match[1] ?? match[2];
    if (value) {
      imports.add(value);
    }
  }

  return Array.from(imports);
}

export function resolveImportCandidates(
  importPath: string,
  fromFile: string,
): string[] {
  if (!importPath.startsWith('.')) {
    return [];
  }

  const fromDir = fromFile.replace(/\\/g, '/').split('/').slice(0, -1);
  const parts = importPath.split('/');

  for (const part of parts) {
    if (part === '.') {
      continue;
    }
    if (part === '..') {
      fromDir.pop();
    } else {
      fromDir.push(part);
    }
  }

  const base = fromDir.join('/');
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ];
}
