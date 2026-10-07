# pi-osc7501

Pi coding-agent extension that reports agent lifecycle via **OSC 7501** (Program Status Protocol) so terminals and inboxes (Ghostty, Rex, Herdr, etc.) learn state without screen heuristics.

Pi 编码代理扩展：通过 **OSC 7501** 程序状态协议在 PTY 上报告代理生命周期，终端/收件箱无需启发式解析屏幕即可获知状态。

Spec / 规范: https://www.superlogical.com/rex/docs/build/program-status  
Article / 文章: https://mitchellh.com/writing/program-status-osc7501

## Install / 安装

```bash
pi install git:github.com/p3psi-boo/pi-osc7501
```

Pin a commit or tag / 固定版本：

```bash
pi install git:github.com/p3psi-boo/pi-osc7501@main
```

Project-local / 项目级：

```bash
pi install -l git:github.com/p3psi-boo/pi-osc7501
```

Also accepted / 也可用：

```bash
pi install https://github.com/p3psi-boo/pi-osc7501
```

Update / 更新：`pi update --extensions`  
Remove / 卸载：`pi remove git:github.com/p3psi-boo/pi-osc7501`

Kill-switch: `OSC7501=0` disables emission (default enabled).  
禁用开关：`OSC7501=0` 关闭上报（默认开启）。

## State mapping / 状态映射

| Pi event | OSC 7501 `state` | Notes |
| --- | --- | --- |
| `session_start` (TUI, idle) | `idle` | Skips RPC/JSON/print (`ctx.mode !== "tui"`) |
| `session_start` (TUI, agent mid-run) | `working` | Reload mid-turn |
| `agent_start` | `working` | |
| `agent_settled` + `isIdle()` | `done` | Result ready for inbox; next `agent_start` → `working` |
| `herdr:blocked` / `osc7501:blocked` `{active:true}` | `blocked` | `kind` default `permission`; `msg` from `label` or `msg` |
| blocked `{active:false}` | restore | `working` if agent active, else `done`/`idle` |
| `session_shutdown` | `idle` | Clears blocked counters |

Always includes `app=pi`. Identical `state`+`kind`+`msg` reports are deduplicated.

## Permission / blocked events

Permission or question plugins can emit:

```js
pi.events.emit("osc7501:blocked", {
  active: true,
  kind: "permission", // or "question" | "auth"
  msg: "Allow bash?",
});
// when resolved:
pi.events.emit("osc7501:blocked", { active: false });
```

Also listens for `herdr:blocked` (same shape: `active`, optional `kind`, `label`/`msg`) so existing herdr-aware permission hooks work without talking to herdr sockets — this extension **only** writes OSC sequences to the TTY.

权限/提问插件可按上式发出 `osc7501:blocked`；亦兼容 `herdr:blocked`。本扩展**不**连接 herdr socket，只向控制终端写 OSC。

## Wire format

```
ESC ] 7501 ; state=working:app=pi:msg=<base64> ESC \
```

## Limitations / 限制

- `blocked` requires another extension/plugin to emit `osc7501:blocked` or `herdr:blocked`; Pi core alone does not surface permission prompts as OSC.
- Only active in TUI mode (`ctx.mode === "tui"`).
- Feature detection (`OSC 7501 ; ? ST`) is skipped; reports are always emitted — well-behaved terminals ignore unknown OSC.
- Write failures (no TTY) are swallowed; never throws.

## License

WTFPL
