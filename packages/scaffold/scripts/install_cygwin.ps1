# Download and install cygwin

# See https://blog.jourdant.me/post/3-ways-to-download-files-with-powershell
Import-Module BitsTransfer
Start-BitsTransfer -Source http://cygwin.com/setup-x86_64.exe -Destination cygwin_setup.exe

# .\cygwin_setup.exe -nq -P librsync2,rsync,openssh,curl,wget,unzip | Out-Null # Out-Null causes PS to wait for exe to exit

Start-Process -FilePath ".\cygwin_setup.exe" -ArgumentList "--no-admin -nq -P librsync2,rsync,openssh,curl,wget,unzip" -Wait

Remove-Item cygwin_setup.exe
