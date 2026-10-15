const express = require('express');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dashboard files: public/index.html
app.use(express.static(path.join(__dirname, 'public')));

// Track active sessions in memory
const activeSessions = new Map();

// Telegram configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

let telegramBot = null;

// -------------------- WEB DASHBOARD --------------------

// Main dashboard
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');

    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    res.status(404).send('Dashboard file public/index.html not found.');
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// Server statistics
app.get('/stats', (req, res) => {
    res.json({
        status: 'online',
        uptime: Math.floor(process.uptime()),
        activeSessions: activeSessions.size,
        telegramEnabled: Boolean(telegramBot)
    });
});

// Keep the route available for the existing dashboard.
// Bulk messaging is intentionally not implemented here.
app.post('/send', (req, res) => {
    res.status(403).json({
        success: false,
        message:
            'Bulk messaging is disabled. Use only consent-based messaging.'
    });
});

// Stop tracked in-memory sessions
app.post('/stop', (req, res) => {
    let stopped = 0;

    for (const [sessionId, session] of activeSessions.entries()) {
        if (session && typeof session === 'object') {
            if ('running' in session) {
                session.running = false;
            }

            if ('stopRequested' in session) {
                session.stopRequested = true;
            }

            stopped++;
        }

        activeSessions.delete(sessionId);
    }

    res.json({
        success: true,
        stoppedSessions: stopped,
        message: 'Stop request processed.'
    });
});

// -------------------- TELEGRAM BOT --------------------

if (TELEGRAM_BOT_TOKEN && TELEGRAM_OWNER_ID) {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
        polling: true
    });

    // Only allow your Telegram account to control the bot
    function isOwner(msg) {
        return (
            msg.from &&
            String(msg.from.id) === String(TELEGRAM_OWNER_ID)
        );
    }

    function denyAccess(msg) {
        return telegramBot.sendMessage(
            msg.chat.id,
            '⛔ Access denied. You are not authorized.'
        );
    }

    // /start
    telegramBot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
        if (!isOwner(msg)) {
            return denyAccess(msg);
        }

        await telegramBot.sendMessage(
            msg.chat.id,
            'नमस्ते भाई! ❤️ Telegram bot चालू है।\n\n' +
            'Available commands:\n' +
            '/status - Server status\n' +
            '/stop - Stop tracked sessions\n' +
            '/help - Show commands'
        );
    });

    // /help
    telegramBot.onText(/^\/help(?:@\w+)?$/, async (msg) => {
        if (!isOwner(msg)) {
            return denyAccess(msg);
        }

        await telegramBot.sendMessage(
            msg.chat.id,
            '🤖 Bot Commands\n\n' +
            '/start - Start menu\n' +
            '/status - Check server status\n' +
            '/stop - Stop tracked sessions\n' +
            '/help - Show this help'
        );
    });

    // /status
    telegramBot.onText(/^\/status(?:@\w+)?$/, async (msg) => {
        if (!isOwner(msg)) {
            return denyAccess(msg);
        }

        const uptimeSeconds = Math.floor(process.uptime());
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;

        await telegramBot.sendMessage(
            msg.chat.id,
            '✅ Server Status: ONLINE\n' +
            '⏱️ Uptime: ' +
            `${hours}h ${minutes}m ${seconds}s\n` +
            '📊 Active Sessions: ' +
            activeSessions.size +
            '\n🤖 Telegram: Connected'
        );
    });

    // /stop
    telegramBot.onText(/^\/stop(?:@\w+)?$/, async (msg) => {
        if (!isOwner(msg)) {
            return denyAccess(msg);
        }

        let stopped = 0;

        for (const [sessionId, session] of activeSessions.entries()) {
            if (session && typeof session === 'object') {
                if ('running' in session) {
                    session.running = false;
                }

                if ('stopRequested' in session) {
                    session.stopRequested = true;
                }

                stopped++;
            }

            activeSessions.delete(sessionId);
        }

        await telegramBot.sendMessage(
            msg.chat.id,
            '🛑 Stop request processed.\n' +
            'Sessions processed: ' + stopped + '\n\n' +
            'Note: This does not shut down the Render server.'
        );
    });

    telegramBot.on('polling_error', (error) => {
        console.error('Telegram polling error:', error.message);
    });

    console.log('✅ Telegram bot initialized');
} else {
    console.log(
        '⚠️ Telegram bot disabled. Set TELEGRAM_BOT_TOKEN ' +
        'and TELEGRAM_OWNER_ID in Render Environment.'
    );
}

// -------------------- START SERVER --------------------

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
});

// -------------------- GRACEFUL SHUTDOWN --------------------

function shutdown() {
    console.log('Server shutting down...');

    if (telegramBot) {
        telegramBot.stopPolling().catch((error) => {
            console.error('Telegram shutdown error:', error.message);
        });
    }

    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
