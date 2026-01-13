import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { LocalKV } from './local-kv.js';
import worker from './worker.js';

dotenv.config({ path: '.dev.vars' }); // 兼容 Cloudflare 的变量格式

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // 支持大图片上传
app.use(express.static('public'));

// 模拟 Cloudflare Worker 的 env 对象
const env = {
  KIG_KV: new LocalKV(),
  API_KEY: process.env.API_KEY,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  STREAM_API_ENDPOINT: process.env.STREAM_API_ENDPOINT,
  API_ENDPOINT: process.env.API_ENDPOINT,
  // 模拟 ASSETS 行为
  ASSETS: {
    fetch: async (req) => {
      // 本地由 express.static 处理，这里简单返回
      return new Response("Not Found", { status: 404 });
    }
  }
};

// 拦截所有 /api/* 请求，转发给 worker.js 处理
app.use('/api', async (req, res) => {
  // 将 Express 请求对象转换为类似 Web 标准的 Request 对象
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const fetchRequest = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? null : JSON.stringify(req.body)
  });

  // 模拟 ctx.waitUntil
  const ctx = {
    waitUntil: (promise) => promise.catch(console.error)
  };

  try {
    const response = await worker.fetch(fetchRequest, env, ctx);
    
    // 将 Web 标准 Response 转换回 Express Response
    res.status(response.status);
    response.headers.forEach((val, key) => res.set(key, val));
    
    // 处理流式响应 (Thinking Process)
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    console.error('Local Server Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`
🚀 Local server is running at: http://localhost:${PORT}
📁 Database saved to: data.db
🔧 Using config from: .dev.vars
  `);
});
