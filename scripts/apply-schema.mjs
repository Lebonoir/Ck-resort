import { applySqlFile } from './apply-sql.mjs'

const password = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_URL
const accountSql = 'supabase/account_admin.sql'

if (!password) {
  console.log('Paste and run supabase/account_admin.sql in the Supabase SQL Editor, then click Run.')
  console.log('That installs admin_update_account with the argument names the Users page sends.')
  process.exit(0)
}

const result = await applySqlFile(process.env, accountSql)
if (!result.applied) {
  console.error(result.reason || 'Could not apply SQL.')
  process.exit(1)
}
console.log('Account admin RPCs applied.')
