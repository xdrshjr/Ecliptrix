# Ecliptrix 品牌资产

唯一品牌源图:`ecliptrix-logo-source.png`(1254×1254,浅灰底,渐变三角丝带 + 字标)。
仓库内所有 LOGO 资产都由它派生,**不要手工编辑派生文件**。

## 再生成

```bash
python docs/brand/generate_brand_assets.py   # 需要 Pillow>=10.1、numpy
```

脚本对源图做 color-to-alpha 抠图,裁出不含字标的图形标,输出:

| 文件 | 规格 | 用途 |
|------|------|------|
| `public/brand/ecliptrix-mark.png` | 256² 透明 | 应用标题栏 |
| `public/brand/ecliptrix-logo.png` | 源图原样 | README 顶部 LOGO |
| `src/app/icon.png` | 512² 透明 | Next.js favicon |
| `src/app/favicon.ico` | 16/32/48 | `/favicon.ico` |
| `desktop/assets/brand-mark.png` | 256² 透明 | 启动闪屏 / dev 等待页 |
| `desktop/assets/icon.ico` | 16–256 共 9 帧 | 运行时窗口图标(asarUnpack) |
| `desktop/resources/icons/icon.ico` | 同上,逐字节一致 | exe / 任务栏 / 安装包(rcedit) |
| `docs/brand/preview.png` | 深/白底多尺寸 | 人工审阅抠图质量 |

## 换 LOGO

替换 `ecliptrix-logo-source.png` → 重跑脚本(图形标位置变化时按报错更新
`EXPECTED_MARK_BBOX` / `WORDMARK_TOP_Y`)→ 查看 `preview.png` → 重新打包桌面端。

设计与验收:`docs/plans/brand-logo-refresh/spec.md`。
