import { applySqlFile } from './apply-sql.mjs'

const password = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_URL
const files = ['supabase/booking_lifecycle_types.sql', 'supabase/booking_lifecycle.sql']

if (!password) {
  console.log('Run these in the Supabase SQL Editor as two separate queries:')
  console.log('1. supabase/booking_lifecycle_types.sql')
  console.log('2. supabase/booking_lifecycle.sql')
  process.exit(0)
}

for (const file of files) {
  const result = await applySqlFile(process.env, file)
  if (!result.applied) {
    console.error(result.reason || `Could not apply ${file}.`)
    process.exit(1)
  }
  console.log(`Applied ${file}`)
}
