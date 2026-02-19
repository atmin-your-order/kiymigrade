
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const QRCode = require('qrcode');
const archiver = require('archiver');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(__dirname, 'database.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const VISITORS_FILE = path.join(DATA_DIR, 'visitors.json');
const PANELS_FILE = path.join(DATA_DIR, 'panels.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;
const ADMIN_PIN = process.env.ADMIN_PIN || "123456"; 

const adminSessions = new Set();
const plugins = new Map();
const otpStore = new Map();
const log = (msg, type='INFO') => {
    const time = new Date().toLocaleTimeString();
    let color = '\x1b[36m'; 
    let icon = 'ℹ️';
    if(type === 'SUCCESS') { color = '\x1b[32m'; icon = '✅'; }
    if(type === 'ERROR') { color = '\x1b[31m'; icon = '❌'; }
    if(type === 'WARN') { color = '\x1b[33m'; icon = '⚠️'; }
    if(type === 'ORDER') { color = '\x1b[35m'; icon = '🛒'; }
    console.log(`\x1b[2m[${time}]\x1b[0m ${icon} ${color}[${type}]\x1b[0m ${msg}`);
};
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

const BAD_WORDS = ["anjing", "babi", "bangsat", "tolol", "goblok", "kontol", "memek", "jembut", "scam", "penipu", "bego", "setan"];

function isToxic(text) {
    const lower = text.toLowerCase();
    return BAD_WORDS.some(word => lower.includes(word));
}

function formatRemainingTime(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours} Jam ${minutes} Menit`;
}

// --- [1] FUNGSI HELPER CLOUDFLARE (TARUH DI BAGIAN ATAS) ---
async function cfReq(method, endpoint, data = null) {
    const config = {
        method: method,
        url: `https://api.cloudflare.com/client/v4/${endpoint}`,
        headers: {
            'X-Auth-Email': process.env.CF_EMAIL, // Pastikan isi di .env
            'Authorization': `Bearer ${process.env.CF_API_TOKEN}`, // Pastikan isi di .env
            'Content-Type': 'application/json'
        },
        data: data
    };
    return axios(config);
}

async function pteroClientReq(method, endpoint, data = null) {
    const config = {
        method: method,
        url: `${process.env.PTERO_DOMAIN}/api/client/servers/${endpoint}`,
        headers: {
            'Authorization': `Bearer ${process.env.PTERO_CLIENT_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        data: data
    };
    return axios(config);
}

function readProducts() {
    try {
        const data = fs.readFileSync(PRODUCTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        log("Gagal membaca products.json", "ERROR");
        return [];
    }
}
function writeProducts(data) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
}

app.use(cors());

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('trust proxy', true); 

function readDB() {
    try { 
        let data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if(!data.history) data.history = [];
        if(!data.notifications) data.notifications = [];
        if(!data.my_scripts) data.my_scripts = [];
        if(!data.my_courses) data.my_courses = [];
        if(!data.reviews) data.reviews = [];
        if(!data.promo_codes) data.promo_codes = [];
        if(!data.vps_stock) data.vps_stock = [];
        if(!data.my_vps) data.my_vps = [];
        if(!data.app_stock) data.app_stock = [];
        if(!data.my_apps) data.my_apps = [];
        return data;
    } catch { 
        return { transactions: 0, history: [], notifications: [], my_scripts: [], my_courses: [], reviews: [], promo_codes: [], vps_stock: [], my_vps: [], app_stock: [], my_apps: []};
    }
}
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

function readUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } }
function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }
function readVisitors() { try { return JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8')); } catch { return []; } }
function writeVisitors(data) { fs.writeFileSync(VISITORS_FILE, JSON.stringify(data, null, 2)); }
function readPanels() { try { return JSON.parse(fs.readFileSync(PANELS_FILE, 'utf8')); } catch { return []; } }
function writePanels(data) { fs.writeFileSync(PANELS_FILE, JSON.stringify(data, null, 2)); }

async function sendTelegramMessage(text) {
    if(!TELEGRAM_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_OWNER_ID, text: text, parse_mode: 'Markdown'
        });
    } catch(e) { log('Gagal kirim TG msg', 'ERROR'); }
}

async function backupToTelegram() {
    if(!TELEGRAM_TOKEN) return;
    const zipName = `Backup_RikiShop_${Date.now()}.zip`;
    const zipPath = path.join(__dirname, zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } }); 
    log("Memulai proses backup ZIP...", "INFO");
    const createZip = new Promise((resolve, reject) => {
        output.on('close', () => {
            resolve(archive.pointer() + ' total bytes');
        });
        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);
        archive.glob('**/*', {
            cwd: __dirname,
            ignore: [
                'node_modules/**', 
                'auth_baileys/**',
                '.git/**', 
                zipName
            ]
        });

        archive.finalize();
    });

    try {
        await createZip; 
        const form = new FormData();
        form.append('chat_id', TELEGRAM_OWNER_ID);
        form.append('caption', `📦 *FULL SOURCE CODE BACKUP*\n📅 ${new Date().toLocaleString()}\n⛔ _Node_modules excluded_`);
        form.append('document', fs.createReadStream(zipPath));
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, form, {
            headers: { ...form.getHeaders() },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });
        
        log("Full Script Backup (ZIP) Sent to Telegram", "SUCCESS");

    } catch (e) { 
        log("Backup TG Gagal: " + e.message, 'ERROR'); 
    } finally {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    }
}

function loadPlugins() {
    const pluginFolder = path.join(__dirname, 'plugins');
    if (!fs.existsSync(pluginFolder)) fs.mkdirSync(pluginFolder);

    const files = fs.readdirSync(pluginFolder).filter(file => file.endsWith('.js'));
    for (const file of files) {
        try {
            const plugin = require(path.join(pluginFolder, file));
            if (plugin.commands) {
                plugin.commands.forEach(cmd => plugins.set(cmd, plugin));
            }
        } catch (e) {
            log(`Gagal load plugin ${file}: ${e.message}`, 'ERROR');
        }
    }
    log(`Berhasil load ${plugins.size} command dari folder plugins`, 'SUCCESS');
}
loadPlugins();

let sock;
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, 
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"] 
    });

sock.ev.on('messages.upsert', async (m) => {
    try {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        let body = type === 'conversation' ? msg.message.conversation : 
                   type === 'extendedTextMessage' ? msg.message.extendedTextMessage?.text : 
                   type === 'imageMessage' ? msg.message.imageMessage?.caption : '';
        if (!body) body = '';
        if (!body.startsWith('.')) return; 
        const command = body.split(' ')[0].toLowerCase();
        const args = body.slice(command.length).trim().split('|');
        if (plugins.has(command)) {
            const plugin = plugins.get(command);
            await plugin.run(msg, {
                sock,
                command,
                args,
                adminSessions,
                env: process.env,
                dbFunc: {
                    readDB, writeDB,
                    readUsers, writeUsers,
                    readVisitors, writeVisitors,
                    readProducts, writeProducts
                }
            });
        }

    } catch (e) {
        console.log('Error Handler:', e.message);
    }
});

    if(!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let phoneNumber = process.env.OWNER_NUMBER;

                if (!phoneNumber) {
                    console.log("\x1b[31m[ERROR] Variable OWNER_NUMBER belum diisi di file .env!\x1b[0m");
                    return;
                }
                phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
                if (phoneNumber.startsWith('08')) phoneNumber = '62' + phoneNumber.slice(1);

                const code = await sock.requestPairingCode(phoneNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`\n\x1b[36m╭───────────────────────────────────────────────────╮\x1b[0m`);
                console.log(`\x1b[36m│             🔗  WHATSAPP PAIRING CODE              │\x1b[0m`);
                console.log(`\x1b[36m│───────────────────────────────────────────────────│\x1b[0m`);
                console.log(`\x1b[36m│\x1b[0m                                                   \x1b[36m│\x1b[0m`);
                console.log(`\x1b[36m│\x1b[0m       KODE :  \x1b[1m\x1b[33m${formattedCode}\x1b[0m            `);
                console.log(`\x1b[36m│\x1b[0m                                                   \x1b[36m│\x1b[0m`);
                console.log(`\x1b[36m│───────────────────────────────────────────────────│\x1b[0m`);
                console.log(`\x1b[36m╰───────────────────────────────────────────────────╯\x1b[0m\n`);

            } catch(e) {
                console.log("\x1b[31m[ERROR PAIRING]\x1b[0m Gagal request kode:", e.message);
            }
        }, 4000); 
    }

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => { 
        if(u.connection === 'close') connectToWhatsApp();
        else if(u.connection === 'open') {
            log("Bot WhatsApp Terhubung!", "SUCCESS");
        }
    });
}
connectToWhatsApp();

async function sendWaMessage(target, text) {
    if(!sock) return;
    try { await sock.sendMessage(target.replace('08','628')+'@s.whatsapp.net', {text}); } catch(e){}
}

async function sendTestiToChannel(text) {
    if(!sock || !process.env.CHANNEL_ID) return;
    
    try {
        const filePath = path.join(__dirname, 'public', 'images', 'testimoni.jpg'); 
        const imageBuffer = fs.readFileSync(filePath);
        await sock.sendMessage(process.env.CHANNEL_ID, { 
            text: text,
            contextInfo: {
                externalAdReply: {
                    showAdAttribution: true,
                    title: "✅ LAPORAN TRANSAKSI SUKSES",
                    body: "AmaneShop System",
                    mediaType: 1,
                    renderLargerThumbnail: true,
                    thumbnail: imageBuffer, 
                    sourceUrl: process.env.STORE_LINK || "https://shop.maneprivate.biz.id"
                }
            }
        });
        
        console.log("Sukses kirim Testi (File Lokal) ke Channel");

    } catch(e){
        console.log("Gagal baca file/kirim testi:", e.message);
        try { await sock.sendMessage(process.env.CHANNEL_ID, { text }); } catch(err) {}
    }
}


async function createPteroUser(email, username, password) {
    try {
        const res = await axios.post(`${process.env.PTERO_DOMAIN}/api/application/users`, {
            email, username, first_name: username, last_name: "User", language: "en", password
        }, { headers: { "Authorization": `Bearer ${process.env.PTERO_API_KEY}`, "Content-Type": "application/json", "Accept": "application/json" }});
        return res.data.attributes.id;
    } catch (e) { return null; }
}

async function createPteroServer(userId, product, serverName, description, repoUrl = "", customStartup = null) {
    try {
        const defaultStartup = "if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == \"1\" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/${CMD_RUN};";
        
        const finalStartup = customStartup || defaultStartup;

        const eggEnv = { 
            "GIT_ADDRESS": repoUrl,  
            "BRANCH": "master", 
            "USERNAME": "", 
            "ACCESS_TOKEN": "", 
            "CMD_RUN": "npm start", 
            "AUTO_UPDATE": "1" 
        };

        const res = await axios.post(`${process.env.PTERO_DOMAIN}/api/application/servers`, {
            name: serverName,
            user: userId,
            description: description,
            egg: parseInt(process.env.PTERO_EGG_ID),
            docker_image: "ghcr.io/parkervcp/yolks:nodejs_20",
            startup: finalStartup,
            environment: eggEnv,
            limits: { memory: product.ram, swap: 0, disk: product.disk, io: 500, cpu: product.cpu },
            feature_limits: { databases: 1, allocations: 1, backups: 1 },
            deploy: { locations: [parseInt(process.env.PTERO_LOCATION_ID)], dedicated_ip: false, port_range: [] }
        }, { headers: { "Authorization": `Bearer ${process.env.PTERO_API_KEY}`, "Content-Type": "application/json", "Accept": "application/json" }});
        
        return res.data.attributes;
    } catch (e) { 
        console.log("Error Create Server:", e.response?.data || e.message);
        return null; 
    }
}

setInterval(async () => {
    const db = readDB();
    const panels = readPanels();
    
    const now = new Date();
    const currentHour = now.getHours(); 
    let dbUpdated = false;
    let panelsUpdated = false;
    const scheduleHours = [6, 12, 18]; 

    for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        if (panel.status === 'deleted') continue;

        const expDate = new Date(panel.expired_date);
        const diffMs = expDate - now;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays <= 1 && diffDays > -1) {
            if (scheduleHours.includes(currentHour)) {
                const lastRemindTime = panel.last_remind_time ? new Date(panel.last_remind_time) : new Date(0);
                const isSameDay = lastRemindTime.getDate() === now.getDate();
                const isSameHour = lastRemindTime.getHours() === currentHour;

                if (!isSameDay || !isSameHour) {
                    const renewPrice = panel.price || 0;
                    if (renewPrice > 0) {
                        try {
                            db.history = db.history.filter(h => !(h.username === panel.username && h.status === 'pending' && h.is_renewal));
                            
                            const orderId = `RENEW-${panel.username}-${Date.now()}`;
                            const response = await axios.post('https://app.pakasir.com/api/transactioncreate/qris', {
                                project: process.env.PAKASIR_SLUG, order_id: orderId, amount: renewPrice, api_key: process.env.PAKASIR_API_KEY
                            }, { headers: { 'Content-Type': 'application/json' }});
                            const data = response.data;

                            if(data && data.payment) {
                                db.history.unshift({
                                    transaction_id: orderId, qr_string: data.payment.payment_number, amount: data.payment.total_payment,
                                    username: panel.username, phone: panel.phone, 
                                    item: `Perpanjang Panel ${panel.ram}MB`, 
                                    productId: panel.productId, time: new Date().toISOString(), 
                                    status: 'pending', is_renewal: true, fee: 0,
                                    category: 'panel'
                                });
                                dbUpdated = true; // DB History berubah

                                if(sock) {
                                    const qrBuffer = await QRCode.toBuffer(data.payment.payment_number, { scale: 8 });
                                    let sapaan = currentHour < 10 ? 'Pagi' : currentHour < 15 ? 'Siang' : 'Sore';
                                    let msg = `🔔 *TAGIHAN PERPANJANGAN (${sapaan})*\n\n`;
                                    msg += `Halo kak, mengingatkan kembali masa aktif panel *${panel.username}* segera habis.\n`;
                                    msg += `⏳ *Expired:* ${new Date(panel.expired_date).toLocaleString()}\n`;
                                    msg += `💸 *Total:* Rp ${renewPrice.toLocaleString()}\n\n`;
                                    msg += `Silakan scan QR di bawah ini.\n⚠️ *QR Valid 5 Menit*.`;
                                    await sock.sendMessage(panel.phone.replace('08','628')+'@s.whatsapp.net', { image: qrBuffer, caption: msg });
                                    log(`Nagih ${panel.username}`, 'ORDER');
                                }
                            }
                        } catch(e) { log(`Gagal nagih ${panel.username}: ${e.message}`, 'ERROR'); }
                    }
                    panels[i].last_remind_time = now.toISOString();
                    panelsUpdated = true;
                }
            }
        }
        if (diffDays <= 0 && panel.status !== 'suspended') {
            try {
                await axios.post(`${process.env.PTERO_DOMAIN}/api/application/servers/${panel.server_id}/suspend`, {}, 
                { headers: { "Authorization": `Bearer ${process.env.PTERO_API_KEY}` }});
                panels[i].status = 'suspended';
                panelsUpdated = true;
                sendWaMessage(panel.phone, `❌ *LAYANAN DISUSPEND*\n\nMaaf, panel *${panel.username}* dimatikan karena masa aktif habis.`);
            } catch(e) {}
        }
        if (diffDays <= -1 && panel.status !== 'deleted') {
            try {
                await axios.delete(`${process.env.PTERO_DOMAIN}/api/application/servers/${panel.server_id}`, 
                { headers: { "Authorization": `Bearer ${process.env.PTERO_API_KEY}` }});
                panels[i].status = 'deleted';
                panelsUpdated = true;
                sendWaMessage(panel.phone, `🗑️ *LAYANAN DIHAPUS*\n\nData panel *${panel.username}* telah dihapus permanen.`);
            } catch(e) {}
        }
    }

    if(dbUpdated) writeDB(db);
    if(panelsUpdated) writePanels(panels);
}, 3600000); 

app.post('/api/visitor/track', (req, res) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ip && ip.includes("::ffff:")) ip = ip.split("::ffff:")[1];
    
    const visitors = readVisitors(); 
    
    if(!visitors.includes(ip)) {
        visitors.push(ip);
        writeVisitors(visitors);
        log(`Visitor Baru: ${ip}`, 'INFO');
        return res.json({ success: true, new_visitor: true, total: visitors.length });
    } else {
        return res.json({ success: true, new_visitor: false, total: visitors.length });
    }
});

app.post('/api/send-otp', async (req, res) => {
    let { phone, username, type } = req.body;

    // 1. Validasi Format Nomor
    if(!phone || phone.length < 8) return res.json({ success: false, message: "Nomor tidak valid" });
    
    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('08')) phone = '62' + phone.slice(1);
    else if (phone.startsWith('01')) phone = '60' + phone.slice(1);
    else if (phone.startsWith('0')) phone = '62' + phone.slice(1);

    // 2. Cek Data Ganda (Khusus Register)
    if (type === 'register') {
        const users = readUsers();
        const userExist = users.find(u => u.username === username);
        if (userExist) {
            return res.json({ success: false, message: "Username sudah digunakan, pakai username lain." });
        }
        const phoneExist = users.find(u => u.phone === phone);
        if (phoneExist) {
            return res.json({ success: false, message: "Nomor ini sudah terdaftar." });
        }
    }

    // 3. Generate Kode OTP (4 Digit)
    const code = Math.floor(1000 + Math.random() * 9000);
    
    // 4. Simpan ke Memory Server (Berlaku 60 Detik / 1 Menit)
    otpStore.set(phone, { code, expires: Date.now() + 60000 }); 
    
    // 5. Log ke Console Server (Agar Admin tau kodenya jika perlu debug)
    log(`OTP Dibuat untuk ${phone}: ${code}`, 'INFO');

    // 6. Kirim Kode ke Frontend (Browser)
    // NOTE: sendWaMessage dimatikan/dihapus agar tidak kirim ke WA
    res.json({ 
        success: true, 
        otp_code: code, // <--- Ini yang akan diambil oleh popup SweetAlert
        message: "Kode OTP siap." 
    });
});

app.post('/api/register', async (req, res) => {
    let { username, password, name, phone, otp } = req.body;

    phone = phone.replace(/[^0-9]/g, '');
    if (phone.startsWith('08')) {
        phone = '62' + phone.slice(1);
    } else if (phone.startsWith('01')) {
        phone = '60' + phone.slice(1);
    } else if (phone.startsWith('0')) {
        phone = '62' + phone.slice(1);
    }
    const stored = otpStore.get(phone);
    if (!stored || stored.code != otp || Date.now() > stored.expires) {
        return res.json({ success: false, message: "Kode OTP Salah/Expired" });
    }
    const users = readUsers(); 
    if(users.find(u => u.username === username)) return res.json({ success: false, type: 'username', message: "Username sudah terpakai!" });
    if(users.find(u => u.phone === phone)) return res.json({ success: false, type: 'phone', message: "Nomor ini sudah terdaftar!" });
    const newUser = {
        username, password, name, phone,
        profile_pic: 'images/logo.jpg',
        joined_at: new Date().toISOString()
    };

    users.push(newUser);
    writeUsers(users);
    otpStore.delete(phone); 

    log(`User Website Baru Terdaftar: ${username}`, 'SUCCESS');

    // 1. Notif ke Admin (Telegram)
    let notifMsg = `👤 *MEMBER BARU TERDAFTAR*\n`;
    notifMsg += `━━━━━━━━━━━━━━━━━━\n`;
    notifMsg += `📛 *Nama:* ${name}\n`;
    notifMsg += `🆔 *User:* ${username}\n`;
    notifMsg += `📱 *WA:* ${phone}\n`;
    notifMsg += `📅 *Tgl:* ${new Date().toLocaleString('id-ID')}\n`;
    notifMsg += `━━━━━━━━━━━━━━━━━━\n`;
    notifMsg += `_Segera cek /listuser di bot telegram._`;
    
    await sendTelegramMessage(notifMsg);
    if (sock && process.env.CHANNEL_ID) {
        const webLink = process.env.STORE_LINK || 'https://shop.maneprivate.biz.id'; 
        const maskedUser = username.length > 3 ? username.substring(0, 3) + '****' : username + '**';

        let waMsg = `👤 *NEW MEMBER REGISTRATION*\n`;
        waMsg += `━━━━━━━━━━━━━━━━━━\n\n`;
        waMsg += `Selamat datang member baru! 🎉\n\n`;
        waMsg += `📛 *Nama:* ${name}\n`;
        waMsg += `🆔 *User:* ${maskedUser}\n`; 
        waMsg += `📅 *Join:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n`;
        waMsg += `🛍️ *Akses Website:* ${webLink}\n`; // <--- INI LINK WEBSITE UTAMA
        waMsg += `━━━━━━━━━━━━━━━━━━\n`;
        waMsg += `Amane Community_`;

        try {
            await sock.sendMessage(process.env.CHANNEL_ID, { text: waMsg });
        } catch (e) {
            console.log("Gagal broadcast register ke Channel:", e.message);
        }
    }

    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === username);
    
    if(!user) return res.json({ success: false, type: 'not_found', message: "Akun tidak ditemukan." });
    if(user.password !== password) return res.json({ success: false, type: 'wrong_pass', message: "Password salah!" });

    res.json({ 
        success: true, 
        data: { 
            username: user.username, phone: user.phone, name: user.name,
            profile_pic: user.profile_pic || 'images/logo.jpg'
        } 
    });
});

app.post('/api/user/update', async (req, res) => {
    // TAMBAHKAN newBannerPic DISINI
    const { username, newName, newProfilePic, newBannerPic } = req.body;
    
    const users = readUsers(); 
    const index = users.findIndex(u => u.username === username);
    if(index === -1) return res.json({ success: false, message: "User tidak ditemukan." });

    const user = users[index];
    
    // 1. LOGIKA GANTI NAMA (7 HARI)
    if (newName && newName !== user.name) {
        const now = new Date();
        const lastUpdate = user.last_name_update ? new Date(user.last_name_update) : null;
        
        if (lastUpdate) {
            const diffTime = Math.abs(now - lastUpdate);
            const diffDays = diffTime / (1000 * 60 * 60 * 24);
            if (diffDays < 7) {
                const sisaHari = Math.ceil(7 - diffDays);
                return res.json({ success: false, message: `Ganti nama ditolak. Tunggu ${sisaHari} hari lagi.` });
            }
        }
        users[index].name = newName;
        users[index].last_name_update = now.toISOString();
    }

    // 2. LOGIKA GANTI FOTO PROFIL (AVATAR)
    if (newProfilePic) {
        if(newProfilePic.startsWith('data:image')) {
            try {
                // Upload ke server/CDN (Gunakan logika upload yang sama dengan script Anda)
                const base64Data = newProfilePic.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                const form = new FormData();
                form.append('file', buffer, { filename: 'profile.jpg' }); 
                
                // GANTI URL INI SESUAI API UPLOAD ANDA
                const uploadRes = await axios.post('https://api.shop.maneprivate.biz.id/tools/tourl', form, {
                    headers: { ...form.getHeaders() }
                });

                if(uploadRes.data.status && uploadRes.data.result.url) {
                    users[index].profile_pic = uploadRes.data.result.url;
                }
            } catch (e) {
                console.log("Error upload profil:", e.message);
            }
        } else {
            users[index].profile_pic = newProfilePic;
        }
    }

    // 3. LOGIKA GANTI BANNER (INI YANG PENTING DITAMBAHKAN)
    if (newBannerPic) {
        if(newBannerPic.startsWith('data:image')) {
            try {
                log(`Mengupload banner ${username}...`, 'INFO');
                const base64Data = newBannerPic.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                const form = new FormData();
                form.append('file', buffer, { filename: 'banner.jpg' }); 
                
                // GANTI URL INI SESUAI API UPLOAD ANDA
                const uploadRes = await axios.post('https://api.shop.maneprivate.biz.id/tools/tourl', form, {
                    headers: { ...form.getHeaders() }
                });
                
                if(uploadRes.data.status && uploadRes.data.result.url) {
                    // Simpan URL Banner ke Database JSON
                    users[index].banner_pic = uploadRes.data.result.url; 
                }
            } catch (e) {
                console.log('Gagal upload banner:', e.message);
            }
        }
    }

    // SIMPAN KE FILE USERS.JSON
    writeUsers(users);
    
    // KIRIM BALIK DATA TERBARU KE FRONTEND
    res.json({ 
        success: true, 
        message: "Profil berhasil diperbarui",
        data: users[index] 
    });
});

app.get('/api/products', (req, res) => res.json(readProducts()));

app.get('/api/domains/list', async (req, res) => {
    try {
        const products = readProducts();
        const tldProducts = products.filter(p => p.category === 'tld');
        const cfRes = await cfReq('GET', 'zones?status=active&per_page=100');
        const allZones = cfRes.data.result;

        const readyDomains = [];

        allZones.forEach(zone => {
            const domainName = zone.name; 
            const matchedProduct = tldProducts.find(p => domainName.endsWith(p.name));

            if (matchedProduct) {
            readyDomains.push({
                domain: domainName,
                zone_id: zone.id,
                price: matchedProduct.price,
                productId: matchedProduct.id,
                description: matchedProduct.description || ""
            });
        }
        });

        readyDomains.sort((a, b) => a.domain.localeCompare(b.domain));
        res.json(readyDomains);
    } catch (e) {
        console.log(`Error Fetch Domain: ${e.message}`);
        res.json([]);
    }
});

app.post('/api/domains/check', async (req, res) => {
    const { subdomain, domain, zone_id } = req.body;
    if(!subdomain || !domain || !zone_id) return res.json({ available: false, message: "Data tidak lengkap" });

    try {
        const check = await cfReq('GET', `zones/${zone_id}/dns_records?type=A&name=${subdomain}.${domain}`);
        if (check.data.result.length > 0) {
            return res.json({ available: false, message: "Subdomain sudah terpakai!" });
        }
        res.json({ available: true });
    } catch (e) {
        res.json({ available: false, message: "Gagal koneksi ke Cloudflare." });
    }
});

app.get('/api/my-subdomains/:phone', (req, res) => {
    const db = readDB();
    if(!db.my_subdomains) return res.json([]);
    const subs = db.my_subdomains.filter(s => s.phone === req.params.phone);
    res.json(subs);
});

app.post('/api/check-username', (req, res) => {
    const { username } = req.body;
    const panels = readPanels();
    const exist = panels.find(p => p.username === username && p.status !== 'deleted');
    res.json({ available: !exist });
});


app.get('/api/my-panels/:phone', (req, res) => {
    const panels = readPanels();
    const myPanels = panels.filter(p => p.phone === req.params.phone && p.status !== 'deleted');
    res.json(myPanels);
});
app.get('/api/my-scripts/:phone', (req, res) => {
    const db = readDB();
    if(!db.my_scripts) return res.json([]);
    const scripts = db.my_scripts.filter(s => s.phone === req.params.phone);
    res.json(scripts);
});

app.get('/api/my-courses/:phone', (req, res) => {
    const db = readDB();
    if(!db.my_courses) return res.json([]);
    const courses = db.my_courses.filter(s => s.phone === req.params.phone);
    res.json(courses);
});

app.get('/api/my-vps/:phone', (req, res) => {
    const db = readDB();
    if(!db.my_vps) return res.json([]);
    const list = db.my_vps.filter(s => s.owner_phone === req.params.phone);
    res.json(list);
});

app.get('/api/notifications', (req, res) => {
    const db = readDB();
    const notifs = db.notifications || [];
    res.json(notifs.slice(0, 20));
});

app.get('/api/stats', (req, res) => {
    const db = readDB();
    const users = readUsers();
    const visitors = readVisitors();
    const lastNotif = db.notifications && db.notifications.length > 0 ? db.notifications[0] : null;
    const serverUptime = process.uptime();

    res.json({ 
        visitors: visitors.length,
        transactions: db.transactions,
        total_users: users.length,
        uptime: serverUptime,    
        last_notif: lastNotif
    });
});

app.get('/api/site-info', (req, res) => {
    const db = readDB();
    res.json(db.site_info || null);
});

app.post('/api/promo/check', (req, res) => {
    const { code, category, productId } = req.body; // Terima data produk yg sedang dipilih
    if(!code) return res.json({ success: false, message: "Kode kosong." });

    const db = readDB();
    const promo = db.promo_codes.find(p => p.code === code);

    if(!promo) return res.json({ success: false, message: "Kode tidak ditemukan." });

    // A. Cek Kuota
    if(promo.limit > 0 && promo.used >= promo.limit) return res.json({ success: false, message: "Kuota promo habis!" });

    // B. Cek Tanggal Expired
    if(promo.expired_at) {
        const today = new Date();
        const expDate = new Date(promo.expired_at);
        // Set jam expire ke akhir hari (23:59:59)
        expDate.setHours(23, 59, 59, 999);
        
        if(today > expDate) return res.json({ success: false, message: "Kode promo sudah kadaluarsa!" });
    }

    // C. Cek Kategori (Jika tidak 'all')
    if(promo.valid_category && promo.valid_category !== 'all') {
        if(promo.valid_category !== category) {
            return res.json({ success: false, message: `Kode ini khusus kategori ${promo.valid_category.toUpperCase()}` });
        }
    }

    // D. Cek Spesifik ID Produk (Jika diisi admin)
    if(promo.valid_product_id) {
        if(promo.valid_product_id != productId) {
            return res.json({ success: false, message: "Kode tidak berlaku untuk paket ini." });
        }
    }

    res.json({ success: true, data: promo });
});

app.post('/api/transaction/create', async (req, res) => {
    const { username, phone, productId, category, customData, promoCode } = req.body;
    const db = readDB();
    const products = readProducts();
    
    let productPrice = 0;
    let productName = "";
    let finalCategory = category || 'panel';
    let appliedPromoName = null;

    // 1. TENTUKAN HARGA & NAMA PRODUK DULU
    if (finalCategory === 'subdomain') {
        const tldProduct = products.find(p => p.id == productId);
        // Validasi produk TLD
        if (!tldProduct || !customData.domain.endsWith(tldProduct.name)) {
            return res.json({ success: false, message: "Harga/Domain tidak valid." });
        }
        
        productPrice = tldProduct.price;
        productName = `${customData.subdomain}.${customData.domain}`;
        
        // Cek pending khusus subdomain (opsional, biar gak double order)
        const pending = db.history.find(h => h.username === username && h.item === productName && h.status === 'pending');
        if (pending) return res.json({ success: true, qr_string: pending.qr_string, transaction_id: pending.transaction_id, amount: pending.amount });
    
    } else if (finalCategory === 'vps') {
        const product = products.find(p => p.id == productId);
        productPrice = product.price;
        productName = product.name;
        finalCategory = 'vps';
    } else if (finalCategory === 'app') { 
        const product = products.find(p => p.id == productId);
        if(!product) return res.json({ success: false, message: "Produk error" });
        const stockCount = db.app_stock.filter(s => s.productId == productId).length;
        if(stockCount === 0) {
            return res.json({ success: false, message: "Stok Akun ini sedang HABIS. Tunggu restock." });
        }
        productPrice = product.price;
        productName = product.name;
        finalCategory = 'app';
    } else {
        // Kategori Panel, Script, Course
        const product = products.find(p => p.id == productId);
        if(!product) return res.json({ success: false, message: "Produk tidak ditemukan" });
        
        productPrice = product.price;
        productName = product.name;
        finalCategory = product.category;
    }

    // 2. SET HARGA AWAL (SEBELUM DISKON)
    let finalAmount = productPrice; 

    // 3. LOGIKA PROMO CODE (DITARUH DISINI AGAR BERLAKU UNTUK SEMUA)
    if (promoCode) {
        const promoIndex = db.promo_codes.findIndex(p => p.code === promoCode);
        if (promoIndex !== -1) {
            const promo = db.promo_codes[promoIndex];
            
            // Validasi Server Side (Double Check)
            const today = new Date();
            const expDate = promo.expired_at ? new Date(promo.expired_at) : null;
            if(expDate) expDate.setHours(23, 59, 59, 999);

            const isExpired = expDate && today > expDate;
            const isLimitReached = promo.limit > 0 && promo.used >= promo.limit;
            const isWrongCategory = promo.valid_category !== 'all' && promo.valid_category !== finalCategory;
            const isWrongProduct = promo.valid_product_id && promo.valid_product_id != productId;

            // Jika lolos semua validasi
            if (!isExpired && !isLimitReached && !isWrongCategory && !isWrongProduct) {
                const discountAmount = finalAmount * (promo.discount / 100);
                finalAmount = finalAmount - discountAmount;
                finalAmount = Math.ceil(finalAmount);
                
                db.promo_codes[promoIndex].used += 1; 
                writeDB(db); 
                
                appliedPromoName = `${promo.code} (-${promo.discount}%)`;
            }
        }
    }

    // Pastikan harga tidak minus (Keamanan)
    if (finalAmount < 0) finalAmount = 0; 

    // 4. BUAT TRANSAKSI KE PAYMENT GATEWAY
    try {
        const orderId = `INV${Date.now()}`;
        
        // Request ke Pakasir pakai finalAmount (Harga Diskon)
        const response = await axios.post('https://app.pakasir.com/api/transactioncreate/qris', {
            project: process.env.PAKASIR_SLUG, 
            order_id: orderId, 
            amount: finalAmount, // <-- PENTING: Pakai harga yang sudah didiskon
            api_key: process.env.PAKASIR_API_KEY
        }, { headers: { 'Content-Type': 'application/json' }});

        const data = response.data;
        if(data && data.payment) {
            // Simpan ke Database
            const newTrx = {
                transaction_id: orderId, 
                qr_string: data.payment.payment_number, 
                amount: data.payment.total_payment, // Harusnya sama dengan finalAmount
                username, 
                phone, 
                item: productName, 
                productId: productId, 
                time: new Date().toISOString(), 
                status: 'pending', 
                fee: 0,
                category: finalCategory,
                customData: customData,
                // Tambahkan info promo di catatan transaksi (opsional, buat admin tau)
                note: appliedPromoName ? `Promo: ${appliedPromoName}` : '' 
            };
            
            db.history.unshift(newTrx);
            writeDB(db);
            
            res.json({ 
                success: true, 
                qr_string: data.payment.payment_number, 
                transaction_id: orderId, 
                amount: data.payment.total_payment 
            });
        } else { 
            res.json({ success: false, message: "Gagal generate QR" }); 
        }
    } catch (e) { 
        console.log("Create Trx Error:", e.message); 
        res.status(500).json({ success: false, message: "Server Error" }); 
    }
});

app.post('/api/transaction/check', async (req, res) => {
    const { transaction_id } = req.body;
    const db = readDB();
    const panels = readPanels();
    const products = readProducts();
    const trxIndex = db.history.findIndex(h => h.transaction_id === transaction_id);
    if (trxIndex === -1) return res.json({ status: 'error' });
    const trx = db.history[trxIndex];

    try {
        const url = `https://app.pakasir.com/api/transactiondetail?project=${process.env.PAKASIR_SLUG}&amount=${trx.amount}&order_id=${transaction_id}&api_key=${process.env.PAKASIR_API_KEY}`;
        const response = await axios.get(url);
        const data = response.data;
        if(data.transaction && data.transaction.status === 'completed') {
            if (trx.status === 'success') return res.json({ status: 'completed' });
            db.history[trxIndex].status = 'success';
            const userTrxCount = db.history.filter(h => h.phone === trx.phone && h.status === 'success').length;
            
            let finalItemName = trx.item;
            
            if (trx.category === 'vps') {
                db.my_vps.push({
                    productName: trx.item,
                    owner_phone: trx.phone,
                    purchase_date: new Date().toISOString(),
                    price: trx.amount,
                    status: 'manual_claim'
                });
                let vpsMsg = `╭━━ ⪻ 𝐏𝐄𝐌𝐁𝐀𝐘𝐀𝐑𝐀𝐍 𝐃𝐈𝐓𝐄𝐑𝐈𝐌𝐀 ⪼ ━━╮\n`;
                vpsMsg += `│\n`;
                vpsMsg += `│ 📦 *Item* : ${trx.item}\n`;
                vpsMsg += `│ 💰 *Harga* : Rp ${trx.amount.toLocaleString()}\n`;
                vpsMsg += `│ ✅ *Status* : LUNAS\n`;
                vpsMsg += `│\n`;
                vpsMsg += `╰━━━━━━━━━━━━━━━━━━╯\n\n`;
                vpsMsg += `📢 *LANGKAH SELANJUTNYA:*\n`;
                vpsMsg += `Silakan hubungi Owner untuk proses setup & pengambilan data VPS Anda.\n\n`;
                vpsMsg += `📞 *Chat Owner:* wa.me/${process.env.OWNER_NUMBER || '6289529161314'}?text=Halo+min+saya+sudah+beli+VPS+${trx.transaction_id}`;

                await sendWaMessage(trx.phone, vpsMsg);
                sendTelegramMessage(`🔔 *VPS TERJUAL (MANUAL)*\nBuyer: ${trx.phone}\nItem: ${trx.item}\nStatus: Menunggu Chat Buyer`);

            } 
            else if (trx.category === 'app') {
                const availableStock = db.app_stock.filter(s => s.productId == trx.productId);

                if (availableStock.length > 0) {
                    const randomIndex = Math.floor(Math.random() * availableStock.length);
                    const selectedApp = availableStock[randomIndex];
                    const realIndexInDb = db.app_stock.findIndex(s => s.id === selectedApp.id);
                    if(realIndexInDb !== -1) db.app_stock.splice(realIndexInDb, 1);
                    db.my_apps.push({
                        ...selectedApp,
                        owner_phone: trx.phone,
                        purchase_date: new Date().toISOString(),
                        price: trx.amount
                    });
                    
                    finalItemName = selectedApp.productName;
                    let appMsg = `╭━━ ⪻ 𝐓𝐑𝐀𝐍𝐒𝐀𝐊𝐒𝐈 𝐒𝐔𝐊𝐒𝐄𝐒 ⪼ ━━╮\n`;
                    appMsg += `│\n`;
                    appMsg += `│ ✅ *Status* : LUNAS\n`;
                    appMsg += `│ 📱 *App* : ${selectedApp.productName}\n`;
                    appMsg += `│ 📧 *Email* : ${selectedApp.email}\n`;
                    appMsg += `│ 🔑 *Pass* : ${selectedApp.password}\n`;
                    appMsg += `│ 📝 *Info* : ${selectedApp.description}\n`;
                    appMsg += `│\n`;
                    appMsg += `╰━━━━━━━━━━━━━━━━━━╯\n`;
                    appMsg += `_Simpan data ini! Cek menu "DATA APLIKASI" di website._`;
                    
                    await sendWaMessage(trx.phone, appMsg);
                    log(`App Account Sold to ${trx.phone}`, 'SUCCESS');

                } else {
                    await sendWaMessage(trx.phone, `⚠️ Pembayaran diterima tapi Stok Akun habis. Hubungi Admin.`);
                    sendTelegramMessage(`⚠️ *DARURAT!* User ${trx.phone} bayar APP tapi stok habis!`);
                }
            } else if (trx.category === 'script') {
                 const prod = products.find(p => p.id == trx.productId);
                 if(!db.my_scripts) db.my_scripts = [];
                 
                 if (prod) {
                     db.my_scripts.push({
                         name: prod.name,
                         phone: trx.phone,
                         download_url: prod.download_url,
                         purchase_date: new Date().toISOString()
                     });
                     let scriptMsg = `╭━━ ⪻ 𝐓𝐑𝐀𝐍𝐒𝐀𝐊𝐒𝐈 𝐒𝐔𝐊𝐒𝐄𝐒 ⪼ ━━╮\n`;
                     scriptMsg += `│\n`;
                     scriptMsg += `│ ✅ *Status* : LUNAS\n`;
                     scriptMsg += `│ 📜 *Item* : ${prod.name}\n`;
                     scriptMsg += `│ 💰 *Nominal* : Rp ${trx.amount.toLocaleString()}\n`;
                     scriptMsg += `│ 📅 *Tanggal* : ${new Date().toLocaleDateString()}\n`;
                     scriptMsg += `│\n`;
                     scriptMsg += `╰━━━━━━━━━━━━━━━━━━╯\n`;
                     scriptMsg += `_Terima kasih! Cek menu "DATA SCRIPT" di website untuk download file._`;
                     await sendWaMessage(trx.phone, scriptMsg);
                     
                     log(`Script ${prod.name} Sold to ${trx.phone}`, 'SUCCESS');
                     const maskedPhone = trx.phone.substring(0,4) + '****' + trx.phone.substring(trx.phone.length-3);
                     db.notifications.unshift({
                        title: "Pembelian Script",
                        msg: `${trx.username} membeli script ${prod.name}`, // <-- Pake username
                        time: new Date().toISOString()
                     });

                     // C. LAPORAN KE TELEGRAM OWNER
                     const telegramReport = `🔔 *ORDERAN SCRIPT MASUK!* 🔔\n\n` +
                                            `👤 Buyer: ${trx.phone}\n` + 
                                            `📜 Item: ${prod.name}\n` +
                                            `💰 Harga: Rp ${trx.amount.toLocaleString()}\n` +
                                            `🆔 ID: ${trx.transaction_id}`;
                     sendTelegramMessage(telegramReport);
                 }
            } 
            else if (trx.category === 'course') {
                const prod = products.find(p => p.id == trx.productId);
                if(!db.my_courses) db.my_courses = [];
                
                if (prod) {
                    // Simpan Data
                    db.my_courses.push({
                        name: prod.name,
                        phone: trx.phone,
                        link_url: prod.link_url || '#',
                        purchase_date: new Date().toISOString()
                    });

                    // A. KIRIM WA KE PEMBELI (Estetik)
                    let courseMsg = `╭━━ ⪻ 𝐓𝐑𝐀𝐍𝐒𝐀𝐊𝐒𝐈 𝐒𝐔𝐊𝐒𝐄𝐒 ⪼ ━━╮\n`;
                    courseMsg += `│\n`;
                    courseMsg += `│ ✅ *Status* : LUNAS\n`;
                    courseMsg += `│ 🎓 *Kelas* : ${prod.name}\n`;
                    courseMsg += `│ 💰 *Nominal* : Rp ${trx.amount.toLocaleString()}\n`;
                    courseMsg += `│ 📅 *Tanggal* : ${new Date().toLocaleDateString()}\n`;
                    courseMsg += `│\n`;
                    courseMsg += `╰━━━━━━━━━━━━━━━━━━╯\n`;
                    courseMsg += `_Terima kasih! Cek menu "DATA MURID" di website untuk akses link materi._`;
                    await sendWaMessage(trx.phone, courseMsg);
                    
                    log(`Course ${prod.name} Sold to ${trx.phone}`, 'SUCCESS');

                    // B. NOTIFIKASI LONCENG (WEBSITE)
                    const maskedPhone = trx.phone.substring(0,4) + '****' + trx.phone.substring(trx.phone.length-3);
                    db.notifications.unshift({
                        title: "Pembelian Course",
                        msg: `${trx.username} join kelas ${prod.name}`, // <-- Pake username
                        time: new Date().toISOString()
                    });

                    // C. LAPORAN KE TELEGRAM OWNER
                    const telegramReport = `🔔 *ORDERAN KELAS MASUK!* 🔔\n\n` +
                                           `👤 Buyer: ${trx.phone}\n` + 
                                           `🎓 Item: ${prod.name}\n` +
                                           `💰 Harga: Rp ${trx.amount.toLocaleString()}\n` +
                                           `🆔 ID: ${trx.transaction_id}`;
                    sendTelegramMessage(telegramReport);
                }
            }
                        // ============================================================
            // 3. BAGIAN SUBDOMAIN (FIX: Proxy Off & Privasi Ekstensi Only)
            // ============================================================
            else if (trx.category === 'subdomain') {
                const { subdomain, domain, ip, zone_id } = trx.customData;

                try {
                    await cfReq('POST', `zones/${zone_id}/dns_records`, {
                        type: 'A', name: subdomain, content: ip, ttl: 1, proxied: false 
                    });
                    
                    const randomNode = `node${Math.floor(Math.random() * 900) + 100}`; 
                    const nodeName = `${randomNode}.${subdomain}`;
                    
                    await cfReq('POST', `zones/${zone_id}/dns_records`, {
                        type: 'A', name: nodeName, content: ip, ttl: 1, proxied: false
                    });
                    if(!db.my_subdomains) db.my_subdomains = [];
                    db.my_subdomains.push({
                        subdomain: `${subdomain}.${domain}`,
                        node: `${nodeName}.${domain}`,
                        ip: ip,
                        phone: trx.phone,
                        created_at: new Date().toISOString()
                    });
                    const extensionOnly = domain.split('.').slice(1).join('.'); 
                    finalItemName = `Subdomain .${extensionOnly}`; 
                    let successCap = `╭━━ ⪻ 𝐓𝐑𝐀𝐍𝐒𝐀𝐊𝐒𝐈 𝐒𝐔𝐊𝐒𝐄𝐒 ⪼ ━━╮\n`;
                    successCap += `│\n`;
                    successCap += `│ ✅ *Status* : LUNAS\n`;
                    successCap += `│ 🌐 *Domain* : ${subdomain}.${domain}\n`;
                    successCap += `│ 💰 *Nominal* : Rp ${trx.amount.toLocaleString()}\n`;
                    successCap += `│ 📅 *Tanggal* : ${new Date().toLocaleDateString()}\n`;
                    successCap += `│\n`;
                    successCap += `╰━━━━━━━━━━━━━━━━━━╯\n`;
                    successCap += `_Terima kasih! Cek menu "DATA SUBDOMAIN" di website untuk detail IP & Node._`;
                    
                    await sendWaMessage(trx.phone, successCap);
                    const maskedPhone = trx.phone.substring(0,4) + '****' + trx.phone.substring(trx.phone.length-3);
                    db.notifications.unshift({
                        title: "Pembelian Subdomain",
                        msg: `${trx.username} sukses membeli domain .${extensionOnly}`, 
                        time: new Date().toISOString()
                    });

                    log(`Subdomain ${subdomain}.${domain} Created via CF API`, 'SUCCESS');
                    const telegramReport = `🔔 *ORDERAN DOMAIN MASUK!* 🔔\n\n` +
                                           `👤 Buyer: ${trx.phone}\n` +
                                           `🌐 Domain: ${subdomain}.${domain}\n` +
                                           `💰 Harga: Rp ${trx.amount.toLocaleString()}\n` +
                                           `🆔 ID: ${trx.transaction_id}`;
                    sendTelegramMessage(telegramReport);

                } catch (e) {
                    log(`CF API Error: ${e.response?.data?.errors[0]?.message || e.message}`, 'ERROR');
                    await sendWaMessage(trx.phone, `⚠️ Transaksi LUNAS, tapi gagal create domain otomatis (IP Invalid/Koneksi). Hubungi Admin.`);
                }
            } 

            // ============================================================
            // 4. BAGIAN PANEL (LOGIKA LAMA)
            // ============================================================
            else {
                const existingPanelIndex = panels.findIndex(p => p.username === trx.username && p.status !== 'deleted');
                if (existingPanelIndex !== -1) {
                    // --- LOGIKA RENEW (PERPANJANG) ---
                    const panel = panels[existingPanelIndex];
                    
                    let currentExp = new Date(panel.expired_date);
                    const now = new Date();
                    if (currentExp < now) currentExp = now; 
                    currentExp.setDate(currentExp.getDate() + 30);
                    
                    panels[existingPanelIndex].expired_date = currentExp.toISOString();
                    panels[existingPanelIndex].status = 'active'; 

                    try {
                        await axios.post(`${process.env.PTERO_DOMAIN}/api/application/servers/${panel.server_id}/unsuspend`, {}, 
                        { headers: { "Authorization": `Bearer ${process.env.PTERO_API_KEY}` }});
                        log(`Server ${trx.username} Unsuspended (Renewed)`, 'SUCCESS');
                    } catch (e) {}

                    let sizeName = (panel.ram / 1024) >= 1 ? (panel.ram / 1024) + 'GB' : panel.ram + 'MB';
                    finalItemName = `Perpanjang Panel ${sizeName}`;
                    db.history[trxIndex].item = finalItemName;
                    trx.item = finalItemName;

                    const maskedPhone = trx.phone.substring(0,4) + '****' + trx.phone.substring(trx.phone.length-3);
                    db.notifications.unshift({
                        title: "Perpanjangan Sukses",
                        msg: `${trx.username} berhasil perpanjang panel.`, // <-- Pake username
                        time: new Date().toISOString()
                    });

                } 
                else {
                    // --- LOGIKA CREATE NEW PANEL ---
                    const product = products.find(p => p.id == trx.productId);
                    
                    if (product) {
                        finalItemName = product.name;
                        const randomDigits = Math.floor(1000 + Math.random() * 9000);
                        const password = `${trx.username}${randomDigits}`;
                        const pteroEmail = `${trx.username}@gmail.com`; 
                        const serverName = `${trx.username} server`;
                        let pteroId = await createPteroUser(pteroEmail, trx.username, password);
                        
                        if(pteroId) {
                            const createDate = new Date();
                            const expDate = new Date(); 
                            expDate.setDate(expDate.getDate() + 30); 
                            const options = { 
                                timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', 
                                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false 
                            };
                            const createdStr = createDate.toLocaleString('en-CA', options).replace(/, /g, ' '); 
                            const expiredStr = expDate.toLocaleString('en-CA', options).replace(/, /g, ' ');
                            const serverDesc = `Tanggal Dibuat: ${createdStr} Tanggal Kedaluwarsa: ${expiredStr} Powered by AmaneOfc`;
                            const server = await createPteroServer(pteroId, product, serverName, serverDesc);
                            
                            panels.push({ 
                                username: trx.username, 
                                password: password, 
                                phone: trx.phone, 
                                server_id: server?.id, 
                                created_at: createDate.toISOString(),
                                expired_date: expDate.toISOString(), 
                                ram: product.ram, disk: product.disk, cpu: product.cpu,
                                price: product.price, productId: product.id, 
                                login_url: process.env.PTERO_DOMAIN,
                                status: 'active' 
                            });

                            // Notif Lonceng
                            const maskedPhone = trx.phone.substring(0,4) + '****' + trx.phone.substring(trx.phone.length-2);
                            db.notifications.unshift({
                                title: "Pembelian Baru",
                                msg: `${trx.username} membeli ${trx.item}`, // <-- Pake username
                                time: new Date().toISOString()
                            });

                            // Laporan Telegram
                            const telegramReport = `🔔 *ORDERAN BARU!* 🔔\n\n👤 Buyer: ${trx.phone}\n📦 Item: ${trx.item}\n💰 Harga: Rp ${trx.amount.toLocaleString()}\n🔢 Trx Ke: ${userTrxCount}\n🆔 ID: ${trx.transaction_id}`;
                            sendTelegramMessage(telegramReport);

                            log(`Panel ${trx.username} Created!`, 'SUCCESS');
                            
                            // WA ke Pembeli
                            let successCap = `╭━━ ⪻ 𝐓𝐑𝐀𝐍𝐒𝐀𝐊𝐒𝐈 𝐒𝐔𝐊𝐒𝐄𝐒 ⪼ ━━╮\n`;
                            successCap += `│\n`;
                            successCap += `│ ✅ *Status* : LUNAS\n`;
                            successCap += `│ 📦 *Item* : ${finalItemName}\n`;
                            successCap += `│ 💰 *Nominal* : Rp ${trx.amount.toLocaleString()}\n`;
                            successCap += `│ 📅 *Expired* : ${expDate.toLocaleDateString()}\n`;
                            successCap += `│\n`;
                            successCap += `╰━━━━━━━━━━━━━━━━━━╯\n`;
                            successCap += `_Terima kasih! Cek menu "DATA PANEL" di website untuk detail login._`;
                            
                            await sendWaMessage(trx.phone, successCap);
                        }
                    }
                }
            }
            db.transactions += 1;
            if(process.env.CHANNEL_ID) {
                const maskedPhone = trx.phone.substring(0,4) + '****' + trx.phone.substring(trx.phone.length-3);
                const trxDate = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
                let testiText = `❖ 【 𝐓𝐑𝐀𝐍𝐒𝐀𝐊𝐒𝐈 𝐒𝐄𝐋𝐄𝐒𝐀𝐈 】 ❖\n`;
                testiText += `╭━━━━━━━━━━━━━━━━━━━\n`;
                testiText += `┣🆔 𝐎𝐫𝐝𝐞𝐫 𝐈𝐃 : #${trx.transaction_id}\n`;
                testiText += `┣📦 𝐋𝐚𝐲𝐚𝐧𝐚𝐧  : ${finalItemName}\n`;
                testiText += `┣💰 𝐇𝐚𝐫𝐠𝐚    : Rp ${trx.amount.toLocaleString()}\n`;
                testiText += `┣👤 𝐁𝐮𝐲𝐞𝐫    : ${maskedPhone}\n`;
                testiText += `┣🆙 𝐔𝐫𝐮𝐭𝐚𝐧   : ${db.transactions}\n`;
                testiText += `┣📅 𝐓𝐚𝐧𝐠𝐠𝐚𝐥  : ${trxDate}\n`;
                testiText += `┣🔄 𝐒𝐭𝐚𝐭𝐮𝐬   : Terkirim\n`;
                testiText += `╰━━━━━━━━━━━━━━━━━━━\n\n`;
                testiText += `Terima kasih atas kepercayaannya.\n`;
                testiText += `Setiap orderan adalah kehormatan bagi kami,\ndan kami akan selalu hadir untuk memberikan layanan terbaik.\n`;
                testiText += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                testiText += `• 𝐂𝐞𝐤 & 𝐎𝐫𝐝𝐞𝐫:\n${process.env.STORE_LINK || 'https://shop.maneprivate.biz.id'}\n`;
                testiText += `• 𝐂𝐨𝐧𝐭𝐚𝐜𝐭 𝐀𝐝𝐦𝐢𝐧:\nwa.me/6289529161314\n`;
                testiText += `\n—© Created with pride by AmaneOfc`;
                await sendTestiToChannel(testiText);
            }
            writeDB(db);
            writePanels(panels); 
            backupToTelegram();
            
            return res.json({ status: 'success' });
        }
        if (trx.status === 'canceled') return res.json({ status: 'canceled' });
        return res.json({ status: 'pending' });

    } catch (e) { 
        log(`Error Check Trx: ${e.message}`, 'ERROR');
        return res.json({ status: 'error' }); 
    }
});

app.post('/api/transaction/cancel', async (req, res) => {
    const { transaction_id } = req.body;
    const db = readDB();
    const trxIndex = db.history.findIndex(h => h.transaction_id === transaction_id);
    if (trxIndex !== -1) {
        db.history[trxIndex].status = 'canceled';
        writeDB(db);
    }
    try {
        await axios.post('https://app.pakasir.com/api/transactioncancel', {
            project: process.env.PAKASIR_SLUG, order_id: transaction_id, api_key: process.env.PAKASIR_API_KEY
        }, { headers: { 'Content-Type': 'application/json' }});
    } catch (e) {}
    res.json({ success: true });
});

app.post('/api/rental/reset', async (req, res) => {
    const { username, server_uuid } = req.body; 
    
    try {
        log(`Mereset sesi server ${username}...`, 'WARN');
        await pteroClientReq('POST', `${server_uuid}/power`, { signal: 'kill' });
        await new Promise(r => setTimeout(r, 2000));
        try {
            await pteroClientReq('POST', `${server_uuid}/files/delete`, { 
                root: '/', 
                files: ['auth_info_baileys', 'creds.json', 'session', 'store.json'] 
            });
        } catch(e) {}
        await pteroClientReq('POST', `${server_uuid}/power`, { signal: 'start' });

        res.json({ success: true, message: "Sesi berhasil dihapus! Bot sedang restart, tunggu kode baru." });

    } catch (e) {
        log(`Gagal Reset Sesi: ${e.message}`, 'ERROR');
        res.json({ success: false, message: "Gagal mereset server. Hubungi Admin." });
    }
});


app.get('/api/history/:phone', (req, res) => {
    const db = readDB();
    let filteredHistory = db.history.filter(h => {
        if (h.phone !== req.params.phone) return false;
        if (h.is_renewal === true && h.status === 'pending') return false; 
        return true;
    });
    filteredHistory.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json(filteredHistory);
});

const isAdmin = (req, res, next) => {
    const { pin } = req.headers;
    if(pin !== ADMIN_PIN) return res.json({ success: false, message: "PIN Salah!" });
    next();
};

app.get('/api/admin/all-panels', isAdmin, async (req, res) => {
    const panels = readPanels(); 
    const { sync } = req.query;

    if(sync === 'true') {
        log("Admin melakukan Sync Status Pterodactyl...", "INFO");
        let updatedCount = 0;
        
        for (let i = 0; i < panels.length; i++) {
            const p = panels[i];
            try {
                const pteroRes = await axios.get(`${process.env.PTERO_DOMAIN}/api/application/servers/${p.server_id}`, 
                    { headers: { "Authorization": `Bearer ${process.env.PTERO_API_KEY}` }});
                
                const isSuspended = pteroRes.data.attributes.suspended;
                const realStatus = isSuspended ? 'suspended' : 'active';
                if(p.status !== realStatus) {
                    panels[i].status = realStatus;
                    updatedCount++;
                }
            } catch (e) {
                if(e.response && e.response.status === 404) {
                    if(panels[i].status !== 'deleted_in_ptero') {
                        panels[i].status = 'deleted_in_ptero';
                        updatedCount++;
                    }
                }
            }
        }
        if(updatedCount > 0) writePanels(panels);
    }
    
    res.json({ success: true, data: panels });
});
app.post('/api/admin/delete-panel', isAdmin, async (req, res) => {
    const { server_id } = req.body;
    const panels = readPanels(); 
    const index = panels.findIndex(p => p.server_id == server_id);
    if(index === -1) return res.json({ success: false, message: "Panel tidak ditemukan di Database." });

    const pteroHeader = { headers: { "Authorization": `Bearer ${process.env.PTERO_API_KEY}` }};
    try {
        let pteroUserId = null;
        try {
            const serverInfo = await axios.get(`${process.env.PTERO_DOMAIN}/api/application/servers/${server_id}`, pteroHeader);
            pteroUserId = serverInfo.data.attributes.user;
        } catch(e) {}
        try { await axios.delete(`${process.env.PTERO_DOMAIN}/api/application/servers/${server_id}`, pteroHeader); } catch(e) {}
        
        if(pteroUserId) { 
            try { await axios.delete(`${process.env.PTERO_DOMAIN}/api/application/users/${pteroUserId}`, pteroHeader); } catch(e) {} 
        }
        
        panels.splice(index, 1);
        writePanels(panels); 

        log(`Admin menghapus panel ID ${server_id}`, 'WARN');
        res.json({ success: true, message: "Server & User Ptero Berhasil Dihapus Total!" });

    } catch (e) {
        panels.splice(index, 1);
        writePanels(panels); 
        res.json({ success: true, message: "Terhapus dari DB Lokal (Error koneksi Ptero)." });
    }
});

app.post('/api/admin/clear-notifs', isAdmin, (req, res) => {
    const db = readDB();
    db.notifications = []; 
    writeDB(db);
    log("Admin membersihkan notifikasi website.", "WARN");
    res.json({ success: true, message: "Semua notifikasi berhasil dihapus." });
});

app.get('/api/admin/users', isAdmin, (req, res) => {
    const users = readUsers();
    res.json({ success: true, data: users });
});

app.post('/api/admin/delete-user', isAdmin, (req, res) => {
    const { phone } = req.body;
    const users = readUsers();
    const index = users.findIndex(u => u.phone === phone);
    
    if(index === -1) return res.json({ success: false, message: "User tidak ditemukan." });
    
    const deletedName = users[index].name;
    users.splice(index, 1);
    writeUsers(users);
    
    log(`Admin menghapus user ${deletedName}`, 'WARN');
    res.json({ success: true, message: "User berhasil dihapus." });
});

app.post('/api/admin/product/add', isAdmin, (req, res) => {
    const { category, name, price, ram, disk, cpu, link_url, description, download_url, menu_preview } = req.body;
    
    const products = readProducts();
    const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
    const createdAt = new Date().toISOString();

    let newProduct = { id: newId, category, name, price: parseInt(price), created_at: createdAt };

    if(category === 'panel') {
        newProduct.ram = parseInt(ram);
        newProduct.disk = parseInt(disk);
        newProduct.cpu = parseInt(cpu);
    } else if (category === 'script') {
        newProduct.download_url = download_url || '#';
        newProduct.menu_preview = menu_preview || '';
    } else if (category === 'course') {
        newProduct.link_url = link_url || '#';
        newProduct.description = description || '';
    } 
    // TAMBAHAN LOGIKA VPS
    else if (category === 'vps') {
        newProduct.description = description || 'VPS High Performance';
        // RAM/Spek dianggap masuk ke 'name' atau 'description' sesuai permintaan user
    }

    products.push(newProduct);
    writeProducts(products);
    
    res.json({ success: true, message: "Produk berhasil ditambah!" });
});

app.post('/api/admin/product/delete', isAdmin, (req, res) => {
    const { id } = req.body;
    const products = readProducts();
    const index = products.findIndex(p => p.id === parseInt(id));
    
    if(index === -1) return res.json({ success: false, message: "Produk tidak ditemukan." });
    
    products.splice(index, 1);
    writeProducts(products);
    
    res.json({ success: true, message: "Produk berhasil dihapus." });
});

app.get('/api/admin/rekap', isAdmin, (req, res) => {
    const db = readDB();
    const users = readUsers();
    const visitors = readVisitors();
    
    const totalOmset = db.history
        .filter(h => h.status === 'success')
        .reduce((acc, curr) => acc + curr.amount, 0);

    const successTrx = db.history.filter(h => h.status === 'success').length;
    const pendingTrx = db.history.filter(h => h.status === 'pending').length;
    const canceledTrx = db.history.filter(h => h.status === 'canceled').length;
    const lastTransactions = db.history.slice(0, 50); 

    res.json({
        success: true,
        data: {
            omset: totalOmset,
            total_users: users.length,
            total_visitors: visitors.length,
            success_trx: successTrx,
            pending_trx: pendingTrx,
            canceled_trx: canceledTrx,
            history: lastTransactions, 
            uptime: process.uptime()
        }
    });
});

app.post('/api/admin/broadcast', isAdmin, async (req, res) => {
    const { message } = req.body;
    if(!message) return res.json({ success: false, message: "Pesan kosong." });

    const db = readDB();
    db.notifications.unshift({
        title: "📢 INFO ADMIN",
        msg: message,
        time: new Date().toISOString()
    });
    writeDB(db);
    if (sock && process.env.CHANNEL_ID) {
        const webLink = process.env.STORE_LINK || 'https://shop.maneprivate.biz.id';

        let waMsg = `🔔 *OFFICIAL ANNOUNCEMENT* 🔔\n`;
        waMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
        waMsg += `${message}\n\n`;
        waMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
        waMsg += `🛒 *BUTUH KEBUTUHAN DIGITAL?*\n`;
        waMsg += `Akses website kami untuk order otomatis 24 Jam:\n`;
        waMsg += `👉 ${webLink}\n\n`;
        waMsg += `_Terima kasih telah berlangganan._\n`;
        waMsg += `_© AmaneOfc System_`;

        try { await sock.sendMessage(process.env.CHANNEL_ID, { text: waMsg }); } catch(e) {}
    }

    res.json({ success: true, message: "Info berhasil disebar!" });
});

app.post('/api/admin/product/update', isAdmin, async (req, res) => {
    const { id, name, price, ram, disk, cpu, link_url, description, download_url, menu_preview } = req.body;
    
    const products = readProducts();
    const db = readDB();
    const index = products.findIndex(p => p.id === parseInt(id));

    if(index === -1) return res.json({ success: false, message: "Produk tidak ditemukan." });

    const oldName = products[index].name;
    const oldPrice = products[index].price;
    products[index].name = name;
    products[index].price = parseInt(price);

    const category = products[index].category;
    let detailMsg = "";

    if(category === 'panel') {
        products[index].ram = parseInt(ram);
        products[index].disk = parseInt(disk);
        products[index].cpu = parseInt(cpu);
        detailMsg = `⚙️ *Spek Update:* RAM ${ram}MB | CPU ${cpu}%`;
    } else if (category === 'script') {
        products[index].download_url = download_url;
        products[index].menu_preview = menu_preview;
        detailMsg = `⚡ *Info:* Fitur Script Telah Diperbarui`;
    } else if (category === 'course') {
        products[index].link_url = link_url;
        products[index].description = description;
        detailMsg = `🎓 *Info:* Materi/Link Kelas Diperbarui`;
    }

    writeProducts(products);
    db.notifications.unshift({ 
        title: "🔄 UPDATE PRODUK", 
        msg: `Produk ${name} telah diperbarui (Harga/Spek). Cek sekarang!`, 
        time: new Date().toISOString() 
    });
    writeDB(db);
    if (sock && process.env.CHANNEL_ID) {
        let priceStatus = "";
        if (parseInt(price) < oldPrice) priceStatus = "⬇️ *TURUN HARGA!*";
        else if (parseInt(price) > oldPrice) priceStatus = "⬆️ *HARGA NAIK*";
        else priceStatus = "🏷️ *HARGA TETAP*";

        let broadcast = `🔄 *UPDATE INFORMASI PRODUK*\n`;
        broadcast += `━━━━━━━━━━━━━━━━━━\n\n`;
        broadcast += `Halo member, ada pembaruan pada produk berikut:\n\n`;
        broadcast += `📦 *${name}*\n`;
        broadcast += `${priceStatus} : Rp ${parseInt(price).toLocaleString()}\n`;
        broadcast += `${detailMsg}\n\n`;
        broadcast += `🛒 *Cek Detail di Website:*\n`;
        broadcast += `${process.env.STORE_LINK || 'https://shop.maneprivate.biz.id'}\n\n`;
        broadcast += `_Terima kasih!_`;

        try {
            await sock.sendMessage(process.env.CHANNEL_ID, { text: broadcast });
            log(`Notif Update Produk ${name} dikirim ke Channel`, 'SUCCESS');
        } catch (e) {
            console.log("Gagal broadcast update ke WA Channel:", e.message);
        }
    }

    log(`Admin mengupdate produk ID ${id}: ${name}`, 'WARN');
    res.json({ success: true, message: "Produk diperbarui & Notifikasi dikirim!" });
});

app.post('/api/admin/vps/add', isAdmin, (req, res) => {
    // HAPUS 'description' DARI REQUEST BODY, KITA AMBIL DARI PRODUK
    const { productId, ip, password } = req.body;
    if(!productId || !ip || !password) return res.json({ success: false, message: "Data tidak lengkap" });

    const db = readDB();
    const products = readProducts();
    const prod = products.find(p => p.id == productId);
    
    if(!prod) return res.json({ success: false, message: "ID Produk tidak valid" });

    db.vps_stock.push({
        id: Date.now(), // ID Unik Stok
        productId: parseInt(productId),
        productName: prod.name,
        ip: ip,
        password: password,
        // AMBIL DESKRIPSI DARI PRODUK UTAMA, BUKAN INPUT MANUAL LAGI
        description: prod.description || "-", 
        added_at: new Date().toISOString()
    });
    
    writeDB(db);
    res.json({ success: true, message: "Stok VPS berhasil ditambahkan!" });
});

app.get('/api/admin/vps/stock', isAdmin, (req, res) => {
    const db = readDB();
    // Kita kirim data stok
    res.json({ success: true, data: db.vps_stock });
});

app.post('/api/admin/vps/delete', isAdmin, (req, res) => {
    const { id } = req.body;
    const db = readDB();
    const idx = db.vps_stock.findIndex(s => s.id == id);
    if(idx !== -1) {
        db.vps_stock.splice(idx, 1);
        writeDB(db);
        res.json({ success: true, message: "Stok dihapus." });
    } else {
        res.json({ success: false, message: "Stok tidak ditemukan." });
    }
});

app.post('/api/reset/otp', async (req, res) => {
    let { phone } = req.body;
    if(!phone) return res.json({ success: false, message: "Nomor kosong" });
    phone = phone.replace(/[^0-9]/g, '');
    phone = phone.replace(/[^0-9]/g, '');
if (phone.startsWith('08')) {
    phone = '62' + phone.slice(1); 
} else if (phone.startsWith('01')) {
    phone = '60' + phone.slice(1);
} else if (phone.startsWith('0')) {
    phone = '62' + phone.slice(1);
}

    const users = readUsers();
    const user = users.find(u => u.phone === phone);
    if(!user) return res.json({ success: false, message: "Nomor ini belum terdaftar." });
    const code = Math.floor(1000 + Math.random() * 9000);
    otpStore.set(phone, { code, expires: Date.now() + 60000 * 1 });
    let msg = `🔐 *RESET PASSWORD*\n\n`;
    msg += `Kode verifikasi Anda: *${code}*\n`;
    msg += `Gunakan kode ini untuk mengatur ulang kata sandi.\n\n`;
    msg += `_Abaikan pesan ini jika Anda tidak meminta reset._`;

    await sendWaMessage(phone, msg);
    res.json({ success: true });
});
app.post('/api/reset/check-otp', (req, res) => {
    let { phone, otp } = req.body;
    phone = phone.replace(/[^0-9]/g, '');
if (phone.startsWith('08')) {
    phone = '62' + phone.slice(1);
} else if (phone.startsWith('01')) {
    phone = '60' + phone.slice(1); 
} else if (phone.startsWith('0')) {
    phone = '62' + phone.slice(1);
}
    const stored = otpStore.get(phone);
    if (!stored || stored.code != otp || Date.now() > stored.expires) {
        return res.json({ success: false, message: "OTP Salah/Expired" });
    }
    res.json({ success: true });
});
app.post('/api/reset/save', (req, res) => {
    let { phone, otp, newPassword } = req.body;
    phone = phone.replace(/[^0-9]/g, '');
if (phone.startsWith('08')) {
    phone = '62' + phone.slice(1);
} else if (phone.startsWith('01')) {
    phone = '60' + phone.slice(1);
} else if (phone.startsWith('0')) {
    phone = '62' + phone.slice(1);
}
    const stored = otpStore.get(phone);
    if (!stored || stored.code != otp) {
        return res.json({ success: false, message: "Sesi Validasi Habis. Ulangi." });
    }

    const users = readUsers();
    const index = users.findIndex(u => u.phone === phone);
    
    if(index === -1) return res.json({ success: false, message: "User error" });

    users[index].password = newPassword;
    writeUsers(users);

    otpStore.delete(phone);

    log(`User ${users[index].username} berhasil reset password.`, 'WARN');
    res.json({ success: true });
});

app.post('/api/rental/get-code', async (req, res) => {
    const { server_uuid } = req.body;
    try {
        const fileRes = await pteroClientReq('GET', `${server_uuid}/files/contents?file=pairing_code.txt`);
        const code = fileRes.data;
        pteroClientReq('POST', `${server_uuid}/power`, { signal: 'start' }).catch(()=>{});

        res.json({ success: true, code: code });
    } catch (e) {
        res.json({ success: false, message: "Kode belum muncul. Tunggu sebentar atau klik 'Reset Sesi'." });
    }
});

app.get('/api/reviews/:productId', (req, res) => {
    const db = readDB();
    const reviews = db.reviews || [];
    const users = readUsers();
    const productReviews = reviews.filter(r => r.productId == req.params.productId);
    const responseData = productReviews.map(r => {
        const userProfile = users.find(u => u.username === r.username);
        const userTrxCount = db.history.filter(h => 
            h.username === r.username && h.status === 'success'
        ).length;

        return {
            ...r,
            userPic: userProfile ? (userProfile.profile_pic || 'images/logo1.jpg') : 'images/logo1.jpg',
            isLoyal: userTrxCount >= 50, 
            reactions: r.reactions || { love:[], like:[], dislike:[] },
            replies: r.replies || []
        };
    });
    
    res.json(responseData);
});

app.post('/api/reviews/add', (req, res) => {
    const { username, productId, rating, comment } = req.body;
    if(!username || !productId || !rating || !comment) return res.json({ success: false, message: "Data tidak lengkap" });

    if (isToxic(comment)) {
        return res.json({ success: false, message: "Komentar mengandung kata kasar/dilarang!" });
    }

    const products = readProducts();
    const product = products.find(p => p.id == productId);
    const isReviewActive = (product.allowReview !== false); 
    if(!isReviewActive) {
        return res.json({ success: false, message: "Komentar di produk ini dinonaktifkan developer." });
    }

    const db = readDB();
    const userLastReview = db.reviews.find(r => r.username === username && r.productId == parseInt(productId));
    
    if (userLastReview) {
        const lastDate = new Date(userLastReview.date).getTime();
        const now = new Date().getTime();
        const diff = now - lastDate;
        const oneDay = 24 * 60 * 60 * 1000;

        if (diff < oneDay) {
            const remaining = oneDay - diff;
            return res.json({ 
                success: false, 
                message: `Tunggu ${formatRemainingTime(remaining)} lagi untuk komentar di produk ini.` 
            });
        }
    }
    const users = readUsers();
    const userConfig = users.find(u => u.username === username);
    const userPic = userConfig ? (userConfig.profile_pic || 'images/logo1.jpg') : 'images/logo1.jpg';

    const newReview = {
        id: Date.now(),
        username,
        productId: parseInt(productId),
        rating: parseInt(rating),
        comment,
        userPic,
        date: new Date().toISOString(),
        replies: [],
        reactions: { love: [], like: [], dislike: [] }
    };

    db.reviews.unshift(newReview);
    writeDB(db);
    res.json({ success: true, message: "Ulasan berhasil dikirim!", data: newReview });
});
app.post('/api/admin/product/toggle-review', isAdmin, (req, res) => {
    const { id } = req.body;
    const products = readProducts();
    const index = products.findIndex(p => p.id == id);
    
    if(index === -1) return res.json({ success: false, message: "Produk tidak ditemukan" });

    const currentStatus = products[index].allowReview !== false; 
    products[index].allowReview = !currentStatus;
    
    writeProducts(products);
    
    const statusText = products[index].allowReview ? "AKTIF" : "NONAKTIF";
    res.json({ success: true, message: `Komentar produk berhasil di-${statusText}.` });
});

app.post('/api/reviews/react', (req, res) => {
    const { reviewId, username, type } = req.body; 
    const db = readDB();
    const index = db.reviews.findIndex(r => r.id == reviewId);
    
    if (index === -1) return res.json({ success: false, message: "Review not found" });

    let reactions = db.reviews[index].reactions;
    if (!reactions) reactions = { love: [], like: [], dislike: [] };
    const userList = reactions[type];
    const userIndex = userList.indexOf(username);

    if (userIndex !== -1) {
        userList.splice(userIndex, 1); 
    } else {
        userList.push(username); 
        if(type === 'like') {
            const disIdx = reactions['dislike'].indexOf(username);
            if(disIdx !== -1) reactions['dislike'].splice(disIdx, 1);
        } else if(type === 'dislike') {
            const likeIdx = reactions['like'].indexOf(username);
            if(likeIdx !== -1) reactions['like'].splice(likeIdx, 1);
        }
    }

    db.reviews[index].reactions = reactions;
    writeDB(db);
    
    res.json({ success: true, reactions: reactions });
});
app.post('/api/admin/review/delete', isAdmin, (req, res) => {
    const { reviewId } = req.body;
    const db = readDB();
    
    const index = db.reviews.findIndex(r => r.id == reviewId);
    if(index === -1) return res.json({ success: false, message: "Review tidak ditemukan." });

    db.reviews.splice(index, 1);
    writeDB(db);

    log(`Admin menghapus review ID ${reviewId}`, 'WARN');
    res.json({ success: true, message: "Review berhasil dihapus." });
});
app.post('/api/admin/review/reply', isAdmin, (req, res) => {
    const { reviewId, replyText } = req.body;
    const db = readDB();
    const index = db.reviews.findIndex(r => r.id == reviewId);
    if (index === -1) return res.json({ success: false, message: "Review tidak ditemukan." });

    if (!db.reviews[index].replies) db.reviews[index].replies = [];
    db.reviews[index].replies.push({ role: 'developer', name: 'Developer', text: replyText, date: new Date().toISOString() });
    
    writeDB(db);
    res.json({ success: true, message: "Balasan terkirim!" });
});
app.get('/api/admin/all-reviews', isAdmin, (req, res) => {
    const db = readDB();
    const products = readProducts();
    const allReviews = db.reviews.map(r => {
        const prod = products.find(p => p.id == r.productId);
        if (!r.reactions) r.reactions = { love: [], like: [], dislike: [] };
        return { ...r, productName: prod ? prod.name : 'Produk Terhapus' };
    });
    res.json({ success: true, data: allReviews });
});

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

app.get('/api/admin/system/scan', isAdmin, (req, res) => {
    const memUsage = process.memoryUsage();
    const otpCount = otpStore.size; 
    const sessionCount = adminSessions.size;
    const tempPlugins = plugins.size; 
    const potentialFreeMem = Math.round(memUsage.heapUsed * 0.15); 

    const junkData = [
        { name: 'Cache OTP & Verifikasi', count: `${otpCount} Item`, size: formatBytes(otpCount * 500) },
        { name: 'Session Admin Idle', count: `${sessionCount} Sesi`, size: formatBytes(sessionCount * 1024) },
        { name: 'System Logs Buffer', count: 'High', size: formatBytes(potentialFreeMem * 0.2) },
        { name: 'Fragmentasi Memori', count: '-', size: formatBytes(potentialFreeMem * 0.8) }
    ];

    const totalJunkSize = otpCount * 500 + sessionCount * 1024 + potentialFreeMem;

    res.json({
        success: true,
        ram_usage: formatBytes(memUsage.rss),
        junk_list: junkData,
        total_junk: formatBytes(totalJunkSize),
        raw_size: totalJunkSize
    });
});

app.post('/api/admin/system/clean', isAdmin, (req, res) => {
    const initialMem = process.memoryUsage().heapUsed;

    otpStore.clear();
    if (global.gc) {
        global.gc();
    }
    Object.keys(require.cache).forEach(function(key) {
        if (!key.includes('node_modules')) delete require.cache[key];
    });

    const finalMem = process.memoryUsage().heapUsed;
    const saved = req.body.estimatedSize || (initialMem - finalMem); 
    const displaySaved = saved > 0 ? formatBytes(saved) : formatBytes(1024 * 1024 * 5);

    log('System Cleaned Manually', 'SYSTEM');
    
    res.json({ 
        success: true, 
        message: `Berhasil membersihkan ${displaySaved} sampah cache & memori.`,
        details: {
            before: formatBytes(initialMem),
            after: formatBytes(finalMem)
        }
    });
});

setInterval(() => {
    log('Menjalankan Auto-Cleaner System...', 'SYSTEM');
    otpStore.clear();
    const mem = process.memoryUsage().rss;
    if (mem > 800 * 1024 * 1024) {
        log('RAM Critical. Cleaning...', 'WARN');
        if (global.gc) global.gc();
    }
}, 60 * 60 * 1000);


app.post('/api/admin/promo/create', isAdmin, (req, res) => {
    // Tambah expired_at, category, product_id
    const { code, discount, limit, expired_at, valid_category, valid_product_id } = req.body;
    
    if(!code || !discount) return res.json({ success: false, message: "Data utama kurang" });

    const db = readDB();
    if(db.promo_codes.find(p => p.code === code)) return res.json({ success: false, message: "Kode sudah ada." });

    db.promo_codes.push({
        id: Date.now(),
        code: code.toUpperCase().replace(/\s/g, ''),
        discount: parseInt(discount),
        limit: parseInt(limit),
        used: 0,
        // Data Baru:
        expired_at: expired_at || null, // Format YYYY-MM-DD
        valid_category: valid_category || 'all', // 'all', 'panel', 'script', etc
        valid_product_id: valid_product_id ? parseInt(valid_product_id) : null, // ID Spesifik (opsional)
        created_at: new Date().toISOString()
    });
    writeDB(db);
    res.json({ success: true, message: "Promo canggih berhasil dibuat!" });
});

app.get('/api/admin/promo/list', isAdmin, (req, res) => {
    const db = readDB();
    res.json({ success: true, data: db.promo_codes || [] });
});

app.post('/api/admin/promo/delete', isAdmin, (req, res) => {
    const { id } = req.body;
    const db = readDB();
    const idx = db.promo_codes.findIndex(p => p.id == id);
    if(idx !== -1) {
        db.promo_codes.splice(idx, 1);
        writeDB(db);
        res.json({ success: true, message: "Promo dihapus." });
    } else {
        res.json({ success: false, message: "Promo tidak ditemukan." });
    }
});

setInterval(() => {
    try {
        const db = readDB();
        if (!db.history || db.history.length === 0) return;

        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        const initialCount = db.history.length;
        const newHistory = db.history.filter(h => {
            const trxDate = new Date(h.time);
            const isPending = h.status === 'pending';
            const isRecent = trxDate > sevenDaysAgo;

            return isPending || isRecent; 
        });
        if (newHistory.length < initialCount) {
            const deletedCount = initialCount - newHistory.length;
            db.history = newHistory;
            writeDB(db);
            console.log(`\x1b[33m[AUTO CLEAN]\x1b[0m Berhasil menghapus ${deletedCount} riwayat transaksi lama (>7 hari).`);
        }
    } catch (e) {
        console.log("Gagal Auto Clean History:", e.message);
    }
}, 24 * 60 * 60 * 1000); 

app.get('/api/top-sultans', (req, res) => {
    // 1. Header Anti-Cache
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", "0");

    try {
        // 2. BACA DATABASE
        let users = [];
        try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch(e) { users = []; }
        
        let db = { history: [] };
        try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) { }

        // Setting Waktu (Reset Tiap Tanggal 1)
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); 

        const accountStats = {};

        if (db.history && Array.isArray(db.history)) {
            db.history.forEach(trx => {
                if (trx.status === 'success') {
                    const trxDate = new Date(trx.time);
                    
                    // --- PERBAIKAN DISINI ---
                    // Kita cari pemilik akun berdasarkan NOMOR HP (trx.phone), BUKAN username panel.
                    // Karena trx.phone pasti nempel ke akun asli.
                    const ownerAccount = users.find(u => u.phone === trx.phone);

                    if (ownerAccount) {
                        // Gunakan Nomor HP sebagai KUNCI UNIK (Key)
                        // Agar walau beli 10 panel beda nama, tetap masuk ke satu orang (Nomor HP ini)
                        const key = ownerAccount.phone; 

                        if (!accountStats[key]) {
                            accountStats[key] = {
                                username: ownerAccount.username, // Ambil Username ASLI Website
                                realName: ownerAccount.name || ownerAccount.username, // Nama ASLI Website
                                profilePic: ownerAccount.profile_pic || 'images/logo1.jpg', // Foto ASLI Website
                                monthlyAmount: 0,
                                lifetimeTrx: 0,
                                lastTrx: trx.time
                            };
                        }

                        // A. HITUNG TOTAL TRANSAKSI (LIFETIME) - Untuk Centang Biru
                        accountStats[key].lifetimeTrx += 1;

                        // B. HITUNG NOMINAL (BULAN INI) - Untuk Peringkat Sultan
                        if (trxDate >= startOfMonth) {
                            accountStats[key].monthlyAmount += parseInt(trx.amount || 0);
                        }

                        // Update waktu transaksi terakhir
                        if (new Date(trx.time) > new Date(accountStats[key].lastTrx)) {
                            accountStats[key].lastTrx = trx.time;
                        }
                    }
                }
            });
        }

        // 4. MAPPING HASIL
        let leaderboard = Object.values(accountStats).map(data => {
            return {
                name: data.realName,
                profile_pic: data.profilePic,
                totalAmount: data.monthlyAmount, 
                trxCount: data.lifetimeTrx,
                lastTrx: data.lastTrx,
                // SYARAT CENTANG BIRU: Transaksi Lifetime >= 50
                isVerified: data.lifetimeTrx >= 50 
            };
        });

        // 5. Urutkan Sultan (Uang Terbanyak Bulan Ini)
        leaderboard.sort((a, b) => b.totalAmount - a.totalAmount);

        // Hanya tampilkan yang ada transaksi bulan ini (Opsional, hapus filter ini jika ingin menampilkan semua member)
        const activeSultans = leaderboard.filter(u => u.totalAmount > 0);

        res.json({ success: true, data: activeSultans.slice(0, 20) });

    } catch (error) {
        console.error("Error API Sultan:", error);
        res.json({ success: false, data: [] });
    }
});


// --- ADMIN API FOR PREMIUM APPS ---

app.post('/api/admin/app/add', isAdmin, (req, res) => {
    const { productId, email, password, description } = req.body;
    if(!productId || !email || !password) return res.json({ success: false, message: "Data tidak lengkap" });

    const db = readDB();
    const products = readProducts();
    const prod = products.find(p => p.id == productId);
    
    if(!prod) return res.json({ success: false, message: "ID Produk tidak valid" });

    db.app_stock.push({
        id: Date.now(),
        productId: parseInt(productId),
        productName: prod.name,
        email: email,
        password: password,
        description: description || "-",
        added_at: new Date().toISOString()
    });
    
    writeDB(db);
    res.json({ success: true, message: "Stok Akun berhasil ditambah!" });
});

app.get('/api/admin/app/stock', isAdmin, (req, res) => {
    const db = readDB();
    res.json({ success: true, data: db.app_stock });
});

app.post('/api/admin/app/delete', isAdmin, (req, res) => {
    const { id } = req.body;
    const db = readDB();
    const idx = db.app_stock.findIndex(s => s.id == id);
    if(idx !== -1) {
        db.app_stock.splice(idx, 1);
        writeDB(db);
        res.json({ success: true, message: "Stok dihapus." });
    } else {
        res.json({ success: false, message: "Stok tidak ditemukan." });
    }
});

// Endpoint User Lihat Data Apps
app.get('/api/my-apps/:phone', (req, res) => {
    const db = readDB();
    if(!db.my_apps) return res.json([]);
    const list = db.my_apps.filter(s => s.owner_phone === req.params.phone);
    res.json(list);
});

// ==========================================
// ⬇️ TELEGRAM BOT INTEGRATION (FULL FITUR) ⬇️
// ==========================================
if (process.env.TELEGRAM_TOKEN) {
    const TelegramBot = require('node-telegram-bot-api');
    const token = process.env.TELEGRAM_TOKEN;
    
    console.log(`[TELEGRAM] Inisialisasi Bot...`);
    const bot = new TelegramBot(token, { 
        polling: {
            interval: 5000,
            autoStart: true,
            params: { timeout: 30 }
        }
    });
    const reply = async (chatId, text, options = {}) => {
        try {
            await bot.sendMessage(chatId, text, options);
        } catch (e) {
            console.log(`[TG SEND ERROR] Gagal kirim pesan ke ${chatId}: ${e.message}`);
        }
    };
    bot.on('polling_error', (error) => {
        if (error.code === 'ETELEGRAM' || error.code === 'EFATAL' || error.code === 'ETIMEDOUT') {
            return; 
        }
        if (error.message.includes('409 Conflict')) {
            console.log(`[BAHAYA] ❌ ADA 2 BOT AKTIF BERSAMAAN! MATIKAN SALAH SATU!`);
        } else {
            console.log(`[TG WARN] ${error.message}`);
        }
    });

    bot.getMe().then((info) => {
        console.log(`\n✅ BOT TELEGRAM READY: @${info.username}`);
        console.log(`   Siap membalas pesan dari Owner ID: ${process.env.TELEGRAM_OWNER_ID}\n`);
    });
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';
        const senderId = msg.from.id.toString();
        const ownerId = process.env.TELEGRAM_OWNER_ID;
        if (senderId !== ownerId) {
            console.log(`[TG AKSES DITOLAK] ID: ${senderId} mencoba akses bot.`);
            return reply(chatId, `⛔ ID Kamu: ${senderId}\nPasang ID ini di file .env (TELEGRAM_OWNER_ID)`);
        }
        
        const args = text.split(' ');
        const command = args.shift().toLowerCase();
        const fullArgs = text.substring(command.length).trim(); 
        
        if (command === '/start' || command === '/menuadmin') {
            let m = `🤖 *ADMIN DASHBOARD (TELEGRAM)* 🤖\n`;
            m += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
            m += `🛍️ *MANAJEMEN PRODUK*\n`;
            m += `🔹 /listproduk - _Lihat Stok_\n`;
            m += `🔹 /addproduk - _Tambah Stok_\n`;
            m += `🔹 /delproduk - _Hapus Stok_\n\n`;
            m += `👥 *MANAJEMEN MEMBER*\n`;
            m += `🔹 /listuser - _Daftar Member_\n`;
            m += `🔹 /deluser - _Hapus Member_\n\n`;
            m += `📢 *SYSTEM*\n`;
            m += `🔹 /info - _Kirim Notif Web_\n`;
            m += `🔹 /rekap - _Cek Statistik_\n\n`;
            m += `🔹 /uptesti - _kirim testimoni_\n\n`;
            m += `🔹 /notifclear - _bersihkan semua notif_\n\n`;
            m += `📝 *CONTOH FORMAT:*\n`;
            m += `• _/addproduk course|Nama|15000|Link|Desc_\n`;
            m += `• _/addproduk panel|Nama|5000|1024|1024|100_\n`;
            m += `• _/deluser 628123xxx_\n`;
            bot.sendMessage(chatId, m, { parse_mode: 'Markdown' });
        }
        
        if (command === '/rekap') {
            const visitors = readVisitors();
            const users = readUsers();
            const db = readDB();
            const successTrx = db.history.filter(h => h.status === 'success').length;
            const pendingTrx = db.history.filter(h => h.status === 'pending').length;
            const totalOmset = db.history.filter(h => h.status === 'success').reduce((a, b) => a + b.amount, 0);

            let m = `📊 *STATISTIK LIVE*\n━━━━━━━━━━━━━━━━\n`;
            m += `👥 Traffic: ${visitors.length}\n`;
            m += `👤 Member: ${users.length}\n`;
            m += `✅ Sukses: ${successTrx}\n`;
            m += `⏳ Pending: ${pendingTrx}\n`;
            m += `💰 Omset: Rp ${totalOmset.toLocaleString()}`;
            bot.sendMessage(chatId, m);
        }

        if (command === '/uptesti') {
            if (!process.env.WA_CHANNEL_ID) return bot.sendMessage(chatId, '❌ WA_CHANNEL_ID belum disetting di .env');
            if (!process.env.TG_CHANNEL_ID) return bot.sendMessage(chatId, '❌ TG_CHANNEL_ID belum disetting di .env');
            const textOrder = fullArgs || 'Script/Panel';
            let photoId = null;
            if (msg.photo) {
                photoId = msg.photo[msg.photo.length - 1].file_id;
            } else if (msg.reply_to_message && msg.reply_to_message.photo) {
                photoId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
            }

            if (!photoId) {
                return bot.sendMessage(chatId, '❌ Kirim foto dengan caption /uptesti [nama] atau reply foto.');
            }

            bot.sendMessage(chatId, '⏳ Sedang memproses kirim ke Telegram & WhatsApp...');

            try {
                const file = await bot.getFile(photoId);
                const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
                
                const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
                const imageBuffer = Buffer.from(response.data);
                
                let captionTG = `🌟 TRANSAKSI SELESAI NEXT ✅
📦 order : ${textOrder} 
━━━━━━━━━━━━━━━
✨ INFO PRODUK AMANE
🔗 https://shop.maneprivate.biz.id

📱 INFO SOSMED
🔗 https://shop.maneprivate.biz.id/

📞 TELE REAL AMANE
➡️ t.me/amaneofc
━━━━━━━━━━━━━━━

🛒 Kami menyediakan berbagai macam kebutuhan JB & Hosting.
Jika berminat dengan produk kami, silakan langsung hubungi nomor di atas.`;

                await bot.sendPhoto(process.env.TG_CHANNEL_ID, photoId, { caption: captionTG });

                if (sock) {
                    let captionWA = `🌟 TRANSAKSI SELESAI NEXT ✅
📦 order : ${textOrder} 
━━━━━━━━━━━━━━━
✨ INFO PRODUK AMANE
🔗 https://shop.maneprivate.biz.id/

📱 INFO SOSMED
🔗 https://shop.maneprivate.biz.id/

📞 NOMOR REAL AMANE
➡️ wa.me/6289529161314
➡️ t.me/amaneofc
━━━━━━━━━━━━━━━

🛒 Kami menyediakan berbagai macam kebutuhan JB & Hosting.
Jika berminat dengan produk kami, silakan langsung hubungi nomor di atas.`;

                    await sock.sendMessage(process.env.WA_CHANNEL_ID, { 
                        image: imageBuffer, 
                        caption: captionWA 
                    });
                    
                    bot.sendMessage(chatId, '✅ SUKSES! Terkirim ke Channel Telegram & WhatsApp.');
                } else {
                    bot.sendMessage(chatId, '⚠️ Terkirim ke Telegram, tapi GAGAL ke WhatsApp (Bot WA belum connect).');
                }

            } catch (error) {
                console.log(error);
                bot.sendMessage(chatId, `❌ Gagal: ${error.message}`);
            }
        }
        
                        if (command === '/notifclear') {
            const db = readDB();
            db.notifications = []; 
            writeDB(db);
            bot.sendMessage(chatId, '✅ *SUKSES*\nSemua notifikasi (lonceng) di website telah dibersihkan menjadi 0.');
            if (sock && process.env.CHANNEL_ID) {
                let msg = `🧹 *SYSTEM CLEANUP*\n━━━━━━━━━━━━━━━━\n\n`;
                msg += `Log notifikasi website telah dibersihkan oleh Admin.\n`;
                msg += `Saat ini status notifikasi lonceng kembali 0 (Bersih).\n\n`;
                msg += `🕒 *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n`;
                msg += `━━━━━━━━━━━━━━━━`;
                
                try {
                    await sock.sendMessage(process.env.CHANNEL_ID, { text: msg });
                } catch (e) {
                    console.log("Gagal broadcast notifclear ke WA Channel:", e.message);
                }
            }
        }

        if (command === '/info') {
            if (!fullArgs) return bot.sendMessage(chatId, '❌ Masukkan teks info.');
            const db = readDB();
            db.notifications.unshift({ title: "📢 INFO DEVELOPER", msg: fullArgs, time: new Date().toISOString() });
            writeDB(db);
            bot.sendMessage(chatId, `✅ Info dikirim ke Lonceng Website & Channel WA:\n"${fullArgs}"`);
            if (sock && process.env.CHANNEL_ID) {
                let msg = `📢 *INFORMASI PENTING*\n━━━━━━━━━━━━━━━━\n\n`;
                msg += `${fullArgs}\n\n`;
                msg += `━━━━━━━━━━━━━━━━\n`;
                msg += `AmaneOfc Info_`;
                
                try {
                    await sock.sendMessage(process.env.CHANNEL_ID, { text: msg });
                } catch (e) {
                    console.log("Gagal broadcast info ke WA Channel:", e.message);
                }
            }
        }
        
        if (command === '/listuser') {
            const users = readUsers();
            if (users.length === 0) return bot.sendMessage(chatId, '📂 Member kosong.');
            const limit = 10;
            const page = args[0] ? parseInt(args[0]) : 1;
            const start = (page - 1) * limit;
            const pageUsers = users.slice(start, start + limit);
            
            let m = `👥 *LIST MEMBER* (Hal ${page})\n━━━━━━━━━━━━━━━━\n`;
            m += pageUsers.map(u => `👤 ${u.name}\n📱 ${u.phone}\n@${u.username}\n`).join('----------------\n');
            if (users.length > start + limit) m += `\n➡️ _Ketik /listuser ${page + 1} untuk next_`;
            
            bot.sendMessage(chatId, m);
        }

        if (command === '/deluser') {
            if (!args[0]) return bot.sendMessage(chatId, '❌ Masukkan No WA. Contoh: /deluser 628xxx');
            const users = readUsers();
            const idx = users.findIndex(u => u.phone === args[0]);
            if (idx === -1) return bot.sendMessage(chatId, '❌ User tidak ditemukan.');
            
            const deleted = users[idx];
            users.splice(idx, 1);
            writeUsers(users);
            bot.sendMessage(chatId, `🗑️ User ${deleted.name} (${deleted.phone}) dihapus.`);
        }

        if (command === '/listproduk') {
            const products = readProducts();
            if (products.length === 0) return bot.sendMessage(chatId, '📂 Produk kosong.');
            
            const limit = 50;
            const page = args[0] ? parseInt(args[0]) : 1;
            const start = (page - 1) * limit;
            const pageProds = products.slice(start, start + limit);
            
            let m = `📦 *LIST PRODUK* (Hal ${page})\n━━━━━━━━━━━━━━━━\n`;
            m += pageProds.map(p => `🆔 ID: ${p.id}\n🔹 ${p.name}\n💰 Rp ${p.price.toLocaleString()}\n🏷️ ${p.category || 'PANEL'}`).join('\n----------------\n');
            if (products.length > start + limit) m += `\n➡️ _Ketik /listproduk ${page + 1} untuk next_`;
            
            bot.sendMessage(chatId, m);
        }

        if (command === '/delproduk') {
            if (!args[0]) return bot.sendMessage(chatId, '❌ Masukkan ID Produk.');
            const products = readProducts();
            const db = readDB();
            const id = parseInt(args[0]);
            const idx = products.findIndex(p => p.id === id);
            
            if (idx === -1) return bot.sendMessage(chatId, '❌ Produk tidak ditemukan.');
            
            const deleted = products[idx];
            products.splice(idx, 1);
            writeProducts(products);
            db.notifications.unshift({ title: "📢 INFO STOK", msg: `Produk ${deleted.name} sudah SOLD OUT.`, time: new Date().toISOString() });
            writeDB(db);
            bot.sendMessage(chatId, `🗑️ Produk ${deleted.name} (ID: ${id}) berhasil dihapus.`);
            if (sock && process.env.CHANNEL_ID) {
                let msg = `📢 *INFO STOK HABIS*\n\n`;
                msg += `Mohon maaf, produk berikut:\n`;
                msg += `📦 *${deleted.name}*\n\n`;
                msg += `Saat ini statusnya sudah *SOLD OUT / HABIS*. 🙏\n`;
                msg += `Nantikan restock selanjutnya!`;
                
                try {
                    await sock.sendMessage(process.env.CHANNEL_ID, { text: msg });
                } catch (e) {
                    console.log("Gagal broadcast delproduk ke WA Channel:", e.message);
                }
            }
        }

                if (command === '/addproduk') {
            const params = fullArgs.split('|');
            if (params.length < 3) return bot.sendMessage(chatId, '❌ Format salah. Lihat /menuadmin');

            const products = readProducts();
            const db = readDB();
            const category = params[0].trim().toLowerCase();
            const name = params[1].trim();
            const price = parseInt(params[2].trim());
            const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
            const createdAt = new Date().toISOString();
            
            let newProduct = null;
            let specsInfo = "";
            if (category === 'script') {
                const link = params[3] ? params[3].trim() : '#';
                const menu = params.slice(4).join('|') || 'Menu n/a';
                newProduct = { id: newId, category: 'script', name, price, download_url: link, menu_preview: menu, created_at: createdAt };
                specsInfo = "⚡ *Fitur:* Script Anti-Delay & Responsive";
            
            } else if (category === 'course') {
                const link = params[3] ? params[3].trim() : '#';
                const desc = params.slice(4).join('|') || 'Info lengkap';
                newProduct = { id: newId, category: 'course', name, price, link_url: link, description: desc, created_at: createdAt };
                specsInfo = "🎓 *Fasilitas:* " + desc.substring(0, 50) + "...";
            
            } else if (category === 'panel') {
                const ram = params[3] ? parseInt(params[3]) : 1024;
                const disk = params[4] ? parseInt(params[4]) : 1024;
                const cpu = params[5] ? parseInt(params[5]) : 100;
                newProduct = { id: newId, category: 'panel', name, ram, disk, cpu, price, created_at: createdAt };
                specsInfo = `⚙️ *Spek:* RAM ${ram}MB | Disk ${disk}MB | CPU ${cpu}%`;
            
            } else {
                return bot.sendMessage(chatId, '❌ Kategori salah. Pilih: panel, script, atau course.');
            }
            if (newProduct) {
                products.push(newProduct);
                writeProducts(products);
                db.notifications.unshift({ 
                    title: "✨ PRODUK BARU!", 
                    msg: `Telah hadir ${name} harga Rp ${price.toLocaleString()}.`, 
                    time: new Date().toISOString() 
                });
                writeDB(db);
                bot.sendMessage(chatId, `✅ Produk *${name}* berhasil ditambah! (ID: ${newId})`, { parse_mode: 'Markdown' });
                if (sock && process.env.CHANNEL_ID) {
                    let broadcast = `✨ *NEW ARRIVAL UPDATE* ✨\n`;
                    broadcast += `━━━━━━━━━━━━━━━━━━\n\n`;
                    broadcast += `📦 *Produk:* ${name}\n`;
                    broadcast += `🏷️ *Kategori:* ${category.toUpperCase()}\n`;
                    broadcast += `💰 *Harga:* Rp ${price.toLocaleString()}\n`;
                    broadcast += `${specsInfo}\n\n`;
                    broadcast += `🔥 *Kelebihan:*\n`;
                    broadcast += `✅ Server Stabil & Cepat\n`;
                    broadcast += `✅ Garansi Full 30 Hari\n`;
                    broadcast += `✅ Support 24/7\n\n`;
                    broadcast += `🛒 *Order Sekarang Disini:*\n`;
                    broadcast += `${process.env.PTERO_DOMAIN || 'https://shop.maneprivate.biz.id'}\n\n`;
                    broadcast += `━━━━━━━━━━━━━━━━━━\n`;
                    broadcast += `AmaneOfc System_`;

                    try {
                        await sock.sendMessage(process.env.CHANNEL_ID, { text: broadcast });
                    } catch (e) {
                        console.log("Gagal broadcast addproduk ke WA Channel:", e.message);
                    }
                }
            }
        }
      });
    console.log("✅ Bot Telegram Aktif & Siap Menerima Perintah!");
}


app.get('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/script', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});
app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});
app.get('/payment', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});
app.get('/trxsultan', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'trxsultan.html'));
});
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});
app.listen(PORT, () => log(`Server Ready Port ${PORT}`, 'INFO'));