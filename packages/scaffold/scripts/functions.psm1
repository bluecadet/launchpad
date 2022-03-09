
function Assert(
        [ScriptBlock]$Assertion,
        [String]$Message = 'Validation',
        [ScriptBlock]$OnFail = {Quit(1)}
    ) {
    Write-Host $Message '... ' -NoNewline;
    if ($Assertion.Invoke() -eq $true) {
        Write-Host 'OK' -ForegroundColor Green;
    } else {
        Write-Host 'Failed' -ForegroundColor Red;
        $OnFail.Invoke();
    }
}

# See https://ss64.com/ps/syntax-elevate.html
function TestAdmin {
    return (([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
}

# See https://gist.github.com/mbrownnycnyc/9913361
function TestInternet() {
    [CmdletBinding()]
    Param(
        [String]$TargetHost = 'google.com',
        [int]$TargetTimeout = 3000
    )
    try {
        $Ping = New-Object System.Net.NetworkInformation.Ping;
        return !($Ping.send($TargetHost, $TargetTimeout).status -ne 'Success');
    } catch {
        return $false;
    }
}

# Elevates the current prompt to an admin prompt.
# See https://stackoverflow.com/a/27872686/782899 for this implementation.
# Tricky thing is to get the script name and args from within a function.
function ElevateToAdmin() {
    Write-Host 'Elevating to new admin prompt' -ForegroundColor Blue;
    RunAsAdmin $script:MyInvocation.MyCommand.Path;
    Write-Host 'Exiting old prompt' -ForegroundColor Magenta;
    Exit;
}

# Runs any script as admin.
# See https://stackoverflow.com/a/27872686/782899 for this implementation.
# Tricky thing is to get the script name and args from within a function.
function RunAsAdmin($scriptToRun) {
    try {
        Write-Host 'Running ' -NoNewline; Write-Host "'$scriptToRun'" -ForegroundColor Blue; Write-Host ' with  admin privileges';
        $elevatedPsi = New-Object System.Diagnostics.ProcessStartInfo "PowerShell";
        $elevatedPsi.Arguments = "& '" + $scriptToRun + "'" ;
        $elevatedPsi.Verb = "RunAs";
        $elevatedProcess = [System.Diagnostics.Process]::Start($elevatedPsi);
        $elevatedProcess.WaitForExit();
    } catch {
        $Error[0] # Dump details about the last error
        Pause;
        Exit 1;
    }
}

function Confirm(
        [String]$Message = 'Are you sure?',
        [ScriptBlock]$OnSuccess = {},
        [ScriptBlock]$OnFail = {}
    ) {
    Write-Host $Message -ForegroundColor Yellow -NoNewline;
    Write-Host " (y/n) " -ForegroundColor Magenta -NoNewline;
    $response = Read-Host;
    if ($response -match "[yY]") {
        $OnSuccess.Invoke();
    } else {
        $OnFail.Invoke();
    }
}

function Quit($code = 0) {
    [Environment]::Exit($code);
}

function FileExists($path) {
    Test-Path $path -PathType Leaf
}

function RunScript(
    [String]$scriptToRun,
    [String]$confirmationMessage = '',
    [Boolean]$confirmationEnabled = $global:LaunchpadConfig.ConfirmAllScripts
    ) {
    if ($confirmationMessage -ne '' -AND $confirmationEnabled -eq $true) {
        Confirm $confirmationMessage {
            # Confirmed
            RunScript $scriptToRun
        } {
            # Declined
            Write-Host "Skipping $scriptToRun" -ForegroundColor Yellow
        };
    } elseif (FileExists $scriptToRun) {
        # Run w/o confirming
        Write-Host "Running script $scriptToRun" -ForegroundColor Cyan
        Invoke-Expression "&'$scriptToRun'"
    } else {
        # Script not found
        Write-Host ("Could not find script at '$scriptToRun'") -ForegroundColor Red;
    }
}

function Pause(
        [String]$Message = '',
        [String]$MessageColor = 'Blue',
        [String]$Continue = 'Press any key to continue...',
        [String]$ContinueColor = 'White'
    ) {
    Write-Host $Message -ForegroundColor $MessageColor;
    Write-Host $Continue -ForegroundColor $ContinueColor;
    [void][System.Console]::ReadKey($true);
}
