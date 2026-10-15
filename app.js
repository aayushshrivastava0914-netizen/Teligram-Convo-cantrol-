require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const TelegramBot = require('node-telegram-bot-api');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 5000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

const AUTH_DIR =
    process.env.WA_AUTH_DIR ||
    path.join(__dirname, 'auth_info');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Website optional; controls are available through Telegram.
app.use(express.static(path.join(__dirname, 'public')));

const users = new Map();

let bot = null;
let waSocket = null;
let waStatus = 'DISCONNECTED';
let loaderRunning = false;
let pairingInProgress = false;

function isOwner(msg) {
    return Boolean(
        msg.from &&
        TELEGRAM_OWNER_ID &&
        String(msg.from.id) === String(TELEGRAM_OWNER_ID)
    );
}

function getUser(id) {
    if (!users.has(id)) {
        users.set(id, {
            step: 'uid',
            uid: '',
            phone: '',
            loaderName: ''
        });
    }

    return users.get(id);
}

function menu() {
    return {
        reply_markup: {
            keyboard: [
                ['🆔 Submit UID'],
                ['📱 Submit WhatsApp Number'],
                ['🏷️ Loader Name'],
                ['🔐 Generate Pairing Code'],
                ['📊 Loader Status'],
                ['▶️ Start Loader', '🛑 Stop Loader']
            ],
            resize_keyboard: true
        }
    };
}

async function send(chatId, message, options = {}) {
    if (!bot) return;

    return bot.sendMessage(chatId, message, options);
}

// WhatsApp connection and pairing.
async function connectWhatsApp(phone, chatId) {
    if (pairingInProgress) {
        return send(
            chatId,
            '⏳ Pairing process already running. Please wait.'
        );
    }

    pairingInProgress = true;
    waStatus = 'CONNECTING';

    try {
        fs.mkdirSync(AUTH_DIR, { recursive: true });

        const { state, saveCreds } =
            await useMultiFileAuthState(AUTH_DIR);

        const { version } = await fetchLatestBaileysVersion();

        waSocket = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu('Chrome')
        });

        waSocket.ev.on('creds.update', saveCreds);

        waSocket.ev.on(
            'connection.update',
            async ({ connection, lastDisconnect }) => {
                if (connection === 'open') {
                    waStatus = 'CONNECTED';
                    pairingInProgress = false;

                    await send(
                        chatId,
                        '✅ WhatsApp successfully connected!',
                        menu()
                    );
                }

                if (connection === 'close') {
                    waStatus = 'DISCONNECTED';
                    pairingInProgress = false;

                    const code =
                        lastDisconnect?.error?.output?.statusCode;

                    if (code === DisconnectReason.loggedOut) {
                        await send(
                            chatId,
                            '⚠️ WhatsApp session logged out. Run /pair to pair again.'
                        );
                    }
                }
            }
        );

        if (!state.creds.registered) {
            await new Promise(resolve => setTimeout(resolve, 1500));

            const pairingCode =
                await waSocket.requestPairingCode(
                    phone.replace(/\D/g, '')
                );

            await send(
                chatId,
                '🔐 WhatsApp Pairing Code:\n\n' +
                `${pairingCode}\n\n` +
                'WhatsApp खोलो → Linked Devices → Link a Device → ' +
                'Link with phone number.\n\n' +
                '⚠️ यह कोड किसी दूसरे व्यक्ति को मत देना।'
            );
        } else {
            await send(
                chatId,
                'ℹ️ Saved WhatsApp session मिली है। Connection status का इंतज़ार करें।'
            );
        }
    } catch (error) {
        pairingInProgress = false;
        waStatus = 'ERROR';

        console.error('WhatsApp pairing error:', error);

        await send(
            chatId,
            '❌ Pairing error: ' + error.message
        );
    }
}

// Health endpoint.
app.get('/health', (req, res) => {
    res.json({
        status: 'ONLINE',
        uptime: Math.floor(process.uptime()),
        whatsapp: waStatus
    });
});

// Status endpoint.
app.get('/stats', (req, res) => {
    res.json({
        status: 'ONLINE',
        whatsapp: waStatus,
        loaderRunning,
        registeredUsers: users.size,
        uptime: Math.floor(process.uptime())
    });
});

// Stop loader state. This does not shut down Render.
app.post('/stop', (req, res) => {
    loaderRunning = false;

    res.json({
        success: true,
        message: 'Loader stopped.'
    });
});

app.get('/', (req, res) => {
    const indexFile = path.join(
        __dirname,
        'public',
        'index.html'
    );

    if (fs.existsSync(indexFile)) {
        return res.sendFile(indexFile);
    }

    res.send('Telegram-controlled service is online.');
});

// Initialize Telegram bot.
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OWNER_ID) {
    console.error(
        'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID environment variable.'
    );
} else {
    bot = new TelegramBot(
        TELEGRAM_BOT_TOKEN,
        { polling: true }
    );

    // Start setup.
    bot.onText(/^\/start$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        const user = getUser(msg.from.id);

        user.step = 'uid';

        await send(
            msg.chat.id,
            '🤖 Welcome!\n\n' +
            'Step 1: अपनी UID भेजो।',
            menu()
        );
    });

    // Pair WhatsApp.
    bot.onText(/^\/pair$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        const user = getUser(msg.from.id);

        if (!user.phone) {
            return send(
                msg.chat.id,
                'पहले /start चलाकर अपना WhatsApp नंबर दर्ज करो।'
            );
        }

        await connectWhatsApp(user.phone, msg.chat.id);
    });

    // Start loader state.
    bot.onText(/^\/startloader$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        const user = getUser(msg.from.id);

        if (!user.uid || !user.phone || !user.loaderName) {
            return send(
                msg.chat.id,
                'पहले /start चलाकर UID, WhatsApp Number और Loader Name पूरा करो।',
                menu()
            );
        }

        if (waStatus !== 'CONNECTED') {
            return send(
                msg.chat.id,
                '❌ WhatsApp connected नहीं है। पहले /pair चलाओ।',
                menu()
            );
        }

        loaderRunning = true;

        await send(
            msg.chat.id,
            `✅ ${user.loaderName} की loader state RUNNING है।\n\n` +
            'ध्यान दें: इस स्क्रिप्ट में automatic messaging engine शामिल नहीं है।',
            menu()
        );
    });

    // Stop loader.
    bot.onText(/^\/stop$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        loaderRunning = false;

        await send(
            msg.chat.id,
            '🛑 Loader stopped. WhatsApp session अभी linked रह सकती है।',
            menu()
        );
    });

    // Status.
    bot.onText(/^\/status$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        const user = getUser(msg.from.id);

        await send(
            msg.chat.id,
            '📊 BOT STATUS\n\n' +
            `Server: ONLINE\n` +
            `Uptime: ${Math.floor(process.uptime())} seconds\n` +
            `WhatsApp: ${waStatus}\n` +
            `Loader: ${loaderRunning ? 'RUNNING' : 'STOPPED'}\n` +
            `UID: ${user.uid ? 'SAVED' : 'NOT SET'}\n` +
            `Phone: ${user.phone ? 'SAVED' : 'NOT SET'}\n` +
            `Loader Name: ${user.loaderName || 'NOT SET'}`,
            menu()
        );
    });

    // Help.
    bot.onText(/^\/help$/, async msg => {
        if (!isOwner(msg)) {
            return send(msg.chat.id, '⛔ Access denied.');
        }

        await send(
            msg.chat.id,
            '📚 COMMANDS\n\n' +
            '/start - Setup\n' +
            '/pair - WhatsApp pairing\n' +
            '/startloader - Start loader state\n' +
            '/status - Check status\n' +
            '/stop - Stop loader state\n' +
            '/help - Help',
            menu()
        );
    });

    // Menu buttons and setup steps.
    bot.on('message', async msg => {
        if (!msg.text || !isOwner(msg)) return;
        if (msg.text.startsWith('/')) return;

        const chatId = msg.chat.id;
        const user = getUser(msg.from.id);
        const text = msg.text.trim();

        if (text === '🆔 Submit UID') {
            user.step = 'uid';
            return send(chatId, 'अपनी UID भेजो:');
        }

        if (text === '📱 Submit WhatsApp Number') {
            user.step = 'phone';
            return send(
                chatId,
                'अपने WhatsApp अकाउंट का नंबर country code सहित भेजो।\nउदाहरण: +91XXXXXXXXXX'
            );
        }

        if (text === '🏷️ Loader Name') {
            user.step = 'loaderName';
            return send(chatId, 'अपना Loader Name भेजो:');
        }

        if (text === '🔐 Generate Pairing Code') {
            if (!user.phone) {
                return send(
                    chatId,
                    'पहले WhatsApp नंबर दर्ज करो।'
                );
            }

            return connectWhatsApp(user.phone, chatId);
        }

        if (text === '📊 Loader Status') {
            return send(
                chatId,
                `WhatsApp: ${waStatus}\nLoader: ${loaderRunning ? 'RUNNING' : 'STOPPED'}`,
                menu()
            );
        }

        if (text === '▶️ Start Loader') {
            if (waStatus !== 'CONNECTED') {
                return send(
                    chatId,
                    'पहले WhatsApp pair करो। /pair चलाओ।',
                    menu()
                );
            }

            loaderRunning = true;

            return send(
                chatId,
                '✅ Loader state RUNNING है।',
                menu()
            );
        }

        if (text === '🛑 Stop Loader') {
            loaderRunning = false;

            return send(
                chatId,
                '🛑 Loader stopped.',
                menu()
            );
        }

        // UID step.
        if (user.step === 'uid') {
            if (text.length < 3 || text.length > 100) {
                return send(
                    chatId,
                    '❌ UID 3 से 100 characters की होनी चाहिए।'
                );
            }

            user.uid = text;
            user.step = 'phone';

            return send(
                chatId,
                '✅ UID saved.\nअब WhatsApp नंबर country code सहित भेजो।'
            );
        }

        // Phone step.
        if (user.step === 'phone') {
            const phone = text.replace(/[\s()-]/g, '');

            if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
                return send(
                    chatId,
                    '❌ Number format सही नहीं है। उदाहरण: +91XXXXXXXXXX'
                );
            }

            user.phone = phone;
            user.step = 'loaderName';

            await send(
                chatId,
                '✅ Number saved.\nअब Loader Name भेजो।'
            );

            return;
        }

        // Loader name step.
        if (user.step === 'loaderName') {
            if (text.length < 2 || text.length > 50) {
                return send(
                    chatId,
                    '❌ Loader Name 2 से 50 characters का होना चाहिए।'
                );
            }

            user.loaderName = text;
            user.step = 'ready';

            return send(
                chatId,
                `✅ Setup complete!\nLoader Name: ${user.loaderName}\n\n` +
                'WhatsApp pairing के लिए /pair चलाओ।',
                menu()
            );
        }

        if (user.step === 'ready') {
            return send
