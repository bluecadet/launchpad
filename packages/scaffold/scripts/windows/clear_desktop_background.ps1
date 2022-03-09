Set-ItemProperty 'HKCU:\Control Panel\Colors' -Name Background -Value "0 0 0" -Force
Set-ItemProperty 'HKCU:\Control Panel\Desktop' -Name Wallpaper -value "" -Force

# rundll32.exe user32.dll, UpdatePerUserSystemParameters

Write-Host "Cleared desktop background. Please restart or sign out/in for changes to apply." -ForegroundColor Yellow
