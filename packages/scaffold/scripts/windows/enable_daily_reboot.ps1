# See https://github.com/morphogencc/ofxWindowsSetup/blob/master/scripts/set_scheduled_reboot.ps1

param (
[string]$rebootTime = ""
)

$taskName = "Daily System Reboot"
$taskPath = "\Exhibit"

if ($Global:LaunchpadConfig) {
	$taskPath  = $Global:LaunchpadConfig.Computer.TaskSchedulerPath;
}

if($rebootTime -eq "") {
	if (!$Global:LaunchpadConfig) {
		& $PSScriptRoot\..\load_config.ps1
	}
	$rebootTime  = $Global:LaunchpadConfig.Computer.RebootTime
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if (!$task) {
	$action = New-ScheduledTaskAction -Execute "C:\WINDOWS\System32\shutdown.exe" -Argument "-r -f"
	$trigger = New-ScheduledTaskTrigger -Daily -AT $rebootTime
	$settings = New-ScheduledTaskSettingsSet 
	$inputObject = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings 
	Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -InputObject $inputObject 
	New-ScheduledTaskAction -Execute "PowerShell.exe"
}