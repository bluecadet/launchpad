# Power Settings

param (
[string]$planPath = $null
)
if (($planPath -eq $null) -OR ($planPath -eq "") -OR !(Test-Path $planPath)) {
    $planPath = $Global:LaunchpadConfig.Computer.PowerConfig
}

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/powerplan.psm1

$planName = 'Exhibit'

Write-Host "Importing power plan '$planName' from $planPath"
powercfg /IMPORT "$planPath"

Write-Host "Selecting power plan '$planName'"

# Using https://github.com/torgro/PowerPlan
Set-Powerplan -Planname "$planName"
