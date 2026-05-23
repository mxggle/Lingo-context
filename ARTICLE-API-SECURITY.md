# 我以为我的 API 只有插件能调——直到我自己 curl 了一下

## 一、那个让我突然清醒的问题

那天我和朋友在聊 LingoContext 的后端架构，他问了一句很朴素的问题：

> "你这个 AI 接口，是不是只有插件能调？别人不能随便用吧？"

我下意识地说"当然啊，CORS 限制了 origin，只允许 chrome-extension:// 的请求"——但话说到一半我就开始心虚。因为我突然意识到，我没真正验证过这件事。

我打开终端，对着自己的生产 API 跑了一条：

```bash
curl -X POST https://lingo-context-api.vercel.app/api/analyze/stream \
  -H 'Content-Type: application/json' \
  -H 'Origin: chrome-extension://gjcgecdgmhbehagblealbdghojkoeakk' \
  -d '{"text":"hello"}'
```

返回了一段流式 JSON，里面是 Gemini 给我的回答。**我刚刚用任何人都能写出来的一行 curl，调用了我自己花钱的 AI 服务。**

那一刻我意识到，我对"扩展独占 API"的理解从一开始就是错的。这篇文章是我对这个误区的反思，以及我怎么把这件事修对。

---

## 二、一个常见但致命的误区：「只让我的扩展调用 API」

很多人一上来想到的方案是这样的：

- 在 CORS 配置里加上 `chrome-extension://<我的扩展ID>` 白名单
- 检查请求的 `Origin` header，匹配就放行
- 觉得"反正别人不知道我的扩展 ID，应该问题不大"

这套思路在浏览器的安全模型下有意义——但用来防止 API 滥用，**它有一个致命缺陷**：

### 2.1 扩展 ID 是公开的

打开 Chrome Web Store，扩展的安装链接里就有 ID：

```
https://chromewebstore.google.com/detail/lingocontext-%E2%80%94-context-aw/gjcgecdgmhbehagblealbdghojkoeakk
                                                                                ────────────────────────────────
                                                                                      这就是扩展 ID
```

### 2.2 扩展代码是公开的

Chrome 扩展打包成 `.crx`，本质上是个 zip。任何人下载之后解压，content.js、background.js、manifest.json 都能直接读。所以"在客户端藏个秘密 key 用来验证"——这条路从一开始就不存在。

### 2.3 `Origin` header 可以被任意伪造

浏览器在发请求时会自动设置 `Origin`，但服务器收到的只是一段字符串。`curl -H 'Origin: chrome-extension://任意ID'` 一样能通过 CORS 白名单检查。CORS 是用来保护**用户的浏览器**不被恶意网站滥用——它不是用来防 curl 的。

### 2.4 真正的安全模型

把这三件事拼起来，结论就清晰了：

> **"只让我的扩展调 API" 在技术上不可达。能被信任的从来不是客户端，而是登录用户。**

扩展只是 UI 层，是用户操作 API 的入口。被信任的主体是**通过 Google OAuth 完成登录、持有 session cookie 的真实用户**。

修复方向因此也明确了：所有花钱的 API 都必须要求认证。CORS 留着，但作为深度防御的一层，不是唯一一层。

---

## 三、现状审计：哪些接口在裸奔

抱着重新审视的心态，我把所有路由扫了一遍：

| 路由 | 是否要求登录 | 备注 |
|------|--------------|------|
| `/api/words/*` | ✅ `ensureAuthenticated` | 词汇本 CRUD |
| `/api/user/*` | ✅ `ensureAuthenticated` | 用户偏好 |
| `/api/analyze` | ❌ **裸奔** | 调用 Gemini / DeepSeek |
| `/api/analyze/stream` | ❌ **裸奔** | 流式调用 Gemini / DeepSeek |
| `/api/tts` | ❌ **裸奔** | Edge TTS，消耗带宽 |
| `/api/word-definition` | ❌ **裸奔** | 调用 AI 做快速翻译 |
| `/api/furigana` | ❌ 开放 | 本地 kuromoji，便宜 |
| `/api/dictionary` | ❌ 开放 | 调用免费第三方词典 |

数据库 + 词汇本是好的，但**所有真正烧钱的 AI 接口都是开放的**。开发初期我把认证加在了"用户数据相关"的路由上，但忘了"AI 调用 = 用户数据相关"这件事。从攻击者视角，AI 接口反而是最有动机滥用的——别人不一定关心你的词汇本，但绝对愿意白嫖你的 Gemini 配额。

---

## 四、修复方案：三层防御

我没有采用单一的"修一把就完事"的思路，而是把这件事拆成三层：

### 4.1 第一层：认证（最关键）

给四条烧钱路由都加上 `ensureAuthenticated` 中间件。一旦请求没有有效的 session cookie，直接 401，根本不进入业务逻辑：

```js
// server/index.js
app.use('/api/analyze',         ensureAuthenticated, aiPerMinute, aiPerDay, analyzeRoutes);
app.use('/api/analyze/stream',  ensureAuthenticated, aiPerMinute, aiPerDay, analyzeStreamRoutes);
app.use('/api/word-definition', ensureAuthenticated, aiPerMinute, aiPerDay, wordDefinitionRoutes);
app.use('/api/tts',             ensureAuthenticated, ttsPerMinute,         ttsRoutes);
```

这一层挡住的是**没有 OAuth 登录身份的所有请求**。curl 想绕过它，必须先完成完整的 Google OAuth 流程——而 OAuth 流程要求人在浏览器上和 Google 交互，没法自动化。

同时我把 401 响应体改成结构化形式，方便客户端识别和展示：

```js
res.status(401).json({
    error: 'Unauthorized. Please login.',
    message: 'Please sign in via the LingoContext popup to use this feature.',
    code: 'AUTH_REQUIRED'
});
```

旧版只有 `{ error: '...' }`，前端只能展示一句模糊的话。新版加了 `code` 字段，前端可以根据 `AUTH_REQUIRED` 直接渲染一个"登录"按钮，而不是"重试"按钮——错误响应本身也是 UX。

### 4.2 第二层：每用户限速

认证只能挡住"没有身份的人"。但如果某个用户的 session 泄露了，或者某个用户自己写脚本试图滥用，光靠认证不够。

引入 `express-rate-limit`，键设计是关键：

```js
function keyByUserOrIp(req) {
    if (req.user && req.user.id != null) {
        return `u:${req.user.id}`;       // 优先按用户 ID
    }
    return `ip:${req.ip || 'unknown'}`;  // 未登录场景按 IP
}
```

为什么不直接用 IP？因为 IP 不稳定——用户切换 WiFi、走 VPN、共享办公室 IP，都会让按 IP 限速错杀正常人。**用户 ID 才是"配额单位"的本体**。

具体的限制：

| 限制器 | 窗口 | 默认值 | 控制变量 |
|--------|------|--------|----------|
| AI 接口/分钟 | 60s | 30 | `RATE_LIMIT_AI_PER_MIN` |
| AI 接口/天 | 24h | 1500 | `RATE_LIMIT_AI_PER_DAY` |
| TTS/分钟 | 60s | 60 | `RATE_LIMIT_TTS_PER_MIN` |
| 公开接口/分钟 | 60s | 60/IP | `RATE_LIMIT_PUBLIC_PER_MIN` |

所有阈值都走环境变量，所以如果哪天我突然被 DDoS，或者 Gemini 配额吃紧，**改一个环境变量就能立刻收紧**，不用重新部署代码。

429 响应也是结构化的：

```js
res.status(429).json({
    error: 'rate_limited',
    message: "You're sending requests too quickly. Please wait a moment and try again.",
    code: 'RATE_LIMITED',
    limiter: name,
    retry_after_seconds: retryAfter
});
```

带 `Retry-After` header，客户端可以决定要不要自动重试。

### 4.3 第三层：CORS + CSRF 不变

很多文章会建议"既然 CORS 防不住 curl，就别配了"。我不同意。CORS 防的是另一个场景：

> 用户在浏览器里**同时打开**了我的扩展和一个恶意网站。恶意网站的 JS 想偷偷调我的 API（带上用户的 session cookie）。

这种场景下，**`Origin` 是浏览器自动设置的，恶意网站没法伪造**。CORS + CSRF origin 检查能在这层挡住攻击。

所以三层防御是分工的：

- **认证**：挡住"没有身份的人"（curl、爬虫、自动化脚本）
- **限速**：挡住"有身份但行为异常的人"（被盗号、用户自己滥用）
- **CORS/CSRF**：挡住"借用合法身份的恶意网站"（CSRF 攻击）

少一层都不行。

---

## 五、最容易翻车的部分：不破坏现有功能

光把锁加上去不难，难的是**不破坏现有用户的体验**。这部分我花的时间比加锁本身还多。

### 5.1 第一步：确认客户端真的在带 session

如果扩展的 fetch 没有 `credentials: 'include'`，那即使用户已经登录，请求里也不会带 cookie，加锁后所有人都会被 401 挡掉。

我把 `background.js` 里所有的 fetch 调用都扫了一遍：

```js
const response = await fetch(`${backendUrl}/analyze/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ... }),
    credentials: 'include'   // ← 确认四个调用都有
});
```

四个烧钱接口（analyze/stream、furigana、word-definition、tts）都已经带了 `credentials: 'include'`。这意味着**登录用户在加锁前后是完全无感知的**——cookie 自动跟过来，session 自动验证通过。

### 5.2 第二步：审计每个接口的失败降级路径

这是个意外的发现：扩展原本就为很多接口写了优雅的降级路径，只是我之前没注意。

| 接口 | 失败时扩展的反应 | 加锁后的影响 |
|------|------------------|--------------|
| `/api/tts` | 自动降级到 Web Speech API (`speakWithWebSpeech`) | **零影响**——未登录用户听到的是浏览器自带 TTS |
| `/api/word-definition` | 静默返回空数组，跳过 quick definition 区域 | **零影响**——只是少了一个加分项 |
| `/api/furigana` | 静默返回 null，跳过快速振假名 | **零影响**——AI 分析回来后仍会渲染振假名 |
| `/api/analyze` | 显示错误 UI | **需要改**——不能让用户看到"Backend Error: 401" |

也就是说，**TTS / word-definition / furigana 三条路即使被锁了，扩展的整体体验都不会断**。这给了我一个意外的礼物：**Web Speech 降级让我可以心安理得地锁掉 TTS**——如果一个功能没有降级路径，加 auth 之前必须先想清楚 401 时的用户体验。

### 5.3 第三步：把 analyze 的 401 转成"登录"提示

只有 `/api/analyze/stream` 的失败会被用户直接看到（错误弹窗）。这里需要专门处理。

`background.js` 把 401 的 `code` 透传给 content script：

```js
if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    port.postMessage({
        error: true,
        status: response.status,
        code: error.code,                          // ← 新增
        message: error.message || error.error || `Backend Error: ${response.status}`
    });
}
```

`content.js` 的 stream handler 识别 `code === 'AUTH_REQUIRED'`，渲染一个**带"登录"按钮的错误界面**，而不是常规的"重试"：

```js
const isAuth = msg.code === 'AUTH_REQUIRED' || msg.status === 401;
popup.innerHTML = renderError(msg.message, { authRequired: isAuth });
```

`renderError` 接收一个 `authRequired` 选项，决定显示 🔒 + "Sign in" 还是 ⚠️ + "Try Again"，按钮的 `data-action` 也跟着切换：

```js
const actionAttr  = authRequired ? 'data-action="login"' : 'data-action="retry"';
const actionLabel = authRequired ? loginBtnStr : tryAgainStr;
const icon        = authRequired ? '🔒' : '⚠️';
```

而 "Sign in" 按钮的点击行为复用扩展早就存在的 `OPEN_LOGIN` 消息流——**没有新增任何 IPC、没有改 popup.html、没有改 dashboard**。整个改动只在两个文件、不到 20 行内闭合。

### 5.4 取舍：哪些路由该锁，哪些不该

不是所有路由都该锁。我对每条做了独立判断：

| 路由 | 锁不锁 | 理由 |
|------|--------|------|
| `/api/analyze*` | 锁 | 调用 Gemini/DeepSeek，每次调用都是真金白银 |
| `/api/word-definition` | 锁 | 同上，虽然 max tokens 是 100，但量大也烧 |
| `/api/tts` | 锁 | Edge TTS 走带宽；且客户端已有 Web Speech 降级 |
| `/api/furigana` | **不锁**，只限速 | 本地 kuromoji，零外部成本；扩展未登录时也会触发；按 IP 限速够用 |
| `/api/dictionary` | **不锁**，只限速 | 调用免费的 jisho/dictionaryapi；同上 |

**功能本身的成本结构** + **客户端有没有降级路径** 是决定要不要锁的两个维度。无脑全锁很安全但损失体验，无脑全开放又是裸奔。

---

## 六、验证：测试 + 端到端烟雾测试

光改完不算完，还得验证：

### 6.1 单元测试

旧的 `authMiddleware.test.js` 写死了 401 body 的精确形状：

```js
expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized. Please login.' });
```

我把它改成结构化匹配，把"扩展能识别认证错误并切换 UI"这件事变成测试可表达的契约：

```js
expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    error: 'Unauthorized. Please login.',
    code: 'AUTH_REQUIRED',
    message: expect.stringMatching(/sign in/i),
}));
```

在 `index.test.js` 里加了 4 个新 case，每条烧钱路由都断言匿名访问会返回 401 + `code: 'AUTH_REQUIRED'`。

意外的发现：`analyzeRoute.test.js` 和 `analyzeStreamRoute.test.js` **从一开始就在 mock 中间件里挂着 `ensureAuthenticated`**——也就是说，写测试的那个我**早就以为这些路由是受保护的**。生产代码反而是异常值。**测试驱动暴露了实现和意图之间的不一致**。

最终：210/210 server tests + 13/13 root tests 全部通过。

### 6.2 端到端烟雾测试

我写了个最小的 Express harness，挂载和生产完全一样的中间件，用 mock 的 passport 模拟"未登录"状态，然后 curl：

```bash
=== Cost-bearing routes (expect 401)
{"error":"Unauthorized. Please login.","message":"Please sign in via the LingoContext popup to use this feature.","code":"AUTH_REQUIRED"}  ← HTTP 401
{"error":"Unauthorized. Please login.","message":"...","code":"AUTH_REQUIRED"}  ← HTTP 401
{"error":"Unauthorized. Please login.","message":"...","code":"AUTH_REQUIRED"}  ← HTTP 401
{"error":"Unauthorized. Please login.","message":"...","code":"AUTH_REQUIRED"}  ← HTTP 401

=== Open public routes (expect 200)
HTTP 200  POST /api/furigana
HTTP 200  GET  /api/dictionary?word=x
```

完美匹配预期。

---

## 七、这次重构留下的几个原则

把这次工作抽象一下，是几个能复用到其他项目的判断准则：

### 7.1 「客户端安全」是个误称

只要代码跑在用户的设备上，它就是公开的。能被服务端信任的，只有**经过验证的身份**，不是**调用方说自己是谁**。如果你发现自己在写"只让 X 类型的客户端能调用"，停下来想想：能不能换成"只让 Y 身份的用户能调用"。

### 7.2 错误响应也是 UX

`{ error: 'Unauthorized' }` 和 `{ error, message, code: 'AUTH_REQUIRED' }` 给前端的能力差了一个数量级。前者只能展示"出错了"，后者可以根据 code 切换整个错误 UI。**错误响应的结构是产品决策，不是技术细节**。

### 7.3 限速的 key 设计比阈值更重要

阈值可以调，key 错了就全错。`user.id` > `session.id` > `IP` > `Origin`。永远按"被限速的概念主体"来 key，而不是按"最容易拿到的标识"。

### 7.4 加 auth 前先想清楚 401 时的体验

如果一个功能本来就有降级路径（TTS → Web Speech、word-def → 跳过），加锁是无痛的。如果没有降级路径，要么补一个，要么把 401 设计成一个有用的 UI 状态（"请登录"按钮）。**不能让用户面对一个"Backend Error: 401"自己琢磨**。

### 7.5 防御要分层，每层的职责要清晰

CORS 防恶意网站，认证防匿名调用，限速防身份滥用。三层各管一段，少一层就有缺口，多一层是冗余。理解每一层挡的是什么，比堆叠中间件本身更重要。

---

## 八、写在最后

这件事让我有点惭愧——一个我每天都在维护的项目，居然有这么明显的漏洞我视而不见了几个月。但更让我反思的是：**我对"我的 API 只有我的扩展能调"这个信念，从来没有被验证过**。我没跑过 curl，没扮演过攻击者，没真正问过自己"如果我自己想滥用这个 API，我会怎么做"。

写代码和保护代码是两种不同的思维方式。前者问"它能用吗"，后者问"它能被滥用吗"。我以前更熟悉前者。

如果你正在做一个有后端的浏览器扩展、移动 app、桌面客户端——请花十分钟，对着自己的 API 跑一遍 curl。看看哪些接口理应需要登录但实际上可以裸调。你会很惊讶。
