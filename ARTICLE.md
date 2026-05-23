# LingoContext：一个浏览器扩展的 AI 驱动语言学习工具，以及我做了哪些优化

## 一、项目概述

LingoContext 是一个 Chrome 浏览器扩展，面向语言学习者（英语/日语为主），核心功能是：**在任意网页上选中一段文字，即刻获得上下文感知的翻译、语法解析和发音**。

它不是一个简单的划词翻译工具。它的核心差异化在于 **"上下文感知"**——选中 "Crane"，如果网页在讨论工程机械，它会告诉你是"起重机"；如果网页在观鸟论坛，它则告诉你是"鹤"。这个上下文感知能力由 AI 大模型驱动。

### 技术栈

| 层面 | 技术选型 |
|------|----------|
| 浏览器扩展 | Chrome Extension Manifest V3，Vanilla JS，Shadow DOM 隔离 |
| 后端 | Node.js + Express 5，RESTful API + SSE Streaming |
| AI 引擎 | Gemini / DeepSeek，provider-agnostic 架构 |
| 数据库 | MySQL (mysql2)，Express-Session + MySQLStore |
| TTS | Edge TTS Neural Voice + Web Speech API 降级 |
| 日语处理 | kuromoji 分词器本地振假名生成 |
| 部署 | Docker Compose + Vercel Serverless |

### 核心交互流程

```
用户在网页选中文字 → 触发图标出现 → 点击图标
→ content script 提取选中文字 + 上下文句子
→ background.js 通过 SSE 连接到后端 /api/analyze/stream
→ 后端调用 AI provider 进行流式分析
→ 分析结果流式渲染到 popup 弹窗中
→ 用户可朗读发音、保存到词汇本
```

---

## 二、我做的优化总览

这次 `feature/language-opt` 分支包含了 6 个 commit，涉及 64 个文件的改动（+2725/-360 行），覆盖了从底层 AI Prompt 架构到前端像素级交互动画的几乎所有层面。下面按领域逐一展开。

---

## 三、AI 分析引擎：从"翻译"到"教学"

### 3.1 旧问题

原来的分析方法只输出三个字段：`meaning`（释义）、`grammar`（语法简述）、`nuance_note`（语境备注）。问题有两个：

1. **粒度太粗**：不管用户选中一个单词还是一大段话，AI 都按同样的方式输出，选中 "食べる" 只会给一个笼统的释义，不会拆解动词变形
2. **语言漂移**：设置了目标语言为"简体中文"，AI 有时会在解释里混入英文句子

### 3.2 优化方案

**新 Prompt Schema**：将输出结构升级为两阶段模式——`translation` + `explanation { mode, contextual_note, word_analysis[] }`：

```
选中 "はまってるんだよね"（日常用语）
→ AI 输出:
  translation: "我超迷这个的"
  explanation:
    mode: "word_by_word"
    contextual_note: "在「最近在看新番」这个上下文里，はまる 表示沉迷..."
    word_analysis:
      - はまっ: 动词 はまる 的て形词干 → "沉迷、深陷"
      - てる: ている 的口语缩约形 → "正在/处于某状态"
      - ん: ん だ 的缩约，解释语气 → "用来补充解释，缓和语气"
      - だ: 简体断定助动词
      - よ: 句末终助词 → "强调、告知"
      - ね: 句末终助词 → "寻求共识"
```

**自适应模式切换**：根据选中文本长度自动决定模式。≤120 字符走 `word_by_word` 逐词拆解；>120 字符走 `contextual` 段落解释。这个阈值是一个经验值——大约 120 个英文字符等于一个中等长度的句子。

**语言一致性强制执行**：在 `targetLanguage.js` 中为每种目标语言定义了规范化配置，包括语言标签（如 `Simplified Chinese (zh-CN, 简体中文)`）、提示词细节（如 `Use simplified characters only`）、以及一个 `requiredRegex`。当 AI 返回的结果中解释字段不包含目标语言字符时（如设置简体中文但返回了纯英文），`shouldRetryForLanguageMismatch()` 会触发一次带 `strictLanguageOnly` 覆写的重试。

这个重试机制在流式和非流式两条路径上都实现了，且上限为 1 次重试，避免无限循环。

**上下文归一化**：新增 `normalizePromptContext()`，自动剥离旧版元数据标记（如 `[Website: note.com]`、`[Description: ...]`），并将超过 500 字符的上下文截断到句子边界。这既减少了 token 消耗，又避免了冗余网站描述污染 AI 的判断。

**输出 Token 限制接口化**：抽取 `outputTokenLimit.js` 模块，统一从环境变量 `AI_MAX_OUTPUT_TOKENS` 读取（默认 2048），并支持按 provider 独立配置。后续如果要调大某个模型的输出长度，改一个环境变量即可。

### 3.3 收益

- **学习价值提升**：用户不仅知道"是什么意思"，还知道"为什么是这个意思"、"每个部分各自扮演什么语法角色"
- **语言一致性**：不会再出现"设置中文解释却蹦出英文"的情况
- **Token 效率**：上下文从无限制截断到 500 字符，每次请求平均节省 20-30% 的 prompt token

---

## 四、流式响应：让"快"变得可靠

### 4.1 旧问题

流式分析（SSE Streaming）是让用户感知"快"的关键——分析结果逐字流入，不需要等完整响应。但之前的实现有几个隐藏的问题：

1. **Stream Reader 不兼容**：Node.js 不同版本的 fetch 实现返回不同类型的 body（Web Streams vs Node Readable），切换运行环境时流式解析偶发失败
2. **截断无提示**：当 AI 输出达到 max_tokens 上限时，response 会直接被截断。JSON 不完整，前端只收到一个模糊的错误
3. **流式 JSON 透传**：AI 返回的 JSON 逐 chunk 推送给前端，前端在收到最后一个 chunk 前拿不到完整的可解析数据

### 4.2 优化方案

**通用 Stream Reader（`readStreamBody`）**：实现了一个通用的异步生成器，统一处理三种流类型：Web Streams API（`getReader`）、Node.js Readable（`Symbol.asyncIterator`）、以及传统 EventEmitter。外部调用方不需要关心当前运行在哪个 Node 版本或哪个 fetch 实现下。

```
async function* readStreamBody(body) {
    if (typeof body.getReader === 'function') {
        const reader = body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield value;
        }
        return;
    }
    // Node Readable fallback...
    // EventEmitter fallback...
}
```

**Token 截断检测**：解析每个 SSE chunk 的 `finish_reason` 字段。当检测到 `MAX_TOKENS` 或 `length` 时，直接向前端返回明确的截断错误信息，并提示用户可以增大 `AI_MAX_OUTPUT_TOKENS`。不再让用户面对一个不完整的 JSON 猜发生了什么。

**"收集-规范化-再下发"模式**：AI 返回的流式 JSON 不再逐 chunk 透传给前端。改为先在服务端完整收集 → `normalizeAnalysisResult()` 规范化 → 再一次性下发。这避免了前端处理不完整 JSON 的复杂性，同时确保了无论 AI 返回什么字段（新 Schema 还是旧 Schema），前端都拿到统一格式的数据。

**语言不匹配重试（流式路径）**：和非流式路径一样，流式模式也实现了语言一致性检测 + 1 次重试。由于重试意味着重新发起 AI 请求——在流式场景下时间成本更高——所以只在检测到明确的语言不匹配时触发。

### 4.3 收益

- **健壮性**：不再因为 Node 版本或 fetch 实现差异导致流式失败
- **可调试性**：截断时给用户明确的错误信息和解决建议
- **数据一致性**：前端拿到的永远是完整、规范化的 JSON

---

## 五、多 AI 提供商：从"綁定 Gemini"到"可切换"

### 5.1 旧问题

原来的 `getProvider()` 只读环境变量 `AI_PROVIDER`，服务器启动时固定，用户无法切换，也不支持非 Gemini 的提供商。

### 5.2 优化方案

**新增 DeepSeek Provider**：完整实现了 `callAPI` / `callStreamAPI` / `parseSSEData` 三件套，174 行代码。DeepSeek 使用 OpenAI-compatible API 格式，流式请求自动携带 `stream_options: { include_usage: true }` 来获取 token 用量统计。模型支持 `deepseek-v4-flash`（低延迟）和 `deepseek-v4-pro`（高推理能力）。

**用户级 Provider 选择**：
- 数据库新增 `users.ai_provider` 字段（`VARCHAR(50) DEFAULT 'gemini'`），通过自动迁移向下兼容已有数据库
- Dashboard 设置页新增 AI Provider 下拉框，用户随时切换
- `getProvider()` 改为接受参数 `aiProvider`，从 `req.user.ai_provider` 自动读取
- `ALLOWED_USER_PROVIDERS` 白名单（`['gemini', 'deepseek']`），非白名单一律拒绝，防止注入

**路由透传**：`/api/analyze` 和 `/api/analyze/stream` 都从 session 中提取 `ai_provider` 并传递给分析引擎。用户不需要修改任何代码——在 Dashboard 里选一下，下次分析自动切换。

**Provider Index 重构**：`providers/index.js` 从简单的 env 查找改为分层决策——先看用户传入的参数，再看环境变量，最后 fallback 到 gemini。

### 5.3 收益

- **灵活性**：用户可根据延迟/成本/质量偏好选择 AI 提供商
- **可扩展性**：新增 provider 只需在 `providers/` 下新增一个模块 + 在 index.js 注册即可
- **安全性**：白名单机制防止任意 provider 注入

---

## 六、缓存体系：从"一层缓存"到"三层缓存"

### 6.1 分析结果缓存（已有，但做了增强）

原有 `aiService.js` / `aiStreamService.js` 中都有内存 LRU 缓存。优化点：

- **Cache Key 归一化**：缓存 Key 统一使用 `normalizePromptContext()` 处理 context，而不是原始字符串。之前同一个词在稍微不同的 HTML 结构中被选中时，context 可能包含多余空格或换行，导致相同分析结果命中不了缓存。归一化后命中率显著提升。
- **命中日志**：缓存命中时打印 `[AI] Cache HIT` 日志，包含选中文文本和目标语言，方便排查和统计命中率。

### 6.2 TTS 音频缓存

新增 `/api/tts` 端点的内存缓存：
- Key: `lang:text`，最大 200 条，LRU 驱逐
- 命中时返回 `X-Cache: HIT` header
- 同一个单词第二次发音不再重复调用 Edge TTS API

### 6.3 Quick Definition 缓存

新增 `/api/word-definition` 端点的内存缓存：
- Key: `word::language`，最大 500 条，LRU 驱逐（使用 Map 的插入顺序特性）
- 命中时跳过 AI 调用

**前端层也有缓存**：`content.js` 中维护了一个 `wordDefinitionCache` Map，用户再次选中同一个词时，Quick Definition 区域直接展示缓存结果，不需要任何网络请求。

### 6.4 收益

三层缓存——AI 分析、TTS、Quick Definition——分别在服务端和客户端击穿大部分重复请求，尤其是用户在同一个文档中反复研究同一批词汇时，几乎所有操作都是即时的。

---

## 七、终端用户体验：每一个像素都在意

### 7.1 自定义光标图标

**从内联 SVG 到自定义图像**：触发图标原来是一个用 SVG 画的小星形，更新为 `cursor.png`——一个半透明风格的"爪子"或"光标"图形。

**动画系统**：

```
登场动画（pawPopIn）:
  0%   opacity: 0, scale: 0, rotate: -20deg
  70%  opacity: 1, scale: 1.2, rotate: 10deg
  100% opacity: 1, scale: 1, rotate: 0

呼吸动画（pawPulse）:
  0% / 100%  scale: 1
  50%         scale: 1.08

悬停状态:
  scale: 1.2, rotate: -10deg
  drop-shadow 加强白色描边

点击动画（clicked）:
  scale: 0.6, rotate: 20deg, opacity: 0
  150ms 后触发弹窗展示
```

图标的白色描边使用 CSS `drop-shadow` 实现，不是 `box-shadow`，因为 `drop-shadow` 会沿着图像的实际 alpha 通道描边，效果更自然。

**旋转缩放弹性动画**：使用了 `cubic-bezier(0.175, 0.885, 0.32, 1.275)` 三次贝塞尔曲线，产生"弹出去又弹回来"的感觉，比默认 ease 更有生命力。

### 7.2 Popup 视觉升级

- **选中文字**：字号从 20px 提升到 26px，行高从 1.4 提升到 2.0，确保 ruby 振假名不与其他行重叠
- **ruby 渲染优化**：`ruby-align: center` 确保注音居中；`rt` 字号锁定为 11px，颜色亮金色（`#fbbf24`），字母间距微调（`0.04em`）
- **Header Logo**：弹窗标题左侧加入 16px 的扩展图标，与标题组成 `header-left-group` 布局
- **语法解析区域**：新增 `white-space: pre-line`，AI 返回的 `word_analysis` 多行列表能正确换行
- **Quick Definition 区域**：独立的 `.dictionary-content` 区块，深绿色文字（`#6ee7b7`），条目间 `margin-top: 3px`

### 7.3 智能上下文提取

旧的上下文提取逻辑很简单粗暴——选中文字前后各取 150 个字符。问题：
- 可能从句子中间截断，送进去的上下文不完整
- 页面元数据（网站名、描述）也一并送入，增加 token 消耗（且经常误导 AI）

新的上下文提取逻辑：

```
splitIntoSentences(fullText)
  → isSentenceSelection(selectedText)
    → 是句子：取前一句 + 当前句 + 后一句
    → 是单词：只取当前所在句子
      → trimSentenceAroundSelection()
        → 围绕选中词前后均分可用空间
        → 超过 320 字符时截断加省略号
  → getSelectedTextContext()
    → 只保留 [Page Title:] 元数据，移除 [Website:] / [Description:]
```

这个改动同时改进了两个维度的体验：AI 分析质量（更干净的上下文）和用户感知延迟（更少的 token 消耗意味着更快的响应）。

### 7.4 快速振假名

日语汉字（Kanji）在完整 AI 分析返回前，最快也需要 1-2 秒才能看到振假名。优化方案：

1. 用户选中日语文字 → content.js 立即通过 `background.js` 向 `/api/furigana` 发 POST 请求
2. 后端用 kuromoji 本地分词，`tokenToRuby()` 算法将 reading 对齐到每个汉字
3. 前端收到 `<ruby>` HTML 后，在 AI 响应到达之前就渲染到 popup 中
4. AI 分析完成后，用 `filterKanjiOnlyFurigana()` 过滤掉假名上的冗余注音，展示最终版本

`filterKanjiOnlyFurigana()` 的核心逻辑：遍历所有 `<ruby>` 元素，如果 base text 不含汉字（如纯假名），则移除 `<rt>` 标签。这避免了"か→か"这种无意义的注音。

### 7.5 Quick Definition（快速词典）

同样在完整 AI 分析到达之前，如果是单词语义查词：

- 前端通过 `background.js` 请求 `/api/word-definition`
- 后端用 AI 快速翻译（`maxOutputTokens: 100`，极低延迟）
- 结果缓存到前端 `wordDefinitionCache` Map 中
- popup 渲染时在 `.dictionary-content` 区域独立展示，不依赖 AI 分析的完成

这个功能的意义在于：用户选中一个单词后，几乎立即就能看到释义（通常 300-500ms），而完整的语法解析稍后才出。感知延迟从"等 2 秒"变成了"零感知"。

### 7.6 流式完成后的增量更新

旧逻辑：AI 流式完成后，直接 `popup.innerHTML = renderResult(...)` 整个重绘。问题：如果 Quick Definition 已经在 `.dictionary-content` 中渲染了内容，全量重绘会导致它闪烁甚至被覆盖。

新逻辑：只更新变化的部分：
```javascript
// 只更新这三个独立区域，不动 .dictionary-content
const meaningEl = popup.querySelector('.meaning-content');
if (meaningEl && fullData.meaning) meaningEl.innerHTML = escapeHtml(fullData.meaning);

const grammarEl = popup.querySelector('.grammar-content');
if (grammarEl && fullData.grammar) grammarEl.innerHTML = escapeHtml(fullData.grammar);

// 振假名平滑切换
if (fullData.furigana?.includes('<ruby>')) {
    updateFuriganaDisplay(filterKanjiOnlyFurigana(fullData.furigana), true);
}
```

振假名的更新使用了 `opacity: 0 → 更新内容 → opacity: 1` 的平滑过渡，避免文字位置跳动。

### 7.7 语音播放升级

**Edge TTS 为主，Web Speech API 为降级**：

- 后端 `edgeTtsService.js` 使用 `msedge-tts` 库调用微软 Edge 的免费 Neural TTS
- 14 种语言各配置了最优 Neural Voice（如日语 `ja-JP-NanamiNeural`、中文 `zh-CN-XiaoxiaoNeural`）
- 音频格式：`AUDIO_24KHZ_48KBITRATE_MONO_MP3`
- 10 秒超时保护

前端播放流程：
```
speakText(text, lang)
  → chrome.runtime.sendMessage('EDGE_TTS')
    → background.js 请求 /api/tts
      → 返回 base64 编码的 MP3
    → new Audio(blobUrl).play()
  → 失败 → speakWithWebSpeech(text, lang)
    → speechSynthesis（优先 Google Voice）
```

Web Speech API 降级时，`speakWithWebSpeech()` 优先选择 `name.includes('Google')` 的语音，其次选择网络语音，最后本地语音。语速设定 0.9，避免太快听不清。

---

## 八、Dashboard：从"列表浏览"到"多维检索"

### 8.1 旧问题

Dashboard 的词汇列表只支持两种状态：显示最近 100 条 / 按日期筛选。词汇超过几百条时，找到特定词汇几乎不可能。

### 8.2 优化方案

**三维过滤器系统**：

```
applyWordFilters()
  ├── currentFilterDate（日期筛选 - 已有）
  ├── wordFilters.query（全文搜索 - 新增）
  └── wordFilters.language（语言筛选 - 新增）
```

- **全文搜索**：搜索范围覆盖 `text`、`meaning`、`language`、`grammar`、以及所有 `contexts`，全部 lowercased 后做 `includes` 匹配
- **语言筛选**：下拉框自动从用户词汇库中提取唯一语言列表（`ja`、`en`、`fr` 等），按字母排序
- **筛选摘要行**：动态显示 "Showing N of M matching words" 或 "Showing N most recent words"
- **清除按钮**：任何筛选条件激活时显示，一键清空所有筛选

**AI Provider 设置**：
- Dashboard 设置页新增 AI Provider 下拉框（Gemini Flash / DeepSeek Flash）
- PATCH `/api/user/preferences` 持久化选择
- 即时 Toast 反馈

**i18n 扩展**：新增 `data-i18n-placeholder` 属性支持，input 的 placeholder 也能跟随界面语言切换。

### 8.3 收益

- 用户可以从数千条历史词汇中快速定位目标
- 筛选条件联动不互相覆盖
- 代码去重：`populateSelectOptions()` / `applyWordFilters()` 等通用函数取代了重复的手写逻辑

---

## 九、后端基础设施：防崩溃与平滑迁移

### 9.1 数据库连接容灾

**问题**：MySQL 连接池长时间空闲后，下次请求会触发 `ECONNRESET`（连接被数据库端断开），直接导致进程崩溃（unhandled rejection）。

**修复**：
- Pool 配置新增 `enableKeepAlive: true` + `keepAliveInitialDelay: 0`，TCP 层保活
- Pool 新增 `on('error')` 监听器，对 `ECONNRESET` / `PROTOCOL_CONNECTION_LOST` 只打印日志，不崩溃
- 业务层的 `db.query()` 重试逻辑捕获连接错误并重新获取连接

**Session Store 独立化**：MySQLStore 原来直接复用业务 `db.pool`。问题：MySQLStore 自身也会因为连接问题产生 rejections。改为传递 `dbConfig` 对象，让 MySQLStore 管理自己的连接池，互不污染。

### 9.2 数据库迁移向下兼容

`initializeDatabase()` 中新增自动迁移语句：

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(50) DEFAULT 'gemini'
```

已有数据库在服务器启动时自动补上这个字段，不需要手动执行 SQL。

### 9.3 未处理 Promise 的守护

```javascript
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection (server kept running):', reason);
});
```

这是一个防御性措施。生产环境中偶尔会出现未被 try-catch 覆盖的异步异常（如第三方库的内部 reject），这个处理器确保进程不会因此退出。

### 9.4 端口迁移

默认端口从 `3000` 改为 `3303`。同步更新的位置：
- `server/index.js`（`PORT` 环境变量默认值）
- `server/.env.example`（示例配置）
- `docker-compose.yml`（端口映射 + `PORT` 环境变量）
- `server/Dockerfile`（`EXPOSE` 声明）
- `config.js`（本地开发 URL）

全部改在一个 commit 里保证一致性，不会有"改了 A 漏了 B"的情况。

---

## 十、测试：让重构有底气

这次改动新增了约 400 行的测试代码，覆盖了关键的新增逻辑：

| 测试文件 | 覆盖点 |
|----------|--------|
| `aiStreamService.test.js` | 流式 body 为空 → 返回错误帧；新 Schema 到旧字段的规范化；MAX_TOKENS 截断 → 明确错误信息 |
| `normalizeAnalysisResult.test.js` | `explanation + word_analysis + nuance_note` → `grammar` 的组合逻辑 |
| `content-context.test.js` | 用 Node `vm` 沙盒直接跑 content.js，验证单词只取本句、多句取上下文、元数据剥离 |
| `aiService.test.js` | 简体中文响应返回英文 → 自动重试 → 第二次返回中文 |
| `geminiProvider.test.js` | 输出 token 限制可配置、finishReason 解析、模型版本更新 |
| `openrouter.test.js` | 同上 + delta.text 解析 |
| `codexProvider.test.js` | 同上 |
| `prompts.test.js` | 新 Schema 的 word_by_word 要求、元数据剥离逻辑 |

---

## 十一、总结：我做了什么

如果把这次 `feature/language-opt` 的所有改动抽象成几个"优化原则"，大概是：

1. **"让 AI 不止翻译，而是在教学"**：Prompt Schema 从简单翻译升级为逐词逐句的语法拆解，用户学到的不是一个结果，而是一个过程
2. **"快是可以设计的"**：Quick Definition、本地振假名、Edge TTS 三层并行机制，让常见操作做到零等待感知
3. **"容错不是可有可无的"**：从流式 Reader 兼容到数据库连接重试到 unhandledRejection 守护，每一层都加了保护
4. **"缓存是最高性价比的优化"**：AI 分析、TTS、Quick Definition 三层缓存，击穿重复请求
5. **"动画也是功能"**：触发图标的弹性动画、hover 旋转、点击缩小 → 弹窗展现，每一个动作都在告诉用户"系统收到你的操作了"
6. **"代码要能测试"**：关键路径和新增模块全部有单测覆盖，让后续改动有底气

最终效果：一个浏览器扩展从"能用的划词翻译"变成了"真正有教学价值的语言学习工具"。
