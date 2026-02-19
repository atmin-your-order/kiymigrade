module.exports = {
    commands: ['.login', '.logout'],
    tags: 'admin',
    help: 'Login/Logout Admin',
    run: async (m, { sock, args, command, adminSessions, env }) => {
        const from = m.key.remoteJid;

        // --- LOGIN ---
        if (command === '.login') {
            const [user, pass] = args;
            if(user === env.ADMIN_WA_USER && pass === env.ADMIN_WA_PASS) {
                adminSessions.add(from);
                await sock.sendMessage(from, { text: '✅ *LOGIN SUKSES*\n\nHalo Min, akses admin terbuka.\nKetik *.menuadmin* untuk melihat fitur.' });
            } else {
                await sock.sendMessage(from, { text: '❌ *LOGIN GAGAL*\nUsername atau password salah.' });
            }
            return;
        }

        // --- LOGOUT ---
        if (command === '.logout') {
            if (!adminSessions.has(from)) return;
            adminSessions.delete(from);
            await sock.sendMessage(from, { text: '👋 *LOGOUT SUKSES*\nSesi admin telah berakhir.' });
        }
    }
};
