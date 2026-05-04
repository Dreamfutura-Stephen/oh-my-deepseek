# oh-my-deepseek (omd)

> [English](README.en.md) | **中文**

**DeepSeek 多智能体编排层。** 零依赖框架，将 DeepSeek API 转化为多智能体编码系统——自主执行、并行团队模式、交互式聊天和 MCP 集成。最佳实践方案是搭配 claudecode+deepseekV4试用
<img width="1913" height="822" alt="image" src="https://github.com/user-attachments/assets/b96bf41c-fa95-43b3-8c9d-857ba2664ab7" />

## 快速开始

```bash
# 全局安装
npm install -g oh-my-deepseek

# 或直接运行
npx oh-my-deepseek

# 设置 API 密钥
export OMD_API_KEY=sk-your-key-here

# 自动驾驶模式运行
omd run "将用户认证模块重构为 JWT"

# 或启动交互式聊天
omd chat
```

## 命令

| 命令 | 说明 |
|------|------|
| `omd run "任务"` | 自动驾驶执行（探索 → 规划 → 执行 → 审查 → 修复） |
| `omd team <N> "任务"` | N 个工作者的并行团队模式 |
| `omd chat` | 带意图路由的交互式聊天 |
| `omd mcp` | 启动 MCP 服务器（用于 Claude Code、Codex CLI、Cursor） |
| `omd setup` | 初始化 `.omd/` 项目结构 |
| `omd doctor` | 环境和 API 连接检查 |
| `omd sessions` | 列出最近的会话 |
| `omd agents` | 列出可用的智能体类型 |

### 魔法关键词

在聊天或 `run` 中使用：

```
$autopilot "implement REST API"   # 强制自动驾驶模式
$team 4 "refactor database"       # 4 个工作者的团队模式
$ralph "fix performance bug"      # 持续验证-修复循环（Ralph 模式）
```

## 架构

### 模式

**自动驾驶 (Autopilot)** — 带阶段门控的完整流水线：
```
探索 → [门控] → 规划 → [门控] → 执行 → [门控] → 审查 → [门控] → 修复循环（最多 3 次）
```

**Ralph** — 持续验证-修复循环：
```
探索 → 规划 → 执行 → 审查 → 修复（最多 20 次迭代）
↓ 被拒绝时
重新探索 → 重新规划 → 执行 → 审查 → 修复（最多 5 个全新周期）
```

**团队 (Team)** — 并行执行：
```
架构师拆分任务 → [门控] → N 个并行执行者 → [门控] → 审查者合并
```

**聊天 (Chat)** — 智能路由：
```
输入 → 意图分类 → 规划 / 架构 / 执行 / 调试 / 追踪 /
                     审查 / 安全审查 / 验证 / 测试 / 探索
```

### 内置智能体

| 智能体 | 模型 | 职责 |
|--------|------|------|
| **planner** | deepseek-reasoner | 战略规划 — 任务分解、验收标准、风险评估 |
| **architect** | deepseek-reasoner | 系统设计 — 架构、组件划分、接口契约 |
| **executor** | deepseek-chat | 实施工程师 — 代码、文件、命令 |
| **debugger** | deepseek-reasoner | 错误诊断、根因分析、修复方案 |
| **tracer** | deepseek-reasoner | 因果追踪 — 多假设竞争、证据收集 |
| **reviewer** | deepseek-chat | 对抗式代码审查（受 Claude Nexus 启发） |
| **security_reviewer** | deepseek-chat | 安全审查 — OWASP Top 10、凭据泄露、注入攻击 |
| **verifier** | deepseek-chat | 完成验证 — 验收标准、边界条件验证 |
| **test_engineer** | deepseek-chat | 测试工程师 — 单元测试、集成测试、覆盖率分析 |
| **explore** | deepseek-chat | 代码库探索者 — 搜索、阅读、理解代码 |

### 项目结构

```
oh-my-deepseek/
├── agents/              # 智能体提示模板（可编辑 Markdown）
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
│   ├── index.js         # CLI 入口 + 横幅
│   ├── agent.js         # 智能体系统 + 执行循环 + 子智能体生成
│   ├── client.js        # DeepSeek API 客户端（原生 fetch，无依赖）
│   ├── config.js        # 配置：环境变量 >> 项目 >> 用户 >> 默认
│   ├── mailbox.js       # 智能体间消息通信
│   ├── mcp.js           # MCP 服务器（JSON-RPC over stdio）
│   ├── orchestrator.js  # 自动驾驶 / 团队 / 聊天编排
│   ├── state.js         # 会话持久化、ADR、记忆
│   └── tools/
│       ├── bash.js      # Shell 执行
│       ├── file.js      # 读 / 写 / 编辑
│       ├── index.js     # 工具注册表
│       └── search.js    # Glob + Grep
├── test/
│   └── mcp-test.js      # MCP 协议测试
└── banner-pixels.txt    # 像素画横幅数据
```

## 配置

优先级：**环境变量** > **项目 `.omd/config.json`** > **用户 `~/.omd/config.json`** > **默认值**

```bash
export OMD_API_KEY=sk-...          # API 密钥（回退到 DEEPSEEK_API_KEY）
export OMD_MODEL=deepseek-chat     # 默认模型
export OMD_REASONER_MODEL=deepseek-reasoner
export OMD_BASE_URL=https://api.deepseek.com
export OMD_MAX_TOKENS=8192
export OMD_TEMPERATURE=0.7
export OMD_DEFAULT_MODE=autopilot   # autopilot, team, chat
```

## MCP 集成

OMD 可作为标准 MCP 服务器运行，兼容 Claude Code、Codex CLI、Cursor 及任何 MCP 客户端：

```bash
omd mcp
```

暴露的工具：`omd_autopilot`、`omd_team`、`omd_chat`、`omd_explore`、`omd_sessions`、`omd_decisions`、`omd_memory`。

Claude Code 配置示例：

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

## 致谢

oh-my-deepseek 并非凭空而生。它是一份合成之作——从那些推动 AI 编码智能体边界的项目中借鉴、混编、重组了各种思想。

**AgentSys** 教会我们阶段门控——在继续之前验证阶段输出，及早捕获错误输出。探索→规划→执行→审查流水线正是遵循了这一原则。

**Harmonist** 教会我们 LLM 永远不应看到它不能使用的工具。工具模式在定义时过滤，而非执行时。这是一个微妙但深刻的洞见。

**结构化智能体间通信**——通过邮箱系统发送 DELEGATE、REPORT、QUERY、ALERT、APPROVE、REJECT 类型化消息，让智能体在无混乱的情况下交换信息。

**ittybitty** 教会我们递归子智能体生成。一个智能体可以为专注的子任务生成另一个智能体，后者又可以生成下一个。`agent` 工具是 OMD 的核心递归机制。

**OMC/OMX** 教会我们自动驾驶流水线、带并行工作者的团队模式，以及 Ralph 验证-修复循环——不懈迭代直至输出正确。

**Claude Nexus** 教会我们对抗式审查。假设每个变更都隐藏着问题，直到被证明无害。"最坏会出什么问题？"改变了你阅读代码的方式。

**autoapp-toolkit** 教会我们智能体需要记忆。ADR 决策日志、MEMORY.md、跨会话状态——让系统从自身历史中学习。

**自适应上下文压缩**——系统消息完整保留，最近消息全文保留，较旧的工具结果截断为摘要。任何长时间运行的智能体循环的实际必需。

向这些项目的作者和维护者致敬：OMD 能成为今天的模样，正是因为你们展示了什么是可能的。

## 许可

MIT
