
Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

force-mkdir "HKCU:\Control Panel\Cursors"

# See https://www.tenforums.com/tutorials/98415-turn-off-touch-visual-feedback-windows-10-a.html
Set-ItemProperty -Path "HKCU:\Control Panel\Cursors" -Name "ContactVisualization" -Type DWord -Value 0
Set-ItemProperty -Path "HKCU:\Control Panel\Cursors" -Name "GestureVisualization" -Type DWord -Value 0

# See https://www.top-password.com/blog/turn-on-off-press-and-hold-for-right-clicking-in-windows-10/
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Wisp\Touch" -Name "TouchMode_hold" -Type DWord -Value 0
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Wisp\Pen\SysEventParameters" -Name "HoldMode" -Type DWord -Value 3

# See https://getadmx.com/?Category=Windows_10_2016&Policy=Microsoft.Policies.TabletPCInputPanel::EdgeTarget_2
force-mkdir "HKLM:\software\policies\microsoft\TabletTip\1.7"
Set-ItemProperty -Path "HKLM:\software\policies\microsoft\TabletTip\1.7" -Name "DisableEdgeTarget" -Type DWord -Value 0

Write-Host "Disabled pen and touch feedback. Please restart or sign out/in for changes to apply." -ForegroundColor Yellow
