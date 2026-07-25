# Volcab 项目交接备忘

**更新时间**:Phase 2 完成时
**下一步**:Phase 3(UI 与 PWA,计划中的 Task 13-22)

---

## 一句话状态

记单词 PWA。核心逻辑与词库已完成并通过测试;**UI 一行没写**(`src/App.tsx` 还是 Vite 模板页)。下一步从 Task 13(设计系统)开始。

## 已完成

| 阶段 | 内容 | 产出 |
|---|---|---|
| Phase 1 | 脚手架 + 核心纯函数模块 | `src/lib/{srs,queue,merge,quiz,github,storage,tts}.ts`,37 测试全过 |
| Phase 2 | 词库构建 | `data/words.json`(**476 词条**),`data/wordlist.json`(词表),`scripts/{parse-enex,validate-words}.ts` |

**验证命令**(应全绿):

```bash
npm test && npx tsc -b --noEmit && npm run validate-words
```

## 待办:Phase 3 与 Phase 4

按 `docs/superpowers/plans/2026-07-24-volcab-app.md` 执行:

- **Task 13** 设计系统与 App 骨架 —— **必须用 frontend-design skill**(用户明确要求),移动端优先、深浅色、有辨识度
- **Task 14** `src/state/store.tsx` 全局状态与同步引擎(计划里有完整编排规则)
- **Task 15-21** 八个页面:Login / Today / Review / Quiz / Library+WordDetail / AddWord / Settings
- **Task 22** PWA 图标与离线
- **Task 23-25** GitHub Pages 部署、创建 `volcab-data` 私有仓库、端到端验收

执行方式:subagent-driven-development(每任务一个 subagent + spec 审查 + 质量审查)。

## 关键决定(会话中产生,计划文档已同步)

1. **词库难度收紧**:候选 814 → 去重 771 → 严格 C1+/C2 筛选 → 431 通用词;用户后来要求把专业术语加回,追加 45 个(信息安全/医学/化学/修辞/哲学/经济),**最终 476**。
2. **例句全部重新创作**:现代生活与工作场景(职场、通勤、租房、社交媒体、AI 工具等),**不用 Evernote 笔记原文**。笔记只用来定词表。
3. **新增 `relatedForms` 字段**:同根变形不单独收词(避免复习重复),而是在词条详情页作为"同根词"一栏展示 `{form, pos, zh}`。342 个词有内容。`src/types.ts` 与校验脚本已支持。
4. **词条管理**:App 需支持删除——词库页多选批量删 + 详情页单条删,删除时一并清除该词的学习进度(`store.deleteWords(ids)`)。
5. **认证**:GitHub fine-grained PAT 即密码,数据存私有仓库 `volcab-data`。

## 环境与注意事项

- `gh` CLI 当前登录账号:**steveao886**。用户提过可能换新 GitHub 账号——**部署前(Task 23/24)先确认用哪个账号**,必要时让用户 `gh auth login`。
- `Volcab.enex` 是个人笔记,已在 `.gitignore`,**永远不要 git add**(app 仓库将来是公开的)。
- `scripts/out/` 是中间产物(候选词表、13 个生成批次),已 gitignore,可安全删除。
- Windows 环境,PowerShell 与 Git Bash 均可用。

## 用户偏好

- 界面中文,释义中英双语。
- 例句必须有具体场景和画面感,拒绝教科书式空泛句。
- 阶段之间会喊停,**不要自作主张跨阶段推进**。
