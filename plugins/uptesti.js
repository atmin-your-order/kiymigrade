const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const FormData = require('form-data');

module.exports = {
    commands: ['.uptesti'],
    tags: 'admin',
    help: 'Upload Testimoni ke Saluran WA & Telegram',
    run: async (m, { sock, args, command, adminSessions, env }) => {
        const from = m.key.remoteJid;

        // 1. Cek Admin
        if (!adminSessions.has(from)) return;

        // 2. Ambil Nama Orderan
        const textOrder = args.join(' ') || 'Script/Panel';

        // 3. Cek Gambar
        const msg = m.message;
        const type = Object.keys(msg)[0];
        const isImage = type === 'imageMessage';
        const isQuotedImage = type === 'extendedTextMessage' && msg.extendedTextMessage.contextInfo.quotedMessage?.imageMessage;

        if (!isImage && !isQuotedImage) return sock.sendMessage(from, { text: '❌ Sertakan gambar!' });

        try {
            await sock.sendMessage(from, { text: '⏳ Mengirim ke WA & Telegram...' });

            // Download Gambar
            let imageMessage = isImage ? msg.imageMessage : msg.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
            const stream = await downloadContentFromMessage(imageMessage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

            // --- KIRIM KE SALURAN WHATSAPP (Teks WA) ---
            let captionWA = `🌟 TRANSAKSI SELESAI NEXT ✅
📦 order : ${textOrder} 
━━━━━━━━━━━━━━━
✨ INFO PRODUK AMANE
🔗 https://shop.maneprivate.biz.id

📱 INFO SOSMED
🔗 shop.maneprivate.biz.id

📞 NOMOR REAL RIKI
➡️ wa.me/6289529161314
➡️ t.me/amaneofc
━━━━━━━━━━━━━━━
🛒 Kami menyediakan berbagai macam kebutuhan JB & Hosting.`;

            if(env.CHANNEL_ID) await sock.sendMessage(env.WA_CHANNEL_ID, { image: buffer, caption: captionWA });

            // --- KIRIM KE SALURAN TELEGRAM (Teks Tele) ---
            let captionTG = `🌟 TRANSAKSI SELESAI NEXT ✅
📦 order : ${textOrder} 
━━━━━━━━━━━━━━━
✨ INFO PRODUK AMANE
🔗 toko.rikishop.my.id

📱 INFO SOSMED
🔗 shop.maneprivate.biz.id

📞 TELE REAL RIKI
➡️ t.me/amaneofc
━━━━━━━━━━━━━━━
🛒 Kami menyediakan berbagai macam kebutuhan JB & Hosting.`;

            if(env.TG_CHANNEL_ID && env.TELEGRAM_TOKEN) {
                const form = new FormData();
                form.append('chat_id', env.TG_CHANNEL_ID);
                form.append('caption', captionTG);
                form.append('photo', buffer, 'testi.jpg');
                await axios.post(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendPhoto`, form, { headers: { ...form.getHeaders() } });
            }

            await sock.sendMessage(from, { text: '✅ SUKSES TERKIRIM KE SEMUA!' });

        } catch (e) {
            console.log(e);
            await sock.sendMessage(from, { text: '❌ Error: ' + e.message });
        }
    }
};
