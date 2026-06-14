import ts from 'typescript';
import type { FileChunk } from '../types/chunk.types.js';
import { capChunkText, chunkByLineWindow, chunkTextToLineRange } from './chunk-utils.js';
import { getLanguageForExtension, isTypeScriptOrJavaScript } from './language-map.js';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

function parseSourceFile(filePath: string, content: string): ts.SourceFile {
  const scriptKind = filePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : filePath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : filePath.endsWith('.js')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
}

function sliceNode(sourceFile: ts.SourceFile, node: ts.Node, path: string): FileChunk {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const text = capChunkText(sourceFile.text.slice(start, end));
  const startPos = sourceFile.getLineAndCharacterOfPosition(start);
  const endPos = sourceFile.getLineAndCharacterOfPosition(end);

  return {
    path,
    startLine: startPos.line + 1,
    endLine: endPos.line + 1,
    text,
  };
}

function chunkWithTypescriptAst(path: string, content: string): FileChunk[] {
  const sourceFile = parseSourceFile(path, content);
  const chunks: FileChunk[] = [];
  let importNodes: ts.Node[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      importNodes.push(node);
      ts.forEachChild(node, visit);
      return;
    }

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      if (node.name || ts.isFunctionDeclaration(node)) {
        chunks.push(sliceNode(sourceFile, node, path));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (chunks.length === 0) {
    return chunkByLineWindow(path, content);
  }

  if (importNodes.length > 0) {
    const firstImport = importNodes[0]!.getStart(sourceFile);
    const lastImport = importNodes[importNodes.length - 1]!.getEnd();
    const importText = capChunkText(sourceFile.text.slice(firstImport, lastImport));
    const firstChunk = chunks[0]!;
    chunks[0] = {
      ...firstChunk,
      text: capChunkText(`${importText}\n\n${firstChunk.text}`),
      startLine: Math.min(
        sourceFile.getLineAndCharacterOfPosition(firstImport).line + 1,
        firstChunk.startLine,
      ),
    };
  }

  return chunks;
}

async function chunkWithLangChain(path: string, content: string): Promise<FileChunk[]> {
  const lang = getLanguageForExtension(path);
  if (!lang) {
    return chunkByLineWindow(path, content);
  }

  const splitter = RecursiveCharacterTextSplitter.fromLanguage(lang, {
    chunkSize: 2000,
    chunkOverlap: 200,
  });

  const texts = await splitter.splitText(content);
  return texts.map((text) => {
    const capped = capChunkText(text);
    const { startLine, endLine } = chunkTextToLineRange(content, text);
    return { path, startLine, endLine, text: capped };
  });
}

export async function chunkFile(path: string, content: string): Promise<FileChunk[]> {
  if (!content.trim()) {
    return [];
  }

  try {
    if (isTypeScriptOrJavaScript(path)) {
      return chunkWithTypescriptAst(path, content);
    }

    const lang = getLanguageForExtension(path);
    if (lang) {
      return chunkWithLangChain(path, content);
    }

    return chunkByLineWindow(path, content);
  } catch {
    return chunkByLineWindow(path, content);
  }
}
