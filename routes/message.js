const express = require("express");
const { delay } = require("@whiskeysockets/baileys");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Session = require("../models/Session");
const Contact = require("../models/Contact");
const { getWhatsAppClient } = require("./pair");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

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

// Send Single Message
router.post("/send", upload.single('image'), async (req, res) => {
    try {
        const { number, message } = req.body;
        const image = req.file;
        
        if (!number || !message) {
            return res.json({ 
                success: false, 
                error: 'Number and message are required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected. Please connect first using pairing code.' 
            });
        }

        const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
        
        let messageOptions = { text: message };
        
        // Add image if provided
        if (image) {
            messageOptions = {
                image: { url: image.path },
                caption: message
            };
        }
        
        await client.sendMessage(formattedNumber, messageOptions);
        
        // Update contact in database
        await Contact.findOneAndUpdate(
            { phoneNumber: number },
            {
                phoneNumber: number,
                lastContacted: new Date(),
                $inc: { messageCount: 1 }
            },
            { upsert: true, new: true }
        );
        
        // Update session stats
        await Session.findOneAndUpdate(
            {},
            { 
                lastActivity: new Date(),
                $inc: { 'stats.totalMessages': 1 }
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: 'Message sent successfully'
        });

    } catch (error) {
        console.error('Send message error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to send message: ' + error.message 
        });
    }
});

// Bulk Messaging
router.post("/bulk", upload.single('image'), async (req, res) => {
    try {
        const { contacts, message, delayMs = 2000 } = req.body;
        const image = req.file;
        
        if (!contacts || !message) {
            return res.json({ 
                success: false, 
                error: 'Contacts and message are required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        const contactList = Array.isArray(contacts) ? contacts : contacts.split('\n').filter(num => num.trim() !== '');
        const results = [];
        let successCount = 0;

        for (let i = 0; i < contactList.length; i++) {
            const number = contactList[i].trim();
            try {
                const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
                
                let messageOptions = { text: message };
                
                if (image) {
                    messageOptions = {
                        image: { url: image.path },
                        caption: message
                    };
                }
                
                await client.sendMessage(formattedNumber, messageOptions);
                results.push({ number, status: 'success' });
                successCount++;
                
                // Update contact in database
                await Contact.findOneAndUpdate(
                    { phoneNumber: number },
                    {
                        phoneNumber: number,
                        lastContacted: new Date(),
                        $inc: { messageCount: 1 }
                    },
                    { upsert: true, new: true }
                );
                
                // Add delay between messages
                if (i < contactList.length - 1) {
                    await delay(parseInt(delayMs));
                }
            } catch (error) {
                results.push({ number, status: 'error', error: error.message });
            }
        }

        // Update session stats
        await Session.findOneAndUpdate(
            {},
            { 
                lastActivity: new Date(),
                $inc: { 'stats.totalMessages': successCount }
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            results: results,
            sent: successCount,
            failed: contactList.length - successCount,
            message: 'Sent ' + successCount + '/' + contactList.length + ' messages successfully'
        });

    } catch (error) {
        console.error('Bulk send error:', error);
        res.json({ 
            success: false, 
            error: 'Bulk send failed: ' + error.message 
        });
    }
});

module.exports = router;
