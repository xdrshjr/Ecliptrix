# 桌面端打包 / 启动事故诊断(2026-10-29)

本目录记录同一次事故:桌面端打包门禁与打包态启动链路上**纵向叠加**的一组缺陷。
它们不是一起被发现的——每一层都恰好遮住了下一层的可见性,代价是层与层之间的
等待(每层要一次 10–13 分钟的打包才能观测到)。

**先读 `root-cause.md`**,它是权威记录:结论、修复点、验证证据、回退条件,
**以及发布结果(§13)**。其余各份是当时的支持性审计与专项诊断,原始判断被完整
保留,只加了状态更新,用来对照「当时相信什么」与「后来实测是什么」。

## 五个缺陷(按发现顺序)

| # | 缺陷 | 修复位置 | 当前状态 |
|---|---|---|---|
| 1 | 断言把 app 外壳文件(`main/agentBrowserHost.js`)当成 `build/` 生成产物校验,每次打包必中止 | `desktop/scripts/build.js`(双根断言)+ `scripts/lib/build-payload-checks.js` | **已修并验证**:`npm run build` 退出 0(~11 min),打印 `[assert] all payloads present` |
| 2 | 浏览器宿主 `cwd` 指向 `app.asar`(文件),子进程根本起不来 | `desktop/main/browserHostPaths.js` | **已修,打包态验证**:spawn → 健康 1.4–1.5 s(修复前 20 s 超时) |
| 3 | spawn 失败没有 `'error'` 监听,瞬间 ENOENT 被伪装成「20 s 超时」 | `desktop/main/processManager.js:73,94-102` | **已修**,`processManager.spawn-error.test.js` 通过 |
| 4 | `resolveProxy` 永不回调,启动永久挂起 | `desktop/main/proxyProbe.js`(2500 ms deadline + 直连降级) | **已修,打包态验证**:WARN → `agent-browser-host ready` → backend / frontend healthy |
| 5 | 门禁把**仍在运行**的应用判成「残留进程」,还顺手 kill 掉 | `desktop/scripts/lib/process-scope.js`(检查前基线差集) | **已修并入库**:第 33–37 轮真实门禁都越过了该步(该检查不再亮红) |

五条修复连同两道凭据门禁已作为 `7eaa502b` / `dca783aa` / `496c4d59` 三个提交
入库并推送(`root-cause.md` §13.1)。

## 另外两条

- **A(端口透传)**:`researchBrowserSmoke` 丢掉 `researchPorts`,内层必抛
  `TypeError`。已修(`desktop/scripts/smoke-test.js:210-211`),回归测试
  `smoke-test.research-ports.test.js`。它比第 1 条更早被发现,不属于那五层。
- **布局采样那条**:`coverReadinessSmoke` 在 `sampling blocked layout 900x640`
  上报 `readiness layout did not converge`——视口覆盖后采样的前 19/60 帧仍是
  `checking`(几何断言全过)。这是门禁采样时序问题,不是产品缺陷。
  `scripts/lib/readiness-sample.js` 改为采样「收敛」,不再要求 60 帧全同,
  配 `smoke-test.readiness-sampling.test.js`;**打包态门禁已在其后重跑到
  `PASS`**(第 33/34/35/37 轮,见 `root-cause.md` §13.4)。

## 支持性审计与专项诊断

| 文档 | 记录什么 | 今天仍然成立的部分 |
|---|---|---|
| `pipeline-audit.md` | 打包流水线「载荷校验错了根目录」这一类缺陷:D1–D7 + 文档小错 | D2、D3、D4、D5、D6、D7 均未修;D1 已修 |
| `release-manifest-audit.md` | 打包**之后**的收尾链(研究包清单 / 发布证据契约) | A-1、A-2、A-3 未修;发布验收仍无法通过 |
| `startup-audit.md` | 启动路径「无界 await」全清单;§6 的按序日志表是可复用的排障工具 | S1–S10 全部未修 |
| `keyless-smoke-dependency.md` | 冒烟门禁是否暗依赖模型密钥:逐检查族判定 + 第 31 次超时的归因 | **结论成立**:没有一条检查族需要可用密钥;门禁按设计用空 `.env` 跑,早先的绿灯不靠内置凭据(`root-cause.md` §13.6) |

## 一句话现状

打包链路绿、打包态启动链路绿、凭据门禁绿(asar 扫描 exit 0),`v1.0.0`
**已发布**;`root-cause.md` §13.7 记着发布状态是怎么验的。唯一的黄灯是冒烟门禁
本身:最终产物上 7 轮里 4 轮 `PASS`,3 条失败全是门禁时序抖动,**不要把它写成
「稳定绿」**。注意 `npm run build` 不跑门禁、`build.ps1` 默认跑——「两套绿」
这条结构问题见 `root-cause.md` §10。
