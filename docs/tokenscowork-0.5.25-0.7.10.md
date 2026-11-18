# 连接中心 2.10.0：TokensCowork 0.5.25 / 0.7.10 兼容验证

日期：2026-11-05。被测安装包：`tokensapi-dsh-connect-2.10.0.tgz`，SHA-256 `3ff62bc180f78ae2936e2c067bfca3e8897174b1ac62ef6023b417880085c4e1`。

| 验证项 | TokensCowork 0.5.25 | TokensCowork 0.7.10 |
| --- | --- | --- |
| 宿主来源 | 桌面原始 DMG，只读挂载并展开 ASAR | 当前 `/Applications/TokensCowork.app` |
| DSH / Cordis | 0.1.5-rc.2 / 4.0.2 | 0.2.1-rc.2 / 4.0.5 |
| 应用自带 Node | 24.18.1 | 24.18.1 |
| 运行接口与 Telegram 重连回归 | 42/42 通过 | 42/42 通过 |
| 实际 npm 包完整激活 | 通过 | 通过 |
| PDF 返回工具 dsh_im_return_file 注册 | 通过 | 通过 |
| 12 个渠道状态接口 | 12/12 成功 | 12/12 成功 |
| 中英文设置入口、页面和卸载清理契约 | 通过 | 通过 |

结论：本安装包通过这两个准确版本的插件运行与前端服务契约验证。没有为了兼容而删减上游功能，也没有修改插件运行代码。本轮调整的是隔离测试夹具：旧加载器需要明确的测试探针文件 URL，旧宿主的 HMR 需要 --expose-internals 启动参数；这些调整不进入运行包。

## 覆盖内容

每版 42 项由 12 项真实网关 RPC/描述符检查、11 项各渠道客户端通过真实网关的入站回复检查、2 项真实网关 Peer/端点检查、4 项流式助手检查、9 项空白宿主真实工作区/会话/模型目录检查和 4 项 PitWall 重连回归组成。所有 42 项均执行，0 失败、0 跳过。

网关和流式检查使用所选版本自带的 Cordis、网关、描述符和流式累积器，业务接收者或模型回复在相应用例中模拟。9 项真实宿主检查使用真实服务和空白临时配置。PitWall 回归模拟 Telegram 与模型端，覆盖断线期间/之后报告完成、停用取消、超时和不重试结果未知的发送。

实际包检查从同一个 tgz 解出文件，使用本地已有的包声明外部依赖和被测宿主自身的 credentials/tools 实例，启动空白宿主并运行实际导出 apply；检查 deliveryContract、PDF 返回工具、飞书授权工具以及 Telegram、Email、Matrix、飞书、钉钉、微信、企业微信、QQ、Slack、Discord、WhatsApp、iMessage 共 12 个管理接口。接口请求通过真实宿主共享 Fetch dispatcher 在进程内派发。未模拟渠道 controller 或插件 activation。

前端契约检查使用所选宿主真实 SlotCore 与 LocaleRuntime，注册实际打包客户端，验证只有一个连接中心设置入口、中英文切换、页面含 Telegram 标签、卸载后设置入口清理。React/ReactDOM 服务端渲染使用现有 18.3.1，与两个宿主的 React 版本一致；语言模块不参与检查的设置行 UI/Store 依赖作空桩，连接 RPC 保持等待，不访问账号。CSS 样式未验收，宿主整套桌面 UI 未启动。Matrix 图标在开发态 SSR 有上游 fill-rule 属性警告，页面仍正常渲染。

## 验证边界

- 两个应用安装包都裁剪了部分 .d.ts，完整 `npm run check:host` 的静态声明门禁仍不能计为通过。本轮直接执行了可运行的契约用例；依赖缺失类型文件的断言没有混入 42 项通过数。
- 这是插件层兼容验证，尚未完成安装后的真实模型生成 → Telegram PDF 收件验收；不能承诺任何网络中断下都必达。
- 网络恢复为同一进程内的任务保留。TC/插件重启不会持久恢复；已经发出且结果未知的请求不自动重发。
- 未覆盖 Windows、Intel Mac 或其它产品版本。

## 可复用入口

源码保留 `scripts/check-packed-host.mjs`、`scripts/check-client-host.mjs` 和 `test/support/packed-host-probe.mjs`。包检查参数依次是宿主根目录、该应用的 Node/Electron Node 执行文件、tgz 路径、输出 JSON 路径。前端检查参数依次是宿主根目录、已打包 lib/client.js、输出 JSON 路径。

```sh
node scripts/check-packed-host.mjs <host-root> <runtime> <package.tgz> <report.json>
node scripts/check-client-host.mjs <host-root> <lib/client.js> <report.json>
```

运行用例使用 DSH_HOST_ROOT 指向被测版本，ELECTRON_RUN_AS_NODE=1 使用对应应用二进制，运行 `test/host-rpc-contract.test.mjs`、`test/host-channel-contract.test.mjs`、`test/host-gateway-peer-contract.test.mjs`、`test/host-live-chunk-contract.test.mjs`、`test/host-live-contract.test.mjs` 及 `test/channels/telegram/pitwall-reconnect.test.mjs`。发布前仍应保留完整 check:host 门禁，不把缺失声明降为通过。

## 清理与现用状态

测试实例均已退出，dsh-connect-live-home-* / dsh-connect-packed-home-* 临时配置目录为空。旧版 DMG 在验证后卸载，只保留独立展开的宿主文件用于后续回归。没有覆盖、重启现用 TC，没有读取现有 Bot 凭证或配置，没有连接真实 Telegram/模型，现用连接中心仍是 2.9.7。
