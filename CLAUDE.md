# oh-my-deepseek (omd) — Project Guide

## Overview

oh-my-deepseek is a **zero-dependency** multi-agent orchestration framework powered by DeepSeek. Pure ESM, Node 18+, no npm dependencies.

## Architecture

```
src/
├── index.js         CLI entry (omd run/team/chat/mcp/setup/doctor/sessions/agents)
├── agent.js         Agent system: 5 built-in agents + recursive sub-agent spawning
├── client.js        DeepSeek API client (native fetch, no deps)
├── config.js        Config: env >> .omd/config.json >> ~/.omd/config.json >> defaults
├── mailbox.js       Inter-agent messaging (Houmao: DELEGATE/REPORT/QUERY/ALERT/APPROVE/REJECT)
├── mcp.js           JSON-RPC MCP server (stdin/stdout), 7 tools exposed
├── orchestrator.js  3 modes: autopilot (explore→plan→execute→review→fix), team (parallel workers), chat (intent routing)
├── state.js         Session persistence, ADR decision log, MEMORY.md, cross-session state
└── tools/
    ├── index.js     Tool registry (registerTool/getToolSchemas/executeTool)
    ├── bash.js      execSync with sandboxRoot and timeout
    ├── file.js      read/write/edit with sandbox path resolution
    └── search.js    glob + grep with walking directory traversal
```

## Key Design Patterns

- **AgentSys**: Phase gates validate stage output before proceeding (soft gates in MVP)
- **Harmonist**: Tool schemas filtered before API call; agents never see disallowed tools
- **Houmao**: Structured inter-agent mailboxes (in-memory Map)
- **ittybitty**: Recursive sub-agent spawning via registered `agent` tool
- **OMC/OMX**: Autopilot pipeline, team/ralph modes, intent gate routing
- **Claude Nexus**: Adversarial reviewer stance ("assume problems exist")
- **autoapp-toolkit**: ADR logging, MEMORY.md, cross-session state.yml
- **Sema Code**: Adaptive context compression (compactMessages)

## Agent Definitions

Agents are defined in `src/agent.js` as BUILTIN_AGENTS. Each has:
- name, role, model, systemPrompt, allowedTools, disallowedTools, canSpawn, temperature, maxSteps

Can be overridden by markdown files in `agents/{name}.md` with frontmatter.

| Agent | Model | canSpawn | allowedTools |
|-------|-------|----------|-------------|
| architect | deepseek-reasoner | yes | read, glob, grep, agent |
| executor | deepseek-chat | yes | [*] |
| debugger | deepseek-reasoner | yes | bash, read, glob, grep, agent |
| reviewer | deepseek-chat | yes | read, glob, grep, bash, agent |
| explore | deepseek-chat | no | read, glob, grep |

## Color Palette (Banner)

9-level palette for the pixel art whale:
- `.`=0 (black bg), `1`=236 (dark gray), `2`=60 (blue-gray), `3`=25, `4`=27, `5`=45 (light blue)
- `w`=109 (belly shadow), `W`=188 (belly), `e`=15 (eye white)
- Half-block rendering: ▀ with 38;5;{top}m 48;5;{bot}m

## Config Priority

Environment > `.omd/config.json` > `~/.omd/config.json` > hardcoded DEFAULTS

## Testing

```bash
node test/mcp-test.js           # Protocol tests (no API key)
node test/mcp-test.js --live Q  # Live test with real API call
```

## Code Style

- ESM only (`import`/`export`, no `require`)
- JSDoc for module headers and public functions
- `executeTool` wraps all errors as `{ success, error }` objects
- `onEvent` callback pattern for streaming agent progress
