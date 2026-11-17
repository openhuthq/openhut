type Copies = { computers: { computer: string; id: string }[] }

export function holds({ connection, id }: { connection: Copies; id: string }) {
  return connection.computers.some((copy) => copy.id === id)
}

export function connectionOf<T extends Copies>({ connections, id }: { connections: T[] | undefined; id: string }) {
  return connections?.find((connection) => holds({ connection, id }))
}

export function copyOn({ connection, computer }: { connection: Copies; computer: string }) {
  return connection.computers.find((copy) => copy.computer === computer)?.id
}
