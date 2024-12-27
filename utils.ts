import type { App, MarkdownView, Plugin, Workspace } from 'obsidian'
import { FileSystemAdapter } from 'obsidian'
import { spawn } from 'child_process'
import * as net from 'net'

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function getBasePath(app: App): string | null {
  const adapter = app.vault.adapter
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getBasePath()
  }
  return null
}

export async function openInMpv(link: string, timestamp: string | null = null) {
  console.debug(`opening ${link} ${timestamp}`)
  const pipePath = getPipePath(link)
  console.debug(pipePath)
  const alreadyOpen = await PipeExists(pipePath)
  if (!alreadyOpen) {
    const args = [link, `--input-ipc-server=${pipePath}`]
    if (timestamp !== null) {
      args.push(`--start=${timestamp}`)
    }
    const subprocess = spawn('mpv', args, {
      detached: true,
      stdio: 'ignore',
    })
    if (typeof subprocess.pid !== 'number') {
      console.error('failed to spawn mpv')
      return
    }
    subprocess.unref()
  }
  if (timestamp !== null) {
    const nRetries = 10
    for (let i = 0; i < nRetries; i++) {
      if (await PipeExists(pipePath)) {
        break
      }
      await sleep(10)
    }
    mpvSeek(pipePath, timestamp)
  }
  // subprocess.on('error', (error) => {
  //   console.error('open in mpv failed', error)
  // })
  // subprocess.stderr?.on('data', (data) => console.error('open in mpv stderr:', data.toString()))
  // subprocess.stdout?.on('data', (data) => console.error('open in mpv stdout:', data.toString()))
}

function PipeExists(pipePath: string): Promise<boolean> {
  return new Promise<boolean>((resolve, _) => {
    const socket = net.connect(pipePath)
    socket.on('error', () => {
      resolve(false)
    })
    socket.on('connect', () => {
      socket.end()
      resolve(true)
    })
  })
}

function mpvSeek(pipePath: string, timestamp: string) {
  const socket = net.connect(pipePath)
  socket.on('connect', () => {
    console.debug('seek!', timestamp)
    socket.write(`seek ${timestamp} absolute\n`)
    socket.end()
  })
}

export function isVideoLink(link: string) {
  return link.startsWith('https://www.bilibili.com/video') || link.startsWith('https://www.youtube.com/watch')
}

export function isVideoExt(ext: string): boolean {
  const videoExts = new Set(['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'flv', 'm3u'])
  ext = ext.replace(/^\./, '').toLowerCase()
  return videoExts.has(ext)
}

export function getRunningMarkdownViewInstance(plugin: Plugin): Promise<MarkdownView> {
  const { app } = plugin
  return new Promise((resolve) => {
    function tryGetMarkdownView() {
      const views = app.workspace.getLeavesOfType('markdown')

      for (const view of views) {
        if (view) {
          const mdView = view.view as MarkdownView
          console.debug(mdView)
          if (mdView.editMode) {
            resolve(mdView)
            return true
          }
        }
      }
      return false
    }
    app.workspace.onLayoutReady(() => {
      if (tryGetMarkdownView()) return
      const onLayoutChange = () => {
        if (tryGetMarkdownView()) app.workspace.off('layout-change', onLayoutChange)
      }
      app.workspace.on('layout-change', onLayoutChange)
      plugin.register(() => app.workspace.off('layout-change', onLayoutChange))
    })
  })
}

export function getViewPrototype<T extends ObjectConstructor>(ctor: T): Object {
  return ctor.prototype
}

export function getInstanceCtor<T extends Object>(instance: T): Function {
  return instance.constructor
}

export function getInstancePrototype<T extends Object>(instance: T): T {
  return instance.constructor.prototype
}

declare module 'obsidian' {
  interface MarkdownPreviewView {
    rerender(full?: boolean): void
  }
  interface App {
    viewRegistry: ViewRegistry
    embedRegistry: EmbedRegistry
  }
  interface ViewRegistry {
    typeByExtension: Record<string, string>
    viewByType: Record<string, ViewCreator>
    getTypeByExtension(ext: string): string | undefined
    getViewCreatorByType(type: string): ViewCreator | undefined
    isExtensionRegistered(ext: string): boolean
    registerExtensions(exts: string[], type: string): void
    registerViewWithExtensions(exts: string[], type: string, viewCreator: ViewCreator): void
    unregisterExtensions(exts: string[]): void
    unregisterView(viewType: string): void
  }

  interface EmbedInfo {
    app: App
    containerEl: HTMLDivElement
    depth: number
    displayMode: boolean
    linktext: string
    showInline: boolean
    sourcePath: string
  }
  interface EmbedCreator {
    (info: EmbedInfo, file: TFile, subpath: string): EmbedComponent
  }
  interface EmbedRegistry {
    embedByExtension: Record<string, EmbedCreator>
    registerExtension(ext: string, creator: EmbedCreator): void
    registerExtensions(exts: string[], creator: EmbedCreator): void
    unregisterExtensions(exts: string[]): void
    unregisterExtension(ext: string): void
  }
  interface EmbedComponent extends Component {
    loadFile(): any
  }
}

export function reloadMarkdownPreview(workspace: Workspace) {
  workspace.getLeavesOfType('markdown').forEach(async (leaf) => {
    // (leaf.view as MarkdownView).previewMode?.rerender(true);
    const state = leaf.getViewState()
    await leaf.setViewState({ type: 'empty' })
    await leaf.setViewState(state)
  })
}

function getPipePath(link: string): string {
  const b64 = Buffer.from(link).toString('base64')
  return '\\\\.\\pipe\\' + b64
}
