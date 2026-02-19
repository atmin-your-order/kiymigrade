// supabase.js

import { createClient } from '@supabase/supabase-js';

// Define your Supabase URL and Key (keep these private in production)
const supabaseUrl = 'https://your-supabase-url.supabase.co';
const supabaseKey = 'your-public-anon-key';

// Create a single supabase client for interacting with your database
const supabase = createClient(supabaseUrl, supabaseKey);

// User Functions
export const getUsers = async () => {
    const { data, error } = await supabase
        .from('users')
        .select('*');
    return { data, error };
};

export const createUser = async (userData) => {
    const { data, error } = await supabase
        .from('users')
        .insert([userData]);
    return { data, error };
};

// Product Functions
export const getProducts = async () => {
    const { data, error } = await supabase
        .from('products')
        .select('*');
    return { data, error };
};

export const createProduct = async (productData) => {
    const { data, error } = await supabase
        .from('products')
        .insert([productData]);
    return { data, error };
};

// Panel Functions
export const getPanels = async () => {
    const { data, error } = await supabase
        .from('panels')
        .select('*');
    return { data, error };
};

export const createPanel = async (panelData) => {
    const { data, error } = await supabase
        .from('panels')
        .insert([panelData]);
    return { data, error };
};

// Transaction Functions
export const getTransactions = async () => {
    const { data, error } = await supabase
        .from('transactions')
        .select('*');
    return { data, error };
};

export const createTransaction = async (transactionData) => {
    const { data, error } = await supabase
        .from('transactions')
        .insert([transactionData]);
    return { data, error };
};

// Visitor Functions
export const getVisitors = async () => {
    const { data, error } = await supabase
        .from('visitors')
        .select('*');
    return { data, error };
};

export const createVisitor = async (visitorData) => {
    const { data, error } = await supabase
        .from('visitors')
        .insert([visitorData]);
    return { data, error };
};

// Notification Functions
export const getNotifications = async () => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*');
    return { data, error };
};

export const createNotification = async (notificationData) => {
    const { data, error } = await supabase
        .from('notifications')
        .insert([notificationData]);
    return { data, error };
};

export default supabase;