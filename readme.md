# Folder Selector VS Code Extension

This extension adds a powerful command that lets you quickly find and navigate to any folder in your workspace. As you type, it shows matching folders in real-time, making it easy to find deeply nested directories.

## Features

- **Live search** - See matching folders as you type
- **Fuzzy matching** - Find folders by name or path fragment (e.g. `test-mcap`, `my-folder-1`, or `backend/api`)
- **Recursive scanning** - Searches all folders in your workspace, no matter how deeply nested
- **Instant navigation** - Selected folder is immediately revealed in the Explorer view

## Development

1. Install dependencies:
   ```bash
   npm install
   ```
   > If you are working in an offline environment you can install dependencies on a machine with internet access and copy the resulting `node_modules` directory into this project.
2. Compile the extension:
   ```bash
   npm run compile
   ```
3. Press `F5` in VS Code (or `Run → Start Debugging`) to launch a new Extension Development Host for live testing.

## Testing the Extension

### Development Mode Testing

1. **Start the Extension Development Host:**

   - Press `F5` in VS Code/Cursor (or go to `Run → Start Debugging`)
   - A new window will open with the extension loaded (look for the colored bar at the bottom)

2. **Open a test workspace:**

   - In the new Extension Development Host window, open a folder: `File → Open Folder...`
   - For example, open the `testing-folders` directory in this project

3. **Run the extension command:**

   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type: `Folder Selector: Select Folder by Name`
   - Start typing a folder name to see matching results
   - Select a folder from the list to reveal it in the Explorer

4. **Live development:**
   - Optionally run `npm run watch` to auto-compile on file changes
   - After making code changes, reload the extension: `Cmd+Shift+F5` (or `Ctrl+Shift+F5`)

### Debugging

- Set breakpoints in `src/extension.ts` by clicking left of line numbers
- Use the Debug Console in the original window to see console output
- The extension will pause at breakpoints when you run the command

## Packaging & Local Installation (VS Code / Cursor IDE)

1. Ensure the project is compiled (`npm run compile`).
2. Package the extension into a VSIX file using [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce):
   ```bash
   npx @vscode/vsce package
   ```
   This command produces a file like `folder-selector-0.0.1.vsix` in the project root.
3. Open your VS Code or Cursor IDE instance.
4. From the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run **Extensions: Install from VSIX...**.
5. Select the generated `.vsix` file and follow the prompts to install it.
6. Reload the editor when prompted.

## Using the Extension

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **Folder Selector: Select Folder by Name**.
2. A quick pick menu appears showing available folders.
3. Start typing to filter folders in real-time (e.g., `test-mcap`, `my-folder-1`).
4. Use arrow keys to navigate and press `Enter` to select a folder.
5. The selected folder is automatically revealed in the Explorer view.

## Configuration

The extension can be customized through VS Code settings. Open your settings (`Cmd+,` / `Ctrl+,`) and search for "Folder Selector" or edit `settings.json`:

### `folderSelector.ignoredFolders`

List of folder names to ignore during scanning. By default includes common build and dependency directories.

**Default:**

```json
{
  "folderSelector.ignoredFolders": [
    "node_modules",
    ".git",
    ".vscode",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    "target",
    "bin",
    "obj",
    "vendor",
    "__pycache__",
    ".pytest_cache",
    "venv",
    ".venv",
    ".cursor",
    ".github",
    ".husky"
  ]
}
```

**Example - Add custom folders to ignore:**

```json
{
  "folderSelector.ignoredFolders": ["node_modules", ".git", "coverage", "logs", "temp", ".cache"]
}
```

### `folderSelector.maxDepth`

Maximum depth to search for folders. Lower values improve performance in large projects.

- **Default:** `5`
- **Range:** `1` to `20`

**Example:**

```json
{
  "folderSelector.maxDepth": 8
}
```

### `folderSelector.maxFolders`

Maximum number of folders to scan. Prevents memory issues in very large workspaces.

- **Default:** `10000`
- **Range:** `100` to `50000`

**Example:**

```json
{
  "folderSelector.maxFolders": 5000
}
```

### `folderSelector.ignoreDotFolders`

Automatically ignore all folders that start with a dot (hidden folders). This is useful for skipping configuration folders like `.git`, `.vscode`, `.config`, etc.

- **Default:** `true`
- **Type:** `boolean`

**Example:**

```json
{
  "folderSelector.ignoreDotFolders": false
}
```

> **Note:** When `ignoreDotFolders` is `true`, folders starting with a dot will be ignored even if they're not in the `ignoredFolders` list. Set to `false` if you want to include dot folders in your search results.

## Troubleshooting

### No folders found

Confirm that the folder name is spelled correctly and exists somewhere inside the currently opened workspace. Check that it's not excluded by:

- `folderSelector.ignoredFolders` list
- `folderSelector.ignoreDotFolders` setting (if the folder starts with a dot)
- Beyond the `folderSelector.maxDepth` limit

### Command missing

Make sure the extension is activated by executing the command from the command palette. If it still does not appear, reload the editor and check that the extension is enabled in the Extensions view.

### Slow performance or scanning takes too long

For large projects, try these settings:

- Reduce `folderSelector.maxDepth` (try `3` or `4`)
- Add more folders to `folderSelector.ignoredFolders` (e.g., `coverage`, `logs`, `temp`)
- Reduce `folderSelector.maxFolders` if you have a massive workspace

### Folders are missing from results

- Check if they're in the `folderSelector.ignoredFolders` list
- Check if `folderSelector.ignoreDotFolders` is hiding dot folders
- Increase `folderSelector.maxDepth` if they're deeply nested
- Increase `folderSelector.maxFolders` if the limit was reached

## License

This project is provided as-is under the MIT License.
