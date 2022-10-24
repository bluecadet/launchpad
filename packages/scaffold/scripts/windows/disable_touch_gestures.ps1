
Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

force-mkdir "HKCU:\Control Panel\Desktop"

# See https://answers.microsoft.com/en-us/windows/forum/all/windows-1011-touch-gesture/af9a6d19-8aa6-4d26-9693-55aa591110b3
Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name "TouchGestureSetting" -Type DWord -Value 0
