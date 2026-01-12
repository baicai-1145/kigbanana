# Nano Banana Pro 公益生成站

这是一个基于 Cloudflare Workers + KV + Gemini-3-Pro-Image (ModelVerse API) 构建的图片生成公益站。

## 功能特性
- **极简设计**：全站黑白配色，适配移动端。
- **配额控制**：
  - 游客：每天 3 张 (按 IP 统计)。
  - 注册用户：每天 50 张。
  - 管理员：无限额度。
- **安全保障**：API Key 隐藏在后端，不暴露。
- **反馈系统**：用户可提交生成效果差的情况，管理员可查看并优化 Prompt。
- **注册机制**：需要邀请码注册，邀请码由管理员生成。

## 部署步骤

### 1. 准备环境
- 注册 [Cloudflare](https://www.cloudflare.com/) 账号。
- 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)。

### 2. 创建 KV 命名空间
在 Cloudflare 控制台或使用命令创建一个名为 `KIG_KV` 的命名空间：
```bash
wrangler kv:namespace create KIG_KV
```
记下返回的 `id`。

### 3. 配置 `wrangler.toml`
将本项目根目录下的 `wrangler.toml` 中的 `YOUR_KV_NAMESPACE_ID` 替换为上面获得的 ID。

### 4. 设置密钥
在 Cloudflare 控制台或使用命令设置以下密钥：
```bash
npx wrangler secret put API_KEY
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
```

### 5. 部署
```bash
npx wrangler deploy
```

### 6. 初始化
1. 访问部署后的网址。
2. 使用您设置的管理员账户（`ADMIN_USERNAME` 和 `ADMIN_PASSWORD`）登录。
3. 登录后在页面底部打开管理员面板。
4. 将 `nano_banana_pro_kig_en.md` 中的内容完整粘贴到 **系统 Prompt 修改** 框中并点击更新。

## 运营说明
- **获取邀请码**：管理员登录后点击“生成新邀请码”，将代码发给需要注册的用户。
- **优化 Prompt**：定期查看“用户反馈列表”，根据用户的图片和反馈调整系统提示词。

## 技术栈
- 前端：Tailwind CSS + Vanilla JS
- 后端：Cloudflare Workers
- 数据库：Cloudflare KV
- API：ModelVerse (Gemini-3-Pro-Image)
