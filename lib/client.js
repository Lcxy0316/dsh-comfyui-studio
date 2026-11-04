/**
 * Browser half of dsh-comfyui-studio.
 *
 * One self-contained page, registered into both the Plugins page
 * (`plugins.bundle.config`) and the settings page (`settings.plugin.item`),
 * plus a compact status pill in the composer row.
 *
 * The page talks to the host half through `/comfyui-studio/*`: it reads the
 * resolved config with the live health snapshot, stages edits locally, writes
 * them back in one patch, and can probe the server, list models, launch or stop
 * the local ComfyUI, interrupt a job, and render a test image — all without
 * leaving the app.
 *
 * Hand-written bundle: no build step. Only `react` is required from the shell.
 */
window.__ModuleLoader__.load({
  id: 'dsh-comfyui-studio',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'comfyui-studio'
    /** Settings namespace / profile row id. */
    const SETTINGS_NS = 'comfyui-studio'
    /** Package name, used as the `plugins.bundle.config` slot key. */
    const PACKAGE_NAME = 'dsh-comfyui-studio'
    /** Route prefix served by the host half. */
    const API = '/comfyui-studio'

    // ---------------------------------------------------------------- copy --

    const zh = {
      title: 'ComfyUI Studio',
      subtitle: '在本机显卡（或远程 ComfyUI）上出图，所有参数都能在这里改',
      statusOk: '已连接',
      statusDown: '未连接',
      statusUnknown: '检测中…',
      refresh: '刷新',
      probe: '探测服务',
      models: '读取模型',
      save: '保存设置',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '保存失败',
      resetAll: '全部恢复默认',
      resetField: '恢复默认',
      overridden: '已覆盖',
      testRun: '试跑一张',
      testing: '生成中…',
      launch: '启动服务',
      stop: '停止服务',
      interrupt: '中断任务',
      log: '调试输出',
      clearLog: '清空',
      noLog: '还没有输出。点上面的按钮试试。',
      groupConn: '连接',
      groupModel: '模型',
      groupGen: '生成参数',
      groupPrompt: '提示词',
      groupOut: '输出',
      groupLaunch: '启动器',
      groupAdv: '高级 / 工作流',
      groupDebug: '调试与自检',
      preset: '硬件预设',
      presetApply: '套用预设',
      presetHint: '套用只改当前页面上的值，点「保存设置」才会写回。',
      preview: '测试图',
      previewNone: '试跑后会在这里显示图片。',
      copyShare: '复制配置 JSON',
      copied: '已复制',
      readOnly: '当前部署的设置是只读的。',
      unavailable: '宿主没有提供设置服务，页面只能查看。',
      healthTitle: '服务信息',
      vram: '显存',
      free: '空闲',
      none: '（无）',
      lang: 'zh',
    }

    const en = {
      title: 'ComfyUI Studio',
      subtitle: 'Render on your own GPU (or a remote ComfyUI). Every knob is editable here.',
      statusOk: 'connected',
      statusDown: 'unreachable',
      statusUnknown: 'checking…',
      refresh: 'Refresh',
      probe: 'Probe',
      models: 'Load models',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Save failed',
      resetAll: 'Reset everything',
      resetField: 'Reset',
      overridden: 'overridden',
      testRun: 'Test render',
      testing: 'Rendering…',
      launch: 'Start server',
      stop: 'Stop server',
      interrupt: 'Interrupt',
      log: 'Debug output',
      clearLog: 'Clear',
      noLog: 'Nothing yet — press a button above.',
      groupConn: 'Connection',
      groupModel: 'Model',
      groupGen: 'Generation',
      groupPrompt: 'Prompts',
      groupOut: 'Output',
      groupLaunch: 'Launcher',
      groupAdv: 'Advanced / workflow',
      groupDebug: 'Debug & self-check',
      preset: 'Hardware preset',
      presetApply: 'Apply preset',
      presetHint: 'Applying only changes the staged values; press Save to persist.',
      preview: 'Test image',
      previewNone: 'A test render will appear here.',
      copyShare: 'Copy config JSON',
      copied: 'Copied',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'The host serves no settings service; the page is view-only.',
      healthTitle: 'Server',
      vram: 'VRAM',
      free: 'free',
      none: '(none)',
      lang: 'en',
    }

    // --------------------------------------------------------------- fields --

    /**
     * Field catalogue. `kind` drives the control, `group` the section, and
     * `cast` converts the staged string back to the stored JSON type.
     */
    const FIELDS = [
      // connection
      {
        key: 'serverUrl',
        group: 'conn',
        kind: 'text',
        label: { zh: '服务地址', en: 'Server URL' },
        hint: {
          zh: '本机默认 http://127.0.0.1:8188；远程填 http://IP:端口',
          en: 'http://127.0.0.1:8188 locally, or http://IP:PORT for a remote box',
        },
      },
      {
        key: 'requestTimeoutMs',
        group: 'conn',
        kind: 'number',
        label: { zh: '请求超时（毫秒）', en: 'Request timeout (ms)' },
        hint: { zh: '单次生成的总超时', en: 'Total budget for one generation' },
      },
      {
        key: 'pollIntervalMs',
        group: 'conn',
        kind: 'number',
        label: { zh: '轮询间隔（毫秒）', en: 'Poll interval (ms)' },
        hint: { zh: '多久问一次进度', en: 'How often to ask for progress' },
      },
      {
        key: 'maxPollSeconds',
        group: 'conn',
        kind: 'number',
        label: { zh: '最长等待（秒）', en: 'Max wait (s)' },
        hint: { zh: '超过就放弃', en: 'Give up after this long' },
      },

      // model
      {
        key: 'checkpoint',
        group: 'model',
        kind: 'select',
        optionsFrom: 'checkpoints',
        label: { zh: 'Checkpoint', en: 'Checkpoint' },
        hint: { zh: '点「读取模型」从服务器拉列表', en: 'Press "Load models" to list from the server' },
      },
      {
        key: 'vae',
        group: 'model',
        kind: 'select',
        optionsFrom: 'vaes',
        label: { zh: 'VAE（可选）', en: 'VAE (optional)' },
        hint: { zh: '留空用 checkpoint 自带的', en: 'Empty means the checkpoint default' },
      },

      // generation
      {
        key: 'preset',
        group: 'gen',
        kind: 'select',
        optionsFrom: 'presets',
        label: { zh: '硬件预设', en: 'Hardware preset' },
        hint: { zh: '只是记录；用「套用预设」改参数', en: 'Recorded only; use Apply preset to change values' },
      },
      { key: 'width', group: 'gen', kind: 'number', label: { zh: '宽', en: 'Width' }, hint: { zh: '8 的倍数', en: 'Multiple of 8' } },
      { key: 'height', group: 'gen', kind: 'number', label: { zh: '高', en: 'Height' }, hint: { zh: '8 的倍数', en: 'Multiple of 8' } },
      { key: 'steps', group: 'gen', kind: 'number', label: { zh: '步数', en: 'Steps' }, hint: { zh: '4G 显存 24–30 够用', en: '24–30 is plenty on 4 GB' } },
      { key: 'cfg', group: 'gen', kind: 'number', label: { zh: 'CFG', en: 'CFG' }, hint: { zh: 'SDXL 写实建议 4.5–7', en: '4.5–7 for photoreal SDXL' } },
      {
        key: 'sampler',
        group: 'gen',
        kind: 'select',
        optionsFrom: 'samplers',
        label: { zh: '采样器', en: 'Sampler' },
        hint: { zh: 'dpmpp_2m 最稳', en: 'dpmpp_2m is the safe pick' },
      },
      {
        key: 'scheduler',
        group: 'gen',
        kind: 'select',
        optionsFrom: 'schedulers',
        label: { zh: '调度器', en: 'Scheduler' },
        hint: { zh: 'karras 通用', en: 'karras is the general choice' },
      },
      {
        key: 'batchSize',
        group: 'gen',
        kind: 'number',
        label: { zh: '每次张数', en: 'Batch size' },
        hint: { zh: '4G 显存建议 1', en: 'Keep it at 1 on 4 GB' },
      },
      {
        key: 'seed',
        group: 'gen',
        kind: 'number',
        label: { zh: '种子', en: 'Seed' },
        hint: { zh: '-1 表示每次随机', en: '-1 means random each run' },
      },

      // prompts
      {
        key: 'positivePrompt',
        group: 'prompt',
        kind: 'textarea',
        label: { zh: '默认正向提示词', en: 'Default positive prompt' },
        hint: { zh: '工具调用没给 prompt 时用这个', en: 'Used when a tool call omits the prompt' },
      },
      {
        key: 'negativePrompt',
        group: 'prompt',
        kind: 'textarea',
        label: { zh: '默认负向提示词', en: 'Default negative prompt' },
        hint: { zh: '排除不想要的东西', en: 'What to keep out' },
      },
      {
        key: 'positivePromptFile',
        group: 'prompt',
        kind: 'text',
        label: { zh: '正向提示词文件', en: 'Positive prompt file' },
        hint: { zh: '填了就覆盖上面的正向；相对路径基于 ComfyUI 目录', en: 'Overrides the positive prompt; relative to the ComfyUI dir' },
      },
      {
        key: 'negativePromptFile',
        group: 'prompt',
        kind: 'text',
        label: { zh: '负向提示词文件', en: 'Negative prompt file' },
        hint: { zh: '填了就覆盖上面的负向', en: 'Overrides the negative prompt' },
      },

      // output
      {
        key: 'outputDir',
        group: 'out',
        kind: 'text',
        label: { zh: '出图目录', en: 'Output directory' },
        hint: { zh: '每张图落盘的绝对路径；留空则只作为附件返回', en: 'Absolute path; empty means attachment only' },
        placeholder: 'C:/Users/you/Pictures/comfy',
      },
      {
        key: 'saveToOutputDir',
        group: 'out',
        kind: 'boolean',
        label: { zh: '写入出图目录', en: 'Write to output directory' },
        hint: { zh: '关掉就只作为附件返回', en: 'Off means attachment only' },
      },
      {
        key: 'filenamePrefix',
        group: 'out',
        kind: 'text',
        label: { zh: '文件名前缀', en: 'Filename prefix' },
        hint: { zh: '例如 dsh → dsh_20261104_181500_01.png', en: 'e.g. dsh → dsh_20261104_181500_01.png' },
      },
      {
        key: 'attachToConversation',
        group: 'out',
        kind: 'boolean',
        label: { zh: '作为附件返回对话', en: 'Attach to the conversation' },
        hint: { zh: '关掉只留文件路径', en: 'Off leaves only the file path' },
      },
      {
        key: 'saveImagesToWorkspace',
        group: 'out',
        kind: 'boolean',
        label: { zh: '同时复制到工作区', en: 'Also copy into the workspace' },
        hint: { zh: '方便在编辑器里直接看', en: 'Handy for the file tree' },
      },
      {
        key: 'workspaceFolder',
        group: 'out',
        kind: 'text',
        label: { zh: '工作区子目录', en: 'Workspace folder' },
        hint: { zh: '相对当前会话工作区', en: 'Relative to the session workspace' },
      },

      // launcher
      {
        key: 'launcherEnabled',
        group: 'launch',
        kind: 'boolean',
        label: { zh: '允许插件启动 ComfyUI', en: 'Allow the plugin to start ComfyUI' },
        hint: { zh: '只跑你指定的解释器和 main.py', en: 'Runs only the interpreter and main.py you point at' },
      },
      {
        key: 'comfyuiDir',
        group: 'launch',
        kind: 'text',
        label: { zh: 'ComfyUI 目录', en: 'ComfyUI directory' },
        hint: { zh: '包含 main.py 的目录', en: 'The directory holding main.py' },
        placeholder: 'D:/ComfyUI',
      },
      {
        key: 'pythonPath',
        group: 'launch',
        kind: 'text',
        label: { zh: 'Python 解释器', en: 'Python interpreter' },
        hint: { zh: '建议指向该 ComfyUI 的 venv', en: 'Point at that ComfyUI venv' },
        placeholder: 'D:/ComfyUI/python_embeded/python.exe',
      },
      {
        key: 'launchArgs',
        group: 'launch',
        kind: 'text',
        label: { zh: '启动参数', en: 'Launch arguments' },
        hint: { zh: '低显存加 --lowvram --reserve-vram 0.4', en: 'Add --lowvram --reserve-vram 0.4 on small cards' },
      },
      {
        key: 'autoLaunchOnGenerate',
        group: 'launch',
        kind: 'boolean',
        label: { zh: '出图前自动拉起', en: 'Auto-start before generating' },
        hint: { zh: '服务没响应时先启动再出图', en: 'Start the server when it is down' },
      },
      {
        key: 'launchWaitSeconds',
        group: 'launch',
        kind: 'number',
        label: { zh: '启动等待（秒）', en: 'Startup wait (s)' },
        hint: { zh: '等多久算启动失败', en: 'How long before giving up' },
      },

      // advanced
      {
        key: 'extraWorkflowJson',
        group: 'adv',
        kind: 'textarea',
        label: { zh: '自定义工作流 JSON', en: 'Custom workflow JSON' },
        hint: {
          zh: 'ComfyUI「Save (API Format)」导出的图；留空用内置 txt2img',
          en: 'A graph exported with "Save (API Format)"; empty uses the built-in txt2img',
        },
      },
    ]

    /** Group order and titles. */
    const GROUPS = [
      ['conn', 'groupConn'],
      ['model', 'groupModel'],
      ['gen', 'groupGen'],
      ['prompt', 'groupPrompt'],
      ['out', 'groupOut'],
      ['launch', 'groupLaunch'],
      ['adv', 'groupAdv'],
    ]

    // ----------------------------------------------------------------- api --

    /** Read a JSON response, surfacing the host's error text. */
    async function api(path, body) {
      const init = body === undefined
        ? { method: 'GET' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const response = await fetch(`${API}/${path}`, init)
      const text = await response.text()
      let value
      try {
        value = text.length > 0 ? JSON.parse(text) : {}
      } catch {
        throw new Error(`${path}: 返回不是 JSON（HTTP ${String(response.status)}）`)
      }
      if (!response.ok) throw new Error(value?.error ?? `${path}: HTTP ${String(response.status)}`)
      return value
    }

    /** Coerce a staged value back to its stored type. */
    function cast(field, raw) {
      if (field.kind === 'boolean') return raw === true
      if (field.kind === 'number') {
        // A cleared input yields '' — skip the field instead of writing 0.
        if (typeof raw === 'string' && raw.trim().length === 0) return undefined
        const n = Number(raw)
        return Number.isFinite(n) ? n : undefined
      }
      return typeof raw === 'string' ? raw : String(raw ?? '')
    }

    /** Format bytes as a short human string. */
    function mb(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '?'
      return `${String(Math.round(bytes / 1024 / 1024))} MB`
    }

    // ---------------------------------------------------------------- style --

    const STYLE_ID = 'dsh-comfyui-studio-style'
    const CSS = `
.cui-root{display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#e6e6e6)}
.cui-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.cui-head-main{flex:1 1 240px;min-width:200px}
.cui-title{font-size:15px;font-weight:600;margin:0}
.cui-sub{opacity:.62;font-size:12px;margin:2px 0 0}
.cui-badge{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:11.5px;border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,.16));white-space:nowrap}
.cui-dot{width:7px;height:7px;border-radius:50%;background:#8b8b8b;flex:none}
.cui-dot.ok{background:#31c48d;box-shadow:0 0 0 3px rgba(49,196,141,.16)}
.cui-dot.down{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.16)}
.cui-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cui-btn{appearance:none;cursor:pointer;border-radius:7px;padding:5px 11px;font-size:12.5px;font-family:inherit;
  border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,.18));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));
  color:inherit;transition:background .13s,border-color .13s,opacity .13s}
.cui-btn:hover:not(:disabled){background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.3)}
.cui-btn:disabled{opacity:.45;cursor:default}
.cui-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
.cui-btn.primary:hover:not(:disabled){background:#1d4ed8;border-color:#1d4ed8}
.cui-btn.danger{color:#fca5a5;border-color:rgba(239,68,68,.42)}
.cui-btn.danger:hover:not(:disabled){background:rgba(239,68,68,.14)}
.cui-btn.tiny{padding:1px 7px;font-size:11px;border-radius:5px}
.cui-groups{display:flex;flex-direction:column;gap:10px}
.cui-group{border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,.1));border-radius:10px;overflow:hidden}
.cui-group>summary{cursor:pointer;padding:9px 12px;font-weight:600;font-size:12.5px;background:rgba(255,255,255,.03);
  list-style:none;display:flex;align-items:center;gap:8px}
.cui-group>summary::-webkit-details-marker{display:none}
.cui-group>summary::before{content:'▸';font-size:10px;opacity:.6;transition:transform .13s}
.cui-group[open]>summary::before{transform:rotate(90deg)}
.cui-group-body{padding:10px 12px 13px;display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:11px}
.cui-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.cui-field.wide{grid-column:1/-1}
.cui-label{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500}
.cui-over{font-size:10px;padding:0 5px;border-radius:4px;background:rgba(37,99,235,.22);color:#93c5fd}
.cui-hint{font-size:11px;opacity:.5;line-height:1.4}
.cui-input,.cui-select,.cui-area{width:100%;box-sizing:border-box;font-family:inherit;font-size:12.5px;color:inherit;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.28));border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,.16));
  border-radius:7px;padding:6px 9px;outline:none;transition:border-color .13s,box-shadow .13s}
.cui-input:focus,.cui-select:focus,.cui-area:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.18)}
.cui-area{resize:vertical;min-height:74px;line-height:1.45}
.cui-area.tall{min-height:132px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.cui-check{display:flex;align-items:center;gap:7px;padding-top:3px}
.cui-check input{width:15px;height:15px;accent-color:#2563eb;cursor:pointer}
.cui-health{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px;padding:9px 12px;
  border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,.1));border-radius:10px;background:rgba(255,255,255,.02)}
.cui-health dt{opacity:.55}
.cui-health dd{margin:0;word-break:break-word}
.cui-log{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.55;
  background:rgba(0,0,0,.34);border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,.1));border-radius:9px;
  padding:9px 11px;max-height:230px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.cui-log-empty{opacity:.42}
.cui-preview{border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,.1));border-radius:10px;padding:10px;
  display:flex;flex-direction:column;gap:8px;align-items:flex-start;background:rgba(255,255,255,.02)}
.cui-preview img{max-width:100%;max-height:460px;border-radius:8px;display:block}
.cui-preview-meta{font-size:11.5px;opacity:.62;word-break:break-all}
.cui-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-subtle,rgba(255,255,255,.18));background:transparent;color:inherit;
  font-size:11.5px;font-family:inherit;transition:background .13s}
.cui-pill:hover{background:rgba(255,255,255,.08)}
.cui-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cui-note{font-size:11.5px;opacity:.55}
`

    /** Inject the stylesheet once. */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ------------------------------------------------------------ the page --

    /**
     * The whole configuration page.
     * @param props - slot props plus the injected locale reader.
     */
    function StudioPage(props) {
      const t = props.t ?? ((key) => zh[key] ?? key)
      const [state, setState] = useState(undefined)
      const [staged, setStaged] = useState({})
      const [dirty, setDirty] = useState({})
      const [busy, setBusy] = useState('')
      const [log, setLog] = useState([])
      const [preview, setPreview] = useState(undefined)
      const [models, setModels] = useState({ checkpoints: [], vaes: [] })
      const [notice, setNotice] = useState('')
      const [copied, setCopied] = useState(false)
      const mounted = useRef(true)

      const push = useCallback((line) => {
        setLog((current) => [...current.slice(-79), `${new Date().toLocaleTimeString()}  ${line}`])
      }, [])

      const load = useCallback(async () => {
        try {
          const value = await api('state')
          if (!mounted.current) return
          setState(value)
          setStaged(value.config ?? {})
          setDirty({})
        } catch (error) {
          if (!mounted.current) return
          push(`读取配置失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }, [push])

      useEffect(() => {
        mounted.current = true
        ensureStyle()
        void load()
        return () => {
          mounted.current = false
        }
      }, [load])

      const config = state?.config
      const health = state?.health
      const user = state?.user ?? {}
      const presets = state?.presets ?? {}
      const samplers = state?.samplers ?? []
      const schedulers = state?.schedulers ?? []
      const writable = state?.writable !== false

      /** Options for a select field. */
      const optionsFor = useCallback(
        (field) => {
          if (field.optionsFrom === 'presets') {
            return Object.entries(presets).map(([key, value]) => ({ value: key, label: value.label ?? key }))
          }
          if (field.optionsFrom === 'checkpoints') {
            const list = models.checkpoints.length > 0 ? models.checkpoints : config?.checkpoint ? [config.checkpoint] : []
            return list.map((name) => ({ value: name, label: name }))
          }
          if (field.optionsFrom === 'vaes') {
            const list = models.vaes.length > 0 ? models.vaes : config?.vae ? [config.vae] : []
            return [{ value: '', label: t('none') }, ...list.map((name) => ({ value: name, label: name }))]
          }
          if (field.key === 'sampler') return samplers.map((name) => ({ value: name, label: name }))
          if (field.key === 'scheduler') return schedulers.map((name) => ({ value: name, label: name }))
          return []
        },
        [config, models, presets, samplers, schedulers, t],
      )

      /** Stage one edit. */
      const edit = useCallback((key, value) => {
        setStaged((current) => ({ ...current, [key]: value }))
        setDirty((current) => ({ ...current, [key]: true }))
        setNotice('')
      }, [])

      /** Reset one field to its schema default by clearing the override. */
      const resetField = useCallback(
        async (key) => {
          setBusy(`reset:${key}`)
          try {
            await api('reset', { fields: [key] })
            push(`已恢复默认：${key}`)
            await load()
          } catch (error) {
            push(`恢复失败：${error instanceof Error ? error.message : String(error)}`)
          } finally {
            setBusy('')
          }
        },
        [load, push],
      )

      /** Save every staged difference in one patch. */
      const save = useCallback(async () => {
        setBusy('save')
        setNotice('')
        try {
          const patch = {}
          for (const field of FIELDS) {
            if (dirty[field.key] !== true) continue
            const value = cast(field, staged[field.key])
            if (value !== undefined) patch[field.key] = value
          }
          if (Object.keys(patch).length === 0) {
            setNotice('没有改动')
            return
          }
          const result = await api('save', { config: patch })
          if (result.ok === false) throw new Error(result.error ?? t('saveFailed'))
          push(`已保存 ${String(Object.keys(patch).length)} 个字段`)
          setNotice(t('saved'))
          await load()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          push(`保存失败：${message}`)
          setNotice(`${t('saveFailed')}：${message}`)
        } finally {
          setBusy('')
        }
      }, [dirty, load, push, staged, t])

      /** Probe the server with the staged config. */
      const probe = useCallback(async () => {
        setBusy('probe')
        try {
          const result = await api('probe', { config: staged })
          if (result.ok === true) {
            const first = result.health?.devices?.[0]
            push(
              `探测成功：ComfyUI ${result.health?.comfyuiVersion ?? '?'}，Python ${result.health?.pythonVersion ?? '?'}` +
                (first !== undefined ? `，${first.name}（显存 ${mb(first.vramTotal)}，空闲 ${mb(first.vramFree)}）` : ''),
            )
          } else {
            push(`探测失败：${result.error ?? '未知错误'}`)
          }
          await load()
        } catch (error) {
          push(`探测失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy('')
        }
      }, [load, push, staged])

      /** Fetch the server's model lists. */
      const loadModels = useCallback(async () => {
        setBusy('models')
        try {
          const result = await api('models', { config: staged })
          if (result.ok === false) throw new Error(result.error ?? '读取失败')
          setModels({ checkpoints: result.checkpoints ?? [], vaes: result.vaes ?? [] })
          push(`模型列表：${String(result.checkpoints?.length ?? 0)} 个 checkpoint、${String(result.vaes?.length ?? 0)} 个 VAE`)
        } catch (error) {
          push(`读取模型失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy('')
        }
      }, [push, staged])

      /** Start the local server. */
      const launch = useCallback(async () => {
        setBusy('launch')
        try {
          const result = await api('launch', { config: staged })
          if (result.ok === false) throw new Error(result.error ?? '启动失败')
          push(`已启动（pid ${String(result.pid ?? '?')}）`)
          await load()
        } catch (error) {
          push(`启动失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy('')
        }
      }, [load, push, staged])

      /** Stop the server this plugin started. */
      const stop = useCallback(async () => {
        setBusy('stop')
        try {
          const result = await api('stop', {})
          push(result.stopped === true ? '已停止本插件启动的进程' : '没有本插件启动的进程')
          await load()
        } catch (error) {
          push(`停止失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy('')
        }
      }, [load, push])

      /** Interrupt the running job. */
      const interrupt = useCallback(async () => {
        setBusy('interrupt')
        try {
          const result = await api('interrupt', {})
          push(result.ok === true ? '已发送中断请求' : `中断失败：${result.error ?? ''}`)
        } catch (error) {
          push(`中断失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy('')
        }
      }, [push])

      /** Render one test image with the staged config. */
      const testRun = useCallback(async () => {
        setBusy('preview')
        setPreview(undefined)
        push('开始试跑…（4G 显存一张约 90–120 秒）')
        try {
          const result = await api('preview', { config: staged })
          if (result.ok === false) throw new Error(`${result.error ?? '生成失败'}${result.code ? ` [${result.code}]` : ''}`)
          push(`试跑完成：${String(result.width)}×${String(result.height)}，${String(result.steps)} 步，seed ${String(result.seed)}，用时 ${String(Math.round(result.elapsedMs / 1000))} 秒`)
          if (typeof result.path === 'string') {
            setPreview({ path: result.path, seed: result.seed, elapsedMs: result.elapsedMs })
            push(`文件：${result.path}`)
          }
          await load()
        } catch (error) {
          push(`试跑失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy('')
        }
      }, [load, push, staged])

      /** Apply a hardware preset to the staged values only. */
      const applyPreset = useCallback(() => {
        const preset = presets[staged.preset]
        if (preset === undefined) {
          push('请先选一个预设')
          return
        }
        setStaged((current) => ({
          ...current,
          width: preset.width,
          height: preset.height,
          steps: preset.steps,
          cfg: preset.cfg,
          batchSize: preset.batchSize,
          launchArgs: preset.launchArgs,
        }))
        setDirty((current) => ({
          ...current,
          width: true,
          height: true,
          steps: true,
          cfg: true,
          batchSize: true,
          launchArgs: true,
        }))
        push(`已套用预设「${preset.label ?? staged.preset}」，点「保存设置」写回`)
      }, [presets, push, staged.preset])

      /** Copy the resolved config so it can be pasted on another machine. */
      const copyShare = useCallback(async () => {
        try {
          const text = JSON.stringify({ 'comfyui-studio': config }, undefined, 2)
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
          push('配置 JSON 已复制到剪贴板，可直接贴到另一台机器的 cordis.patch.yml')
        } catch (error) {
          push(`复制失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }, [config, push])

      const reachable = health?.reachable === true
      const statusText = health === undefined ? t('statusUnknown') : reachable ? t('statusOk') : t('statusDown')

      /** Render one field. */
      const renderField = (field) => {
        const lang = t('lang') === 'en' ? 'en' : 'zh'
        const label = field.label[lang] ?? field.label.zh
        const hint = field.hint?.[lang] ?? field.hint?.zh
        const value = staged[field.key]
        const overridden = user[field.key] !== undefined
        const wide = field.kind === 'textarea'
        return h(
          'div',
          { className: `cui-field${wide ? ' wide' : ''}`, key: field.key },
          h(
            'div',
            { className: 'cui-label' },
            h('span', undefined, label),
            overridden
              ? h('span', { className: 'cui-over', title: t('overridden') }, t('overridden'))
              : null,
            overridden
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'cui-btn tiny',
                    disabled: !writable || busy !== '',
                    onClick: () => void resetField(field.key),
                    title: t('resetField'),
                  },
                  t('resetField'),
                )
              : null,
          ),
          field.kind === 'boolean'
            ? h(
                'label',
                { className: 'cui-check' },
                h('input', {
                  type: 'checkbox',
                  checked: value === true,
                  disabled: !writable,
                  onChange: (event) => edit(field.key, event.target.checked),
                }),
                h('span', { className: 'cui-note' }, value === true ? 'on' : 'off'),
              )
            : field.kind === 'select'
              ? h(
                  'select',
                  {
                    className: 'cui-select',
                    value: value ?? '',
                    disabled: !writable,
                    onChange: (event) => edit(field.key, event.target.value),
                  },
                  optionsFor(field).map((option) =>
                    h('option', { key: option.value, value: option.value }, option.label),
                  ),
                  field.optionsFrom === 'checkpoints' && optionsFor(field).length === 0
                    ? h('option', { value: '', key: '__none' }, t('none'))
                    : null,
                )
              : field.kind === 'textarea'
                ? h('textarea', {
                    className: `cui-area${field.key === 'extraWorkflowJson' ? ' tall' : ''}`,
                    value: value ?? '',
                    disabled: !writable,
                    spellCheck: false,
                    onChange: (event) => edit(field.key, event.target.value),
                  })
                : h('input', {
                    className: 'cui-input',
                    type: field.kind === 'number' ? 'number' : 'text',
                    value: value ?? '',
                    disabled: !writable,
                    spellCheck: false,
                    placeholder: field.placeholder ?? '',
                    onChange: (event) => edit(field.key, event.target.value),
                  }),
          hint !== undefined ? h('div', { className: 'cui-hint' }, hint) : null,
        )
      }

      if (config === undefined) {
        return h(
          'div',
          { className: 'cui-root' },
          h('div', { className: 'cui-badge' }, h('span', { className: 'cui-dot' }), t('statusUnknown')),
          h('div', { className: 'cui-note' }, '正在读取配置…'),
        )
      }

      return h(
        'div',
        { className: 'cui-root' },
        h(
          'div',
          { className: 'cui-head' },
          h(
            'div',
            { className: 'cui-head-main' },
            h('h3', { className: 'cui-title' }, t('title')),
            h('p', { className: 'cui-sub' }, t('subtitle')),
          ),
          h(
            'span',
            { className: `cui-badge` },
            h('span', { className: `cui-dot ${reachable ? 'ok' : health === undefined ? '' : 'down'}` }),
            statusText,
          ),
        ),

        h(
          'div',
          { className: 'cui-actions' },
          h('button', { type: 'button', className: 'cui-btn primary', disabled: !writable || busy !== '', onClick: () => void save() }, busy === 'save' ? t('saving') : t('save')),
          h('button', { type: 'button', className: 'cui-btn', disabled: busy !== '', onClick: () => void load() }, t('refresh')),
          h('button', { type: 'button', className: 'cui-btn', disabled: busy !== '', onClick: () => void probe() }, busy === 'probe' ? '…' : t('probe')),
          h('button', { type: 'button', className: 'cui-btn', disabled: busy !== '', onClick: () => void loadModels() }, busy === 'models' ? '…' : t('models')),
          h('button', { type: 'button', className: 'cui-btn', disabled: busy !== '', onClick: () => void testRun() }, busy === 'preview' ? t('testing') : t('testRun')),
          h('button', { type: 'button', className: 'cui-btn', disabled: busy !== '' || state?.launcher?.available !== true, onClick: () => void launch() }, busy === 'launch' ? '…' : t('launch')),
          h('button', { type: 'button', className: 'cui-btn', disabled: busy !== '', onClick: () => void stop() }, t('stop')),
          h('button', { type: 'button', className: 'cui-btn danger', disabled: busy !== '', onClick: () => void interrupt() }, t('interrupt')),
          h('button', { type: 'button', className: 'cui-btn', onClick: () => void copyShare() }, copied ? t('copied') : t('copyShare')),
        ),

        notice.length > 0 ? h('div', { className: 'cui-note' }, notice) : null,
        writable ? null : h('div', { className: 'cui-note' }, state?.error ?? t('readOnly')),

        h(
          'dl',
          { className: 'cui-health' },
          h('dt', undefined, t('healthTitle')),
          h(
            'dd',
            undefined,
            reachable
              ? `ComfyUI ${health?.comfyuiVersion ?? '?'} · Python ${health?.pythonVersion ?? '?'} · ${health?.os ?? '?'}`
              : health?.error ?? t('statusDown'),
          ),
          h('dt', undefined, 'GPU'),
          h(
            'dd',
            undefined,
            health?.devices?.length > 0
              ? health.devices
                  .map((device) => `${device.name} · ${t('vram')} ${mb(device.vramTotal)} · ${t('free')} ${mb(device.vramFree)}`)
                  .join(' / ')
              : '—',
          ),
          h('dt', undefined, 'Launcher'),
          h(
            'dd',
            undefined,
            state?.launcher?.available === true
              ? `可用 · ${state.launcher.mainPy}`
              : `不可用 · main.py ${state?.launcher?.hasMain === true ? 'ok' : 'missing'} · python ${state?.launcher?.hasPython === true ? 'ok' : 'missing'}`,
          ),
          h('dt', undefined, t('preset')),
          h(
            'dd',
            undefined,
            h(
              'span',
              { className: 'cui-row' },
              h('span', undefined, presets[staged.preset]?.label ?? staged.preset ?? '—'),
              h('button', { type: 'button', className: 'cui-btn tiny', onClick: applyPreset }, t('presetApply')),
              h('span', { className: 'cui-note' }, t('presetHint')),
            ),
          ),
        ),

        h(
          'div',
          { className: 'cui-groups' },
          GROUPS.map(([group, titleKey], index) =>
            h(
              'details',
              { className: 'cui-group', key: group, open: index < 3 },
              h('summary', undefined, t(titleKey)),
              h(
                'div',
                { className: 'cui-group-body' },
                FIELDS.filter((field) => field.group === group).map(renderField),
              ),
            ),
          ),
        ),

        h(
          'div',
          { className: 'cui-preview' },
          h('div', { className: 'cui-label' }, t('preview')),
          preview === undefined
            ? h('div', { className: 'cui-note' }, t('previewNone'))
            : [
                h('img', {
                  key: 'img',
                  alt: t('preview'),
                  src: `${API}/file?path=${encodeURIComponent(preview.path)}`,
                }),
                h(
                  'div',
                  { className: 'cui-preview-meta', key: 'meta' },
                  `seed ${String(preview.seed)} · ${String(Math.round(preview.elapsedMs / 1000))}s · ${preview.path}`,
                ),
              ],
        ),

        h(
          'div',
          { className: 'cui-field wide' },
          h(
            'div',
            { className: 'cui-label' },
            h('span', undefined, t('log')),
            h(
              'button',
              { type: 'button', className: 'cui-btn tiny', onClick: () => setLog([]) },
              t('clearLog'),
            ),
          ),
          h(
            'div',
            { className: `cui-log${log.length === 0 ? ' cui-log-empty' : ''}` },
            log.length === 0 ? t('noLog') : log.join('\n'),
          ),
        ),
      )
    }

    // ---------------------------------------------------------------- pill --

    /**
     * Composer-row status pill: one dot and the reachability verdict. Clicking
     * re-probes so a stale badge never misleads.
     * @param props - slot props plus the injected locale reader.
     */
    function StatusPill(props) {
      const t = props.t ?? ((key) => zh[key] ?? key)
      const [health, setHealth] = useState(undefined)
      const [busy, setBusy] = useState(false)

      const check = useCallback(async () => {
        setBusy(true)
        try {
          const result = await api('probe', {})
          setHealth(result.ok === true ? { reachable: true, ...result.health } : { reachable: false })
        } catch {
          setHealth({ reachable: false })
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        void check()
      }, [check])

      const reachable = health?.reachable === true
      return h(
        'button',
        {
          type: 'button',
          className: 'cui-pill',
          onClick: () => void check(),
          title: reachable ? `ComfyUI ${health?.comfyuiVersion ?? ''}` : t('statusDown'),
        },
        h('span', { className: `cui-dot ${busy ? '' : reachable ? 'ok' : 'down'}` }),
        busy ? t('statusUnknown') : reachable ? 'ComfyUI' : t('statusDown'),
      )
    }

    // ---------------------------------------------------------------- mount --

    /**
     * No hard browser dependencies: every service is reached through
     * `ctx.inject`, so a host build that lacks one surface still loads the
     * others instead of leaving this entry pending.
     */
    const inject = []

    /**
     * Mount the browser half.
     * @param ctx - browser plugin context.
     */
    function apply(ctx) {
      ensureStyle()

      // Every service is optional here: a host build without the settings page
      // or the plugin manager must still load the composer pill, and vice versa.
      const guard = (step, run) => {
        try {
          return run()
        } catch (error) {
          try {
            console.warn(`[comfyui-studio] ${step} failed; that surface stays off.`, error)
          } catch {
            // Console is not guaranteed in every shell.
          }
          return undefined
        }
      }

      let t = (key) => key
      ctx.inject(['locale'], (localeCtx) => {
        const locale = localeCtx.locale
        if (locale === undefined || typeof locale.register !== 'function') return
        t = locale.bind(NS)
        ctx.effect(() => guard('dictionary registration', () => locale.register(NS, { zh, en })), 'comfyui-studio: dictionaries')
      })

      const mount = (slotName, declaration, Component, step) => {
        ctx.inject(['slots'], (slotsCtx) => {
          const slots = slotsCtx.slots
          if (slots === undefined || typeof slots.inject !== 'function') return
          slots.inject(slotName, () =>
            guard(step, () => slots.register({ ...declaration, name: slotName, locale: NS, inject: () => ({ t }) }, Component)),
          )
        })
      }

      mount('plugins.bundle.config', { key: PACKAGE_NAME }, StudioPage, 'plugin config page')
      mount('settings.plugin.item', { key: SETTINGS_NS }, StudioPage, 'settings page')
      mount('conversation.input.right', { id: 'comfyui-studio-status', order: 20 }, StatusPill, 'composer status pill')
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
