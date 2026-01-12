/**
 * Cloudflare Worker for Nano Banana Pro
 * Handles: Static assets, API Proxy, Auth, Quotas, Reports
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/favicon.ico") return new Response(null, { status: 404 });

    // 1. 处理静态资源 (Cloudflare Pages 模式下会自动处理，但 Worker 模式需要手动)
    // 这里简单处理：如果是根路径或 HTML，返回 index.html 内容（稍后编写）
    if (path === "/" || path === "/index.html") {
      return new Response(await env.ASSETS.fetch(request));
    }

    // 2. API 路由
    try {
      if (path === "/undefined") {
        return new Response("Not Found", { status: 404 });
      }
      
      if (path === "/api/generate" && request.method === "POST") {
        return await handleGenerate(request, env, ctx);
      }
      if (path === "/api/auth/register" && request.method === "POST") {
        return await handleRegister(request, env);
      }
      if (path === "/api/auth/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }
      if (path === "/api/report" && request.method === "POST") {
        return await handleReport(request, env);
      }
      if (path === "/api/admin/reports" && request.method === "GET") {
        return await handleGetReports(request, env);
      }
      if (path === "/api/admin/prompt" && request.method === "POST") {
        return await handleUpdatePrompt(request, env);
      }
      if (path === "/api/admin/gen-invite" && request.method === "POST") {
        return await handleGenInvite(request, env);
      }
      if (path === "/api/admin/reset-quota" && request.method === "POST") {
        return await handleResetQuota(request, env);
      }
      if (path === "/api/admin/list-targets" && request.method === "GET") {
        return await handleAdminListTargets(request, env);
      }
      if (path === "/api/showcase/publish" && request.method === "POST") {
        return await handlePublishToShowcase(request, env);
      }
      if (path === "/api/showcase/list" && request.method === "GET") {
        return await handleGetShowcase(request, env);
      }
      if (path === "/api/history/thumbnail" && request.method === "POST") {
        return await handleUpdateThumbnail(request, env);
      }
      if (path === "/api/admin/showcase/delete" && request.method === "POST") {
        return await handleAdminDeleteShowcase(request, env);
      }
      if (path === "/api/admin/showcase/add" && request.method === "POST") {
        return await handleAdminAddShowcase(request, env);
      }
      if (path === "/api/admin/get-prompt" && request.method === "GET") {
        const prompt = await env.KIG_KV.get("config:system_prompt") || "Default prompt...";
        return new Response(JSON.stringify({ prompt }), { headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/user/history" && request.method === "GET") {
        return await handleGetUserHistory(request, env);
      }
      if (path === "/api/admin/history" && request.method === "GET") {
        return await handleGetAllHistory(request, env);
      }
      if (path === "/api/task" && request.method === "GET") {
        return await handleGetTask(request, env);
      }
      if (path === "/api/user/info" && request.method === "GET") {
        return await handleUserInfo(request, env);
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }

    // 如果未命中，尝试从 ASSETS 获取（用于 JS/CSS 文件）
    return env.ASSETS.fetch(request);
  }
};

// --- 辅助函数 ---

async function getClientIdentifier(request) {
  // 获取 IP 或 Token
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    // 这里简化：Token 就是用户名（实际应加密或校验）
    return { type: "user", id: token };
  }
  const ip = request.headers.get("cf-connecting-ip") || "anonymous";
  return { type: "ip", id: ip };
}

async function checkQuota(identifier, env) {
  const date = new Date().toISOString().split("T")[0];
  const key = `quota:${identifier.type}:${date}:${identifier.id}`;
  const count = parseInt(await env.KIG_KV.get(key) || "0");

  let limit = 3; // 默认匿名 3 次
  if (identifier.type === "user") {
    const userData = await env.KIG_KV.get(`user:${identifier.id}`, { type: "json" });
    if (userData && userData.isAdmin) return true; // 管理员无限
    limit = 50; // 普通用户 50 次
  }

  if (count >= limit) return false;
  
  await env.KIG_KV.put(key, (count + 1).toString(), { expirationTtl: 86400 * 2 }); // 记录 2 天
  return true;
}

// --- 处理函数 ---

async function handleGenerate(request, env, ctx) {
  const identifier = await getClientIdentifier(request);
  const { imageBase64, mimeType, aspectRatio, resolution, imageHash } = await request.json();

  // 重试检查逻辑
  const retryKey = `retry:${identifier.id}:${imageHash}`;
  const retryCount = parseInt(await env.KIG_KV.get(retryKey) || "0");
  
  let isRetry = false;
  if (retryCount > 0 && retryCount < 3) {
    // 合法的重试（2-3次），不扣额度
    isRetry = true;
    await env.KIG_KV.put(retryKey, (retryCount + 1).toString(), { expirationTtl: 86400 * 7 });
  } else {
    // 新图或重试次数用完，检查并扣除每日配额
    const canGenerate = await checkQuota(identifier, env);
    if (!canGenerate) {
      return new Response(JSON.stringify({ error: "今日配额已用完，请注册或加群获取更多额度。" }), { status: 429 });
    }
    await env.KIG_KV.put(retryKey, "1", { expirationTtl: 86400 * 7 });
  }

  // 获取系统提示词
  let systemPrompt = await env.KIG_KV.get("config:system_prompt");
  if (!systemPrompt) {
    systemPrompt = `Use my uploaded image as the only reference. Perform a material and medium conversion; the content and composition must remain completely unchanged.
Target output: a “real camera-shot RAW photo look” kigurumi cosplay finished image.`;
  }

  const body = {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          { inlineData: { data: imageBase64, mimeType: mimeType } }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio || "1:1",
        imageSize: resolution || "1K"
      }
    }
  };

  // 使用 streamGenerateContent 实现流式思考过程
  const streamEndpoint = env.STREAM_API_ENDPOINT || "https://api.modelverse.cn/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent";
  const response = await fetch(streamEndpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": env.API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    return new Response(JSON.stringify({ error: `API Error: ${errText}` }), { status: response.status });
  }

  const taskId = Date.now().toString();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";

  ctx.waitUntil((async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
        accumulated += decoder.decode(value, { stream: true });
      }
      // 保存历史记录 (在流结束后)
      const originalImageUrl = `data:${mimeType};base64,${imageBase64}`;
      await saveHistoryFromStream(accumulated, identifier, aspectRatio, resolution, env, taskId, originalImageUrl);
    } catch (e) {
      console.error("Stream processing error:", e);
    } finally {
      writer.close();
    }
  })());

  return new Response(readable, {
    headers: { 
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Task-Id": taskId
    }
  });
}

async function saveHistoryFromStream(rawText, identifier, aspectRatio, resolution, env, taskId, originalImageUrl) {
  try {
    let fullText = "";
    let fullImage = null;

    // 尝试提取流中所有的 JSON 对象块
    const chunks = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < rawText.length; i++) {
      if (rawText[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (rawText[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          chunks.push(rawText.substring(start, i + 1));
        }
      }
    }

    for (let chunkStr of chunks) {
      try {
        const chunk = JSON.parse(chunkStr);
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text) fullText += part.text;
          if (part.inlineData) {
            fullImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          }
        }
      } catch (e) { /* 忽略损坏的块 */ }
    }

    // 只要有思考文本或有图，就保存
    if (fullText || fullImage) {
      const historyData = {
        id: taskId,
        user: identifier.id,
        type: identifier.type,
        aspectRatio,
        resolution,
        thinking: fullText,
        imageUrl: fullImage,
        originalImageUrl: originalImageUrl,
        time: new Date().toISOString()
      };

      // 优化存储：索引表依然不带大图和原图，只带元数据
      const metaData = { ...historyData, imageUrl: undefined, originalImageUrl: undefined, thinking: undefined };
      
      await env.KIG_KV.put(`history:user:${identifier.id}:${taskId}`, JSON.stringify(metaData));
      await env.KIG_KV.put(`history:all:${taskId}`, JSON.stringify(metaData));
      await env.KIG_KV.put(`task:${taskId}`, JSON.stringify(historyData));
    }
  } catch (e) {
    console.error("Save history failed:", e);
  }
}


async function handleGetUserHistory(request, env) {
  const identifier = await getClientIdentifier(request);
  
  // 按照 identifier.id 获取 (可能是 IP 或者是 Username)
  const list = await env.KIG_KV.list({ prefix: `history:user:${identifier.id}:`, reverse: true, limit: 20 });
  const history = [];
  for (const key of list.keys) {
    const data = await env.KIG_KV.get(key.name, { type: "json" });
    history.push(data);
  }
  return new Response(JSON.stringify(history), { headers: { "Content-Type": "application/json" } });
}

async function handleGetAllHistory(request, env) {
  const identifier = await getClientIdentifier(request);
  if (identifier.id !== "baicai1145") {
    return new Response("Unauthorized", { status: 401 });
  }

  const list = await env.KIG_KV.list({ prefix: "history:all:", reverse: true, limit: 50 });
  const history = [];
  for (const key of list.keys) {
    const data = await env.KIG_KV.get(key.name, { type: "json" });
    history.push(data);
  }
  return new Response(JSON.stringify(history), { headers: { "Content-Type": "application/json" } });
}

async function handleGetTask(request, env) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get("id");
  const identifier = await getClientIdentifier(request);
  
  const data = await env.KIG_KV.get(`task:${taskId}`, { type: "json" });
  if (!data) return new Response("Task not found", { status: 404 });

  // 权限检查：必须是任务所有者（IP/User）或者是管理员
  if (identifier.id !== "baicai1145" && data.user !== identifier.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}

async function handleRegister(request, env) {
  const { username, password, invitationCode } = await request.json();
  
  // 校验邀请码
  const valid = await env.KIG_KV.get(`invite:${invitationCode}`);
  if (!valid) {
    return new Response(JSON.stringify({ error: "邀请码无效，请加 QQ 3423714059 获取。" }), { status: 400 });
  }

  // 检查用户是否存在
  const existing = await env.KIG_KV.get(`user:${username}`);
  if (existing) {
    return new Response(JSON.stringify({ error: "用户名已存在。" }), { status: 400 });
  }

  await env.KIG_KV.put(`user:${username}`, JSON.stringify({ password, isAdmin: false }));
  await env.KIG_KV.delete(`invite:${invitationCode}`); // 消耗邀请码

  return new Response(JSON.stringify({ success: true }));
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  
  // 特殊处理管理员
  if (username === "baicai1145" && password === "18751172627wang") {
    return new Response(JSON.stringify({ token: username, isAdmin: true }));
  }

  const userData = await env.KIG_KV.get(`user:${username}`, { type: "json" });
  if (userData && userData.password === password) {
    return new Response(JSON.stringify({ token: username, isAdmin: false }));
  }

  return new Response(JSON.stringify({ error: "用户名或密码错误。" }), { status: 401 });
}

async function handleReport(request, env) {
  const { imageUrl, originalUrl, prompt, reason } = await request.json();
  const id = Date.now().toString();
  await env.KIG_KV.put(`report:${id}`, JSON.stringify({ 
    imageUrl, 
    originalUrl, 
    prompt, 
    reason, 
    time: new Date().toISOString() 
  }));
  return new Response(JSON.stringify({ success: true }));
}

async function handleGetReports(request, env) {
  const identifier = await getClientIdentifier(request);
  if (identifier.id !== "baicai1145") {
    return new Response("Unauthorized", { status: 401 });
  }

  const list = await env.KIG_KV.list({ prefix: "report:" });
  const reports = [];
  for (const key of list.keys) {
    const data = await env.KIG_KV.get(key.name, { type: "json" });
    reports.push({ id: key.name, ...data });
  }
  return new Response(JSON.stringify(reports), { headers: { "Content-Type": "application/json" } });
}

async function handleUpdatePrompt(request, env) {
  const identifier = await getClientIdentifier(request);
  if (identifier.id !== "baicai1145") {
    return new Response("Unauthorized", { status: 401 });
  }

  const { prompt } = await request.json();
  await env.KIG_KV.put("config:system_prompt", prompt);
  return new Response(JSON.stringify({ success: true }));
}

async function handlePublishToShowcase(request, env) {
  const identifier = await getClientIdentifier(request);
  const { taskId, originalUrl } = await request.json();
  
  // 仅允许登录用户发布，或者如果允许游客发布也可以，这里为了管理方便仅限登录用户或通过任务ID校验
  // 从全量任务中获取数据
  const taskData = await env.KIG_KV.get(`task:${taskId}`, { type: "json" });
  if (!taskData) return new Response("Task not found", { status: 404 });

  // 简单权限检查：如果是用户，检查是否是自己的任务；如果是管理员，随意
  if (identifier.id !== "baicai1145" && taskData.user !== identifier.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const showcaseData = {
    ...taskData,
    originalUrl: originalUrl || null, // 补充原图URL
    publishedAt: new Date().toISOString()
  };

  await env.KIG_KV.put(`showcase:${taskId}`, JSON.stringify(showcaseData));
  return new Response(JSON.stringify({ success: true }));
}

async function handleGetShowcase(request, env) {
  const list = await env.KIG_KV.list({ prefix: "showcase:", reverse: true, limit: 30 });
  const items = [];
  for (const key of list.keys) {
    const data = await env.KIG_KV.get(key.name, { type: "json" });
    if (data) items.push(data);
  }
  return new Response(JSON.stringify(items), { headers: { "Content-Type": "application/json" } });
}

async function handleAdminDeleteShowcase(request, env) {
  const identifier = await getClientIdentifier(request);
  if (identifier.id !== "baicai1145") {
    return new Response("Unauthorized", { status: 401 });
  }

  const { taskId } = await request.json();
  await env.KIG_KV.delete(`showcase:${taskId}`);
  return new Response(JSON.stringify({ success: true }));
}

async function handleAdminAddShowcase(request, env) {
  const identifier = await getClientIdentifier(request);
  if (identifier.id !== "baicai1145") {
    return new Response("Unauthorized", { status: 401 });
  }

  const { originalUrl, imageUrl } = await request.json();
  const taskId = "manual_" + Date.now();
  
  const showcaseData = {
    id: taskId,
    user: " baicai1145 (Admin)",
    originalUrl,
    imageUrl,
    publishedAt: new Date().toISOString()
  };

  await env.KIG_KV.put(`showcase:${taskId}`, JSON.stringify(showcaseData));
  return new Response(JSON.stringify({ success: true }));
}

async function handleUpdateThumbnail(request, env) {
  const identifier = await getClientIdentifier(request);
  const { taskId, thumbnail } = await request.json();
  
  // 更新用户的历史列表数据，加入缩略图
  const key = `history:user:${identifier.id}:${taskId}`;
  const data = await env.KIG_KV.get(key, { type: "json" });
  if (data) {
    data.thumbnail = thumbnail;
    await env.KIG_KV.put(key, JSON.stringify(data));
  }
  
  // 同时更新管理员总表
  const allKey = `history:all:${taskId}`;
  const allData = await env.KIG_KV.get(allKey, { type: "json" });
  if (allData) {
    allData.thumbnail = thumbnail;
    await env.KIG_KV.put(allKey, JSON.stringify(allData));
  }

  return new Response(JSON.stringify({ success: true }));
}

async function handleGenInvite(request, env) {
  const identifier = await getClientIdentifier(request);
  if (identifier.id !== "baicai1145") {
    return new Response("Unauthorized", { status: 401 });
  }

  const code = Math.random().toString(36).substring(2, 10).toUpperCase();
  await env.KIG_KV.put(`invite:${code}`, "unused");
  return new Response(JSON.stringify({ code }));
}

async function handleAdminListTargets(request, env) {
  const identifier = await getClientIdentifier(request);
  if (identifier.id !== "baicai1145") {
    return new Response("Unauthorized", { status: 401 });
  }

  const date = new Date().toISOString().split("T")[0];
  
  // 获取所有带 quota 前缀的 key 来识别活跃用户和 IP
  const quotaList = await env.KIG_KV.list({ prefix: `quota:`, limit: 100 });
  const users = new Set();
  const ips = new Set();

  for (const key of quotaList.keys) {
    const parts = key.name.split(":"); // quota:type:date:id
    if (parts.length >= 4) {
      if (parts[1] === "user") users.add(parts[3]);
      else if (parts[1] === "ip") ips.add(parts[3]);
    }
  }

  // 也可以从用户表获取所有注册用户
  const userList = await env.KIG_KV.list({ prefix: `user:`, limit: 100 });
  for (const key of userList.keys) {
    users.add(key.name.split(":")[1]);
  }

  return new Response(JSON.stringify({
    users: Array.from(users),
    ips: Array.from(ips)
  }), { headers: { "Content-Type": "application/json" } });
}

async function handleResetQuota(request, env) {
  const identifier = await getClientIdentifier(request);
  if (identifier.id !== "baicai1145") {
    return new Response("Unauthorized", { status: 401 });
  }

  const { type, targetId } = await request.json();
  const date = new Date().toISOString().split("T")[0];
  const key = `quota:${type}:${date}:${targetId}`;
  
  await env.KIG_KV.delete(key);
  return new Response(JSON.stringify({ success: true }));
}

async function handleUserInfo(request, env) {
  const identifier = await getClientIdentifier(request);
  const date = new Date().toISOString().split("T")[0];
  
  if (identifier.type === "user") {
    const quotaKey = `quota:user:${date}:${identifier.id}`;
    const used = parseInt(await env.KIG_KV.get(quotaKey) || "0");
    const isAdmin = identifier.id === "baicai1145";
    const limit = isAdmin ? "∞" : 50;
    return new Response(JSON.stringify({ username: identifier.id, used, limit, isAdmin, loggedIn: true }), { headers: { "Content-Type": "application/json" } });
  } else {
    const quotaKey = `quota:ip:${date}:${identifier.id}`;
    const used = parseInt(await env.KIG_KV.get(quotaKey) || "0");
    return new Response(JSON.stringify({ username: "游客", used, limit: 3, isAdmin: false, loggedIn: false }), { headers: { "Content-Type": "application/json" } });
  }
}
