# See https://stackoverflow.com/questions/41235618/powershell-command-to-create-a-schedule-task-to-execute-a-batch-file-during-boot

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

if (!$Global:LaunchpadConfig) {
    & $PSScriptRoot\..\load_config.ps1
}

$taskName = "Launch exhibit app on boot"
$taskPath  = $Global:LaunchpadConfig.Computer.TaskSchedulerPath;
$taskAction = $Global:LaunchpadConfig.Computer.StartupAction;
$taskDir = (Resolve-Path $Global:LaunchpadConfig.Computer.StartupWorkingDir).Path;
$taskDelay = $Global:LaunchpadConfig.Computer.StartupDelay;

if ($global:LaunchpadConfig.Computer.StartupCreateBat) {
    $filename = $global:LaunchpadConfig.Computer.StartupBat;
    $batPath = "${taskDir}${filename}";
    if (!(Test-Path $batPath)) {
        force-mkdir $taskDir;
        Write-Host "Creating a startup .bat at ${batPath}";
        New-Item $batPath -Force | Out-Null;
        Set-Content $batPath $global:LaunchpadConfig.Computer.StartupBatContent;
    } else {
        Write-Host "Startup .bat already exists at ${batPath}";
    }
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if (!$task) {
    $action = New-ScheduledTaskAction -Execute $taskAction -WorkingDirectory $taskDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $trigger.Delay = $taskDelay
	$settings = New-ScheduledTaskSettingsSet
	$inputObject = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings
    Register-ScheduledTask -TaskName $taskName -TaskPath $taskPath -InputObject $inputObject
}