import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  parseLinktext,
  Plugin,
  PluginSettingTab,
  Setting,
  Workspace,
} from 'obsidian'
import type { MarkdownEditView } from 'obsidian'
import { openInMpv, isVideoLink, isVideoExt, getInstancePrototype, getRunningMarkdownViewInstance } from './utils'
import type { PreviewEventHanlder } from 'obsidian'
import { MarkdownPreviewRenderer } from 'obsidian'
import { around } from 'monkey-around'
import * as path from 'path'

// Remember to rename these classes and interfaces!

interface MpvPluginSettings {
  mpvPath: string
}

const DEFAULT_SETTINGS: MpvPluginSettings = {
  mpvPath: 'mpv',
}

export default class MpvPlugin extends Plugin {
  settings: MpvPluginSettings

  async onload() {
    await this.loadSettings()
    this.loadPatches()
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }

  private loadPatches() {
    this.patchPreviewClick()
    this.patchEditorClick()
    this.patchLinktextOpen()
  }

  private patchEditorClick() {
    const plugin = this
    getRunningMarkdownViewInstance(plugin).then((view) => {
      if (!view.editMode) {
        console.error('MarkdownView.editMode is not available, cannot patch editor click')
        return
      }
      plugin.register(
        around(getInstancePrototype(view.editMode), {
          triggerClickableToken: (next) =>
            async function (this: MarkdownEditView, token, newLeaf, ...args) {
              const fallback = () => next.call(this, token, newLeaf, ...args)
              const link = token.text
              console.debug('patchEditorClick', link)
              if (!(isVideoLink(link) && 'external-link' === token.type)) {
                return fallback()
              }
              try {
                await openInMpv(link)
              } catch (e) {
                console.error(`onExternalLinkClick error in editor, fallback to default`, e)
                return fallback()
              }
            },
        }),
      )
      console.debug('editor click patched')
    })
  }

  private patchPreviewClick() {
    const plugin = this
    function patchPreviewEventHanlder(handler: PreviewEventHanlder, plugin: MpvPlugin) {
      plugin.register(
        around(getInstancePrototype(handler), {
          onExternalLinkClick: (next) =>
            async function (this: PreviewEventHanlder, evt, target, link, ...args) {
              const fallback = () => next.call(this, evt, target, link, ...args)
              console.debug('patchPreviewClick', link)
              if (!isVideoLink(link)) {
                return fallback()
              }
              evt.preventDefault()
              try {
                await openInMpv(link)
              } catch (e) {
                console.error(`onExternalLinkClick error in preview, fallback to default`, e)
                return fallback()
              }
            },
        }),
      )
    }

    const unloadPatchHook = around(MarkdownPreviewRenderer as MDPreviewRendererCtor, {
      registerDomEvents: (next) =>
        function (this: MarkdownPreviewRenderer, _el, helper, ...args) {
          patchPreviewEventHanlder(helper, plugin)
          unloadPatchHook()
          console.debug('preview click patched')
          return next.call(this, _el, helper, ...args)
        },
    })
  }

  private patchLinktextOpen() {
    const plugin = this
    this.register(
      around(Workspace.prototype, {
        openLinkText: (next) =>
          async function (this: Workspace, linktext, sourcePath, newLeaf, openViewState, ...args) {
            const fallback = () => next.call(this, linktext, sourcePath, newLeaf, openViewState, ...args)
            console.debug('patchLinktextOpen', linktext, sourcePath)
            try {
              await plugin.openInternalLink(linktext, sourcePath, fallback)
            } catch (e) {
              console.error(`onInternalLinkClick error in openLinktext, fallback to default`, e)
              fallback()
            }
          },
      }),
    )
    console.debug('linktext open patched')
  }

  private async openInternalLink(linktext, sourcePath, fallback) {
    const { metadataCache } = this.app
    const basePath = (this.app.vault.adapter as any).basePath
    const { path: linkpath, subpath } = parseLinktext(linktext)
    const linkFile = metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
    if (!linkFile || !isVideoExt(linkFile.extension)) {
      fallback()
      return
    }

    const absolutePath = path.posix.join(basePath, linkFile.path)
    console.debug('openInternalLink', absolutePath)
    if (subpath.startsWith('#t=')) {
      const timestamp = subpath.slice(3)
      await openInMpv(absolutePath, timestamp)
    } else {
      await openInMpv(absolutePath)
    }
  }
}

declare module 'obsidian' {
  interface MarkdownEditView {
    triggerClickableToken(
      token: { type: string; text: string; start: number; end: number },
      newLeaf: boolean | PaneType,
    ): void
  }
  interface MarkdownView {
    // for safe access
    editMode?: MarkdownEditView
  }
  class PreviewEventHanlder {
    app: App
    onInternalLinkDrag(evt: MouseEvent, delegateTarget: HTMLElement, linktext: string): void
    onInternalLinkClick(evt: MouseEvent, delegateTarget: HTMLElement, linktext: string): void
    onInternalLinkRightClick(evt: MouseEvent, delegateTarget: HTMLElement, linktext: string): void
    onExternalLinkClick(evt: MouseEvent, delegateTarget: HTMLElement, href: string): void
    onInternalLinkMouseover(evt: MouseEvent, delegateTarget: HTMLElement, href: string): void
    onTagClick(evt: MouseEvent, delegateTarget: HTMLElement, tag: string): void
    info?: MarkdownView | MarkdownFileInfo
  }
}

type MDPreviewRendererCtor = typeof MarkdownPreviewRenderer & {
  registerDomEvents(el: HTMLElement, helper: PreviewEventHanlder, isBelongTo: (el: HTMLElement) => boolean): void
  belongsToMe(target: HTMLElement, el: HTMLElement, isBelongTo: (el: HTMLElement) => boolean): boolean
}
