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

Precision builds a **holistic, structured representation** of every pull request before any AI model is invoked. It enriches raw diffs with surrounding context, commit history, dependency relationships, and historical findings — then routes this through a **LangGraph-powered multi-agent pipeline** where specialized agents reason independently and their outputs are merged, deduplicated, ranked, and mapped back to exact line numbers.

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
│   Input          Wave 0             Wave 1           Wave 2     │
│   ──────    ──────────────────   ───────────────   ──────────── │
│   PR data   Deterministic prep   Parallel agents   Aggregation  │
│   & diffs   Sanitize, prioritize  Bug / Security   Deduplicate  │
│             Map lines, bundle     Perf / Quality   Rank & map   │
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

```
inputGuard → reviewer → assembler
```

| Node | Responsibility |
|---|---|
| `inputGuard` | Filters, limits, and sanitizes files before any LLM call |
| `reviewer` | Sends a structured payload to Gemini, enforces a strict JSON findings schema |
| `assembler` | Merges all findings into a ranked, structured final report |

Each node has typed inputs and typed outputs. Logic is isolated per node — independently testable, observable, and replaceable without touching the rest of the pipeline.

---

### 🔧 In Progress

#### 1. Multi-Agent Parallel Execution

Evolving from a single reviewer node into a **fully parallel multi-agent system** using LangGraph's fan-out/fan-in architecture.

```
                  ┌─ BugDetectionAgent ─┐
                  ├─ SecurityAgent ──────┤
Input → Preprocess┤                     ├→ Aggregation → Report
                  ├─ PerformanceAgent ──┤
                  └─ CodeQualityAgent ──┘
```

- Each agent specializes in one dimension of code quality
- Semaphore-controlled concurrency to limit parallel LLM calls
- LangGraph reducers merge agent outputs into shared state
- Fault-isolated — failure of one agent does not break the pipeline

#### 2. Cross-File Dependency & Impact Analysis

Building a **bounded dependency graph** to enable cross-file reasoning.

- Import parsing via `ts-morph` (TypeScript) and `tree-sitter` (multi-language)
- Bounded traversal — 1 to 2 levels deep to control cost
- Related file context fed selectively into agents
- Detects API contract violations, ripple effects, and breaking changes invisible in isolated diffs

#### 3. Incremental Delta Intelligence

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
     { prId, title, description, files[] }
          │
          ▼
     LangGraph graph.invoke({ input })
          │
     ┌────▼────────────────────────────┐
     │  inputGuard → reviewer → assembler │
     └────────────────────────┬────────┘
                              ▼
                         finalReport
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
│   │       ├── graph.ts        # LangGraph graph definition
│   │       ├── state.ts        # Shared state annotation
│   │       └── nodes/
│   │           ├── inputGuard.ts
│   │           ├── reviewer.ts
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
| `POST` | `/api/v1/code-review/:owner/:repo/:prNumber/analyze` | Trigger PR analysis |
| `GET` | `/api/v1/code-review/:owner/:repo/:prNumber/report` | Fetch latest report |
| `GET` | `/api/v1/code-review/:owner/:repo/:prNumber/stream` | SSE stream for live updates |

---

## Roadmap

- [x] GitHub OAuth + encrypted token storage
- [x] GitHub REST API integration layer
- [x] LangGraph stateful pipeline (inputGuard → reviewer → assembler)
- [x] Gemini-powered structured review output
- [ ] Multi-agent parallel execution (BugDetection, Security, Performance, CodeQuality)
- [ ] Cross-file dependency graph via ts-morph + tree-sitter
- [ ] Incremental delta intelligence across PR commits
- [ ] Inline GitHub comment publishing
- [ ] Frontend dashboard

---

## Design Principles

**Deterministic before AI** — all input sanitization, file prioritization, and context construction happens before any LLM call. The AI operates on clean, structured data — not raw GitHub API responses.

**State machines, not prompt chains** — the pipeline is a typed directed graph. Each node has a clearly defined contract. Adding a new agent means adding a node — nothing else changes.

**Context-first analysis** — diffs alone are not enough. Precision builds surrounding context, understands file relationships, and tracks history before forming any opinion on a PR.


---

<div align="center">
  <sub>Built in public. Follow along for technical deep-dives.</sub>
</div>
