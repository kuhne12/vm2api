# 此 fork 的 ARM64 源码部署

此分支在上游 v1.3.226 基础上保留 Codex 内核启动失败重试和 Claude 槽位
native-arm64 显式启用支持。镜像从当前源码构建，避免上游预构建镜像遗漏修复。

`docker-compose.fork.yml` 保留现有 `data/`、`vms/`、`bin/` 和 `share/`，
运行配置使用 Git 忽略的 `.local/fork-config/`，避免面板修改配置后阻塞代码更新。
首次切换前应备份 `.env`、数据库和槽位状态，将当前运行容器的配置复制过去：

```sh
mkdir -p .local/fork-config
docker cp vm2api:/opt/vm2api/src/config/. .local/fork-config/
```

已有安装须移除基础 Compose 文件中额外的旧源码文件挂载，恢复仓库中的
`docker-compose.yml`。保留 `.env` 中原有密钥，并将 `COMPOSE_FILE` 设置为：

```dotenv
COMPOSE_FILE=docker-compose.yml:docker-compose.fork.yml
```

macOS Docker Desktop 需要额外的 `docker-compose.override.yml`，配置
`network_mode: bridge` 和 `127.0.0.1:8787:8787` 端口映射，并将此文件追加到
`COMPOSE_FILE`，例如 `docker-compose.yml:docker-compose.fork.yml:docker-compose.override.yml`。

后续更新（先备份数据库和配置）：

```sh
git pull --ff-only origin main
docker compose build vm2api
docker compose up -d --no-deps vm2api
curl -fsS http://127.0.0.1:8787/health
docker compose exec vm2api cat VERSION
```

还需在面板检查升级前正常的槽位内核及真实请求。以上命令只替换控制面，
不重新创建槽位。当前 fork 应通过上述命令更新；面板的一键更新按上游发布 tag
检出源码，不能保留本分支的额外修复。
