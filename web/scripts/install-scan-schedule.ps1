$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).ProviderPath
$taskName = 'career-ops recurring scan'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'scheduled-jobs-runner.mjs'
$script = Join-Path $PSScriptRoot 'scheduled-jobs-task.mjs'

foreach ($file in @($runner, $script)) {
  if (-not (Test-Path -LiteralPath $file)) {
    throw "Scheduled job runner not found: $file"
  }
}

# The task's arguments are wrapped in double quotes, and Task Scheduler expands
# %VARIABLE% in them, so a value holding either cannot be passed through unchanged.
function Assert-TaskValue([string]$name, [string]$value) {
  if ($value -match '["%\r\n\x00]') {
    throw "$name must not contain a double quote, a percent sign or a line break: $value"
  }
}

# A quoted argument's trailing backslashes would escape the closing quote, so they double.
function ConvertTo-TaskArgument([string]$value) {
  '"' + ($value -replace '(\\+)$', '$1$1') + '"'
}

# Keep the runner on the same store as the web app: the task gets only the user's
# saved environment, so the path overrides set in this shell travel as arguments.
# An unset one goes as an empty value, which removes a saved value of the same name.
$envArgs = @()
foreach ($name in @('CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_SCHEDULED_JOBS_PATH')) {
  $value = [string][Environment]::GetEnvironmentVariable($name, 'Process')
  Assert-TaskValue $name $value
  $envArgs += @('--env', "$name=$value")
}

# Runner errors go to scheduled-jobs.log beside the store, as on macOS and Linux.
$log = & $node $script --print-log-path
if ($LASTEXITCODE -ne 0 -or -not $log) {
  throw 'Could not resolve the scheduled jobs store path.'
}
$log = "$log".Trim()

Assert-TaskValue 'The node path' $node
Assert-TaskValue 'The repository path' $root
Assert-TaskValue 'The log path' $log

$argument = (@($script) + $envArgs + @('--log', $log) | ForEach-Object { ConvertTo-TaskArgument $_ }) -join ' '
$action = New-ScheduledTaskAction -Execute $node -Argument $argument -WorkingDirectory $root
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
Write-Output "Runner errors: $log"
