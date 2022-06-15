# See https://www.howtogeek.com/266621/how-to-make-windows-10-accept-file-paths-over-260-characters/

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

force-mkdir "HKLM:\SOFTWARE\Policies\Microsoft\Windows"

Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows" -Name "EnableScripts" -Type DWord -Value 1
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\PowerShell\1\ShellIds\Microsoft.PowerShell" -Name "ExecutionPolicy" -Type String -Value "RemoteSigned"

HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Windows