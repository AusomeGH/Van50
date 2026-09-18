<#
.SYNOPSIS
    Van50 Windows Scheduled Task Automation Setup
    Registers or manages a native Windows Scheduled Task (Van50DailySync)
    to autonomously run the daily discovery pipeline every morning at 04:00 AM.

.DESCRIPTION
    Usage:
        .\setup_windows_task.ps1 -Install [-Time "04:00"]
        .\setup_windows_task.ps1 -Status
        .\setup_windows_task.ps1 -RunNow
        .\setup_windows_task.ps1 -Uninstall
#>

param (
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Status,
    [switch]$RunNow,
    [string]$Time = "04:00"
)

$TaskName = "Van50DailySync"
$ProjectRoot = "C:\Users\Micro\.gemini\antigravity-ide\scratch\van50"
$PythonScript = "$ProjectRoot\scripts\daily_automation.py"

# Locate Python executable
$PythonPath = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if (-not $PythonPath) {
    $PythonPath = "python.exe"
}

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " Van50 Autonomous Daily Sync Windows Task Setup " -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Task Name: $TaskName"
Write-Host "Script:    $PythonScript"
Write-Host "Python:    $PythonPath"
Write-Host "Target:    Daily at $Time"
Write-Host ""

if ($Uninstall) {
    Write-Host "[ACTION] Removing Windows Scheduled Task '$TaskName'..." -ForegroundColor Yellow
    schtasks.exe /Delete /TN $TaskName /F
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Task '$TaskName' removed successfully." -ForegroundColor Green
    } else {
        Write-Host "[WARN] Task '$TaskName' not found or could not be removed." -ForegroundColor DarkYellow
    }
    exit 0
}

if ($RunNow) {
    Write-Host "[ACTION] Triggering immediate run of '$TaskName'..." -ForegroundColor Cyan
    schtasks.exe /Run /TN $TaskName
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Task run requested successfully. Check data/automation_logs/ for output." -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Could not trigger task '$TaskName'." -ForegroundColor Red
    }
    exit 0
}

if ($Status) {
    Write-Host "[STATUS] Querying task '$TaskName'..." -ForegroundColor Cyan
    schtasks.exe /Query /TN $TaskName /FO LIST /V
    exit 0
}

# Default action or -Install
Write-Host "[ACTION] Registering Windows Scheduled Task '$TaskName'..." -ForegroundColor Cyan

$TaskAction = "`"$PythonPath`" `"$PythonScript`" --run-once"

# Create task running daily at specified time
# /SC DAILY /ST HH:MM /TR "<command>" /TN "<TaskName>" /F
schtasks.exe /Create /SC DAILY /ST $Time /TN $TaskName /TR $TaskAction /F

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[SUCCESS] Task '$TaskName' created successfully!" -ForegroundColor Green
    Write-Host "Schedule: Daily at $Time AM" -ForegroundColor Green
    Write-Host "Van50 will autonomously discover events, audit ticket links, and update data/events.json hands-free." -ForegroundColor Green
    Write-Host ""
    Write-Host "To verify status anytime: .\setup_windows_task.ps1 -Status" -ForegroundColor Gray
    Write-Host "To trigger test run now:   .\setup_windows_task.ps1 -RunNow" -ForegroundColor Gray
    Write-Host "To uninstall:             .\setup_windows_task.ps1 -Uninstall" -ForegroundColor Gray
} else {
    Write-Host "[ERROR] Failed to register scheduled task. Exit code: $LASTEXITCODE" -ForegroundColor Red
}
