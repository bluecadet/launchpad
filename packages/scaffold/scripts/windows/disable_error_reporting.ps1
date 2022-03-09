# See https://pureinfotech.com/disable-taskbar-news-widget-windows-10/

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

force-mkdir "HKLM:\Software\Microsoft\Windows\Windows Error Reporting"

Set-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\Windows Error Reporting" -Name "Disabled " -Type DWord -Value 1
