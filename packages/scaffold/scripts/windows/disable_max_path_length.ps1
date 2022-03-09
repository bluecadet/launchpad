# See https://www.howtogeek.com/266621/how-to-make-windows-10-accept-file-paths-over-260-characters/

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

force-mkdir "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem"

Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Type DWord -Value 1