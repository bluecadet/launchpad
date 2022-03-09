# See https://github.com/W4RH4WK/Debloat-Windows-10/blob/master/scripts/remove-default-apps.ps1

#   Description:
# This script removes unwanted Apps that come with Windows. If you  do not want
# to remove certain Apps comment out the corresponding lines below.

# You can get a list of all apps on your system by running "Get-AppxPackage -AllUsers | ft Name, PackageFullName -AutoSize"

Import-Module -DisableNameChecking $PSScriptRoot/../vendor/take-own.psm1
Import-Module -DisableNameChecking $PSScriptRoot/../vendor/force-mkdir.psm1

Write-Host "Elevating privileges for this process" -ForegroundColor Yellow
do {} until (Elevate-Privileges SeTakeOwnershipPrivilege)

Write-Output "Uninstalling bloatware"
$apps = @(
    # default Windows 10 apps
    "Microsoft.3DBuilder"
    "Microsoft.Advertising.Xaml" 
    "Microsoft.Appconnector"
    "Microsoft.BingFinance"
    "Microsoft.BingNews"
    "Microsoft.BingSports"
    "Microsoft.BingTranslator"
    "Microsoft.BingWeather"
    "Microsoft.Microsoft3DViewer"
    "Microsoft.MicrosoftOfficeHub"
    "Microsoft.MicrosoftPowerBIForWindows"
    "Microsoft.MicrosoftSolitaireCollection"
    "Microsoft.MinecraftUWP"
    "Microsoft.NetworkSpeedTest"
    "Microsoft.Office.OneNote"
    "Microsoft.People"
    "Microsoft.Print3D"
    "Microsoft.SkypeApp"
    "Microsoft.Wallet"
    "Microsoft.WindowsAlarms"
    "Microsoft.WindowsCamera"
    "microsoft.windowscommunicationsapps"
    "Microsoft.WindowsMaps"
    "Microsoft.WindowsPhone"
    "Microsoft.WindowsSoundRecorder"
    # "Microsoft.Xbox.TCUI"
    # "Microsoft.XboxApp"
    # "Microsoft.XboxGameOverlay"
    # "Microsoft.XboxGamingOverlay"
    # "Microsoft.XboxSpeechToTextOverlay"
    "Microsoft.ZuneMusic"
    "Microsoft.ZuneVideo"
    #"Microsoft.FreshPaint"
    #"Microsoft.MicrosoftStickyNotes"
    #"Microsoft.OneConnect"
    #"Microsoft.Windows.Photos"
    #"Microsoft.WindowsCalculator"
    #"Microsoft.WindowsStore"

    # Threshold 2 apps
    "Microsoft.CommsPhone"
    "Microsoft.ConnectivityStore"
    "Microsoft.GetHelp"
    "Microsoft.Getstarted"
    "Microsoft.Messaging"
    "Microsoft.Office.Sway"
    "Microsoft.WindowsFeedbackHub"
    
    # Other apps
    "Microsoft.Advertising.Xaml"
    "Microsoft.BingNews"
    "Microsoft.MicrosoftStickyNotes"
    "Microsoft.OfficeLens"
    "Microsoft.OneConnect"
    "Microsoft.Todos"
    "Microsoft.Whiteboard"

    # Creators Update apps
    "Microsoft.Microsoft3DViewer"
    #"Microsoft.MSPaint"

    # Redstone apps
    "Microsoft.BingFoodAndDrink"
    "Microsoft.BingHealthAndFitness"
    "Microsoft.BingTravel"
    "Microsoft.WindowsReadingList"

    # Redstone 5 apps
    "Microsoft.MixedReality.Portal"
    "Microsoft.ScreenSketch"
    "Microsoft.XboxGamingOverlay"
    "Microsoft.YourPhone"

    # non-Microsoft
    "*Advertising*"
    "*BingTranslator*"
    "*BingWeather*"
    "*Duolingo*"
    "*EclipseManager*"
    "*feedbackhub*"
    "*Flipboard*"
    "*FreshPaint*"
    "*Microsoft.NetworkSpeedTest*"
    "*PicsArt*"
    "*windowscommunicationsapps*"
    "*Wunderlist*"
    "*ZuneMusic*"
    "2FE3CB00.PicsArt-PhotoStudio"
    "46928bounde.EclipseManager"
    "4DF9E0F8.Netflix"
    "613EBCEA.PolarrPhotoEditorAcademicEdition"
    "6Wunderkinder.Wunderlist"
    "7EE7776C.LinkedInforWindows"
    "89006A2E.AutodeskSketchBook"
    "9E2F88E3.Twitter"
    "A278AB0D.DisneyMagicKingdoms"
    "A278AB0D.MarchofEmpires"
    "ActiproSoftwareLLC.562882FEEB491" # next one is for the Code Writer from Actipro Software LLC
    "AdobeSystemsIncorporated.AdobePhotoshopExpress"
    "CAF9E577.Plex"  
    "ClearChannelRadioDigital.iHeartRadio"
    "D52A8D61.FarmVille2CountryEscape"
    "D5EA27B7.Duolingo-LearnLanguagesforFree"
    "DB6EA5DB.CyberLinkMediaSuiteEssentials"
    "DolbyLaboratories.DolbyAccess"
    "DolbyLaboratories.DolbyAccess"
    "Drawboard.DrawboardPDF"
    "Facebook.Facebook"
    "Fitbit.FitbitCoach"
    "flaregamesGmbH.RoyalRevolt2"
    "Flipboard.Flipboard"
    "GAMELOFTSA.Asphalt8Airborne"
    "KeeperSecurityInc.Keeper"
    "king.com.*"
    "king.com.BubbleWitch3Saga"
    "king.com.CandyCrushSaga"
    "king.com.CandyCrushSodaSaga"
    "NORDCURRENT.COOKINGFEVER"
    "PandoraMediaInc.29680B314EFC2"
    "Playtika.CaesarsSlotsFreeCasino"
    "ShazamEntertainmentLtd.Shazam"
    "SpotifyAB.SpotifyMusic"
    "ThumbmunkeysLtd.PhototasticCollage"
    "TuneIn.TuneInRadio"
    "WinZipComputing.WinZipUniversal"
    "XINGAG.XING"
    "TheNewYorkTimes.NYTCrossword"

    # apps which cannot be removed using Remove-AppxPackage
    # "Microsoft.BioEnrollment"
    #"Microsoft.MicrosoftEdge"
    # "Microsoft.Windows.Cortana"
    "Microsoft.WindowsFeedback"
    # "Microsoft.XboxGameCallableUI"
    # "Microsoft.XboxIdentityProvider"
    "Windows.ContactSupport"
)

foreach ($app in $apps) {
    # Write-Host "Trying to uninstall $app"
    $found = $false;
    $failed = $false;

    try {
        if (Get-AppxPackage -Name $app) {
            Get-AppxPackage -Name $app -AllUsers | Remove-AppxPackage -AllUsers;
            Write-Host "Uninstalled app package '$app'" -ForegroundColor Green;
            $found = $true;
        }
    } catch {
        Write-Host "Could not uninstall $app" -ForegroundColor Yellow
        Write-Host ("    " + $_.Exception.Message) -ForegroundColor Yellow;
        $failed = $true;
    }

    try {
        if (Get-AppXProvisionedPackage -Online | Where-Object DisplayName -EQ $app) {
            Get-AppXProvisionedPackage -Online | Where-Object DisplayName -EQ $app | Remove-AppxProvisionedPackage -Online | Out-Null;
            Write-Host "Uninstalled app provision package '$app'" -ForegroundColor Green;
            $found = $true;
        }
    } catch {
        Write-Host "Could not uninstall $app" -ForegroundColor Yellow
        Write-Host ("    " + $_.Exception.Message) -ForegroundColor Yellow;
        $failed = $true;
    }

    if (!$found -AND !$failed) {
        # Write-Host "$app was already uninstalled" -ForegroundColor Green
    }
}

