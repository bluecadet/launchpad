# See https://social.technet.microsoft.com/Forums/lync/en-US/abde2699-0d5a-49ad-bfda-e87d903dd865/disable-windows-update-via-powershell?forum=winserverpowershell

# param (
# [string]$computerName = ""
# )

# if($computerName -eq "") {
# 	if (!$LaunchpadConfig) {
# 		& $PSScriptRoot\..\load_config.ps1
# 	}
# 	$computerName = $global:LaunchpadConfig.Computer.ComputerName
# }

$computerName = hostname

$service = Get-WmiObject Win32_Service -Filter 'Name="wuauserv"' -ComputerName $computerName -Ea 0;

if ($service) {
    if ($service.StartMode -ne "Disabled") {
        $result = $service.ChangeStartMode("Disabled").ReturnValue;

        if ($result) {
            Write-Host "Failed to disable the 'wuauserv' service on $computerName. The return value was $result." -ForegroundColor Red;
        } else {
            Write-Host "Successfully disabled the 'wuauserv' service on $computerName." -ForegroundColor Green;
        }
        
        if ($service.State -eq "Running") {
            $result = $service.StopService().ReturnValue;
            if ($result) {
                Write-Host "Failed to stop the 'wuauserv' service on $computerName. The return value was $result." -ForegroundColor Red;
            } else {
                Write-Host "Successfully stopped the 'wuauserv' service on $computerName." -ForegroundColor Green;
            }
        }
    } else {
        Write-Host "The 'wuauserv' service on $computerName is already disabled." -ForegroundColor Green;
    }
} else {
    Write-Host "Failed to retrieve the service 'wuauserv' from $computerName." -ForegroundColor Red;
}

# See https://4sysops.com/archives/turn-off-automatic-updates-in-windows-10-build-9926/

# stop-service wuauserv
# set-service wuauserv –startup disabled

# Print service status
# get-wmiobject win32_service –filter "name='wuauserv'"