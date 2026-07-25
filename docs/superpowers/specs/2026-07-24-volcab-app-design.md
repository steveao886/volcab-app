# Volcab 记单词 App — 设计文档

日期:2026-07-24
状态:已与用户确认

## 1. 目标

一个免费托管在 GitHub Pages 上的记单词 PWA,手机和电脑都能用,学习进度跨设备同步。初始词库从用户的 Evernote 导出文件(`Volcab.enex`,26 篇笔记)中提取难词并由 AI 生成完整词条。核心记忆方法是间隔重复(SRS)+ 情景例句。

## 2. 总体架构

两个 GitHub 仓库:

| 仓库 | 可见性 | 内容 |
|---|---|---|
| `volcab-app` | 公开 | App 源码。GitHub Actions 构建并部署到 GitHub Pages。未登录只显示 token 输入页,不含任何用户数据。 |
| `volcab-data` | 私有 | `words.json`(词库)+ `progress.json`(学习进度)。仅持 token 者可读写。 |

- **认证 = GitHub fine-grained Personal Access Token**,权限仅限 `volcab-data` 仓库的 Contents 读写。Token 保存在浏览器 localStorage,每台设备首次使用时粘贴一次。
- 纯前端应用,无服务器。所有数据读写走 GitHub Contents API。
- **技术栈**:Vite + React + TypeScript + vite-plugin-pwa。移动端优先的响应式界面,底部标签导航;支持"添加到主屏幕",离线可复习,联网后自动同步。
- 界面语言:中文。
- **视觉风格**:使用 frontend-design skill 进行界面设计,追求有辨识度的、生产级的视觉品质,避免通用模板感。

## 3. 数据模型

### 3.1 words.json(词库)

```json
{
  "version": 1,
  "words": [
    {
      "id": "abrogate",
      "headword": "abrogate",
      "phonetic": "/ˈæbrəɡeɪt/",
      "meanings": [
        { "pos": "v.", "en": "to formally revoke or repeal (a law, agreement, or practice)", "zh": "废除;废止" }
      ],
      "examples": [
        "The new CEO abrogated the remote-work policy, and half the team started job-hunting that week."
      ],
      "synonyms": ["repeal", "revoke", "annul"],
      "antonyms": ["ratify", "uphold"],
      "collocations": ["abrogate a treaty", "abrogate an agreement"],
      "relatedForms": [
        { "form": "abrogation", "pos": "n.", "zh": "废除;废止" }
      ],
      "sourceNote": "12-15",
      "addedAt": "2026-07-24"
    }
  ]
}
```

约定:

- `id` = 词元(lemma)小写形式,唯一。派生形式(如 surreptitiously → surreptitious)归并为一个词条,按词元收录。
- `examples`:2–3 句**全新创作**的情景例句,现代、贴近当下生活与工作场景(职场、项目、通勤、健身、社交媒体、旅行、租房等)。**不使用 Evernote 笔记原文**;笔记仅用于确定词表。多义词的例句需覆盖主要义项。
- `sourceNote`:该词来自哪篇笔记(如 "12-15"),仅作溯源标记;用户手动新增的词为 `"manual"`。
- 音标为美式。

### 3.2 progress.json(学习进度)

```json
{
  "version": 1,
  "settings": { "newPerDay": 10 },
  "words": {
    "abrogate": {
      "state": "review",
      "ease": 2.5,
      "intervalDays": 7,
      "due": "2026-07-30",
      "reps": 5,
      "lapses": 1,
      "lastReviewedAt": "2026-07-23T14:02:11Z"
    }
  },
  "dailyStats": {
    "2026-07-24": { "reviewed": 25, "newLearned": 10, "correct": 21, "quizTaken": 1 }
  }
}
```

- `state`:`new`(未学)→ `learning`(学习中,短间隔)→ `review`(已毕业,长间隔)。
- 词库中存在但 progress 中无记录的词视为 `new`。
- 不保存完整复习日志,只按日聚合统计(`dailyStats`),控制文件体积。
- streak 由 `dailyStats` 派生计算,不单独存储。

## 4. 记忆算法(SM-2 变体,Anki 风格)

每次复习打分四选一:**重来 / 困难 / 良好 / 简单**。

- **新词学习阶段**:学习步长 1 分钟 → 10 分钟(同一会话内重现);"良好"走完步长后毕业,首个复习间隔 1 天,ease 初始 2.5。"简单"直接毕业,间隔 4 天。
- **复习阶段**:
  - 重来:记一次 lapse,回到学习阶段,ease −0.20;
  - 困难:间隔 × 1.2,ease −0.15;
  - 良好:间隔 × ease;
  - 简单:间隔 × ease × 1.3,ease +0.15。
- ease 下限 1.3;间隔上限 365 天;间隔加 ±5% 随机模糊,避免同批词永远同天到期。
- **每日队列** = 所有 `due ≤ 今天` 的词(优先)+ `newPerDay` 个新词(按词库顺序)。
- 快速测试中答错的词,`due` 提前到今天(温和联动,不改 ease)。

## 5. 功能与页面

| 页面 | 功能 |
|---|---|
| 登录页 | 粘贴 token + 内置图文指引(如何生成 fine-grained PAT);校验后进入 |
| 今日(首页) | 到期复习数、今日新词数、streak、总进度条;入口:开始复习 / 快速测试 |
| 复习 | SRS 卡片:正面单词(+发音按钮);翻面显示音标、中英释义、情景例句、同义反义、搭配;四键打分 |
| 快速测试 | 从已学词中随机 10 题,三种题型混合:看词选义(四选一)、看义选词(四选一)、拼写(看释义+音标输入单词);结束显示成绩,错词 due 提前 |
| 词库 | 全库列表 + 搜索(词头、英文释义、中文释义均可搜)+ 筛选(掌握状态 / 来源笔记);点击进词条详情;支持多选批量删除 |
| 词条详情 | 完整词条展示 + TTS 发音 + 编辑(改释义/例句等,写回 words.json)+ 删除词条 |
| 添加新词 | 输入单词 → 调用 Free Dictionary API(dictionaryapi.dev,免费无 key)自动填充音标和英文释义 → 用户可编辑、补中文释义 → 入库;API 查不到时全手动填写 |
| 设置 | 每日新词数、token 管理(更换/退出)、导出全部数据 JSON 备份 |

发音:Web Speech API(speechSynthesis,en-US),免费,移动端桌面端均可用。

## 6. 同步机制

- **拉取**:App 启动时 GET `words.json` 与 `progress.json`(带 sha 缓存,无变化不重复下载)。
- **推送**:复习会话结束或数据变更后防抖 30 秒,PUT Contents API 提交(带上次 sha)。
- **冲突**(409,两台设备都改过):重新拉取远端,按词合并——每个词取 `lastReviewedAt` 较新的记录;`dailyStats` 按日取各字段最大值;合并后重推。不丢数据。
- **离线**:变更暂存 localStorage,恢复网络后自动同步;界面显示离线/未同步标记。

## 7. 初始词库构建(一次性管线)

1. 脚本解析 `Volcab.enex`(XML + 内嵌 ENML):提取各笔记中 `<b>` 标记的词/短语;26 篇笔记中仅 12 篇有粗体标记(共 201 处),其余 14 篇为无标记的词根主题段落,须由 AI 通读判定难词——粗体只是线索之一,难词以实际难度为准。
2. 清洗:去掉纯短语搭配中的常见词、还原词元、跨笔记去重。
3. **难度筛选(关键)**:对合并后的候选表统一施加严格难度标准,只保留真正需要背诵的 C1+/C2 词汇,剔除 B2 及偏易的叙事填充词(如 outskirts、brisk、trivial、surplus、foster 一类)。**目标规模 350–450 词**;宁可少而精,后续可随时在 App 内添加。
4. AI 批量生成词条(音标、中英多义、情景例句、同义反义、搭配),分批产出并经 schema 校验。
5. 生成的 `words.json` 提交到 `volcab-data`;抽样人工核对若干词条质量。
6. `.enex` 解析脚本保留在 app 仓库 `scripts/` 下,便于将来再导入。

## 8. 错误处理

- Token 无效/过期/权限不足 → 清除本地 token,回登录页并提示原因。
- GitHub API 限流(认证后 5000 次/小时,正常使用远不会触及)→ 提示稍后重试。
- 同步冲突 → 自动合并(见 §6),用户无感。
- 词典 API 失败 → 降级为手动填写。
- words.json / progress.json 解析失败或 schema 不符 → 拒绝覆盖远端,提示导出备份。

## 9. 测试

- **单元测试(Vitest)**:SRS 调度器(各打分路径、边界)、冲突合并逻辑、enex 解析器、测验出题器(选项不重复、干扰项合理)、schema 校验。
- **手动验收**:桌面 Chrome + 手机浏览器各过一遍全流程(登录、复习、测试、搜索、添加、离线、双设备同步)。

## 10. 部署与首次配置

1. 创建 `volcab-app`(公开)与 `volcab-data`(私有)两个仓库。
2. `volcab-app` 配 GitHub Actions:push 即构建部署 Pages。
3. 用户按 App 内指引生成 fine-grained PAT(仅 `volcab-data`,Contents Read/Write),在每台设备粘贴一次。

## 11. 非目标(明确不做)

- 多用户系统、注册流程(单用户自用)。
- 服务器端组件、数据库。
- 中文以外的界面语言;英语以外的学习语种。
- 完整复习历史日志与复杂图表(仅日聚合统计)。
