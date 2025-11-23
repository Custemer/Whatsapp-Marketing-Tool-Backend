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

const Session = require("../models/Session");

const router = express.Router();

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

// Export whatsappClient for use in other files
module.exports.getWhatsAppClient = () => whatsappClient;
module.exports.router = router;
