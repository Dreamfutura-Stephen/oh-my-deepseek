# oh-my-deepseek (omd)

> [English](README.md) | **中文**

**DeepSeek 多智能体编排层。** 零依赖框架，将 DeepSeek API 转化为多智能体编码系统——自主执行、并行团队模式、交互式聊天和 MCP 集成。

## 快速开始

```bash
# 全局安装
npm install -g oh-my-deepseek

# 或直接运行
npx oh-my-deepseek

# 设置 API Key
export OMD_API_KEY=sk-your-key-here

# 以自主驾驶模式运行
omd run "将认证模块重构为 JWT"

# 或启动交互式聊天
omd chat
```

## 命令

| 命令 | 说明 |
|---------|------|
| `omd run "task"` | 自主执行（探索 → 计划 → 执行 → 审查 → 修复） |
| `omd team <N> "task"` | N 个工作线程并行团队 |
| `omd chat` | 智能路由的交互式聊天 |
| `omd mcp` | 启动 MCP 服务器（供 Claude Code、Codex CLI、Cursor 使用） |
| `omd setup` | 初始化 `.omd/` 项目结构 |
| `omd doctor` | 环境和 API 连接检查 |
| `omd sessions` | 列出最近的会话 |
| `omd agents` | 列出可用的智能体类型 |

### 魔法关键词

在聊天或 `run` 中使用：

```
$autopilot "实现 REST API"    # 强制进入自主驾驶模式
$team 4 "重构数据库"           # 4 个工作线程的团队模式
$ralph "修复性能问题"          # 持久验证-修复循环
```

## 架构

### 模式

**自主驾驶（Autopilot）** — 带阶段闸门的完整流水线：
```
explore → [gate] → plan → [gate] → execute → [gate] → review → [gate] → fix 循环（最多 3 次）
```

**团队（Team）** — 并行执行：
```
架构师拆分任务 → [gate] → N 个并行执行器 → [gate] → 审查者合并
```

**聊天（Chat）** — 智能路由：
```
输入 → 意图分类器 → debugger / reviewer / architect / explore / executor
```

### 内置智能体

| 智能体 | 模型 | 角色 |
|-------|------|------|
| **architect** | deepseek-reasoner | 系统设计、规划、权衡分析 |
| **executor** | deepseek-chat | 实现、文件创建、命令执行 |
| **debugger** | deepseek-reasoner | 缺陷诊断、根因分析 |
| **reviewer** | deepseek-chat | 对抗性代码审查（受 Claude Nexus 启发） |
| **explore** | deepseek-chat | 代码库搜索与理解 |

## 鸣谢

oh-my-deepseek 并非孤立的产物。它是一个综合体——从多个探索 AI 编程智能体边界的项目中借用、重组和融合而来的思想。每一个都在其中留下了印记。

**AgentSys** 教会我们阶段闸门——在进入下一阶段前验证输出，及早发现不良结果。 explore→plan→execute→review 的流水线正是以此为纪律。

**Harmonist** 教会我们 LLM 不该看到它不能使用的工具。工具架构在定义时就被过滤，而非在执行时。一个低调却深刻的洞察。

**结构化智能体间通信** — 通过 DELEGATE、REPORT、QUERY、ALERT、APPROVE、REJECT 类型的信箱消息，让智能体之间有序交流。

**ittybitty** 教会我们递归子智能体生成。一个智能体可以为特定子任务生成另一个，而后者又能继续生成下一个。`agent` 工具是 OMD 的核心递归机制。

**OMC/OMX** 教会我们自主驾驶流水线、带并行工作线程的团队模式，以及 Ralph 验证-修复循环——不达正确不罢休的迭代精神。

**Claude Nexus** 教会我们对抗性审查。假设每个变更都隐藏着问题，直到被证明并非如此。"最坏情况是什么？"——这句话改变了阅读代码的方式。

**autoapp-toolkit** 教会我们智能体需要记忆。ADR 决策日志、MEMORY.md、跨会话状态——让系统从自身历史中学习。

**自适应上下文压缩** — 系统消息保持完整，近期消息全部保留，较早的工具结果截断为摘要。任何长时间运行的智能体循环都离不开的实用策略。

向这些项目的作者和维护者致敬。OMD 之所以成为今天的模样，是因为你们展示了可能的方向。

### 项目结构

```
oh-my-deepseek/
├── agents/              # 智能体提示模板（可编辑的 Markdown）
│   ├── architect.md
│   ├── debugger.md
│   ├── executor.md
│   ├── explore.md
│   └── reviewer.md
├── src/
│   ├── index.js         # CLI 入口 + 启动横幅
│   ├── agent.js         # 智能体系统 + 执行循环 + 子智能体生成
│   ├── client.js        # DeepSeek API 客户端（原生 fetch，无依赖）
│   ├── config.js        # 配置：环境变量 >> 项目 >> 用户 >> 默认值
│   ├── mailbox.js       # 智能体间通信（Houmao）
│   ├── mcp.js           # MCP 服务器（基于 stdio 的 JSON-RPC）
│   ├── orchestrator.js  # 自主驾驶 / 团队 / 聊天编排
│   ├── state.js         # 会话持久化、ADR、记忆
│   └── tools/
│       ├── bash.js      # Shell 执行
│       ├── file.js      # 读取 / 写入 / 编辑
│       ├── index.js     # 工具注册中心
│       └── search.js    # Glob + Grep
├── test/
│   └── mcp-test.js      # MCP 协议测试
└── banner-pixels.txt    # 像素艺术横幅数据
```

## 配置

优先级：**环境变量** > **项目 `.omd/config.json`** > **用户 `~/.omd/config.json`** > **默认值**

```bash
export OMD_API_KEY=sk-...          # API Key（回退到 DEEPSEEK_API_KEY）
export OMD_MODEL=deepseek-chat     # 默认模型
export OMD_REASONER_MODEL=deepseek-reasoner
export OMD_BASE_URL=https://api.deepseek.com
export OMD_MAX_TOKENS=8192
export OMD_TEMPERATURE=0.7
export OMD_DEFAULT_MODE=autopilot  # autopilot, team, chat
```

## MCP 集成

OMD 可以作为标准 MCP 服务器运行，兼容 Claude Code、Codex CLI、Cursor 及任何 MCP 客户端：

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

## 许可

MIT
