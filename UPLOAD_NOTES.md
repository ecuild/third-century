# 上传与推送权限说明（UPLOAD_NOTES）

## 本仓库是怎么上线的
《三世纪·罗马的黄昏》已发布到 <https://github.com/ecuild/third-century>
（公开仓库，含规则书 `docs/`、PnP 素材 `pnp/`、零依赖 Web 应用 `web/`）。

Web 版可直接游玩：下载 `web/index.html` 双击即开（完全自包含，无外部依赖）。
GitHub Pages 地址 <https://ecuild.github.io/third-century/>（根目录有跳转页指向 `web/index.html`）。

## 两套「GitHub 访问」别搞混
1. **推送（`git push`）用的凭证** —— 不是从任何外部 API「申请」来的，
   而是**本机 Windows 凭据管理器（GCM）里早就缓存好的** `ecuild` 账号
   OAuth token（`gho_…`）。它是你之前在本机用 git 登录 `ecuild` 时自动存下的，
   只是被用命令读出来、拼进 HTTPS URL 用了一次。
2. **核对（`curl api.github.com`）用的** —— 那是**公开仓库的只读 REST API**，
   根本不需要任何 token，只要能联网就能查。跟推送凭证是两码事。

## 同事为什么推不了
根因：**他在另一台机器（或另一个 Windows 账号）上没有这份 GCM 缓存凭证。**
GCM 的凭据跟着「机器 + Windows 用户」走，不会随 GitHub 账号漫游。

另外提醒一个坑：本机虽然有两把 SSH 密钥（`id_ed25519` / `id_rsa`），
但对 `git@github.com` 实测是 **`Permission denied (publickey)`** ——
说明这两把密钥**根本没注册到 `ecuild` 账号**。同事别指望用本机 SSH 密钥去推，
除非先把公钥加到 `ecuild` 账号的 SSH keys 里。

## 同事获得推送权限的三种方法（按推荐顺序）
1. **他自己有 `ecuild` 账号登录权** → 在他机器上
   `git clone https://github.com/ecuild/third-century.git`，
   首次 push 时 GCM 会弹窗让他登录，之后 token 就缓存了，跟现在一样。
2. **`ecuild` 是共享账号、他不直登** → 让拥有者去仓库
   **Settings → Collaborators** 加他的 GitHub 用户名；
   或生成一个 **PAT（Personal Access Token，勾 `repo` 权限）** 发给他，
   他 push 时用户名填任意、密码填这个 PAT。
3. **走 SSH** → 让他把自己机器的公钥（`~/.ssh/id_ed25519.pub`）加到
   `ecuild` 账号的 **Settings → SSH and GPG keys**，
   然后把 remote 改成 `git@github.com:ecuild/third-century.git`。

## 安全提醒
上一轮为了 push，那个 `gho_…` token 曾被明文写进 Bash 命令（仅会话内、未写进仓库 remote）。
该 token 与 `ecuild` 账号绑定、且可能长期有效。若担心泄露，建议去
`ecuild` 账号 **GitHub Settings → Developer settings → Authorized OAuth Apps / Tokens**
里吊销并重新登录一次，让 GCM 刷新成新 token。
