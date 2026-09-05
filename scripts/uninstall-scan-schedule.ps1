$ErrorActionPreference = 'Stop'

$taskName = 'career-ops recurring scan'
$task = $null
try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
} catch {
  if ($_.FullyQualifiedErrorId -notmatch 'TaskNotFound|ItemNotFound|HRESULT: 0x80070002') {
    throw "Could not inspect scheduled task '$taskName': $($_.Exception.Message)"
  }
}
if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Removed '$taskName'."
} else {
  Write-Output "'$taskName' is not installed."
}
