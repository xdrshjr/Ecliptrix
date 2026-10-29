# 桌面端打包 / 启动事故诊断(2026-10-29)

本目录记录同一次事故:桌面端打包门禁与打包态启动链路上**纵向叠加**的一组缺陷。
它们不是一起被发现的——每一层都恰好遮住了下一层的可见性,代价是层与层之间的
等待(每层要一次 10–13 分钟的打包才能观测到)。

**先读 `root-cause.md`**,它是权威记录:结论、修复点、验证证据、回退条件。
另外三份是当时的支持性审计,原始判断被完整保留,只在顶部加了状态更新,
用来对照「当时相信什么」与「后来实测是什么」。

## 五个缺陷(按发现顺序)

| # | 缺陷 | 修复位置 | 当前状态 |
|---|---|---|---|
| 1 | 断言把 app 外壳文件(`main/agentBrowserHost.js`)当成 `build/` 生成产物校验,每次打包必中止 | `desktop/scripts/build.js`(双根断言)+ `scripts/lib/build-payload-checks.js` | **已修并验证**:`npm run build` 退出 0(~11 min),打印 `[assert] all payloads present` |
| 2 | 浏览器宿主 `cwd` 指向 `app.asar`(文件),子进程根本起不来 | `desktop/main/browserHostPaths.js` | **已修,打包态验证**:spawn → 健康 1.4–1.5 s(修复前 20 s 超时) |
| 3 | spawn 失败没有 `'error'` 监听,瞬间 ENOENT 被伪装成「20 s 超时」 | `desktop/main/processManager.js:73,94-102` | **已修**,`processManager.spawn-error.test.js` 通过 |
| 4 | `resolveProxy` 永不回调,启动永久挂起 | `desktop/main/proxyProbe.js`(2500 ms deadline + 直连降级) | **已修,打包态验证**:WARN → `agent-browser-host ready` → backend / frontend healthy |
| 5 | 门禁把**仍在运行**的应用判成「残留进程」,还顺手 kill 掉 | `desktop/scripts/lib/process-scope.js`(检查前基线差集) | **已修**,两轮真实门禁都已越过该步(报告 `success: true` 后继续往下跑) |

## 另外两条

- **A(端口透传)**:`researchBrowserSmoke` 丢掉 `researchPorts`,内层必抛
  `TypeError`。已修(`desktop/scripts/smoke-test.js:210-211`),回归测试
  `smoke-test.research-ports.test.js`。它比上面第 1 条更早被发现,但不属于那五层。
- **当前仍未通过的一条(进行中)**:`coverReadinessSmoke` 在
  `sampling blocked layout 900x640` 上报 `readiness layout did not converge`
  ——视口覆盖后采样的前 19/60 帧仍是 `checking`(几何断言全过)。这是门禁的
  采样时序问题,不是产品缺陷。**修复已于 09:27Z 落在工作区**:
  `desktop/scripts/lib/readiness-sample.js` 改为采样「收敛」而不是要求 60 帧
  全同,配 `smoke-test.readiness-sampling.test.js`;**打包态门禁尚未重跑到
  `PASS`**。

## 支持性审计

| 文档 | 记录什么 | 今天仍然成立的部分 |
|---|---|---|
| `pipeline-audit.md` | 打包流水线「载荷校验错了根目录」这一类缺陷:D1–D7 + 文档小错 | D2、D3、D4、D5、D6、D7 均未修;D1 已修 |
| `release-manifest-audit.md` | 打包**之后**的收尾链(研究包清单 / 发布证据契约) | A-1、A-2、A-3 未修;发布验收仍无法通过 |
| `startup-audit.md` | 启动路径「无界 await」全清单;§6 的按序日志表是可复用的排障工具 | S1–S10 全部未修 |

## 一句话现状

打包链路绿、打包态启动链路绿;红灯只剩门禁自身的一条布局采样断言
(修复已落在工作区,待一次重跑到 `PASS`)。注意 `npm run build` 不跑门禁、
`build.ps1` 默认跑——「两套绿」这条结构问题见 `root-cause.md` §10。
