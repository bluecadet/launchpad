---
title: "@bluecadet/launchpad-scaffold"
---

<script setup>
  import PackageHeader from '../../components/PackageHeader.vue'
</script>

<PackageHeader package="scaffold" />

The scaffold package is a specialized toolset for configuring Windows systems in exhibit and kiosk environments. It provides automated setup and optimization features to prepare Windows machines for reliable, long-term operation.

## Features

- **Windows Kiosk Setup**:
  - Automate Windows configuration for kiosk mode
  - Configure auto-login and startup applications
  - Disable unnecessary Windows features
  - Optimize interface for touch and kiosk usage

- **System Optimization**:
  - Power settings configuration
  - Windows Update management
  - Service optimization
  - Performance tuning
  - User interface customization

- **Security Controls**:
  - System policy management
  - Interface lockdown options

## Installation

```bash
npm install @bluecadet/launchpad-scaffold
```

## Basic Usage

```typescript
import { launchScaffold } from '@bluecadet/launchpad-scaffold';
import { LogManager } from '@bluecadet/launchpad-utils';

// instantiate the logger before starting the scaffold process
const logger = LogManager.getLogger('my-app');

// Launch the scaffold setup process
await launchScaffold(logger);
```

## System Requirements

- Windows 10 or Windows 11
- Administrative privileges
- PowerShell execution enabled
- Node.js 18 or higher

## Configuration

The scaffold package uses a combination of:

- PowerShell scripts for system configuration
- Batch files for process execution
- Node.js for orchestration
- Windows Registry modifications
- System policy updates

## Security Considerations

- Requires elevated privileges
- Modifies system settings
- Changes Windows configurations
- Alters user permissions

## Limitations

- Windows-only support
- Some features require specific Windows versions
- Certain settings may require additional manual configuration
- Windows 11 has limited support for some kiosk features

## Error Handling

- Provides detailed logs of all operations
- Fails gracefully with clear error messages
- Supports rollback of critical changes
- Includes diagnostic information for troubleshooting
