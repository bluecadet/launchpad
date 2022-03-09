# See https://github.com/morphogencc/ofxWindowsSetup/blob/master/scripts/set_timezone.ps1

param (
[string]$timezone  = ""
)

if($timezone  -eq "") {
	if (!$LaunchpadConfig) {
		& $PSScriptRoot\..\load_config.ps1
	}
	$timezone  = $global:LaunchpadConfig.Computer.Timezone
}

& "$env:windir\system32\tzutil.exe" /s $timezone

$taskName1 = "Resync Time 1 of 2"
$taskName2 = "Resync Time 2 of 2"
$taskPath = "\Exhibit"

if ($Global:LaunchpadConfig) {
	$taskPath  = $Global:LaunchpadConfig.Computer.TaskSchedulerPath;
}

$task1 = Get-ScheduledTask -TaskName $taskName1 -ErrorAction SilentlyContinue
$task2 = Get-ScheduledTask -TaskName $taskName2 -ErrorAction SilentlyContinue

if (!$task1) {
	$action = New-ScheduledTaskAction -Execute "C:\Windows\System32\sc.exe" -Argument "start w32time task_started" 
	$trigger = New-ScheduledTaskTrigger -AtLogOn
	$settings = New-ScheduledTaskSettingsSet
	$principal = New-ScheduledTaskPrincipal -UserId "$($env:USERDOMAIN)\$($env:USERNAME)" -LogonType ServiceAccount -RunLevel Highest
	Register-ScheduledTask -TaskName $taskName1 -TaskPath $taskPath -Description "Synchronize time at startup." -Action $action -Trigger $trigger -Settings $settings -Principal $principal
}


if (!$task2) {
	$action = New-ScheduledTaskAction -Execute "C:\Windows\System32\w32tm.exe" -Argument "/resync" 
	$trigger = New-ScheduledTaskTrigger -AtLogOn
	$settings = New-ScheduledTaskSettingsSet
	$principal = New-ScheduledTaskPrincipal -UserId "$($env:USERDOMAIN)\$($env:USERNAME)" -LogonType ServiceAccount -RunLevel Highest
	Register-ScheduledTask -TaskName $taskName2 -TaskPath $taskPath -Description "Synchronize time at startup." -Action $action -Trigger $trigger -Settings $settings -Principal $principal
}