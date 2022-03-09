Write-Output "Disabling new network window"

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1
force-mkdir "HKLM:\SYSTEM\currentControlSet\Control\Network\NewNetworkWindowOff"
