@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ==============================================================================
:: SubmodHub Android 客户端一键交叉编译脚本 (Windows -> Linux 100.72.137.92)
:: 用法:
::   build-android.bat [REMOTE_HOST] [ARCH] [--no-pause]
:: 参数:
::   REMOTE_HOST : 远程编译主机 (默认: sirphomesv 或 100.72.137.92)
::   ARCH        : 目标架构 (默认: arm64，可选: amd64)
::   --no-pause  : 脚本执行完毕后不暂停 (适合 CI / 自动化调用)
:: ==============================================================================

cd /d "%~dp0"

set "REMOTE_HOST=sirphomesv"
set "ARCH=arm64"
set "NO_PAUSE=0"
set "REMOTE_DIR=~/submodhub_build"
set "LOCAL_BIN_DIR=cmd\client\SubmodHub\bin"
set "OUTPUT_APK=%LOCAL_BIN_DIR%\submodhub.apk"
set "TAR_FILE=build-sync-%RANDOM%.tar"

:: 参数解析
for %%a in (%*) do (
    if "%%a"=="--no-pause" (
        set "NO_PAUSE=1"
    ) else if "%%a"=="-y" (
        set "NO_PAUSE=1"
    ) else if not defined ARG1_SET (
        set "REMOTE_HOST=%%~a"
        set "ARG1_SET=1"
    ) else if not defined ARG2_SET (
        set "ARCH=%%~a"
        set "ARG2_SET=1"
    )
)

echo =====================================================================
echo  SubmodHub Android 客户端一键交叉编译
echo =====================================================================
echo [配置] 远程主机: !REMOTE_HOST!
echo [配置] 目标架构: !ARCH!
echo [配置] 远程目录: !REMOTE_DIR!
echo [配置] 本地输出: %OUTPUT_APK%
echo.

:: 1. 检查本地环境依赖
echo [1/5] 检查本地环境依赖...
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未在系统 PATH 中找到 git，请先安装 Git 并配置环境变量。
    goto :error
)
where ssh >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未在系统 PATH 中找到 ssh，请先安装 OpenSSH 并配置环境变量。
    goto :error
)
where scp >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未在系统 PATH 中找到 scp，请先配置环境变量。
    goto :error
)

:: 测试 SSH 连通性
echo 正在测试与远程主机 !REMOTE_HOST! 的连接...
ssh -o ConnectTimeout=5 -o BatchMode=yes !REMOTE_HOST! "echo ok" >nul 2>nul
if %errorlevel% neq 0 (
    echo [提示] 正在尝试通过 SSH 交互连接 !REMOTE_HOST! ...
    ssh -o ConnectTimeout=5 !REMOTE_HOST! "echo ok" >nul 2>nul
    if %errorlevel% neq 0 (
        echo [错误] 无法连接到远程主机 !REMOTE_HOST!。请检查网络、Tailscale 或 ~/.ssh/config 配置。
        goto :error
    )
)
echo [成功] 远程主机连接正常。
echo.

:: 2. 打包当前代码树
echo [2/5] 打包本地源码...
set "ARCHIVE_REF=HEAD"
for /f "tokens=*" %%i in ('git stash create 2^>nul') do set "ARCHIVE_REF=%%i"

if "!ARCHIVE_REF!"=="HEAD" (
    echo 正在从当前分支 HEAD 打包已提交的代码...
) else (
    echo [提示] 检测到本地未提交修改，已自动包含当前工作区修改 [!ARCHIVE_REF!] ...
)

git archive !ARCHIVE_REF! -o "%TAR_FILE%"
if %errorlevel% neq 0 (
    echo [错误] git archive 打包失败！
    goto :error
)

for /f "tokens=*" %%i in ('git status --porcelain 2^>nul ^| findstr /r "^??"') do (
    set "HAS_UNTRACKED=1"
)
if defined HAS_UNTRACKED (
    echo [提示] 检测到工作区存在未跟踪的新文件（??）。新文件需先执行 git add 才能被打包。
)

:: 3. 上传源码至远程编译主机
echo.
echo [3/5] 上传代码包至 !REMOTE_HOST!:!REMOTE_DIR! ...
scp "%TAR_FILE%" "!REMOTE_HOST!:!REMOTE_DIR!/build-sync.tar"
if %errorlevel% neq 0 (
    echo [错误] 上传代码包失败！
    del /f /q "%TAR_FILE%" 2>nul
    goto :error
)
del /f /q "%TAR_FILE%" 2>nul
echo [成功] 代码包上传完成。
echo.

:: 4. 远程执行交叉编译与 APK 构建
echo [4/5] 正在远程执行交叉编译 (架构: !ARCH!)...
echo ---------------------------------------------------------------------
ssh "!REMOTE_HOST!" "bash -lc 'cd !REMOTE_DIR! && tar -xf build-sync.tar && rm -f build-sync.tar && cd cmd/client/SubmodHub && task android:build ARCH=!ARCH! && task android:assemble:apk'"
if %errorlevel% neq 0 (
    echo ---------------------------------------------------------------------
    echo [错误] 远程构建执行失败！详细日志请参考上方控制台输出。
    goto :error
)
echo ---------------------------------------------------------------------
echo [成功] 远程交叉编译与 APK 打包完成。
echo.

:: 5. 下载并校验产物
echo [5/5] 从远程下载构建产物...
if not exist "%LOCAL_BIN_DIR%" mkdir "%LOCAL_BIN_DIR%"

scp "!REMOTE_HOST!:!REMOTE_DIR!/cmd/client/SubmodHub/bin/submodhub.apk" "%OUTPUT_APK%"
if %errorlevel% neq 0 (
    echo [错误] 下载 APK 失败！请确认远程 !REMOTE_DIR!/cmd/client/SubmodHub/bin/submodhub.apk 是否成功生成。
    goto :error
)

:: 同步备份至 submodhub-debug.apk
copy /y "%OUTPUT_APK%" "%LOCAL_BIN_DIR%\submodhub-debug.apk" >nul

echo [成功] APK 已下载到本地: %OUTPUT_APK%
echo.
echo =====================================================================
echo  构建产物校验信息
echo =====================================================================
set "SHA_VAL="
for /f "skip=1 tokens=*" %%H in ('certutil -hashfile "%OUTPUT_APK%" SHA256 2^>nul') do (
    if not defined SHA_VAL set "SHA_VAL=%%H"
)
echo SHA-256 : !SHA_VAL!
for %%F in ("%OUTPUT_APK%") do (
    set "FILE_SIZE=%%~zF"
    echo 文件大小: !FILE_SIZE! 字节
)
echo.
echo [完成] Android 客户端交叉编译已就绪，可直接安装或侧载至设备。
echo =====================================================================

if "%NO_PAUSE%"=="0" (
    pause
)
exit /b 0

:error
echo.
echo =====================================================================
echo [失败] 构建过程中断。
echo =====================================================================
if "%NO_PAUSE%"=="0" (
    pause
)
exit /b 1
