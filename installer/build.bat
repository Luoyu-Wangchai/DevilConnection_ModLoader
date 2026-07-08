@echo off
cd /d "%~dp0"

echo.
echo [1/3] Cleaning old output...
if exist "publish" rmdir /s /q "publish"
if exist "obj" rmdir /s /q "obj"
if exist "bin\Release" rmdir /s /q "bin\Release"

echo.
echo [2/3] Publishing (single-file / self-contained / win-x64)...
dotnet publish "DevilConnectionModLoaderInstaller.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -p:DebugSymbols=false -o "publish"

if errorlevel 1 (
    echo.
    echo [FAILED] Build error, see log above.
    pause
    exit /b 1
)

echo.
echo [3/3] Done! Single-file output:
echo     %cd%\publish\DevilConnectionModLoaderInstaller.exe
echo.
pause
