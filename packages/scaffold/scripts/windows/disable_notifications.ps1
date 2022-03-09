# See https://community.spiceworks.com/topic/2079430-any-powershell-script-to-disable-all-windows-10-notifications?page=1#entry-7336255

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

force-mkdir "HKCU:\Software\Policies\Microsoft\Windows\Explorer"

Set-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\Explorer" -Name "DisableNotificationCenter" -Type DWord -Value 1
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications" -Name "ToastEnabled" -Type DWord -Value 0