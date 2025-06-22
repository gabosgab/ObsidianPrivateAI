# Obsidian Local LLM Plugin Deployer
# PowerShell version with better error handling

param(
    [string]$ObsidianPath = "C:\Users\gabe\Documents\Personal\.obsidian\plugins"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Obsidian Local LLM Plugin Deployer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
Write-Host "Checking for Node.js installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js not found"
    }
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "To install Node.js:" -ForegroundColor Yellow
    Write-Host "1. Visit https://nodejs.org/" -ForegroundColor White
    Write-Host "2. Download the LTS version" -ForegroundColor White
    Write-Host "3. Run the installer" -ForegroundColor White
    Write-Host "4. Restart your terminal/PowerShell" -ForegroundColor White
    Write-Host "5. Run this script again" -ForegroundColor White
    Write-Host ""
    Write-Host "Alternative installation methods:" -ForegroundColor Yellow
    Write-Host "• Using Chocolatey: choco install nodejs" -ForegroundColor White
    Write-Host "• Using Scoop: scoop install nodejs" -ForegroundColor White
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if npm is available
Write-Host "Checking for npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "npm not found"
    }
    Write-Host "✓ npm found: $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: npm is not available" -ForegroundColor Red
    Write-Host "This usually means Node.js was not installed properly." -ForegroundColor Yellow
    Write-Host "Please reinstall Node.js and restart your terminal." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# Install dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install dependencies" -ForegroundColor Red
        Write-Host "This might be due to network issues or permission problems." -ForegroundColor Yellow
        Write-Host "Try running: npm install --verbose" -ForegroundColor White
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "✓ Dependencies installed successfully." -ForegroundColor Green
    Write-Host ""
}

# Build the plugin
Write-Host "Building plugin..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    Write-Host "Check the error messages above for details." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "✓ Build completed successfully." -ForegroundColor Green
Write-Host ""

# Define source and destination paths
$sourceDir = Get-Location
$destDir = Join-Path $ObsidianPath "obsidian-local-llm"

Write-Host "Copying files to Obsidian plugins directory..." -ForegroundColor Yellow
Write-Host "Source: $sourceDir" -ForegroundColor Gray
Write-Host "Destination: $destDir" -ForegroundColor Gray
Write-Host ""

# Create destination directory if it doesn't exist
if (-not (Test-Path $destDir)) {
    Write-Host "Creating destination directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

# Files to copy
$filesToCopy = @("main.js", "manifest.json", "styles.css")

# Copy necessary files
Write-Host "Copying plugin files..." -ForegroundColor Yellow
$success = $true

foreach ($file in $filesToCopy) {
    if (Test-Path $file) {
        try {
            Copy-Item $file $destDir -Force
            Write-Host "  ✓ $file" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ $file - Failed to copy" -ForegroundColor Red
            $success = $false
        }
    } else {
        Write-Host "  ✗ $file - File not found" -ForegroundColor Red
        $success = $false
    }
}

if (-not $success) {
    Write-Host ""
    Write-Host "ERROR: Some files failed to copy" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Deployment completed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Plugin files copied to: $destDir" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Restart Obsidian" -ForegroundColor White
Write-Host "2. Go to Settings > Community Plugins" -ForegroundColor White
Write-Host "3. Enable 'Local LLM Chat' plugin" -ForegroundColor White
Write-Host "4. Configure your LLM settings" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"