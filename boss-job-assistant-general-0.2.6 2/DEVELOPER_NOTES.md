# 开发者说明

当前用户界面的占位示例统一使用行政专员/行政助理；它们只是演示文字。`DEFAULT_FILTERS` 中的实际筛选词仍全部为空，因此扩展不会默认只投行政岗。

## 设计目标

业务偏好必须来自设置，不能散落在 DOM 代码或模型提示词中。安全边界不是业务筛选，不允许被普通配置关闭。

## 添加新的可筛选字段

1. 在 `shared/config.js` 的 `FILTER_FIELD_DEFINITIONS` 中增加一项，填写 `key`、中文名称、来源说明、占位示例和匹配类型。
2. 在 `shared/core.js` 的 `analyzeJob()` 里为 `fields` 增加对应的标准化页面值。
3. 确保 `content.js` 的 `extractCurrentJob()` 能稳定读取该原始字段。
4. 为新字段补充包含、排除、空白和阈值测试。

设置页会根据 `FILTER_FIELD_DEFINITIONS` 自动生成包含组和排除组；`KEYWORD_GROUPS`、默认值和校验器也由同一份定义派生，无需复制静态 HTML。

## 匹配策略

- `term`：中文使用字面包含；纯英文/数字词使用词边界，防止 `ECU` 等短词误命中其他英文字符串。
- `fragment`：不区分大小写的名称片段匹配，适合公司、地点和页面标签。
- 每组阈值使用 `any`、`all` 或 `count`。
- 所有包含组按 AND 组合；任一排除组满足即排除。

不要在模型提示词中加入岗位黑名单。模型只对本地筛选已通过的岗位生成文字。

`conversationalJobTitle()` 只用于模型输入中的 `jobTitle` 和模板变量 `{岗位}`。不要用它替换页面读取到的 `job.title`，也不要用于 `stableJobKey()`、身份核对、筛选或日志；否则不同完整标题可能被错误合并。

## 固定安全边界

以下行为不能改成普通开关：

- 验证码、账号限制或风险提示时停止。
- 发送前重新核对岗位/招聘者身份。
- 发送结果未知时隔离该岗位，禁止自动重发。
- API Key、候选人简介和简历图片不进入公开前台状态或诊断日志。
- 单岗位业务错误记录后继续；来源列表消失、状态持久化失败等全局错误暂停。
- 不绕过 `tests/browser-execution-lock.mjs`。

## 版本与分发检查

0.2.6 的投递状态依次为 `opening_job` → `opening_chat` / `continuing_chat` → `preparing_text` → `sending_text` → `sending_resume` → `recording`。`preparing_text` 只表示草稿准备中；`RESERVE_TEXT_SEND` 在实际点击前原子登记唯一发送意图，之后不得自动重试。

`communicationActions` 保存立即沟通和继续沟通动作；页面重载不得把该任务重置成新投递。任务标签包括原临时详情页、同岗位详情中间页和聊天页；领取、阶段更新、发送登记和完成记账使用同一队列，避免不同页面同时覆盖待发送状态。发送控件不得用任意文字为“发送”的普通容器代替；新增聊天文字和空输入框一起作为确认条件。

1. 同步更新 `manifest.json`、`package.json` 和设置页版本文字。
2. 运行 `npm run check` 和 `npm test`。
3. 确认包内没有 API Key、个人总结、简历图片、聊天正文或沟通历史。
4. ZIP 根目录应只有扩展文件，不包含上级工作区或个人版。
5. 本地测试与真实账号验证必须分开表述。
