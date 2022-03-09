# Power Settings

param (
[string]$configPath = $null
)
if (($configPath -eq $null) -OR ($configPath -eq "") -OR !(Test-Path $configPath)) {
    $configPath = $Global:LaunchpadConfig.Computer.PowerConfig
}

Write-Host "Importing power config from $configPath"

powercfg /IMPORT "$configPath"

# See https://stackoverflow.com/a/62222256/782899
$p = Get-CimInstance -Name root\cimv2\power -Class win32_PowerPlan -Filter "ElementName = 'Exhibit'"      
powercfg /setactive ([string]$p.InstanceID).Replace("Microsoft:PowerPlan\{","").Replace("}","")