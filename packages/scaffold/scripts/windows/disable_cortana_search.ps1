# Disable cortana in search
$path = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search"
IF(!(Test-Path -Path $path)) {
    New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows" -Name "Windows Search"
}
Set-ItemProperty -Path $path -Name "AllowCortana" -Value 0

# Hide search in task bar
Set-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Search" "SearchboxTaskbarMode" 0
