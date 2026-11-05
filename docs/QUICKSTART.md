# 给别人的一页说明

把这个文件夹整个发给对方，或者打包成 zip。对方需要做的只有三件事。

## 一、装

1. 把 `dsh-comfyui-studio` 整个目录放进：

   ```
   C:\Users\<用户名>\.dsh\profiles\desktop\node_modules\
   ```

2. 打开 `C:\Users\<用户名>\.dsh\profiles\desktop\package.json`，在 `dependencies` 里加一行：

   ```json
   "dsh-comfyui-studio": "file:./node_modules/dsh-comfyui-studio"
   ```

   在 `dsh.profile.bundles` 数组末尾加一项：

   ```json
   "dsh-comfyui-studio"
   ```

3. 重启 DeepSeek Harness。

## 二、首次启动要填的四项

插件**不预设任何本机路径**，装完这些是空的：

| 字段 | 填什么 |
| --- | --- |
| **Checkpoint** | 点「读取模型」，从下拉里选一个 |
| **出图目录** | 你有的绝对路径，如 `D:/images`；留空则不落盘，图只回到对话 |
| **ComfyUI 目录** | 有 `main.py` 的那一层，例如 `D:/ComfyUI` |
| **Python 可执行文件** | 便携包 `D:/ComfyUI/python_embeded/python.exe`；自建 venv `<venv>/Scripts/python.exe` |

**服务地址**一般不用改（本机 `http://127.0.0.1:8188`；别人的机器填 `http://对方IP:8188`）。

填完点「保存设置」。

## 三、验证

1. 点「探测服务」→ 状态徽章变绿，下面显示 ComfyUI 版本和显卡显存
2. 点「读取模型」→ checkpoint 下拉框出现自己的模型名
3. 点「试跑一张」→ 预览区出图

三步都过就装好了。之后直接在对话里说「画一张……」即可。

## 三·五、想让它出视频（可选）

出视频要另外三个模型文件，合计约 9.8 GB，都放进 ComfyUI 的模型目录：

| 文件 | 放到 |
| --- | --- |
| `wan2.1_t2v_1.3B_fp16.safetensors` | `models/diffusion_models/` |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` |
| `wan_2.1_vae.safetensors` | `models/vae/` |

都在 `Comfy-Org/Wan_2.1_ComfyUI_repackaged` 这个仓库的 `split_files/` 下。国内把域名换成 `hf-mirror.com`。

放完点一次「读取模型」，再到设置页「视频（Wan 2.1）」这组把三项选上、保存。

然后在对话里说「生成一段视频……」，或直接点「试跑视频」。**返回的是 mp4 + 首帧 png 两个文件** —— 对话界面不播视频，首帧才是你能直接看到的那张，mp4 得去文件管理器里点。

## 显存小怎么办

4G 显存（比如 3050 Laptop、1650）务必：

- 「硬件预设」选 **低显存 4G**，点「套用预设」，再点「保存设置」
- 批量保持 1
- 分辨率别超 1024×1408
- 视频从 384×384 / 25 帧起步，别一上来就 49 帧

## 常见问题

**「启动服务」按钮是灰的**
→ `ComfyUI 目录` 里没有 `main.py`，或 `Python 可执行文件` 路径不对。

**探测失败 ECONNREFUSED**
→ ComfyUI 没开。点「启动服务」，或者自己手动开。

**出图报错 `EXECUTION_ERROR`**
→ 多半是 checkpoint 名字对不上，点「读取模型」重选；或者显存爆了，降分辨率。

**图显示不出来**
→ 预览只允许读出图目录里的文件，检查「出图目录」填的是不是绝对路径。

**视频报「模型文件损坏」**
→ 没下完，最常见。核对字节数（unet 2,838,303,560 / clip 6,735,906,897 / vae 253,815,318），不对就重下。

**视频出来是一片噪声**
→ 步数太少。4 步 CFG 1 只够测链路，正经出片用 20 步 CFG 6。

## 只想看图，不想落盘

把「写入出图目录」关掉。图片会直接作为附件回到对话里，不占硬盘。

## 想换提示词但不想每次打字

在「提示词」组里把 `正向提示词文件` 填成一个 txt 的路径（相对路径基于 ComfyUI 目录），以后改那个 txt 就行，插件不用动。

优先级：**对话里显式给的词 > 提示词文件 > 设置里的默认词**。
