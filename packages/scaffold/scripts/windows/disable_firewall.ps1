# See https://github.com/morphogencc/ofxWindowsSetup/blob/master/scripts/disable_firewall.ps1

# disable_firewall.ps1
# -------------------------
# Disables the Windows Firewall.

Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False