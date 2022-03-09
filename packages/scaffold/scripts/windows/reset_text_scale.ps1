$scaling = -1
$dpi = -1

if ((Get-ItemProperty "HKCU:\Control Panel\Desktop" -Name "Win8DpiScaling" -EA 0).Win8DpiScaling -ne $null) {
    $scaling = Get-ItemProperty -Path "HKCU:\Control Panel\Desktop"| Select-Object -ExpandProperty Win8DpiScaling
}
if ((Get-ItemProperty "HKCU:\Control Panel\Desktop" -Name "LogPixels" -EA 0).LogPixels -ne $null) {
    $dpi = Get-ItemProperty -Path "HKCU:\Control Panel\Desktop"| Select-Object -ExpandProperty LogPixels
}

if (($dpi -NE 96) -OR ($scaling -NE 1)) {
    Write-Host "Setting Windows display text scaling to 100%"
    Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name "Win8DpiScaling" -Value 1
    Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name "LogPixels" -Value 96
    Write-Host "You will have to log out and back in for text scaling changes to take effect." -ForegroundColor Yellow
}
