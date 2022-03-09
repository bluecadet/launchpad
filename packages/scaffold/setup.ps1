# More scripts available at:
# https://github.com/jayharris/dotfiles-windows
# https://github.com/morphogencc/ofxWindowsSetup

# Set current working directory
Push-Location $PSScriptRoot;
[Environment]::CurrentDirectory = $PWD;

# Import vendor functions
Import-Module -DisableNameChecking ./scripts/vendor/take-own.psm1
Import-Module -DisableNameChecking ./scripts/vendor/force-mkdir.psm1

# Import functions
Import-Module -DisableNameChecking ./scripts/functions.psm1;

# Load config
Write-Host 'Loading config...';
./scripts/load_config.ps1

# Check for internet connection
Write-Host 'Checking environment...';

# Elevate prompt
# Assert {TestAdmin} 'Checking for admin privileges' {ElevateToAdmin};
Assert {TestAdmin} 'Checking for admin privileges' {Pause 'Please re-run this script as admin.' Red; Exit};
Assert {TestInternet} 'Checking for internet' {Pause 'Please ensure you have internet access.' Red; Exit};

Write-Host 'Beginning scaffold...';

# Computer Name
if ($LaunchpadConfig.Windows.SetComputerName) {
    $hostname = hostname;

    # Computer renaming requires restart
    if ($LaunchpadConfig.Computer.ComputerName -ne $hostname) {
        Confirm "Do you want to rename your computer to $?" {
            # Rename
            RunScript ./scripts/windows/set_computer_name.ps1
            Confirm "Restart your computer now? Otherwise any following scripts may fail." {
                Restart-Computer; [Environment]::Exit(1);
            } {
                Write-Host "Skipping restart. Make sure all scripts finish successfully." -ForegroundColor Red
            }
        } {
            # Skip
            Write-Host "Computer rename skipped."
        }
    }
}

# App Installs
if ($LaunchpadConfig.InstallApps.Enabled) {
    $global:InstallApps = $true;

    if ($LaunchpadConfig.ConfirmAllScripts -eq $true) {
        Confirm 'Do you want to install any apps?' {
            $global:InstallApps = $true;
        } {
            $global:InstallApps = $false;
        }
    }

    if ($global:InstallApps) {
        Write-Host "Installing chocolatey...";
        RunScript ./scripts/install_choco.ps1;
        refreshenv
        
        Write-Host "Installing apps...";
        choco install $global:LaunchpadConfig.InstallApps.Apps -y
        
        if ($LaunchpadConfig.InstallApps.InstallNodeDependencies) {
            RunScript ./scripts/install_node_dependencies.ps1 'Install NodeJS dependencies for Launchpad?'
        }
        
    } else {
        Write-Host 'Not installing any apps...';
    }
}

# Production Env Setup
if ($LaunchpadConfig.Windows.EnableDailyReboot) { RunScript ./scripts/windows/enable_daily_reboot.ps1 ("Enable daily reboot at " + $LaunchpadConfig.Computer.RebootTime + "?") }
if ($LaunchpadConfig.Windows.EnableStartupTask) { RunScript ./scripts/windows/enable_startup_task.ps1 "Enable startup task?" }
if ($LaunchpadConfig.Windows.SetPowerSettings) { RunScript ./scripts/windows/set_power_settings.ps1 "Configure power settings?" }

# Windows Config
if ($LaunchpadConfig.Windows.EnableAutoLogin) { RunScript ./scripts/windows/enable_auto_login.ps1 ("Enable automatic login for " + $LaunchpadConfig.Computer.WindowsUsername + "?") }
if ($LaunchpadConfig.Windows.ClearDesktopBackground) { RunScript ./scripts/windows/clear_desktop_background.ps1 "Clear your desktop background to black?" }
if ($LaunchpadConfig.Windows.ClearDesktopShortcuts) { RunScript ./scripts/windows/clear_desktop_shortcuts.ps1 "Clear your desktop icons?" }
if ($LaunchpadConfig.Windows.ConfigureExplorer) { RunScript ./scripts/windows/config_explorer.ps1 "Configure explorer defaults (e.g. show hidden files and extensions)?" }
if ($LaunchpadConfig.Windows.DisableAccessibility) { RunScript ./scripts/windows/disable_accessibility.ps1 "Disable accessibility shortcuts?" }
if ($LaunchpadConfig.Windows.DisableCortanaSearch) { RunScript ./scripts/windows/disable_cortana_search.ps1 "Disable Cortana search?" }
if ($LaunchpadConfig.Windows.DisableEdgeSwipes) { RunScript ./scripts/windows/disable_edge_swipes.ps1 "Disable edge gestures?" }
if ($LaunchpadConfig.Windows.DisableErrorReporting) { RunScript ./scripts/windows/disable_error_reporting.ps1 "Disable error reporting?" }
if ($LaunchpadConfig.Windows.DisableFireWall) { RunScript ./scripts/windows/disable_firewall.ps1 "Disable firewall?" }
if ($LaunchpadConfig.Windows.DisableMaxPathLength) { RunScript ./scripts/windows/disable_max_path_length.ps1 "Disable 260 char path length limit?" }
if ($LaunchpadConfig.Windows.DisableNewNetworkWindow) { RunScript ./scripts/windows/disable_new_network_window.ps1 "Disable New Network Window?" }
if ($LaunchpadConfig.Windows.DisableNewsAndInterests) { RunScript ./scripts/windows/disable_news_and_interests.ps1 "Disable News and Interests toolbar?" }
if ($LaunchpadConfig.Windows.DisableNotifications) { RunScript ./scripts/windows/disable_notifications.ps1 "Disable notifications?" }
if ($LaunchpadConfig.Windows.DisableScreensaver) { RunScript ./scripts/windows/disable_screensaver.ps1 "Disable screensaver?" }
if ($LaunchpadConfig.Windows.DisableTouchFeedback) { RunScript ./scripts/windows/disable_touch_feedback.ps1 "Disable touch feedback and gestures?" }
if ($LaunchpadConfig.Windows.DisableUpdateCheck) { RunScript ./scripts/windows/disable_update_check.ps1 "Disable update checks?" }
if ($LaunchpadConfig.Windows.DisableUpdateService) { RunScript ./scripts/windows/disable_update_service.ps1 "Disable update service?" }
if ($LaunchpadConfig.Windows.DisableAppInstalls) { RunScript ./scripts/windows/disable_app_installs.ps1 "Disable automatic Windows app installs?" }
if ($LaunchpadConfig.Windows.DisableAppRestore) { RunScript ./scripts/windows/disable_app_restore.ps1 "Disable app restoration on boot up?" }
if ($LaunchpadConfig.Windows.ResetTextScale) { RunScript ./scripts/windows/reset_text_scale.ps1 "Reset text scale to 100%?" }
if ($LaunchpadConfig.Windows.SetTimzone) { RunScript ./scripts/windows/set_timezone.ps1 ("Set current timezone to " + $LaunchpadConfig.Computer.Timezone + "?") }
if ($LaunchpadConfig.Windows.UninstallBloatware) { RunScript ./scripts/windows/uninstall_bloatware.ps1 "Uninstall bloatware?" }
if ($LaunchpadConfig.Windows.UninstallOneDrive) { RunScript ./scripts/windows/uninstall_one_drive.ps1 "Uninstall OneDrive?" }
if ($LaunchpadConfig.Windows.UnpinStartMenuApps) { RunScript ./scripts/windows/unpin_start_menu_apps.ps1 "Unpin start menu apps?" }

if ($LaunchpadConfig.Windows.Windows8.DisableStartPage) { RunScript ./scripts/windows/win8_config_startpage.ps1 "Disable Windows 8 start page?" }

Write-Host 'Relaunching explorer...'
# Stop-Process -ProcessName explorer

# Clean up
#./vendor/scripts/remove-default-apps.ps1

# Restore current working directory
Pop-Location;
[Environment]::CurrentDirectory = $PWD;

Write-Host 'Setup completed.' -ForegroundColor Green;

Write-Host "You should restart your computer for changes to fully take effect." -ForegroundColor Magenta;

Confirm "Restart this computer now?" {
    $restartDelay = 5;
    Write-Host "Restarting this computer in $restartDelay seconds..." -ForegroundColor Green;
    Start-Sleep -s $restartDelay;
    Restart-Computer;
} {
    Write-Host 'Not restarting this computer.' -ForegroundColor Magenta;
    Write-Host 'Close this window or press any key to continue...' -ForegroundColor Green;
    [void][System.Console]::ReadKey($true);
}
