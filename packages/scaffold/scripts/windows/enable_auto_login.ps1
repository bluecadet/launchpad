# See https://github.com/morphogencc/ofxWindowsSetup/blob/master/scripts/enable_autologin.ps1

# enable_autologin.ps1
# -------------------------
# Enables automatic login without a username and password; either place the username and password in the configuration file or run this
# in the powershell and enter them manually.

param (
[string]$computername = "",
[string]$username = "",
[string]$password = ""
)

if (!$LaunchpadConfig) {
	& $PSScriptRoot\..\load_config.ps1
}

if ($computername -eq "") {
    $computername = $global:LaunchpadConfig.Computer.ComputerName;
}

if($username -eq "") {
	$username = $global:LaunchpadConfig.Computer.WindowsUsername;
}

if ($password -eq "") {
    # TODO: Use $c = Get-Credential -credential $username; $c.password # This will prompt the user for the current password
    $password = $global:LaunchpadConfig.Computer.WindowsPassword;
}

Write-Host "Enabling auto login for user '$username'" -ForegroundColor Magenta

# Autologin
Set-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoAdminLogon -Value 1
Set-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name DefaultDomainName -Value $computername
Set-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name DefaultUserName -Value $username
Set-ItemProperty -Path 'HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name DefaultPassword -Value $password