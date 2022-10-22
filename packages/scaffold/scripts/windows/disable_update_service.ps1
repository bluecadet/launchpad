try {
    Get-Variable $PSScriptRoot -Scope Global -ErrorAction 'Stop'
    Import-Module -DisableNameChecking $PSScriptRoot/functions.psm1;
} catch [System.Management.Automation.ItemNotFoundException] {
    Import-Module -DisableNameChecking ../functions.psm1;
}

Write-Output "Disabling Windows Update Medic Service"
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\WaaSMedicSvc' -Name 'Start' -value 4
Disable-Service("WaaSMedicSVC");

Write-Output "Disabling Update Orchestrator Service"
Disable-Service("UsoSvc");

Write-Output "Disabling Windows Update Service"
Disable-Service("wuauserv");
