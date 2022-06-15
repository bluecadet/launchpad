Param (
    [Parameter(HelpMessage='Path to your config file. Defaults to .\config\user.ps1')] [string]$config=""
)

if ([string]::IsNullOrEmpty($config)) {
    $config = ".\config\user.ps1"
}

$DefaultConfigPath = '.\config\defaults.ps1';
$UserConfigPath = $config;

Write-Host "Loading default config from $DefaultConfigPath" -ForegroundColor Cyan;
& $DefaultConfigPath;

if (!(FileExists $UserConfigPath)) {
    Write-Host "No user config found. Creating one for you.";
    
    Write-Host "Edit " -ForegroundColor Yellow -NoNewline;
    Write-Host $UserConfigPath -ForegroundColor White -NoNewline;
    Write-Host " to customize your settings." -ForegroundColor Yellow;
    
    Copy-Item $DefaultConfigPath $UserConfigPath;
    
    Write-Host "Close Notepad to continue..." -ForegroundColor Yellow;
    Start-Process Notepad.exe -ArgumentList $UserConfigPath -NoNewWindow -Wait;
}

if (FileExists $UserConfigPath) {
    Write-Host "Loading user config from $UserConfigPath" -ForegroundColor Cyan;
    & $UserConfigPath;
}

