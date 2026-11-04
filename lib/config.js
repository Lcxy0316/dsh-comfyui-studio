/**
 * Configuration schema and normalisation for dsh-comfyui-studio.
 *
 * Every field is user-editable from the plugin page, and every field has a
 * working default, so a fresh install on another machine only has to change
 * the handful of machine-specific values (server URL, checkpoint, output
 * directory, launcher paths). Nothing here may throw at import time: the
 * settings page renders from this schema, so a broken schema breaks the page.
 * @module dsh-comfyui-studio/config
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace / profile row id base. */
export const NAMESPACE = 'comfyui-studio'

/** Profile entry ids this plugin may be served under, in probe order. */
export const ROW_IDS = ['comfyui-studio', 'dsh-comfyui-studio', 'web-ui-comfyui-studio']

/** Sampler names accepted by ComfyUI's KSampler node. */
export const SAMPLERS = [
  'euler',
  'euler_ancestral',
  'heun',
  'heunpp2',
  'dpm_2',
  'dpm_2_ancestral',
  'lms',
  'dpm_fast',
  'dpm_adaptive',
  'dpmpp_2s_ancestral',
  'dpmpp_sde',
  'dpmpp_sde_gpu',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_2m_sde_gpu',
  'dpmpp_3m_sde',
  'dpmpp_3m_sde_gpu',
  'ddpm',
  'lcm',
  'ddim',
  'uni_pc',
  'uni_pc_bh2',
]

/** Scheduler names accepted by ComfyUI's KSampler node. */
export const SCHEDULERS = [
  'normal',
  'karras',
  'exponential',
  'sgm_uniform',
  'simple',
  'ddim_uniform',
  'beta',
  'linear_quadratic',
  'kl_optimal',
]

/** Bundled starting points for the "hardware preset" picker. */
export const HARDWARE_PRESETS = {
  'low-vram-4g': {
    label: '低显存 4G（3050 Laptop 等）',
    width: 832,
    height: 1216,
    steps: 28,
    cfg: 5.5,
    batchSize: 1,
    launchArgs: '--listen 127.0.0.1 --port 8188 --lowvram --reserve-vram 0.4 --disable-auto-launch',
  },
  'mid-vram-8g': {
    label: '中端 8G（3060Ti / 4060 等）',
    width: 896,
    height: 1216,
    steps: 30,
    cfg: 6,
    batchSize: 1,
    launchArgs: '--listen 127.0.0.1 --port 8188 --normalvram --disable-auto-launch',
  },
  'high-vram-16g': {
    label: '高端 16G（4080 / 4070Ti Super 等）',
    width: 1024,
    height: 1408,
    steps: 32,
    cfg: 6,
    batchSize: 2,
    launchArgs: '--listen 127.0.0.1 --port 8188 --highvram --disable-auto-launch',
  },
  'remote-server': {
    label: '远程/局域网服务器',
    width: 1024,
    height: 1408,
    steps: 30,
    cfg: 6,
    batchSize: 2,
    launchArgs: '',
  },
}

/** Built-in positive prompt: the fine-art figure study this plugin was built around. */
export const DEFAULT_POSITIVE = [
  'raw photo, fine art figure photography, editorial art magazine',
  'slim elegant east asian woman, mid 20s, long black hair falling over one shoulder',
  'seated sideways on a linen-draped wooden chair, one arm along the chair back',
  'other elbow drawn in, spine slightly arched, chin slightly lowered',
  'calm confident direct gaze into lens',
  'visible skin pores, subsurface scattering, natural skin texture',
  'soft window light from left, rembrandt falloff on collarbone and ribs',
  'dark charcoal seamless backdrop, subtle vignette',
  'hasselblad medium format, 80mm lens, f/2.8, ISO100, fine film grain',
  'desaturated warm color grade, shallow depth of field, catchlight in eyes',
  'photographic realism, 8k, highly detailed skin',
].join(', ')

/** Built-in negative prompt. */
export const DEFAULT_NEGATIVE = [
  'cartoon, anime, 3d render, cgi, illustration, airbrushed, plastic skin',
  'smooth skin, oversaturated, deformed anatomy, extra limbs, bad hands',
  'blurry, watermark, text, logo, jpeg artifacts, lowres, ugly, mutated',
].join(', ')

/** Defaults for every field, in the shape the tools and routes read. */
export const DEFAULT_CONFIG = {
  // ---- connection ----
  serverUrl: 'http://127.0.0.1:8188',
  requestTimeoutMs: 600_000,
  pollIntervalMs: 1_000,
  maxPollSeconds: 900,

  // ---- model ----
  // Deliberately empty: a shared install must not assume anyone else's model
  // filenames. Pick one with the "读取模型" button after installing.
  checkpoint: '',
  vae: '',

  // ---- generation defaults ----
  width: 832,
  height: 1216,
  steps: 28,
  cfg: 5.5,
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
  batchSize: 1,
  seed: -1,

  // ---- prompts ----
  positivePrompt: DEFAULT_POSITIVE,
  negativePrompt: DEFAULT_NEGATIVE,
  positivePromptFile: '',
  negativePromptFile: '',

  // ---- output ----
  outputDir: '',
  saveToOutputDir: true,
  filenamePrefix: 'dsh',
  attachToConversation: true,

  // ---- launcher ----
  launcherEnabled: true,
  comfyuiDir: '',
  pythonPath: '',
  launchArgs: '--listen 127.0.0.1 --port 8188 --lowvram --reserve-vram 0.4 --disable-auto-launch',
  autoLaunchOnGenerate: false,
  launchWaitSeconds: 120,

  // ---- advanced ----
  preset: 'low-vram-4g',
  extraWorkflowJson: '',
  saveImagesToWorkspace: false,
  workspaceFolder: 'comfyui-studio',
}

/**
 * The settings schema. Rendered by the plugin page, validated on write, and
 * read per request by every tool and route.
 */
export const Config = z.object({
  serverUrl: z
    .string()
    .default(DEFAULT_CONFIG.serverUrl)
    .description('ComfyUI 服务地址（本机默认 http://127.0.0.1:8188；远程服务器填 http://IP:端口）')
    .volatile(),
  requestTimeoutMs: z
    .number()
    .min(5_000)
    .max(3_600_000)
    .step(1_000)
    .default(DEFAULT_CONFIG.requestTimeoutMs)
    .description('单次生成请求的总超时（毫秒）')
    .volatile(),
  pollIntervalMs: z
    .number()
    .min(200)
    .max(10_000)
    .step(100)
    .default(DEFAULT_CONFIG.pollIntervalMs)
    .description('轮询 ComfyUI 队列的间隔（毫秒）')
    .volatile(),
  maxPollSeconds: z
    .number()
    .min(30)
    .max(7_200)
    .step(10)
    .default(DEFAULT_CONFIG.maxPollSeconds)
    .description('等待出图的最长秒数，超时即放弃')
    .volatile(),

  checkpoint: z
    .string()
    .default(DEFAULT_CONFIG.checkpoint)
    .description('默认 checkpoint 文件名（必须出现在 ComfyUI 的 models/checkpoints 下）')
    .volatile(),
  vae: z.string().default('').description('单独指定 VAE 文件名；留空用 checkpoint 自带的').volatile(),

  width: z.number().min(256).max(4096).step(8).default(DEFAULT_CONFIG.width).description('默认宽度').volatile(),
  height: z.number().min(256).max(4096).step(8).default(DEFAULT_CONFIG.height).description('默认高度').volatile(),
  steps: z.number().min(1).max(150).step(1).default(DEFAULT_CONFIG.steps).description('默认采样步数').volatile(),
  cfg: z.number().min(1).max(30).step(0.1).default(DEFAULT_CONFIG.cfg).description('默认 CFG').volatile(),
  sampler: z
    .string()
    .default(DEFAULT_CONFIG.sampler)
    .description(`默认采样器，可选：${SAMPLERS.join(', ')}`)
    .volatile(),
  scheduler: z
    .string()
    .default(DEFAULT_CONFIG.scheduler)
    .description(`默认调度器，可选：${SCHEDULERS.join(', ')}`)
    .volatile(),
  batchSize: z.number().min(1).max(8).step(1).default(DEFAULT_CONFIG.batchSize).description('每次生成张数（4G 显存建议 1）').volatile(),
  seed: z.number().min(-1).max(4_294_967_295).step(1).default(DEFAULT_CONFIG.seed).description('默认种子；-1 表示随机').volatile(),

  positivePrompt: z.string().default(DEFAULT_CONFIG.positivePrompt).description('默认正向提示词').volatile(),
  negativePrompt: z.string().default(DEFAULT_CONFIG.negativePrompt).description('默认负向提示词').volatile(),
  positivePromptFile: z
    .string()
    .default('')
    .description('正向提示词文件路径；填了就覆盖上面的默认正向提示词')
    .volatile(),
  negativePromptFile: z
    .string()
    .default('')
    .description('负向提示词文件路径；填了就覆盖上面的默认负向提示词')
    .volatile(),

  outputDir: z.string().default(DEFAULT_CONFIG.outputDir).description('出图落盘目录').volatile(),
  saveToOutputDir: z.boolean().default(DEFAULT_CONFIG.saveToOutputDir).description('是否把图片写到出图目录').volatile(),
  filenamePrefix: z.string().default(DEFAULT_CONFIG.filenamePrefix).description('文件名前缀').volatile(),
  attachToConversation: z
    .boolean()
    .default(DEFAULT_CONFIG.attachToConversation)
    .description('是否把图片作为附件返回对话（关掉只留文件路径）')
    .volatile(),

  launcherEnabled: z.boolean().default(DEFAULT_CONFIG.launcherEnabled).description('允许插件启动本机 ComfyUI 进程').volatile(),
  comfyuiDir: z.string().default(DEFAULT_CONFIG.comfyuiDir).description('ComfyUI 源码目录（含 main.py）').volatile(),
  pythonPath: z.string().default(DEFAULT_CONFIG.pythonPath).description('该 ComfyUI 使用的 Python 解释器').volatile(),
  launchArgs: z.string().default(DEFAULT_CONFIG.launchArgs).description('启动参数（低显存加 --lowvram --reserve-vram 0.4）').volatile(),
  autoLaunchOnGenerate: z
    .boolean()
    .default(DEFAULT_CONFIG.autoLaunchOnGenerate)
    .description('生成时如果服务没起来，是否自动拉起')
    .volatile(),
  launchWaitSeconds: z.number().min(5).max(900).step(5).default(DEFAULT_CONFIG.launchWaitSeconds).description('启动后等待服务就绪的最长秒数').volatile(),

  preset: z.string().default(DEFAULT_CONFIG.preset).description('当前硬件预设（仅作记录，改参数不自动改预设）').volatile(),
  extraWorkflowJson: z
    .string()
    .default('')
    .description('自定义 API 格式工作流 JSON；留空用内置的 txt2img 工作流')
    .volatile(),
  saveImagesToWorkspace: z.boolean().default(false).description('是否同时复制一份到当前工作区').volatile(),
  workspaceFolder: z.string().default('comfyui-studio').description('工作区内的子目录名').volatile(),
})

/** Clamp a number into range, falling back when it is not finite. */
function num(value, fallback, min, max) {
  // An empty string is what a cleared number input produces; treat it as unset
  // instead of coercing to 0 and then clamping up to `min`.
  if (typeof value === 'string' && value.trim().length === 0) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n * 1000) / 1000))
}

/** Coerce to a trimmed string. */
function str(value, fallback) {
  return typeof value === 'string' ? value.trim() : fallback
}

/** Normalise a server URL: strip trailing slashes, default the scheme. */
export function normalizeServerUrl(value) {
  const raw = str(value, DEFAULT_CONFIG.serverUrl)
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  return withScheme.replace(/\/+$/, '')
}

/**
 * Read one raw settings section into a fully-populated config. Tolerates
 * absent, partial, and hand-edited values: an unknown sampler falls back to
 * the default instead of reaching ComfyUI as a rejected name.
 * @param raw - the settings section as stored (may be undefined).
 * @returns a config with every field present and in range.
 */
export function resolveConfig(raw) {
  const value = raw !== null && typeof raw === 'object' ? raw : {}
  const presetKey = str(value.preset, DEFAULT_CONFIG.preset)
  const preset = HARDWARE_PRESETS[presetKey]
  const width = num(value.width, preset?.width ?? DEFAULT_CONFIG.width, 256, 4096)
  const height = num(value.height, preset?.height ?? DEFAULT_CONFIG.height, 256, 4096)
  return {
    serverUrl: normalizeServerUrl(value.serverUrl),
    requestTimeoutMs: num(value.requestTimeoutMs, DEFAULT_CONFIG.requestTimeoutMs, 5_000, 3_600_000),
    pollIntervalMs: num(value.pollIntervalMs, DEFAULT_CONFIG.pollIntervalMs, 200, 10_000),
    maxPollSeconds: num(value.maxPollSeconds, DEFAULT_CONFIG.maxPollSeconds, 30, 7_200),

    checkpoint: str(value.checkpoint, DEFAULT_CONFIG.checkpoint),
    vae: str(value.vae, ''),

    width: Math.round(width / 8) * 8,
    height: Math.round(height / 8) * 8,
    steps: Math.round(num(value.steps, preset?.steps ?? DEFAULT_CONFIG.steps, 1, 150)),
    cfg: num(value.cfg, preset?.cfg ?? DEFAULT_CONFIG.cfg, 1, 30),
    sampler: SAMPLERS.includes(value.sampler) ? value.sampler : DEFAULT_CONFIG.sampler,
    scheduler: SCHEDULERS.includes(value.scheduler) ? value.scheduler : DEFAULT_CONFIG.scheduler,
    batchSize: Math.round(num(value.batchSize, preset?.batchSize ?? DEFAULT_CONFIG.batchSize, 1, 8)),
    seed: Math.round(num(value.seed, DEFAULT_CONFIG.seed, -1, 4_294_967_295)),

    positivePrompt: typeof value.positivePrompt === 'string' ? value.positivePrompt : DEFAULT_CONFIG.positivePrompt,
    negativePrompt: typeof value.negativePrompt === 'string' ? value.negativePrompt : DEFAULT_CONFIG.negativePrompt,
    positivePromptFile: str(value.positivePromptFile, ''),
    negativePromptFile: str(value.negativePromptFile, ''),

    outputDir: str(value.outputDir, DEFAULT_CONFIG.outputDir).replace(/\\/g, '/').replace(/\/+$/, ''),
    saveToOutputDir: value.saveToOutputDir !== false,
    filenamePrefix: str(value.filenamePrefix, DEFAULT_CONFIG.filenamePrefix) || 'dsh',
    attachToConversation: value.attachToConversation !== false,

    launcherEnabled: value.launcherEnabled !== false,
    comfyuiDir: str(value.comfyuiDir, DEFAULT_CONFIG.comfyuiDir).replace(/\\/g, '/').replace(/\/+$/, ''),
    pythonPath: str(value.pythonPath, DEFAULT_CONFIG.pythonPath).replace(/\\/g, '/'),
    launchArgs: str(value.launchArgs, DEFAULT_CONFIG.launchArgs),
    autoLaunchOnGenerate: value.autoLaunchOnGenerate === true,
    launchWaitSeconds: num(value.launchWaitSeconds, DEFAULT_CONFIG.launchWaitSeconds, 5, 900),

    preset: presetKey,
    extraWorkflowJson: str(value.extraWorkflowJson, ''),
    saveImagesToWorkspace: value.saveImagesToWorkspace === true,
    workspaceFolder: str(value.workspaceFolder, DEFAULT_CONFIG.workspaceFolder) || 'comfyui-studio',
  }
}

/** Validate a candidate section, throwing on values the schema refuses. */
export function validateConfig(value) {
  resolveConfig(value)
}
