# dsh-comfyui-studio

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4B6BFB)](https://github.com/Lcxy0316/dsh-comfyui-studio)
[![version](https://img.shields.io/badge/version-0.2.0-green)](https://github.com/Lcxy0316/dsh-comfyui-studio/releases)

在 DeepSeek Harness 里直接调用**本机（或远程）ComfyUI** 出图、出短视频（Wan 2.1 文生视频）。全部参数都能在 GUI 里改，改完写回 `cordis.patch.yml`，重启后依然是你的配置。

- 模型、尺寸、步数、CFG、采样器、调度器、种子、批量 —— 全部可调
- 提示词可以写在设置里，也可以指向磁盘上的 `.txt`（改文件即改词，不用动插件）
- 自带启动器：ComfyUI 没开时，一个按钮拉起本机进程（可配 python 路径与启动参数）
- 自带调试面板：探测连通性、读模型列表、试跑一张、中断任务、看显存
- 硬件预设：4G / 8G / 16G / 远程服务器，一键套用
- 中英双语，跟随 DSH 主题
- 视频：Wan 2.1 T2V 1.3B，同一套面板配 UNET / 文本编码器 / VAE，出 mp4 + 自动抽首帧
- **不经过任何云端接口**：没有额度消耗，没有内容审核，图片与视频都不出本机

## 实测

RTX 3050 Laptop（4G 显存）+ RealVisXL V4.0 + `--lowvram --reserve-vram 0.4`：

| 任务 | 分辨率 | 步数 | 耗时 |
| --- | --- | --- | --- |
| 图片 | 512×512 | 8 | 15 秒 |
| 图片 | 832×1216 | 28 | 41 秒 |
| 视频 | 256×256 / 9 帧 | 4 | 17 秒（冒烟） |
| 视频 | 384×384 / 25 帧 | 12 | 39 秒 |

---

## 1. 它给你三个工具

装好之后，模型（也就是我）可以直接调：

### `comfyui_generate`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `prompt` | string，**必填** | 正向提示词。英文效果最好 |
| `negative` | string | 负向提示词，省略用设置里的默认值 |
| `width` / `height` | integer | 像素，自动取 8 的倍数 |
| `steps` | integer | 采样步数 |
| `cfg` | number | CFG 强度 |
| `sampler` | string | 如 `dpmpp_2m` |
| `scheduler` | string | 如 `karras` |
| `seed` | integer | `-1` 或省略 = 每次随机 |
| `batch` | integer | 一次几张 |
| `checkpoint` | string | checkpoint 文件名 |
| `filenamePrefix` | string | 落盘文件名前缀 |

**所有参数都可以省略**，省略就落到设置里的默认值 —— 所以一句 `comfyui_generate({ prompt: "..." })` 就是一次完整调用。

### `comfyui_video`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `prompt` | string，**必填** | 正向提示词。写清主体、动作、镜头运动 |
| `negative` | string | 负向提示词，省略用设置默认值 |
| `width` / `height` | integer | 像素，自动取 16 的倍数（4G 显存建议 480×832） |
| `frames` | integer | 帧数，4n+1，如 49 |
| `fps` | integer | 帧率，如 16 |
| `steps` | integer | 采样步数，Wan 官方用 20 |
| `cfg` | number | CFG，Wan 官方用 6.0 |
| `shift` | number | `ModelSamplingSD3` 的 shift，Wan2.1 用 8.0 |
| `seed` | integer | `-1` 或省略 = 随机 |
| `filenamePrefix` | string | 落盘文件名前缀 |

返回**两个产物**：mp4 文件和它的首帧 png。原因是对话界面只渲染图片、不会播视频，首帧才是你能直接看到的那张。

### `comfyui_studio`

| `action` | 作用 |
| --- | --- |
| `status` | 检查连通性、ComfyUI 版本、显卡与显存、默认模型、出图目录 |
| `models` | 列出服务器上所有 checkpoint、VAE、UNET 与文本编码器 |
| `launch` | 启动本机 ComfyUI（用设置里的 python 与参数） |
| `stop` | 停掉**本插件启动的**那个进程 |
| `interrupt` | 中断当前正在跑的任务 |

---

## 2. 安装

### 2.0 一键（推荐）

```bash
git clone https://github.com/Lcxy0316/dsh-comfyui-studio.git
cd dsh-comfyui-studio
```

然后把目录拷进 profile 并登记，见下。

不想用 git 就直接下 zip：

```
https://github.com/Lcxy0316/dsh-comfyui-studio/archive/refs/heads/main.zip
```

### 2.1 已经装好 ComfyUI 的机器

```bash
# 1. 把整个目录放进 profile
cp -r dsh-comfyui-studio "$HOME/.dsh/profiles/desktop/node_modules/"

# 2. 在 profile 的 package.json 里登记
#    dependencies 里加：  "dsh-comfyui-studio": "file:./node_modules/dsh-comfyui-studio"
#    dsh.profile.bundles 末尾加：  "dsh-comfyui-studio"

# 3. 重启 DSH
```

插件自带的 `cordis.patch.yml` 会作为 bundle 层自动生效，**用户层不用加任何东西**。要覆盖默认值时才在 profile 的 `cordis.patch.yml` 末尾追加：

```yaml
- id: comfyui-studio
  name: dsh-comfyui-studio
  config:
    serverUrl: http://127.0.0.1:8188
    outputDir: D:/images
```

### 2.2 还没装 ComfyUI

按官方方式装一份 ComfyUI（Windows 便携包最省事），然后在插件设置页填两个路径：

- **ComfyUI 目录** → `.../ComfyUI`（里面有 `main.py` 的那一层）
- **Python 可执行文件** → `.../python_embeded/python.exe`（便携包）或你的 venv 里的 `python.exe`

填完点「探测服务」。没起来就点「启动服务」。

### 2.3 首次启动要填的四项

**插件不预设任何本机路径**，装完是空的，必须自己填：

| 字段 | 填什么 | 留空的后果 |
| --- | --- | --- |
| `checkpoint` | 点「读取模型」从服务器拉列表选一个 | 出图直接报错，提示你去选 |
| `outputDir` | 一个你有的绝对路径，如 `D:/images` | 不落盘，图只作为附件回到对话 |
| `comfyuiDir` | ComfyUI 安装目录（有 `main.py` 那层） | 「启动服务」按钮不可用 |
| `pythonPath` | 能跑 ComfyUI 的 `python.exe` | 同上 |

前两项不填也能出图（只要 ComfyUI 已经在跑），后两项只影响「一键启动」。

其余字段（尺寸、步数、提示词……）因人而异，但**不改也能跑**。

#### 想用视频，还要多三个模型

Wan 2.1 文生视频不是「一个 checkpoint」，它拆成三个文件，都得放进 ComfyUI 的模型目录：

| 文件 | 放到 | 从哪来 |
| --- | --- | --- |
| `wan2.1_t2v_1.3B_fp16.safetensors` | `models/diffusion_models/` | `Comfy-Org/Wan_2.1_ComfyUI_repackaged` → `split_files/diffusion_models/` |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` | 同一个仓库 → `split_files/text_encoders/` |
| `wan_2.1_vae.safetensors` | `models/vae/` | 同一个仓库 → `split_files/vae/` |

国内直连 HuggingFace 一般不通，把域名换成 `hf-mirror.com` 就行。三个文件合计约 9.8 GB。

放完点一次「读取模型」，然后到设置页「视频（Wan 2.1）」这组把三项选上。1.3B 是 4G 显存唯一现实的选择，14B 那档 fp8 也要 12 GB 以上。

---

## 3. 配置项全表

设置页按 8 组排列，每个字段下面都有说明。这里只列关键的：

### 连接

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `serverUrl` | `http://127.0.0.1:8188` | ComfyUI 地址 |
| `requestTimeoutMs` | `600000` | 单次生成总超时（10 分钟） |
| `pollIntervalMs` | `1000` | 轮询间隔 |
| `maxPollSeconds` | `900` | 超过就放弃 |

4G 显存跑 832×1216 / 28 步大约 90–120 秒，所以默认超时给得很宽。

### 模型

| 字段 | 说明 |
| --- | --- |
| `checkpoint` | 空。点「读取模型」从服务器拉列表选一个 |
| `vae` | 留空用 checkpoint 自带的 |

### 生成参数

`width` `height` `steps` `cfg` `sampler` `scheduler` `batchSize` `seed`

SDXL 写实模型的常用组合：`dpmpp_2m` + `karras` + CFG 5–6 + 28 步。

### 提示词

| 字段 | 说明 |
| --- | --- |
| `positivePrompt` | 默认正向词 |
| `negativePrompt` | 默认负向词 |
| `positivePromptFile` | 填了就**覆盖**上面的正向词；相对路径基于 ComfyUI 目录 |
| `negativePromptFile` | 同上，负向 |

优先级：**工具调用显式给的 > 提示词文件 > 设置里的默认值**。

用提示词文件的好处：换词只改 txt，不动插件、不用重启。

### 输出

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `outputDir` | 空 | 每张图落盘的位置；空 = 不落盘 |
| `saveToOutputDir` | `true` | 关掉就只作为附件返回 |
| `filenamePrefix` | `dsh` | 文件名前缀 |
| `attachToConversation` | `true` | 是否把图内联回对话 |
| `saveImagesToWorkspace` | `false` | 额外往会话工作区拷一份 |
| `workspaceFolder` | `comfyui-studio` | 上面那个子目录名 |

### 视频（Wan 2.1）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `videoUnet` | 空 | `models/diffusion_models` 下，如 `wan2.1_t2v_1.3B_fp16.safetensors` |
| `videoClip` | 空 | `models/text_encoders` 下，如 `umt5_xxl_fp8_e4m3fn_scaled.safetensors` |
| `videoVae` | 空 | `models/vae` 下，`wan_2.1_vae.safetensors` |
| `videoWidth` / `videoHeight` | 480 / 832 | 16 的倍数 |
| `videoFrames` | 49 | 4n+1；自动对齐 |
| `videoFps` | 16 | 只影响播放速度 |
| `videoSteps` / `videoCfg` | 20 / 6.0 | Wan 官方值 |
| `videoSampler` / `videoScheduler` | `uni_pc` / `simple` | Wan 官方值 |
| `videoShift` | 8.0 | `ModelSamplingSD3`；2.1 是 8.0，2.2 才是 5.0 |

三个模型名留空是刻意的 —— 别人机器上的文件名不可能是你的。装好点一次「读取模型」，下拉框里就有了。

**显存实话**：Wan2.1 1.3B 在 4G 上能跑，但慢。480×832 / 49 帧 / 20 步是几分钟级别，别指望几十秒。先用 `frames=9`、`steps=4` 摸通链路，再往上加。

### 启动器

| 字段 | 说明 |
| --- | --- |
| `launcherEnabled` | 允许插件拉起本机 ComfyUI |
| `comfyuiDir` | 空。ComfyUI 安装目录 |
| `pythonPath` | 空。python.exe 路径 |
| `launchArgs` | 启动参数，**4G 显存必须带 `--lowvram --reserve-vram 0.4`** |
| `autoLaunchOnGenerate` | 出图时发现服务没开就自动拉起 |
| `launchWaitSeconds` | 等它起来的最长秒数 |

### 高级

| 字段 | 说明 |
| --- | --- |
| `preset` | 当前硬件预设（只是记录，改参数要点「套用预设」） |
| `extraWorkflowJson` | 自定义 ComfyUI API 工作流 JSON，会覆盖默认图的已知节点 |

---

## 4. 硬件预设

| 预设 | 尺寸 | 步数 | CFG | 批量 | 启动参数 |
| --- | --- | --- | --- | --- | --- |
| 低显存 4G | 832×1216 | 28 | 5.5 | 1 | `--lowvram --reserve-vram 0.4` |
| 中端 8G | 896×1216 | 30 | 6 | 1 | `--normalvram` |
| 高端 16G | 1024×1408 | 32 | 6 | 2 | `--highvram` |
| 远程服务器 | 1024×1408 | 30 | 6 | 2 | （空） |

**套用预设只改页面上的暂存值，点「保存设置」才写回。**

4G 显存的经验值：

- 批量保持 1
- 分辨率别超过 1024×1408
- 要更大就先生成再放大（Hires fix 用 `4x-UltraSharp`，denoise 0.35 左右）

---

## 5. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 状态徽章红，`probe` 报 ECONNREFUSED | ComfyUI 没开 | 点「启动服务」，或手动开 |
| `启动服务` 按钮灰 | `comfyuiDir` / `pythonPath` 不对 | 检查目录里有没有 `main.py`，python 能不能跑 |
| 出图报 `EXECUTION_ERROR` | 模型名不对 / 显存爆了 | 点「读取模型」核对名字；降分辨率或加 `--lowvram` |
| 卡在「生成中」很久 | 首次加载模型要 30–60 秒 | 等；`maxPollSeconds` 默认 900 |
| 图片显示不出来 | `outputDir` 不在允许范围内 | 预览只允许读 `outputDir` 和 `workspaceFolder` 下的文件 |
| 设置改了重启又变回去 | 改的是暂存值没保存 | 点「保存设置」 |
| 保存报 `Config field ... is not volatile` | 字段没标 volatile | 这是插件 bug，提 issue |
| 视频报 `还没有配置视频 UNET…` | 三个视频模型没选 | 设置 →「视频（Wan 2.1）」读取模型后选上 |
| 视频报 `File is corrupt/incomplete` | 模型没下完（很常见） | 核对字节数：unet 2,838,303,560 / clip 6,735,906,897 / vae 253,815,318 |
| 视频一直是噪声 | 步数太少或 CFG 太低 | 4 步 CFG 1 只适合测链路，正经出片用 20 步 CFG 6 |
| 视频画面糊、动作抖 | 1.3B 模型的能力上限 | 降到 384×384、加帧数，或换 14B（显存要 12 G 以上） |
| 显存 OOM | 帧数或分辨率太高 | 4G 卡：≤384×384 / ≤25 帧起步，一帧一帧往上试 |

调试面板会打印每一步的时间戳与结果，出错时先看那里。

---

## 6. 它是怎么工作的

```
浏览器（设置页 / 输入区药丸）
   │  fetch /comfyui-studio/*
   ▼
宿主（lib/index.js）
   │  读设置 → resolveConfig → planGeneration / planVideo
   ▼
lib/comfy.js
   │  POST /prompt  →  轮询 /history/{id}  →  GET /view（每节点取产物）
   ▼
ComfyUI
```

- 浏览器半是**手写 bundle**（`lib/client.js`），只 `require('react')`，不需要构建链
- 宿主半是纯 ESM，`@deepseek-ai/*` 由 DSH 自己的 resolve hook 解析
- 设置全部标了 `.volatile()`，所以能在运行中写回
- 路由用 `ctx.effect` 持有，reload 不会报 duplicate route

文件：

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `lib/config.js` | 426 | schema、默认值、预设、`resolveConfig`、媒体类型判定 |
| `lib/comfy.js` | 469 | ComfyUI HTTP 客户端、图片/视频工作流构造、启动器 |
| `lib/index.js` | 1010 | 路由、三个工具、设置读写、出图与出片编排 |
| `lib/client.js` | 1236 | 浏览器 UI（设置页 + 药丸） |

---

## 7. 二次开发

改完 `lib/*.js` 后：

```bash
cp -f lib/*.js "$HOME/.dsh/profiles/desktop/node_modules/dsh-comfyui-studio/lib/"
# 重启 DSH
```

宿主端代码改动需要重启才生效（`dsh-hmr` 只监视 patch 文件和 manifest，不监视 `node_modules` 里的源码）。

浏览器半的改动同样需要重启 —— 它的 bundle 由 `dsh-client-modules` 在 boot 时快照，运行中换文件不会重新读取。

---

## 8. 许可

MIT。拿去改，改完记得把 `serverUrl` / `comfyuiDir` / `pythonPath` 换成自己的。

视频工作流的节点接线参考 ComfyUI 自带的 Wan 模板（`blueprints/`），`ModelSamplingSD3` 的 shift 对 Wan2.1 是 8.0、对 Wan2.2 才是 5.0 —— 抄错会得到一片糊。
