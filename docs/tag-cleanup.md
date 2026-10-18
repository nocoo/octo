# 未使用标签清理手册

本手册只清理以下五个验收标签：`kb-test`、`kb-batch`、`kb-rt`、`kb-vec`、`kb-test-globalonly`。不做前缀匹配，不删除 memory，不修改其他标签，不自动清空回收站。

**本轮只准备手册，禁止执行生产清理。** 部署完成后，生产操作仍须取得单独明确授权；不要把验证测试或阅读本手册当作执行授权。

## 删除契约

- `DELETE /api/v1/tags/:name` 使用 API key，要求 `scope=all` 且有 `u`；不要求 `r` 或 `d`。名称先 trim、NFKC、拉丁字母小写，规范化后长度为 1–64。
- 成功返回 HTTP 200 与 `{name, deleted: true}`；名称不存在返回 404 `not_found`。
- 任何 space 的 memory 引用都阻止删除，**包括回收站中的 memory**。引用数不是标签列表里的可见、未删除 `use_count`；列表不返回标签也不证明可以删除。
- 若有其他标签的 `merged_into` 指向目标，返回 409 `tag_in_use`。须先人工核实并删除无引用的入向别名，从别名链最外层向内处理。本脚本不会删除白名单之外的别名。
- 删除别名只删除请求指定的名字，不沿重定向删除合并目标，不级联删除其他名称。准备后新增引用、入向别名或标签快照变化也返回 409，整批事务回滚；无关存储错误返回 503 `unavailable`。
- 支持 `Idempotency-Key`。缓存重放之前重新验证 key 的当前权限；权限或范围收紧后不能重放旧成功。无幂等键的再次删除返回 404。
- 所有调用由现有审计中间件记录 actor、DELETE、路由模板 `/api/v1/tags/:name`、状态和错误码，不记录原始标签名、请求体或 key。清理不创建 memory 版本或 change feed 事件。
- Access 后台有相同的 `DELETE /api/admin/tags/:name`，要求有效 Access 身份及同源 Origin，actor 为 `admin:<email>`。没有新增 MCP 工具。

## 执行前

1. 确认目标环境已部署此端点，并取得本次清理授权。先在隔离的本地环境演练，勿把生产作为测试环境。
2. 在当前 shell 安全注入 `OCTO_API_KEY`，不要把明文写入命令、脚本文件、历史记录或进程参数；关闭 shell tracing，不输出环境变量。
3. 设置 `OCTO_BASE_URL` 为已批准的目标。脚本默认本地开发地址，只允许下列明确地址；生产地址必须在另行获准后才可设置。
4. 如返回 409，停止脚本，人工核实全部空间、回收站及别名。不要为清理标签而自动删除或 purge memory。

## 清理脚本

以下 Python 标准库代码从环境读取 key，不使用命令行参数传递凭据，不跟随重定向。只串行请求精确白名单；404 可安全略过，409 必须人工介入，认证失败、网络异常、非预期响应或其他状态一律立即停止。不输出服务器原始错误正文。

```bash
python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

base = os.environ.get("OCTO_BASE_URL", "https://octo.dev.hexly.ai").rstrip("/")
allowed = {
    "https://octo.dev.hexly.ai",
    "http://127.0.0.1:17059",
    "https://octo.hexly.ai",
}
key = os.environ.get("OCTO_API_KEY", "")
if base not in allowed or not key or any(ch.isspace() for ch in key):
    sys.exit("STOP: invalid target or missing/invalid OCTO_API_KEY")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirect)
names = ("kb-test", "kb-batch", "kb-rt", "kb-vec", "kb-test-globalonly")
for name in names:
    request = urllib.request.Request(
        base + "/api/v1/tags/" + urllib.parse.quote(name, safe=""),
        method="DELETE",
        headers={
            "Authorization": "Bearer " + key,
            "Idempotency-Key": "tag-cleanup-" + name + "-" + str(uuid.uuid4()),
            "Accept": "application/json",
            "User-Agent": "octo-tag-cleanup/1",
        },
    )
    try:
        try:
            response = opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status = response.code
            raw = response.read(4097)
        if len(raw) > 4096:
            sys.exit("STOP: oversized response for " + name)
        body = json.loads(raw)
    except (OSError, ValueError, urllib.error.URLError):
        sys.exit("STOP: transport or response failure for " + name)
    if status == 200 and body == {"name": name, "deleted": True}:
        print(name + ": deleted")
    elif status == 404 and isinstance(body, dict) and body.get("error", {}).get("code") == "not_found":
        print(name + ": already absent")
    elif status == 409:
        sys.exit("STOP: " + name + " requires manual reference/alias inspection")
    else:
        sys.exit("STOP: unexpected HTTP " + str(status) + " for " + name)
PY
```

执行后核对逐项结果和审计记录。不要通过标签列表验证零引用字典是否删除，因为 REST/MCP 列表本就隐藏零引用标签。清理中断时先调查原因；不要盲目重试、扩大名称范围或改用数据库级联删除。
