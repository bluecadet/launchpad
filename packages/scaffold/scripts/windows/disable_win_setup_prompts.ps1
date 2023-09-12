Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

# Prevents "Let's finish setting up this device" prompt in Windows 11
force-mkdir "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\UserProfileEngagement"
Set-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\UserProfileEngagement" "ScoobeSystemSettingEnabled" 0