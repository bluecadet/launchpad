# See https://github.com/morphogencc/ofxWindowsSetup/blob/master/scripts/set_computer_name.ps1

param (
[string]$computername  = ""
)

if($computername  -eq "") {
	if (!$LaunchpadConfig) {
		& $PSScriptRoot\..\load_config.ps1
	}
	$computername  = $global:LaunchpadConfig.Computer.ComputerName
}

$currentHostname = hostname;

if ($currentHostname -eq $computername) {
    Write-Host "Computer name already set to '$computername'" -ForegroundColor Green;
} else {
    Write-Host "Setting computer name to '$computername'" -ForegroundColor Magenta
    Rename-Computer $computername
}
