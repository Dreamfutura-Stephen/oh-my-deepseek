# oh-my-deepseek (omd)

> **English** | [中文](README.md)

**Multi-agent orchestration layer for DeepSeek.** A zero-dependency framework that turns DeepSeek's API into a multi-agent coding system — autonomous execution, parallel team mode, interactive chat, and MCP integration.

<img width="1024" height="1536" alt="image" src="https://github.com/user-attachments/assets/dae2f32f-6e11-40a5-96b1-39b9eb7991a2" />


## Quick Start

```bash
# Clone the repo
git clone https://github.com/Dreamfutura-Stephen/oh-my-deepseek.git
cd oh-my-deepseek

# Install globally (makes omd command available)
npm install -g .

# Set your API key
export OMD_API_KEY=sk-your-key-here

# Run in autopilot mode
omd run "refactor the auth module to use JWT"

# Or run with persistent verify-fix loop
omd ralph "fix performance bug"

# Or start interactive chat
omd chat
```

## Getting Started Guide

New to OMD? Follow these steps to go from zero to running your first task.

### 1. Install

```bash
npm install -g oh-my-deepseek
```

Output:

```
added 1 package in 2s
```

Verify the version:

```bash
omd --version
```

Output:

```
omd v1.x.x
```

### 2. Set your API key

```bash
export OMD_API_KEY=sk-your-key-here
```

> Add this to your `~/.bashrc` or `~/.zshrc` to avoid re-entering it every time.

### 3. Initialize project structure

```bash
omd setup
```

Output (banner trimmed):

```
oh-my-deepseek Setup Wizard

Environment Detection
  API keys: OMD_API_KEY (sk-abcd12...)
  claude-code: installed, API: DeepSeek
  codex: installed, API: DeepSeek

How do you want to use OMD?

  1  Via MCP with Claude Code / Codex / Cursor
  2  Standalone CLI mode
  3  Manual MCP configuration

Enter choice (1-3) [default: 1]:
```

The interactive wizard detects your environment (installed coding agents, API keys, MCP status) and guides you through the right setup:

- **MCP mode** (option 1): Detects Claude Code / Codex configured with DeepSeek, auto-registers OMD as an MCP server
- **Standalone mode** (option 2): Configures your API key, verifies connectivity, and you're ready to run `omd run` / `omd chat`
- **Manual config** (option 3): Shows JSON config templates for each MCP client

> If a coding agent is detected but NOT configured for DeepSeek, OMD warns you and asks for confirmation before proceeding.

This also creates the `.omd/` folder with `sessions/`, `memory/`, and `logs/` directories. All session records and decision logs are stored here.

### 4. Environment check

```bash
omd doctor
```

Output:

```
  ✓ Node.js v22.x.x
  ✓ API key — sk-abcd1234...
  ✓ .omd/ directory
  ✓ Config loaded — model: deepseek-v4-flash
  ✓ DeepSeek API — connected
```

All checks must pass with ✓. Fix any ✗ items before proceeding.

### 5. Quick smoke test

Run a minimal task to verify everything works:

```bash
omd run "Reply with: OMD-OK"
```

Output:

```
▶ Mode: autopilot
⚡ stage — explore — Exploring codebase...
⚡ stage — plan — Designing solution...
⚡ stage — execute — Implementing...
✓ executor done (5 steps, 3 tool calls)
⚡ stage — review — Adversarial review...
✓ reviewer done (3 steps, 0 tool calls)
✓ All changes approved.
✓ Done.
```

If you see `▶ Mode: autopilot`, stage logs, and `✓ Done`, the system is working.

### 6. Mode reference

Each execution mode uses a specific combination of models for its pipeline stages.

---

#### Autopilot — `omd run "task"`

**Use when**: Building features, adding modules, routine coding.

**Model assignment**:
| Stage | Model | Role |
|-------|-------|------|
| explore | deepseek-v4-flash | Quickly search the codebase for relevant files |
| plan | deepseek-v4-pro | Strong reasoning for architecture and solution design |
| execute | deepseek-v4-flash | Fast code writing and file editing |
| review | deepseek-v4-flash | Cost-effective adversarial code review |

**Pipeline**:
```
explore → [gate] → plan → [gate] → execute → [gate] → review → [gate] → fix loop (max 3)
```

**Terminal output**:
```
▶ Mode: autopilot
⚡ stage — explore
⚡ stage — plan
⚡ stage — execute — Implementing...
⚡ stage — review — Adversarial...
⚡ stage — fix — Applying fixes...
✓ All changes approved.
✓ Done.
```

**Behavior**:
- Phase gates validate each stage before proceeding
- `NEEDS_CHANGES` review → auto-fix loop, up to 3 retries
- `REJECTED` review → immediate stop, manual intervention needed

---

#### Ralph mode — `omd run '$ralph "task"'`

**Use when**: Bug fixing, troubleshooting, complex tasks that need repeated validation.

**Model assignment**:
| Agent | Model | Role |
|-------|-------|------|
| explore / tracer | deepseek-v4-pro | Deep reasoning to locate root cause |
| plan / architect | deepseek-v4-pro | May redesign from scratch each cycle |
| executor | deepseek-v4-flash | Fast iteration on fixes |
| reviewer | deepseek-v4-flash | Repeated reviews until approval |

**Pipeline**:
```
explore → plan → execute → review → fix (up to 20 iterations)
↓ on REJECTED ↓
re-explore → re-plan → execute → review → fix (up to 5 fresh cycles)
```

**Terminal output**:
```
▶ Mode: ralph
⚡ stage — explore
⚡ stage — plan
⚡ stage — execute — Implementing...
⚡ stage — review — Adversarial...
⚡ stage — fix — attempt 2/20
...
⟳ ralph_rethink — Rejected...
⚡ stage — explore — cycle 2
...
✓ All changes approved.
```

**Behavior**:
- Up to **20** fix iterations (vs 3 in autopilot)
- `REJECTED` triggers **re-explore + re-plan** (up to 5 complete fresh cycles)
- Each cycle starts from scratch — never patches a fundamentally wrong approach

---

#### Team mode — `omd team <N> "task"`

**Use when**: Large refactoring, module decomposition, parallel sub-tasks.

**Model assignment**:
| Agent | Model | Role |
|-------|-------|------|
| architect | deepseek-v4-pro | Split task into N independent sub-tasks |
| executor × N | deepseek-v4-flash | N parallel workers, fast execution |
| reviewer | deepseek-v4-flash | Check cross-worker consistency and integration |

**Pipeline**:
```
architect splits task → [gate] → N parallel executors → [gate] → reviewer merges
```

**Terminal output**:
```
▶ Mode: team
⚡ stage — plan — Team leader...
⚡ stage — execute — 4 workers...
⚡ stage — workers_done
⚡ stage — review — Reviewing...
✓ reviewer done
```

**Behavior**:
- Architect (deepseek-v4-pro) decomposes into N independent sub-tasks
- N executors run **in parallel** with no dependencies between them
- Reviewer checks **cross-worker consistency** and integration issues

---

#### Chat mode — `omd chat`

**Use when**: Exploring code, asking questions, discussing unclear requirements.

**Intent routing**:

| Intent | Routed to | Model |
|--------|-----------|-------|
| debug / trace | debugger / tracer | deepseek-v4-pro |
| plan / design | planner / architect | deepseek-v4-pro |
| review / security | reviewer / security_reviewer | deepseek-v4-flash |
| verify / test | verifier / test_engineer | deepseek-v4-flash |
| explore / implement | explore / executor | deepseek-v4-flash |

**Flow**:
```
input → intent classifier → route to matching agent
```

**Terminal output**:
```
▸ what does this module do           ← user input
▶ Mode: chat
...agent response...

▸ fix this memory leak               ← new input
▶ Mode: autopilot                    ← auto-switched
⚡ stage — explore
...
```

**Behavior**:
- Input classified via `classifyIntent` keyword matching
- Non-matching input → single-turn chat
- Matching implement/debug keywords → **auto-switches to autopilot mode**
- Supports magic keywords to force specific modes
- Context retains last 12 messages

### Mode comparison

| Mode | Command | Max fix iterations | Re-explore on reject | Parallel | Best for |
|------|---------|-------------------|---------------------|----------|----------|
| **Autopilot** | `omd run "..."` | 3 | ❌ | ❌ | Routine coding, new features |
| **Ralph** | `omd run '\$ralph "..."'` | 20 + 5 cycles | ✅ | ❌ | Bug fixes, tricky issues |
| **Team** | `omd team <N> "..."` | 1 round | ❌ | ✅ N workers | Large refactors, module splits |
| **Chat** | `omd chat` | Single turn | — | — | Exploration, Q&A, discussion |

Use these prefixes in chat mode or `omd run` to force a specific mode:

| Keyword | Use case | Terminal output |
|---------|----------|-----------------|
| `$autopilot "..."` | Force autopilot mode | `▶ Mode: autopilot` → explore→plan→execute→review→fix (max 3) |
| `$ralph "..."` | Persistent verify-fix loop | `▶ Mode: ralph` → 20 iterations + 5 re-explore cycles |
| `$team <N> "..."` | Parallel team execution | `▶ Mode: team` → N workers parallel + review merge |

> **Important**: Always use **single quotes** around commands with `$ralph` or other magic keywords in the terminal to prevent shell variable expansion:
> ```bash
> # ✓ Correct: single quotes prevent $ralph from being expanded
> omd run '$ralph "fix the bug"'
>
> # ✗ Wrong: double quotes let the shell expand $ralph to empty string
> omd run "$ralph fix the bug"
> ```
>
> **Quote characters**: Task descriptions must use ASCII straight quotes `" "`, not Chinese curly quotes `" "` or `" "`. The shell will not recognize curly quotes as string delimiters.
> ```bash
> # ✓ Correct: ASCII straight quotes
> omd run '$ralph "implement user login"'
>
> # ✗ Wrong: Chinese curly quotes, shell can't parse them
> omd run '$ralph "implement user login"'
> ```

## Commands

| Command | Description |
|---------|-------------|
| `omd run "task"` | Autonomous execution (explore → plan → execute → review → fix) |
| `omd ralph "task"` | Persistent verify-fix loop (Ralph mode, up to 20 iterations) |
| `omd team <N> "task"` | Parallel team of N workers |
| `omd chat` | Interactive chat with intent routing |
| `omd mcp` | Start MCP server (for Claude Code, Codex CLI, Cursor) |
| `omd setup` | Initialize `.omd/` project structure |
| `omd setup-mcp` | Register MCP in Claude Code with one command (auto-detects API key, no re-entry) |
| `omd doctor` | Environment and API connectivity check (includes MCP status) |
| `omd sessions` | List recent sessions |
| `omd agents` | List available agent types |
```

## Architecture

### Modes

**Autopilot** — Full pipeline with phase gates:
```
explore → [gate] → plan → [gate] → execute → [gate] → review → [gate] → fix loop (max 3)
```

**Ralph** — Persistent verify-fix loop:
```
explore → plan → execute → review → fix (up to 20 iterations)
↓ on REJECTED ↓
re-explore → re-plan → execute → review → fix (up to 5 fresh cycles)
```

**Team** — Parallel execution:
```
architect splits task → [gate] → N parallel executors → [gate] → reviewer merges
```

**Chat** — Smart routing:
```
input → intent classifier → planner / architect / executor / debugger / tracer /
                     reviewer / security_reviewer / verifier /
                     test_engineer / explore
```

### Built-in Agents

| Agent | Model | Role |
|-------|-------|------|
| **planner** | deepseek-v4-pro | Strategic planning — task decomposition, acceptance criteria, risk assessment |
| **architect** | deepseek-v4-pro | System design — architecture, component breakdown, interface contracts |
| **executor** | deepseek-v4-flash | Implementation engineer — code, files, commands |
| **debugger** | deepseek-v4-pro | Bug diagnosis, root cause analysis, fix proposals |
| **tracer** | deepseek-v4-pro | Causal tracing — competing hypotheses, evidence gathering |
| **reviewer** | deepseek-v4-flash | Adversarial code review (Claude Nexus-inspired) |
| **security_reviewer** | deepseek-v4-flash | Security review — OWASP Top 10, credential leaks, injection |
| **verifier** | deepseek-v4-flash | Completion verifier — acceptance criteria, edge case validation |
| **test_engineer** | deepseek-v4-flash | Test engineer — unit tests, integration tests, coverage analysis |
| **explore** | deepseek-v4-flash | Codebase explorer — search, read, understand code |

### Project Structure

```
oh-my-deepseek/
├── agents/              # Agent prompt templates (editable markdown)
│   ├── architect.md
│   ├── debugger.md
│   ├── executor.md
│   ├── explore.md
│   ├── planner.md
│   ├── reviewer.md
│   ├── security_reviewer.md
│   ├── test_engineer.md
│   ├── tracer.md
│   └── verifier.md
├── src/
│   ├── index.js         # CLI entry point + banner
│   ├── agent.js         # Agent system + execution loop + sub-agent spawning
│   ├── client.js        # DeepSeek API client (native fetch, no deps)
│   ├── config.js        # Config: env >> project >> user >> defaults
│   ├── mailbox.js       # Inter-agent messaging
│   ├── mcp.js           # MCP server (JSON-RPC over stdio)
│   ├── orchestrator.js  # Autopilot / team / chat orchestration
│   ├── state.js         # Session persistence, ADR, memory
│   └── tools/
│       ├── bash.js      # Shell execution
│       ├── file.js      # Read / Write / Edit
│       ├── index.js     # Tool registry
│       └── search.js    # Glob + Grep
├── test/
│   └── mcp-test.js      # MCP protocol tests
└── banner-pixels.txt    # Pixel art banner data
```

## Configuration

Priority: **Environment variables** > **Project `.omd/config.json`** > **User `~/.omd/config.json`** > **Defaults**

```bash
export OMD_API_KEY=sk-...          # API key (falls back to DEEPSEEK_API_KEY)
export OMD_MODEL=deepseek-v4-flash     # Default model (V4 Flash, fast & cheap)
export OMD_REASONER_MODEL=deepseek-v4-pro  # Reasoning model (V4 Pro, stronger reasoning)
export OMD_BASE_URL=https://api.deepseek.com
export OMD_MAX_TOKENS=8192
export OMD_TEMPERATURE=0.7
export OMD_DEFAULT_MODE=autopilot   # autopilot, team, chat
```

> **Note**: The legacy model names `deepseek-chat` and `deepseek-reasoner` will be **retired on July 24, 2026**. Migrate to `deepseek-v4-flash` and `deepseek-v4-pro` as soon as possible. The old names map to V4 Flash during the grace period.
```

## MCP Integration

OMD runs as a standard MCP server, compatible with Claude Code, Codex CLI, Cursor, and any MCP client.

### One-command setup (recommended)

If you already have `OMD_API_KEY` or `DEEPSEEK_API_KEY` set in your terminal, register OMD with Claude Code in one step:

```bash
omd setup-mcp
```

Output:

```
✓ OMD registered in Claude Code config.
  Config: /Users/you/.claude/claude.json
  Key: sk-abcd12...
```

Restart Claude Code, then use OMD's tools (check with `/mcp`).

> **No API key re-entry needed**: `omd setup-mcp` automatically detects `OMD_API_KEY` or `DEEPSEEK_API_KEY` from your terminal environment and writes it into the Claude Code config. OMD MCP inherits it automatically when it starts.

### Manual start

```bash
omd mcp
```

Exposed tools: `omd_autopilot`, `omd_team`, `omd_chat`, `omd_explore`, `omd_sessions`, `omd_decisions`, `omd_memory`.

### API key priority

`omd doctor` now checks MCP integration status. The API key is resolved in this order:

1. `OMD_API_KEY` environment variable
2. `DEEPSEEK_API_KEY` environment variable (shared with Claude Code / Codex)
3. `~/.claude/claude.json` `mcpServers.omd.env` (Claude Code MCP config)

This means if you're already using Claude Code + DeepSeek, OMD inherits your API key automatically — no extra configuration needed.

### Manual Claude Code config

You can also manually edit `~/.claude/claude.json`:

```json
{
  "mcpServers": {
    "omd": {
      "command": "node",
      "args": ["/path/to/oh-my-deepseek/src/index.js", "mcp"],
      "env": { "OMD_API_KEY": "sk-..." }
    }
  }
}
```

## Acknowledgments

oh-my-deepseek does not stand alone. It is a synthesis — ideas borrowed, remixed, and recombined from projects that pushed the boundaries of what AI coding agents can do. Each left its mark.

**AgentSys** taught us phase gates — validate stage output before proceeding, catch bad outputs early. The explore→plan→execute→review pipeline runs on this discipline.

**Harmonist** taught us that the LLM should never see tools it cannot use. Tool schemas are filtered at definition time, not at execution time. A quiet but profound insight.

**Structured inter-agent communication** — DELEGATE, REPORT, QUERY, ALERT, APPROVE, REJECT typed messages via mailboxes, letting agents exchange information without chaos.

**ittybitty** taught us recursive sub-agent spawning. An agent can spawn another for a focused sub-task, which can spawn another. The `agent` tool is OMD's central recursion mechanism.

**OMC/OMX** taught us the autopilot pipeline, team mode with parallel workers, and the Ralph verify-fix loop — relentless iteration until the output is right.

**Claude Nexus** taught us adversarial review. Assume every change has hidden problems until proven otherwise. "What's the WORST thing that could go wrong?" changes how you read code.

**autoapp-toolkit** taught us that agents need memory. ADR decision logs, MEMORY.md, cross-session state — so the system learns from its own history.

**Adaptive context compression** — system messages kept intact, recent messages preserved in full, older tool results truncated to summaries. A practical necessity for any long-running agent loop.

To the authors and maintainers of these projects: thank you. OMD is what it is because you showed what was possible.

## License

MIT
