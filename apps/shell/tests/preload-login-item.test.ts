import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { HOME_CHANNELS } from '../src/shared/home-api'

const electronMocks = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => electronMocks.exposed.set(name, api),
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  // the preload imports @genoffice/electron-utils (drop-open bridge), which
  // binds webUtils at module scope even though node env never installs it
  webUtils: { getPathForFile: () => '' },
}))

import '../src/preload/index'

const homeApi = electronMocks.exposed.get('aiOffice') as HomeApi

beforeEach(() => {
  electronMocks.invoke.mockReset()
})

describe('open-at-login preload API', () => {
  it('rejects a non-boolean before invoking the main process', async () => {
    const set = homeApi.setOpenAtLogin as (enabled: unknown) => Promise<unknown>
    await expect(set('true')).rejects.toThrow('Invalid open-at-login value')
    expect(electronMocks.invoke).not.toHaveBeenCalled()
  })

  it('forwards booleans and normalizes the reply', async () => {
    electronMocks.invoke.mockResolvedValue({ supported: true, enabled: true, needsApproval: true })
    await expect(homeApi.setOpenAtLogin(true)).resolves.toEqual({
      supported: true,
      enabled: true,
      needsApproval: true,
    })
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.setOpenAtLogin, true)
  })

  it('reports a malformed or missing reply as unsupported', async () => {
    electronMocks.invoke.mockResolvedValue('nope')
    await expect(homeApi.getOpenAtLogin()).resolves.toEqual({ supported: false, enabled: false })
    electronMocks.invoke.mockResolvedValue({ supported: true, enabled: 'yes' })
    await expect(homeApi.getOpenAtLogin()).resolves.toEqual({ supported: true, enabled: false })
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.getOpenAtLogin)
  })

  it('opens the system login items page over its own channel', async () => {
    electronMocks.invoke.mockResolvedValue(undefined)
    await expect(homeApi.openLoginItemsSettings()).resolves.toBeUndefined()
    expect(electronMocks.invoke).toHaveBeenCalledTimes(1)
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(HOME_CHANNELS.openLoginItemsSettings)
  })
})
