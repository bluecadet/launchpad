# Launchpad Scaffolding

The [`@bluecadet/launchpad-scaffold`](packages/scaffold) package is a collection of PS1 scripts to configure Windows PCs for exhibit environments.

To run the scaffold scripts, you can call `launchpad scaffold`, or manually run [`packages/scaffold/setup.bat`](packages/scaffold/setup.bat) _as administrator_.

- On first run, you'll be prompted to edit your user config
- Once you close the config editor, the script will continue
- By default, all scripts must be confirmed with a y/n prompt
- To automate execution of all scripts, set [`ConfirmAllScripts`](https://github.com/bluecadet/launchpad/blob/develop/packages/scaffold/config/defaults.ps1#L9) to `$false`
- You can copy the generated user config from `packages/scaffold/config/user.ps1` to other PCs to apply the same settings

# Credits
Most scripts and settings are based on examples and precedents from various existing resources. Besides StackOverflow, the following two repositories have been crucial references:
- https://github.com/jayharris/dotfiles-windows
- https://github.com/morphogencc/ofxWindowsSetup/tree/master/scripts