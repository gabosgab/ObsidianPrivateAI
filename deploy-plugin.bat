@echo off
echo ========================================
echo   Obsidian Local LLM Plugin Deployer BAT
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js found. Building plugin...
echo.

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
    echo Dependencies installed successfully.
    echo.
)

REM Build the plugin
echo Building plugin...
CALL npm run build
if %errorlevel% neq 0 (
    echo ERROR: Build failed
    pause
    exit /b 1
)
echo Build completed successfully.
echo.

REM Define source and destination paths
set "SOURCE_DIR=%~dp0"
set "DEST_DIR=C:\Users\gabe\Documents\Personal\.obsidian\plugins\obsidian-local-llm"

echo Copying files to Obsidian plugins directory...
echo Source: %SOURCE_DIR%
echo Destination: %DEST_DIR%
echo.

REM Create destination directory if it doesn't exist
if not exist "%DEST_DIR%" (
    echo Creating destination directory...
    mkdir "%DEST_DIR%"
    if %errorlevel% neq 0 (
        echo ERROR: Failed to create destination directory
        pause
        exit /b 1
    )
    echo Destination directory created successfully.
    echo.
)

REM Copy necessary files
echo Copying plugin files...
copy "main.js" "%DEST_DIR%\" >nul
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy main.js
    pause
    exit /b 1
)

copy "manifest.json" "%DEST_DIR%\" >nul
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy manifest.json
    pause
    exit /b 1
)

copy "styles.css" "%DEST_DIR%\" >nul
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy styles.css
    pause
    exit /b 1
)

echo All files copied successfully.

echo.
echo ========================================
echo   Deployment completed successfully!
echo ========================================
echo.
echo Plugin files copied to: %DEST_DIR%
echo.
echo Next steps:
echo 1. Restart Obsidian
echo 2. Go to Settings ^> Community Plugins
echo 3. Enable "Local LLM Chat" plugin
echo 4. Configure your LLM settings
echo.