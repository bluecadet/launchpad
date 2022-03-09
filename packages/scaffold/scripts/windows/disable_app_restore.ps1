Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

# Prevents Apps from re-installing
force-mkdir "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "DisableAutomaticRestartSignOn" 1
