import { Annotation } from "@langchain/langgraph";

export interface PRFile {
  filename: string;
  patch?: string;
  content?: string;
}

export interface PRAnalysisPayload {
  prId: number;
  title: string;
  description?: string;
  files: PRFile[];
}

export interface Finding {
  file: string;
  issue: string;
  severity: "low" | "medium" | "high";
  suggestion?: string;
}

export const GraphAnnotation = Annotation.Root({
  input: Annotation<PRAnalysisPayload>(),
  cleanedInput: Annotation<PRAnalysisPayload | undefined>(),
  findings: Annotation<Finding[] | undefined>(),
  finalReport: Annotation<any | undefined>(),
});

export type GraphState = typeof GraphAnnotation.State;