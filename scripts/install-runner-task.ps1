param(
  [Parameter(Mandatory = $true)]
  [string]$Workspace,

  [Parameter(Mandatory = $true)]
  [string]$WorkerUrl,

  [string]$Python = "python",
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$taskName = "KLIZONION Supervised Runner"
$repoRoot = Split-Path -Parent $PSScriptRoot
$runnerPath = Join-Path $repoRoot "packages\agent\runner.py"

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed scheduled task: $taskName"
  exit 0
}

if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) {
  throw "Authorized workspace does not exist: $Workspace"
}
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
  throw "Runner not found: $runnerPath"
}
if (-not [Environment]::GetEnvironmentVariable("RUNNER_SHARED_SECRET", "User")) {
  throw "Set RUNNER_SHARED_SECRET as a User environment variable before installing the task. The secret is never stored in this script."
}

$arguments = "-u `"$runnerPath`" --workspace `"$Workspace`" --worker-url `"$WorkerUrl`""
$action = New-ScheduledTaskAction -Execute $Python -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType InteractiveToken -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Starts the supervised KLIZONION structured runner for the authorized workspace." -Force | Out-Null
Write-Output "Installed: $taskName"
Write-Output "Workspace: $Workspace"
Write-Output "Worker: $WorkerUrl"
Write-Output "The runner will start at the next user logon and reconnect after temporary failures."
