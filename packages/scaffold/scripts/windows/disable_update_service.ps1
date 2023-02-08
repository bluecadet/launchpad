try {
    Get-Variable $PSScriptRoot -Scope Global -ErrorAction 'Stop'
    Import-Module -DisableNameChecking $PSScriptRoot/functions.psm1;
} catch [System.Management.Automation.ItemNotFoundException] {
    Import-Module -DisableNameChecking ../functions.psm1;
}

Write-Output "Disabling Windows Update Medic Service"
# Windows Update Medic Service can only be disabled via the registry
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\WaaSMedicSvc' -Name 'Start' -value 4
Write-Host "Successfully disabled the 'WaaSMedicSVC' service on $ComputerName." -ForegroundColor Green;
$WaaSMedicSVC = get-ciminstance win32_service -Filter "Name='WaaSMedicSVC'" -Ea 0;
if($WaaSMedicSVC.State -eq "Running"){
    $ComputerName = "$(hostname)"
    $result = (Invoke-CimMethod -InputObject $WaaSMedicSVC -methodname StopService).ReturnValue
    if ($result) {
        Write-Host "Failed to stop the 'WaaSMedicSVC' service on $ComputerName. The return value was $result." -ForegroundColor Red;
    } else {
        Write-Host "Successfully stopped the 'WaaSMedicSVC' service on $ComputerName." -ForegroundColor Green;
    }
}

Write-Output "Disabling Update Orchestrator Service"
Disable-Service("UsoSvc");

Write-Output "Disabling Windows Update Service"
Disable-Service("wuauserv");
