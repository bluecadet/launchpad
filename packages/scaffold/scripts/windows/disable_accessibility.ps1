# See https://github.com/W4RH4WK/Debloat-Windows-10/blob/master/scripts/optimize-user-interface.ps1
Write-Output "Disabling keyboard accessibility keys"
Set-ItemProperty "HKCU:\Control Panel\Accessibility\StickyKeys" "Flags" "506"
Set-ItemProperty "HKCU:\Control Panel\Accessibility\Keyboard Response" "Flags" "122"
Set-ItemProperty "HKCU:\Control Panel\Accessibility\ToggleKeys" "Flags" "58"