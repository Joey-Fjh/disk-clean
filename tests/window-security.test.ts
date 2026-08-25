import { describe, expect, it } from 'vitest'
import { isAllowedRendererNavigationUrl } from '../src/main/window-security'

const RENDERER_INDEX = 'C:\\app\\out\\renderer\\index.html'
const STANDARD_FILE_URL = `file:///${RENDERER_INDEX.replace(/\\/g, '/')}`

describe('main window navigation security', () => {
  it('allows standard local file:///C:/.../renderer/index.html', () => {
    expect(
      isAllowedRendererNavigationUrl(STANDARD_FILE_URL, {
        isPackaged: true,
        rendererIndexPath: RENDERER_INDEX
      })
    ).toBe(true)
    expect(
      isAllowedRendererNavigationUrl(`${STANDARD_FILE_URL}?theme=dark#settings`, {
        isPackaged: true,
        rendererIndexPath: RENDERER_INDEX
      })
    ).toBe(true)
  })

  it('allows exact renderer index file URL when not packaged (npm start fallback)', () => {
    expect(
      isAllowedRendererNavigationUrl(STANDARD_FILE_URL, {
        isPackaged: false,
        rendererIndexPath: RENDERER_INDEX
      })
    ).toBe(true)
  })

  it('rejects file URLs with non-empty hostname', () => {
    const options = { isPackaged: true, rendererIndexPath: RENDERER_INDEX }
    expect(
      isAllowedRendererNavigationUrl('file://evilhost/C:/app/out/renderer/index.html', options)
    ).toBe(false)
    expect(
      isAllowedRendererNavigationUrl('file://server/share/index.html', options)
    ).toBe(false)
  })

  it('rejects other file URLs and directory traversal variants', () => {
    const options = { isPackaged: true, rendererIndexPath: RENDERER_INDEX }
    expect(
      isAllowedRendererNavigationUrl('file:///C:/app/out/renderer/other.html', options)
    ).toBe(false)
    expect(
      isAllowedRendererNavigationUrl('file:///C:/app/out/renderer/../secrets.txt', options)
    ).toBe(false)
    expect(
      isAllowedRendererNavigationUrl('file:///C:/Windows/System32/cmd.exe', options)
    ).toBe(false)
  })

  it('rejects file URLs when renderer index path is unknown', () => {
    expect(
      isAllowedRendererNavigationUrl(STANDARD_FILE_URL, {
        isPackaged: false
      })
    ).toBe(false)
  })

  it('allows dev server origin during development', () => {
    expect(
      isAllowedRendererNavigationUrl('http://localhost:5173/', {
        devRendererUrl: 'http://localhost:5173',
        isPackaged: false
      })
    ).toBe(true)
    expect(
      isAllowedRendererNavigationUrl('http://localhost:5173/@vite/client', {
        devRendererUrl: 'http://localhost:5173',
        isPackaged: false
      })
    ).toBe(true)
  })

  it('rejects external navigation URLs', () => {
    expect(
      isAllowedRendererNavigationUrl('https://evil.example.com/phish', {
        devRendererUrl: 'http://localhost:5173',
        isPackaged: false
      })
    ).toBe(false)
    expect(
      isAllowedRendererNavigationUrl('http://localhost:9999/', {
        devRendererUrl: 'http://localhost:5173',
        isPackaged: false
      })
    ).toBe(false)
  })
})
