if ((Get-ComputerInfo | Select-Object -expand OsName) -match 11) {
    # Windows 11
    Write-Host "Unpinning start menu apps is not supported on Windows 11"
    
} else {
    # Windows 10

    # See https://appuals.com/pin-unpin-application-windows-10/
    function Pin-App { param(
        [string]$appname,
        [switch]$unpin
        )
        try{
            if ($unpin.IsPresent){
                ((New-Object -Com Shell.Application).NameSpace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}').Items() | ?{$_.Name -like $appname}).Verbs() | ?{$_.Name.replace('&','') -match 'From "Start" UnPin|Unpin from Start'} | %{$_.DoIt()}
                return "App '$appname' unpinned from Start"
            } else {
                ((New-Object -Com Shell.Application).NameSpace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}').Items() | ?{$_.Name -like $appname}).Verbs() | ?{$_.Name.replace('&','') -match 'To "Start" Pin|Pin to Start'} | %{$_.DoIt()}
                return "App '$appname' pinned to Start"
            }
        }catch{
            Write-Error "Error Pinning/Unpinning App! (App-Name correct?)"
        }
    }

}
