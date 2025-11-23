const express = require("express");
const { getWhatsAppClient } = require("./pair");
const Contact = require("../models/Contact");

const router = express.Router();

// Detect active WhatsApp numbers from a list
router.post("/detect-active", async (req, res) => {
    try {
        const { numbers } = req.body;
        
        if (!numbers || !Array.isArray(numbers)) {
            return res.json({ 
                success: false, 
                error: 'Numbers array is required' 
            });
        }

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        const results = [];
        let activeCount = 0;

        for (const number of numbers.slice(0, 50)) { // Limit to 50 for demo
            try {
                const formattedNumber = number.replace(/\D/g, '') + '@s.whatsapp.net';
                
                // Check if number is on WhatsApp
                const [result] = await client.onWhatsApp(formattedNumber);
                
                if (result && result.exists) {
                    results.push({
                        number: number,
                        status: 'active',
                        jid: result.jid
                    });
                    activeCount++;
                    
                    // Save to contacts database
                    await Contact.findOneAndUpdate(
                        { phoneNumber: number },
                        {
                            phoneNumber: number,
                            status: 'active',
                            lastChecked: new Date()
                        },
                        { upsert: true, new: true }
                    );
                } else {
                    results.push({
                        number: number,
                        status: 'inactive',
                        jid: null
                    });
                }
                
                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                results.push({
                    number: number,
                    status: 'error',
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            results: results,
            total: numbers.length,
            active: activeCount,
            inactive: numbers.length - activeCount,
            activePercentage: ((activeCount / numbers.length) * 100).toFixed(2)
        });

    } catch (error) {
        console.error('Number detection error:', error);
        res.json({ 
            success: false, 
            error: 'Number detection failed: ' + error.message 
        });
    }
});

// Get detection statistics
router.get("/stats", async (req, res) => {
    try {
        const totalContacts = await Contact.countDocuments();
        const activeContacts = await Contact.countDocuments({ status: 'active' });
        const contactsByLocation = await Contact.aggregate([
            { $group: { _id: '$location', count: { $sum: 1 } } }
        ]);
        
        const recentDetections = await Contact.find()
            .sort({ lastChecked: -1 })
            .limit(10);

        res.json({
            totalContacts,
            activeContacts,
            inactiveContacts: totalContacts - activeContacts,
            contactsByLocation,
            recentDetections
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
