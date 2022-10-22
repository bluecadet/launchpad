# Launchpad Scaffolding

The [`@bluecadet/launchpad-scaffold`](https://www.npmjs.com/package/@bluecadet/launchpad-scaffold) package is a collection of PS1 scripts to configure Windows PCs for exhibit environments.

## Features

- Fully configurable, with optional y/n prompts
- Disable notifications
- Disable Windows updates
- Disable Windows error reporting
- Disable sleep, set to max power
- Disable touch feedback and gestures (long press, cursor, edge-swipes, ...)
- Create daily app launch and restart tasks
- Install common apps via [chocolatey](https://chocolatey.org/) (vscode, github, ...)
- Uninstall bloatware like OneDrive
- Portable config (save to USB, run on multiple machines)
- ...and more

For all available scripts, check out [`scripts/windows`](./scripts/windows/).

## Setup

To run the scaffold scripts, you can call `npx launchpad scaffold`, or manually run [`packages/scaffold/setup.bat`](./setup.bat) _as administrator_.

1. On first run, you'll be prompted to edit your user config
1. Once you close the config editor, the script will continue
1. By default, all scripts must be confirmed with a y/n prompt
1. To automate execution of all scripts, set [`ConfirmAllScripts`](https://github.com/bluecadet/launchpad/blob/develop/packages/scaffold/config/defaults.ps1#L9) to `$false`
1. You can copy the generated user config from `packages/scaffold/config/user.ps1` to other PCs to apply the same settings

## Credit

Many scripts and settings are based on examples and precedents from various existing resources. Besides [https://stackoverflow.com/](), the following two repositories have been crucial references:
- https://github.com/jayharris/dotfiles-windows
- https://github.com/morphogencc/ofxWindowsSetup/tree/master/scripts
