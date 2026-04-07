import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rpqfzsrmmamfhxxarvvf.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwcWZ6c3JtbWFtZmh4eGFydnZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTE3MjUsImV4cCI6MjA5MDU2NzcyNX0.QiEhP6x1K-YBMTKzJLxLU_OQONWUKN8UY8_W3r6F3to'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
