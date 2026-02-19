// Supabase Client Configuration and Database Helper Functions

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = 'YOUR_SUPABASE_URL'; // Replace with your Supabase URL
const supabaseKey = 'YOUR_SUPABASE_KEY'; // Replace with your Supabase Key
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Function to migrate data from JSON to Supabase
 * @param {Array} jsonData - Array of JSON objects to migrate
 */
async function migrateJsonToSupabase(jsonData) {
    const { data, error } = await supabase
        .from('your_table_name') // Replace with your Supabase table
        .insert(jsonData);

    if (error) {
        console.error('Migration error:', error);
        return false;
    }
    return data;
}

export { supabase, migrateJsonToSupabase };