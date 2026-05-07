# oh-my-deepseek (omd)

> [English](README.en.md) | **中文**

**DeepSeek 多智能体编排层。** 零依赖框架，将 DeepSeek API 转化为多智能体编码系统——自主执行、并行团队模式、交互式聊天和 MCP 集成。
四种模式
1  Standalone CLI mode               ← 直接终端使用，无需编码智能体
2  在 Claude Code / Codex 中运行 OMD  ← 在claudecode、codex等智能体使用 DeepSeek + OMD MCP
3  Via MCP with Claude Code / Codex   ← 仅注册 OMD 为 MCP，不改智能体配置，由其他智能体调用omd进行编程
4  Manual MCP configuration           ← 显示 JSON 模板，自行配置mcp


<img width="1913" height="822" alt="image" src="https://github.com/user-attachments/assets/b96bf41c-fa95-43b3-8c9d-857ba2664ab7" />

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/Dreamfutura-Stephen/oh-my-deepseek.git
cd oh-my-deepseek

# 全局安装（使 omd 命令可用）
npm install -g .

# 设置 API 密钥
export OMD_API_KEY=sk-your-key-here

# 自动驾驶模式运行
omd run "将用户认证模块重构为 JWT"

# 或启动交互式聊天
omd chat
```

## 新手入门

如果你是第一次使用 OMD，按以下步骤从零开始：

### 1. 安装

```bash
npm install -g oh-my-deepseek
```

效果：

```
added 1 package in 2s
```

确认版本：

```bash
omd --version
```

效果：

```
omd v1.x.x
```

### 2. 设置 API 密钥

```bash
export OMD_API_KEY=sk-your-key-here
```

> 建议写入 `~/.bashrc` 或 `~/.zshrc` 以避免每次重复输入。

### 3. 初始化项目结构

```bash
omd setup
```

效果（含鲸鱼横幅，此处省略）:

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

交互式安装向导会自动检测你的环境（已安装的编程智能体、API Key、MCP 状态），然后根据你的选择引导完成配置：

- **MCP 模式**（选项 1）：检测到 Claude Code 且配置了 DeepSeek，自动注册 OMD 为 MCP 服务器
- **独立模式**（选项 2）：配置 API Key 并验证连接，直接使用 `omd run` / `omd chat`
- **手动配置**（选项 3）：显示适用于各客户端的 JSON 配置模板

> 如果检测到的编程智能体配置的不是 DeepSeek 接口，OMD 会给出警告提示，让你确认后再继续。

向导也会创建 `.omd/` 文件夹（含 `sessions/`、`memory/`、`logs/` 子目录）和默认配置文件。所有会话记录和决策日志都会保存在这里。

### 4. 环境检查

```bash
omd doctor
```

效果：

```
  ✓ Node.js v22.x.x
  ✓ API key — sk-abcd1234...
  ✓ .omd/ directory
  ✓ Config loaded — model: deepseek-v4-flash
  ✓ DeepSeek API — connected
```

全部 ✓ 通过即可开始使用。如有 ✗ 项，按提示修复。

### 5. 快速烟雾测试

跑一个最简单的任务确认一切正常：

```bash
omd run "回复：OMD-OK"
```

效果：

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

看到 `▶ Mode: autopilot`、各阶段执行日志、最终 `✓ Done`，说明系统运转正常。

### 6. 模式详解与选择

根据任务类型选择合适的执行模式。每种模式有独立的流水线和终端输出特征。

---

#### 自动驾驶模式（Autopilot）— `omd run "任务"`

**适用场景**：写新功能、添加模块、自动化重构等常规编码任务。

**使用模型**：
| 阶段 | 模型 | 说明 |
|------|------|------|
| 探索 explore | deepseek-v4-flash | 快速搜索代码库，寻找相关文件 |
| 规划 plan | deepseek-v4-pro | 强推理能力，设计架构和方案 |
| 执行 execute | deepseek-v4-flash | 快速编写和修改代码 |
| 审查 review | deepseek-v4-flash | 经济高效的代码审查 |

**执行流水线**：
```
探索 → [门控] → 规划 → [门控] → 执行 → [门控] → 审查 → [门控] → 修复循环（最多 3 次）
```

**终端效果**：

```
▶ Mode: autopilot                    ← 模式标识
⚡ stage — explore                    ← 探索代码库
⚡ stage — plan                       ← 架构设计
⚡ stage — execute — Implementing...  ← 编写代码
⚡ stage — review — Adversarial...    ← 对抗式审查
⚡ stage — fix — Applying fixes...    ← 按审查意见修复（最多 3 轮）
✓ All changes approved.              ← 审查通过
✓ Done.
```

**关键行为**：
- 每个阶段之间有**门控检查**：探索太短？规划没有步骤？执行没改代码？门控会发出警告
- 审查若返回 `NEEDS_CHANGES`，自动进入修复循环，最多重试 3 次
- 审查若返回 `REJECTED`，立即停止，需人工介入
- `▶ Mode: autopilot` 表示标准自动驾驶（3 次修复上限）

---

#### Ralph 模式 — `omd run '$ralph "任务"'`

**适用场景**：修复 Bug、排查疑难问题、需要反复验证才能通过的复杂任务。

**使用模型**：
| 智能体 | 模型 | 说明 |
|--------|------|------|
| 探索/追踪 explore/tracer | deepseek-v4-pro | 深度推理，定位根因 |
| 规划/架构 plan/architect | deepseek-v4-pro | 每次循环可能完全重新设计方案 |
| 执行 executor | deepseek-v4-flash | 快速迭代修复 |
| 审查 reviewer | deepseek-v4-flash | 多次审查直到通过 |

**执行流水线**：
```
探索 → 规划 → 执行 → 审查 → 修复（最多 20 次迭代）
↓ 如果审查结果 REJECTED ↓
重新探索 → 重新规划 → 执行 → 审查 → 修复（最多 5 个全新周期）
```

**终端效果**：

```
▶ Mode: ralph                         ← 模式标识（ralph，不是 autopilot）
⚡ stage — explore
⚡ stage — plan
⚡ stage — execute — Implementing...
⚡ stage — review — Adversarial...
⚡ stage — fix — attempt 2/20         ← 修复次数显示
⚡ stage — fix — attempt 3/20
...
⟳ ralph_rethink — Rejected...        ← REJECTED 后自动重新探索
⚡ stage — explore — cycle 2          ← 进入第 2 个全新周期
...
✓ All changes approved.
```

**关键行为**：
- 修复循环最多 **20 次**（普通 autopilot 只有 3 次）
- 若审查 `REJECTED`，不停止而是触发**重新探索 + 重新规划**，最多 5 个全新周期
- 每次完全重新设计，而不是在错误方案上修修补补
- 适合测试环境不稳定、边界条件多、需要反复试错的场景

---

#### 团队模式（Team）— `omd team <N> "任务"`

**适用场景**：大规模重构、模块拆分、需要并行处理多个独立子任务。

**使用模型**：
| 智能体 | 模型 | 说明 |
|--------|------|------|
| 架构师 architect | deepseek-v4-pro | 强推理拆分任务，确保子任务边界清晰 |
| 执行者 executor × N | deepseek-v4-flash | N 个并行，经济高效 |
| 审查者 reviewer | deepseek-v4-flash | 检查跨 worker 一致性和集成问题 |

**执行流水线**：
```
架构师拆分任务 → [门控] → N 个执行者并行 → [门控] → 审查者合并
```

**终端效果**：

```
▶ Mode: team                          ← 模式标识
⚡ stage — plan — Team leader...      ← 架构师规划子任务
⚡ stage — execute — 4 workers...     ← N 个 Worker 并行执行
⚡ stage — workers_done               ← 全部 Worker 完成
⚡ stage — review — Reviewing...      ← 审查合并结果
✓ reviewer done
```

**关键行为**：
- 架构师（deepseek-v4-pro）先将任务拆分为 N 个独立子任务
- N 个执行者**并行执行**，互不依赖
- 审查者检查**跨 Worker 的一致性**和集成问题
- 适合：重构数据库层、拆分 monolith、并行实现多个 API

---

#### 聊天模式（Chat）— `omd chat`

**适用场景**：探索代码库、提问、需求不明确时先讨论。

**使用模型**：根据意图自动路由

| 意图 | 路由智能体 | 模型 |
|------|-----------|------|
| 调试 debug / 追踪 trace | debugger / tracer | deepseek-v4-pro |
| 规划 plan / 设计 design | planner / architect | deepseek-v4-pro |
| 审查 review / 安全 security | reviewer / security_reviewer | deepseek-v4-flash |
| 验证 verify / 测试 test | verifier / test_engineer | deepseek-v4-flash |
| 探索 explore / 实施 implement | explore / executor | deepseek-v4-flash |

**执行流程**：
```
输入文本 → 意图分类器 → 路由到对应智能体
```

**终端效果**：

```
▸ 这段代码的逻辑是什么              ← 用户输入
▶ Mode: chat                        ← 聊天模式
...智能体回答...

▸ 修复这个函数的内存泄漏问题         ← 新的输入
▶ Mode: autopilot                   ← 自动切换模式
⚡ stage — explore
...
```

**关键行为**：
- 输入文本自动通过 `classifyIntent` 识别意图
- 不匹配关键词时走聊天模式，单轮问答
- 匹配 implement/debug 等关键词时**自动切换到 autopilot 模式**
- 支持魔法关键词强制指定模式：`$ralph 修复 Bug` → Ralph 模式
- 上下文保持最近 12 条消息

### 模式速查表

| 模式 | 命令 | 迭代上限 | 支持重新探索 | 并行 | 适用场景 |
|------|------|---------|------------|------|---------|
| **Autopilot** | `omd run "..."` | 3 次修复 | ❌ | ❌ | 常规编码、新功能 |
| **Ralph** | `omd run '\$ralph "..."'` | 20 次修复 + 5 周期 | ✅ | ❌ | Bug 修复、疑难排查 |
| **Team** | `omd team <N> "..."` | 1 轮 | ❌ | ✅ N 个 Worker | 大规模重构、模块拆分 |
| **Chat** | `omd chat` | 单轮问答 | — | — | 探索、提问、需求讨论 |

### 7. 魔法关键词速查

在聊天模式或 `omd run` 中可以使用以下前缀强制指定模式：

| 关键词 | 用途 | 终端显示效果 |
|--------|------|------------|
| `$autopilot "..."` | 强制自动驾驶模式 | `▶ Mode: autopilot` → 探索→规划→执行→审查→修复（最多 3 次） |
| `$ralph "..."` | 持续验证-修复循环 | `▶ Mode: ralph` → 20 次迭代 + 5 次重新探索周期 |
| `$team <N> "..."` | 团队并行执行 | `▶ Mode: team` → N 个 Worker 并行 + 审查合并 |

> **注意**：在终端中使用 `$ralph` 等关键词时，务必用单引号包裹整个命令，防止 shell 变量展开：
> ```bash
> # ✓ 正确：单引号防止变量展开
> omd run '$ralph "修复 Bug"'
>
> # ✗ 错误：双引号会被 shell 展开 $ralph → 空值
> omd run "$ralph 修复 Bug"
> ```
>
> **注意引号字符**：任务描述必须使用 ASCII 直引号 `" "`，不能使用中文花引号 `" "` 或 `" "`。Shell 不会识别花引号为字符串边界。
> ```bash
> # ✓ 正确：ASCII 直引号
> omd run '$ralph "实现用户登录功能"'
>
> # ✗ 错误：中文花引号，shell 无法识别
> omd run '$ralph "实现用户登录功能"'
> ```

## 命令

| 命令 | 说明 |
|------|------|
| `omd run "任务描述"` | 自动驾驶执行（探索 → 规划 → 执行 → 审查 → 修复） |
| `omd ralph "任务描述"` | 持续验证-修复循环（Ralph 模式，最多 20 次迭代） |
| `omd team <N> "任务描述"` | N 个工作者的并行团队模式 |
| `omd chat` | 带意图路由的交互式聊天 |
| `omd mcp` | 启动 MCP 服务器（用于 Claude Code、Codex CLI、Cursor） |
| `omd setup` | 初始化 `.omd/` 项目结构 |
| `omd setup-mcp` | 一键注册 MCP 到 Claude Code（自动检测 API Key，无需重复输入） |
| `omd doctor` | 环境和 API 连接检查（含 MCP 集成状态） |
| `omd sessions` | 列出最近的会话 |
| `omd agents` | 列出可用的智能体类型 |

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
| **planner** | deepseek-v4-pro | 战略规划 — 任务分解、验收标准、风险评估 |
| **architect** | deepseek-v4-pro | 系统设计 — 架构、组件划分、接口契约 |
| **executor** | deepseek-v4-flash | 实施工程师 — 代码、文件、命令 |
| **debugger** | deepseek-v4-pro | 错误诊断、根因分析、修复方案 |
| **tracer** | deepseek-v4-pro | 因果追踪 — 多假设竞争、证据收集 |
| **reviewer** | deepseek-v4-flash | 对抗式代码审查（受 Claude Nexus 启发） |
| **security_reviewer** | deepseek-v4-flash | 安全审查 — OWASP Top 10、凭据泄露、注入攻击 |
| **verifier** | deepseek-v4-flash | 完成验证 — 验收标准、边界条件验证 |
| **test_engineer** | deepseek-v4-flash | 测试工程师 — 单元测试、集成测试、覆盖率分析 |
| **explore** | deepseek-v4-flash | 代码库探索者 — 搜索、阅读、理解代码 |

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
export OMD_MODEL=deepseek-v4-flash # 默认模型（V4 Flash，经济快速）
export OMD_REASONER_MODEL=deepseek-v4-pro  # 推理模型（V4 Pro，更强推理能力）
export OMD_BASE_URL=https://api.deepseek.com
export OMD_MAX_TOKENS=8192
export OMD_TEMPERATURE=0.7
export OMD_DEFAULT_MODE=autopilot   # autopilot, team, chat
```

> 注意：`deepseek-chat` 和 `deepseek-reasoner` 旧模型名将于 **2026 年 7 月 24 日** 下线。请尽早迁移到 `deepseek-v4-flash` 和 `deepseek-v4-pro`。

## MCP 集成

OMD 可作为标准 MCP 服务器运行，兼容 Claude Code、Codex CLI、Cursor 及任何 MCP 客户端。

### 一键配置（推荐）

如果你已在终端设置了 `OMD_API_KEY` 或 `DEEPSEEK_API_KEY`，只需一条命令即可将 OMD 注册到 Claude Code：

```bash
omd setup-mcp
```

效果：

```
✓ OMD registered in Claude Code config.
  Config: /Users/you/.claude/claude.json
  Key: sk-abcd12...
```

之后重启 Claude Code，即可在聊天中使用 OMD 的工具（如 `/mcp` 查看）。

> **无需重复输入 API Key**：`omd setup-mcp` 自动从当前终端环境检测 `OMD_API_KEY` 或 `DEEPSEEK_API_KEY`，写入 Claude Code 配置。后续运行 OMD MCP 时会自动继承。

### 手动启动

```bash
omd mcp
```

暴露的工具：`omd_autopilot`、`omd_team`、`omd_chat`、`omd_explore`、`omd_sessions`、`omd_decisions`、`omd_memory`。

### API Key 优先级

`omd doctor` 会自动检查 MCP 集成状态。API Key 按以下顺序查找：

1. `OMD_API_KEY` 环境变量
2. `DEEPSEEK_API_KEY` 环境变量（与 Claude Code / Codex 共享）
3. `~/.claude/claude.json` 中 `mcpServers.omd.env`（Claude Code MCP 配置）

这意味着如果你已经在使用 Claude Code + DeepSeek，OMD 会自动继承你的 API Key，无需额外配置。

### 手动配置 Claude Code

你也可以手动编辑 `~/.claude/claude.json`：

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
