/**
 * Host half of dsh-comfyui-studio.
 *
 * Registers:
 * - the `comfyui_generate` tool (txt2img through a local or remote ComfyUI),
 * - the `comfyui_studio` tool (probe / models / launch / stop / interrupt),
 * - the `/comfyui-studio/...` HTTP routes the plugin page talks to.
 *
 * Every knob comes from the settings section, read per request, so editing the
 * page changes the very next generation without a restart. Nothing here
 * installs software: the launcher only runs the interpreter and `main.py` the
 * user pointed at.
 * @module dsh-comfyui-studio
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import {
  Config,
  DEFAULT_CONFIG,
  HARDWARE_PRESETS,
  NAMESPACE,
  ROW_IDS,
  SAMPLERS,
  SCHEDULERS,
  resolveConfig,
} from './config.js'
import {
  ComfyError,
  buildTxt2ImgWorkflow,
  interrupt,
  launchServer,
  launcherAvailability,
  launchedServers,
  listModels,
  mergeWorkflow,
  probeServer,
  runWorkflow,
  stopLaunched,
} from './comfy.js'

/** Stable Loader identity. */
export const name = 'comfyui-studio'

/** Only the tool registry is a hard requirement; routes mount lazily. */
export const inject = ['tools', 'attachments']

export { Config, DEFAULT_CONFIG, HARDWARE_PRESETS, NAMESPACE, ROW_IDS, SAMPLERS, SCHEDULERS, resolveConfig }

/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/comfyui-studio'

/** Where the browser half reads and writes. */
export const ROUTE = {
  state: `${ROUTE_PREFIX}/state`,
  save: `${ROUTE_PREFIX}/save`,
  reset: `${ROUTE_PREFIX}/reset`,
  probe: `${ROUTE_PREFIX}/probe`,
  models: `${ROUTE_PREFIX}/models`,
  launch: `${ROUTE_PREFIX}/launch`,
  stop: `${ROUTE_PREFIX}/stop`,
  interrupt: `${ROUTE_PREFIX}/interrupt`,
  presets: `${ROUTE_PREFIX}/presets`,
  preview: `${ROUTE_PREFIX}/preview`,
  file: `${ROUTE_PREFIX}/file`,
}

/** Route mounts already owned, so a reload never double-registers. */
const mounts = new WeakMap()

/**
 * Probe the settings service for this plugin's live section.
 *
 * 0.2.x exposes `settings.describe()`, which is the only path this plugin
 * needs; the fallback keeps the composition config working on a host whose
 * settings service is absent.
 * @param ctx - plugin context.
 * @param fallback - composition config from `apply`.
 * @returns a reader that answers the current section on every call.
 */
function installSettingsSource(ctx, fallback) {
  let read = () => undefined
  ctx.inject(['settings'], (settingsCtx) => {
    const service = settingsCtx.get('settings')
    if (typeof service?.describe !== 'function') return
    read = () => {
      const rows = service.describe({ redactSecrets: false })
      if (!Array.isArray(rows)) return undefined
      for (const id of ROW_IDS) {
        const row = rows.find((candidate) => String(candidate?.ns ?? '') === id)
        if (row !== undefined && row.value !== undefined) return row.value
      }
      return rows.find((row) => String(row?.ns ?? '').includes(NAMESPACE) && row.value !== undefined)?.value
    }
  })
  return () => {
    try {
      const value = read()
      if (value !== undefined) return value
    } catch {
      // A describe() hiccup must not fail the request that read it.
    }
    return fallback
  }
}

/** The live settings descriptor for this plugin, or undefined. */
function findDescriptor(ctx) {
  const settings = ctx.get('settings')
  if (typeof settings?.describe !== 'function') return undefined
  const rows = settings.describe({ redactSecrets: false })
  if (!Array.isArray(rows)) return undefined
  for (const id of ROW_IDS) {
    const row = rows.find((candidate) => String(candidate?.ns ?? '') === id)
    if (row !== undefined) return row
  }
  return rows.find((row) => String(row?.ns ?? '').includes(NAMESPACE))
}

/** Read a bounded JSON request body. */
async function readJsonBody(req, limitBytes = 1_000_000) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limitBytes) throw new ComfyError('请求体过大', 'BODY_TOO_LARGE')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new ComfyError(`请求体不是合法 JSON：${error instanceof Error ? error.message : String(error)}`, 'BAD_BODY')
  }
}

/** Answer with JSON. */
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Resolve a prompt file path: absolute, or relative to the ComfyUI directory. */
function resolvePromptFile(config, value) {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const raw = value.trim()
  return isAbsolute(raw) ? raw : resolvePath(config.comfyuiDir, raw)
}

/** Read one prompt file, joining its non-empty lines. */
async function readPromptFile(path) {
  if (path === undefined || !existsSync(path)) return undefined
  try {
    const text = await readFile(path, 'utf8')
    const joined = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(', ')
    return joined.length > 0 ? joined : undefined
  } catch {
    return undefined
  }
}

/** Compose the effective prompts: explicit arg wins, then file, then settings. */
async function resolvePrompts(config, positive, negative) {
  const filePos = await readPromptFile(resolvePromptFile(config, config.positivePromptFile))
  const fileNeg = await readPromptFile(resolvePromptFile(config, config.negativePromptFile))
  return {
    positive: typeof positive === 'string' && positive.length > 0 ? positive : filePos ?? config.positivePrompt,
    negative: typeof negative === 'string' ? negative : fileNeg ?? config.negativePrompt,
  }
}

/** Turn resolved config plus per-call overrides into one generation plan. */
function planGeneration(config, overrides, prompts) {
  const seed =
    overrides.seed === undefined || overrides.seed < 0
      ? Math.floor(Math.random() * 4_294_967_295)
      : Math.trunc(overrides.seed)
  return {
    checkpoint: overrides.checkpoint ?? config.checkpoint,
    vae: config.vae,
    positive: prompts.positive,
    negative: prompts.negative,
    width: Math.round((overrides.width ?? config.width) / 8) * 8,
    height: Math.round((overrides.height ?? config.height) / 8) * 8,
    steps: Math.trunc(overrides.steps ?? config.steps),
    cfg: overrides.cfg ?? config.cfg,
    sampler: overrides.sampler ?? config.sampler,
    scheduler: overrides.scheduler ?? config.scheduler,
    seed,
    batchSize: Math.trunc(overrides.batchSize ?? config.batchSize),
    filenamePrefix: overrides.filenamePrefix ?? config.filenamePrefix,
  }
}

/** One timestamp shared by every file of a run. */
function runStamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

/** Extension for a media type. */
function extensionOf(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  return 'png'
}

/** Write one image into the configured output directory. */
async function persistImage(config, image, index, stamp, prefix) {
  if (typeof config.outputDir !== 'string' || config.outputDir.length === 0) return undefined
  const safePrefix = (prefix || config.filenamePrefix || 'dsh').replace(/[^A-Za-z0-9_-]/g, '_')
  const target = join(config.outputDir, `${safePrefix}_${stamp}_${String(index + 1).padStart(2, '0')}.${extensionOf(image.mediaType)}`)
  await mkdir(config.outputDir, { recursive: true })
  await writeFile(target, image.data)
  return target
}

/** Copy one image into the session workspace when the user asked for that. */
async function persistToWorkspace(exec, config, image, index, stamp, prefix) {
  if (!config.saveImagesToWorkspace) return undefined
  const root = exec?.agent?.session?.header?.cwd
  if (typeof root !== 'string' || root.length === 0) return undefined
  const safePrefix = (prefix || config.filenamePrefix || 'dsh').replace(/[^A-Za-z0-9_-]/g, '_')
  const target = join(root, config.workspaceFolder, `${safePrefix}_${stamp}_${String(index + 1).padStart(2, '0')}.${extensionOf(image.mediaType)}`)
  await mkdir(join(root, config.workspaceFolder), { recursive: true })
  await writeFile(target, image.data)
  return target
}

/**
 * Ensure the server answers, optionally launching it first.
 * @param config - resolved config.
 */
async function ensureServer(config) {
  try {
    return await probeServer(config.serverUrl, 8_000)
  } catch (error) {
    if (!config.launcherEnabled || !config.autoLaunchOnGenerate) throw error
    const availability = launcherAvailability(config)
    if (!availability.available) throw error
    await launchServer(config)
    return probeServer(config.serverUrl, 8_000)
  }
}

/**
 * One generation run, shared by the tool and the preview route.
 * @param ctx - plugin context.
 * @param config - resolved config.
 * @param overrides - per-call overrides.
 * @param exec - tool execution context, when called from a tool.
 */
async function generate(ctx, config, overrides, exec) {
  const prompts = await resolvePrompts(config, overrides.positive, overrides.negative)
  const plan = planGeneration(config, overrides, prompts)
  if (typeof plan.checkpoint !== 'string' || plan.checkpoint.length === 0) {
    throw new Error(
      '还没有选择 checkpoint。打开设置 → 插件配置 → ComfyUI Studio → 模型，点「读取模型」选一个，或安装后先点一次「读取模型」。',
    )
  }
  const built = buildTxt2ImgWorkflow(plan)
  const workflow = mergeWorkflow(config.extraWorkflowJson, built, plan)

  await ensureServer(config)

  const started = Date.now()
  const result = await runWorkflow(config.serverUrl, workflow, {
    pollIntervalMs: config.pollIntervalMs,
    maxPollSeconds: config.maxPollSeconds,
    requestTimeoutMs: config.requestTimeoutMs,
    clientId: `dsh-comfyui-studio-${String(Date.now())}`,
  })
  const elapsedMs = Date.now() - started

  const stamp = runStamp()
  const saved = []
  for (const [index, image] of result.images.entries()) {
    const path = config.saveToOutputDir ? await persistImage(config, image, index, stamp, plan.filenamePrefix) : undefined
    const workspacePath = await persistToWorkspace(exec, config, image, index, stamp, plan.filenamePrefix)
    saved.push({ image, path, workspacePath })
  }
  return { plan, promptId: result.promptId, saved, elapsedMs }
}

/** Attach one image, tolerating a deployment that refuses the media type. */
async function attachImage(ctx, image) {
  try {
    return await ctx.attachments.saveImage({
      data: image.data,
      mediaType: image.mediaType,
      name: image.filename,
    })
  } catch {
    return undefined
  }
}

/** The attachment fields a render may carry. */
function attachmentMeta(ref) {
  return {
    attachmentId: String(ref.attachmentId),
    mediaType: String(ref.mediaType),
    bytes: Number(ref.bytes),
    width: Number(ref.width),
    height: Number(ref.height),
    ...typeof ref.name === 'string' ? { name: ref.name } : {},
  }
}

/** Every route handler, keyed by path suffix. */
function createRoutes(ctx, readConfig) {
  return {
    async state(_req, res) {
      const config = resolveConfig(readConfig())
      const availability = launcherAvailability(config)
      let health
      try {
        health = await probeServer(config.serverUrl, 5_000)
      } catch (error) {
        health = { reachable: false, error: error instanceof Error ? error.message : String(error) }
      }
      const descriptor = findDescriptor(ctx)
      const settings = ctx.get('settings')
      sendJson(res, 200, {
        config,
        user: descriptor?.user !== null && typeof descriptor?.user === 'object' ? descriptor.user : {},
        writable: descriptor !== undefined && typeof settings?.mutate === 'function',
        presets: HARDWARE_PRESETS,
        samplers: SAMPLERS,
        schedulers: SCHEDULERS,
        launcher: availability,
        launched: launchedServers(),
        health,
      })
    },

    async save(req, res) {
      const body = await readJsonBody(req)
      const patch = body !== null && typeof body === 'object' && typeof body.config === 'object' ? body.config : {}
      const settings = ctx.get('settings')
      const descriptor = findDescriptor(ctx)
      if (typeof settings?.update !== 'function' || descriptor === undefined) {
        sendJson(res, 409, { ok: false, error: '当前宿主没有可写的设置服务' })
        return
      }
      try {
        resolveConfig({ ...descriptor.value, ...patch })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        return
      }
      try {
        await settings.update(descriptor.ns, patch, descriptor.revision)
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    async reset(req, res) {
      const body = await readJsonBody(req)
      const fields = Array.isArray(body?.fields) ? body.fields.filter((field) => typeof field === 'string') : []
      const settings = ctx.get('settings')
      const descriptor = findDescriptor(ctx)
      if (typeof settings?.mutate !== 'function' || descriptor === undefined) {
        sendJson(res, 409, { ok: false, error: '当前宿主没有可写的设置服务' })
        return
      }
      const ops = (fields.length > 0 ? fields : Object.keys(DEFAULT_CONFIG)).map((field) => ({ op: 'unset', path: [field] }))
      try {
        await settings.mutate(descriptor.ns, ops, descriptor.revision)
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 409, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    async probe(req, res) {
      const body = await readJsonBody(req)
      const config = resolveConfig({ ...readConfig(), ...(body?.config ?? {}) })
      try {
        sendJson(res, 200, { ok: true, health: await probeServer(config.serverUrl, 8_000) })
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    async models(req, res) {
      const body = await readJsonBody(req)
      const config = resolveConfig({ ...readConfig(), ...(body?.config ?? {}) })
      try {
        sendJson(res, 200, { ok: true, ...(await listModels(config.serverUrl, 20_000)) })
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    async launch(req, res) {
      const body = await readJsonBody(req)
      const config = resolveConfig({ ...readConfig(), ...(body?.config ?? {}) })
      try {
        sendJson(res, 200, { ok: true, ...(await launchServer(config)) })
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    async stop(_req, res) {
      const config = resolveConfig(readConfig())
      sendJson(res, 200, { ok: true, stopped: stopLaunched(config.serverUrl) })
    },

    async interrupt(_req, res) {
      const config = resolveConfig(readConfig())
      try {
        await interrupt(config.serverUrl)
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    async presets(_req, res) {
      sendJson(res, 200, { presets: HARDWARE_PRESETS })
    },

    async file(req, res) {
      const config = resolveConfig(readConfig())
      const pathname = new URL(req.url ?? '/', 'http://x').searchParams.get('path')
      if (typeof pathname !== 'string' || pathname.length === 0) {
        sendJson(res, 400, { ok: false, error: '缺少 path 参数' })
        return
      }
      const normalized = pathname.replace(/\\/g, '/')
      const roots = [config.outputDir]
      if (config.saveImagesToWorkspace) roots.push(config.workspaceFolder)
      const allowed = roots.some(
        (root) =>
          typeof root === 'string' &&
          root.length > 0 &&
          normalized.toLowerCase().startsWith(root.replace(/\\/g, '/').toLowerCase()),
      )
      if (!allowed) {
        sendJson(res, 403, { ok: false, error: '只允许读取出图目录内的文件' })
        return
      }
      try {
        const data = await readFile(normalized)
        const mediaType = /\.jpe?g$/i.test(normalized) ? 'image/jpeg' : /\.webp$/i.test(normalized) ? 'image/webp' : 'image/png'
        res.writeHead(200, {
          'content-type': mediaType,
          'content-length': String(data.length),
          'cache-control': 'no-store',
        })
        res.end(data)
      } catch (error) {
        sendJson(res, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },

    async preview(req, res) {
      const body = await readJsonBody(req, 200_000)
      const config = resolveConfig({ ...readConfig(), ...(body?.config ?? {}) })
      const overrides = body?.overrides !== null && typeof body?.overrides === 'object' ? body.overrides : {}
      try {
        const result = await generate(ctx, config, overrides)
        const first = result.saved[0]
        sendJson(res, 200, {
          ok: true,
          promptId: result.promptId,
          elapsedMs: result.elapsedMs,
          seed: result.plan.seed,
          path: first?.path ?? first?.workspacePath,
          width: result.plan.width,
          height: result.plan.height,
          steps: result.plan.steps,
        })
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          code: error instanceof ComfyError ? error.code : 'UNKNOWN',
        })
      }
    },
  }
}

/** Mount the route table once per live webserver. */
function registerRoutes(ctx, readConfig) {
  ctx.inject(['webServer'], (routeCtx) => {
    const webserver = routeCtx.get('webServer')
    if (typeof webserver?.register !== 'function') return
    const existing = mounts.get(ctx)
    if (existing !== undefined && existing.webserver === webserver) return
    if (existing !== undefined) {
      try {
        existing.dispose()
      } catch {
        // Already torn down with the old service.
      }
      mounts.delete(ctx)
    }
    const routes = createRoutes(ctx, readConfig)
    routeCtx.effect(() => {
      const dispose = webserver.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const pathname = new URL(req.url ?? '/', 'http://x').pathname
          const key = pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
          const handler = routes[key]
          if (handler === undefined) {
            sendJson(res, 404, { ok: false, error: `未知接口 ${pathname}` })
            return
          }
          try {
            await handler(req, res)
          } catch (error) {
            if (!res.headersSent) {
              sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
            } else {
              res.end()
            }
          }
        },
      })
      const disposed = typeof dispose === 'function' ? dispose : () => {}
      mounts.set(ctx, { webserver, dispose: disposed })
      return () => {
        if (mounts.get(ctx)?.dispose === disposed) mounts.delete(ctx)
        try {
          disposed()
        } catch {
          // Already torn down.
        }
      }
    }, 'comfyui-studio: routes')
  })
}

/** The attachment schema fragment shared by both tools' output. */
const ATTACHMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
  },
}

/**
 * Register both tools.
 * @param ctx - plugin context.
 * @param readConfig - per-request settings reader.
 */
function registerTools(ctx, readConfig) {
  ctx.tools.register(
    defineTool({
      name: 'comfyui_generate',
      description:
        'Generate an image with the local (or remote) ComfyUI instance configured in the comfyui-studio plugin. Use it for any image request the user wants rendered on their own GPU: fine-art photography, character art, product shots, concept art, illustration. Every parameter falls back to the plugin settings, so a bare prompt is a complete call.',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: '正向提示词（英文效果最好）：主体、姿态、光线、镜头、质感。',
        },
        negative: { type: 'string', description: '负向提示词；省略时用插件设置里的默认值' },
        width: { type: 'integer', description: '宽（像素，会取 8 的倍数）。省略用设置默认值' },
        height: { type: 'integer', description: '高（像素，会取 8 的倍数）。省略用设置默认值' },
        steps: { type: 'integer', description: '采样步数。省略用设置默认值' },
        cfg: { type: 'number', description: 'CFG 强度。省略用设置默认值' },
        sampler: { type: 'string', description: '采样器名称，如 dpmpp_2m。省略用设置默认值' },
        scheduler: { type: 'string', description: '调度器名称，如 karras。省略用设置默认值' },
        seed: { type: 'integer', description: '随机种子；-1 或省略表示随机' },
        batch: { type: 'integer', description: '一次生成几张（1-8）。省略用设置默认值' },
        checkpoint: { type: 'string', description: 'checkpoint 文件名。省略用设置默认值' },
        filenamePrefix: { type: 'string', description: '文件名前缀。省略用设置默认值' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            promptId: { type: 'string', required: true },
            seed: { type: 'integer', required: true },
            width: { type: 'integer', required: true },
            height: { type: 'integer', required: true },
            steps: { type: 'integer', required: true },
            elapsedMs: { type: 'integer', required: true },
            files: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true },
                  filename: { type: 'string', required: true },
                },
              },
            },
            attachments: { type: 'array', items: ATTACHMENT_SCHEMA },
          },
        },
        render: (_args, value) => {
          const lines = [
            `已生成 ${String(value.files.length)} 张图（${String(value.width)}×${String(value.height)}，${String(value.steps)} 步，seed ${String(value.seed)}，用时 ${String(Math.round(value.elapsedMs / 1000))} 秒）`,
            ...value.files.map((file) => `- ${file.path}`),
          ]
          return [
            { type: 'text', text: lines.join('\n') },
            ...(value.attachments ?? []).map((attachment) => ({ type: 'image', attachment })),
          ]
        },
      },
      async execute(args, exec) {
        const config = resolveConfig(readConfig())
        const result = await generate(
          ctx,
          config,
          {
            positive: args.prompt,
            negative: args.negative,
            width: args.width,
            height: args.height,
            steps: args.steps,
            cfg: args.cfg,
            sampler: args.sampler,
            scheduler: args.scheduler,
            seed: args.seed,
            batchSize: args.batch,
            checkpoint: args.checkpoint,
            filenamePrefix: args.filenamePrefix,
          },
          exec,
        )
        const attachments = []
        if (config.attachToConversation) {
          for (const entry of result.saved) {
            const attachment = await attachImage(ctx, entry.image)
            if (attachment !== undefined) attachments.push(attachmentMeta(attachment))
          }
        }
        return {
          promptId: result.promptId,
          seed: result.plan.seed,
          width: result.plan.width,
          height: result.plan.height,
          steps: result.plan.steps,
          elapsedMs: result.elapsedMs,
          files: result.saved.map((entry) => ({
            path: entry.path ?? entry.workspacePath ?? entry.image.filename,
            filename: entry.image.filename,
          })),
          attachments,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'comfyui_studio',
      description:
        'Inspect and control the ComfyUI instance the comfyui-studio plugin talks to: check reachability, list installed checkpoints, start the local server, stop a server this plugin started, or interrupt the running job. Use it when a generation fails with a connection error, or when the user asks whether ComfyUI is up or which models are installed.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['status', 'models', 'launch', 'stop', 'interrupt'],
          description:
            'status=检查连通性；models=列出模型；launch=启动本机服务；stop=停止本插件启动的进程；interrupt=中断当前任务',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            detail: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.detail }],
      },
      async execute(args) {
        const config = resolveConfig(readConfig())
        try {
          if (args.action === 'status') {
            const health = await probeServer(config.serverUrl, 8_000)
            const devices = health.devices
              .map(
                (device) =>
                  `${device.name}（显存 ${String(Math.round((device.vramTotal ?? 0) / 1024 / 1024))}MB，空闲 ${String(Math.round((device.vramFree ?? 0) / 1024 / 1024))}MB）`,
              )
              .join('；')
            return {
              ok: true,
              detail: [
                `服务地址：${config.serverUrl}`,
                `ComfyUI ${health.comfyuiVersion ?? '?'}，Python ${health.pythonVersion ?? '?'}`,
                devices.length > 0 ? `设备：${devices}` : '设备：未报告',
                `默认模型：${config.checkpoint}`,
                `出图目录：${config.outputDir}`,
              ].join('\n'),
            }
          }
          if (args.action === 'models') {
            const models = await listModels(config.serverUrl, 20_000)
            return {
              ok: true,
              detail: [
                `checkpoints（${String(models.checkpoints.length)}）：`,
                ...models.checkpoints.map((entry) => `- ${entry}`),
                `VAE（${String(models.vaes.length)}）：`,
                ...models.vaes.map((entry) => `- ${entry}`),
              ].join('\n'),
            }
          }
          if (args.action === 'launch') {
            const result = await launchServer(config)
            return {
              ok: true,
              detail: `已启动（pid ${String(result.pid ?? '?')}，等待 ${String(Math.round((result.waitedMs ?? 0) / 1000))} 秒）`,
            }
          }
          if (args.action === 'stop') {
            const stopped = stopLaunched(config.serverUrl)
            return { ok: true, detail: stopped ? '已停止本插件启动的进程' : '没有本插件启动的进程在运行' }
          }
          await interrupt(config.serverUrl)
          return { ok: true, detail: '已发送中断请求' }
        } catch (error) {
          return { ok: false, detail: error instanceof Error ? error.message : String(error) }
        }
      },
    }),
  )
}

/**
 * Mount the plugin.
 * @param ctx - registrant context.
 * @param config - composition config (schema defaults already applied).
 */
export function apply(ctx, config = { ...DEFAULT_CONFIG }) {
  const readConfig = installSettingsSource(ctx, () => config)
  registerRoutes(ctx, readConfig)
  registerTools(ctx, readConfig)
}
