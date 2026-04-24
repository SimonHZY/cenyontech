const http = require("http");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const rootDir = __dirname;

loadEnvFile();

const port = Number(process.env.PORT || 3000);

function loadEnvFile() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Build the SMTP transport.
// If SMTP_USER / SMTP_PASS are empty, Node will try to send without login.
// This only works when your mail server supports internal relay / no-auth relay.
function createMailer() {
  const config = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true",
  };

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    config.auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  }

  return nodemailer.createTransport(config);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function serveFile(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = path
    .normalize(decodeURIComponent(requestPath))
    .replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(rootDir, safePath);

  if (!filePath.startsWith(rootDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      sendText(res, 404, "Not Found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentTypeMap = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ico": "image/x-icon",
    };

    res.writeHead(200, {
      "Content-Type": contentTypeMap[extension] || "application/octet-stream",
    });

    fs.createReadStream(filePath).pipe(res);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseUrlEncodedBody(body) {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

// Parse multipart/form-data sent by a regular browser form or FormData.
function parseMultipartBody(body, boundary) {
  const result = {};
  const parts = body.split(`--${boundary}`);

  for (const part of parts) {
    if (!part || part === "--\r\n" || part === "--") {
      continue;
    }

    const separatorIndex = part.indexOf("\r\n\r\n");
    if (separatorIndex === -1) {
      continue;
    }

    const rawHeaders = part.slice(0, separatorIndex);
    const rawValue = part.slice(separatorIndex + 4);
    const nameMatch = rawHeaders.match(/name="([^"]+)"/i);

    if (!nameMatch) {
      continue;
    }

    result[nameMatch[1]] = rawValue
      .replace(/\r\n$/, "")
      .replace(/--$/, "")
      .trim();
  }

  return result;
}

// Choose the parser based on the request Content-Type.
function parseRequestBody(req, body) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      throw new Error("Multipart boundary is missing.");
    }

    return parseMultipartBody(body, boundaryMatch[1]);
  }

  return parseUrlEncodedBody(body);
}

function validateForm(form) {
  if (!form.form_name || !form.email || !form.form_message) {
    return "Please complete all required fields.";
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(form.email)) {
    return "Please enter a valid email address.";
  }

  return "";
}

async function handleSendMessage(req, res) {
  try {
    const body = await readRequestBody(req);
    const form = parseRequestBody(req, body);
    const errorMessage = validateForm(form);

    if (errorMessage) {
      sendJson(res, 400, { success: false, message: errorMessage });
      return;
    }

    const fromAddress = process.env.MAIL_FROM || "hzy605933924@163.com";
    const toAddress = process.env.MAIL_TO || "market@cenyontech.com";

    if (!process.env.SMTP_HOST || !fromAddress || !toAddress) {
      throw new Error("SMTP_HOST, MAIL_FROM and MAIL_TO must be configured.");
    }

    // Send the form fields as the email content.
    await createMailer().sendMail({
      from: fromAddress,
      to: toAddress,
      replyTo: form.email,
      subject: `留言板信息`,
      text: [
        `标题: ${form.form_name}`,
        `联系邮箱: ${form.email}`,
        "",
        "右键内容:",
        form.form_message,
      ].join("\n"),
    });

    sendJson(res, 200, {
      success: true,
      message: "提交成功",
    });
  } catch (error) {
    console.error("Send mail failed:", error.message);
    sendJson(res, 500, { success: false, message: "提交失败，请刷新重试" });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/send-message") {
    handleSendMessage(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveFile(req, res);
    return;
  }

  sendText(res, 405, "Method Not Allowed");
});

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
