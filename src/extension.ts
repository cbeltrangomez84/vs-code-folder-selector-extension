import * as vscode from "vscode"

interface FolderItem extends vscode.QuickPickItem {
  uri: vscode.Uri
}

interface QueueItem {
  uri: vscode.Uri
  depth: number
}

interface ScanOptions {
  maxFolders: number
  maxDepth: number
  ignoredFolders: string[]
  ignoreDotFolders: boolean
}

function getConfiguration(): ScanOptions {
  const config = vscode.workspace.getConfiguration("folderSelector")
  return {
    maxFolders: config.get<number>("maxFolders", 10000),
    maxDepth: config.get<number>("maxDepth", 5),
    ignoredFolders: config.get<string[]>("ignoredFolders", ["node_modules", ".git", ".vscode", "dist", "build", "out", ".cursor", ".github", ".husky"]),
    ignoreDotFolders: config.get<boolean>("ignoreDotFolders", true),
  }
}

async function getAllFolders(progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken, options: ScanOptions): Promise<vscode.Uri[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders) {
    return []
  }

  const allFolders: vscode.Uri[] = []
  const queue: QueueItem[] = []
  const visited = new Set<string>() // Prevent infinite loops from symlinks
  const ignoredSet = new Set(options.ignoredFolders)

  // Start with all workspace folders at depth 0
  for (const workspaceFolder of workspaceFolders) {
    queue.push({ uri: workspaceFolder.uri, depth: 0 })
    visited.add(workspaceFolder.uri.fsPath)
  }

  let processedCount = 0

  // BFS traversal to collect all folders
  while (queue.length > 0 && allFolders.length < options.maxFolders) {
    // Check for cancellation
    if (token.isCancellationRequested) {
      break
    }

    const { uri: currentUri, depth } = queue.shift()!
    allFolders.push(currentUri)

    // Update progress every 50 folders
    if (++processedCount % 50 === 0) {
      progress.report({
        message: `Found ${allFolders.length} folders (depth ${depth})...`,
      })
    }

    // Don't go deeper than maxDepth
    if (depth >= options.maxDepth) {
      continue
    }

    try {
      const entries = await vscode.workspace.fs.readDirectory(currentUri)

      for (const [name, fileType] of entries) {
        if (fileType === vscode.FileType.Directory) {
          // Skip folders in the ignored list
          if (ignoredSet.has(name)) {
            continue
          }

          // Skip folders that start with a dot if ignoreDotFolders is enabled
          if (options.ignoreDotFolders && name.startsWith(".")) {
            continue
          }

          const childUri = vscode.Uri.joinPath(currentUri, name)
          const childPath = childUri.fsPath

          // Avoid revisiting the same folder (handles symlinks)
          if (!visited.has(childPath)) {
            visited.add(childPath)
            queue.push({ uri: childUri, depth: depth + 1 })
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read (permissions, etc.)
      // Don't log to avoid spam in large folders
    }
  }

  if (allFolders.length >= options.maxFolders) {
    progress.report({
      message: `Reached limit of ${options.maxFolders} folders`,
    })
  }

  return allFolders
}

function filterFolders(folders: vscode.Uri[], query: string): FolderItem[] {
  if (!query.trim()) {
    // Show all folders if no query
    return folders.map((uri) => ({
      label: vscode.workspace.asRelativePath(uri, false),
      description: uri.fsPath,
      uri,
    }))
  }

  const queryLower = query.toLowerCase()
  const querySegments = query
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase())

  const matches: FolderItem[] = []

  for (const uri of folders) {
    const relativePath = vscode.workspace.asRelativePath(uri, false)
    const pathLower = relativePath.toLowerCase()

    // Check if the query matches the folder name or path
    const folderName = relativePath.split(/[\\/]+/).pop() || ""
    const folderNameLower = folderName.toLowerCase()

    // Match if:
    // 1. Folder name contains the query
    // 2. Full path contains the query
    // 3. Path segments match query segments in order
    if (folderNameLower.includes(queryLower) || pathLower.includes(queryLower)) {
      matches.push({
        label: relativePath,
        description: uri.fsPath,
        uri,
      })
    } else if (querySegments.length > 1) {
      // Try matching path segments
      const pathSegments = relativePath.split(/[\\/]+/).map((s) => s.toLowerCase())
      let segmentMatchIndex = 0

      for (const pathSegment of pathSegments) {
        if (pathSegment.includes(querySegments[segmentMatchIndex])) {
          segmentMatchIndex++
          if (segmentMatchIndex >= querySegments.length) {
            matches.push({
              label: relativePath,
              description: uri.fsPath,
              uri,
            })
            break
          }
        }
      }
    }
  }

  return matches
}

async function revealFolder(folder: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand("revealInExplorer", folder)
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const disposable = vscode.commands.registerCommand("folder-selector.selectFolder", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) {
      void vscode.window.showErrorMessage("Open a workspace folder to use Folder Selector.")
      return
    }

    // Get configuration settings
    const options = getConfiguration()

    let allFolders: vscode.Uri[] = []

    // Show a loading message while scanning
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Folder Selector",
          cancellable: true,
        },
        async (progress, token) => {
          progress.report({ message: `Scanning (max depth: ${options.maxDepth})...` })
          allFolders = await getAllFolders(progress, token, options)
          progress.report({ message: `Found ${allFolders.length} folders` })
        }
      )
    } catch (error) {
      void vscode.window.showErrorMessage(`Error scanning folders: ${error}`)
      return
    }

    if (allFolders.length === 0) {
      void vscode.window.showInformationMessage("No folders found in workspace.")
      return
    }

    // Create a QuickPick with live filtering
    const quickPick = vscode.window.createQuickPick<FolderItem>()
    quickPick.placeholder = "Type to filter folders (e.g., test-mcap, my-folder-1)"
    quickPick.matchOnDescription = true
    quickPick.matchOnDetail = false

    // Initially show all folders (or a reasonable subset)
    const initialItems = allFolders.slice(0, 100).map((uri) => ({
      label: vscode.workspace.asRelativePath(uri, false),
      description: uri.fsPath,
      uri,
    }))
    quickPick.items = initialItems

    // Update items as the user types
    quickPick.onDidChangeValue((query) => {
      if (query.trim()) {
        const filtered = filterFolders(allFolders, query)
        quickPick.items = filtered.slice(0, 100) // Limit to 100 results for performance
      } else {
        quickPick.items = initialItems
      }
    })

    // Handle selection
    quickPick.onDidAccept(() => {
      const selectedItem = quickPick.selectedItems[0]
      if (selectedItem) {
        revealFolder(selectedItem.uri)
        quickPick.hide()
      }
    })

    quickPick.onDidHide(() => {
      quickPick.dispose()
    })

    quickPick.show()
  })

  context.subscriptions.push(disposable)
}

export function deactivate(): void {
  // no-op
}
