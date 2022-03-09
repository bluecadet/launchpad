if (!$global:LaunchpadConfig) { $global:LaunchpadConfig = @{} }
if (!$global:LaunchpadConfig.Computer) { $global:LaunchpadConfig.Computer = @{} }
if (!$global:LaunchpadConfig.InstallApps) { $global:LaunchpadConfig.InstallApps = @{} }
if (!$global:LaunchpadConfig.Windows) { $global:LaunchpadConfig.Windows = @{} }
if (!$global:LaunchpadConfig.Windows.Windows8) { $global:LaunchpadConfig.Windows.Windows8 = @{} }
if (!$global:LaunchpadConfig.Exhibit) { $global:LaunchpadConfig.Exhibit = @{} }

# Set this to false if you want to automatically run scripts without prompting.
$global:LaunchpadConfig.ConfirmAllScripts = $true;

# Computer config
$global:LaunchpadConfig.Computer.ComputerName = hostname										# Leave as hostname to use the current computer name
$global:LaunchpadConfig.Computer.WindowsUsername = [Environment]::UserName	# Leave as [Environment]::UserName to sue the current user name    
$global:LaunchpadConfig.Computer.WindowsPassword = ""
$global:LaunchpadConfig.Computer.PowerConfig = "$PSScriptRoot\presets\exhibit_power_config.pow"

# Install start up tasks to launch your app. Paths are relative to setup.bat
$global:LaunchpadConfig.Computer.TaskSchedulerPath = "\Exhibit"					# The path where startup scripts will be stored
$global:LaunchpadConfig.Computer.StartupWorkingDir = "$PSScriptRoot\..\..\..\..\..\"	# Working dir of the startup action
$global:LaunchpadConfig.Computer.StartupCreateBat = $true							# Create a bat file to launch at startup
$global:LaunchpadConfig.Computer.StartupBat = "launch.bat"						# The filename used for StartupCreateBat
$global:LaunchpadConfig.Computer.StartupBatContent = "npx launchpad"		# The contents of the startup bat file
$global:LaunchpadConfig.Computer.StartupAction = $global:LaunchpadConfig.Computer.StartupBat	# The action to run at startup
$global:LaunchpadConfig.Computer.StartupDelay = "PT3M"									#	PT3M = 3 min, PT4M = 4 min, ... (stands for poll time X minutes)
$global:LaunchpadConfig.Computer.Timezone = "Eastern Standard Time"
$global:LaunchpadConfig.Computer.RebootTime = "3:00"

# App installs
$global:LaunchpadConfig.InstallApps.Enabled = $true													# Install Chocolatey; Required for any of the below app packages
# $global:LaunchpadConfig.InstallApps.Apps = "nodejs", "python", "vscode", "github-desktop", "git", "cmake", "visualstudio2022community", "visualstudio2022-workload-nativedesktop", "microsoft-build-tools", "microsoft-visual-cpp-build-tools"
$global:LaunchpadConfig.InstallApps.Apps = "nodejs", "python", "vscode", "github-desktop", "git", "cmake", "visualstudio2022community", "visualstudio2022-workload-nativedesktop", "visualstudio2022buildtools"

$global:LaunchpadConfig.InstallApps.InstallNodeDependencies = $false				# Installs Launchpad dependencies

# Computer/User Settings
$global:LaunchpadConfig.Windows.SetComputerName = $true
$global:LaunchpadConfig.Windows.SetPowerSettings = $true
$global:LaunchpadConfig.Windows.EnableAutoLogin = $true
$global:LaunchpadConfig.Windows.SetTimzone = $false
$global:LaunchpadConfig.Windows.EnableDailyReboot = $false
$global:LaunchpadConfig.Windows.EnableStartupTask = $true

# Windows Settings
$global:LaunchpadConfig.Windows.ClearDesktopBackground = $true
$global:LaunchpadConfig.Windows.ClearDesktopShortcuts = $true
$global:LaunchpadConfig.Windows.ConfigureExplorer = $true
$global:LaunchpadConfig.Windows.DisableAccessibility = $true
$global:LaunchpadConfig.Windows.DisableAppInstalls = $true
$global:LaunchpadConfig.Windows.DisableAppRestore = $true
$global:LaunchpadConfig.Windows.DisableCortanaSearch = $true
$global:LaunchpadConfig.Windows.DisableEdgeSwipes = $true
$global:LaunchpadConfig.Windows.DisableErrorReporting = $true
$global:LaunchpadConfig.Windows.DisableFireWall = $false
$global:LaunchpadConfig.Windows.DisableMaxPathLength = $true
$global:LaunchpadConfig.Windows.DisableNewNetworkWindow = $true
$global:LaunchpadConfig.Windows.DisableNewsAndInterests = $true
$global:LaunchpadConfig.Windows.DisableNotifications = $true
$global:LaunchpadConfig.Windows.DisableScreensaver = $true
$global:LaunchpadConfig.Windows.DisableTouchFeedback = $true
$global:LaunchpadConfig.Windows.DisableUpdateCheck = $true
$global:LaunchpadConfig.Windows.DisableUpdateService = $true
$global:LaunchpadConfig.Windows.ResetTextScale = $true
$global:LaunchpadConfig.Windows.UninstallBloatware = $true
$global:LaunchpadConfig.Windows.UninstallOneDrive = $true
$global:LaunchpadConfig.Windows.UnpinStartMenuApps = $true

# Windows 8 Specific
$global:LaunchpadConfig.Windows.Windows8.DisableStartPage = $true
  