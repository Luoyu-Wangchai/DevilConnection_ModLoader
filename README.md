# DevilConnection_ModLoader  
**《でびるコネクショん》（恶魔连结）通用模组加载器**

本项目是基于 [逍婉瑶改](https://github.com/shouennyou/DevilConnection_ModLoader) 的 ShiroNeko 原始版本 的第三次 Rebuild。

---

## 📖 项目简介

`DevilConnection_ModLoader` 是专为游戏 **《でびるコネクショん》** 设计的模组加载引擎。  
它能够在 **不修改原版游戏文件** 的前提下，于运行时动态替换或注入自定义内容，实现高度灵活的模组支持。  
Rebuild 版多了一些规范，并修复了原版中的些许小问题。

---

## ✨ 核心特性

- **模组无感加载**  
  运行时拦截文件读取，把 `resources/plugins` 下的 `.asar` 模组映射覆盖进游戏，不改动任何原版文件。

- **hook.js 脚本注入**  
  每个模组的 `hook.js` 在游戏页面脚本之前、按优先级顺序注入主世界，页面重载自动重注入。

- **加载优先级**  
  模组按 `NNN_` 数字前缀排序，数字越小优先级越高；同名文件由靠前者覆盖。

- **加密模组支持**  
  兼容基于 **RSA + AES**（`DC_ENC_v1`）的加密资源方案。

- **场景补丁注入**  
  拦截 `chara_define.ks` / `plugin.ks`，把模组的角色 / 插件定义注入到 `[return]` 前。

- **mods.json 信息与版本验证**  
  用 `mods.json` 声明描述和其他重要信息，可自动判定升级降级。

- **拖放 & 压缩包导入**  
  可直接拖入 `asar` 或 `zip` 与 `rar` 压缩包，自动识别和解压 asar 与对应 config 文件夹。

- **模组形态**  
  模组禁用使用改后缀加 `.disable` 来实现，且不再允许非 asar 的文件或文件夹干扰模组加载。

---

## ⚖️ 许可与版权声明

- **三改作者**：[Wangchai](https://github.com/Luoyu-Wangchai)  
- **二改作者**：[逍婉瑶](https://github.com/shouennyou)  
- **原始版本作者**：[ShiroNeko](https://steamcommunity.com/app/3054820/discussions/0/671726388306530312/)  

> **Copyright (c) 2026, 逍婉瑶. All rights reserved.**
> 
> **Portions Copyright (c) ShiroNeko.**

---

## 🚩 免责声明

- **非官方工具**：本项目为粉丝制作的第三方工具，与原游戏开发商无任何关联。  
- **风险自担**：由于涉及代码混淆、资源替换及底层注入，使用本工具可能导致存档损坏、环境冲突等问题，请务必自行备份。  
- **合规使用**：请确保在遵守当地法律法规及游戏用户协议的前提下使用本工具。

---

## 📅 更新日志

### v2026-07-08
- ✅ **[重构]** 首次正式发布 `DevilConnection_ModLoader_Rebuild`。  
- 🔗 **[兼容]** 兼容 ShiroNeko 原版 与 逍婉瑶二改 两个版本的补丁加载机制。

> 💬 **反馈建议**：如遇 Bug 或有功能建议，欢迎通过 [Issues](https://github.com/Luoyu-Wangchai/DevilConnection_ModLoader/issues) 提交！
