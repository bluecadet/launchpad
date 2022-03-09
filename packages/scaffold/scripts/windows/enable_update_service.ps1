# See https://4sysops.com/archives/turn-off-automatic-updates-in-windows-10-build-9926/
set-service wuauserv –startup manual
start-service wuauserv

# Print service status
get-wmiobject win32_service –filter "name='wuauserv'"