// lib/database.js

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = 'YOUR_SUPABASE_URL'; // Replace with your Supabase URL
const supabaseKey = 'YOUR_SUPABASE_KEY'; // Replace with your Supabase service role key
const supabase = createClient(supabaseUrl, supabaseKey);

// Function to insert data into the database
export const insertData = async (tableName, data) => {
    const { data: insertedData, error } = await supabase
        .from(tableName)
        .insert(data);
    if (error) throw new Error(error.message);
    return insertedData;
};

// Function to fetch data from the database
export const fetchData = async (tableName, query = {}) => {
    const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .match(query);
    if (error) throw new Error(error.message);
    return data;
};

// Function to update data in the database
export const updateData = async (tableName, id, data) => {
    const { data: updatedData, error } = await supabase
        .from(tableName)
        .update(data)
        .eq('id', id);
    if (error) throw new Error(error.message);
    return updatedData;
};

// Function to delete data from the database
export const deleteData = async (tableName, id) => {
    const { data: deletedData, error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id);
    if (error) throw new Error(error.message);
    return deletedData;
};

// Export Supabase client for direct access if needed
export { supabase };