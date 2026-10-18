# Welcome to Your New Wails3 Project!

Congratulations on generating your Wails3 application! This README will guide you through the next steps to get your project up and running.

## Getting Started

1. Navigate to your project directory in the terminal.

2. To run your application in development mode, use the following command:

   ```
   wails3 dev
   ```

   This will start your application and enable hot-reloading for both frontend and backend changes.

3. To build your application for production, use:

   ```
   wails3 build
   ```

   This will create a production-ready executable in the `build` directory.

## Exploring Wails3 Features

Now that you have your project set up, it's time to explore the features that Wails3 offers:

1. **Check out the examples**: The best way to learn is by example. Visit the `examples` directory in the `v3/examples` directory to see various sample applications.

2. **Run an example**: To run any of the examples, navigate to the example's directory and use:

   ```
   go run .
   ```

   Note: Some examples may be under development during the alpha phase.

3. **Explore the documentation**: Visit the [Wails3 documentation](https://v3.wails.io/) for in-depth guides and API references.

4. **Join the community**: Have questions or want to share your progress? Join the [Wails Discord](https://discord.gg/JDdSxwjhGf) or visit the [Wails discussions on GitHub](https://github.com/wailsapp/wails/discussions).

## Project Structure

Take a moment to familiarize yourself with your project structure:

- `frontend/`: Contains your frontend code (HTML, CSS, JavaScript/TypeScript)
- `main.go`: The entry point of your Go backend
- `app.go`: Define your application structure and methods here
- `wails.json`: Configuration file for your Wails project

## Next Steps

1. Modify the frontend in the `frontend/` directory to create your desired UI.
2. Add backend functionality in `main.go`.
3. Use `wails3 dev` to see your changes in real-time.
4. When ready, build your application with `wails3 build`.

Happy coding with Wails3! If you encounter any issues or have questions, don't hesitate to consult the documentation or reach out to the Wails community.

## 版本号

客户端版本由仓库根目录的 `VERSION` 文件统一管理，并自动写入 Windows 版本资源、Android `versionName` / `versionCode` 和界面标题栏。

```bash
go run ./cmd/version              # 查看当前版本
go run ./cmd/version -check       # 校验所有派生元数据是否一致
go run ./cmd/version -set 0.9.1   # 升级版本并同步元数据
```

完整说明见 [`docs/VERSIONING.md`](../../../docs/VERSIONING.md)。

## 子模组覆盖文件与卸载自动还原机制

本客户端采用基于内容寻址与多层覆盖的事务性安装引擎（`schema_version = 2`），彻底解决子模组覆盖冲突及任意顺序卸载时的文件还原问题：

### 1. 覆盖与还原核心规则
- **首次接管前原始快照**：首次安装覆盖游戏/外部文件时，将原文件内容存入 Blob 存储。后续其他模组的叠加覆盖绝不重写该原始快照。
- **活动模组覆盖层**：每个活动模组在对应路径记录独立归属（mod_id, version_id, order, sha256）。最新/高 order 活动层为生效层。
- **任意顺序卸载与无复活保证**：
  - 若卸载顶层模组，自动恢复下一级活动模组内容；若无其他活动模组，自动恢复最初的游戏原文件（若原先不存在则彻底删除）。
  - 若卸载非顶层模组，仅在元数据中移除归属（`metadata_only`），不更改当前磁盘内容。后续顶层模组卸载时，直接跨过已卸载模组，绝不复活已卸载模组。
- **重新接管机制**：当某一路径的所有模组均卸载后，标记为未接管。下次若有新模组安装该路径，重新对磁盘打快照，防止沿用游戏大版本更新前的旧快照。

### 2. 外部漂移与安全阻断
- 执行安装或卸载事务前，引擎会校验目标文件在磁盘上的实际 SHA-256 哈希值。
- 若检测到外部修改、文件丢失或未预期的内容变动（漂移），操作将默认阻断（错误码 `external_change` 或 `plan_blocked`），防止意外覆盖或误删用户修改。
- 强制继续时，现场内容将先行暂存至 `.submodhub/state/rescue/` 独立救援目录，保留完整证据。

### 3. 旧数据迁移（Legacy Migration）
- 仅在旧日志具备可信收据、明确时间顺序且备份文件完整时，支持平滑迁移至 Schema V2。
- 若遇到备份缺失或时间戳歧义，返回 `migration_required` 阻断，禁止盲目将当前顶层判定为原文件。

### 4. 事务与崩溃恢复
- 跨进程文件锁保证单实例独占，避免多进程写入竞争。
- 事务遵循准备（`prepared`）→ 执行（`applying`）→ 提交（`committed`）流水线。任何中间故障均由未提交日志自动回滚（`rolled_back`），保证文件系统与清单严格一致。
