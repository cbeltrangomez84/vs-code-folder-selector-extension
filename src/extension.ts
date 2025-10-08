import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"

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

interface CachedFolder {
  uri: string
  relativePath: string
  folderName: string
  workspaceRoot: string
  lastModified: number
}

interface FolderCache {
  folders: CachedFolder[]
  lastScan: number
  workspaceRoots: string[]
  version: string
}

class FolderCacheManager {
  private static readonly CACHE_VERSION = "1.0"
  private static readonly CACHE_KEY = "folderSelector.cache"
  private static readonly CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

  private cache: FolderCache | null = null
  private watchers: vscode.FileSystemWatcher[] = []
  private isScanning = false

  constructor(private context: vscode.ExtensionContext) {}

  async getFolders(options: ScanOptions): Promise<vscode.Uri[]> {
    // Check if we need to rebuild cache
    if (this.shouldRebuildCache(options)) {
      await this.rebuildCache(options)
    }

    if (!this.cache) {
      return []
    }

    return this.cache.folders.map((f) => vscode.Uri.file(f.uri))
  }

  private shouldRebuildCache(options: ScanOptions): boolean {
    if (!this.cache || this.isScanning) {
      return true
    }

    const now = Date.now()
    const cacheAge = now - this.cache.lastScan

    // Rebuild if cache is too old
    if (cacheAge > FolderCacheManager.CACHE_EXPIRY_MS) {
      return true
    }

    // Rebuild if workspace roots changed
    const currentRoots = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || []
    const cachedRoots = this.cache.workspaceRoots

    if (currentRoots.length !== cachedRoots.length || !currentRoots.every((root) => cachedRoots.includes(root))) {
      return true
    }

    return false
  }

  private async rebuildCache(options: ScanOptions): Promise<void> {
    if (this.isScanning) {
      return
    }

    this.isScanning = true
    this.clearWatchers()

    try {
      const folders = await this.scanFolders(options)

      this.cache = {
        folders,
        lastScan: Date.now(),
        workspaceRoots: vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || [],
        version: FolderCacheManager.CACHE_VERSION,
      }

      // Save to persistent storage
      await this.context.globalState.update(FolderCacheManager.CACHE_KEY, this.cache)

      // Setup filesystem watchers
      this.setupWatchers(options)
    } finally {
      this.isScanning = false
    }
  }

  private async scanFolders(options: ScanOptions): Promise<CachedFolder[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) {
      return []
    }

    const allFolders: CachedFolder[] = []
    const queue: QueueItem[] = []
    const visited = new Set<string>()
    const ignoredSet = new Set(options.ignoredFolders)

    // Start with all workspace folders at depth 0
    for (const workspaceFolder of workspaceFolders) {
      queue.push({ uri: workspaceFolder.uri, depth: 0 })
      visited.add(workspaceFolder.uri.fsPath)
    }

    // BFS traversal to collect all folders
    while (queue.length > 0 && allFolders.length < options.maxFolders) {
      const { uri: currentUri, depth } = queue.shift()!

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

              // Add to results
              const workspaceRoot = vscode.workspace.getWorkspaceFolder(childUri)?.uri.fsPath || ""
              const relativePath = vscode.workspace.asRelativePath(childUri, false)

              allFolders.push({
                uri: childPath,
                relativePath,
                folderName: name,
                workspaceRoot,
                lastModified: Date.now(),
              })
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    }

    return allFolders
  }

  private setupWatchers(options: ScanOptions): void {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return

    for (const workspaceFolder of workspaceFolders) {
      // Watch for folder creation/deletion
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, "**/"))

      watcher.onDidCreate(async (uri) => {
        if (this.isDirectory(uri.fsPath)) {
          await this.handleFolderCreated(uri, options)
        }
      })

      watcher.onDidDelete((uri) => {
        this.handleFolderDeleted(uri)
      })

      this.watchers.push(watcher)
    }
  }

  private async handleFolderCreated(uri: vscode.Uri, options: ScanOptions): Promise<void> {
    if (!this.cache) return

    const folderName = path.basename(uri.fsPath)

    // Check if folder should be ignored
    const ignoredSet = new Set(options.ignoredFolders)
    if (ignoredSet.has(folderName) || (options.ignoreDotFolders && folderName.startsWith("."))) {
      return
    }

    const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath || ""
    const relativePath = vscode.workspace.asRelativePath(uri, false)

    const newFolder: CachedFolder = {
      uri: uri.fsPath,
      relativePath,
      folderName,
      workspaceRoot,
      lastModified: Date.now(),
    }

    this.cache.folders.push(newFolder)
    await this.context.globalState.update(FolderCacheManager.CACHE_KEY, this.cache)
  }

  private handleFolderDeleted(uri: vscode.Uri): void {
    if (!this.cache) return

    this.cache.folders = this.cache.folders.filter((f) => f.uri !== uri.fsPath)
    this.context.globalState.update(FolderCacheManager.CACHE_KEY, this.cache)
  }

  private isDirectory(fsPath: string): boolean {
    try {
      return fs.statSync(fsPath).isDirectory()
    } catch {
      return false
    }
  }

  private clearWatchers(): void {
    this.watchers.forEach((watcher) => watcher.dispose())
    this.watchers = []
  }

  async loadCache(): Promise<void> {
    const cached = await this.context.globalState.get<FolderCache>(FolderCacheManager.CACHE_KEY)
    if (cached && cached.version === FolderCacheManager.CACHE_VERSION) {
      this.cache = cached
    }
  }

  dispose(): void {
    this.clearWatchers()
  }
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

// Global cache manager instance
let cacheManager: FolderCacheManager

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize cache manager
  cacheManager = new FolderCacheManager(context)
  await cacheManager.loadCache()

  const disposable = vscode.commands.registerCommand("folder-selector.selectFolder", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) {
      void vscode.window.showErrorMessage("Open a workspace folder to use Folder Selector.")
      return
    }

    // Get configuration settings
    const options = getConfiguration()

    let allFolders: vscode.Uri[] = []

    // Show a loading message while getting folders from cache
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Folder Selector",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "Loading folders..." })
          allFolders = await cacheManager.getFolders(options)
          progress.report({ message: `Found ${allFolders.length} folders` })
        }
      )
    } catch (error) {
      void vscode.window.showErrorMessage(`Error loading folders: ${error}`)
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
  if (cacheManager) {
    cacheManager.dispose()
  }
}
