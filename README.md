# ALCops for VS Code

A Visual Studio Code extension that integrates ALCops analyzers for the AL programming language in Microsoft Dynamics 365 Business Central.

## Requirements

- **Visual Studio Code**: Version 1.60.0 or later
- **AL Language Extension**: The official Microsoft AL Language extension for Business Central (version 12.0.875970 or later)

## Getting Started

1. Install the ALCops extension from the VS Code Marketplace
2. The extension will automatically download the ALCops analyzers on first use
3. Open an AL project in VS Code
4. Configure analyzer settings in your VS Code workspace settings as needed

## Extension Settings

This extension contributes the following settings:

* `alcops.automaticUpdates` (boolean): Automatically check for updates when VS Code starts. Updates follow the selected Version Channel. (default: `true`)
* `alcops.updateNotification` (string): How to handle available updates. Options: `auto-install`, `notify-only`, `manual`. (default: `notify-only`)
* `alcops.versionChannel` (string): Select which release versions to receive. Options: `stable`, `beta`, `alpha`. (default: `stable`)
* `alcops.checkUpdateInterval` (number): Hours between automatic update checks. Range: 1-720 hours. (default: `24`)

Configure these settings in your VS Code `settings.json`:

```json
{
  "alcops.automaticUpdates": true,
  "alcops.updateNotification": "notify-only",
  "alcops.versionChannel": "stable",
  "alcops.checkUpdateInterval": 24
}
```

## Known Issues

- First-time setup may take a few moments while analyzers are downloaded
- Some analyzer rules may require specific Business Central versions

Please report any issues on the [GitHub repository](https://github.com/Arthurvdv/vscodeext).

## How It Works

The ALCops extension simplifies analyzer management through an automated lifecycle:

1. **Activation**: When VS Code starts, the extension automatically activates and checks for existing ALCops analyzers in the AL Language extension's bin/Analyzers folder.

2. **Version Management**: The extension tracks the currently installed ALCops version and compares it against the available versions based on your selected version channel (stable, beta, or alpha).

3. **Background Monitoring**: Periodically checks for new updates at the interval you specify in `alcops.checkUpdateInterval` (default: 24 hours).

4. **Smart Updates**: Based on your `updateNotification` setting, the extension either:
   - Automatically downloads and installs updates (`auto-install`)
   - Notifies you when updates are available (`notify-only`)
   - Waits for your manual command to update (`manual`)

5. **Pending Installation Check**: The extension checks if there's a pending installation from a previous update. If found, it completes the installation and notifies you upon success.

6. **User Control**: You can manually check for updates or trigger installation at any time using the ALCops commands in the VS Code command palette.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests to improve the extension.

## License

This extension is licensed under the MIT License. See the LICENSE file for details.

## References

- [ALCops](https://alcops.dev/)
- [AL Language extension for Microsoft Dynamics 365 Business Central](https://marketplace.visualstudio.com/items?itemName=ms-dynamics-smb.al)
