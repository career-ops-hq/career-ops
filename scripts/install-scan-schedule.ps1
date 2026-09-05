$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$taskName = 'career-ops recurring scan'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$script = Join-Path $root 'scripts\scheduled-jobs-runner.mjs'

if (-not (Test-Path -LiteralPath $script)) {
  throw "Scheduled job runner not found: $script"
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root
$start = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Career Ops scheduled-jobs queue worker every 15 minutes (local-only, zero-token; current user must be logged in)' -Force | Out-Null
$registered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$actual = $registered.Principal
if ($actual.UserId -ne $principal.UserId -or $actual.LogonType.ToString() -notin @('Interactive', 'InteractiveToken') -or $actual.RunLevel.ToString() -ne 'Limited') {
  throw "Scheduled task '$taskName' has an unexpected security context (UserId=$($actual.UserId), LogonType=$($actual.LogonType), RunLevel=$($actual.RunLevel)); refusing to continue."
}
Write-Output "Installed '$taskName' for $($principal.UserId) (interactive; the user must be logged in)."
