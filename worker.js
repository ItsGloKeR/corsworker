import http from "http";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import os from "os";

const CACHE_TTL = 60 * 1000; // 60 seconds
const PORT = process.env.PORT || 3000;

// In-memory cache for small responses
const memoryCache = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const target = url.searchParams.get("url");

    if (!target) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      return res.end("Missing target URL");
    }

    const now = Date.now();
    const cacheEntry = memoryCache.get(target);

    if (cacheEntry && now - cacheEntry.timestamp < CACHE_TTL) {
      console.log("Cache hit:", target);
      res.writeHead(cacheEntry.status, cacheEntry.headers);
      return res.end(cacheEntry.body);
    }

    const response = await fetch(target, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? null : req,
    });

    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
      res.setHeader(key, value);
    });

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    res.writeHead(response.status);

    // Stream response directly
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) < 10 * 1024 * 1024) {
      // Small files -> store in memory
      const chunks = [];
      response.body.on("data", (chunk) => chunks.push(chunk));
      response.body.on("end", () => {
        const bodyBuffer = Buffer.concat(chunks);
        memoryCache.set(target, {
          timestamp: Date.now(),
          status: response.status,
          headers,
          body: bodyBuffer,
        });
      });
      response.body.pipe(res);
    } else {
      // Large files -> stream via temporary disk storage
      const tempFile = path.join(os.tmpdir(), `proxy-${Date.now()}`);
      const fileStream = fs.createWriteStream(tempFile);
      response.body.pipe(fileStream);
      response.body.pipe(res);

      fileStream.on("finish", () => {
        fs.unlink(tempFile, () => {});
      });

      response.body.on("error", (err) => {
        fs.unlink(tempFile, () => {});
      });
    }

    response.body.on("error", (err) => {
      console.error("Stream error:", err);
      res.destroy(err);
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`Error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Streaming & caching worker running on port ${PORT}`);
});
