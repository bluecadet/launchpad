# See https://www.tenforums.com/tutorials/48507-enable-disable-edge-swipe-screen-windows-10-a.html
Write-Output "Disabling edge swipes"

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1
force-mkdir "HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI"
Set-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" "AllowEdgeSwipe" 0