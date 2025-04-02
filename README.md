# Simulo VSCode Extension

This just lets you make launch configuration with Simulo `0.13+`.

You can put something like this in a `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "simulo",
            "request": "launch",
            "name": "Run Active File (Simulo)",
            "program": "${file}",
            "focus": true
        }
    ]
}
```

Now you can use F5 while on a Lua file, and it'll run it if the game is open, and it'll focus the game.

You can make your own custom configurations, like having several to run specific Lua files (instead of the focused one). For example:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "simulo",
            "request": "launch",
            "name": "Run My Code",
            "program": "./scripts/my_code/main.lua",
            "focus": false
        },
        {
            "type": "simulo",
            "request": "launch",
            "name": "Run Active File (Simulo)",
            "program": "${file}"
        }
    ]
}
```

## Installation

Just go on the GitHub Releases and grab the `.vsix` and then go Extensions in vscode and click tripledot and `Install from VSIX` and use that
