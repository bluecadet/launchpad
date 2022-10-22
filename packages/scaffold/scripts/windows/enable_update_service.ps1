try {
    Get-Variable $PSScriptRoot -Scope Global -ErrorAction 'Stop'
    Import-Module -DisableNameChecking $PSScriptRoot/functions.psm1;
} catch [System.Management.Automation.ItemNotFoundException] {
    Import-Module -DisableNameChecking ../functions.psm1;
}

Write-Output "Enabling Windows Update Service"
Enable-Service("wuauserv");

Write-Output "Enabling Update Orchestrator Service"
Enable-Service("UsoSvc");

Write-Output "Enabling Windows Update Medic Service"
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\WaaSMedicSvc' -Name 'Start' -value 2
Enable-Service("WaaSMedicSVC");
