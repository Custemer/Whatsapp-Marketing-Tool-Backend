const express = require("express");
const fs = require("fs");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
} = require("@whiskeysockets/baileys");
const mongoose = require('mongoose');

let router = express.Router();

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://darkslframexteam_db_user:Mongodb246810@cluster0.cdgkgic.mongodb.net/darkslframex?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => {
    console.log('MongoDB Connected for WhatsApp Tool');
})
.catch((error) => {
    console.error('MongoDB Connection Failed:', error.message);
});

// Session Schema
const sessionSchema = new mongoose.Schema({
    sessionId: String,
    phoneNumber: String,
    connected: { type: Boolean, default: false },
    pairingCode: String,
    lastActivity: { type: Date, default: Date.now },
    userData: Object
});

const Session = mongoose.model('Session', sessionSchema);

// Global variables to manage WhatsApp connection
let whatsappClient = null;
let isConnecting = false;

// Format phone number
function formatPhoneNumber(number) {
    try {
        const cleaned = number.toString().replace(/\D/g, '');
        if (cleaned.startsWith('0')) {
            return '94' + cleaned.substring(1);
        }
        if (cleaned.length === 9) {
            return '94' + cleaned;
        }
        return cleaned;
    } catch (error) {
        return number;
    }
}

// Initialize WhatsApp Connection
async function initializeWhatsApp() {
    if (isConnecting) {
        console.log('WhatsApp connection already in progress');
        return;
    }

    try {
        isConnecting = true;
        const { state, saveCreds } = await useMultiFileAuthState("./whatsapp-session");

        whatsappClient = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: "fatal" }).child({ level: "fatal" })
                ),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.ubuntu("Chrome"),
        });

        // Save credentials when updated
        whatsappClient.ev.on("creds.update", saveCreds);

        // Handle connection updates
        whatsappClient.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log('WhatsApp CONNECTED SUCCESSFULLY!');
                isConnecting = false;
                
                // Update database
                await Session.findOneAndUpdate(
                    {},
                    {
                        connected: true,
                        lastActivity: new Date(),
                        userData: whatsappClient.user
                    },
                    { upsert: true, new: true }
                );
                
            } else if (connection === "close") {
                console.log('WhatsApp connection closed');
                isConnecting = false;
                
                if (lastDisconnect?.error?.output?.statusCode !== 401) {
                    // Retry connection after 10 seconds
                    setTimeout(() => initializeWhatsApp(), 10000);
                }
            }
        });

    } catch (error) {
        console.error('WhatsApp initialization error:', error);
        isConnecting = false;
        setTimeout(() => initializeWhatsApp(), 10000);
    }
}

// Pairing Code Endpoint
router.get("/", async (req, res) => {
    let num = req.query.number;

    if (!num) {
        return res.send({ code: "Phone number is required" });
    }

    // Format phone number
    num = formatPhoneNumber(num);

    try {
        // Initialize WhatsApp if not already connected
        if (!whatsappClient || isConnecting) {
            await initializeWhatsApp();
            await delay(3000);
        }

        if (!whatsappClient) {
            return res.send({ code: "Service initializing, please try again" });
        }

        // Generate pairing code
        const pairingCode = await whatsappClient.requestPairingCode(num);
        
        // Save to database
        await Session.findOneAndUpdate(
            {},
            {
                phoneNumber: num,
                connected: false,
                pairingCode: pairingCode,
                lastActivity: new Date()
            },
            { upsert: true, new: true }
        );

        console.log(`Pairing code generated for ${num}: ${pairingCode}`);
        res.send({ code: pairingCode });

    } catch (error) {
        console.error('Pairing code error:', error);
        res.send({ code: "Error generating pairing code" });
    }
});

// Get Connection Status
router.get("/status", async (req, res) => {
    try {
        const session = await Session.findOne({});
        const isConnected = whatsappClient && whatsappClient.user;
        
        res.json({
            connected: isConnected,
            hasSession: !!session,
            phoneNumber: session?.phoneNumber,
            pairingCode: session?.pairingCode,
            lastActivity: session?.lastActivity
        });
    } catch (error) {
        res.json({ error: error.message });
    }
});

module.exports = router;
