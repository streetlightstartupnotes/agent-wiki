<div align="center">
  <img src="assets/logo-square.png" width="88" alt="Agent wiki 标志">
  <h1>Agent wiki</h1>
  <p><strong>把资料、笔记和讨论中的决定，留在一个能继续使用的知识库里。</strong></p>
  <p>Codex 插件 · 本地 Markdown · 中英文界面</p>
  <p><a href="https://github.com/streetlightstartupnotes/agent-wiki/releases">下载安装包</a> · <a href="#开始使用">开始使用</a> · <a href="README.en.md">English</a></p>
</div>

![Agent wiki 笔记首页：目录、正文预览与最近编辑](docs/images/library.png)

讨论结束了，决定却散在对话里；资料保存了，下次还是找不到当时的依据。Agent wiki 把这些内容整理成普通 Markdown 文件，让你在 Codex 里查阅、修改、连接，再接着做事。

由 **[路灯同学创业笔记](https://github.com/streetlightstartupnotes)** 开发 · [X](https://x.com/LDstartupnotes) · [小红书](https://www.xiaohongshu.com/user/profile/63fd97c1000000001400d0ea)

> 当前版本 **0.2.2**，通过 GitHub 分发。**尚未上架 OpenAI 官方插件目录。** 截图来自同一版本的真实浏览器预览，内容为专门编写的公开演示笔记；不包含个人会话，也不代表截图中的浏览器会执行 Codex 任务。

## 可以用它做什么

| 你想做的事 | Agent wiki 怎么帮你 |
| --- | --- |
| 下次接着讨论，不再重新解释 | 保存确认过的决定、依据和待办，按需要找回 |
| 把手边资料整理成可阅读的笔记 | 保留原始资料，再整理摘要、引用和笔记间的链接 |
| 一边写，一边看成稿 | Markdown、富文本、双栏编辑，停止输入后自动保存 |
| 找到笔记之间的关系 | 双向链接、分类、关系图、节点查找与关联页面 |
| 在笔记旁边继续问 Codex | 将当前知识库与所选笔记传入当前对话 |
| 用到以前的会话记录 | 显式选择来源，关联或整理经过核验的会话资料 |

还有全文搜索、大纲、表格与附件、研究记录、断链检查、待办和回收站。支持打开已有 Wiki，也支持导入普通 Markdown / Obsidian 文件夹；普通 Markdown 导入会生成副本，保留原文件。

## 看看界面

### 写笔记，不必离开当前工作

左边写 Markdown，右边看排版；也可以切换为单栏编辑。保存状态直接显示在编辑器上方，版本冲突时保留草稿，先比较再合并。

![Markdown 源文与阅读视图并排显示](docs/images/editor.png)

### 用关系图找到下一篇值得读的笔记

不同类型使用不同颜色。点击节点查看关联，双击打开笔记；可按名称查找、按类型筛选，也能把选中的笔记交给 Codex 讨论。界面随面板宽度调整。

<img src="docs/images/graph.png" width="665" alt="窄面板中的多彩关系图，展示十二篇演示笔记的连接">

### 第一次使用，从一件具体的事开始

写一个想法、导入一份资料、询问已有笔记，或接上以前的讨论。界面内提供对应入口，不要求先记住命令。

![首次使用指南：提问、写笔记、添加资料与会话记录](docs/images/guide.png)

## 开始使用

### 1. 检查运行环境

- 支持插件、本地 MCP 和 MCP Apps 面板的 Codex 宿主。
- 本机安装 **Python 3.9+、Ruby 和 WEBrick**。
- 选择一个放置知识库的本地文件夹，**不要放进插件安装目录**。

已构建的安装包不需要 Node.js/npm。可先检查运行依赖：

```sh
python3 --version
ruby --version
ruby -rwebrick -e 'puts WEBrick::VERSION'
```

如果最后一条提示缺少 WEBrick，请使用你自己的 Ruby 环境安装 `gem install webrick`。项目主要在 macOS 验证，其他系统的完整使用流程仍需验证。

### 2. 安装插件

使用支持 `plugin` 命令的 Codex CLI：

```sh
codex plugin marketplace add streetlightstartupnotes/agent-wiki
codex plugin add llm-wiki@llm-wiki-local
```

也可以从 [Releases](https://github.com/streetlightstartupnotes/agent-wiki/releases) 下载 ZIP，解压为 `agent-wiki`，添加本地目录：

```sh
codex plugin marketplace add /absolute/path/to/agent-wiki
codex plugin add llm-wiki@llm-wiki-local
```

`/absolute/path/to/agent-wiki` 请替换为实际路径。若安装后工具尚未出现，请重新加载插件或重启 Codex，再开始新对话。显示名是 **Agent wiki**；`llm-wiki` 与 `llm-wiki-local` 是为兼容已有安装保留的内部标识。

### 3. 打开并使用

在 Codex 对话中说：

> 打开 Agent wiki。

首次选择保存位置，再新建一个知识库或打开已有文件夹。界面语言在 **设置 → 通用** 中切换，支持中文与英文；切换界面语言不会翻译笔记内容。

然后试试这些请求：

- **查阅**：「查一下这个库里的用户访谈笔记，告诉我重复出现的问题，并附上出处。」
- **保存**：「把刚才确认的决定记到这个库，保留依据和还没解决的问题。」
- **整理**：「把这几份资料整理到这个库，保留原文，和已有笔记建立有依据的链接。」
- **维护**：「检查这个库的失效链接，修复前先读相关笔记。」

## Codex 如何参与

界面通过 **MCP Apps** 展示；查找、读取、写入通过本地 **MCP** 工具完成；十个 **Skill** 描述新建、整理、研究、保存、检查及会话资料工作流。选择笔记后发起讨论，知识库路径与当前笔记会作为本次任务的上下文传给 Codex。

**“已发送”表示请求交给了当前对话，不代表笔记已经写入。** 请在对话中查看任务进展；编辑器显示“已保存”才代表这次编辑已保存。

默认知识库用于跨对话按需查阅，**不会自动收集或保存所有对话**。需要任务结束时记录结果时，请明确目标库、保存范围与排除内容，并让约定在当前对话中可见。这不是离线后台任务，普通编程问题也不需要扫描你的历史。

会话整理集成自 [Agent Session Knowledge Base v0.6.0-rc.2](https://github.com/streetlightstartupnotes/agent-session-knowledge-base-skill/releases/tag/v0.6.0-rc.2)。Reader 读取已核验资料，Rebuilder 按你选择的来源整理；安装插件本身不会启动历史扫描。生成证据与日常可编辑笔记分别管理。

## 数据、权限与当前限制

- 笔记与来源保存在你选择的本机目录，以 Markdown 等普通文件存储。
- 插件不提供托管知识库，也不包含自有遥测；**交给 Codex 的内容仍会由你的 Codex 账号处理，本地存储不等于离线 AI**。
- 写入需要明确的知识库和授权范围。更新使用 revision 检查，拒绝直接覆盖新版本；删除的笔记可从知识库回收站恢复。
- 外部图片默认阻止，可按具体 HTTPS 来源授权。不要把知识库或会话存档提交到这个公开仓库。
- 当前是本地 stdio MCP 插件，不是可直接部署到公网的 HTTP 服务。
- macOS 上已完成多轮运行回归与部分真实 Codex 调用验证；Windows/Linux、全部附件格式、大规模图谱、每一种自然语言触发方式和全部面板到模型执行组合尚未穷尽验证。

详见 [隐私说明](PRIVACY.md)。遇到问题请在 [Issues](https://github.com/streetlightstartupnotes/agent-wiki/issues) 提供系统、Codex 版本、操作步骤和脱敏后的报错；不要上传真实笔记、会话原文或密钥。

## 源码与构建

```text
plugin.json                   插件属性、公开署名与审核描述
mcp.json                      本地 MCP 启动配置
skills/llm-wiki/               Wiki 入口、Python/Ruby 后端与前端源码
skills/llm-wiki-*/             新建、整理、研究、保存等工作流
skills/agent-knowledge-reader/ 会话知识读取
skills/agent-session-knowledge-rebuilder/ 会话整理与核验
docs/images/                  真实界面效果图
```

前端使用 React / JavaScript，MCP 入口使用 Python，本地文件操作由 Ruby 服务处理。安装包保留源码、构建命令、锁文件和第三方许可证。

```sh
cd skills/llm-wiki/assets/workspace
npm ci --ignore-scripts
npm run check
```

此步骤需要 Node.js/npm 和网络，**仅修改或重新构建前端时需要**。当前公开分发内容不含开发期间的测试库与私有验收日志；上面的 `check` 是构建与 JavaScript 语法检查，不是完整端到端测试。

## 许可与来源

项目以 **GPL-3.0** 发布。界面与部分工作流源自 OpenClacky LLM Wiki，许可证和第三方声明随源码保留；本仓库中的 Session Skill 副本另获 GPL-3.0 授权，原独立仓库的许可不因此改变。

请阅读 [LICENSE](LICENSE)、[LICENSING](LICENSING.md) 与 [第三方许可](licenses/INDEX.md)。Agent wiki 是独立项目，与 OpenAI 官方出品或审核通过无关。

[版本说明](RELEASE-NOTES.md) · [反馈与支持](SUPPORT.md) · [English](README.en.md)
