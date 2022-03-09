# See http://www.teqlog.com/disable-screensaver-group-policy.html

Write-Output "Disabling screen saver"

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

$folder = "Software\Policies\Microsoft\Windows\Control Panel\Desktop";

force-mkdir "HKLM:\$folder"
force-mkdir "HKCU:\$folder"

Set-ItemProperty -Path "HKLM:\$folder" -Name "ScreenSaveTimeOut" -Value 0
Set-ItemProperty -Path "HKLM:\$folder" -Name "ScreenSaveActive" -Value 0
Set-ItemProperty -Path "HKLM:\$folder" -Name "ScreenSaverIsSecure" -Value 0
Set-ItemProperty -Path "HKLM:\$folder" -Name "SCRNSAVE.EXE" -Value ""

set-ItemProperty -path "HKCU:\$folder" -name "ScreenSaveTimeOut" -value 0
set-ItemProperty -path "HKCU:\$folder" -name "ScreenSaveActive" -value 0
set-ItemProperty -path "HKCU:\$folder" -name "ScreenSaverIsSecure" -value 0
set-ItemProperty -path "HKCU:\$folder" -name "SCRNSAVE.EXE" -value ""

set-ItemProperty -path "HKCU:\Control Panel\Desktop" -name "ScreenSaveTimeOut" -value 0
set-ItemProperty -path "HKCU:\Control Panel\Desktop" -name "ScreenSaveActive" -value 0
set-ItemProperty -path "HKCU:\Control Panel\Desktop" -name "ScreenSaverIsSecure" -value 0
set-ItemProperty -path "HKCU:\Control Panel\Desktop" -name "SCRNSAVE.EXE" -value ""