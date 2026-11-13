import { ErrorNote } from '@/components/error-note'
import { Field } from '@/components/field'
import { Page } from '@/components/page'
import { useCreateConnection } from '@/features/connections/api'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'

export function NewConnectionPage() {
  const createConnection = useCreateConnection()
  return <Page title="Add Postgres" parents={[{ label: 'Connections', href: '/connections' }]}>
    <div className="wrap narrow">
      <form className="box formbox" onSubmit={(event) => {
        const field = formValues(event)
        createConnection.mutate({ name: field('name'), dsn: field('dsn') })
      }}>
        <Field label="Name" error={fieldError(createConnection.error, 'name')}>{(control) => <input {...control} name="name" placeholder="Orders DB" required maxLength={60} />}</Field>
        <Field label="Connection string" error={fieldError(createConnection.error, 'dsn')}>{(control) => <input {...control} name="dsn" className="mono" placeholder="postgres://user:pass@host:5432/db" required autoComplete="off" />}</Field>
        <span className="mute">Stored on this server and never shown again. Agents can read the database, never change it.</span>
        <ErrorNote message={formError(createConnection.error, ['name', 'dsn'])} />
        <div><button className="btn primary" disabled={createConnection.isPending}>Add connection</button></div>
      </form>
    </div>
  </Page>
}
