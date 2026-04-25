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
  extraPrompt?: string;
}

export interface Finding {
  file: string;
  issue: string;
  severity: "low" | "medium" | "high";
  suggestion?: string;
}

export type DomainKey = "quality" | "security" | "performance" | "bugDetection";

export type DomainReport = {
  domain: DomainKey;
  rating: 1 | 2 | 3 | 4 | 5;
  summary: string;
  weakAreas?: string[];
  findings: Finding[];
};

export const GraphAnnotation = Annotation.Root({
  input: Annotation<PRAnalysisPayload>(),
  cleanedInput: Annotation<PRAnalysisPayload | undefined>(),
  /**
   * Backward-compatible bucket (older pipeline). New pipeline should use domainReports.
   */
  findings: Annotation<Finding[] | undefined>(),

  domainReports: Annotation<Partial<Record<DomainKey, DomainReport>>>({
    reducer: (left, right) => ({ ...(left ?? {}), ...(right ?? {}) }),
    default: () => ({}),
  }),
  bugDetectionPromptAddendum: Annotation<string | undefined>(),
  finalReport: Annotation<any | undefined>(),
});

export type GraphState = typeof GraphAnnotation.State;