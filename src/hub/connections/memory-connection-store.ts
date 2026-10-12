import { BaseConnectionStore, type ConnectionStoreData } from './connection-store'

export class MemoryConnectionStore extends BaseConnectionStore {
  private data: ConnectionStoreData

  constructor(data: ConnectionStoreData = { connections: [] }) {
    super()
    this.data = cloneData(data)
  }

  protected async load(): Promise<ConnectionStoreData> {
    return cloneData(this.data)
  }

  protected async save(data: ConnectionStoreData): Promise<void> {
    this.data = cloneData(data)
  }
}

function cloneData(data: ConnectionStoreData): ConnectionStoreData {
  return {
    connections: data.connections.map(connection => ({ ...connection })),
    selectedId: data.selectedId,
  }
}
