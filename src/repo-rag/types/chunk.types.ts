export interface FileChunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface RetrievedChunk extends FileChunk {
  source: string;
}

export interface VectorDocument {
  repoId: string;
  branch: string;
  path: string;
  blobSha: string;
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[];
}
