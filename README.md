<div align="center">

# Precision

### Context-aware, agent-driven pull request intelligence.

*Not a linter. Not a prompt wrapper. A stateful AI pipeline that actually understands your code.*

<br/>

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-000000?style=flat-square&logo=langchain&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-8E75B2?style=flat-square&logo=google&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-FF4438?style=flat-square&logo=redis&logoColor=white)

</div>

---

## The Problem

Most AI-based code reviewers operate on raw diffs in isolation. They don't understand what the PR is trying to do, which files depend on each other, or whether the same issue was flagged and ignored three pushes ago.

The result is noise — generic warnings that developers learn to scroll past.

## The Solution

Precision builds a **holistic, structured representation** of every pull request before any AI model is invoked. It enriches raw diffs with surrounding context, commit history, dependency relationships, and historical findings — then routes this through a **LangGraph-powered multi-agent pipeline** where specialized agents reason independently across three domains in parallel, and their outputs are merged, deduplicated, ranked, and mapped back to exact line numbers.

The output is structured, actionable, and context-aware — not noise.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        NestJS Backend                           │
│                                                                 │
│   Auth Module        GitHub Module        Code Review Module    │
│   ─────────────      ──────────────       ─────────────────     │
│   GitHub OAuth       REST API proxy       Pipeline trigger      │
│   JWT sessions       Encrypted tokens     Result persistence     │
│   User identity      Data enrichment      SSE streaming         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LangGraph AI Pipeline                        │
│                                                                 │
│   Input        Wave 0          Wave 1 (parallel)    Wave 2      │
│   ──────   ────────────   ──────────────────────   ─────────── │
│   PR data  inputGuard     qualityReview            joinNode     │
│   & diffs  Sanitize,      securityReview           Barrier +    │
│            prioritize     performanceReview        weak-area    │
│            bundle files   (concurrent fan-out)     shaping      │
│                                                                 │
│   Wave 3              Wave 4                                    │
│   ─────────────────   ──────────────────────────               │
│   bugDetection        assembler                                 │
│   Guided by weak      Merge · dedupe · count                   │
│   area signals        → finalReport JSON                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Role |
|---|---|---|
| **Backend** | NestJS (TypeScript) | Modular, service-oriented API server |
| **AI Pipeline** | LangGraph (TypeScript) | Stateful directed graph execution engine |
| **LLM** | Google Gemini | Structured JSON output via strict prompting |
| **Database** | MongoDB | PR runs, findings, historical data |
| **Cache** | Redis | GitHub API response caching, rate limit optimization |
| **Queue** | BullMQ | Async job processing, retries, exponential backoff |
| **Auth** | GitHub OAuth + JWT | Encrypted token storage, user-scoped access |
| **Streaming** | Server-Sent Events (SSE) | Real-time pipeline progress to the client |

---

## Features

### ✅ Shipped

#### Authentication & Identity
- GitHub OAuth 2.0 integration with encrypted access token storage
- JWT-based session management for all authenticated API routes
- User-scoped GitHub access — every API call uses the authenticated user's token

#### GitHub Integration
- Full GitHub REST API proxy layer
- Fetches PR metadata, changed files, diff patches, file contents at base/head SHAs, commit history, and comparisons
- Proper API versioning and rate-limit-aware request handling

#### AI Review Pipeline (LangGraph)
The core pipeline is modeled as a **stateful directed graph** — not a chain of prompts.

The pipeline fans out into three domain-specific agents running in parallel, then joins into a targeted bug detection pass, then assembles the final output.

```
                        ┌─ qualityReview ────┐
                        │                    │
inputGuard → cleanedInput─ securityReview ───┤→ joinNode → bugDetection → assembler
                        │                    │
                        └─ performanceReview ┘
```

| Node | Responsibility |
|---|---|
| `inputGuard` | Filters, limits, and sanitizes files before any LLM call |
| `qualityReview` | Readability, maintainability, naming, error handling, API consistency |
| `securityReview` | Authn/authz mistakes, injection risks, missing validation, exposed secrets, unsafe redirects |
| `performanceReview` | N+1 patterns, hot-path inefficiencies, complexity regressions, missing caching/pagination |
| `joinNode` | Fan-in barrier — extracts weak-area signals and composes a dynamic prompt addendum for the bug detection pass |
| `bugDetection` | Deep correctness and edge-case analysis, guided by the weak-area signals from the domain reviewers |
| `assembler` | Merges per-domain reports, deduplicates findings, computes severity and domain counts, produces the final report |

Each node has typed inputs and typed outputs. Logic is isolated per node — independently testable, observable, and replaceable without touching the rest of the pipeline.

#### Domain Report Schema

Every domain agent (`qualityReview`, `securityReview`, `performanceReview`, `bugDetection`) returns a strict JSON report — not free-form text:

```ts
{
  rating: number;          // 1–5 overall domain score
  summary: string;         // High-level domain assessment
  weakAreas: string[];     // Specific areas that look fragile or risky
  findings: {
    severity: 'low' | 'medium' | 'high';
    description: string;
    suggestion: string;
  }[];
}
```

Structured enough to store, version, diff across runs, and eventually gate deploys with.

#### Self-Guided Bug Detection

The `joinNode` doesn't just collect results — it reads the weak-area signals from poorly rated domains and reshapes the bug detection prompt accordingly:

- Security is weak → bug detection focuses harder on auth flows, validation, injection-like risks
- Performance is weak → targets hot paths, DB call patterns, hidden regressions
- Quality is weak → goes deeper on confusing logic, error handling gaps, subtle correctness issues

This is the shift from "one prompt fits all" to a pipeline that uses its own earlier reasoning to direct its later reasoning.

#### API-Level Customization

The review endpoint accepts an optional `extraPrompt` in the request body. Rather than injecting it into every domain prompt, it is used to enrich the final output emphasis and can be included as additional context when shaping the bug detection focus.

---

### 🔧 In Progress

#### 1. Cross-File Dependency & Impact Analysis

Building a **bounded dependency graph** to enable cross-file reasoning.

- Import parsing via `ts-morph` (TypeScript) and `tree-sitter` (multi-language)
- Bounded traversal — 1 to 2 levels deep to control cost
- Related file context fed selectively into agents
- Detects API contract violations, ripple effects, and breaking changes invisible in isolated diffs

#### 2. Incremental Delta Intelligence

Tracking PR quality evolution across commits.

- Deterministic fingerprints generated per finding
- Each analysis run persisted with `baseSha` + `headSha`
- Delta computed across runs: `new | resolved | unchanged`
- Stops re-reporting issues that were already addressed
- Surfaces newly introduced regressions and quality trends

---

## Data Flow

### GitHub OAuth

```
User → GET /github/oauth/url
     ← authorizationUrl + state

User → Approve on GitHub
     → GET /github/oauth/callback?code&state

API  → Exchange code for access_token
     → Fetch /user and /user/emails
     → Upsert user + store encrypted GitHub token
     ← app JWT (accessToken)
```

### PR Analysis

```
POST /code-review/:owner/:repo/:prNumber/analyze
     Bearer <app JWT>
          │
          ▼
     CodeReviewController
          │  getPullRequest()
          │  listPullRequestFiles()
          ▼
     Build PRAnalysisPayload
     { prId, title, description, files[], extraPrompt? }
          │
          ▼
     LangGraph graph.invoke({ input })
          │
     ┌────▼──────────────────────────────────────────────────┐
     │  inputGuard                                           │
     │       │                                               │
     │       ├──────────────────────────────────────┐       │
     │       │                  │                   │       │
     │  qualityReview    securityReview    performanceReview │
     │       │                  │                   │       │
     │       └──────────────────┴───────────────────┘       │
     │                          │                           │
     │                       joinNode                       │
     │                    (weak-area shaping)                │
     │                          │                           │
     │                    bugDetection                       │
     │                          │                           │
     │                      assembler                       │
     └──────────────────────────┬────────────────────────────┘
                                ▼
                          finalReport JSON
                  {
                    perDomain: { quality, security, performance, bugDetection },
                    allFindings: [...],        // merged + deduplicated
                    severityCounts: {...},
                    domainCounts: {...},
                    overallSummary: string
                  }
```

---

## Project Structure

```
precision/
├── src/
│   ├── auth/                   # JWT strategy, guards, decorators
│   ├── github/                 # OAuth flow, REST API proxy, token encryption
│   ├── code-review/            # Pipeline trigger, result persistence, SSE
│   │   └── pipeline/
│   │       ├── graph.ts        # LangGraph graph definition (fan-out/fan-in)
│   │       ├── state.ts        # Shared state annotation + domain report types
│   │       └── nodes/
│   │           ├── inputGuard.ts
│   │           ├── qualityReview.ts
│   │           ├── securityReview.ts
│   │           ├── performanceReview.ts
│   │           ├── joinNode.ts
│   │           ├── bugDetection.ts
│   │           └── assembler.ts
│   ├── queue/                  # BullMQ job definitions and processors
│   └── common/                 # Shared utilities, interceptors, filters
├── .env.example
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB instance
- Redis instance
- GitHub OAuth App (`client_id` + `client_secret`)
- Google Gemini API key

### Installation

```bash
git clone https://github.com/your-username/precision.git
cd precision
npm install
```

### Environment Variables

```env
# App
PORT=3000
JWT_SECRET=your_jwt_secret

# MongoDB
MONGODB_URI=mongodb://localhost:27017/precision

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/github/oauth/callback

# Token Encryption
ENCRYPTION_KEY=your_32_byte_encryption_key

# Gemini
GEMINI_API_KEY=your_gemini_api_key
```

### Running the App

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

---

## API Reference

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/github/oauth/url` | Get GitHub OAuth authorization URL |
| `GET` | `/api/v1/github/oauth/callback` | OAuth callback — returns app JWT |

### GitHub

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/github/profile` | Authenticated user profile |
| `GET` | `/api/v1/github/repos` | User's repositories |
| `GET` | `/api/v1/github/repos/:owner/:repo/pulls` | Pull requests for a repo |
| `GET` | `/api/v1/github/repos/:owner/:repo/pulls/:number` | Single PR details |
| `GET` | `/api/v1/github/repos/:owner/:repo/pulls/:number/files` | Changed files + diffs |

### Code Review

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/code-review/:owner/:repo/:prNumber/analyze` | Trigger PR analysis (accepts optional `extraPrompt` in body) |
| `GET` | `/api/v1/code-review/:owner/:repo/:prNumber/report` | Fetch latest report |
| `GET` | `/api/v1/code-review/:owner/:repo/:prNumber/stream` | SSE stream for live updates |

---

## Roadmap

- [x] GitHub OAuth + encrypted token storage
- [x] GitHub REST API integration layer
- [x] LangGraph stateful pipeline (inputGuard → reviewer → assembler)
- [x] Gemini-powered structured review output
- [x] Multi-agent parallel execution (qualityReview, securityReview, performanceReview)
- [x] Self-guided bug detection via joinNode weak-area shaping
- [x] Per-domain structured JSON reports with severity rankings
- [x] API-level customization via `extraPrompt`
- [ ] Cross-file dependency graph via ts-morph + tree-sitter
- [ ] Incremental delta intelligence across PR commits
- [ ] Inline GitHub comment publishing
- [ ] Frontend dashboard

---

## Design Principles

**Deterministic before AI** — all input sanitization, file prioritization, and context construction happens before any LLM call. The AI operates on clean, structured data — not raw GitHub API responses.

**State machines, not prompt chains** — the pipeline is a typed directed graph. Each node has a clearly defined contract. Adding a new agent means adding a node — nothing else changes.

**Specialization over generalism** — domain-specific agents produce focused, high-signal feedback. A security agent that only thinks about security catches more than a generalist agent thinking about everything at once.

**Self-guided reasoning** — earlier agents inform later ones. Weak-area signals from domain reviewers shape the bug detection pass. The pipeline learns from itself within a single run.

**Context-first analysis** — diffs alone are not enough. Precision builds surrounding context, understands file relationships, and tracks history before forming any opinion on a PR.

---

## Example Response (Postman)

Below is a real response from the PR analysis endpoint.  
This demonstrates how Precision converts a pull request into a **structured, multi-agent analysis output**.

```json
{
    "prId": 5,
    "overallSummary": "Found 29 issues (high: 13, medium: 8, low: 8).",
    "domainReports": {
        "quality": {
            "domain": "quality",
            "rating": 2,
            "summary": "The PR introduces a significant architectural change by parallelizing domain-specific AI reviews (quality, security, performance) and dynamically strengthening the bug detection prompt. This is a positive step towards more comprehensive and nuanced code analysis. However, it introduces a few correctness risks and API inconsistencies that need to be addressed.",
            "weakAreas": [
                "API consistency (redundant DTO field)",
                "LLM input size management",
                "Finding deduplication logic",
                "Hardcoded domain list"
            ],
            "findings": [
                {
                    "file": "src/code-review/code-review.controller.ts",
                    "issue": "The `maxFiles` parameter in `AnalyzePrDto` is no longer respected or used in the controller logic. The `prFiles.slice(0, maxFiles)` call has been removed, meaning all files are now processed.",
                    "severity": "high",
                    "suggestion": "Either remove the `maxFiles` field from `AnalyzePrDto` to reflect its non-usage, or re-introduce the file limiting logic in the controller or `inputGuardNode` if a file limit is still desired. If the intent is to process all files, this should be an explicit design decision, potentially with safeguards against excessively large PRs (e.g., token limits, cost management)."
                },
                {
                    "file": "src/code-review/dto/analyze-pr.dto.ts",
                    "issue": "The `maxFiles` field remains in the DTO, but its corresponding logic has been removed from the controller and `inputGuardNode`. This creates an inconsistent API where a parameter is exposed but has no effect.",
                    "severity": "medium",
                    "suggestion": "Remove the `maxFiles` field from `AnalyzePrDto` to align the API contract with the actual implementation. If a file limit is still desired, re-implement the logic and ensure the DTO field is correctly used."
                },
                {
                    "file": "src/code-review/langgraph/node/input-guard.node.ts",
                    "issue": "The `maxFiles` limit has been removed from the `inputGuardNode`. Combined with the change in the controller, this means there is no longer any mechanism to limit the number of files sent to the LLM.",
                    "severity": "high",
                    "suggestion": "Processing all files in a large PR can lead to significantly increased LLM costs, longer processing times, and potential token limit errors. Re-evaluate the strategy for handling large PRs. Consider re-introducing a configurable `maxFiles` limit, or implementing a more sophisticated file selection/chunking strategy."
                },
                {
                    "file": "src/code-review/langgraph/node/assembler.node.ts",
                    "issue": "The finding deduplication logic uses a simple `file::issue` string as a key. This might lead to loss of information if different domain reviewers identify similar issues in the same file but with slightly different `issue` descriptions or unique `suggestion`s.",
                    "severity": "medium",
                    "suggestion": "Consider a more robust deduplication strategy. This could involve fuzzy matching for `issue` descriptions, or merging `suggestion`s for similar findings. Alternatively, if findings are truly distinct, they should not be deduplicated, and the `allFindings` array should reflect all unique findings across domains."
                },
                {
                    "file": "src/code-review/langgraph/node/assembler.node.ts",
                    "issue": "The `domains` array (`['quality', 'security', 'performance', 'bugDetection']`) is hardcoded. If new domain reviewers are added in the future, this array will need to be manually updated, which is a potential source of error.",
                    "severity": "low",
                    "suggestion": "Consider deriving the list of domains dynamically (e.g., from a central enum or configuration) or from the keys present in `state.domainReports` to make the `assemblerNode` more resilient to future changes."
                },
                {
                    "file": "src/code-review/langgraph/node/reviewer.node.ts",
                    "issue": "The prompt string construction, especially with the `addendum` part, uses string concatenation which can become less readable for multi-line prompts with embedded variables.",
                    "severity": "low",
                    "suggestion": "Refactor the prompt construction to use template literals (` `` `) for improved readability and maintainability, especially when embedding variables like `addendum` and `state.cleanedInput` properties."
                }
            ]
        },
        "security": {
            "domain": "security",
            "rating": 1,
            "summary": "The PR introduces a dedicated security review step and improves LLM output parsing, but also introduces a critical prompt injection vulnerability and removes file limits, posing a DoS risk.",
            "weakAreas": [
                "Prompt Injection",
                "Resource Exhaustion / Denial of Service",
                "Sensitive Data Handling"
            ],
            "findings": [
                {
                    "file": "src/code-review/langgraph/node/join.node.ts",
                    "issue": "User-provided 'extraPrompt' is directly concatenated into the LLM prompt for bug detection.",
                    "severity": "high",
                    "suggestion": "The `extraPrompt` from the user is directly appended to the `bugDetectionPromptAddendum` in `join.node.ts`, which is then used verbatim in the `reviewerNode`'s prompt. This creates a critical prompt injection vulnerability. An attacker could craft a malicious `extraPrompt` to manipulate the LLM's behavior (e.g., to ignore security bugs, generate false positives, or attempt to extract information). Implement robust sanitization or a more secure method for integrating user instructions, such as a separate LLM call to interpret intent or a 'sandwich' prompt structure with strict escaping."
                },
                {
                    "file": "src/code-review/langgraph/node/reviewer.node.ts",
                    "issue": "The 'bugDetectionPromptAddendum' (containing user's 'extraPrompt') is directly injected into the LLM prompt.",
                    "severity": "high",
                    "suggestion": "As a direct consequence of the `join.node.ts` issue, the `reviewerNode` (bug detection) receives the unsanitized `bugDetectionPromptAddendum` which includes the user's `extraPrompt`. This is the point of execution for the prompt injection. Ensure that any user-controlled input used to construct LLM prompts is thoroughly sanitized or isolated to prevent malicious instructions from altering the LLM's intended function. The current approach explicitly tells the LLM to apply the user prompt, making it highly susceptible."
                },
                {
                    "file": "src/code-review/code-review.controller.ts",
                    "issue": "Removal of 'maxFiles' limit in controller allows unbounded file fetching.",
                    "severity": "medium",
                    "suggestion": "The `maxFiles` limit has been removed from the controller, meaning `githubService.getPullRequestFiles` can fetch an unbounded number of files. While `inputGuardNode` previously had a limit, that has also been removed. This creates a potential resource exhaustion/Denial of Service (DoS) vulnerability if a PR contains an extremely large number of files. Reintroduce a `maxFiles` limit at the earliest possible stage (e.g., in the controller or `githubService` call) to prevent excessive network, memory, and processing resource consumption."
                },
                {
                    "file": "src/code-review/langgraph/node/input-guard.node.ts",
                    "issue": "Removal of 'maxFiles' limit in input guard allows unbounded file processing.",
                    "severity": "medium",
                    "suggestion": "The `maxFiles` limit has been removed from the `inputGuardNode`, which means the LLM pipeline will attempt to process all files fetched from GitHub. This exacerbates the DoS risk identified in the controller. Even if the initial fetch is limited, processing an unbounded number of files by the LLM will lead to excessive token usage and processing time. Reintroduce a configurable and reasonable `maxFiles` limit in the `inputGuardNode` to protect against resource exhaustion and control LLM costs."
                },
                {
                    "file": "src/code-review/langgraph/node/assembler.node.ts",
                    "issue": "Sensitive user-provided 'extraPrompt' is included in the final report.",
                    "severity": "low",
                    "suggestion": "The `finalReport` now includes `extraPromptApplied` and `bugDetectionPromptAddendum`. If the `extraPrompt` contains sensitive information (e.g., internal project details, specific attack vectors), this information could be exposed in the final report. Review whether these fields are strictly necessary in the final report, especially if reports are stored or shared without strict access controls. If they are needed for debugging, ensure reports are handled with appropriate security measures."
                }
            ]
        },
        "performance": {
            "domain": "performance",
            "rating": 1,
            "summary": "This PR introduces significant performance regressions, primarily due to processing all files in a PR (removing previous limits) and increasing the number of LLM calls from one to four per review. This will lead to substantially higher latency, increased resource consumption, and a significant increase in LLM API costs.",
            "weakAreas": [
                "Algorithmic complexity regression (file processing)",
                "Excessive LLM calls and token usage",
                "Increased overall latency",
                "Higher operational costs (LLM API)",
                "Increased memory consumption"
            ],
            "findings": [
                {
                    "file": "src/code-review/code-review.controller.ts",
                    "issue": "Removal of `maxFiles` limit leads to processing all PR files.",
                    "severity": "high",
                    "suggestion": "The removal of `maxFiles` (previously `body.maxFiles ?? 5`) means the system will now fetch and process content for *all* files in a pull request. For large PRs, this will drastically increase the number of `githubService.getFileContent` calls (N+1 pattern), leading to higher network latency, increased memory usage, and significantly larger input payloads for subsequent LLM calls. This is a major algorithmic complexity regression. Consider reintroducing a configurable file limit or implementing a strategy to chunk/summarize large files before passing them to the LLM."
                },
                {
                    "file": "src/code-review/langgraph/node/input-guard.node.ts",
                    "issue": "Removal of `maxFiles` limit in input processing.",
                    "severity": "high",
                    "suggestion": "Similar to the controller, this node no longer limits the number of files processed (`.slice(0, maxFiles)` was removed). This confirms that the full content of all PR files will be passed downstream to *each* LLM reviewer node, exacerbating the issues of increased token usage, latency, and cost. Reintroduce a file limit or implement intelligent content summarization/chunking."
                },
                {
                    "file": "src/code-review/langgraph/graph.ts",
                    "issue": "Introduction of parallel domain review nodes significantly increases LLM calls.",
                    "severity": "high",
                    "suggestion": "The graph now fans out to `qualityReview`, `securityReview`, and `performanceReview` nodes, which run in parallel, followed by the `reviewerNode` (bug detection). This increases the number of LLM calls from one to four per PR review. While parallel execution mitigates sequential latency, the *total* token usage and LLM API cost will increase substantially (roughly 4x baseline, plus the impact of larger inputs from the `maxFiles` removal). This architectural change needs thorough cost-benefit analysis and benchmarking."
                },
                {
                    "file": "src/code-review/langgraph/node/performance-reviewer.node.ts",
                    "issue": "New LLM call for performance review with full PR file content.",
                    "severity": "high",
                    "suggestion": "This new node introduces an additional LLM call dedicated to performance review. The prompt for this call includes the `filesText` which now contains the patch and content for *all* files in the PR. This directly contributes to the increased token usage, latency, and cost identified in the `graph.ts` and `code-review.controller.ts` analyses. Consider strategies to reduce the input size, such as file limits or intelligent summarization."
                },
                {
                    "file": "src/code-review/langgraph/node/quality-reviewer.node.ts",
                    "issue": "New LLM call for quality review with full PR file content.",
                    "severity": "high",
                    "suggestion": "Similar to the performance reviewer, this node adds another LLM call for code quality review, also processing the full PR file content. This further compounds the issues of increased token usage, latency, and cost. Input size reduction strategies are crucial here."
                },
                {
                    "file": "src/code-review/langgraph/node/security-reviewer.node.ts",
                    "issue": "New LLM call for security review with full PR file content.",
                    "severity": "high",
                    "suggestion": "This node introduces a third new LLM call for security review, again processing the full PR file content. The cumulative effect of these three new parallel calls, each with potentially large inputs, will lead to a significant increase in overall resource consumption and cost. Input size management is critical."
                },
                {
                    "file": "src/code-review/langgraph/node/reviewer.node.ts",
                    "issue": "Bug detection LLM call now processes full PR file content and augmented prompt.",
                    "severity": "medium",
                    "suggestion": "This node (now focused on bug detection) still makes an LLM call, processing the full `filesText` (all PR files). Additionally, its prompt is augmented with `bugDetectionPromptAddendum` (derived from `extraPrompt` and `weakAreas`), which can further increase token count. This call runs sequentially after the parallel domain reviews, adding to the overall latency. While the prompt augmentation is valuable, the large input size from all files remains a concern."
                },
                {
                    "file": "src/code-review/langgraph/gemini.factory.ts",
                    "issue": "Default LLM model upgraded from `gemini-1.5-flash` to `gemini-2.5-flash`.",
                    "severity": "low",
                    "suggestion": "Upgrading the LLM model can have performance implications (latency, throughput) and cost implications. While 'flash' models are optimized for speed, a version bump might introduce changes. It's important to benchmark the new model's performance and cost characteristics against the previous version, especially given the increased number of calls and input sizes in this PR."
                },
                {
                    "file": "src/code-review/langgraph/state.ts",
                    "issue": "Increased memory footprint for `GraphState` due to new domain reports.",
                    "severity": "low",
                    "suggestion": "The introduction of `domainReports` to the `GraphState` means that the state object will now hold more data (findings, summaries, ratings for multiple domains). This increases the memory footprint per review. While likely not critical for individual reviews, it could impact overall system memory usage under high concurrency."
                }
            ]
        },
        "bugDetection": {
            "domain": "bugDetection",
            "rating": 1,
            "summary": "This PR introduces a significant architectural change to the AI review process, enabling parallel domain-specific reviews. However, it also introduces critical regressions related to resource management, potential runtime errors, and increased operational costs. The removal of file limits is a major concern.",
            "weakAreas": [
                "LLM input size management",
                "Resource Exhaustion / Denial of Service",
                "Excessive LLM calls and token usage",
                "Higher operational costs (LLM API)",
                "Increased overall latency",
                "API consistency",
                "Hardcoded domain list",
                "Logic mistakes"
            ],
            "findings": [
                {
                    "file": "src/code-review/code-review.controller.ts",
                    "issue": "Critical: Removal of `maxFiles` limit, leading to unbounded PR file processing.",
                    "severity": "high",
                    "suggestion": "The `maxFiles` limit (previously 5) has been removed from the controller. This means *all* files in a PR will now be processed. This is a critical regression that can lead to: 1. **Resource Exhaustion/Denial of Service:** Processing hundreds or thousands of files can overwhelm the system. 2. **LLM Input Size Management:** The combined content of many files will likely exceed the LLM's context window, leading to truncated input, poor review quality, or API errors. 3. **Higher Operational Costs & Latency:** More files mean significantly increased token usage and longer processing times. Reintroduce a configurable `maxFiles` limit at the controller level to prevent excessive data fetching from GitHub and manage LLM input size effectively."
                },
                {
                    "file": "src/code-review/langgraph/node/input-guard.node.ts",
                    "issue": "Critical: Removal of `maxFiles` limit in `inputGuardNode`.",
                    "severity": "high",
                    "suggestion": "Similar to the controller, the `inputGuardNode` also removes its `maxFiles` limit. This eliminates the last line of defense for limiting the number of files passed to the LLMs. This exacerbates the resource management and LLM input size issues. The `inputGuardNode` should enforce a file limit, even if the controller also has one, to act as a final safeguard."
                },
                {
                    "file": "src/code-review/langgraph/gemini.factory.ts",
                    "issue": "High: LLM model name `gemini-2.5-flash` is likely a typo or non-existent.",
                    "severity": "high",
                    "suggestion": "The default LLM model has been changed from `gemini-1.5-flash` to `gemini-2.5-flash`. As of current knowledge, `gemini-2.5-flash` is not a valid or recognized Gemini model name. This is likely a typo. If it's intended to be `gemini-1.5-pro`, it represents a significant increase in operational costs and latency. If it's a non-existent model, it will cause runtime errors. Clarify and correct the LLM model name. If `gemini-1.5-pro` is intended, explicitly acknowledge the increased cost and latency implications."
                },
                {
                    "file": "src/code-review/langgraph/graph.ts",
                    "issue": "Medium: Increased LLM calls and higher operational costs due to parallel domain reviews.",
                    "severity": "medium",
                    "suggestion": "The new graph introduces three additional LLM calls (`qualityReview`, `securityReview`, `performanceReview`) that run in parallel, in addition to the original `reviewer` (bug detection) call. While parallel execution can reduce wall-clock latency, it significantly increases the total number of LLM invocations and token usage, leading to higher operational costs. Document the expected increase in operational costs and token usage. Consider strategies to manage this, such as conditional execution of domain reviewers based on PR characteristics or user preferences."
                },
                {
                    "file": "src/code-review/langgraph/node/assembler.node.ts",
                    "issue": "Medium: Hardcoded domain list in `assembler.node.ts`.",
                    "severity": "medium",
                    "suggestion": "The `domains` array (`['quality', 'security', 'performance', 'bugDetection']`) is hardcoded. This makes the system brittle and difficult to extend or modify if new domain reviewers are added or existing ones are changed. Centralize the definition of domain keys, perhaps in `state.ts` or a dedicated configuration file, and dynamically derive the list in nodes that need it."
                },
                {
                    "file": "src/code-review/langgraph/node/join.node.ts",
                    "issue": "Medium: Implicit hardcoded domain list in `join.node.ts`.",
                    "severity": "medium",
                    "suggestion": "The `joinNode` implicitly relies on specific domain keys (`quality`, `security`, `performance`) being present in `state.domainReports`. Similar to the `assembler.node.ts` issue, this makes the node brittle to changes in the domain review structure. Consider using a more dynamic approach to iterate over available domain reports if possible, or centralize domain key definitions."
                },
                {
                    "file": "src/code-review/dto/analyze-pr.dto.ts",
                    "issue": "Low: Redundant `maxFiles` field in `AnalyzePrDto`.",
                    "severity": "low",
                    "suggestion": "The `maxFiles` field is still present in `AnalyzePrDto` but is no longer used by the `CodeReviewController` or `inputGuardNode`. This creates API inconsistency and potential confusion. Remove the `maxFiles` field from `AnalyzePrDto` to maintain API consistency and clarity, or re-purpose it if a file limit is reintroduced."
                },
                {
                    "file": "src/code-review/langgraph/node/assembler.node.ts",
                    "issue": "Low: Breaking change in `finalReport` structure.",
                    "severity": "low",
                    "suggestion": "The structure of the `finalReport` has changed significantly, introducing `overallSummary`, `domainReports`, `allFindings`, and `counts`, while the original `summary` and `findings` fields are deprecated or replaced. This is a breaking change for any client consuming the `finalReport` directly. Clearly communicate this API change to consumers and ensure proper versioning or migration paths are in place if this is a public API."
                },
                {
                    "file": "src/code-review/langgraph/node/assembler.node.ts",
                    "issue": "Low: Deduplication logic limitation for findings.",
                    "severity": "low",
                    "suggestion": "The finding deduplication logic uses `file::issue` as a key. While effective for exact duplicates, it will not deduplicate semantically similar issues that have slightly different `issue` descriptions (e.g., 'Missing null check' vs 'Null pointer risk'). Also, if the same issue is found with different severities or suggestions, the first one encountered is kept. Document this behavior. For future enhancements, consider more advanced semantic deduplication if this becomes a significant problem."
                }
            ]
        }
    },
    "allFindings": [
        {
            "file": "src/code-review/code-review.controller.ts",
            "issue": "The `maxFiles` parameter in `AnalyzePrDto` is no longer respected or used in the controller logic. The `prFiles.slice(0, maxFiles)` call has been removed, meaning all files are now processed.",
            "severity": "high",
            "suggestion": "Either remove the `maxFiles` field from `AnalyzePrDto` to reflect its non-usage, or re-introduce the file limiting logic in the controller or `inputGuardNode` if a file limit is still desired. If the intent is to process all files, this should be an explicit design decision, potentially with safeguards against excessively large PRs (e.g., token limits, cost management)."
        },
        {
            "file": "src/code-review/dto/analyze-pr.dto.ts",
            "issue": "The `maxFiles` field remains in the DTO, but its corresponding logic has been removed from the controller and `inputGuardNode`. This creates an inconsistent API where a parameter is exposed but has no effect.",
            "severity": "medium",
            "suggestion": "Remove the `maxFiles` field from `AnalyzePrDto` to align the API contract with the actual implementation. If a file limit is still desired, re-implement the logic and ensure the DTO field is correctly used."
        },
        {
            "file": "src/code-review/langgraph/node/input-guard.node.ts",
            "issue": "The `maxFiles` limit has been removed from the `inputGuardNode`. Combined with the change in the controller, this means there is no longer any mechanism to limit the number of files sent to the LLM.",
            "severity": "high",
            "suggestion": "Processing all files in a large PR can lead to significantly increased LLM costs, longer processing times, and potential token limit errors. Re-evaluate the strategy for handling large PRs. Consider re-introducing a configurable `maxFiles` limit, or implementing a more sophisticated file selection/chunking strategy."
        },
        {
            "file": "src/code-review/langgraph/node/assembler.node.ts",
            "issue": "The finding deduplication logic uses a simple `file::issue` string as a key. This might lead to loss of information if different domain reviewers identify similar issues in the same file but with slightly different `issue` descriptions or unique `suggestion`s.",
            "severity": "medium",
            "suggestion": "Consider a more robust deduplication strategy. This could involve fuzzy matching for `issue` descriptions, or merging `suggestion`s for similar findings. Alternatively, if findings are truly distinct, they should not be deduplicated, and the `allFindings` array should reflect all unique findings across domains."
        },
        {
            "file": "src/code-review/langgraph/node/assembler.node.ts",
            "issue": "The `domains` array (`['quality', 'security', 'performance', 'bugDetection']`) is hardcoded. If new domain reviewers are added in the future, this array will need to be manually updated, which is a potential source of error.",
            "severity": "low",
            "suggestion": "Consider deriving the list of domains dynamically (e.g., from a central enum or configuration) or from the keys present in `state.domainReports` to make the `assemblerNode` more resilient to future changes."
        },
        {
            "file": "src/code-review/langgraph/node/reviewer.node.ts",
            "issue": "The prompt string construction, especially with the `addendum` part, uses string concatenation which can become less readable for multi-line prompts with embedded variables.",
            "severity": "low",
            "suggestion": "Refactor the prompt construction to use template literals (` `` `) for improved readability and maintainability, especially when embedding variables like `addendum` and `state.cleanedInput` properties."
        },
        {
            "file": "src/code-review/langgraph/node/join.node.ts",
            "issue": "User-provided 'extraPrompt' is directly concatenated into the LLM prompt for bug detection.",
            "severity": "high",
            "suggestion": "The `extraPrompt` from the user is directly appended to the `bugDetectionPromptAddendum` in `join.node.ts`, which is then used verbatim in the `reviewerNode`'s prompt. This creates a critical prompt injection vulnerability. An attacker could craft a malicious `extraPrompt` to manipulate the LLM's behavior (e.g., to ignore security bugs, generate false positives, or attempt to extract information). Implement robust sanitization or a more secure method for integrating user instructions, such as a separate LLM call to interpret intent or a 'sandwich' prompt structure with strict escaping."
        },
        {
            "file": "src/code-review/langgraph/node/reviewer.node.ts",
            "issue": "The 'bugDetectionPromptAddendum' (containing user's 'extraPrompt') is directly injected into the LLM prompt.",
            "severity": "high",
            "suggestion": "As a direct consequence of the `join.node.ts` issue, the `reviewerNode` (bug detection) receives the unsanitized `bugDetectionPromptAddendum` which includes the user's `extraPrompt`. This is the point of execution for the prompt injection. Ensure that any user-controlled input used to construct LLM prompts is thoroughly sanitized or isolated to prevent malicious instructions from altering the LLM's intended function. The current approach explicitly tells the LLM to apply the user prompt, making it highly susceptible."
        },
        {
            "file": "src/code-review/code-review.controller.ts",
            "issue": "Removal of 'maxFiles' limit in controller allows unbounded file fetching.",
            "severity": "medium",
            "suggestion": "The `maxFiles` limit has been removed from the controller, meaning `githubService.getPullRequestFiles` can fetch an unbounded number of files. While `inputGuardNode` previously had a limit, that has also been removed. This creates a potential resource exhaustion/Denial of Service (DoS) vulnerability if a PR contains an extremely large number of files. Reintroduce a `maxFiles` limit at the earliest possible stage (e.g., in the controller or `githubService` call) to prevent excessive network, memory, and processing resource consumption."
        },
        {
            "file": "src/code-review/langgraph/node/input-guard.node.ts",
            "issue": "Removal of 'maxFiles' limit in input guard allows unbounded file processing.",
            "severity": "medium",
            "suggestion": "The `maxFiles` limit has been removed from the `inputGuardNode`, which means the LLM pipeline will attempt to process all files fetched from GitHub. This exacerbates the DoS risk identified in the controller. Even if the initial fetch is limited, processing an unbounded number of files by the LLM will lead to excessive token usage and processing time. Reintroduce a configurable and reasonable `maxFiles` limit in the `inputGuardNode` to protect against resource exhaustion and control LLM costs."
        },
        {
            "file": "src/code-review/langgraph/node/assembler.node.ts",
            "issue": "Sensitive user-provided 'extraPrompt' is included in the final report.",
            "severity": "low",
            "suggestion": "The `finalReport` now includes `extraPromptApplied` and `bugDetectionPromptAddendum`. If the `extraPrompt` contains sensitive information (e.g., internal project details, specific attack vectors), this information could be exposed in the final report. Review whether these fields are strictly necessary in the final report, especially if reports are stored or shared without strict access controls. If they are needed for debugging, ensure reports are handled with appropriate security measures."
        },
        {
            "file": "src/code-review/code-review.controller.ts",
            "issue": "Removal of `maxFiles` limit leads to processing all PR files.",
            "severity": "high",
            "suggestion": "The removal of `maxFiles` (previously `body.maxFiles ?? 5`) means the system will now fetch and process content for *all* files in a pull request. For large PRs, this will drastically increase the number of `githubService.getFileContent` calls (N+1 pattern), leading to higher network latency, increased memory usage, and significantly larger input payloads for subsequent LLM calls. This is a major algorithmic complexity regression. Consider reintroducing a configurable file limit or implementing a strategy to chunk/summarize large files before passing them to the LLM."
        },
        {
            "file": "src/code-review/langgraph/node/input-guard.node.ts",
            "issue": "Removal of `maxFiles` limit in input processing.",
            "severity": "high",
            "suggestion": "Similar to the controller, this node no longer limits the number of files processed (`.slice(0, maxFiles)` was removed). This confirms that the full content of all PR files will be passed downstream to *each* LLM reviewer node, exacerbating the issues of increased token usage, latency, and cost. Reintroduce a file limit or implement intelligent content summarization/chunking."
        },
        {
            "file": "src/code-review/langgraph/graph.ts",
            "issue": "Introduction of parallel domain review nodes significantly increases LLM calls.",
            "severity": "high",
            "suggestion": "The graph now fans out to `qualityReview`, `securityReview`, and `performanceReview` nodes, which run in parallel, followed by the `reviewerNode` (bug detection). This increases the number of LLM calls from one to four per PR review. While parallel execution mitigates sequential latency, the *total* token usage and LLM API cost will increase substantially (roughly 4x baseline, plus the impact of larger inputs from the `maxFiles` removal). This architectural change needs thorough cost-benefit analysis and benchmarking."
        },
        {
            "file": "src/code-review/langgraph/node/performance-reviewer.node.ts",
            "issue": "New LLM call for performance review with full PR file content.",
            "severity": "high",
            "suggestion": "This new node introduces an additional LLM call dedicated to performance review. The prompt for this call includes the `filesText` which now contains the patch and content for *all* files in the PR. This directly contributes to the increased token usage, latency, and cost identified in the `graph.ts` and `code-review.controller.ts` analyses. Consider strategies to reduce the input size, such as file limits or intelligent summarization."
        },
        {
            "file": "src/code-review/langgraph/node/quality-reviewer.node.ts",
            "issue": "New LLM call for quality review with full PR file content.",
            "severity": "high",
            "suggestion": "Similar to the performance reviewer, this node adds another LLM call for code quality review, also processing the full PR file content. This further compounds the issues of increased token usage, latency, and cost. Input size reduction strategies are crucial here."
        },
        {
            "file": "src/code-review/langgraph/node/security-reviewer.node.ts",
            "issue": "New LLM call for security review with full PR file content.",
            "severity": "high",
            "suggestion": "This node introduces a third new LLM call for security review, again processing the full PR file content. The cumulative effect of these three new parallel calls, each with potentially large inputs, will lead to a significant increase in overall resource consumption and cost. Input size management is critical."
        },
        {
            "file": "src/code-review/langgraph/node/reviewer.node.ts",
            "issue": "Bug detection LLM call now processes full PR file content and augmented prompt.",
            "severity": "medium",
            "suggestion": "This node (now focused on bug detection) still makes an LLM call, processing the full `filesText` (all PR files). Additionally, its prompt is augmented with `bugDetectionPromptAddendum` (derived from `extraPrompt` and `weakAreas`), which can further increase token count. This call runs sequentially after the parallel domain reviews, adding to the overall latency. While the prompt augmentation is valuable, the large input size from all files remains a concern."
        },
        {
            "file": "src/code-review/langgraph/gemini.factory.ts",
            "issue": "Default LLM model upgraded from `gemini-1.5-flash` to `gemini-2.5-flash`.",
            "severity": "low",
            "suggestion": "Upgrading the LLM model can have performance implications (latency, throughput) and cost implications. While 'flash' models are optimized for speed, a version bump might introduce changes. It's important to benchmark the new model's performance and cost characteristics against the previous version, especially given the increased number of calls and input sizes in this PR."
        },
        {
            "file": "src/code-review/langgraph/state.ts",
            "issue": "Increased memory footprint for `GraphState` due to new domain reports.",
            "severity": "low",
            "suggestion": "The introduction of `domainReports` to the `GraphState` means that the state object will now hold more data (findings, summaries, ratings for multiple domains). This increases the memory footprint per review. While likely not critical for individual reviews, it could impact overall system memory usage under high concurrency."
        },
        {
            "file": "src/code-review/code-review.controller.ts",
            "issue": "Critical: Removal of `maxFiles` limit, leading to unbounded PR file processing.",
            "severity": "high",
            "suggestion": "The `maxFiles` limit (previously 5) has been removed from the controller. This means *all* files in a PR will now be processed. This is a critical regression that can lead to: 1. **Resource Exhaustion/Denial of Service:** Processing hundreds or thousands of files can overwhelm the system. 2. **LLM Input Size Management:** The combined content of many files will likely exceed the LLM's context window, leading to truncated input, poor review quality, or API errors. 3. **Higher Operational Costs & Latency:** More files mean significantly increased token usage and longer processing times. Reintroduce a configurable `maxFiles` limit at the controller level to prevent excessive data fetching from GitHub and manage LLM input size effectively."
        },
        {
            "file": "src/code-review/langgraph/node/input-guard.node.ts",
            "issue": "Critical: Removal of `maxFiles` limit in `inputGuardNode`.",
            "severity": "high",
            "suggestion": "Similar to the controller, the `inputGuardNode` also removes its `maxFiles` limit. This eliminates the last line of defense for limiting the number of files passed to the LLMs. This exacerbates the resource management and LLM input size issues. The `inputGuardNode` should enforce a file limit, even if the controller also has one, to act as a final safeguard."
        },
        {
            "file": "src/code-review/langgraph/gemini.factory.ts",
            "issue": "High: LLM model name `gemini-2.5-flash` is likely a typo or non-existent.",
            "severity": "high",
            "suggestion": "The default LLM model has been changed from `gemini-1.5-flash` to `gemini-2.5-flash`. As of current knowledge, `gemini-2.5-flash` is not a valid or recognized Gemini model name. This is likely a typo. If it's intended to be `gemini-1.5-pro`, it represents a significant increase in operational costs and latency. If it's a non-existent model, it will cause runtime errors. Clarify and correct the LLM model name. If `gemini-1.5-pro` is intended, explicitly acknowledge the increased cost and latency implications."
        },
        {
            "file": "src/code-review/langgraph/graph.ts",
            "issue": "Medium: Increased LLM calls and higher operational costs due to parallel domain reviews.",
            "severity": "medium",
            "suggestion": "The new graph introduces three additional LLM calls (`qualityReview`, `securityReview`, `performanceReview`) that run in parallel, in addition to the original `reviewer` (bug detection) call. While parallel execution can reduce wall-clock latency, it significantly increases the total number of LLM invocations and token usage, leading to higher operational costs. Document the expected increase in operational costs and token usage. Consider strategies to manage this, such as conditional execution of domain reviewers based on PR characteristics or user preferences."
        },
        {
            "file": "src/code-review/langgraph/node/assembler.node.ts",
            "issue": "Medium: Hardcoded domain list in `assembler.node.ts`.",
            "severity": "medium",
            "suggestion": "The `domains` array (`['quality', 'security', 'performance', 'bugDetection']`) is hardcoded. This makes the system brittle and difficult to extend or modify if new domain reviewers are added or existing ones are changed. Centralize the definition of domain keys, perhaps in `state.ts` or a dedicated configuration file, and dynamically derive the list in nodes that need it."
        },
        {
            "file": "src/code-review/langgraph/node/join.node.ts",
            "issue": "Medium: Implicit hardcoded domain list in `join.node.ts`.",
            "severity": "medium",
            "suggestion": "The `joinNode` implicitly relies on specific domain keys (`quality`, `security`, `performance`) being present in `state.domainReports`. Similar to the `assembler.node.ts` issue, this makes the node brittle to changes in the domain review structure. Consider using a more dynamic approach to iterate over available domain reports if possible, or centralize domain key definitions."
        },
        {
            "file": "src/code-review/dto/analyze-pr.dto.ts",
            "issue": "Low: Redundant `maxFiles` field in `AnalyzePrDto`.",
            "severity": "low",
            "suggestion": "The `maxFiles` field is still present in `AnalyzePrDto` but is no longer used by the `CodeReviewController` or `inputGuardNode`. This creates API inconsistency and potential confusion. Remove the `maxFiles` field from `AnalyzePrDto` to maintain API consistency and clarity, or re-purpose it if a file limit is reintroduced."
        },
        {
            "file": "src/code-review/langgraph/node/assembler.node.ts",
            "issue": "Low: Breaking change in `finalReport` structure.",
            "severity": "low",
            "suggestion": "The structure of the `finalReport` has changed significantly, introducing `overallSummary`, `domainReports`, `allFindings`, and `counts`, while the original `summary` and `findings` fields are deprecated or replaced. This is a breaking change for any client consuming the `finalReport` directly. Clearly communicate this API change to consumers and ensure proper versioning or migration paths are in place if this is a public API."
        },
        {
            "file": "src/code-review/langgraph/node/assembler.node.ts",
            "issue": "Low: Deduplication logic limitation for findings.",
            "severity": "low",
            "suggestion": "The finding deduplication logic uses `file::issue` as a key. While effective for exact duplicates, it will not deduplicate semantically similar issues that have slightly different `issue` descriptions (e.g., 'Missing null check' vs 'Null pointer risk'). Also, if the same issue is found with different severities or suggestions, the first one encountered is kept. Document this behavior. For future enhancements, consider more advanced semantic deduplication if this becomes a significant problem."
        }
    ],
    "counts": {
        "severity": {
            "low": 8,
            "medium": 8,
            "high": 13
        },
        "domain": {
            "quality": 6,
            "security": 5,
            "performance": 9,
            "bugDetection": 9
        }
    },
    "extraPromptApplied": "",
    "bugDetectionPromptAddendum": "Double-check these weak areas carefully: API consistency (redundant DTO field), LLM input size management, Finding deduplication logic, Hardcoded domain list, Prompt Injection, Resource Exhaustion / Denial of Service, Sensitive Data Handling, Algorithmic complexity regression (file processing), Excessive LLM calls and token usage, Increased overall latency, Higher operational costs (LLM API), Increased memory consumption."
}

---
