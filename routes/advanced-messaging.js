const express = require("express");
const { delay } = require("@whiskeysockets/baileys");

const Session = require("../models/Session");
const Contact = require("../models/Contact");
const { getWhatsAppClient } = require("./pair");

const router = express.Router();

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

// Advanced bulk messaging
router.post("/bulk-with-images", async (req, res) => {
    try {
        const { 
            contacts, 
            message, 
            delayMs = 2000,
            sendTo = 'active'
        } = req.body;
        
        if (!message) {
            return res.json({ 
                success: false, 
                error: 'Message is required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        let contactList = [];
        
        if (contacts && contacts.length > 0) {
            // Use provided contacts
            contactList = Array.isArray(contacts) ? contacts : contacts.split('\n').filter(num => num.trim() !== '');
        } else {
            // Use contacts from database based on selection
            let query = {};
            if (sendTo === 'active') {
                query = { status: 'active' };
            } else if (sendTo === 'new') {
                query = { messageCount: 0 };
            }
            
            const dbContacts = await Contact.find(query);
            contactList = dbContacts.map(contact => contact.phoneNumber);
        }

        const results = [];
        let successCount = 0;

        for (let i = 0; i < contactList.length; i++) {
            const number = contactList[i].trim();
            
            try {
                const formattedNumber = formatPhoneNumber(number) + '@s.whatsapp.net';
                await client.sendMessage(formattedNumber, { text: message });
                results.push({ number, status: 'success' });
                successCount++;
                
                // Update contact in database
                await Contact.findOneAndUpdate(
                    { phoneNumber: number },
                    {
                        phoneNumber: number,
                        lastContacted: new Date(),
                        $inc: { messageCount: 1 },
                        status: 'active'
                    },
                    { upsert: true, new: true }
                );
                
                // Add delay between messages
                if (i < contactList.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, parseInt(delayMs)));
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
            totalContacts: contactList.length,
            message: `Bulk messaging completed: ${successCount}/${contactList.length} sent successfully`
        });

    } catch (error) {
        console.error('Advanced bulk messaging error:', error);
        res.json({ 
            success: false, 
            error: 'Bulk messaging failed: ' + error.message 
        });
    }
});

// Smart messaging with personalization
router.post("/smart-bulk", async (req, res) => {
    try {
        const { 
            messageTemplate,
            personalization = true
        } = req.body;
        
        if (!messageTemplate) {
            return res.json({ 
                success: false, 
                error: 'Message template is required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        // Get active contacts from database
        const contacts = await Contact.find({ status: 'active' }).limit(20);
        const results = [];
        let successCount = 0;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            
            try {
                const formattedNumber = contact.phoneNumber + '@s.whatsapp.net';
                
                // Personalize message
                let personalizedMessage = messageTemplate;
                if (personalization) {
                    personalizedMessage = personalizeMessage(messageTemplate, contact);
                }
                
                await client.sendMessage(formattedNumber, { text: personalizedMessage });
                results.push({ 
                    number: contact.phoneNumber, 
                    status: 'success',
                    personalized: personalization
                });
                successCount++;
                
                // Update contact
                contact.lastContacted = new Date();
                contact.messageCount += 1;
                await contact.save();
                
                // Add delay
                if (i < contacts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
            } catch (error) {
                results.push({ 
                    number: contact.phoneNumber, 
                    status: 'error', 
                    error: error.message 
                });
            }
        }

        // Update stats
        await Session.findOneAndUpdate(
            {},
            { 
                lastActivity: new Date(),
                $inc: { 'stats.totalMessages': successCount }
            }
        );

        res.json({
            success: true,
            results: results,
            sent: successCount,
            failed: contacts.length - successCount,
            personalization: personalization,
            message: `Smart messaging completed: ${successCount} personalized messages sent`
        });

    } catch (error) {
        console.error('Smart bulk messaging error:', error);
        res.json({ 
            success: false, 
            error: 'Smart messaging failed: ' + error.message 
        });
    }
});

// Helper function to personalize messages
function personalizeMessage(template, contact) {
    let message = template;
    
    // Replace placeholders with contact data
    message = message.replace(/{{name}}/g, contact.name || 'there');
    message = message.replace(/{{phone}}/g, contact.phoneNumber);
    message = message.replace(/{{location}}/g, contact.location || 'your area');
    message = message.replace(/{{business}}/g, contact.businessType || 'business');
    
    return message;
}

module.exports = router;
