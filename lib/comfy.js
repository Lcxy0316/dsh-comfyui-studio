/**
 * ComfyUI HTTP client plus the local launcher.
 *
 * Everything here is plain `fetch` against the ComfyUI server: `/system_stats`
 * for reachability, `/object_info` for the checkpoint list, `/prompt` to
 * enqueue, `/history/{id}` to poll, `/view` to fetch the finished PNG. The
 * launcher spawns the user's own `main.py` with the user's own interpreter and
 * waits for `/system_stats` to answer — nothing is installed or downloaded.
 * @module dsh-comfyui-studio/comfy
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** One ComfyUI failure with a message the plugin page can show verbatim. */
export class ComfyError extends Error {
  /**
   * @param message - what went wrong, phrased for the user.
   * @param code - stable machine code the UI branches on.
   */
  constructor(message, code) {
    super(message)
    this.name = 'ComfyError'
    this.code = code
  }
}

/** Join a server base URL and an API path. */
function url(base, path) {
  return `${base}${path}`
}

/** Fetch with a timeout that reports as a ComfyError rather than a raw abort. */
async function requestJson(base, path, init, timeoutMs, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url(base, path), { ...init, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) {
      throw new ComfyError(`${label} 失败（HTTP ${String(response.status)}）：${text.slice(0, 400)}`, 'HTTP_ERROR')
    }
    if (text.length === 0) return undefined
    try {
      return JSON.parse(text)
    } catch {
      throw new ComfyError(`${label} 返回的不是 JSON：${text.slice(0, 200)}`, 'BAD_JSON')
    }
  } catch (error) {
    if (error instanceof ComfyError) throw error
    if (error?.name === 'AbortError') {
      throw new ComfyError(`${label} 超时（${String(timeoutMs)}ms）`, 'TIMEOUT')
    }
    throw new ComfyError(`${label} 连不上 ${base}：${error instanceof Error ? error.message : String(error)}`, 'UNREACHABLE')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe the server. Returns the system stats when it answers, throws a
 * ComfyError with `UNREACHABLE` when it does not.
 * @param serverUrl - normalised base URL.
 * @param timeoutMs - probe timeout.
 */
export async function probeServer(serverUrl, timeoutMs = 8_000) {
  const stats = await requestJson(serverUrl, '/system_stats', { method: 'GET' }, timeoutMs, '连接 ComfyUI')
  const system = stats?.system ?? {}
  const devices = Array.isArray(stats?.devices) ? stats.devices : []
  return {
    reachable: true,
    comfyuiVersion: typeof system.comfyui_version === 'string' ? system.comfyui_version : undefined,
    pythonVersion: typeof system.python_version === 'string' ? system.python_version : undefined,
    os: typeof system.os === 'string' ? system.os : undefined,
    ramTotal: typeof system.ram_total === 'number' ? system.ram_total : undefined,
    ramFree: typeof system.ram_free === 'number' ? system.ram_free : undefined,
    devices: devices.map((device) => ({
      name: typeof device?.name === 'string' ? device.name : 'unknown',
      type: typeof device?.type === 'string' ? device.type : undefined,
      vramTotal: typeof device?.vram_total === 'number' ? device.vram_total : undefined,
      vramFree: typeof device?.vram_free === 'number' ? device.vram_free : undefined,
    })),
  }
}

/**
 * List available checkpoints and VAE files from `/object_info`.
 * @param serverUrl - base URL.
 * @param timeoutMs - request timeout.
 */
export async function listModels(serverUrl, timeoutMs = 20_000) {
  const info = await requestJson(serverUrl, '/object_info', { method: 'GET' }, timeoutMs, '读取模型列表')
  const checkpoints = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]
  const vaes = info?.VAELoader?.input?.required?.vae_name?.[0]
  const unets = info?.UNETLoader?.input?.required?.unet_name?.[0]
  const clips = info?.CLIPLoader?.input?.required?.clip_name?.[0]
  const names = (list) => (Array.isArray(list) ? list.filter((name) => typeof name === 'string') : [])
  return {
    checkpoints: names(checkpoints),
    vaes: names(vaes),
    unets: names(unets),
    clips: names(clips),
    clipTypes: names(info?.CLIPLoader?.input?.required?.type?.[0]),
  }
}

/** The built-in txt2img graph. Node ids are stable so a custom graph can override by id. */
export function buildTxt2ImgWorkflow(options) {
  const {
    checkpoint,
    vae,
    positive,
    negative,
    width,
    height,
    steps,
    cfg,
    sampler,
    scheduler,
    seed,
    batchSize,
    filenamePrefix,
  } = options
  const workflow = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    4: {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: batchSize },
    },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: filenamePrefix } },
  }
  if (typeof vae === 'string' && vae.length > 0) {
    workflow[8] = { class_type: 'VAELoader', inputs: { vae_name: vae } }
    workflow[6].inputs.vae = ['8', 0]
  }
  return workflow
}

/**
 * The built-in Wan2.1 text-to-video graph.
 *
 * Wan is not a checkpoint: it loads as a bare UNET plus a separate umt5 text
 * encoder and its own VAE, and the sampler needs the SD3 shift applied. Node
 * 12/13 are not part of the render — they cut the first frame out of the
 * decoded batch and save it as a PNG, because the chat transcript cannot play
 * a video and a still frame is what the user can actually look at.
 * @param options - resolved video options.
 */
export function buildVideoWorkflow(options) {
  const {
    unet,
    clip,
    clipType,
    vae,
    positive,
    negative,
    width,
    height,
    frames,
    fps,
    steps,
    cfg,
    sampler,
    scheduler,
    shift,
    seed,
    filenamePrefix,
  } = options
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: clipType, device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    4: { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['2', 0] } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['2', 0] } },
    7: {
      class_type: 'EmptyHunyuanLatentVideo',
      inputs: { width, height, length: frames, batch_size: 1 },
    },
    8: {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0],
        seed,
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1,
      },
    },
    9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    10: { class_type: 'CreateVideo', inputs: { images: ['9', 0], fps } },
    11: {
      class_type: 'SaveVideo',
      inputs: { video: ['10', 0], filename_prefix: filenamePrefix, format: 'mp4', codec: 'h264' },
    },
    12: {
      class_type: 'ImageFromBatch',
      inputs: { image: ['9', 0], batch_index: 0, length: 1 },
    },
    13: {
      class_type: 'SaveImage',
      inputs: { images: ['12', 0], filename_prefix: `${filenamePrefix}_frame` },
    },
  }
}

/**
 * Merge a user-supplied API-format workflow over the built-in one.
 *
 * The custom graph is parsed, then the plugin's own knobs are injected into
 * the well-known nodes when those nodes are present under their default ids;
 * a graph that renumbered them keeps its own wiring and only the prompt text
 * is rewritten where a positive/negative CLIPTextEncode can be identified.
 * @param customJson - the raw JSON string from settings ('' means none).
 * @param fallback - the built-in graph.
 * @param options - the resolved generation options.
 * @returns the workflow to enqueue.
 */
export function mergeWorkflow(customJson, fallback, options) {
  if (typeof customJson !== 'string' || customJson.trim().length === 0) return fallback
  let parsed
  try {
    parsed = JSON.parse(customJson)
  } catch (error) {
    throw new ComfyError(
      `自定义工作流不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
      'BAD_WORKFLOW',
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ComfyError('自定义工作流必须是「节点 id → 节点」的对象', 'BAD_WORKFLOW')
  }
  const merged = { ...parsed }
  const patch = (id, inputs) => {
    const node = merged[id]
    if (node === null || typeof node !== 'object' || typeof node.inputs !== 'object' || node.inputs === null) return
    Object.assign(node.inputs, inputs)
  }
  patch('1', { ckpt_name: options.checkpoint })
  patch('2', { text: options.positive })
  patch('3', { text: options.negative })
  patch('4', { width: options.width, height: options.height, batch_size: options.batchSize })
  patch('5', {
    seed: options.seed,
    steps: options.steps,
    cfg: options.cfg,
    sampler_name: options.sampler,
    scheduler: options.scheduler,
  })
  patch('7', { filename_prefix: options.filenamePrefix })
  return merged
}

/**
 * Enqueue one workflow and wait for its images.
 * @param serverUrl - base URL.
 * @param workflow - API-format graph.
 * @param options - polling and timeout knobs.
 * @returns the produced images with their bytes.
 */
export async function runWorkflow(serverUrl, workflow, options) {
  const { pollIntervalMs, maxPollSeconds, requestTimeoutMs, clientId } = options
  const queued = await requestJson(
    serverUrl,
    '/prompt',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    },
    Math.min(requestTimeoutMs, 60_000),
    '提交任务',
  )
  const promptId = queued?.prompt_id
  if (typeof promptId !== 'string' || promptId.length === 0) {
    throw new ComfyError(`提交任务没有拿到 prompt_id：${JSON.stringify(queued).slice(0, 300)}`, 'NO_PROMPT_ID')
  }

  const deadline = Date.now() + maxPollSeconds * 1_000
  for (;;) {
    if (Date.now() > deadline) {
      throw new ComfyError(`等待出图超过 ${String(maxPollSeconds)} 秒，已放弃（任务 ${promptId}）`, 'POLL_TIMEOUT')
    }
    const history = await requestJson(
      serverUrl,
      `/history/${encodeURIComponent(promptId)}`,
      { method: 'GET' },
      Math.min(requestTimeoutMs, 30_000),
      '查询任务状态',
    )
    const entry = history?.[promptId]
    if (entry !== undefined) {
      const status = entry?.status
      if (typeof status?.status_str === 'string' && status.status_str === 'error') {
        const detail = JSON.stringify(status.messages ?? []).slice(0, 500)
        throw new ComfyError(`ComfyUI 执行失败：${detail}`, 'EXECUTION_ERROR')
      }
      const outputs = entry?.outputs ?? {}
      const files = []
      for (const nodeOutput of Object.values(outputs)) {
        const images = nodeOutput?.images
        if (!Array.isArray(images)) continue
        for (const image of images) {
          if (typeof image?.filename !== 'string') continue
          files.push({
            filename: image.filename,
            subfolder: typeof image.subfolder === 'string' ? image.subfolder : '',
            type: typeof image.type === 'string' ? image.type : 'output',
          })
        }
      }
      if (files.length > 0) {
        const images = []
        for (const file of files) {
          const query = new URLSearchParams({
            filename: file.filename,
            subfolder: file.subfolder,
            type: file.type,
          })
          const response = await fetch(url(serverUrl, `/view?${query.toString()}`))
          if (!response.ok) {
            throw new ComfyError(`取图失败（HTTP ${String(response.status)}）：${file.filename}`, 'VIEW_FAILED')
          }
          const buffer = Buffer.from(await response.arrayBuffer())
          images.push({
            filename: file.filename,
            subfolder: file.subfolder,
            mediaType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png',
            data: buffer,
          })
        }
        return { promptId, images }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}

/** Ask ComfyUI to stop the running job. */
export async function interrupt(serverUrl, timeoutMs = 10_000) {
  await requestJson(serverUrl, '/interrupt', { method: 'POST', body: '' }, timeoutMs, '中断任务')
}

/** One live launcher process per server URL, kept module-wide. */
const launchers = new Map()

/**
 * Whether the configured launcher can actually run: the source directory and
 * the interpreter both exist on disk.
 * @param config - resolved config.
 */
export function launcherAvailability(config) {
  const mainPy = join(config.comfyuiDir, 'main.py')
  const hasMain = existsSync(mainPy)
  const hasPython = existsSync(config.pythonPath)
  return {
    available: config.launcherEnabled && hasMain && hasPython,
    mainPy,
    hasMain,
    hasPython,
    pid: launchers.get(config.serverUrl)?.pid,
  }
}

/**
 * Start ComfyUI in the background and wait until it answers.
 *
 * The child inherits stdio into a bounded in-memory tail so a failed start can
 * be explained instead of just timing out. Nothing is written to disk.
 * @param config - resolved config.
 * @param options - progress callback.
 */
export async function launchServer(config, options = {}) {
  const availability = launcherAvailability(config)
  if (!availability.hasMain) {
    throw new ComfyError(`找不到 ComfyUI 的 main.py：${availability.mainPy}`, 'NO_MAIN')
  }
  if (!availability.hasPython) {
    throw new ComfyError(`找不到 Python 解释器：${config.pythonPath}`, 'NO_PYTHON')
  }
  const existing = launchers.get(config.serverUrl)
  if (existing !== undefined && existing.exitCode === null) {
    return { started: false, pid: existing.pid, reason: '已经在运行' }
  }

  const args = ['main.py', ...config.launchArgs.split(/\s+/).filter((part) => part.length > 0)]
  const child = spawn(config.pythonPath, args, {
    cwd: config.comfyuiDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  })
  const tail = []
  const collect = (chunk) => {
    tail.push(chunk.toString('utf8'))
    if (tail.length > 200) tail.splice(0, tail.length - 200)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  child.on('exit', () => {
    launchers.delete(config.serverUrl)
  })
  launchers.set(config.serverUrl, child)

  const deadline = Date.now() + config.launchWaitSeconds * 1_000
  for (;;) {
    if (child.exitCode !== null) {
      throw new ComfyError(
        `ComfyUI 启动即退出（code ${String(child.exitCode)}）：\n${tail.join('').slice(-1200)}`,
        'LAUNCH_EXIT',
      )
    }
    try {
      await probeServer(config.serverUrl, 2_000)
      return { started: true, pid: child.pid, waitedMs: Date.now() - (deadline - config.launchWaitSeconds * 1_000) }
    } catch {
      if (Date.now() > deadline) {
        throw new ComfyError(
          `等待 ComfyUI 就绪超过 ${String(config.launchWaitSeconds)} 秒：\n${tail.join('').slice(-1200)}`,
          'LAUNCH_TIMEOUT',
        )
      }
      options.onProgress?.(`等待 ComfyUI 启动… ${String(Math.round((Date.now() - (deadline - config.launchWaitSeconds * 1_000)) / 1000))}s`)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
}

/** Stop a launcher this module started, if any. */
export function stopLaunched(serverUrl) {
  const child = launchers.get(serverUrl)
  if (child === undefined) return false
  launchers.delete(serverUrl)
  try {
    child.kill()
  } catch {
    return false
  }
  return true
}

/** Every launcher this module currently owns. */
export function launchedServers() {
  return [...launchers.entries()].map(([serverUrl, child]) => ({ serverUrl, pid: child.pid, running: child.exitCode === null }))
}
