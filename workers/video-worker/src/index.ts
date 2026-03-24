type Env = {
  VIDEO_BUCKET: R2Bucket
  VIDEO_UPLOAD_TOKEN?: string
  PUBLIC_BASE_URL?: string
  ALLOWED_ORIGINS?: string
  MAX_VIDEO_BYTES?: string
}

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set("content-type", "application/json; charset=utf-8")
  return new Response(JSON.stringify(data), { ...init, headers })
}

function getAllowedOrigin(request: Request, env: Env) {
  const requestOrigin = request.headers.get("origin")
  const allowed = (env.ALLOWED_ORIGINS ?? "*").trim()
  if (!requestOrigin) return "*"
  if (allowed === "*") return "*"
  const list = allowed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (list.includes(requestOrigin)) return requestOrigin
  return list.length ? list[0] : "*"
}

function withCors(request: Request, env: Env, headers?: HeadersInit) {
  const h = new Headers(headers)
  h.set("access-control-allow-origin", getAllowedOrigin(request, env))
  h.set("access-control-allow-methods", "GET,POST,PUT,OPTIONS")
  h.set("access-control-allow-headers", "content-type,authorization,x-filename")
  h.set("access-control-max-age", "86400")
  h.set("vary", "origin")
  return h
}

function unauthorized(request: Request, env: Env) {
  return json(
    { error: "unauthorized" },
    { status: 401, headers: withCors(request, env) }
  )
}

function forbid(request: Request, env: Env, message: string) {
  return json({ error: message }, { status: 400, headers: withCors(request, env) })
}

function getBearerToken(request: Request) {
  const h = request.headers.get("authorization")
  if (!h) return null
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() ?? null
}

function requireAuth(request: Request, env: Env) {
  const expected = env.VIDEO_UPLOAD_TOKEN?.trim()
  if (!expected) return null
  const got = getBearerToken(request)
  if (!got || got !== expected) return unauthorized(request, env)
  return null
}

function maxVideoBytes(env: Env) {
  const raw = (env.MAX_VIDEO_BYTES ?? "").trim()
  const parsed = raw ? Number(raw) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 500 * 1024 * 1024
}

function safeExtFromFilename(filename: string | null) {
  if (!filename) return null
  const idx = filename.lastIndexOf(".")
  if (idx < 0) return null
  const ext = filename.slice(idx + 1).toLowerCase()
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return null
  return ext
}

function makeKey(filename: string | null) {
  const ext = safeExtFromFilename(filename)
  const base = crypto.randomUUID()
  return ext ? `${base}.${ext}` : base
}

function toPublicUrl(request: Request, env: Env, pathname: string) {
  const base = (env.PUBLIC_BASE_URL ?? "").trim() || new URL(request.url).origin
  const url = new URL(base)
  url.pathname = pathname
  return url.toString()
}

function toPublicVideoUrl(request: Request, env: Env, key: string) {
  return toPublicUrl(request, env, `/api/videos/${encodeURIComponent(key)}`)
}

function toPublicFileUrl(request: Request, env: Env, key: string) {
  return toPublicUrl(request, env, `/api/files/${encodeURIComponent(key)}`)
}

function parseRange(rangeHeader: string | null) {
  if (!rangeHeader) return null
  const m = rangeHeader.match(/^bytes=(\d+)-(\d+)?$/)
  if (!m) return null
  const start = Number(m[1])
  const end = m[2] ? Number(m[2]) : null
  if (!Number.isFinite(start) || start < 0) return null
  if (end !== null && (!Number.isFinite(end) || end < start)) return null
  return { start, end }
}

async function handleUploadMultipart(request: Request, env: Env) {
  const auth = requireAuth(request, env)
  if (auth) return auth

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return forbid(request, env, "expected multipart/form-data")
  }

  const form = await request.formData()
  const maybeFile = form.get("file") ?? form.get("video")
  if (!(maybeFile instanceof File)) {
    return forbid(request, env, "missing file field (file or video)")
  }

  const maxBytes = maxVideoBytes(env)
  if (maybeFile.size > maxBytes) {
    return forbid(
      request,
      env,
      `file too large (max ${maxBytes} bytes, got ${maybeFile.size} bytes)`
    )
  }

  const key = makeKey(maybeFile.name)
  const ct = maybeFile.type || "application/octet-stream"

  await env.VIDEO_BUCKET.put(key, maybeFile.stream(), {
    httpMetadata: { contentType: ct },
    customMetadata: {
      originalFilename: maybeFile.name,
    },
  })

  return json(
    { ok: true, key, url: toPublicVideoUrl(request, env, key), contentType: ct, bytes: maybeFile.size },
    { status: 200, headers: withCors(request, env) }
  )
}

async function handleUploadPut(request: Request, env: Env, key: string) {
  const auth = requireAuth(request, env)
  if (auth) return auth

  const maxBytes = maxVideoBytes(env)
  const contentLength = request.headers.get("content-length")
  if (contentLength) {
    const len = Number(contentLength)
    if (Number.isFinite(len) && len > maxBytes) {
      return forbid(request, env, `file too large (max ${maxBytes} bytes, got ${len} bytes)`)
    }
  }

  if (!request.body) {
    return forbid(request, env, "missing request body")
  }

  const ct = request.headers.get("content-type") || "application/octet-stream"
  const filename = request.headers.get("x-filename")

  await env.VIDEO_BUCKET.put(key, request.body, {
    httpMetadata: { contentType: ct },
    customMetadata: filename ? { originalFilename: filename } : undefined,
  })

  return json(
    { ok: true, key, url: toPublicVideoUrl(request, env, key), contentType: ct },
    { status: 200, headers: withCors(request, env) }
  )
}

async function handleGetObject(request: Request, env: Env, key: string) {
  const range = parseRange(request.headers.get("range"))
  if (range) {
    const head = await env.VIDEO_BUCKET.head(key)
    if (!head) return new Response("Not Found", { status: 404, headers: withCors(request, env) })

    const size = head.size
    if (range.start >= size) {
      const h = withCors(request, env, { "content-range": `bytes */${size}` })
      return new Response(null, { status: 416, headers: h })
    }

    const end = range.end === null ? size - 1 : Math.min(range.end, size - 1)
    const length = end - range.start + 1
    const obj = await env.VIDEO_BUCKET.get(key, { range: { offset: range.start, length } })
    if (!obj || !obj.body) return new Response("Not Found", { status: 404, headers: withCors(request, env) })

    const h = withCors(request, env)
    h.set("accept-ranges", "bytes")
    h.set("content-range", `bytes ${range.start}-${end}/${size}`)
    h.set("content-length", String(length))
    h.set("content-type", obj.httpMetadata?.contentType || "application/octet-stream")

    return new Response(obj.body, { status: 206, headers: h })
  }

  const obj = await env.VIDEO_BUCKET.get(key)
  if (!obj || !obj.body) return new Response("Not Found", { status: 404, headers: withCors(request, env) })

  const h = withCors(request, env)
  h.set("accept-ranges", "bytes")
  h.set("content-type", obj.httpMetadata?.contentType || "application/octet-stream")
  h.set("content-length", String(obj.size))

  return new Response(obj.body, { status: 200, headers: h })
}

async function handleUploadMultipartFile(request: Request, env: Env) {
  const auth = requireAuth(request, env)
  if (auth) return auth

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return forbid(request, env, "expected multipart/form-data")
  }

  const form = await request.formData()
  const maybeFile =
    form.get("file") ??
    form.get("document") ??
    form.get("image") ??
    form.get("logo") ??
    form.get("video")
  if (!(maybeFile instanceof File)) {
    return forbid(request, env, "missing file field")
  }

  const maxBytes = maxVideoBytes(env)
  if (maybeFile.size > maxBytes) {
    return forbid(
      request,
      env,
      `file too large (max ${maxBytes} bytes, got ${maybeFile.size} bytes)`
    )
  }

  const key = `files/${makeKey(maybeFile.name)}`
  const ct = maybeFile.type || "application/octet-stream"

  await env.VIDEO_BUCKET.put(key, maybeFile.stream(), {
    httpMetadata: { contentType: ct },
    customMetadata: {
      originalFilename: maybeFile.name,
    },
  })

  return json(
    { ok: true, key, url: toPublicFileUrl(request, env, key), contentType: ct, bytes: maybeFile.size },
    { status: 200, headers: withCors(request, env) }
  )
}

async function handleUploadPutFile(request: Request, env: Env, key: string) {
  const auth = requireAuth(request, env)
  if (auth) return auth

  const maxBytes = maxVideoBytes(env)
  const contentLength = request.headers.get("content-length")
  if (contentLength) {
    const len = Number(contentLength)
    if (Number.isFinite(len) && len > maxBytes) {
      return forbid(request, env, `file too large (max ${maxBytes} bytes, got ${len} bytes)`)
    }
  }

  if (!request.body) {
    return forbid(request, env, "missing request body")
  }

  const ct = request.headers.get("content-type") || "application/octet-stream"
  const filename = request.headers.get("x-filename")

  const fullKey = key.startsWith("files/") ? key : `files/${key}`
  await env.VIDEO_BUCKET.put(fullKey, request.body, {
    httpMetadata: { contentType: ct },
    customMetadata: filename ? { originalFilename: filename } : undefined,
  })

  return json(
    { ok: true, key: fullKey, url: toPublicFileUrl(request, env, fullKey), contentType: ct },
    { status: 200, headers: withCors(request, env) }
  )
}

export default {
  async fetch(request, env: Env) {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors(request, env) })
    }

    if (request.method === "GET" && path === "/") {
      return json({ ok: true, service: "video-upload-worker" }, { status: 200, headers: withCors(request, env) })
    }

    if (request.method === "POST" && path === "/api/videos") {
      return handleUploadMultipart(request, env)
    }

    const m = path.match(/^\/api\/videos\/([^/]+)$/)
    if (m) {
      const key = decodeURIComponent(m[1])
      if (request.method === "PUT") return handleUploadPut(request, env, key)
      if (request.method === "GET") return handleGetObject(request, env, key)
    }

    if (request.method === "POST" && (path === "/api/files" || path === "/upload")) {
      return handleUploadMultipartFile(request, env)
    }

    const f = path.match(/^\/api\/files\/([^/]+)$/)
    if (f) {
      const key = decodeURIComponent(f[1])
      if (request.method === "PUT") return handleUploadPutFile(request, env, key)
      if (request.method === "GET") return handleGetObject(request, env, key)
    }

    return new Response("Not Found", { status: 404, headers: withCors(request, env) })
  },
}

